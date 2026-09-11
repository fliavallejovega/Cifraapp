'use server';

import { adminActions, emailTemplates, emailTemplateVersions } from '@app/database/schema';
import {
  COPY_FIELDS,
  definitionFor,
  renderEmail,
  sendWithBrevo,
  supabaseFieldsFor,
  validateCopy,
  type CopyProblem,
  type EmailCopy,
  type EmailLocale,
  type TemplateDefinition,
} from '@app/email';
import { getClientEnv, getServerEnv } from '@app/validation/env';
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { adminDb, loadAdminSession, satisfies, type AdminSession } from './admin-session';
import { effectiveCopies, loadOverrides } from './email-templates';
import { sampleFor } from './email-samples';
import { writeAuthConfig } from './supabase-auth-mail';

/**
 * Lo que la consola puede cambiar de un correo.
 *
 * Cinco operaciones —guardar, restaurar una versión, volver al texto de
 * fábrica, mandar una prueba y publicar en Supabase— y las cinco comparten tres
 * reglas:
 *
 *   - Sólo un administrador de contenido (o super) escribe. Los demás ven.
 *   - Todo cambio queda en `audit.admin_actions` con el antes y el después, y
 *     en el historial de versiones. Un correo que salió mal no se desenvía; lo
 *     que queda es saber qué decía y volver a lo anterior.
 *   - El texto se valida en el servidor otra vez, aunque la pantalla ya lo haya
 *     hecho. La pantalla es para quien escribe; esta es la que manda.
 */

export interface EmailActionResult {
  readonly ok?: 'saved' | 'restored' | 'reset' | 'published' | 'testSent' | 'unchanged';
  readonly error?:
    | 'forbidden'
    | 'unknownTemplate'
    | 'invalid'
    | 'conflict'
    | 'mailNotConfigured'
    | 'sendFailed'
    | 'generic';
  readonly problems?: readonly CopyProblem[];
  /** En los correos de cuenta, qué pasó al publicar después de guardar. */
  readonly publish?: 'published' | 'noToken' | 'failed';
  readonly detail?: string;
}

type Tx = Parameters<Parameters<ReturnType<typeof adminDb>['transaction']>[0]>[0];

async function editor(): Promise<AdminSession | null> {
  const session = await loadAdminSession();
  return session && satisfies(session.role, 'content_admin') ? session : null;
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function localeOf(formData: FormData): EmailLocale {
  return text(formData, 'locale') === 'en' ? 'en' : 'es';
}

/** El texto del formulario, con los finales de línea de Windows normalizados. */
function copyOf(formData: FormData): EmailCopy {
  const read = (key: string) => text(formData, key).replace(/\r\n/g, '\n');
  return {
    subject: read('subject').trim(),
    preheader: read('preheader').trim(),
    heading: read('heading').trim(),
    body: read('body').trim(),
    ctaLabel: read('ctaLabel').trim(),
    footnote: read('footnote').trim(),
  };
}

function sameCopy(a: EmailCopy, b: EmailCopy): boolean {
  return COPY_FIELDS.every((field) => a[field] === b[field]);
}

async function currentRow(tx: Tx, key: string, locale: EmailLocale) {
  const [row] = await tx
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.templateKey, key), eq(emailTemplates.locale, locale)))
    .for('update')
    .limit(1);
  return row ?? null;
}

function rowCopy(row: NonNullable<Awaited<ReturnType<typeof currentRow>>>): EmailCopy {
  return {
    subject: row.subject,
    preheader: row.preheader,
    heading: row.heading,
    body: row.body,
    ctaLabel: row.ctaLabel,
    footnote: row.footnote,
  };
}

async function nextVersion(tx: Tx, key: string, locale: EmailLocale): Promise<number> {
  const [row] = await tx
    .select({ top: sql<number>`coalesce(max(${emailTemplateVersions.version}), 0)::int` })
    .from(emailTemplateVersions)
    .where(and(eq(emailTemplateVersions.templateKey, key), eq(emailTemplateVersions.locale, locale)));
  return (row?.top ?? 0) + 1;
}

/** Escribe el texto nuevo, su versión y la auditoría, en la misma transacción. */
async function writeCopy(
  tx: Tx,
  input: {
    readonly session: AdminSession;
    readonly definition: TemplateDefinition;
    readonly locale: EmailLocale;
    readonly copy: EmailCopy;
    readonly before: EmailCopy;
    readonly beforeWasDefault: boolean;
    readonly reason: 'edit' | 'restore';
  },
): Promise<number> {
  const { session, definition, locale, copy } = input;
  const version = await nextVersion(tx, definition.key, locale);
  const now = new Date();

  await tx
    .insert(emailTemplates)
    .values({
      templateKey: definition.key,
      locale,
      ...copy,
      version,
      updatedBy: session.profileId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [emailTemplates.templateKey, emailTemplates.locale],
      set: { ...copy, version, updatedBy: session.profileId, updatedAt: now },
    });

  await tx.insert(emailTemplateVersions).values({
    templateKey: definition.key,
    locale,
    version,
    ...copy,
    createdBy: session.profileId,
    reason: input.reason,
  });

  await tx.insert(adminActions).values({
    actorId: session.profileId,
    actorRole: session.role,
    action: input.reason === 'restore' ? 'email_template.restore' : 'email_template.save',
    targetKind: 'email_template',
    targetId: `${definition.key}:${locale}`,
    before: { ...input.before, fromDefault: input.beforeWasDefault },
    after: { ...copy, version },
  });

  return version;
}

