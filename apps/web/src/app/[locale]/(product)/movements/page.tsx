import { formatMoney, isPlainDate } from '@app/domain';
import {
  Amount,
  Card,
  EmptyState,
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
  Stat,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { MovementFilters } from '@/components/movement-filters';
import { Link } from '@/i18n/navigation';
import { formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadAccountOptions, loadCategories } from '@/server/repositories/administration';
import {
  loadMovements,
  MOVEMENT_STATUSES,
  type MovementFilters as Filters,
  type MovementStatus,
} from '@/server/repositories/movements';
import { requireHousehold } from '@/server/session';

/**
 * The statement the product did not have.
 *
 * A household could import a file, review it, confirm it — and then the
 * movements disappeared inside the system with nowhere to see them, search
 * them, correct a category or exclude one. This is the screen that closes that,
 * and it is the most-used screen in a product of this kind.
 *
 * The filters live in the URL rather than in component state, so a filtered
 * view is a link. The totals above the table are computed over the *filtered*
 * set by a separate aggregate — never by adding up the fifty rows this page
 * happens to show, which would be a number that looks like a total and is not.
 */

const STATUS_TONES: Record<
  MovementStatus,
  'neutral' | 'positive' | 'negative' | 'caution' | 'signal'
> = {
  posted: 'neutral',
  pending: 'caution',
  excluded: 'neutral',
  transfer: 'signal',
  duplicate: 'caution',
  needs_review: 'caution',
  reconciled: 'positive',
};

export default async function MovementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const query = await searchParams;
  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);

  const filters = filtersFrom(query);
  const [view, accounts, categories] = await Promise.all([
    loadMovements(session, session.activeHouseholdId, context.currency, filters),
    loadAccountOptions(session, session.activeHouseholdId),
    loadCategories(session, session.activeHouseholdId),
  ]);

  const t = await getTranslations('movements');

  const hasFilters = Object.entries(query).some(
    ([key, value]) => key !== 'page' && value !== undefined && value !== '',
  );

  return (
    <Page>
      <PageHeader
        title={t('title')}
        detail={t('detail')}
        actions={
          /* Dos acciones y no una. Un gasto sale del mes; un pago además baja
             una deuda, y llamarlos igual hace que el pago se registre como
             gasto — el mes se ve peor de lo que fue y la deuda no se mueve. */
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/movements/new?kind=payment"
              className="text-sm font-medium underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
            >
              {t('addPayment')}
            </Link>
            <Link
              href="/movements/new"
              className="inline-flex h-10 items-center rounded-(--radius-sm) bg-[color:var(--color-brand)] px-4 text-sm font-semibold text-[color:var(--color-brand-contrast,#151d2e)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
            >
              {t('addManual')}
            </Link>
          </div>
        }
      />

      {view.isEmpty ? (
        <Card>
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            action={
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/documents"
                  className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                >
                  {t('empty.import')}
                </Link>
                <Link
                  href="/movements/new"
                  className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                >
                  {t('empty.manual')}
                </Link>
                <Link
                  href="/movements/new?kind=payment"
                  className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                >
                  {t('empty.payment')}
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          {/* The queue that has to reach zero. Announced only when it is not
              empty, because a banner reading «0 pending» is furniture. */}
          {view.uncategorizedCount > 0 && !filters.uncategorized && (
            <div className="mb-8">
              <Problem
                title={t('uncategorizedBanner.title', { count: view.uncategorizedCount })}
                body={t('uncategorizedBanner.body')}
                action={
                  <Link
                    href="/movements?category=none"
                    className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                  >
                    {t('uncategorizedBanner.action')}
                  </Link>
                }
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <Stat label={t('summary.entered')}>
                {formatMoney(view.inflow, { locale: context.moneyLocale })}
              </Stat>
            </Card>
            <Card>
              <Stat label={t('summary.left')}>
                {formatMoney(view.outflow, { locale: context.moneyLocale })}
              </Stat>
            </Card>
            <Card>
              <Stat label={t('summary.shown', { count: view.total })}>
                {view.total === 1 ? t('summary.shownOne') : String(view.total)}
              </Stat>
            </Card>
          </div>

          <Section title={t('filters.title')} className="mt-12">
            <Card>
              <MovementFilters
                currencySymbol={context.currencySymbol}
                hasFilters={hasFilters}
                clearHref={`/${locale}/movements`}
                accounts={accounts.map((account) => ({
                  value: account.id,
                  label: account.name,
                }))}
                categories={categories
                  .filter((category) => !category.isArchived)
                  .map((category) => ({
                    value: category.id,
                    label: `${'— '.repeat(category.depth)}${category.name}`,
                  }))}
                statuses={MOVEMENT_STATUSES.map((status) => ({
                  value: status,
                  label: t(`statuses.${status}`),
                }))}
                current={{
                  q: single(query['q']),
                  account: single(query['account']),
                  category: single(query['category']),
                  from: single(query['from']),
                  to: single(query['to']),
                  min: single(query['min']),
                  max: single(query['max']),
                  direction: single(query['direction']),
                  status: single(query['status']),
                }}
                labels={{
                  query: t('filters.query'),
                  queryHint: t('filters.queryHint'),
                  account: t('filters.account'),
                  allAccounts: t('filters.allAccounts'),
                  category: t('filters.category'),
                  allCategories: t('filters.allCategories'),
                  uncategorized: t('filters.uncategorized'),
                  from: t('filters.from'),
                  to: t('filters.to'),
                  min: t('filters.min'),
                  max: t('filters.max'),
                  direction: t('filters.direction'),
                  allDirections: t('filters.allDirections'),
                  inflow: t('filters.inflow'),
                  outflow: t('filters.outflow'),
                  status: t('filters.status'),
                  allStatuses: t('filters.allStatuses'),
                  apply: t('filters.apply'),
                  clear: t('filters.clear'),
                }}
              />
            </Card>
          </Section>

          <Section className="mt-12">
            {view.rows.length === 0 ? (
              <Card>
                <EmptyState title={t('noResults.title')} body={t('noResults.body')} />
              </Card>
            ) : (
              <Card padding="none">
                <div className="overflow-x-auto">
                  <Ledger caption={t('title')}>
                    <LedgerHead>
                      <LedgerColumn>{t('columns.date')}</LedgerColumn>
                      <LedgerColumn>{t('columns.description')}</LedgerColumn>
                      <LedgerColumn>{t('columns.category')}</LedgerColumn>
                      <LedgerColumn align="end">{t('columns.amount')}</LedgerColumn>
                    </LedgerHead>
                    <LedgerBody>
                      {view.rows.map((row) => (
                        <LedgerRow key={row.id} muted={row.status === 'excluded'}>
                          <LedgerCell>
                            <span className="readout text-xs whitespace-nowrap">
                              {formatPlainDate(row.date, locale)}
                            </span>
                          </LedgerCell>
                          <LedgerCell>
                            <Link
                              href={`/movements/${row.id}`}
                              className="font-medium text-[color:var(--color-ink)] underline decoration-transparent underline-offset-4 hover:decoration-[color:var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
                            >
                              {row.description}
                            </Link>
                            <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-ink-tertiary)]">
                              {row.accountName}
                              {row.status !== 'posted' && (
                                <Status tone={STATUS_TONES[row.status]}>
                                  {t(`statuses.${row.status}`)}
                                </Status>
                              )}
                              {row.splitCount > 0 && (
                                <span>{t('splitBadge', { count: row.splitCount })}</span>
                              )}
                            </span>
                          </LedgerCell>
                          <LedgerCell secondary>
                            {row.categoryName ?? (
                              <span className="text-[color:var(--color-caution)]">
                                {t('noCategory')}
                              </span>
                            )}
                          </LedgerCell>
                          <LedgerCell align="end">
                            {/* The stored amount already carries its sign —
                                the column constrains it — so it is rendered as
                                it is rather than signed a second time. */}
                            <Amount
                              value={row.amount}
                              locale={context.moneyLocale}
                              tone="directional"
                              size="sm"
                            />
                          </LedgerCell>
                        </LedgerRow>
                      ))}
                    </LedgerBody>
                  </Ledger>
                </div>
              </Card>
            )}

            {view.pageCount > 1 && (
              <nav
                aria-label={t('pagination.position', {
                  page: view.page,
                  pages: view.pageCount,
                })}
                className="mt-6 flex items-center justify-between gap-4"
              >
                <PageLink
                  href={pageHref(locale, query, view.page - 1)}
                  disabled={view.page <= 1}
                  label={t('pagination.previous')}
                />
                <span className="readout text-xs text-[color:var(--color-ink-tertiary)]">
                  {t('pagination.position', { page: view.page, pages: view.pageCount })}
                </span>
                <PageLink
                  href={pageHref(locale, query, view.page + 1)}
                  disabled={view.page >= view.pageCount}
                  label={t('pagination.next')}
                />
              </nav>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  readonly href: string;
  readonly disabled: boolean;
  readonly label: string;
}) {
  if (disabled) {
    return <span className="text-sm text-[color:var(--color-ink-tertiary)]">{label}</span>;
  }
  return (
    <a
      href={href}
      className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
    >
      {label}
    </a>
  );
}

function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function pageHref(
  locale: string,
  query: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === 'page') continue;
    const one = single(value);
    if (one !== '') params.set(key, one);
  }
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search === '' ? `/${locale}/movements` : `/${locale}/movements?${search}`;
}

/**
 * Query string to predicate.
 *
 * Anything unreadable is dropped rather than rejected. A filter is a view, not
 * a transaction: a mistyped date in a URL somebody pasted should show the
 * unfiltered ledger, not an error page.
 */
function filtersFrom(query: Record<string, string | string[] | undefined>): Filters {
  const q = single(query['q']).trim();
  const account = single(query['account']);
  const category = single(query['category']);
  const from = single(query['from']);
  const to = single(query['to']);
  const min = single(query['min']);
  const max = single(query['max']);
  const direction = single(query['direction']);
  const status = single(query['status']);
  const page = Number.parseInt(single(query['page']), 10);

  const decimal = /^\d+(\.\d{1,4})?$/;

  return {
    ...(q === '' ? {} : { query: q }),
    ...(isUuid(account) ? { accountId: account } : {}),
    ...(category === 'none'
      ? { uncategorized: true }
      : isUuid(category)
        ? { categoryId: category }
        : {}),
    ...(isPlainDate(from) ? { from } : {}),
    ...(isPlainDate(to) ? { to } : {}),
    ...(decimal.test(min) ? { min } : {}),
    ...(decimal.test(max) ? { max } : {}),
    ...(direction === 'inflow' || direction === 'outflow' ? { direction } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(Number.isFinite(page) && page > 1 ? { page } : {}),
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isStatus(value: string): value is MovementStatus {
  return (MOVEMENT_STATUSES as readonly string[]).includes(value);
}
