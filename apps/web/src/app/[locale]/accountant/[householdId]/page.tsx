import { EmptyState, Page, PageHeader, Rule, Section, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Link } from '@/i18n/navigation';
import { loadClient } from '@/server/repositories/accountant';
import { requireSession } from '@/server/session';

/**
 * One client.
 *
 * A revoked grant produces a 404 here on the very next request, because the
 * lookup is a query the database answers under the grant policies rather than a
 * membership this page remembered. There is nothing to invalidate.
 *
 * The page shows what needs the accountant's attention and the notes they have
 * left. It does not show the household's members, its subscription, or anything
 * else a grant was not asked to cover.
 */
export default async function ClientPage({
  params,
}: {
  params: Promise<{ locale: string; householdId: string }>;
}) {
  const { locale, householdId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireSession(locale);
  const client = await loadClient(session, householdId);

  // Null covers "no such household" and "no grant on it" alike. Distinguishing
  // them would tell an accountant which households exist.
  if (!client) notFound();

  const t = await getTranslations('accountant');

  return (
    <Page>
      <header className="mb-14">
        <Link href="/accountant" className="text-sm underline underline-offset-4">
          {t('client.back')}
        </Link>
      </header>

      <PageHeader
        title={client.name}
        detail={t('client.grantedOn', {
          date: client.grantedAt.toISOString().slice(0, 10),
          scope: t(`scopes.${client.scope}`),
        })}
      />

      {client.expiresAt && (
        <p className="mb-10 flex flex-wrap items-baseline gap-3">
          <Status tone="caution">{t('client.expires')}</Status>
          <span className="text-sm text-[color:var(--color-ink-secondary)]">
            {client.expiresAt.toISOString().slice(0, 10)}
          </span>
        </p>
      )}

      <Section title={t('client.attention.title')} detail={t('client.attention.detail')}>
        <ul className="divide-y divide-[color:var(--color-rule)]">
          <li className="flex items-baseline justify-between gap-6 py-4 first:pt-0">
            <span>{t('client.attention.uncategorized')}</span>
            <span className="tabular">{client.uncategorized}</span>
          </li>
          <li className="flex items-baseline justify-between gap-6 py-4">
            <span>{t('client.attention.openRequests')}</span>
            <span className="tabular">{client.openRequests}</span>
          </li>
          <li className="flex items-baseline justify-between gap-6 py-4">
            <span>{t('client.attention.lastClose')}</span>
            <span className="tabular">{client.lastClosedPeriod ?? t('clients.neverClosed')}</span>
          </li>
        </ul>
      </Section>

      <Section title={t('client.notes.title')} detail={t('client.notes.detail')} className="mt-16">
        {client.notes.length === 0 ? (
          <EmptyState title={t('client.notes.empty.title')} body={t('client.notes.empty.body')} />
        ) : (
          <ul className="divide-y divide-[color:var(--color-rule)]">
            {client.notes.map((note) => (
              <li key={note.id} className="py-4 first:pt-0">
                <p className="tabular gradation-label uppercase">
                  {note.createdAt.toISOString().slice(0, 10)}
                </p>
                <p className="mt-1 max-w-[68ch] text-pretty">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Rule className="mt-16" />
      <footer className="mt-6">
        <p className="max-w-[62ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
          {t('client.revocable')}
        </p>
      </footer>
    </Page>
  );
}