/**
 * Publica en Supabase los dos idiomas de un correo de cuenta, tal como quedaron.
 *
 * Se publica lo que está guardado, releído de la base, y no lo que llegó en el
 * formulario: así lo que Supabase recibe es exactamente lo que la consola
 * enseña después.
 */
async function publish(
  session: AdminSession,
  definition: TemplateDefinition,
): Promise<{ status: 'published' | 'noToken' | 'failed'; detail?: string }> {
  const copies = effectiveCopies(definition, await loadOverrides(definition.key));
  const outcome = await writeAuthConfig(supabaseFieldsFor(definition, copies));

  if (outcome.status === 'noToken') return { status: 'noToken' };
  if (outcome.status === 'failed') return { status: 'failed', detail: outcome.reason };

  const db = adminDb();
  await db
    .update(emailTemplates)
    .set({ publishedAt: new Date(), publishedVersion: sql`${emailTemplates.version}` })
    .where(eq(emailTemplates.templateKey, definition.key));
  await db.insert(adminActions).values({
    actorId: session.profileId,
    actorRole: session.role,
    action: 'email_template.publish',
    targetKind: 'email_template',
    targetId: definition.key,
    before: null,
    after: { supabaseKind: definition.supabaseKind ?? null, subjects: { es: copies.es.subject, en: copies.en.subject } },
  });

  return { status: 'published' };
}

function refresh(key: string) {
  revalidatePath('/emails');
  revalidatePath(`/emails/${key}`);
}

async function afterWrite(
  session: AdminSession,
  definition: TemplateDefinition,
  ok: NonNullable<EmailActionResult['ok']>,
): Promise<EmailActionResult> {
  refresh(definition.key);
  if (definition.channel !== 'supabase') return { ok };
  const published = await publish(session, definition);
  refresh(definition.key);
  return { ok, publish: published.status, ...(published.detail ? { detail: published.detail } : {}) };
}

// ── Guardar ─────────────────────────────────────────────────────────────────

export async function saveEmailTemplate(
  _previous: EmailActionResult,
  formData: FormData,
): Promise<EmailActionResult> {
  const session = await editor();
  if (!session) return { error: 'forbidden' };

  const definition = definitionFor(text(formData, 'templateKey'));
  if (!definition) return { error: 'unknownTemplate' };

  const locale = localeOf(formData);
  const copy = copyOf(formData);
  const problems = validateCopy(definition, copy);
  if (problems.length > 0) return { error: 'invalid', problems };

  // La versión que la persona tenía abierta. Si otra persona guardó mientras
  // tanto, esto no pisa su trabajo: avisa, y quien edita decide.
  const baseVersion = Number(text(formData, 'baseVersion') || '0');

  try {
    const outcome = await adminDb().transaction(async (tx) => {
      const row = await currentRow(tx, definition.key, locale);
      if ((row?.version ?? 0) !== baseVersion) return 'conflict' as const;

      const before = row ? rowCopy(row) : definition.defaults[locale];
      if (sameCopy(before, copy)) return 'unchanged' as const;

      await writeCopy(tx, {
        session,
        definition,
        locale,
        copy,
        before,
        beforeWasDefault: !row,
        reason: 'edit',
      });
      return 'saved' as const;
    });

    if (outcome === 'conflict') return { error: 'conflict' };
    if (outcome === 'unchanged') return { ok: 'unchanged' };
    return await afterWrite(session, definition, 'saved');
  } catch {
    return { error: 'generic' };
  }
}

// ── Restaurar una versión ───────────────────────────────────────────────────

export async function restoreEmailVersion(
  _previous: EmailActionResult,
  formData: FormData,
): Promise<EmailActionResult> {
  const session = await editor();
  if (!session) return { error: 'forbidden' };

  const [version] = await adminDb()
    .select()
    .from(emailTemplateVersions)
    .where(eq(emailTemplateVersions.id, text(formData, 'versionId')))
    .limit(1);
  if (!version) return { error: 'unknownTemplate' };

  const definition = definitionFor(version.templateKey);
  if (!definition) return { error: 'unknownTemplate' };

  const locale: EmailLocale = version.locale === 'en' ? 'en' : 'es';
  const copy: EmailCopy = {
    subject: version.subject,
    preheader: version.preheader,
    heading: version.heading,
    body: version.body,
    ctaLabel: version.ctaLabel,
    footnote: version.footnote,
  };

  // Una versión vieja puede usar una variable que el catálogo ya no tiene, o
  // venir de antes de que el botón fuera obligatorio. Se valida contra hoy.
  const problems = validateCopy(definition, copy);
  if (problems.length > 0) return { error: 'invalid', problems };

  try {
    await adminDb().transaction(async (tx) => {
      const row = await currentRow(tx, definition.key, locale);
      await writeCopy(tx, {
        session,
        definition,
        locale,
        copy,
        before: row ? rowCopy(row) : definition.defaults[locale],
        beforeWasDefault: !row,
        reason: 'restore',
      });
    });
    return await afterWrite(session, definition, 'restored');
  } catch {
    return { error: 'generic' };
  }
}

