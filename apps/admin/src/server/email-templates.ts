import 'server-only';

import { emailTemplates, emailTemplateVersions, profiles } from '@app/database/schema';
import {
  EMAIL_LOCALES,
  supabaseFieldsFor,
  supabaseSwitchFor,
  type EmailCopy,
  type EmailLocale,
  type TemplateDefinition,
} from '@app/email';
import { and, desc, eq } from 'drizzle-orm';

import { adminDb } from './admin-session';
import type { AuthConfigRead } from './supabase-auth-mail';

/**
 * Lo que la consola lee de los correos.
 *
 * Lo editado vive en la base; lo de fábrica, en `@app/email`. Esta capa las
 * junta y dice, por idioma, qué texto sale hoy y de dónde viene.
 */

export interface Override {
  readonly copy: EmailCopy;
  readonly version: number;
  readonly updatedAt: Date;
  readonly updatedBy: string | null;
}

const overrideKey = (key: string, locale: EmailLocale) => `${key}:${locale}`;

/** Todo lo editado, en una consulta. La lista de correos no hace una por fila. */
export async function loadOverrides(templateKey?: string): Promise<ReadonlyMap<string, Override>> {
  const rows = await adminDb()
    .select({
      templateKey: emailTemplates.templateKey,
      locale: emailTemplates.locale,
      subject: emailTemplates.subject,
      preheader: emailTemplates.preheader,
      heading: emailTemplates.heading,
      body: emailTemplates.body,
      ctaLabel: emailTemplates.ctaLabel,
      footnote: emailTemplates.footnote,
      version: emailTemplates.version,
      updatedAt: emailTemplates.updatedAt,
      updatedBy: profiles.email,
    })
    .from(emailTemplates)
    .leftJoin(profiles, eq(profiles.id, emailTemplates.updatedBy))
    .where(templateKey ? eq(emailTemplates.templateKey, templateKey) : undefined);

  const out = new Map<string, Override>();
  for (const row of rows) {
    if (row.locale !== 'es' && row.locale !== 'en') continue;
    out.set(overrideKey(row.templateKey, row.locale), {
      copy: {
        subject: row.subject,
        preheader: row.preheader,
        heading: row.heading,
        body: row.body,
        ctaLabel: row.ctaLabel,
        footnote: row.footnote,
      },
      version: row.version,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    });
  }
  return out;
}

export function overrideFor(
  overrides: ReadonlyMap<string, Override>,
  key: string,
  locale: EmailLocale,
): Override | null {
  return overrides.get(overrideKey(key, locale)) ?? null;
}

/** El texto que sale hoy, en los dos idiomas. */
export function effectiveCopies(
  definition: TemplateDefinition,
  overrides: ReadonlyMap<string, Override>,
): Record<EmailLocale, EmailCopy> {
  const pick = (locale: EmailLocale) =>
    overrideFor(overrides, definition.key, locale)?.copy ?? definition.defaults[locale];
  return { es: pick('es'), en: pick('en') };
}

/**
 * Lo que Supabase tiene de un correo de cuenta, comparado con lo que debería.
 *
 * `differs` es la señal que importa: alguien guardó sin publicar, la
 * publicación falló, o alguien tocó el panel de Supabase a mano. En los tres
 * casos lo que llega a la gente no es lo que se ve en esta consola.
 */
export type SupabaseState =
  | { readonly kind: 'notApplicable' }
  | { readonly kind: 'noToken' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  /**
   * Supabase no deja cambiar las plantillas de un proyecto gratuito que manda
   * con su propio servidor de correo. Hasta que tenga un SMTP propio, cualquier
   * publicación rebota, y la pantalla lo dice antes de que alguien lo intente.
   */
  | { readonly kind: 'needsSmtp' }
  | { readonly kind: 'live' | 'differs'; readonly sending: boolean };

export function supabaseStateFor(
  definition: TemplateDefinition,
  copies: Readonly<Record<EmailLocale, EmailCopy>>,
  read: AuthConfigRead,
): SupabaseState {
  if (definition.channel !== 'supabase') return { kind: 'notApplicable' };
  if (read.status === 'noToken') return { kind: 'noToken' };
  if (read.status === 'failed') return { kind: 'unreadable', reason: read.reason };

  const expected = supabaseFieldsFor(definition, copies);
  const same0 = Object.entries(expected).every(([field, value]) => read.config[field] === value);
  const smtp = read.config['smtp_host'];
  if (!same0 && (typeof smtp !== 'string' || smtp.trim() === '')) return { kind: 'needsSmtp' };

  const same = same0;
  const toggle = supabaseSwitchFor(definition);
  const sending = toggle ? read.config[toggle] === true : true;

  return { kind: same ? 'live' : 'differs', sending };
}

export interface VersionEntry {
  readonly id: string;
  readonly locale: EmailLocale;
  readonly version: number;
  readonly reason: 'edit' | 'restore' | 'reset';
  readonly subject: string;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

/** El historial de un correo, lo más reciente primero. */
export async function loadVersions(templateKey: string, locale: EmailLocale): Promise<readonly VersionEntry[]> {
  const rows = await adminDb()
    .select({
      id: emailTemplateVersions.id,
      locale: emailTemplateVersions.locale,
      version: emailTemplateVersions.version,
      reason: emailTemplateVersions.reason,
      subject: emailTemplateVersions.subject,
      createdAt: emailTemplateVersions.createdAt,
      createdBy: profiles.email,
    })
    .from(emailTemplateVersions)
    .leftJoin(profiles, eq(profiles.id, emailTemplateVersions.createdBy))
    .where(
      and(
        eq(emailTemplateVersions.templateKey, templateKey),
        eq(emailTemplateVersions.locale, locale),
      ),
    )
    .orderBy(desc(emailTemplateVersions.version))
    .limit(30);

  return rows.map((row) => ({
    id: row.id,
    locale: row.locale === 'en' ? 'en' : 'es',
    version: row.version,
    reason: row.reason === 'restore' || row.reason === 'reset' ? row.reason : 'edit',
    subject: row.subject,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  }));
}

export { EMAIL_LOCALES };
