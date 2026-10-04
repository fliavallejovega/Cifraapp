import { Amount } from '@app/ui';
import { Money } from '@app/domain';
import { getTranslations } from 'next-intl/server';

import { formatPlainDate } from '@/lib/format';
import type { PendingAccount } from '@/server/repositories/pending-summary';

import { SummaryDetail, type DetailLine } from './summary-detail';

/**
 * Before «Guardar»: per account, how much comes in and how much goes out, in
 * two figures. The lines themselves wait behind one tap, split into money in
 * and money out — the summary answers the question, the detail lets it be
 * checked.
 */
export async function PendingSummary({
  accounts,
  locale,
}: {
  readonly accounts: readonly PendingAccount[];
  readonly locale: string;
}) {
  const t = await getTranslations('saveAll.summary');

  return (
    <ul className="flex list-none flex-col gap-4 p-0">
      {accounts.map((account) => {
        const currency = account.currency === 'PAB' ? 'PAB' : 'USD';
        const money = (value: string) => Money.fromDecimalString(value, currency);
        const toLine = (line: PendingAccount['lines'][number], index: number): DetailLine => ({
          key: `${line.date}-${line.amount}-${String(index)}`,
          description: line.description,
          date: formatPlainDate(line.date, locale),
          note: line.paysCard ? t('paysCard', { card: line.paysCard }) : null,
          amount: <Amount value={money(line.amount)} size="sm" tone="directional" />,
        });
        const inflows = account.lines.filter((line) => !line.amount.startsWith('-')).map(toLine);
        const outflows = account.lines.filter((line) => line.amount.startsWith('-')).map(toLine);
        return (
          <li
            key={account.accountId}
            className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] pt-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                {[account.name, account.maskedNumber].filter(Boolean).join(' · ')}
              </h3>
              <span className="shrink-0 text-xs text-[color:var(--color-ink-secondary)]">
                {t('files', { count: account.files })}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Figure
                label={t('inflow', { count: account.inflow.count })}
                value={<Amount value={money(account.inflow.total)} size="md" tone="directional" />}
              />
              <Figure
                label={t('outflow', { count: account.outflow.count })}
                value={<Amount value={money(account.outflow.total)} size="md" />}
              />
            </div>

            {account.cardPayments.count > 0 && (
              <p className="text-xs text-[color:var(--color-ink-secondary)]">
                {t('cardPayments', { count: account.cardPayments.count })}{' '}
                <Amount value={money(account.cardPayments.total)} size="sm" tone="plain" />
              </p>
            )}
            {account.skipped > 0 && (
              <p className="text-xs text-[color:var(--color-ink-secondary)]">
                {t('skipped', { count: account.skipped })}
              </p>
            )}

            {account.lines.length > 0 && (
              <SummaryDetail
                inflows={inflows}
                outflows={outflows}
                labels={{
                  open: t('seeDetail'),
                  close: t('hideDetail'),
                  inflow: t('inflowTab', { count: inflows.length }),
                  outflow: t('outflowTab', { count: outflows.length }),
                  empty: t('emptyTab'),
                }}
                totals={{
                  inflow: (
                    <Amount value={money(account.inflow.total)} size="sm" tone="directional" />
                  ),
                  outflow: <Amount value={money(account.outflow.total)} size="sm" />,
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Figure({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-(--radius-sm) bg-[color:var(--color-ground)] px-3 py-2">
      <span className="text-xs text-[color:var(--color-ink-secondary)]">{label}</span>
      <span className="[overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}
