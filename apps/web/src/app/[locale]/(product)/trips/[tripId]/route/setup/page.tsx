import { Page, PageHeader } from '@app/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RumboSetup, type SetupData } from '@/components/rumbo/rumbo-setup';
import { DocumentList, DocumentUpload } from '@/components/trips/document-upload';
import { Link } from '@/i18n/navigation';
import { countryOptions } from '@/lib/countries';
import { loadHouseholdContext } from '@/server/household-context';
import { loadTripDocuments, tripsEnabled } from '@/server/repositories/trips';
import { loadRumbo } from '@/server/rumbo';
import { requireHousehold } from '@/server/session';

/**
 * «Armar el viaje»: travellers, what does not move, the tickets, the wishes
 * and the driving limits. Every step writes as it goes; the last one
 * composes the trip.
 */
export default async function RumboSetupPage({
  params,
}: {
  params: Promise<{ locale: string; tripId: string }>;
}) {
  const { locale, tripId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  if (!(await tripsEnabled(session, session.activeHouseholdId))) notFound();
  if (!/^[0-9a-f-]{36}$/.test(tripId)) notFound();
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const t = await getTranslations('rumbo');
  const view = await loadRumbo(session, session.activeHouseholdId, tripId, context.today);
  if (!view) notFound();
  const documents = await loadTripDocuments(session, session.activeHouseholdId, tripId);

  const data: SetupData = {
    tripId,
    start: view.trip.start,
    end: view.trip.end,
    currency: view.trip.baseCurrency,
    composed: view.itinerary !== null,
    travelers: view.travelers.map((tr) => ({
      id: tr.id,
      name: tr.name,
      nationalities: tr.nationalities,
      residence: tr.residence ?? null,
    })),
    anchors: view.anchors.map((a) => ({
      id: a.id,
      kind: a.kind,
      placeName: a.placeName,
      from: a.from,
      to: a.to,
      label: a.label ?? null,
    })),
    flights: view.flights.map((f) => ({
      id: f.id,
      route: `${f.from} → ${f.to}`,
      departsDate: f.departs.date,
      departsTime: f.departs.time,
      departsCertainty: f.departsCertainty,
      arrivesDate: f.arrives.date,
      arrivesTime: f.arrives.time,
      arrivesCertainty: f.arrivesCertainty,
    })),
    wishes: view.wishes.map((w) => ({
      id: w.id,
      text: w.text,
      tags: w.tags,
      matched: w.outcome ? w.outcome.corridorId !== null : null,
    })),
    countries: countryOptions(locale),
    settings: {
      drivingBudget: view.trip.drivingBudget,
      departureTime: view.trip.departureTime,
      lodgingCap: view.trip.lodgingCap,
      breakfast: false,
      parking: false,
    },
  };

  return (
    <Page>
      <div className="mb-6">
        <Link
          href={view.itinerary ? `/trips/${tripId}/route` : `/trips/${tripId}`}
          className="inline-flex min-h-11 items-center text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)]"
        >
          {view.itinerary ? t('title') : t('backToTrip')}
        </Link>
      </div>
      <PageHeader title={t('setup.title')} detail={`${view.trip.name} · ${t('setup.detail')}`} />
      <RumboSetup
        data={data}
        documents={
          <div className="flex flex-col gap-4">
            <DocumentUpload tripId={tripId} locale={locale} primary />
            <DocumentList documents={documents} locale={locale} />
          </div>
        }
      />
    </Page>
  );
}