// ── Volver al texto de fábrica ──────────────────────────────────────────────

export async function resetEmailTemplate(
  _previous: EmailActionResult,
  formData: FormData,
): Promise<EmailActionResult> {
  const session = await editor();
  if (!session) return { error: 'forbidden' };

  const definition = definitionFor(text(formData, 'templateKey'));
  if (!definition) return { error: 'unknownTemplate' };
  const locale = localeOf(formData);

  try {
    const outcome = await adminDb().transaction(async (tx) => {
      const row = await currentRow(tx, definition.key, locale);
      if (!row) return 'unchanged' as const;

      const defaults = definition.defaults[locale];
      const version = await nextVersion(tx, definition.key, locale);

      // Se borra la fila —sin ella manda el código— pero no lo que decía: el
      // historial guarda la vuelta a fábrica como una versión más, y la
      // auditoría guarda el texto que se quitó.
      await tx
        .delete(emailTemplates)
        .where(and(eq(emailTemplates.templateKey, definition.key), eq(emailTemplates.locale, locale)));
      await tx.insert(emailTemplateVersions).values({
        templateKey: definition.key,
        locale,
        version,
        ...defaults,
        createdBy: session.profileId,
        reason: 'reset',
      });
      await tx.insert(adminActions).values({
        actorId: session.profileId,
        actorRole: session.role,
        action: 'email_template.reset',
        targetKind: 'email_template',
        targetId: `${definition.key}:${locale}`,
        before: { ...rowCopy(row), version: row.version },
        after: { ...defaults, fromDefault: true, version },
      });
      return 'reset' as const;
    });

    if (outcome === 'unchanged') return { ok: 'unchanged' };
    return await afterWrite(session, definition, 'reset');
  } catch {
    return { error: 'generic' };
  }
}

// ── Publicar en Supabase ────────────────────────────────────────────────────

export async function publishEmailTemplate(
  _previous: EmailActionResult,
  formData: FormData,
): Promise<EmailActionResult> {
  const session = await editor();
  if (!session) return { error: 'forbidden' };

  const definition = definitionFor(text(formData, 'templateKey'));
  if (definition?.channel !== 'supabase') return { error: 'unknownTemplate' };

  const published = await publish(session, definition);
  refresh(definition.key);
  return {
    ok: 'published',
    publish: published.status,
    ...(published.detail ? { detail: published.detail } : {}),
  };
}

// ── Mandar una prueba ───────────────────────────────────────────────────────

/**
 * Manda el borrador —lo que está en la pantalla, guardado o no— a quien lo edita.
 *
 * Sólo a su propio correo. Una consola que puede mandar un correo con el diseño
 * de Cifraapp a cualquier dirección es una herramienta de suplantación con
 * nuestro nombre; a la propia dirección sirve para lo único que se necesita:
 * ver cómo llega.
 */
export async function sendEmailTest(
  _previous: EmailActionResult,
  formData: FormData,
): Promise<EmailActionResult> {
  const session = await editor();
  if (!session) return { error: 'forbidden' };

  const definition = definitionFor(text(formData, 'templateKey'));
  if (!definition) return { error: 'unknownTemplate' };

  const locale = localeOf(formData);
  const copy = copyOf(formData);
  const problems = validateCopy(definition, copy);
  if (problems.length > 0) return { error: 'invalid', problems };

  const env = getServerEnv();
  if (!env.BREVO_API_KEY || !env.MAIL_FROM_EMAIL) return { error: 'mailNotConfigured' };

  const sample = sampleFor(definition, locale, getClientEnv().NEXT_PUBLIC_APP_URL);
  const rendered = renderEmail({ definition, copy, locale, mode: 'send', ...sample });
  const label = locale === 'en' ? '[Test]' : '[Prueba]';

  const outcome = await sendWithBrevo(
    {
      apiKey: env.BREVO_API_KEY,
      fromEmail: env.MAIL_FROM_EMAIL,
      fromName: env.MAIL_FROM_NAME ?? 'Cifraapp',
    },
    {
      to: session.email,
      subject: `${label} ${rendered.subject}`,
      text: rendered.text,
      html: rendered.html,
    },
  );

  await adminDb().insert(adminActions).values({
    actorId: session.profileId,
    actorRole: session.role,
    action: 'email_template.test_send',
    targetKind: 'email_template',
    targetId: `${definition.key}:${locale}`,
    before: null,
    after: { to: session.email, subject: rendered.subject, status: outcome.status },
  });

  if (outcome.status === 'failed') return { error: 'sendFailed', detail: outcome.reason };
  return { ok: 'testSent', detail: session.email };
}
