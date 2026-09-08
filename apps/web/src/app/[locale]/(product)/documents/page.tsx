import {
  Amount,
  Card,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  PageHeader,
  Problem,
  Section,
  Status,
} from '@app/ui';
import { documents, imports } from '@app/database/schema';
import { Money } from '@app/domain';
import { desc, eq } from 'drizzle-orm';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { ImportForm } from '@/components/import-form';
import { Link } from '@/i18n/navigation';
import { loadAccountOptions } from '@/server/repositories/administration';
import { queryAsUser, requireHousehold } from '@/server/session';

/**
 * Imports, and what each one did.
 *
 * The summary is the point: "1,284 found · 27 new · 16 possible duplicates" is
 * a claim a person can check, where "import complete" is not. Provenance stays
 * visible so any figure can be traced back to the file it came from
 * (spec §14, §105).
 */
export default async function DocumentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const t = await getTranslations('documents');
  const format = await getFormatter();

  const runs = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: imports.id,
        status: imports.status,
        format: imports.format,
        found: imports.rowsFound,
        created: imports.rowsNew,
        duplicate: imports.rowsDuplicate,
        review: imports.rowsReview,
        rejected: imports.rowsRejected,
        startedAt: imports.startedAt,
        fileName: documents.fileName,
      })
      .from(imports)
      .innerJoin(documents, eq(documents.id, imports.documentId))
      .where(eq(imports.householdId, session.activeHouseholdId))
      .orderBy(desc(imports.startedAt))
      .limit(25),
  );

  const importAccounts = await loadAccountOptions(session, session.activeHouseholdId);
  const hasAccount = importAccounts.length > 0;

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {/* An import needs an account to file against. Saying so here, before the
          file picker, beats letting someone choose a statement and then telling
          them it cannot be used. */}
      {!hasAccount && (
        <div className="mb-8">
          <Problem
            title={t('noAccount.title')}
            body={t('noAccount.body')}
            action={
              <Link href="/accounts" className="text-sm underline underline-offset-4">
                {t('noAccount.action')}
              </Link>
            }
          />
        </div>
      )}

      <Card padding="lg">
        <ImportForm
          locale={locale}
          accounts={importAccounts.map((account) => ({ id: account.id, name: account.name }))}
          labels={{
            file: t('form.file'),
            fileHint: t('form.fileHint'),
            account: t('form.account'),
            accountHint: t('form.accountHint'),
            submit: t('form.submit'),
            errorTitle: t('form.errorTitle'),
            queuedHeading: t('form.queuedHeading'),
            queuedDetail: t('form.queuedDetail'),
            watchLink: t('form.watchLink'),
            errors: {
              tooLarge: t('form.errors.tooLarge'),
              unsupportedType: t('form.errors.unsupportedType'),
              alreadyImported: t('form.errors.alreadyImported'),
              unreadable: t('form.errors.unreadable'),
              storageUnavailable: t('form.errors.storageUnavailable'),
              queueUnavailable: t('form.errors.queueUnavailable'),
              noAccount: t('form.errors.noAccount'),
              generic: t('form.errors.generic'),
            },
          }}
        />
      </Card>

      <Section title={t('history.title')} className="mt-14">
        {runs.length === 0 ? (
          <p className="border-t border-[color:var(--color-rule)] py-10 text-sm text-[color:var(--color-ink-secondary)]">
            {t('history.empty')}
          </p>
        ) : (
          <Card padding="none" className="overflow-hidden px-5 sm:px-6">
            <Ledger caption={t('history.title')}>
              <LedgerHead>
                <LedgerColumn>{t('history.columns.file')}</LedgerColumn>
                <LedgerColumn>{t('history.columns.when')}</LedgerColumn>
                <LedgerColumn align="end">{t('history.columns.found')}</LedgerColumn>
                <LedgerColumn align="end">{t('history.columns.new')}</LedgerColumn>
                <LedgerColumn align="end">{t('history.columns.duplicate')}</LedgerColumn>
                <LedgerColumn align="end">{t('history.columns.review')}</LedgerColumn>
                <LedgerColumn>{t('history.columns.status')}</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {runs.map((run) => (
                  <LedgerRow key={run.id}>
                    <LedgerCell>
                      <Link
                        href={`/documents/${run.id}`}
                        className="underline underline-offset-4 hover:no-underline"
                      >
                        {run.fileName}
                      </Link>
                    </LedgerCell>
                    <LedgerCell secondary className="tabular">
                      {format.dateTime(run.startedAt, { dateStyle: 'medium' })}
                    </LedgerCell>
                    <LedgerCell align="end" className="tabular">
                      {run.found}
                    </LedgerCell>
                    <LedgerCell align="end" className="tabular">
                      {run.created}
                    </LedgerCell>
                    <LedgerCell align="end" className="tabular">
                      {run.duplicate}
                    </LedgerCell>
                    <LedgerCell align="end" className="tabular">
                      {run.review}
                    </LedgerCell>
                    <LedgerCell>
                      <Status tone={run.review > 0 ? 'caution' : 'neutral'}>
                        {t(`history.statuses.${run.status}`)}
                      </Status>
                    </LedgerCell>
                  </LedgerRow>
                ))}
              </LedgerBody>
            </Ledger>
          </Card>
        )}
      </Section>

      <p className="mt-10 max-w-[62ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
        {t('note')}
      </p>
    </Page>
  );
}

void Amount;
void Money;
