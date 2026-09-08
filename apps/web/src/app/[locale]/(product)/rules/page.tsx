import { FACT_CATALOGUE } from '@app/rule-engine';
import { Card, Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadRules } from '@/server/repositories/administration';
import { createRule, removeRule, updateRule } from '@/server/rule-actions';
import { requireHousehold } from '@/server/session';

/**
 * «When this is true, do that.»
 *
 * The rule engine has been able to evaluate these since Phase 8 and there was
 * no way to write one. This is deliberately not a text box: a rule is
 * structured data, a condition can only compare a fact from the catalogue
 * against a literal, and nothing a household writes is ever executed.
 *
 * The fact list *is* the sandbox. It is printed at the bottom of the screen
 * rather than hidden in a dropdown, because a household that can see the
 * complete list of things a rule may look at can also see that a rule cannot
 * look at anything else.
 */
export default async function RulesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const rules = await loadRules(session, session.activeHouseholdId);

  const t = await getTranslations('rules');
  const shared = await getTranslations('records');

  const facts = Object.keys(FACT_CATALOGUE);

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('form.name'), hint: t('form.nameHint'), required: true },
    {
      kind: 'note',
      name: 'explanation',
      label: t('form.explanation'),
      hint: t('form.explanationHint'),
      required: true,
      maxLength: 400,
    },
    {
      kind: 'select',
      name: 'fact',
      label: t('form.fact'),
      hint: t('form.factHint'),
      required: true,
      options: facts.map((fact) => ({ value: fact, label: fact })),
    },
    {
      kind: 'select',
      name: 'operator',
      label: t('form.operator'),
      half: true,
      options: (['gte', 'gt', 'lte', 'lt', 'eq', 'neq', 'contains', 'in'] as const).map(
        (value) => ({ value, label: t(`operators.${value}`) }),
      ),
    },
    { kind: 'text', name: 'value', label: t('form.value'), required: true, half: true },
    {
      kind: 'select',
      name: 'actionType',
      label: t('form.actionType'),
      half: true,
      options: (['allocate_percentage', 'allocate_amount', 'set_priority'] as const).map(
        (value) => ({ value, label: t(`actions.${value}`) }),
      ),
    },
    {
      kind: 'text',
      name: 'target',
      label: t('form.target'),
      hint: t('form.targetHint'),
      required: true,
      half: true,
    },
    {
      kind: 'text',
      name: 'actionValue',
      label: t('form.actionValue'),
      hint: t('form.actionValueHint'),
      half: true,
    },
    {
      kind: 'integer',
      name: 'priority',
      label: t('form.priority'),
      hint: t('form.priorityHint'),
      min: 1,
      max: 1000,
      half: true,
      placeholder: '100',
    },
    { kind: 'date', name: 'effectiveFrom', label: t('form.from'), half: true },
    { kind: 'date', name: 'effectiveTo', label: t('form.to'), half: true },
  ];

  const rows: readonly RecordRow[] = rules.map((rule) => ({
    id: rule.id,
    title: rule.name,
    subtitle: [
      `${rule.fact} ${t(`operators.${rule.operator}`)} ${rule.value}`,
      `${t(`actions.${rule.actionType}`)} · ${rule.target}`,
      t('row.priority', { priority: rule.priority }),
    ].join(' · '),
    badges: rule.isActive ? [] : [{ label: t('row.inactive'), tone: 'neutral' as const }],
    muted: !rule.isActive,
    values: {
      name: rule.name,
      explanation: rule.explanation,
      fact: rule.fact,
      operator: rule.operator,
      value: rule.value,
      actionType: rule.actionType,
      target: rule.target,
      actionValue: rule.actionValue,
      priority: String(rule.priority),
      effectiveFrom: rule.effectiveFrom ?? '',
      effectiveTo: rule.effectiveTo ?? '',
    },
  }));

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <Section title={t('list.title')} detail={t('list.detail')}>
        <Card>
          <RecordsManager
            locale={locale}
            currencySymbol={context.currencySymbol}
            rows={rows}
            fields={fields}
            create={createRule}
            update={updateRule}
            remove={removeRule}
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

      <Section className="mt-12">
        <Card tone="sunk">
          <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('factsNote')}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {facts.map((fact) => (
              <li
                key={fact}
                className="rounded-(--radius-sm) bg-[color:var(--color-surface)] px-2 py-1 font-(family-name:--font-mono) text-xs text-[color:var(--color-ink-secondary)]"
              >
                {fact}
              </li>
            ))}
          </ul>
        </Card>
      </Section>
    </Page>
  );
}
