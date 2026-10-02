import { formatMoney, type Money } from '@app/domain';
import type { TripBudget } from '@app/trip-engine';
import { Card, EmptyState, Page, PageHeader, Section, Status } from '@app/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BookingManager } from '@/components/trips/booking-manager';
import { CashWithdrawal } from '@/components/trips/cash-withdrawal';
import { DocumentList, DocumentUpload } from '@/components/trips/document-upload';
import {
  ChecklistPanel,
  PerDiemPanel,
  SaveForTripButton,
  ScenarioPanel,
} from '@/components/trips/dashboard-parts';
import { TripSetup } from '@/components/trips/trip-setup';
import { Link } from '@/i18n/navigation';
import { daysFrom, formatAmount, formatDateRange, formatDay, shareOf } from '@/lib/trip-format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadTripDashboard, loadTripDocuments, tripsEnabled } from '@/server/repositories/trips';
import { requireHousehold } from '@/server/session';

/**
 * One trip, before it starts: what each day can spend, what is already
 * committed, whether the saving plan fits, and what is left to do.
 *
 * The headline is the per diem, read out against the trip's dates. Below it,
 * only what explains or changes that number — the money's breakdown, the
 * goal, the bookings, the what-ifs — and at the bottom, folded away, the
 * settings. Once the trip starts, the headline becomes «today you can spend»
 * and points to the trip mode.
 */
