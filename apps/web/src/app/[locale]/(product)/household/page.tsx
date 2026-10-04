import { Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { tripsEnabled } from '@/server/repositories/trips';
import { requireHousehold } from '@/server/session';

/**
 * Hogar: everything that is not one of the four daily destinations.
 *
 * The column used to list thirty-four screens. Now it lists five, and this page
 * is where the rest live — gathered by what a person is trying to do, each with
 * one line saying what it is for, so nothing has to be opened to be understood.
 * Nothing was removed: a screen a household used is one tap further away, and
 * a screen it never used no longer stands between it and the ones it does.
 */
const SECTIONS = [
  { key: 'money', items: ['accounts', 'cards', 'offers', 'investments'] },
  { key: 'flows', items: ['income', 'commitments', 'debts', 'budgets', 'goals', 'trips'] },
  { key: 'order', items: ['review', 'categories', 'rules', 'merchants', 'familyExpenses'] },
  { key: 'ahead', items: ['advice', 'alerts', 'projection', 'scenarios', 'debtSimulator', 'chat'] },
  { key: 'record', items: ['reports', 'close', 'exports'] },
  {
    key: 'home',
    items: ['people', 'access', 'tax', 'notifications', 'subscription', 'settings', 'households'],
  },
] as const;

const HREF: Record<(typeof SECTIONS)[number]['items'][number], string> = {
  accounts: '/accounts',
  cards: '/cards',
  offers: '/offers',
  investments: '/investments',
  income: '/income',
  commitments: '/commitments',
  debts: '/debts',
  budgets: '/budgets',
  goals: '/goals',
  trips: '/trips',
  review: '/review',
  categories: '/categories',
  rules: '/rules',
  merchants: '/merchants',
  familyExpenses: '/family-expenses',
  advice: '/advice',
  alerts: '/alerts',
  projection: '/projection',
  scenarios: '/scenarios',
  debtSimulator: '/debt-simulator',
  chat: '/chat',
  reports: '/reports',
  close: '/close',
  exports: '/exports',
  people: '/people',
  access: '/access',
  tax: '/tax',
  notifications: '/notifications',
  subscription: '/subscription',
  settings: '/settings',
  households: '/households',
};

export default async function HouseholdHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const showTrips = await tripsEnabled(session, session.activeHouseholdId);
  const t = await getTranslations('hub');

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <div className="grid gap-8">
        {SECTIONS.map((section) => (
          <Section key={section.key} title={t(`sections.${section.key}`)}>
            <ul className="grid list-none gap-3 p-0 sm:grid-cols-2">
              {section.items
                .filter((item) => item !== 'trips' || showTrips)
                .map((item) => (
                  <li key={item} className="min-w-0">
                    <Link
                      href={HREF[item]}
                      className="flex min-h-16 flex-col justify-center gap-1 rounded-(--radius-md) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-4 py-3 transition-colors duration-(--duration-quick) hover:border-[color:var(--color-rule-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)]"
                    >
                      <span className="text-sm font-medium text-[color:var(--color-ink)]">
                        {t(`items.${item}.title`)}
                      </span>
                      <span className="text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                        {t(`items.${item}.detail`)}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </Section>
        ))}
      </div>
    </Page>
  );
}
