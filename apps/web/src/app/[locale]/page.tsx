import { Money, formatMoney, type MoneyLocale } from '@app/domain';
import { Status } from '@app/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  ChatDevice,
  DebtDevice,
  GoalsDevice,
  ImportDevice,
  PlanDevice,
  TaxDevice,
} from '@/components/landing/devices';
import { Faq } from '@/components/landing/faq';
import { HeroDevice } from '@/components/landing/hero-device';
import { Drift, Lift, Reveal, Stagger, StaggerItem } from '@/components/landing/motion';
import { LandingNav } from '@/components/landing/nav';
import { SiteFooter } from '@/components/marketing/site-chrome';
import { TryIt } from '@/components/marketing/try-it';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { absoluteUrl, faqStructuredData, landingMetadata, productStructuredData } from '@/lib/seo';
import { listFaqs } from '@/server/repositories/content';
import { listPlans, type PublicPlan } from '@/server/repositories/plans';
import { loadSession } from '@/server/session';

/**
 * The home page.
 *
 * One idea, shown before it is explained: money is a level, not a number. The
 * hero is the product's own position panel on the demonstration household,
 * filling and counting up as it comes into view. Everything after it is the
 * product's own surfaces on the same figures, arriving as the reader scrolls,
 * with the space around them doing most of the work.
 *
 * **Everything on this page is either real or labelled.** Prices and limits
 * come out of the database. The demonstration household is one set of figures,
 * consistent across every device. There are no testimonials, logos or ratings,
 * because there are none to show; `docs/landing.md` records what is absent and
 * why.
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
 * Debt outcomes from an offline amortization of three debts — a $1,850 card
 * at 26%, a $6,400 loan at 14%, a $900 interest-free family loan — with $300
 * extra a month, using the debt engine's monthly-interest rule.
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

const PILL =
  'inline-flex h-12 items-center justify-center rounded-full px-6 text-base font-medium transition-[transform,opacity,background-color] duration-(--duration-tap) ease-(--ease-settle) active:scale-[0.985]';
const PILL_PRIMARY = `${PILL} bg-[color:var(--color-ink)] text-[color:var(--color-ground)] hover:opacity-90`;
const PILL_SECONDARY = `${PILL} border border-[color:var(--color-rule-strong)] bg-transparent text-[color:var(--color-ink)] hover:bg-[color:var(--color-ground-sunk)]`;

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const [session, plans, faqs] = await Promise.all([loadSession(), listPlans(), listFaqs(locale)]);
  if (session) {
    redirect(`/${locale}${session.activeHouseholdId ? '/overview' : '/welcome'}`);
  }

  const t = await getTranslations('landing');
  const marketing = await getTranslations('marketing');
  const common = await getTranslations('common');
  const otherLocale = routing.locales.find((candidate) => candidate !== locale) ?? 'en';

  const moneyLocale: MoneyLocale = locale === 'en' ? 'en-US' : 'es-PA';
  const usd = (value: string) => Money.fromDecimalString(value, 'USD');
  const money = (value: Money) => formatMoney(value, { locale: moneyLocale });
  const labelsOf = (prefix: string): Record<string, string> => {
    const raw: unknown = marketing.raw(prefix);
    return typeof raw === 'object' && raw !== null
      ? Object.fromEntries(
          Object.entries(raw as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};
  };

  const freePlan = plans.find((plan) => plan.price.isZero());
  const paidPlans = plans.filter((plan) => plan.price.isPositive());
  const cheapestPaid = paidPlans[0];
  const dearestPaid = paidPlans[paidPlans.length - 1];
  const freeMovements = freePlan?.entitlements.find(
    (entry) => entry.key === 'transactions_per_month',
  )?.limit;

  const claims = [
    { key: 'rent', amount: usd(DEMO.rent) },
    { key: 'card', amount: usd(DEMO.cardMinimum) },
    { key: 'electricity', amount: usd(DEMO.electricity) },
    { key: 'taxReserve', amount: usd(DEMO.taxReserve) },
  ] as const;
  const committed = Money.sum(
    claims.map((claim) => claim.amount),
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
  ];

  const minimumsOnly = DEBT_OUTCOMES[2];
  const avalanche = DEBT_OUTCOMES[0];
  const faqJson = faqStructuredData(faqs);

  const amountLabel = marketing('home.claims.amount');
  const importLabels = { ...labelsOf('home.capabilities.import'), amount: amountLabel };
  const planLabels = {
    ...labelsOf('home.capabilities.plan'),
    amount: amountLabel,
    caption: marketing('home.capabilities.plan.caption', { income: money(usd(DEMO.income)) }),
  };
  const debtLabels = {
    ...labelsOf('home.capabilities.debts'),
    caption: marketing('home.capabilities.debts.caption', { extra: money(usd(DEMO.extraToDebt)) }),
  };
  const taxLabels = {
    ...labelsOf('home.capabilities.tax'),
    reserveWhy: marketing('home.capabilities.tax.reserveWhy', { rate: '12%' }),
  };
  const goalLabels = {
    ...labelsOf('home.capabilities.goals'),
    caption: marketing('home.capabilities.goals.caption', {
      target: money(usd(DEMO.goalTarget)),
      months: DEMO.goalMonths,
      current: money(usd(DEMO.goalCurrent)),
    }),
  };

  return (
    <div className="overflow-x-clip">
      <LandingNav
        brand={common('appName')}
        links={[
          { href: '/features', label: marketing('nav.features') },
          { href: '/couples', label: marketing('nav.couples') },
          { href: '/independents', label: marketing('nav.independents') },
          { href: '/pricing', label: marketing('nav.pricing') },
          { href: '/security', label: marketing('nav.security') },
        ]}
        signIn={marketing('nav.signIn')}
        start={marketing('nav.start')}
        otherLocale={otherLocale}
        switchLabel={marketing('switchLanguage')}
      />

      <main>
        {/* ---- The claim ------------------------------------------------- */}
        <section className="mx-auto max-w-4xl px-6 pt-32 pb-12 text-center sm:pt-40 sm:pb-16">
          <Reveal
            as="p"
            className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase"
          >
            {marketing('home.eyebrows.device')}
          </Reveal>
          <Reveal
            as="h1"
            delay={0.05}
            className="mt-6 text-[2.75rem] leading-[1.02] font-medium text-balance sm:text-6xl lg:text-7xl"
          >
            <span style={{ letterSpacing: 'var(--tracking-display)' }}>{t('headline')}</span>
          </Reveal>
          <Reveal
            as="p"
            delay={0.15}
            className="mx-auto mt-6 max-w-[52ch] text-lg text-pretty text-[color:var(--color-ink-secondary)] sm:text-xl"
          >
            {t('subheadline')}
          </Reveal>
          <Reveal delay={0.25} className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/sign-up" className={PILL_PRIMARY}>
              {t('primaryCta')}
            </Link>
            <a href="#try" className={PILL_SECONDARY}>
              {t('tryCta')}
            </a>
          </Reveal>
          {freeMovements != null && (
            <Reveal
              as="p"
              delay={0.35}
              className="mt-8 text-xs text-[color:var(--color-ink-tertiary)]"
            >
              {t('proof', { transactions: freeMovements })}
            </Reveal>
          )}
        </section>

        {/* ---- The device ------------------------------------------------ */}
        <section className="mx-auto max-w-6xl px-6 pb-32 sm:pb-40">
          <Reveal delay={0.2}>
            <Drift distance={24}>
              <HeroDevice
                locale={moneyLocale}
                liquid={DEMO.balance}
                available={available.toDecimalString()}
                buffer={DEMO.buffer}
                committed={committed.toDecimalString()}
                claims={claims.map((claim) => ({
                  key: claim.key,
                  label: marketing(`home.mechanism.${claim.key}`),
                  amount: claim.amount.toDecimalString(),
                }))}
                labels={{
                  readout: marketing('home.mechanism.readout'),
                  basis: marketing.raw('home.mechanism.basis') as string,
                  gaugeLabel: marketing('home.mechanism.gaugeLabel'),
                  bufferMark: marketing('home.mechanism.buffer'),
                  surfaceMark: marketing('home.mechanism.surface'),
                  claimsTitle: marketing('home.mechanism.claimsTitle'),
                  demo: `${marketing('demo.label')} · ${marketing('demo.note')}`,
                }}
              />
            </Drift>
          </Reveal>
        </section>

        {/* ---- What it does --------------------------------------------- */}
        <section className="border-t border-[color:var(--color-rule)]">
          <div className="mx-auto max-w-6xl px-6 py-32 sm:py-40">
            <SectionHead
              eyebrow={marketing('home.eyebrows.capabilities')}
              title={marketing('home.capabilities.title')}
              detail={marketing('home.capabilities.detail')}
            />
            <Reveal className="mt-8 flex justify-center">
              <Status tone="neutral">{marketing('demo.label')}</Status>
            </Reveal>

            <div className="mt-24 flex flex-col gap-32 sm:gap-40">
              <Film
                title={marketing('home.capabilities.plan.title')}
                detail={marketing('home.capabilities.plan.detail')}
                device={<PlanDevice locale={moneyLocale} lines={planLines} labels={planLabels} />}
              />
              <Film
                reverse
                title={marketing('home.capabilities.debts.title')}
                detail={marketing('home.capabilities.debts.detail')}
                note={marketing('home.capabilities.debts.saving', {
                  extra: money(usd(DEMO.extraToDebt)),
                  months: minimumsOnly.months - avalanche.months,
                  interest: money(usd(minimumsOnly.interest).subtract(usd(avalanche.interest))),
                })}
                device={
                  <DebtDevice
                    locale={moneyLocale}
                    outcomes={DEBT_OUTCOMES.map((outcome) => ({
                      key: outcome.key,
                      months: outcome.months,
                      interest: usd(outcome.interest),
                      monthsLabel: marketing('home.capabilities.debts.monthsValue', {
                        months: outcome.months,
                      }),
                    }))}
                    labels={debtLabels}
                  />
                }
              />
              <Film
                title={marketing('home.capabilities.chat.title')}
                detail={marketing('home.capabilities.chat.detail')}
                device={
                  <ChatDevice
                    caption={marketing('home.capabilities.chat.caption')}
                    question={marketing('home.capabilities.chat.question')}
                    answer={marketing('home.capabilities.chat.answer', {
                      available: money(available),
                      card: money(usd(DEMO.cardBalance)),
                      minimum: money(usd(DEMO.cardMinimum)),
                      extra: money(usd(DEMO.extraToDebt)),
                      remaining: money(cardAfter),
                    })}
                    grounded={marketing('home.capabilities.chat.grounded')}
                  />
                }
              />
            </div>

            {/* The rest, as a grid of surfaces. */}
            <Stagger className="mt-32 grid gap-6 sm:mt-40 md:grid-cols-2" step={0.1}>
              <Bento
                title={marketing('home.capabilities.import.title')}
                detail={marketing('home.capabilities.import.detail')}
              >
                <ImportDevice
                  locale={moneyLocale}
                  minimum={usd(DEMO.cardMinimum)}
                  labels={importLabels}
                />
              </Bento>
              <Bento
                title={marketing('home.capabilities.tax.title')}
                detail={marketing('home.capabilities.tax.detail')}
              >
                <TaxDevice
                  locale={moneyLocale}
                  invoice={usd(DEMO.invoice)}
                  reserve={usd(DEMO.invoiceReserve)}
                  labels={taxLabels}
                />
              </Bento>
              <Bento
                title={marketing('home.capabilities.goals.title')}
                detail={marketing('home.capabilities.goals.detail')}
              >
                <GoalsDevice
                  locale={moneyLocale}
                  rows={GOAL_CONTRIBUTIONS.map((row) => ({
                    key: row.key,
                    monthly: usd(row.monthly),
                  }))}
                  labels={goalLabels}
                />
              </Bento>
              <Bento
                title={marketing('home.refusals.title')}
                detail={marketing('home.refusals.detail')}
              >
                <ul className="divide-y divide-[color:var(--color-rule)] rounded-[1.75rem] border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-6 shadow-(--shadow-sheet)">
                  {['duplicates', 'transfers', 'ai', 'tax'].map((key) => (
                    <li key={key} className="py-4">
                      <p className="text-sm font-medium">
                        {marketing(`home.refusals.${key}.claim`)}
                      </p>
                      <p className="mt-1 text-xs text-pretty text-[color:var(--color-ink-secondary)]">
                        {marketing(`home.refusals.${key}.detail`)}
                      </p>
                    </li>
                  ))}
                </ul>
              </Bento>
            </Stagger>
          </div>
        </section>

        {/* ---- Try it ---------------------------------------------------- */}
        <section id="try" className="scroll-mt-24 px-6">
          <div className="mx-auto max-w-6xl rounded-[2.5rem] bg-[color:var(--color-ground-sunk)] px-6 py-20 sm:px-12 sm:py-28">
            <SectionHead
              eyebrow={marketing('home.eyebrows.try')}
              title={marketing('home.try.title')}
              detail={marketing('home.try.detail')}
            />
            <Reveal className="mt-16">
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
            </Reveal>
          </div>
        </section>

        {/* ---- Who ------------------------------------------------------- */}
        <section className="mx-auto max-w-6xl px-6 py-32 sm:py-40">
          <SectionHead
            eyebrow={marketing('home.eyebrows.who')}
            title={marketing('home.who.title')}
            detail={marketing('home.who.detail')}
          />
          <Stagger className="mt-16 grid gap-6 md:grid-cols-3" step={0.1}>
            {[
              { key: 'couples', href: '/couples' },
              { key: 'independents', href: '/independents' },
              { key: 'accountants', href: '/accountants' },
            ].map((entry) => (
              <StaggerItem key={entry.key}>
                <Lift className="h-full">
                  <Link
                    href={entry.href}
                    className="flex h-full flex-col justify-between rounded-[1.75rem] border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] p-8 shadow-(--shadow-card) transition-shadow duration-(--duration-quick) hover:shadow-(--shadow-card-hover)"
                  >
                    <div>
                      <h3
                        className="text-2xl font-medium text-balance"
                        style={{ letterSpacing: 'var(--tracking-title)' }}
                      >
                        {marketing(`home.who.${entry.key}.title`)}
                      </h3>
                      <p className="mt-3 text-pretty text-[color:var(--color-ink-secondary)]">
                        {marketing(`home.who.${entry.key}.detail`)}
                      </p>
                    </div>
                    <span aria-hidden className="mt-8 text-[color:var(--color-brand-strong)]">
                      →
                    </span>
                  </Link>
                </Lift>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ---- Plans ----------------------------------------------------- */}
        {plans.length > 0 && (
          <section className="border-t border-[color:var(--color-rule)]">
            <div className="mx-auto max-w-6xl px-6 py-32 sm:py-40">
              <SectionHead
                eyebrow={marketing('home.eyebrows.pricing')}
                title={marketing('home.pricing.title')}
                detail={marketing('home.pricing.detail')}
              />
              <Stagger className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-5" step={0.08}>
                {plans.map((plan) => (
                  <StaggerItem key={plan.code} className="h-full">
                    <PlanCard
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
                  </StaggerItem>
                ))}
              </Stagger>
              <Reveal className="mt-10 flex flex-col items-center gap-4 text-center">
                <p className="max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
                  {marketing('pricing.notes.provisional')}
                </p>
                <Link href="/pricing" className="text-sm underline underline-offset-4">
                  {marketing('home.pricing.link')}
                </Link>
              </Reveal>
            </div>
          </section>
        )}

        {/* ---- Questions ------------------------------------------------- */}
        {faqs.length > 0 && (
          <section className="mx-auto max-w-3xl px-6 py-32 sm:py-40">
            <SectionHead
              eyebrow={marketing('home.eyebrows.faq')}
              title={marketing('home.faq.title')}
            />
            <Reveal className="mt-12">
              <Faq items={faqs} />
            </Reveal>
          </section>
        )}

        {/* ---- Close ----------------------------------------------------- */}
        <section className="panel-scope bg-[color:var(--color-panel)] text-[color:var(--color-panel-ink)]">
          <div className="mx-auto max-w-4xl px-6 py-32 text-center sm:py-44">
            <Reveal
              as="h2"
              className="text-4xl leading-[1.05] font-medium text-balance sm:text-6xl"
            >
              <span style={{ letterSpacing: 'var(--tracking-display)' }}>
                {marketing('home.close.title')}
              </span>
            </Reveal>
            <Reveal
              as="p"
              delay={0.1}
              className="mx-auto mt-6 max-w-[48ch] text-lg text-pretty text-[color:var(--color-panel-ink-secondary)]"
            >
              {marketing('home.close.detail')}
            </Reveal>
            <Reveal delay={0.2} className="mt-10">
              <Link
                href="/sign-up"
                className={`${PILL} bg-[color:var(--color-panel-ink)] text-[color:var(--color-panel)] hover:opacity-90`}
              >
                {t('primaryCta')}
              </Link>
            </Reveal>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-6 pb-12">
          <SiteFooter locale={locale} />
        </div>
      </main>

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
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  detail,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <Reveal
        as="p"
        className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase"
      >
        {eyebrow}
      </Reveal>
      <Reveal
        as="h2"
        delay={0.05}
        className="mt-5 text-4xl leading-[1.05] font-medium text-balance sm:text-5xl lg:text-6xl"
      >
        <span style={{ letterSpacing: 'var(--tracking-display)' }}>{title}</span>
      </Reveal>
      {detail && (
        <Reveal
          as="p"
          delay={0.12}
          className="mx-auto mt-6 max-w-[56ch] text-lg text-pretty text-[color:var(--color-ink-secondary)]"
        >
          {detail}
        </Reveal>
      )}
    </div>
  );
}