export default async function TripPage({
  params,
}: {
  params: Promise<{ locale: string; tripId: string }>;
}) {
  const { locale, tripId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  if (!(await tripsEnabled(session, session.activeHouseholdId))) notFound();
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const t = await getTranslations('trips');
  const tr = await getTranslations('rumbo');

  const data = /^[0-9a-f-]{36}$/.test(tripId)
    ? await loadTripDashboard(
        session,
        session.activeHouseholdId,
        tripId,
        context.today,
        context.currency,
      )
    : null;

  if (!data) {
    return (
      <Page>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState
            title={t('notFound.title')}
            body={t('notFound.body')}
            action={
              <Link
                href="/trips"
                className="text-sm font-medium underline decoration-[color:var(--color-rule-strong)] underline-offset-4"
              >
                {t('backToList')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  const { trip, budget } = data;
  const tripDocuments = await loadTripDocuments(session, session.activeHouseholdId, trip.id);
  const currency = trip.baseCurrency.trim();
  const money = (value: string) => formatAmount(value, currency, locale);
  const m = (value: Money) => formatMoney(value, { locale: context.moneyLocale });
  const days = daysFrom(context.today, trip.startDate);
  const firstLeg = budget.legs[0];
  const firstLegRow = data.legs[0];
  const localCode = firstLegRow?.localCurrency.trim() ?? currency;
  const lang = locale === 'en' ? 'en' : 'es';

  const header = [
    data.legs.map((leg) => leg.city).join(' · '),
    formatDateRange(trip.startDate, trip.endDate, locale),
    t('dashboard.travelers', { count: data.travelers.length }),
  ]
    .filter(Boolean)
    .join(' — ');

  const primary =
    budget.phase === 'during' ? (
      <Link href={`/trips/${trip.id}/today`} className={PRIMARY}>
        {t('dashboard.openToday')}
      </Link>
    ) : budget.phase === 'after' ? (
      <Link href={`/trips/${trip.id}/report`} className={PRIMARY}>
        {t('dashboard.openReport')}
      </Link>
    ) : null;

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
      <PageHeader title={trip.name} detail={header} actions={primary} />

      {/* The headline reading. */}
      <Card tone="panel" padding="lg">
        <div className="flex flex-col gap-3">
          {budget.phase === 'during' && budget.today ? (
            <>
              <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
                {t('dashboard.hero.todayLabel')}
              </p>
              <p className="readout text-4xl tracking-[-0.03em] tabular-nums sm:text-5xl">
                {money(budget.today.remaining)}
              </p>
              <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
                {t('dashboard.hero.todayDetail', {
                  spent: money(budget.today.spent),
                  allowed: money(budget.today.allowed),
                })}
              </p>
            </>
          ) : budget.phase === 'after' ? (
            <>
              <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
                {t('dashboard.hero.afterLabel')}
              </p>
              <p className="readout text-4xl tracking-[-0.03em] tabular-nums sm:text-5xl">
                {money(budget.spent.total)}
              </p>
              <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
                {t('dashboard.hero.afterDetail', { planned: money(budget.fundForDays) })}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
                {t('dashboard.hero.perDayLabel')}
              </p>
              <p className="readout text-4xl tracking-[-0.03em] tabular-nums sm:text-5xl">
                {firstLeg?.perDiemFull ? money(firstLeg.perDiemFull) : '—'}
              </p>
              {firstLeg?.perDiemFullLocal && localCode !== currency && (
                <p className="text-[color:var(--color-panel-ink-secondary)] tabular-nums">
                  {formatAmount(firstLeg.perDiemFullLocal, localCode, locale)}
                </p>
              )}
              <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
                {days > 0
                  ? t('dashboard.hero.countdown', { days })
                  : t('dashboard.hero.startsToday')}
                {data.legs.length > 1
                  ? ` · ${t('dashboard.hero.firstLeg', { city: firstLegRow?.city ?? '' })}`
                  : ''}
              </p>
            </>
          )}
        </div>
      </Card>
      <div className="mt-3">
        <DiagnosticStatus budget={budget} money={money} t={t} />
      </div>

      <Diagnostics
        budget={budget}
        money={money}
        t={t}
        legs={data.legs.map((l) => ({ id: l.id, city: l.city }))}
      />

      <Card className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium">{tr('tripLink.title')}</p>
            <p className="max-w-[60ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {tr('tripLink.body')}
            </p>
          </div>
          <Link
            href={`/trips/${trip.id}/route`}
            className="inline-flex min-h-11 items-center justify-center rounded-(--radius-md) border border-[color:var(--color-rule-strong)] px-4 text-sm font-medium hover:border-[color:var(--color-ink)]"
          >
            {tr('tripLink.cta')}
          </Link>
        </div>
      </Card>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex flex-col gap-4">
            <p className="font-medium">{t('dashboard.savings.title')}</p>
            {data.goal ? (
              <>
                <div className="flex flex-col gap-2">
                  <div
                    className="h-2 overflow-hidden rounded-full bg-[color:var(--color-ground-sunk)]"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(shareOf(data.goal.current, data.goal.target))}
                    aria-label={t('dashboard.savings.progress', {
                      saved: money(data.goal.current),
                      target: money(data.goal.target),
                    })}
                  >
                    <div
                      className="h-full origin-left rounded-full bg-[color:var(--color-brand)]"
                      style={{
                        transform: `scaleX(${String(shareOf(data.goal.current, data.goal.target) / 100)})`,
                      }}
                    />
                  </div>
                  <p className="text-sm tabular-nums">
                    {t('dashboard.savings.progress', {
                      saved: money(data.goal.current),
                      target: money(data.goal.target),
                    })}
                  </p>
                </div>
                {data.goal.plan && (
                  <>
                    <p className="readout text-2xl tabular-nums">
                      {t('dashboard.savings.monthly', {
                        amount: m(data.goal.plan.monthly),
                        months: data.goal.plan.months,
                      })}
                    </p>
                    {data.goal.plan.light === 'green' && (
                      <Status tone="positive">{t('dashboard.savings.green')}</Status>
                    )}
                    {data.goal.plan.light === 'yellow' && (
                      <Status tone="caution">
                        {t('dashboard.savings.yellow', {
                          amount: m(data.goal.plan.squeeze ?? data.goal.plan.monthly),
                        })}
                      </Status>
                    )}
                    {data.goal.plan.light === 'red' && (
                      <div className="flex flex-col gap-2">
                        <Status tone="negative">
                          {t('dashboard.savings.red', { free: m(data.goal.plan.free) })}
                        </Status>
                        <ul className="list-disc pl-5 text-sm text-[color:var(--color-ink-secondary)]">
                          {data.goal.plan.monthsNeeded !== null && (
                            <li>
                              {t('dashboard.savings.moreMonths', {
                                months: data.goal.plan.monthsNeeded - data.goal.plan.months,
                              })}
                            </li>
                          )}
                          {data.goal.plan.affordableTotal && (
                            <li>
                              {t('dashboard.savings.lowerFund', {
                                amount: m(data.goal.plan.affordableTotal),
                              })}
                            </li>
                          )}
                          <li>{t('dashboard.savings.economy')}</li>
                        </ul>
                      </div>
                    )}
                  </>
                )}
                <Link
                  href={`/goals/${data.goal.id}`}
                  className="text-sm underline decoration-[color:var(--color-rule-strong)] underline-offset-4"
                >
                  {t('dashboard.savings.openGoal')}
                </Link>
              </>
            ) : budget.phase === 'before' ? (
              <>
                <p className="text-sm text-[color:var(--color-ink-secondary)]">
                  {t('dashboard.savings.none')}
                </p>
                <SaveForTripButton tripId={trip.id} locale={locale} />
              </>
            ) : (
              <p className="text-sm text-[color:var(--color-ink-secondary)]">
                {t('dashboard.savings.notApplicable')}
              </p>
            )}
          </div>
        </Card>

        <CostCard budget={budget} money={money} t={t} />
      </div>
      {data.exchangeEffect !== '0.00' && (
        <div className="mt-4">
          <Status tone={data.exchangeEffect.startsWith('-') ? 'positive' : 'caution'}>
            {t(data.exchangeEffect.startsWith('-') ? 'cash.effectCheaper' : 'cash.effectDearer', {
              amount: money(data.exchangeEffect.replace(/^-/, '')),
            })}
          </Status>
        </div>
      )}

      <Section
        title={t('dashboard.perDiem.title')}
        detail={t('dashboard.perDiem.detail')}
        className="mt-12"
      >
        <PerDiemPanel
          budget={budget}
          legs={data.legs.map((leg) => ({
            id: leg.id,
            city: leg.city,
            localCurrency: leg.localCurrency.trim(),
            rate:
              leg.localCurrency.trim() === currency
                ? null
                : (trip.planningFx[leg.localCurrency.trim()]?.rate ??
                  data.rates.get(leg.localCurrency.trim()) ??
                  null),
          }))}
          travelers={data.travelers.map((tr) => ({ id: tr.id, displayName: tr.displayName }))}
          currency={currency}
          locale={locale}
        />
      </Section>

      <Section
        title={t('dashboard.bookings.title')}
        detail={t('dashboard.bookings.detail')}
        className="mt-12"
      >
        <BookingManager
          tripId={trip.id}
          bookings={data.bookings.map((b) => ({
            id: b.id,
            bookingType: b.bookingType,
            provider: b.provider,
            referenceCode: b.referenceCode,
            amount: b.amount,
            currency: b.currency.trim(),
            amountBase: b.amountBase,
            paymentStatus: b.paymentStatus,
            paidAmount: b.paidAmount,
            dueDate: b.dueDate,
            legId: b.legId,
            hasMovement: b.transactionId !== null,
          }))}
          legs={data.legs.map((l) => ({ id: l.id, city: l.city }))}
          accounts={data.accounts
            .filter((a) => a.currency.trim() === currency)
            .map((a) => ({ id: a.id, name: a.name }))}
          currencies={[...new Set([currency, ...data.legs.map((l) => l.localCurrency.trim())])]}
          baseCurrency={currency}
          today={context.today}
          locale={locale}
        />
      </Section>

      <Section title={t('cash.title')} detail={t('cash.detail')} className="mt-12">
        <CashWithdrawal
          tripId={trip.id}
          accounts={data.accounts
            .filter((a) => a.currency.trim() === currency && a.id !== trip.cashAccountId)
            .map((a) => ({ id: a.id, name: a.name }))}
          currencies={[...new Set(data.legs.map((l) => l.localCurrency.trim()))]}
          defaultCurrency={
            data.legs.find((l) => l.localCurrency.trim() !== currency)?.localCurrency.trim() ??
            currency
          }
          baseCurrency={currency}
          today={context.today}
          locale={locale}
          withdrawals={data.withdrawals.map((w) => ({
            id: w.id,
            originalAmount: w.originalAmount,
            originalCurrency: w.originalCurrency?.trim() ?? null,
            amount: w.amount,
            date: w.date,
          }))}
        />
      </Section>

      <section id="documents" className="mt-12 scroll-mt-6">
        <Section title={t('documents.title')} detail={t('documents.detail')}>
          <Card>
            <div className="@container flex flex-col gap-6">
              <DocumentUpload tripId={trip.id} locale={locale} />
              <DocumentList documents={tripDocuments} locale={locale} />
            </div>
          </Card>
        </Section>
      </section>

      <Section
        title={t('dashboard.scenarios.title')}
        detail={t('dashboard.scenarios.detail')}
        className="mt-12"
      >
        <ScenarioPanel
          tripId={trip.id}
          activeId={trip.activeScenarioId}
          base={{
            total: trip.totalBudget,
            perDiem: firstLeg?.perDiemFull ?? null,
            status: budget.diagnostics.status,
          }}
          scenarios={data.scenarioBudgets.map((s) => ({
            id: s.id,
            name: s.name,
            total: s.budget.totalBudget,
            perDiem: s.budget.legs[0]?.perDiemFull ?? null,
            status: s.budget.diagnostics.status,
          }))}
          currency={currency}
          locale={locale}
        />
      </Section>

      <Section title={t('dashboard.checklist.title')} className="mt-12">
        <ChecklistPanel
          tripId={trip.id}
          locale={lang}
          items={data.checklist.map((item) => ({
            id: item.id,
            title:
              item.customTitle ??
              t(`checklist.${item.kind}`, { provider: item.titleParams['provider'] ?? '' }),
            dueOn: item.dueOn,
            due: item.dueOn
              ? t('dashboard.checklist.dueOn', {
                  date: formatDay(item.dueOn, locale, { day: 'numeric', month: 'long' }),
                })
              : null,
            done: item.doneAt !== null,
          }))}
        />
      </Section>

      <details className="group mt-12">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between rounded-(--radius-md) border border-[color:var(--color-rule)] px-4 text-base font-medium">
          {t('dashboard.setup.title')}
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            ⌄
          </span>
        </summary>
        <div className="mt-4">
          <TripSetup
            trip={{
              id: trip.id,
              name: trip.name,
              startDate: trip.startDate,
              endDate: trip.endDate,
              totalBudget: trip.totalBudget,
              alreadySaved: trip.alreadySaved,
              contingencyType: trip.contingencyType,
              contingencyValue: trip.contingencyValue,
              profile: trip.profile,
              customShares: trip.customShares ?? null,
              includeArrivalDay: trip.includeArrivalDay,
              includeDepartureDay: trip.includeDepartureDay,
              partialDayWeight: trip.partialDayWeight,
              rollingPolicy: trip.rollingPolicy,
            }}
            legs={data.legs.map((leg) => ({
              id: leg.id,
              city: leg.city,
              countryCode: leg.countryCode?.trim() ?? null,
              arrivalDate: leg.arrivalDate,
              departureDate: leg.departureDate,
              localCurrency: leg.localCurrency.trim(),
              costLevel: leg.costLevel,
              timezone: leg.timezone,
              lodgingMode: leg.lodgingMode,
            }))}
            travelers={data.travelers.map((tr) => ({
              id: tr.id,
              displayName: tr.displayName,
              travelerType: tr.travelerType,
            }))}
            currency={currency}
            locale={locale}
          />
        </div>
      </details>
    </Page>
  );
}

const PRIMARY =
  'inline-flex h-12 items-center justify-center rounded-(--radius-md) bg-[color:var(--color-panel)] px-6 text-base font-medium text-[color:var(--color-panel-ink)] shadow-(--shadow-card) hover:bg-[color:var(--color-panel-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)]';

type T = Awaited<ReturnType<typeof getTranslations<'trips'>>>;

function DiagnosticStatus({
  budget,
  money,
  t,
}: {
  budget: TripBudget;
  money: (v: string) => string;
  t: T;
}) {
  const { status, shortfall } = budget.diagnostics;
  if (status === 'healthy') return <Status tone="positive">{t('diagnostics.healthy')}</Status>;
  if (status === 'tight') return <Status tone="caution">{t('diagnostics.tight')}</Status>;
  return <Status tone="negative">{t('diagnostics.deficit', { amount: money(shortfall) })}</Status>;
}

/** What the engine noticed, in words: suggestions with their numbers, then warnings. */
function Diagnostics({
  budget,
  money,
  t,
  legs,
}: {
  budget: TripBudget;
  money: (v: string) => string;
  t: T;
  legs: readonly { id: string; city: string }[];
}) {
  const city = (id: string) => legs.find((l) => l.id === id)?.city ?? '';
  const suggestions = budget.diagnostics.suggestions.map((s) => {
    switch (s.kind) {
      case 'add_money':
        return s.months !== null
          ? t('diagnostics.addMoneyMonths', { amount: money(s.amount), months: s.months })
          : t('diagnostics.addMoney', { amount: money(s.amount) });
      case 'lower_reserve':
        return t('diagnostics.lowerReserve', { percent: s.percent, amount: money(s.frees) });
      case 'fewer_days':
        return t('diagnostics.fewerDays', { days: s.days });
      case 'economy_profile':
        return t('diagnostics.economy', { amount: money(s.saves) });
      case 'use_reserve':
        return t('diagnostics.useReserve', { amount: money(s.amount) });
    }
  });
  const warnings = budget.diagnostics.warnings.flatMap((w) => {
    switch (w.kind) {
      case 'booking_outside_trip':
        return [t('diagnostics.warnings.bookingOutside')];
      case 'lodging_undecided':
        return [t('diagnostics.warnings.lodging', { city: city(w.legId), nights: w.nights })];
      case 'missing_fx':
        return [t('diagnostics.warnings.missingFx', { city: city(w.legId), currency: w.currency })];
      case 'days_without_leg':
        return [t('diagnostics.warnings.daysWithoutLeg', { days: w.days })];
      case 'no_legs':
        return [t('diagnostics.warnings.noLegs')];
      case 'overrides_exceed_fund':
        return [t('diagnostics.warnings.overrides', { amount: money(w.excess) })];
      case 'no_travelers':
        return [t('diagnostics.warnings.noTravelers')];
    }
  });
  const below = budget.diagnostics.belowReference.map((b) =>
    t('diagnostics.belowReference', {
      city: city(b.legId),
      amount: money(b.perPerson),
      reference: money(b.reference),
    }),
  );
  if (suggestions.length + warnings.length + below.length === 0) return null;
  return (
    <Card className="mt-4">
      <div className="flex flex-col gap-3 text-sm">
        {below.map((text) => (
          <p key={text}>{text}</p>
        ))}
        {suggestions.length > 0 && (
          <div>
            <p className="font-medium">{t('diagnostics.suggestionsTitle')}</p>
            <ul className="mt-1 list-disc pl-5">
              {suggestions.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1 text-[color:var(--color-ink-secondary)]">
            {warnings.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-[color:var(--color-ink-tertiary)]">
          {t('diagnostics.engine', { version: budget.engineVersion })}
        </p>
      </div>
    </Card>
  );
}

/** Where the whole fund goes: already committed, still owed, set aside, and the days. */
function CostCard({
  budget,
  money,
  t,
}: {
  budget: TripBudget;
  money: (v: string) => string;
  t: T;
}) {
  const parts = [
    { key: 'prepaid', value: budget.commitments.prepaid, tone: 'bg-[color:var(--color-ink)]' },
    {
      key: 'pending',
      value: budget.commitments.pending,
      tone: 'bg-[color:var(--color-ink-tertiary)]',
    },
    {
      key: 'reserve',
      value: budget.reserve.available,
      tone: 'bg-[color:var(--color-rule-strong)]',
    },
    {
      key: 'days',
      value: budget.fundForDays.startsWith('-') ? '0' : budget.fundForDays,
      tone: 'bg-[color:var(--color-brand)]',
    },
  ] as const;
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-medium">{t('dashboard.cost.title')}</p>
          <p className="readout tabular-nums">{money(budget.totalBudget)}</p>
        </div>
        <div
          className="flex h-3 overflow-hidden rounded-full bg-[color:var(--color-ground-sunk)]"
          aria-hidden="true"
        >
          {parts.map((p) => (
            <span
              key={p.key}
              className={`h-full ${p.tone}`}
              style={{ width: `${String(shareOf(p.value, budget.totalBudget))}%` }}
            />
          ))}
        </div>
        <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
          {parts.map((p) => (
            <div key={p.key} className="contents">
              <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${p.tone}`} />
              <dt>{t(`dashboard.cost.${p.key}`)}</dt>
              <dd className="text-right tabular-nums">{money(p.value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}
