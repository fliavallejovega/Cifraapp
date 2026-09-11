import {
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Status,
} from '@app/ui';
import { CATALOGUE, EMAIL_LOCALES, type TemplateDefinition } from '@app/email';
import Link from 'next/link';

import { ConsolePage } from '@/components/figures';
import { Console } from '@/components/shell';
import {
  effectiveCopies,
  loadOverrides,
  overrideFor,
  supabaseStateFor,
  type Override,
  type SupabaseState,
} from '@/server/email-templates';
import { requireAdmin } from '@/server/guard';
import { readAuthConfig } from '@/server/supabase-auth-mail';

export const dynamic = 'force-dynamic';

/**
 * Every email Cifraapp sends, in one list.
 *
 * Two groups because they leave by two different roads: notices go out from
 * the product through Brevo, account emails go out from Supabase, which owns
 * sign-in. For the second group the list also says whether Supabase actually
 * has the text shown here — read live from Supabase, never from a flag of our
 * own that could go stale.
 */

const LANGUAGE: Record<'es' | 'en', string> = { es: 'Spanish', en: 'English' };

function LanguageCell({ override }: { readonly override: Override | null }) {
  if (!override) return <span className="text-[color:var(--color-ink-tertiary)]">Default</span>;
  return (
    <span>
      Edited <span className="tabular text-[color:var(--color-ink-tertiary)]">v{override.version}</span>
    </span>
  );
}

function SupabaseCell({ state }: { readonly state: SupabaseState }) {
  switch (state.kind) {
    case 'notApplicable':
      return <span className="text-[color:var(--color-ink-secondary)]">Brevo</span>;
    case 'noToken':
      return <Status tone="caution">Can’t check</Status>;
    case 'unreadable':
      return <Status tone="negative">Unreadable</Status>;
    case 'needsSmtp':
      return <Status tone="caution">Needs SMTP</Status>;
    case 'differs':
      return <Status tone="caution">Not published</Status>;
    case 'live':
      return state.sending ? (
        <Status tone="positive">Live</Status>
      ) : (
        <span className="text-[color:var(--color-ink-secondary)]">Live · switched off</span>
      );
  }
}

function Group({
  title,
  detail,
  definitions,
  overrides,
  states,
}: {
  readonly title: string;
  readonly detail: string;
  readonly definitions: readonly TemplateDefinition[];
  readonly overrides: Awaited<ReturnType<typeof loadOverrides>>;
  readonly states: ReadonlyMap<string, SupabaseState>;
}) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1 mb-4 max-w-[72ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {detail}
      </p>
      <Ledger caption={title}>
        <LedgerHead>
          <LedgerColumn>Email</LedgerColumn>
          {EMAIL_LOCALES.map((locale) => (
            <LedgerColumn key={locale}>{LANGUAGE[locale]}</LedgerColumn>
          ))}
          <LedgerColumn align="end">Sent by</LedgerColumn>
        </LedgerHead>
        <LedgerBody>
          {definitions.map((definition) => (
            <LedgerRow key={definition.key}>
              <LedgerCell>
                <Link
                  href={`/emails/${definition.key}`}
                  className="font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)]"
                >
                  {definition.name}
                </Link>
                <p className="mt-0.5 max-w-[52ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
                  {definition.purpose}
                </p>
              </LedgerCell>
              {EMAIL_LOCALES.map((locale) => (
                <LedgerCell key={locale}>
                  <LanguageCell override={overrideFor(overrides, definition.key, locale)} />
                </LedgerCell>
              ))}
              <LedgerCell align="end">
                <SupabaseCell state={states.get(definition.key) ?? { kind: 'notApplicable' }} />
              </LedgerCell>
            </LedgerRow>
          ))}
        </LedgerBody>
      </Ledger>
    </section>
  );
}

export default async function EmailsPage() {
  const session = await requireAdmin();
  const [overrides, config] = await Promise.all([loadOverrides(), readAuthConfig()]);

  const states = new Map(
    CATALOGUE.map((definition) => [
      definition.key,
      supabaseStateFor(definition, effectiveCopies(definition, overrides), config),
    ]),
  );

  const notices = CATALOGUE.filter((one) => one.group === 'notices');
  const account = CATALOGUE.filter((one) => one.group === 'account');
  const edited = CATALOGUE.reduce(
    (count, one) => count + EMAIL_LOCALES.filter((locale) => overrideFor(overrides, one.key, locale)).length,
    0,
  );

  return (
    <Console current="emails" email={session.email} role={session.role}>
      <ConsolePage
        title="Emails"
        detail={`${String(CATALOGUE.length)} emails, each in Spanish and English. ${
          edited === 0
            ? 'All of them are sending their default text.'
            : `${String(edited)} of ${String(CATALOGUE.length * 2)} versions carry text edited here.`
        } The design is fixed; what you edit is what they say.`}
      >
        {config.status === 'ok' && !config.config['smtp_host'] && (
          <p className="mb-8 max-w-[72ch] rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] p-4 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            Supabase is still sending account emails with its own mail server, and on the free plan it
            refuses template changes until the project has its own SMTP. Until Brevo’s SMTP is
            connected in Supabase, account emails keep Supabase’s English defaults — the text here is
            saved and publishes as soon as SMTP is in place.
          </p>
        )}
        {config.status === 'noToken' && (
          <p className="mb-8 max-w-[72ch] rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] p-4 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            This deployment has no <code>SUPABASE_ACCESS_TOKEN</code>, so it can’t read or publish the
            account emails. You can still edit and save them; they reach Supabase once someone
            publishes from a deployment that has the token.
          </p>
        )}

        <Group
          title="Notices"
          detail="Sent by the product through Brevo, to the people in a household who haven’t switched them off."
          definitions={notices}
          overrides={overrides}
          states={states}
        />
        <Group
          title="Account"
          detail="Sent by Supabase, which handles sign-in. Saving one here publishes it to Supabase in the same step."
          definitions={account}
          overrides={overrides}
          states={states}
        />

        <footer className="mt-16 border-t border-[color:var(--color-rule)] pt-6">
          <p className="max-w-[72ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
            Account emails leave through Supabase’s built-in mail server, which allows two per hour
            for the whole project, until a custom SMTP server is configured in Supabase. «Switched off»
            means Supabase has the text but won’t send that security notice until it is enabled under
            Authentication → Notifications.
          </p>
        </footer>
      </ConsolePage>
    </Console>
  );
}