/** A capability with room around it: the words on one side, the product on the other. */
function Film({
  title,
  detail,
  note,
  device,
  reverse = false,
}: {
  readonly title: string;
  readonly detail: string;
  readonly note?: string;
  readonly device: ReactNode;
  readonly reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <Reveal className={reverse ? 'lg:order-2' : ''}>
        <h3
          className="max-w-[20ch] text-3xl leading-[1.1] font-medium text-balance sm:text-4xl"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          {title}
        </h3>
        <p className="mt-5 max-w-[46ch] text-lg text-pretty text-[color:var(--color-ink-secondary)]">
          {detail}
        </p>
        {note && (
          <p className="mt-5 max-w-[46ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {note}
          </p>
        )}
      </Reveal>
      <Reveal delay={0.1} className={reverse ? 'lg:order-1' : ''}>
        <Drift distance={20}>{device}</Drift>
      </Reveal>
    </div>
  );
}

function Bento({
  title,
  detail,
  children,
}: {
  readonly title: string;
  readonly detail: string;
  readonly children: ReactNode;
}) {
  return (
    <StaggerItem className="h-full">
      <div className="flex h-full flex-col gap-6 rounded-[2rem] bg-[color:var(--color-ground-sunk)] p-6 sm:p-8">
        <div>
          <h3
            className="text-2xl font-medium text-balance"
            style={{ letterSpacing: 'var(--tracking-title)' }}
          >
            {title}
          </h3>
          <p className="mt-3 max-w-[52ch] text-pretty text-[color:var(--color-ink-secondary)]">
            {detail}
          </p>
        </div>
        <div className="mt-auto">{children}</div>
      </div>
    </StaggerItem>
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
    <Lift className="h-full">
      <div className="flex h-full flex-col rounded-[1.75rem] border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] p-6 shadow-(--shadow-card)">
        <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
          {plan.name}
        </p>
        <p className="mt-4 text-3xl font-medium" style={{ letterSpacing: 'var(--tracking-title)' }}>
          {plan.price.isZero() ? (
            labels.free
          ) : (
            <span className="tabular">{labels.perMonth(formatMoney(plan.price, { locale }))}</span>
          )}
        </p>
        <ul className="mt-6 flex-1 space-y-2 text-sm text-[color:var(--color-ink-secondary)]">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Link
          href="/sign-up"
          className={`mt-8 inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium transition-[transform,opacity,background-color] duration-(--duration-tap) ease-(--ease-settle) active:scale-[0.985] ${
            plan.price.isZero()
              ? 'bg-[color:var(--color-ink)] text-[color:var(--color-ground)] hover:opacity-90'
              : 'border border-[color:var(--color-rule-strong)] hover:bg-[color:var(--color-ground-sunk)]'
          }`}
        >
          {labels.choose}
        </Link>
      </div>
    </Lift>
  );
}
