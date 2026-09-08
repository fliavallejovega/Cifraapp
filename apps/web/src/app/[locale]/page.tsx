import { Money, formatMoney, type MoneyLocale } from '@app/domain';
import {
  Amount,
  Button,
  Card,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  Provenance,
  Rule,
  Section,
  Status,
} from '@app/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { MarketingShell } from '@/components/marketing/site-chrome';
import { TryIt } from '@/components/marketing/try-it';
import { Link } from '@/i18n/navigation';
import { absoluteUrl, faqStructuredData, landingMetadata, productStructuredData } from '@/lib/seo';
import { listFaqs } from '@/server/repositories/content';
import { listPlans, type PublicPlan } from '@/server/repositories/plans';
import { loadSession } from '@/server/session';

/**
 * The home page, built to sell.
 *
 * It gives before it asks. The first thing under the headline is the product's
 * own arithmetic, running on numbers the visitor can change, with no account.
 * Then each thing the product does is shown as the product — its own
 * components, on demonstration data — rather than described or screenshotted.
 * Sign-up is the way to keep what was built on the page.
 *
 * **Everything on this page is either real or labelled.** The demonstration
 * household is one set of figures, consistent across every device: the $1,245
 * the hero calculator shows is the $1,245 the assistant quotes. The prices
 * and limits come out of the database. There are still no testimonials,
 * logos or ratings, because there are still none to show; see
 * `docs/landing.md` for what the page deliberately leaves out.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });
  const common = await getTranslations({ locale, namespace: 'common' });

  return landingMetadata({
    locale,
    siteName: common('appName'),
    title: t('seoTitle'),
    description: t('seoDescription'),
    keywords: t('keywords')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  });
}

/** The one household every device on this page describes. */
const DEMO = {
  balance: '4180.00',
  rent: '1200.00',
  cardMinimum: '185.00',
  electricity: '142.00',
  taxReserve: '608.00',
  buffer: '800.00',
  income: '2600.00',
  extraToDebt: '300.00',
  emergencyFund: '165.00',
  cardBalance: '1850.00',
  invoice: '1800.00',
  invoiceReserve: '216.00',
  goalTarget: '12000.00',
  goalCurrent: '1000.00',
  goalMonths: 48,
} as const;

/**
 * Debt outcomes, from an amortization of three debts — a $1,850 card at 26%,
 * a $6,400 loan at 14%, a $900 interest-free family loan — with $300 extra a
 * month, computed offline with the same monthly-interest rule the debt engine
 * uses. Authored as constants so the page does no arithmetic at request time.
 */
const DEBT_OUTCOMES = [
  { key: 'avalanche', months: 14, interest: '734.66' },
  { key: 'snowball', months: 14, interest: '845.73' },
  { key: 'minimums', months: 24, interest: '1402.07' },
] as const;

