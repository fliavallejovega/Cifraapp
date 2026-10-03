import { Page, PageHeader, Problem } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { UploadBoard } from '@/components/family-expenses/upload-board';
import { Link } from '@/i18n/navigation';
import { loadHouseholdContext } from '@/server/household-context';
import { loadFamilyBoard } from '@/server/repositories/family-expenses';
import { requireHousehold } from '@/server/session';

/**
 * Gastos familiares: every account and card in the house, under its owner,
 * each one a place to upload that account's statement.
 *
 * Resolved on the server with the session, so the person looking sees their
 * own accounts first on the first paint rather than after a client fetch.
 */
export default async function FamilyExpensesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const t = await getTranslations('familyExpenses');

  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const board = await loadFamilyBoard(
    session,
    session.activeHouseholdId,
    context.today.slice(0, 7),
  );

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {board.totalAccounts === 0 ? (
        <Problem
          title={t('noAccounts.title')}
          body={t('noAccounts.body')}
          action={
            <Link
              href="/accounts"
              className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
            >
              {t('noAccounts.action')}
            </Link>
          }
        />
      ) : (
        <UploadBoard board={board} locale={locale} />
      )}
    </Page>
  );
}
