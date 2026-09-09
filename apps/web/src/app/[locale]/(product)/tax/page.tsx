import { Card, Page, PageHeader, Problem, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SingleForm } from '@/components/records';
import type { FieldSpec } from '@/components/records/spec';
import { Link } from '@/i18n/navigation';
import { loadHouseholdContext } from '@/server/household-context';
import { Prose } from '@/components/marketing/prose';
import { loadLegalDocument } from '@/server/repositories/content';
import { loadTaxProfile } from '@/server/repositories/tax-profile';
import { saveTaxProfile } from '@/server/tax-actions';
import { requireHousehold } from '@/server/session';

/**
 * The independent's tax profile.
 *
 * This is the one screen in the product that records a household's details and
 * shows them no figure computed from them, and the reason is stated at the top
 * rather than buried: the Panama 2026 rule set loaded here is a draft nobody
 * qualified has reviewed.
 *
 * Storing the profile is still worth doing — it is what a published rule set
 * would compute against the day one exists. Showing an estimate from an
 * unreviewed rule would be the single most damaging thing this product could
 * do: a wrong balance is embarrassing, a wrong tax figure is a fine somebody
 * pays.
 */
export default async function TaxPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const profile = await loadTaxProfile(session, session.activeHouseholdId);

  const t = await getTranslations('tax');
  // What this product is, stated where the tax figures are read. Fetched
  // alongside the rest rather than after it: it is furniture on this screen,
  // not a late addition, and a disclaimer that arrives second is one somebody
  // can act before seeing.
  const disclaimer = await loadLegalDocument('tax_disclaimer', locale);
  const shared = await getTranslations('records');
  const errors: unknown = shared.raw('errors');

  const fields: readonly FieldSpec[] = [
    {
      kind: 'select',
      name: 'taxpayerStatus',
      label: t('form.status'),
      options: (
        [
          'salaried',
          'independent_professional',
          'freelancer',
          'merchant',
          'mixed_income',
          'personal_business',
        ] as const
      ).map((value) => ({ value, label: t(`statuses.${value}`) })),
    },
    { kind: 'text', name: 'ruc', label: t('form.ruc'), hint: t('form.rucHint'), half: true },
    {
      kind: 'text',
      name: 'activity',
      label: t('form.activity'),
      hint: t('form.activityHint'),
      half: true,
    },
    {
      kind: 'select',
      name: 'accountingMethod',
      label: t('form.method'),
      hint: t('form.methodHint'),
      half: true,
      options: (['cash', 'accrual'] as const).map((value) => ({
        value,
        label: t(`methods.${value}`),
      })),
    },
    {
      kind: 'text',
      name: 'fiscalYearStart',
      label: t('form.fiscalYear'),
      hint: t('form.fiscalYearHint'),
      half: true,
      placeholder: '01-01',
    },
    {
      kind: 'toggle',
      name: 'itbmsRegistered',
      label: t('form.itbms'),
      toggleLabel: t('form.itbms'),
    },
  ];

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <div className="mb-8">
        <Problem title={t('draftWarning.title')} body={t('draftWarning.body')} />
      </div>

      {/* The standing disclaimer, beside the one about this particular rule
          set. Two different statements: the warning above is about Panama 2026
          being unreviewed and will go away when a Panamanian accountant signs
          it off; this one is about what this product is, and never will.
          It comes from the same versioned store as the terms, so the wording
          can be corrected without a deployment and every version is kept. */}
      {disclaimer && (
        <aside
          aria-labelledby="tax-disclaimer"
          className="mb-10 border-l border-[color:var(--color-rule-strong)] bg-[color:var(--color-ground-sunk)] px-5 py-4"
        >
          <h2
            id="tax-disclaimer"
            className="text-sm font-medium tracking-(--tracking-label) text-[color:var(--color-ink)] uppercase"
          >
            {disclaimer.title}
          </h2>
          <div className="mt-3 text-sm">
            <Prose body={disclaimer.body} />
          </div>
        </aside>
      )}

      <Card>
        <SingleForm
          locale={locale}
          fields={fields}
          currencySymbol={context.currencySymbol}
          action={saveTaxProfile}
          values={{
            taxpayerStatus: profile?.taxpayerStatus ?? 'salaried',
            ruc: profile?.ruc ?? '',
            activity: profile?.activity ?? '',
            accountingMethod: profile?.accountingMethod ?? 'cash',
            fiscalYearStart: profile?.fiscalYearStart ?? '01-01',
            itbmsRegistered: String(profile?.itbmsRegistered ?? false),
          }}
          labels={{
            submit: t('form.submit'),
            saved: t('form.saved'),
            errorTitle: shared('errorTitle'),
            errors: isStringRecord(errors) ? errors : {},
          }}
        />
      </Card>

      <Section title={t('reserve.title')} detail={t('reserve.detail')} className="mt-12">
        <Card>
          <Link
            href="/tax/reserve"
            className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
          >
            {t('reserve.open')}
          </Link>
        </Card>
      </Section>
    </Page>
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
