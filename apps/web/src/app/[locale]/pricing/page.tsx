import { formatMoney } from '@app/domain';
import {
  Button,
  EmptyState,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  PageHeader,
  Section,
} from '@app/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { MarketingShell } from '@/components/marketing/site-chrome';
import { Link } from '@/i18n/navigation';
import { listPlans } from '@/server/repositories/plans';

/**
 * Rendered per request rather than at build time.
 *
 * Every word on this page comes out of the database, and a build has no database
 * — CI builds this repository with `SKIP_ENV_VALIDATION`, with no credentials at
 * all. Prerendering would either fail the build or, worse, bake an empty page
 * into the deployment. Caching these at the edge with revalidation is a Phase 21
 * performance item; correctness first.
 */
export const dynamic = 'force-dynamic';

/**
 * Pricing, rendered from the catalogue table.
 *
 * Not a component with prices in it. Every figure and every limit on this page
 * is a row, which is what makes a promotion or a correction an update rather
 * than a deployment — and what stops this page from disagreeing with what a
 * customer is actually charged.
 *
 * The entitlement rows are the same ones the product enforces. A pricing page
 * that lists limits maintained separately from the ones in force is a support
 * ticket waiting to be filed.
 */

const SHOWN: readonly string[] = [
  'household_members',
  'transactions_per_month',
  'document_imports',
  'rules',
  'goals',
  'tax_engine',
  'ai_usage',
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'marketing' });

  return { title: t('pricing.title'), description: t('pricing.detail') };
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const t = await getTranslations('marketing');
  const plans = await listPlans();
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  return (
    <Page>
      <MarketingShell locale={locale}>
        <PageHeader title={t('pricing.title')} detail={t('pricing.detail')} />

        {plans.length === 0 ? (
          <EmptyState title={t('pricing.empty.title')} body={t('pricing.empty.body')} />
        ) : (
          <>
            <Ledger caption={t('pricing.title')}>
              <LedgerHead>
                <LedgerColumn>{t('pricing.columns.plan')}</LedgerColumn>
                {SHOWN.map((key) => (
                  <LedgerColumn key={key} align="end">
                    {t(`pricing.entitlements.${key}`)}
                  </LedgerColumn>
                ))}
                <LedgerColumn align="end">{t('pricing.columns.price')}</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {plans.map((plan) => (
                  <LedgerRow key={plan.code}>
                    <LedgerCell>{plan.name}</LedgerCell>
                    {SHOWN.map((key) => {
                      const entitlement = plan.entitlements.find((entry) => entry.key === key);

                      // Three distinct states, and collapsing any two of them
                      // misinforms: absent from the catalogue, present at zero
                      // ("not included"), and present as null ("unlimited").
                      let cell: string | number;
                      if (!entitlement || entitlement.limit === 0) {
                        cell = t('pricing.notIncluded');
                      } else if (entitlement.limit === null) {
                        cell = t('pricing.unlimited');
                      } else {
                        cell = entitlement.limit;
                      }

                      return (
                        <LedgerCell key={key} align="end" secondary>
                          {cell}
                        </LedgerCell>
                      );
                    })}
                    <LedgerCell align="end">
                      {plan.price.isZero()
                        ? t('pricing.free')
                        : t('pricing.perMonth', {
                            price: formatMoney(plan.price, { locale: moneyLocale }),
                          })}
                    </LedgerCell>
                  </LedgerRow>
                ))}
              </LedgerBody>
            </Ledger>

            <Section title={t('pricing.notes.title')} className="mt-16">
              <ul className="space-y-3">
                {['provisional', 'freeTier', 'noLockIn'].map((key) => (
                  <li
                    key={key}
                    className="max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]"
                  >
                    {t(`pricing.notes.${key}`)}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="" className="mt-16">
              <Link href="/sign-up">
                <Button size="lg">{t('pricing.cta')}</Button>
              </Link>
            </Section>
          </>
        )}
      </MarketingShell>
    </Page>
  );
}