/** From `@app/investment-engine`, for the goal above, at each level's expected band. */
const GOAL_CONTRIBUTIONS = [
  { key: 'cash', monthly: '218.73' },
  { key: 'conservative', monthly: '208.40' },
  { key: 'balanced', monthly: '198.35' },
  { key: 'growth', monthly: '188.57' },
] as const;

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const [session, plans, faqs] = await Promise.all([loadSession(), listPlans(), listFaqs(locale)]);

  // A signed-in person never sees marketing. They came to look at their money.
  if (session) {
    redirect(`/${locale}${session.activeHouseholdId ? '/overview' : '/welcome'}`);
  }

  const t = await getTranslations('landing');
  const marketing = await getTranslations('marketing');
  const common = await getTranslations('common');

  const moneyLocale: MoneyLocale = locale === 'en' ? 'en-US' : 'es-PA';
  const usd = (value: string) => Money.fromDecimalString(value, 'USD');
  const money = (value: Money) => formatMoney(value, { locale: moneyLocale });

  const freePlan = plans.find((plan) => plan.price.isZero());
  const paidPlans = plans.filter((plan) => plan.price.isPositive());
  const cheapestPaid = paidPlans[0];
  const dearestPaid = paidPlans[paidPlans.length - 1];
  const freeMovements = freePlan?.entitlements.find(
    (entry) => entry.key === 'transactions_per_month',
  )?.limit;

  const committed = Money.sum(
    [usd(DEMO.rent), usd(DEMO.cardMinimum), usd(DEMO.electricity), usd(DEMO.taxReserve)],
    'USD',
  );
  const available = usd(DEMO.balance).subtract(committed).subtract(usd(DEMO.buffer));
  const cardAfter = usd(DEMO.cardBalance)
    .subtract(usd(DEMO.cardMinimum))
    .subtract(usd(DEMO.extraToDebt));

  const planLines = [
    { key: 'rent', amount: usd(DEMO.rent) },
    { key: 'card', amount: usd(DEMO.cardMinimum) },
    { key: 'electricity', amount: usd(DEMO.electricity) },
    { key: 'tax', amount: usd(DEMO.taxReserve) },
    { key: 'debt', amount: usd(DEMO.extraToDebt) },
    { key: 'goal', amount: usd(DEMO.emergencyFund) },
  ] as const;

  const minimumsOnly = DEBT_OUTCOMES[2];
  const avalanche = DEBT_OUTCOMES[0];

  const faqJson = faqStructuredData(faqs);

  return (
    <Page>
      <MarketingShell locale={locale}>
        {/* 1. The claim. */}
        <section className="mb-24">
          <h1
            className="max-w-[20ch] text-4xl font-medium text-balance sm:text-6xl"
            style={{ letterSpacing: 'var(--tracking-display)', lineHeight: 1.05 }}
          >
            {t('headline')}
          </h1>

          <p className="mt-6 max-w-[56ch] text-lg text-pretty text-[color:var(--color-ink-secondary)]">
            {t('subheadline')}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-6">
            <Link href="/sign-up">
              <Button size="lg">{t('primaryCta')}</Button>
            </Link>
            <a
              href="#try"
              className="text-sm underline underline-offset-4 transition-opacity duration-(--duration-quick) hover:opacity-60"
            >
              {t('tryCta')}
            </a>
          </div>

          {freeMovements != null && (
            <p className="mt-6 max-w-[62ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
              {t('proof', { transactions: freeMovements })}
            </p>
          )}
        </section>

        {/* 2. The product, before the account. */}
        <Section
          title={marketing('home.try.title')}
          detail={marketing('home.try.detail')}
          className="scroll-mt-8"
        >
          <div id="try" className="mt-8">
            <TryIt
              locale={moneyLocale}
              defaults={{
                balance: DEMO.balance,
                rent: DEMO.rent,
                minimums: DEMO.cardMinimum,
                other: usd(DEMO.electricity).add(usd(DEMO.taxReserve)).toDecimalString(),
                buffer: DEMO.buffer,
              }}
              labels={{
                balance: marketing('home.try.balance'),
                rent: marketing('home.try.rent'),
                minimums: marketing('home.try.minimums'),
                other: marketing('home.try.other'),
                otherHint: marketing('home.try.otherHint'),
                buffer: marketing('home.try.buffer'),
                gaugeLabel: marketing('home.try.gaugeLabel'),
                bufferMark: marketing('home.try.bufferMark'),
                surfaceMark: marketing('home.try.surfaceMark'),
                available: marketing('home.try.available'),
                availableDetail: marketing.raw('home.try.availableDetail') as string,
                short: marketing.raw('home.try.short') as string,
                shortDetail: marketing('home.try.shortDetail'),
                orderTitle: marketing('home.try.orderTitle'),
                covered: marketing('home.try.covered'),
                partial: marketing.raw('home.try.partial') as string,
                pending: marketing('home.try.pending'),
                free: marketing('home.try.free'),
                cta: marketing('home.try.cta'),
                ctaHint: marketing('home.try.ctaHint'),
              }}
            />
          </div>
        </Section>

        {/* 3. Six capabilities, each as the product. */}
        <Section
          title={marketing('home.capabilities.title')}
          detail={marketing('home.capabilities.detail')}
          className="mt-24"
        >
          <div className="mt-3 flex items-baseline gap-3">
            <Status tone="neutral">{marketing('demo.label')}</Status>
            <span className="text-xs text-[color:var(--color-ink-tertiary)]">
              {marketing('demo.note')}
            </span>
          </div>

          <div className="mt-12 flex flex-col gap-24">
            <Capability
              title={marketing('home.capabilities.import.title')}
              detail={marketing('home.capabilities.import.detail')}
            >
              <Ledger caption={marketing('home.capabilities.import.caption')}>
                <LedgerHead>
                  <LedgerColumn>{marketing('home.capabilities.import.movement')}</LedgerColumn>
                  <LedgerColumn align="end">{marketing('home.claims.amount')}</LedgerColumn>
                  <LedgerColumn>{marketing('home.capabilities.import.result')}</LedgerColumn>
                </LedgerHead>
                <LedgerBody>
                  <LedgerRow>
                    <LedgerCell>{marketing('home.capabilities.import.cardPayment')}</LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={usd(DEMO.cardMinimum).negate()}
                        locale={moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                    <LedgerCell>
                      <Status tone="neutral">
                        {marketing('home.capabilities.import.transfer')}
                      </Status>
                    </LedgerCell>
                  </LedgerRow>
                  <LedgerRow>
                    <LedgerCell>{marketing('home.capabilities.import.grocery')}</LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={usd('86.40').negate()}
                        locale={moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                    <LedgerCell>
                      <Provenance
                        source="rule"
                        label={marketing('home.capabilities.import.groceryCategory')}
                        confidence="high"
                        confidenceLabel={marketing('home.capabilities.import.high')}
                      />
                    </LedgerCell>
                  </LedgerRow>
                  <LedgerRow>
                    <LedgerCell>{marketing('home.capabilities.import.ride')}</LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={usd('6.75').negate()}
                        locale={moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                    <LedgerCell>
                      <Provenance
                        source="system"
                        label={marketing('home.capabilities.import.rideCategory')}
                        confidence="high"
                        confidenceLabel={marketing('home.capabilities.import.high')}
                      />
                    </LedgerCell>
                  </LedgerRow>
                  <LedgerRow>
                    <LedgerCell secondary>
                      {marketing('home.capabilities.import.grocery')}
                    </LedgerCell>
                    <LedgerCell align="end" secondary>
                      <Amount
                        value={usd('86.40').negate()}
                        locale={moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                    <LedgerCell>
                      <Status tone="caution">
                        {marketing('home.capabilities.import.duplicate')}
                      </Status>
                    </LedgerCell>
                  </LedgerRow>
                </LedgerBody>
              </Ledger>
            </Capability>

            <Capability
              title={marketing('home.capabilities.plan.title')}
              detail={marketing('home.capabilities.plan.detail')}
            >
              <Ledger
                caption={marketing('home.capabilities.plan.caption', {
                  income: money(usd(DEMO.income)),
                })}
              >
                <LedgerHead>
                  <LedgerColumn>{marketing('home.capabilities.plan.line')}</LedgerColumn>
                  <LedgerColumn>{marketing('home.capabilities.plan.why')}</LedgerColumn>
                  <LedgerColumn align="end">{marketing('home.claims.amount')}</LedgerColumn>
                </LedgerHead>
                <LedgerBody>
                  {planLines.map((line, index) => (
                    <LedgerRow key={line.key}>
                      <LedgerCell>
                        <span className="gradation-label mr-3">{index + 1}</span>
                        {marketing(`home.capabilities.plan.${line.key}`)}
                      </LedgerCell>
                      <LedgerCell secondary>
                        {marketing(`home.capabilities.plan.${line.key}Why`)}
                      </LedgerCell>
                      <LedgerCell align="end">
                        <Amount value={line.amount} locale={moneyLocale} size="sm" tone="plain" />
                      </LedgerCell>
                    </LedgerRow>
                  ))}
                  <LedgerRow>
                    <LedgerCell>
                      <span className="font-medium">
                        {marketing('home.capabilities.plan.total')}
                      </span>
                    </LedgerCell>
                    <LedgerCell secondary>{''}</LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={Money.sum(
                          planLines.map((line) => line.amount),
                          'USD',
                        )}
                        locale={moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                  </LedgerRow>
                </LedgerBody>
              </Ledger>
            </Capability>

            <Capability
              title={marketing('home.capabilities.debts.title')}
              detail={marketing('home.capabilities.debts.detail')}
            >
              <Ledger
                caption={marketing('home.capabilities.debts.caption', {
                  extra: money(usd(DEMO.extraToDebt)),
                })}
              >
                <LedgerHead>
                  <LedgerColumn>{marketing('home.capabilities.debts.strategy')}</LedgerColumn>
                  <LedgerColumn align="end">
                    {marketing('home.capabilities.debts.months')}
                  </LedgerColumn>
                  <LedgerColumn align="end">
                    {marketing('home.capabilities.debts.interest')}
                  </LedgerColumn>
                </LedgerHead>
                <LedgerBody>
                  {DEBT_OUTCOMES.map((outcome) => (
                    <LedgerRow key={outcome.key}>
                      <LedgerCell>{marketing(`home.capabilities.debts.${outcome.key}`)}</LedgerCell>
                      <LedgerCell align="end">
                        <span className="tabular">
                          {marketing('home.capabilities.debts.monthsValue', {
                            months: outcome.months,
                          })}
                        </span>
                      </LedgerCell>
                      <LedgerCell align="end">
                        <Amount
                          value={usd(outcome.interest)}
                          locale={moneyLocale}
                          size="sm"
                          tone="plain"
                        />
                      </LedgerCell>
                    </LedgerRow>
                  ))}
                </LedgerBody>
              </Ledger>
              <p className="mt-4 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                {marketing('home.capabilities.debts.saving', {
                  extra: money(usd(DEMO.extraToDebt)),
                  months: minimumsOnly.months - avalanche.months,
                  interest: money(usd(minimumsOnly.interest).subtract(usd(avalanche.interest))),
                })}
              </p>
            </Capability>

            <Capability
              title={marketing('home.capabilities.tax.title')}
              detail={marketing('home.capabilities.tax.detail')}
            >
              <Ledger caption={marketing('home.capabilities.tax.caption')}>
                <LedgerHead>
                  <LedgerColumn>{marketing('home.claims.item')}</LedgerColumn>
                  <LedgerColumn align="end">{marketing('home.claims.amount')}</LedgerColumn>
                </LedgerHead>
                <LedgerBody>
                  <LedgerRow>
                    <LedgerCell>{marketing('home.capabilities.tax.invoice')}</LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={usd(DEMO.invoice)}
                        locale={moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                  </LedgerRow>
                  <LedgerRow>
                    <LedgerCell>
                      {marketing('home.capabilities.tax.reserve')}
                      <span className="mt-1 block text-xs text-[color:var(--color-ink-tertiary)]">
                        {marketing('home.capabilities.tax.reserveWhy', { rate: '12%' })}
                      </span>
                    </LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={usd(DEMO.invoiceReserve).negate()}
                        locale={moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                  </LedgerRow>
                  <LedgerRow>
                    <LedgerCell>
                      <span className="font-medium">
                        {marketing('home.capabilities.tax.yours')}
                      </span>
                    </LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={usd(DEMO.invoice).subtract(usd(DEMO.invoiceReserve))}
                        locale={moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                  </LedgerRow>
                </LedgerBody>
              </Ledger>
            </Capability>

            <Capability
              title={marketing('home.capabilities.goals.title')}
              detail={marketing('home.capabilities.goals.detail')}
            >
              <Ledger
                caption={marketing('home.capabilities.goals.caption', {
                  target: money(usd(DEMO.goalTarget)),
                  months: DEMO.goalMonths,
                  current: money(usd(DEMO.goalCurrent)),
                })}
              >
                <LedgerHead>
                  <LedgerColumn>{marketing('home.capabilities.goals.level')}</LedgerColumn>
                  <LedgerColumn align="end">
                    {marketing('home.capabilities.goals.monthly')}
                  </LedgerColumn>
                </LedgerHead>
                <LedgerBody>
                  {GOAL_CONTRIBUTIONS.map((row) => (
                    <LedgerRow key={row.key}>
                      <LedgerCell>{marketing(`home.capabilities.goals.${row.key}`)}</LedgerCell>
                      <LedgerCell align="end">
                        <Amount
                          value={usd(row.monthly)}
                          locale={moneyLocale}
                          size="sm"
                          tone="plain"
                        />
                      </LedgerCell>
                    </LedgerRow>
                  ))}
                </LedgerBody>
              </Ledger>
              <p className="mt-4 max-w-[62ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
                {marketing('home.capabilities.goals.note')}
              </p>
            </Capability>

            <Capability
              title={marketing('home.capabilities.chat.title')}
              detail={marketing('home.capabilities.chat.detail')}
            >
              <Card padding="lg">
                <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
                  {marketing('home.capabilities.chat.caption')}
                </p>
                <div className="mt-4 flex flex-col gap-4">
                  <p className="ml-auto max-w-[34ch] rounded-(--radius-sm) bg-[color:var(--color-ground-sunk)] px-4 py-3 text-sm">
                    {marketing('home.capabilities.chat.question')}
                  </p>
                  <p className="max-w-[52ch] text-sm/6 text-pretty">
                    {marketing('home.capabilities.chat.answer', {
                      available: money(available),
                      card: money(usd(DEMO.cardBalance)),
                      minimum: money(usd(DEMO.cardMinimum)),
                      extra: money(usd(DEMO.extraToDebt)),
                      remaining: money(cardAfter),
                    })}
                  </p>
                  <div>
                    <Status tone="positive">{marketing('home.capabilities.chat.grounded')}</Status>
                  </div>
                </div>
              </Card>
            </Capability>
          </div>
        </Section>

        {/* 4. Who it is for. */}
        <Section
          title={marketing('home.who.title')}
          detail={marketing('home.who.detail')}
          className="mt-24"
        >
          <ul className="mt-6 divide-y divide-[color:var(--color-rule)]">
            {[
              { key: 'couples', href: '/couples' },
              { key: 'independents', href: '/independents' },
              { key: 'accountants', href: '/accountants' },
            ].map((entry) => (
              <li key={entry.key} className="py-5 first:pt-0">
                <Link href={entry.href} className="font-medium underline underline-offset-4">
                  {marketing(`home.who.${entry.key}.title`)}
                </Link>
                <p className="mt-1 max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]">
                  {marketing(`home.who.${entry.key}.detail`)}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        {/* 5. Plans, from the catalogue. */}
        {plans.length > 0 && (
          <Section
            title={marketing('home.pricing.title')}
            detail={marketing('home.pricing.detail')}
            className="mt-24"
          >
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.code}
                  plan={plan}
                  locale={moneyLocale}
                  labels={{
                    free: marketing('home.pricing.free'),
                    perMonth: (price) => marketing('home.pricing.perMonth', { price }),
                    members: (count) => marketing('home.pricing.members', { count }),
                    membersUnlimited: marketing('home.pricing.membersUnlimited'),
                    ai: (count) => marketing('home.pricing.ai', { count }),
                    aiNone: marketing('home.pricing.aiNone'),
                    tax: marketing('home.pricing.tax'),
                    imports: (count) => marketing('home.pricing.imports', { count }),
                    importsUnlimited: marketing('home.pricing.importsUnlimited'),
                    choose: plan.price.isZero()
                      ? marketing('home.pricing.chooseFree')
                      : marketing('home.pricing.choose', { plan: plan.name }),
                  }}
                />
              ))}
            </div>
            <p className="mt-6 max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
              {marketing('pricing.notes.provisional')}
            </p>
            <Link
              href="/pricing"
              className="mt-4 inline-block text-sm underline underline-offset-4"
            >
              {marketing('home.pricing.link')}
            </Link>
          </Section>
        )}

        {/* 6. Refusals. */}
        <Section
          title={marketing('home.refusals.title')}
          detail={marketing('home.refusals.detail')}
          className="mt-24"
        >
          <ul className="mt-6 grid gap-x-12 sm:grid-cols-2">
            {['duplicates', 'transfers', 'ai', 'tax'].map((key) => (
              <li key={key} className="border-t border-[color:var(--color-rule)] py-5">
                <p className="font-medium">{marketing(`home.refusals.${key}.claim`)}</p>
                <p className="mt-1 max-w-[48ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                  {marketing(`home.refusals.${key}.detail`)}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        {/* 7. Questions. */}
        {faqs.length > 0 && (
          <Section title={marketing('home.faq.title')} className="mt-24">
            <dl className="mt-6 divide-y divide-[color:var(--color-rule)]">
              {faqs.map((faq) => (
                <div key={faq.question} className="py-5 first:pt-0">
                  <dt className="font-medium">{faq.question}</dt>
                  <dd className="mt-1 max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]">
                    {faq.answer}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {/* 8. Close. */}
        <Section title="" className="mt-24">
          <Rule className="mb-12" />
          <h2
            className="max-w-[24ch] text-3xl font-medium text-balance sm:text-4xl"
            style={{ letterSpacing: 'var(--tracking-display)', lineHeight: 1.08 }}
          >
            {marketing('home.close.title')}
          </h2>
          <p className="mt-4 max-w-[52ch] text-pretty text-[color:var(--color-ink-secondary)]">
            {marketing('home.close.detail')}
          </p>
          <div className="mt-8">
            <Link href="/sign-up">
              <Button size="lg">{t('primaryCta')}</Button>
            </Link>
          </div>
        </Section>
      </MarketingShell>

      {cheapestPaid && (
        <script
          type="application/ld+json"
          // Serialized JSON-LD, not markup. No rating is emitted: there are no
          // reviews, and inventing them is out of the question.
          dangerouslySetInnerHTML={{
            __html: productStructuredData({
              name: common('appName'),
              description: t('seoDescription'),
              url: absoluteUrl(`/${locale}`),
              lowestPrice: (freePlan ?? cheapestPaid).price.toDecimalString(),
              currency: cheapestPaid.price.currency,
              ...(dearestPaid ? { highestPrice: dearestPaid.price.toDecimalString() } : {}),
              inLanguage: locale,
            }),
          }}
        />
      )}
      {faqJson && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJson }} />
      )}
    </Page>
  );
}

/** A capability: the benefit in words on one side, the product on the other. */
function Capability({
  title,
  detail,
  children,
}: {
  readonly title: string;
  readonly detail: string;
  readonly children: ReactNode;
}) {
  return (
    <article className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
      <div>
        <h3
          className="max-w-[24ch] text-2xl font-medium text-balance"
          style={{ letterSpacing: 'var(--tracking-title)', lineHeight: 1.15 }}
        >
          {title}
        </h3>
        <p className="mt-4 max-w-[48ch] text-pretty text-[color:var(--color-ink-secondary)]">
          {detail}
        </p>
      </div>
      <div className="min-w-0">{children}</div>
    </article>
  );
}

function PlanCard({
  plan,
  locale,
  labels,
}: {
  readonly plan: PublicPlan;
  readonly locale: MoneyLocale;
  readonly labels: {
    readonly free: string;
    readonly perMonth: (price: string) => string;
    readonly members: (count: number) => string;
    readonly membersUnlimited: string;
    readonly ai: (count: number) => string;
    readonly aiNone: string;
    readonly tax: string;
    readonly imports: (count: number) => string;
    readonly importsUnlimited: string;
    readonly choose: string;
  };
}) {
  const limit = (key: string) => plan.entitlements.find((entry) => entry.key === key)?.limit;
  const members = limit('household_members');
  const ai = limit('ai_usage');
  const tax = limit('tax_engine');
  const imports = limit('document_imports');

  const lines = [
    members == null ? labels.membersUnlimited : labels.members(members),
    imports == null ? labels.importsUnlimited : labels.imports(imports),
    ai == null || ai === 0 ? labels.aiNone : labels.ai(ai),
    ...(tax === 1 ? [labels.tax] : []),
  ];

  return (
    <Card padding="lg" className="flex flex-col">
      <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
        {plan.name}
      </p>
      <p className="mt-3 text-2xl font-medium">
        {plan.price.isZero() ? (
          labels.free
        ) : (
          <span className="tabular">{labels.perMonth(formatMoney(plan.price, { locale }))}</span>
        )}
      </p>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-[color:var(--color-ink-secondary)]">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-6">
        <Link href="/sign-up">
          <Button variant={plan.price.isZero() ? 'primary' : 'secondary'} size="sm">
            {labels.choose}
          </Button>
        </Link>
      </div>
    </Card>
  );
}
