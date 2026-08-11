import { Money, formatMoney } from '@app/domain';
import {
  Amount,
  Button,
  Gauge,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  Readout,
  Rule,
  Section,
  Status,
} from '@app/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { MarketingShell } from '@/components/marketing/site-chrome';
import { Link } from '@/i18n/navigation';
import { productStructuredData } from '@/lib/seo';
import { listFaqs } from '@/server/repositories/content';
import { listPlans } from '@/server/repositories/plans';
import { loadSession } from '@/server/session';

/**
 * The home page.
 *
 * It shows the product's actual device — the gauge — rather than describing it,
 * because the whole argument of this product is that a level against a marked
 * scale tells you something a number cannot. A screenshot would say the same
 * thing less honestly.
 *
 * **Everything on this page is either real or labelled.** The demonstration
 * figures below are authored at full fidelity and marked as a demonstration
 * where a reader will see it. The prices come out of the database. There are no
 * testimonials, because nobody has given one, and no customer logos, because
 * there are no customers. A financial product that opens with an invented
 * endorsement has told you what it is before you sign up.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });
  const common = await getTranslations({ locale, namespace: 'common' });

  return {
    title: `${common('appName')} — ${t('headline')}`,
    description: t('subheadline'),
  };
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  // The session decides whether this page renders at all; the content decides
  // what it says. They do not depend on each other, so they travel together —
  // an anonymous visit is three round trips either way, and doing them in
  // sequence is three latencies instead of one.
  const [session, plans, faqs] = await Promise.all([loadSession(), listPlans(), listFaqs(locale)]);

  // A signed-in person never sees marketing. They came to look at their money.
  if (session) {
    redirect(`/${locale}${session.activeHouseholdId ? '/overview' : '/welcome'}`);
  }

  const t = await getTranslations('landing');
  const marketing = await getTranslations('marketing');
  const common = await getTranslations('common');

  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';
  const money = (value: Money) => formatMoney(value, { locale: moneyLocale });
  const cheapestPaid = plans.find((plan) => plan.price.isPositive());

  // Demonstration figures. Authored to be internally consistent — the claims
  // below sum to the committed amount, and the level is the difference — because
  // a demonstration whose numbers do not add up is the first thing a financial
  // reader checks.
  const demo = {
    liquid: Money.fromDecimalString('4180.00', 'USD'),
    available: Money.fromDecimalString('1245.00', 'USD'),
    buffer: Money.fromDecimalString('800.00', 'USD'),
    claims: [
      { key: 'rent', amount: Money.fromDecimalString('1200.00', 'USD') },
      { key: 'card', amount: Money.fromDecimalString('185.00', 'USD') },
      { key: 'electricity', amount: Money.fromDecimalString('142.00', 'USD') },
      { key: 'taxReserve', amount: Money.fromDecimalString('608.00', 'USD') },
    ],
  };

  const committed = Money.sum(
    demo.claims.map((claim) => claim.amount),
    'USD',
  );

  return (
    <Page>
      <MarketingShell locale={locale}>
        <section className="mb-24">
          <h1
            className="max-w-[18ch] text-5xl font-medium text-balance sm:text-6xl"
            style={{ letterSpacing: 'var(--tracking-display)', lineHeight: 1.02 }}
          >
            {t('headline')}
          </h1>

          <p className="mt-6 max-w-[52ch] text-lg text-pretty text-[color:var(--color-ink-secondary)]">
            {t('subheadline')}
          </p>

          <div className="mt-12 flex flex-wrap items-center gap-6">
            <Link href="/sign-up">
              <Button size="lg">{t('primaryCta')}</Button>
            </Link>
            <Link
              href="/features"
              className="text-sm underline underline-offset-4 transition-opacity duration-(--duration-quick) hover:opacity-60"
            >
              {marketing('home.secondaryCta')}
            </Link>
          </div>
        </section>

        <Section
          title={marketing('home.mechanism.title')}
          detail={marketing('home.mechanism.detail')}
        >
          <div className="mt-8">
            <div className="mb-3 flex items-baseline gap-3">
              <Status tone="neutral">{marketing('demo.label')}</Status>
              <span className="text-xs text-[color:var(--color-ink-tertiary)]">
                {marketing('demo.note')}
              </span>
            </div>

            <Gauge
              value={demo.available}
              max={demo.liquid}
              label={marketing('home.mechanism.gaugeLabel')}
              locale={moneyLocale}
              thresholds={[
                { at: demo.buffer, label: marketing('home.mechanism.buffer'), kind: 'buffer' },
                {
                  at: demo.available,
                  label: marketing('home.mechanism.surface'),
                  kind: 'committed',
                },
              ]}
            />

            <div className="mt-8 flex flex-wrap items-end justify-between gap-8">
              <Readout
                value={demo.available}
                label={marketing('home.mechanism.readout')}
                detail={marketing('home.mechanism.basis', {
                  liquid: money(demo.liquid),
                  committed: money(committed),
                })}
                locale={moneyLocale}
              />
            </div>

            <Ledger caption={marketing('home.claims.title')} className="mt-10">
              <LedgerHead>
                <LedgerColumn>{marketing('home.claims.item')}</LedgerColumn>
                <LedgerColumn align="end">{marketing('home.claims.amount')}</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {demo.claims.map((claim) => (
                  <LedgerRow key={claim.key}>
                    <LedgerCell>{marketing(`home.claims.${claim.key}`)}</LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={claim.amount.negate()}
                        locale={moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                  </LedgerRow>
                ))}
              </LedgerBody>
            </Ledger>
          </div>
        </Section>

        <Section
          title={marketing('home.refusals.title')}
          detail={marketing('home.refusals.detail')}
        >
          <ul className="mt-6 divide-y divide-[color:var(--color-rule)]">
            {['duplicates', 'transfers', 'ai', 'tax'].map((key) => (
              <li key={key} className="py-5 first:pt-0">
                <p className="font-medium">{marketing(`home.refusals.${key}.claim`)}</p>
                <p className="mt-1 max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]">
                  {marketing(`home.refusals.${key}.detail`)}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={marketing('home.who.title')} detail={marketing('home.who.detail')}>
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

        {cheapestPaid && (
          <Section
            title={marketing('home.pricing.title')}
            detail={marketing('home.pricing.detail')}
          >
            <p className="mt-4 text-[color:var(--color-ink-secondary)]">
              {marketing('home.pricing.from', {
                price: money(cheapestPaid.price),
                plan: cheapestPaid.name,
              })}
            </p>
            <Link
              href="/pricing"
              className="mt-4 inline-block text-sm underline underline-offset-4"
            >
              {marketing('home.pricing.link')}
            </Link>
          </Section>
        )}

        {faqs.length > 0 && (
          <Section title={marketing('home.faq.title')}>
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

        <Section title="" className="mt-20">
          <Rule className="mb-10" />
          <h2
            className="max-w-[22ch] text-3xl font-medium text-balance sm:text-4xl"
            style={{ letterSpacing: 'var(--tracking-display)', lineHeight: 1.08 }}
          >
            {marketing('home.close.title')}
          </h2>
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
              description: t('subheadline'),
              url: `/${locale}`,
              lowestPrice: cheapestPaid.price.toDecimalString(),
              currency: cheapestPaid.price.currency,
            }),
          }}
        />
      )}
    </Page>
  );
}
