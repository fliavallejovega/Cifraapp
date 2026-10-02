import { Page, PageHeader } from '@app/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TripWizard, type WizardPerson } from '@/components/trips/trip-wizard';
import { Link } from '@/i18n/navigation';
import { copilotIsConfigured } from '@/server/ai';
import { loadHouseholdContext } from '@/server/household-context';
import { loadPeople } from '@/server/repositories/administration';
import { loadLatestRates, tripsEnabled } from '@/server/repositories/trips';
import { requireHousehold } from '@/server/session';

/**
 * A new trip. The household's people arrive as travellers already ticked —
 * most trips are the family — with children and infants typed from their
 * birth year, and the latest exchange rates so every per diem the wizard
 * previews is the one the trip will show.
 */
export default async function NewTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { locale } = await params;
  const { from } = await searchParams;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  if (!(await tripsEnabled(session, session.activeHouseholdId))) notFound();
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const t = await getTranslations('trips');

  const [people, rates] = await Promise.all([
    loadPeople(session, session.activeHouseholdId),
    loadLatestRates(session, context.currency),
  ]);
  const year = Number(context.today.slice(0, 4));
  const travelers: WizardPerson[] = people.map((person) => {
    const age = person.birthYear ? year - person.birthYear : null;
    const type =
      age !== null && age < 2
        ? 'infant'
        : age !== null && age < 12
          ? 'child'
          : person.relationship === 'child' && age === null
            ? 'child'
            : 'adult';
    return { id: person.id, name: person.displayName, type };
  });

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/trips"
          className="inline-flex min-h-11 items-center text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)]"
        >
          {t('backToList')}
        </Link>
      </div>
      <PageHeader title={t('wizard.title')} />
      <div className="mx-auto w-full max-w-3xl">
        <TripWizard
          locale={locale}
          currency={context.currency}
          today={context.today}
          people={travelers}
          rates={rates}
          from={from === 'budget' || from === 'documents' ? from : null}
          quickCreate={copilotIsConfigured()}
        />
      </div>
    </Page>
  );
}
