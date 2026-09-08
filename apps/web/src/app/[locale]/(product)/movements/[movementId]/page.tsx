import { Amount, Card, EmptyState, Page, PageHeader, Provenance, Section, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { MovementEditor } from '@/components/movement-editor';
import { Link } from '@/i18n/navigation';
import { formatMoment, formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadCategories, loadPeople } from '@/server/repositories/administration';
import { loadMovement } from '@/server/repositories/movements';
import { requireHousehold } from '@/server/session';

/**
 * One movement, and everything that can be said about it.
 *
 * The history at the bottom is the part that justifies the screen. A category
 * the copilot chose, corrected by a person, corrected again by a rule — the
 * transaction row holds only the last of those, and without the log a household
 * cannot see that the figure moved, who moved it, or on what grounds. That is
 * the difference between a system that explains itself and one that asks to be
 * trusted.
 */

const SOURCE_KINDS = new Set(['system', 'user', 'ai', 'accountant', 'imported', 'rule']);

export default async function MovementPage({
  params,
}: {
  params: Promise<{ locale: string; movementId: string }>;
}) {
  const { locale, movementId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);

  const t = await getTranslations('movement');
  const shared = await getTranslations('records');
  const listLabels = await getTranslations('movements');

  const detail = await loadMovement(
    session,
    session.activeHouseholdId,
    movementId,
    context.currency,
  );

  if (!detail) {
    return (
      <Page>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState
            title={t('notFound.title')}
            body={t('notFound.body')}
            action={
              <Link
                href="/movements"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('notFound.action')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  const { movement, splits, history } = detail;
  const [categories, people] = await Promise.all([
    loadCategories(session, session.activeHouseholdId),
    loadPeople(session, session.activeHouseholdId),
  ]);

  const errors: unknown = shared.raw('errors');

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/movements"
          className="text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)]"
        >
          {t('backToList')}
        </Link>
      </div>

      <PageHeader
        title={movement.description}
        {...(movement.originalDescription === movement.description
          ? {}
          : { detail: `${t('original')}: ${movement.originalDescription}` })}
      />

      <Card>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Fact label={t('facts.date')} value={formatPlainDate(movement.date, locale)} />
            <Fact label={t('facts.account')} value={movement.accountName} />
            {movement.merchantName && (
              <Fact label={t('facts.merchant')} value={movement.merchantName} />
            )}
            <Fact label={t('facts.source')} value={t(`sources.${movement.source}`)} />
            <Fact label={t('facts.status')} value={listLabels(`statuses.${movement.status}`)} />
          </dl>

          <div className="shrink-0 text-right">
            {/* The column constrains the sign to match the direction, so
                the amount is shown as stored. */}
            <Amount
              value={movement.amount}
              locale={context.moneyLocale}
              tone="directional"
              size="lg"
            />
            {movement.categoryName ? (
              <p className="mt-2 text-sm text-[color:var(--color-ink-secondary)]">
                {movement.categoryName}
              </p>
            ) : (
              <p className="mt-2">
                <Status tone="caution">{listLabels('noCategory')}</Status>
              </p>
            )}
            {movement.categorySource && SOURCE_KINDS.has(movement.categorySource) && (
              <div className="mt-2 flex justify-end">
                <Provenance
                  source={
                    movement.categorySource as
                      'system' | 'user' | 'ai' | 'accountant' | 'imported' | 'rule'
                  }
                  label={sourceLabel(movement.categorySource, t)}
                  {...(movement.categoryConfidence === null
                    ? {}
                    : {
                        confidence: confidenceBand(movement.categoryConfidence),
                        confidenceLabel: t('category.confidence', {
                          percent: Math.round(movement.categoryConfidence * 100),
                        }),
                      })}
                />
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="mt-12">
        <MovementEditor
          locale={locale}
          movementId={movement.id}
          currencySymbol={context.currencySymbol}
          amount={movement.amount.abs().toDecimalString()}
          categoryId={movement.categoryId}
          notes={movement.notes}
          status={movement.status}
          canRemove={movement.source === 'user'}
          categories={categories
            .filter((category) => !category.isArchived)
            .map((category) => ({
              value: category.id,
              label: `${'— '.repeat(category.depth)}${category.name}`,
            }))}
          people={people.map((person) => ({ value: person.id, label: person.displayName }))}
          splits={splits.map((split) => ({
            amount: split.amount.toDecimalString(),
            categoryId: split.categoryId,
            personId: split.personId,
            note: split.note,
          }))}
          labels={{
            category: {
              title: t('category.title'),
              detail: t('category.detail'),
              field: t('category.field'),
              none: t('category.none'),
              save: t('category.save'),
              saved: t('category.saved'),
            },
            splits: {
              title: t('splits.title'),
              detail: t('splits.detail'),
              amount: t('splits.amount'),
              category: t('splits.category'),
              person: t('splits.person'),
              anyone: t('splits.anyone'),
              note: t('splits.note'),
              add: t('splits.add'),
              removeLine: t('splits.removeLine'),
              save: t('splits.save'),
              clear: t('splits.clear'),
              remaining: rawOf(t)('splits.remaining'),
              over: rawOf(t)('splits.over'),
              balanced: t('splits.balanced'),
              empty: t('splits.empty'),
              start: t('splits.start'),
            },
            note: {
              title: t('note.title'),
              detail: t('note.detail'),
              field: t('note.field'),
              save: t('note.save'),
            },
            status: {
              title: t('status.title'),
              detail: t('status.detail'),
              exclude: t('status.exclude'),
              include: t('status.include'),
              markTransfer: t('status.markTransfer'),
              excluded: t('status.excluded'),
            },
            remove: {
              title: t('remove.title'),
              detail: t('remove.detail'),
              action: t('remove.action'),
              confirm: t('remove.confirm'),
              confirmYes: t('remove.confirmYes'),
            },
            cancel: shared('cancel'),
            errorTitle: shared('errorTitle'),
            errors: isStringRecord(errors) ? errors : {},
            noCategory: listLabels('noCategory'),
          }}
        />
      </div>

      <Section title={t('history.title')} detail={t('history.detail')} className="mt-12">
        <Card>
          {history.length === 0 ? (
            <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('history.empty')}</p>
          ) : (
            <ol className="flex flex-col">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="border-b border-[color:var(--color-rule)] py-4 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <p className="text-sm text-[color:var(--color-ink)]">
                    {entry.from === null
                      ? t('history.fromNone')
                      : t('history.from', { name: entry.from })}{' '}
                    {entry.to === null ? t('history.toNone') : t('history.to', { name: entry.to })}
                    {entry.actor && ` · ${t('history.by', { actor: entry.actor })}`}
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--color-ink-tertiary)]">
                    <span className="readout">
                      {formatMoment(entry.at, locale, context.timeZone)}
                    </span>
                    {' · '}
                    {entry.reason}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </Section>
    </Page>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase">{label}</dt>
      <dd className="mt-0.5 text-[color:var(--color-ink)]">{value}</dd>
    </div>
  );
}

function sourceLabel(source: string, t: (key: string) => string): string {
  if (source === 'user') return t('category.byUser');
  if (source === 'ai') return t('category.byAi');
  if (source === 'rule') return t('category.byRule');
  return t('category.bySystem');
}

/** The bands the provenance mark understands, from a stored probability. */
function confidenceBand(value: number): 'high' | 'medium' | 'low' {
  if (value >= 0.85) return 'high';
  if (value >= 0.6) return 'medium';
  return 'low';
}

/**
 * A message whose placeholder is filled in the browser from client state the
 * server never had. `t()` would try to resolve it here and throw; the template
 * has to travel whole.
 */
function rawOf(t: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = t.raw(key);
    return typeof value === 'string' ? value : '';
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
