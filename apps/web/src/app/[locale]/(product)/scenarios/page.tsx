import { formatMoney } from '@app/domain';
import { Card, EmptyState, Page, PageHeader, Section, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { Link } from '@/i18n/navigation';
import { formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadBaseline } from '@/server/repositories/baseline';
import { compareScenario, loadScenarios } from '@/server/repositories/projection';
import { createScenario, removeScenario, updateScenario } from '@/server/scenario-actions';
import { requireHousehold } from '@/server/session';

/**
 * «What happens if…», answered arithmetically.
 *
 * Each scenario is stored as its *changes* and recomputed from today's position
 * every time this screen opens — the opposite of an accepted plan, which is a
 * decision and must not move. A scenario is a question, and the answer depends
 * on where the household is now.
 *
 * Every result is shown against doing nothing, because a projection alone
 * invites a question nobody can answer: «is $3,000 in eighteen months good?»
 * Against the do-nothing case it becomes the question the household actually
 * has, which is what this decision costs.
 */
export default async function ScenariosPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);

  const [{ baseline, hasData }, stored] = await Promise.all([
    loadBaseline(session, session.activeHouseholdId, context.currency, context.today),
    loadScenarios(session, session.activeHouseholdId),
  ]);

  const t = await getTranslations('scenarios');
  const shared = await getTranslations('records');

  const KINDS = [
    'rent_increase',
    'income_loss',
    'child',
    'move',
    'vehicle_purchase',
    'job_change',
    'marriage',
    'bonus',
    'vacation',
    'debt_payoff',
  ] as const;

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('form.name'), hint: t('form.nameHint'), required: true },
    {
      kind: 'select',
      name: 'kind',
      label: t('form.kind'),
      half: true,
      options: KINDS.map((value) => ({ value, label: t(`kinds.${value}`) })),
    },
    {
      kind: 'integer',
      name: 'horizonMonths',
      label: t('form.horizon'),
      hint: t('form.horizonHint'),
      min: 1,
      max: 600,
      half: true,
      placeholder: '60',
    },
    {
      kind: 'text',
      name: 'label',
      label: t('form.label'),
      hint: t('form.labelHint'),
      required: true,
    },
    {
      kind: 'integer',
      name: 'startsInMonths',
      label: t('form.starts'),
      hint: t('form.startsHint'),
      min: 0,
      max: 600,
      half: true,
      placeholder: '0',
    },
    {
      kind: 'integer',
      name: 'durationMonths',
      label: t('form.duration'),
      hint: t('form.durationHint'),
      min: 1,
      max: 600,
      half: true,
    },
    { kind: 'money', name: 'monthlyExpenseDelta', label: t('form.monthlyExpense'), half: true },
    { kind: 'money', name: 'monthlyIncomeDelta', label: t('form.monthlyIncome'), half: true },
    { kind: 'money', name: 'oneTimeCost', label: t('form.oneTime'), half: true },
  ];

  const rows: readonly RecordRow[] = stored.map((scenario) => {
    const change = scenario.changes[0];

    return {
      id: scenario.id,
      title: scenario.name,
      subtitle: [
        t(`kinds.${scenario.kind}`),
        t('over', { count: scenario.horizonMonths }),
        ...(change ? [change.label] : []),
      ].join(' · '),
      values: {
        name: scenario.name,
        kind: scenario.kind,
        horizonMonths: String(scenario.horizonMonths),
        label: change?.label ?? '',
        startsInMonths: String(change?.startsInMonths ?? 0),
        durationMonths: change?.durationMonths === null ? '' : String(change?.durationMonths ?? ''),
        oneTimeCost: change?.oneTimeCost ?? '',
        monthlyExpenseDelta: change?.monthlyExpenseDelta ?? '',
        monthlyIncomeDelta: change?.monthlyIncomeDelta ?? '',
      },
    };
  });

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {!hasData ? (
        <Card>
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            action={
              <Link
                href="/income"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('empty.title')}
              </Link>
            }
          />
        </Card>
      ) : (
        <Section title={t('result.title')} detail={t('result.detail')}>
          {stored.length === 0 ? (
            <Card>
              <EmptyState title={t('empty.title')} body={t('empty.body')} />
            </Card>
          ) : (
            <ul className="flex flex-col gap-4">
              {stored.map((scenario) => {
                const comparison = compareScenario(baseline, scenario, context.currency);

                return (
                  <li key={scenario.id}>
                    <Card>
                      <p className="font-medium text-[color:var(--color-ink)]">{scenario.name}</p>
                      <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
                        {t(`kinds.${scenario.kind}`)} ·{' '}
                        {t('over', { count: scenario.horizonMonths })}
                      </p>

                      <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <Delta
                          label={t('result.liquid')}
                          value={formatMoney(comparison.liquidDelta, {
                            locale: context.moneyLocale,
                          })}
                        />
                        <Delta
                          label={t('result.debt')}
                          value={formatMoney(comparison.debtDelta, {
                            locale: context.moneyLocale,
                          })}
                        />
                        <Delta
                          label={t('result.netWorth')}
                          value={formatMoney(comparison.netWorthDelta, {
                            locale: context.moneyLocale,
                          })}
                        />
                        <Delta
                          label={t('result.interest')}
                          value={formatMoney(comparison.interestDelta, {
                            locale: context.moneyLocale,
                          })}
                        />
                      </dl>

                      <p className="mt-4 flex flex-wrap gap-3">
                        <Status
                          tone={
                            comparison.runwayDeltaMonths === null ||
                            comparison.runwayDeltaMonths === 0
                              ? 'neutral'
                              : comparison.runwayDeltaMonths < 0
                                ? 'negative'
                                : 'positive'
                          }
                        >
                          {comparison.runwayDeltaMonths === null ||
                          comparison.runwayDeltaMonths === 0
                            ? t('result.runwaySame')
                            : comparison.runwayDeltaMonths < 0
                              ? t('result.runwayShorter', {
                                  count: Math.abs(comparison.runwayDeltaMonths),
                                })
                              : t('result.runwayLonger', {
                                  count: comparison.runwayDeltaMonths,
                                })}
                        </Status>

                        {comparison.scenario.firstShortfallMonth ? (
                          <Status tone="negative">
                            {t('result.shortfall', {
                              date: formatPlainDate(
                                comparison.scenario.firstShortfallMonth,
                                locale,
                              ),
                            })}
                          </Status>
                        ) : (
                          <Status tone="positive">{t('result.noShortfall')}</Status>
                        )}
                      </p>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-6 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('result.horizonNote')}
          </p>
        </Section>
      )}

      <Section title={t('list.title')} detail={t('list.detail')} className="mt-12">
        <Card>
          <RecordsManager
            locale={locale}
            currencySymbol={context.currencySymbol}
            rows={rows}
            fields={fields}
            create={createScenario}
            update={updateScenario}
            remove={removeScenario}
            labels={recordLabels(shared, {
              addAction: t('add'),
              addTitle: t('addTitle'),
              submitCreate: t('submitCreate'),
              submitUpdate: t('submitUpdate'),
              emptyTitle: t('empty.title'),
              emptyBody: t('empty.body'),
              removeConfirm: t('removeConfirm'),
            })}
          />
        </Card>
      </Section>
    </Page>
  );
}

function Delta({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase">{label}</dt>
      <dd className="readout mt-0.5 text-[color:var(--color-ink)] tabular-nums">{value}</dd>
    </div>
  );
}
