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
import { loadHouseholdContext } from '@/server/household-context';
import { loadAccountOptions } from '@/server/repositories/administration';
import { loadStatementCoverage } from '@/server/repositories/statement-coverage';
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

  // Qué falta por subir. Se lee de los movimientos ya registrados, no de una
  // lista de archivos: un documento puede traer un trimestre.
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const coverage = await loadStatementCoverage(
    session,
    session.activeHouseholdId,
    context.today.slice(0, 7),
  );

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

      {/*
        Lo que falta, antes del selector de archivo.

        Un hogar con dos personas, cuatro cuentas y tres tarjetas sube siete
        documentos por mes, y el que se olvida no se nota: la pantalla enseña un
        mes que se ve normal con menos gastos de los que hubo. Un hueco
        silencioso no se lee como un hueco — se lee como un buen mes. Por eso
        esto no espera a que alguien pregunte.
      */}
      {!coverage.isComplete && (
        <div className="mb-8">
          <Card tone="sunk">
            <h2 className="text-base font-medium">{t('missing.title')}</h2>
            <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {t('missing.detail')}
            </p>
            <ul className="mt-4 flex list-none flex-col gap-2 p-0">
              {coverage.gaps.map((gap) => (
                <li key={gap.accountId} className="text-sm">
                  <span className="font-medium">
                    {gap.maskedNumber
                      ? t(`missing.${gap.kind}`, { digits: gap.maskedNumber })
                      : gap.name}
                  </span>
                  <span className="ml-2 text-[color:var(--color-ink-secondary)]">
                    {t('missing.months', {
                      months: gap.missing.map((month) => monthName(month, locale)).join(', '),
                    })}
                  </span>
                </li>
              ))}
              {coverage.neverImported.map((account) => (
                <li key={account.accountId} className="text-sm">
                  <span className="font-medium">
                    {account.maskedNumber
                      ? t(`missing.${account.kind}`, { digits: account.maskedNumber })
                      : account.name}
                  </span>
                  <span className="ml-2 text-[color:var(--color-caution)]">
                    {t('missing.never')}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <Card padding="lg">
        <ImportForm
          locale={locale}
          accounts={importAccounts.map((account) => ({
            id: account.id,
            name: account.name,
            typeLabel: t(`accountTypes.${account.type}`),
            group: t(`accountGroups.${groupForAccountType(account.type)}`),
            personName: account.personName,
          }))}
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

/**
 * Which heading an account sits under in the import picker.
 *
 * Three groups and not twelve: somebody holding a statement is asking «is this
 * the card or the bank account», and a list split by every type in the schema
 * answers a question they did not ask.
 */
function groupForAccountType(type: string): 'cards' | 'bank' | 'other' {
  if (type === 'credit_card') return 'cards';
  if (type === 'checking' || type === 'savings' || type === 'cash' || type === 'digital_wallet') {
    return 'bank';
  }
  return 'other';
}

/**
 * `2026-08` como «agosto de 2026», en el idioma de quien mira.
 *
 * El nombre y no el número: «te falta 2026-08» obliga a traducir un código
 * mentalmente antes de saber qué buscar en el banco.
 */
function monthName(month: string, locale: string): string {
  const [year = '', index = ''] = month.split('-');
  const date = new Date(Date.UTC(Number(year), Number(index) - 1, 1));
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
