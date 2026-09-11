import { definitionFor, EMAIL_LOCALES, type EmailLocale } from '@app/email';
import { getClientEnv, getServerEnv } from '@app/validation/env';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmailEditor } from '@/components/email-editor';
import { ConsolePage } from '@/components/figures';
import { Console } from '@/components/shell';
import { satisfies } from '@/server/admin-session';
import {
  effectiveCopies,
  loadOverrides,
  loadVersions,
  overrideFor,
  supabaseStateFor,
} from '@/server/email-templates';
import { requireAdmin } from '@/server/guard';
import { publishingIsConfigured, readAuthConfig } from '@/server/supabase-auth-mail';

export const dynamic = 'force-dynamic';

const LANGUAGE: Record<EmailLocale, string> = { es: 'Español', en: 'English' };

export default async function EmailTemplatePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ key: string }>;
  readonly searchParams: Promise<{ locale?: string }>;
}) {
  const session = await requireAdmin();
  const { key } = await params;
  const { locale: requested } = await searchParams;

  const definition = definitionFor(key);
  if (!definition) notFound();

  // Español primero: es el idioma del producto y el que se escribe primero.
  const locale: EmailLocale = requested === 'en' ? 'en' : 'es';

  const [overrides, versions, config] = await Promise.all([
    loadOverrides(definition.key),
    loadVersions(definition.key, locale),
    definition.channel === 'supabase' ? readAuthConfig() : Promise.resolve({ status: 'noToken' as const }),
  ]);

  const copies = effectiveCopies(definition, overrides);
  const override = overrideFor(overrides, definition.key, locale);
  const env = getServerEnv();

  return (
    <Console current="emails" email={session.email} role={session.role}>
      <ConsolePage
        title={definition.name}
        detail={definition.purpose}
        actions={
          <Link
            href="/emails"
            className="text-sm text-[color:var(--color-ink-secondary)] underline-offset-4 hover:underline"
          >
            All emails
          </Link>
        }
      >
        <nav aria-label="Language" className="mb-8 flex gap-1 border-b border-[color:var(--color-rule)]">
          {EMAIL_LOCALES.map((one) => {
            const edited = overrideFor(overrides, definition.key, one);
            const active = one === locale;
            return (
              <Link
                key={one}
                href={`/emails/${definition.key}?locale=${one}`}
                aria-current={active ? 'page' : undefined}
                className={[
                  '-mb-px flex items-baseline gap-2 border-b-2 px-4 py-3 text-sm',
                  active
                    ? 'border-[color:var(--color-ink)] font-medium'
                    : 'border-transparent text-[color:var(--color-ink-secondary)] hover:text-[color:var(--color-ink)]',
                ].join(' ')}
              >
                {LANGUAGE[one]}
                <span className="text-xs text-[color:var(--color-ink-tertiary)]">
                  {edited ? `Edited · v${String(edited.version)}` : 'Default'}
                </span>
              </Link>
            );
          })}
        </nav>

        <EmailEditor
          key={`${definition.key}:${locale}`}
          templateKey={definition.key}
          locale={locale}
          saved={copies[locale]}
          isEdited={Boolean(override)}
          baseVersion={override?.version ?? 0}
          savedStamp={`${String(override?.version ?? 0)}:${override?.updatedAt.toISOString() ?? 'default'}`}
          updatedBy={override?.updatedBy ?? null}
          updatedAt={override?.updatedAt.toISOString() ?? null}
          canEdit={satisfies(session.role, 'content_admin')}
          editorEmail={session.email}
          productUrl={getClientEnv().NEXT_PUBLIC_APP_URL}
          mailConfigured={Boolean(env.BREVO_API_KEY && env.MAIL_FROM_EMAIL)}
          publishConfigured={publishingIsConfigured()}
          supabase={supabaseStateFor(definition, copies, config)}
          versions={versions}
        />
      </ConsolePage>
    </Console>
  );
}
