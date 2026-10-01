'use client';

import {
  DEFAULT_TRAVELER_WEIGHT,
  TRIP_CATEGORIES,
  type Proposal,
  type TripCategory,
} from '@app/trip-engine';
import { Button, Card, Field, Input, Select, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';

import { useRouter } from '@/i18n/navigation';
import { COUNTRIES, inferPlace } from '@/lib/places';
import { formatAmount } from '@/lib/trip-format';
import {
  confirmTripDocument,
  discardTripDocument,
  retryTripDocument,
  type ConfirmTripDocumentInput,
} from '@/server/trip-document-actions';

/**
 * Reviewing what the reader proposed.
 *
 * The document stays in view while the fields are checked; the ones the
 * reader was unsure about are marked. Confirming files it — a booking, an
 * expense, or a whole new trip from a ticket — in one step. Nothing was
 * written before this button.
 */

type Mode = 'flight' | 'lodging' | 'insurance' | 'expense';
type PaymentStatus = 'paid' | 'deposit_paid' | 'pay_later' | 'pay_on_site';

export interface ReviewData {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly status: string | null;
  readonly failure: string | null;
  readonly tripId: string | null;
  readonly url: string | null;
  readonly proposal: Proposal | null;
  readonly trips: readonly { id: string; name: string; startDate: string; endDate: string }[];
  readonly accounts: readonly { id: string; name: string }[];
  readonly legs: readonly { id: string; city: string; tripId: string; localCurrency: string }[];
  readonly travelers: readonly { id: string; displayName: string; tripId: string }[];
  readonly possibleDuplicates: readonly {
    kind: 'booking' | 'expense';
    label: string;
    date: string | null;
  }[];
  readonly rates: Readonly<Record<string, string>>;
}

const AMOUNT = /^\d{1,12}(\.\d{1,4})?$/;

function modeOf(kind: string | undefined): Mode {
  if (kind === 'flight_itinerary' || kind === 'boarding_pass') return 'flight';
  if (kind === 'lodging_confirmation') return 'lodging';
  if (kind === 'insurance_policy') return 'insurance';
  return 'expense';
}

export function DocumentReview({
  data,
  locale,
  currency,
  today,
}: {
  readonly data: ReviewData;
  readonly locale: string;
  readonly currency: string;
  readonly today: string;
}) {
  const t = useTranslations('trips.documents.review');
  const tc = useTranslations('trips.common');
  const te = useTranslations('trips.errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const p = data.proposal;
  const low = new Set(p?.lowConfidence ?? []);
  const lang = locale === 'en' ? 'en' : 'es';

  const [mode, setMode] = useState<Mode>(modeOf(p?.kind));
  const anchorDate = p?.day ?? p?.checkIn ?? p?.outbound ?? null;
  const fittingTrip = anchorDate
    ? data.trips.find((tr) => tr.startDate <= anchorDate && anchorDate <= tr.endDate)
    : undefined;
  const [tripChoice, setTripChoice] = useState<string>(
    data.tripId ??
      fittingTrip?.id ??
      (mode === 'flight' || mode === 'lodging' || data.trips.length === 0
        ? 'new'
        : (data.trips[0]?.id ?? 'new')),
  );

  const [provider, setProvider] = useState(p?.provider ?? '');
  const [reference, setReference] = useState(p?.referenceCode ?? '');
  const [amount, setAmount] = useState(p?.amount ?? '');
  const [docCurrency, setDocCurrency] = useState(p?.currency ?? currency);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    p?.payAtProperty
      ? 'pay_on_site'
      : p?.amountDue && p.amountDue !== '0'
        ? 'deposit_paid'
        : 'paid',
  );
  const [paidAmount, setPaidAmount] = useState(p?.amountPaid ?? '');
  const [dueDate, setDueDate] = useState(p?.dueDate ?? '');
  const [city, setCity] = useState(p?.city ?? p?.stays[0]?.city ?? '');
  const [checkIn, setCheckIn] = useState(p?.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(p?.checkOut ?? '');
  const [day, setDay] = useState(p?.day ?? today);
  const [lines, setLines] = useState<{ category: TripCategory; amount: string }[]>([
    { category: p?.category ?? 'other', amount: p?.amount ?? '' },
  ]);
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? '');
  const [recordPayment, setRecordPayment] = useState(false);
  const [paidBy, setPaidBy] = useState('');
  const [manualRate, setManualRate] = useState('');

  const startFromDoc = p?.outbound ?? p?.checkIn ?? today;
  const endFromDoc = p?.inbound ?? p?.checkOut ?? p?.stays[p.stays.length - 1]?.to ?? startFromDoc;
  const [newName, setNewName] = useState(
    `${p?.stays[0]?.city ?? p?.city ?? t('newTripDefault')} ${startFromDoc.slice(0, 4)}`,
  );
  const [newBudget, setNewBudget] = useState('');
  const [newStart, setNewStart] = useState(startFromDoc);
  const [newEnd, setNewEnd] = useState(endFromDoc);

  const rateFor = (code: string): string | null =>
    code === currency ? null : (data.rates[code] ?? null);
  const linesTotal = useMemo(() => {
    let cents = 0n;
    for (const line of lines) {
      if (!AMOUNT.test(line.amount)) continue;
      const [w = '0', f = ''] = line.amount.split('.');
      cents += BigInt(w) * 100n + BigInt((f + '00').slice(0, 2));
    }
    return `${String(cents / 100n)}.${String(cents % 100n).padStart(2, '0')}`;
  }, [lines]);

  const tripTravelers = data.travelers.filter((tr) => tr.tripId === tripChoice);
  const mark = (key: string) => (low.has(key) ? 'border-[color:var(--color-caution)]' : '');
  const doubt = (key: string) => (low.has(key) ? { hint: t('checkThis') } : {});

  const confirm = (thenScan: boolean) => {
    setError(null);
    if (!AMOUNT.test(amount) && mode !== 'expense') {
      setError('amount');
      return;
    }
    if (mode === 'expense' && (lines.some((l) => !AMOUNT.test(l.amount)) || !accountId)) {
      setError(accountId ? 'amount' : 'accountRequired');
      return;
    }
    if (tripChoice === 'new' && !AMOUNT.test(newBudget)) {
      setError('budgetRequired');
      return;
    }
    const fx =
      rateFor(docCurrency) ?? (/^\d{1,9}(\.\d{1,10})?$/.test(manualRate) ? manualRate : null);
    if (docCurrency !== currency && !fx) {
      setError('rateRequired');
      return;
    }
    const input: ConfirmTripDocumentInput = {
      tripId: tripChoice === 'new' ? null : tripChoice,
      createTrip:
        tripChoice === 'new'
          ? {
              name: newName.trim() || t('newTripDefault'),
              startDate: newStart,
              endDate: newEnd < newStart ? newStart : newEnd,
              totalBudget: newBudget,
              legs: (p?.stays.length
                ? p.stays
                : [{ city: city || t('newTripDefault'), iata: null, from: newStart, to: newEnd }]
              ).map((stay, i, all) => {
                const place = inferPlace(stay.city ?? '', p?.countryCode ?? null);
                const from = stay.from < newStart ? newStart : stay.from;
                const to = stay.to ?? all[i + 1]?.from ?? newEnd;
                return {
                  city: stay.city ?? stay.iata ?? t('newTripDefault'),
                  countryCode: place.countryCode,
                  arrivalDate: from,
                  departureDate: to > newEnd ? newEnd : to < from ? from : to,
                  localCurrency: place.currency ?? docCurrency,
                  costLevel: place.level,
                  timezone: place.timezone ?? 'America/Panama',
                  lodgingMode:
                    mode === 'lodging'
                      ? paymentStatus === 'pay_on_site'
                        ? 'pay_on_site'
                        : 'prepaid'
                      : 'undecided',
                };
              }),
              travelers: (p?.passengers ?? []).map((ps) => ({
                displayName: ps.name,
                travelerType: ps.type,
              })),
            }
          : null,
      lodging:
        mode === 'lodging' && city && checkIn && checkOut
          ? {
              city,
              checkIn,
              checkOut,
              lodgingMode: paymentStatus === 'pay_on_site' ? 'pay_on_site' : 'prepaid',
            }
          : null,
      booking:
        mode !== 'expense'
          ? {
              bookingType:
                mode === 'flight' ? 'flight' : mode === 'lodging' ? 'lodging' : 'insurance',
              provider: provider.trim() || null,
              referenceCode: reference.trim() || null,
              amount,
              currency: docCurrency,
              fxRate: fx,
              paymentStatus,
              paidAmount:
                paymentStatus === 'deposit_paid' && AMOUNT.test(paidAmount) ? paidAmount : '0',
              dueDate: paymentStatus !== 'paid' && dueDate ? dueDate : null,
              startsAt:
                (p?.outbound ?? (checkIn || null)) ? `${p?.outbound ?? checkIn}T12:00:00Z` : null,
              endsAt:
                (p?.inbound ?? (checkOut || null)) ? `${p?.inbound ?? checkOut}T12:00:00Z` : null,
              details: {
                segments: (p?.segments ?? []).map((s) => ({
                  from: s.fromIata,
                  to: s.toIata,
                  flight: s.flightNumber,
                  date: s.departure?.date ?? null,
                })),
                breakfastIncluded: p?.breakfastIncluded ?? null,
                cityTaxPending: p?.cityTaxPending ?? null,
                cancellationDeadline: p?.cancellationDeadline ?? null,
              },
              payment:
                recordPayment &&
                accountId &&
                (paymentStatus === 'paid' || paymentStatus === 'deposit_paid')
                  ? { accountId, paidOn: today }
                  : null,
            }
          : null,
      expense:
        mode === 'expense'
          ? {
              accountId,
              currency: docCurrency,
              fxRate: fx,
              tripDay: day,
              description: provider.trim() || null,
              paidByTravelerId: paidBy || null,
              lines,
            }
          : null,
    };
    start(async () => {
      const result = await confirmTripDocument(data.id, input, lang);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(
        thenScan ? `/trips/${result.created ?? ''}#documents` : `/trips/${result.created ?? ''}`,
      );
    });
  };

  const errorText = error
    ? t.has(`errors.${error}`)
      ? t(`errors.${error}`)
      : te.has(error)
        ? te(error)
        : te('saveFailed')
    : null;
  const currencies = [...new Set([currency, docCurrency, ...COUNTRIES.map((c) => c.currency)])];
  const confirmLabel =
    tripChoice === 'new'
      ? t('confirmNewTrip')
      : mode === 'expense'
        ? t('confirmExpense', { amount: formatAmount(linesTotal, docCurrency, locale) })
        : t('confirmBooking');

  return (
    <div className="@container grid gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pb-0">
      <Card padding="none" className="overflow-hidden lg:sticky lg:top-6 lg:self-start">
        {data.url ? (
          data.mimeType === 'application/pdf' ? (
            <object
              data={data.url}
              type="application/pdf"
              className="h-[60vh] w-full"
              aria-label={data.fileName}
            >
              <a href={data.url} target="_blank" rel="noreferrer" className="block p-6 underline">
                {t('openFile')}
              </a>
            </object>
          ) : (
            <img
              src={data.url}
              alt={t('documentAlt', { name: data.fileName })}
              className="max-h-[60vh] w-full bg-[color:var(--color-ground-sunk)] object-contain"
            />
          )
        ) : (
          <p className="p-6 text-sm text-[color:var(--color-ink-secondary)]">{t('noPreview')}</p>
        )}
      </Card>

      <div className="flex flex-col gap-6">
        {data.status === 'failed' || !p ? (
          <Card>
            <div className="flex flex-col gap-4">
              <Status tone="negative">{t('failed')}</Status>
              <p className="text-sm text-[color:var(--color-ink-secondary)]">
                {t(`failure.${data.failure ?? 'malformed'}`)}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  size="lg"
                  loading={pending}
                  onClick={() => {
                    start(async () => {
                      await retryTripDocument(data.id, lang);
                      router.refresh();
                    });
                  }}
                >
                  {t('retry')}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  disabled={pending}
                  onClick={() => {
                    start(async () => {
                      await discardTripDocument(data.id, lang);
                      router.push('/trips');
                    });
                  }}
                >
                  {t('discard')}
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-[color:var(--color-ink-secondary)]">
                {t('readAs', { confidence: Math.round(p.confidence * 100) })}
              </p>
              <div role="radiogroup" aria-label={t('kind')} className="flex flex-wrap gap-2">
                {(['flight', 'lodging', 'expense', 'insurance'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => {
                      setMode(m);
                    }}
                    className={`h-11 rounded-(--radius-md) border px-4 text-sm ${mode === m ? 'border-[color:var(--color-ink)] bg-[color:var(--color-brand-sunk)] font-medium' : 'border-[color:var(--color-rule)]'}`}
                  >
                    {t(`modes.${m}`)}
                  </button>
                ))}
              </div>
            </div>

            {data.possibleDuplicates.length > 0 && (
              <Card tone="sunk">
                <p className="text-sm font-medium">{t('duplicates')}</p>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {data.possibleDuplicates.map((d) => (
                    <li key={`${d.kind}-${d.label}-${d.date ?? ''}`}>
                      {d.label}
                      {d.date ? ` · ${d.date}` : ''}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {mode === 'flight' && p.segments.length > 0 && (
              <Card>
                <p className="mb-2 font-medium">{t('route')}</p>
                <ol className="flex flex-col gap-1 text-sm tabular-nums">
                  {p.segments.map((s, i) => (
                    <li key={`${s.flightNumber ?? ''}-${String(i)}`}>
                      {s.fromIata ?? s.fromCity} → {s.toIata ?? s.toCity} ·{' '}
                      {s.departure?.date ?? '—'}
                      {s.flightNumber ? ` · ${s.flightNumber}` : ''}
                      {s.toIata && p.layovers.includes(s.toIata) ? ` · ${t('layover')}` : ''}
                    </li>
                  ))}
                </ol>
              </Card>
            )}

            <Card>
              <div className="grid gap-4 @lg:grid-cols-2">
                <Field
                  label={mode === 'expense' ? t('merchant') : t('provider')}
                  {...doubt('provider')}
                >
                  {(f) => (
                    <Input
                      id={f.id}
                      className={`h-12 text-base ${mark('provider')}`}
                      value={provider}
                      maxLength={120}
                      onChange={(e) => {
                        setProvider(e.target.value);
                      }}
                    />
                  )}
                </Field>
                {mode !== 'expense' && (
                  <Field label={t('reference')}>
                    {(f) => (
                      <Input
                        id={f.id}
                        className="h-12 text-base"
                        value={reference}
                        maxLength={60}
                        onChange={(e) => {
                          setReference(e.target.value);
                        }}
                      />
                    )}
                  </Field>
                )}
                {mode !== 'expense' && (
                  <Field label={t('amount')} required {...doubt('totalAmount')}>
                    {(f) => (
                      <Input
                        id={f.id}
                        inputMode="decimal"
                        numeric
                        className={`h-12 text-base ${mark('totalAmount')}`}
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value.replace(/,/g, '.').replace(/[^\d.]/g, ''));
                        }}
                      />
                    )}
                  </Field>
                )}
                <Field label={t('currency')} {...doubt('currency')}>
                  {(f) => (
                    <Select
                      id={f.id}
                      className={`h-12 text-base ${mark('currency')}`}
                      value={docCurrency}
                      onChange={(e) => {
                        setDocCurrency(e.target.value);
                      }}
                    >
                      {currencies.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {docCurrency !== currency && !rateFor(docCurrency) && (
                  <Field
                    label={t('manualRate', { base: currency, currency: docCurrency })}
                    hint={t('manualRateHint')}
                    className="@lg:col-span-2"
                  >
                    {(f) => (
                      <Input
                        id={f.id}
                        aria-describedby={f.describedBy}
                        inputMode="decimal"
                        numeric
                        className="h-12 text-base"
                        value={manualRate}
                        onChange={(e) => {
                          setManualRate(e.target.value.replace(/,/g, '.').replace(/[^\d.]/g, ''));
                        }}
                      />
                    )}
                  </Field>
                )}

                {mode === 'lodging' && (
                  <>
                    <Field label={t('city')}>
                      {(f) => (
                        <Input
                          id={f.id}
                          className="h-12 text-base"
                          value={city}
                          onChange={(e) => {
                            setCity(e.target.value);
                          }}
                        />
                      )}
                    </Field>
                    <Field label={t('checkIn')} {...doubt('dates')}>
                      {(f) => (
                        <Input
                          id={f.id}
                          type="date"
                          className={`h-12 text-base ${mark('dates')}`}
                          value={checkIn}
                          onChange={(e) => {
                            setCheckIn(e.target.value);
                          }}
                        />
                      )}
                    </Field>
                    <Field label={t('checkOut')}>
                      {(f) => (
                        <Input
                          id={f.id}
                          type="date"
                          className={`h-12 text-base ${mark('dates')}`}
                          value={checkOut}
                          min={checkIn}
                          onChange={(e) => {
                            setCheckOut(e.target.value);
                          }}
                        />
                      )}
                    </Field>
                  </>
                )}

                {mode !== 'expense' && (
                  <>
                    <Field label={t('paymentStatus')}>
                      {(f) => (
                        <Select
                          id={f.id}
                          className="h-12 text-base"
                          value={paymentStatus}
                          onChange={(e) => {
                            setPaymentStatus(e.target.value as PaymentStatus);
                          }}
                        >
                          {(['paid', 'deposit_paid', 'pay_later', 'pay_on_site'] as const).map(
                            (s) => (
                              <option key={s} value={s}>
                                {tc(`paymentStatus.${s}`)}
                              </option>
                            ),
                          )}
                        </Select>
                      )}
                    </Field>
                    {paymentStatus === 'deposit_paid' && (
                      <Field label={t('paidAmount')}>
                        {(f) => (
                          <Input
                            id={f.id}
                            inputMode="decimal"
                            numeric
                            className="h-12 text-base"
                            value={paidAmount}
                            onChange={(e) => {
                              setPaidAmount(
                                e.target.value.replace(/,/g, '.').replace(/[^\d.]/g, ''),
                              );
                            }}
                          />
                        )}
                      </Field>
                    )}
                    {paymentStatus !== 'paid' && (
                      <Field label={t('dueDate')}>
                        {(f) => (
                          <Input
                            id={f.id}
                            type="date"
                            className="h-12 text-base"
                            value={dueDate}
                            onChange={(e) => {
                              setDueDate(e.target.value);
                            }}
                          />
                        )}
                      </Field>
                    )}
                  </>
                )}

                {mode === 'expense' && (
                  <>
                    <Field label={t('day')}>
                      {(f) => (
                        <Input
                          id={f.id}
                          type="date"
                          className="h-12 text-base"
                          value={day}
                          onChange={(e) => {
                            setDay(e.target.value);
                          }}
                        />
                      )}
                    </Field>
                    <fieldset className="flex flex-col gap-3 @lg:col-span-2">
                      <legend className="mb-1 text-sm font-medium">{t('lines')}</legend>
                      {lines.map((line, i) => (
                        <div
                          key={String(i)}
                          className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-end gap-2"
                        >
                          <Select
                            aria-label={t('category')}
                            className="h-12 text-base"
                            value={line.category}
                            onChange={(e) => {
                              setLines(
                                lines.map((l, k) =>
                                  k === i ? { ...l, category: e.target.value as TripCategory } : l,
                                ),
                              );
                            }}
                          >
                            {TRIP_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {tc(`category.${c}`)}
                              </option>
                            ))}
                          </Select>
                          <Input
                            aria-label={t('lineAmount')}
                            inputMode="decimal"
                            numeric
                            className={`h-12 text-base ${i === 0 ? mark('totalAmount') : ''}`}
                            value={line.amount}
                            onChange={(e) => {
                              setLines(
                                lines.map((l, k) =>
                                  k === i
                                    ? {
                                        ...l,
                                        amount: e.target.value
                                          .replace(/,/g, '.')
                                          .replace(/[^\d.]/g, ''),
                                      }
                                    : l,
                                ),
                              );
                            }}
                          />
                          {lines.length > 1 ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-12"
                              onClick={() => {
                                setLines(lines.filter((_, k) => k !== i));
                              }}
                            >
                              {t('removeLine')}
                            </Button>
                          ) : (
                            <span />
                          )}
                        </div>
                      ))}
                      {lines.length < 6 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 self-start"
                          onClick={() => {
                            setLines([...lines, { category: 'shopping', amount: '' }]);
                          }}
                        >
                          {t('addLine')}
                        </Button>
                      )}
                      {p.tip && (
                        <p className="text-sm text-[color:var(--color-ink-secondary)]">
                          {t('tipIncluded', { amount: formatAmount(p.tip, docCurrency, locale) })}
                        </p>
                      )}
                    </fieldset>
                    {tripTravelers.length > 1 && (
                      <Field label={t('paidBy')}>
                        {(f) => (
                          <Select
                            id={f.id}
                            className="h-12 text-base"
                            value={paidBy}
                            onChange={(e) => {
                              setPaidBy(e.target.value);
                            }}
                          >
                            <option value="">{t('paidByNone')}</option>
                            {tripTravelers.map((tr) => (
                              <option key={tr.id} value={tr.id}>
                                {tr.displayName}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    )}
                  </>
                )}

                {(mode === 'expense' ||
                  ((paymentStatus === 'paid' || paymentStatus === 'deposit_paid') &&
                    data.accounts.length > 0)) && (
                  <div className="flex flex-col gap-3 @lg:col-span-2">
                    {mode !== 'expense' && (
                      <label className="flex min-h-11 items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-[color:var(--color-panel)]"
                          checked={recordPayment}
                          onChange={(e) => {
                            setRecordPayment(e.target.checked);
                          }}
                        />
                        <span>{t('recordPayment')}</span>
                      </label>
                    )}
                    {(mode === 'expense' || recordPayment) && (
                      <Field label={t('account')} required={mode === 'expense'}>
                        {(f) => (
                          <Select
                            id={f.id}
                            className="h-12 text-base"
                            value={accountId}
                            onChange={(e) => {
                              setAccountId(e.target.value);
                            }}
                          >
                            {data.accounts.length === 0 && (
                              <option value="">{t('noAccounts')}</option>
                            )}
                            {data.accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    )}
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <div className="grid gap-4 @lg:grid-cols-2">
                <Field label={t('trip')} className="@lg:col-span-2">
                  {(f) => (
                    <Select
                      id={f.id}
                      className="h-12 text-base"
                      value={tripChoice}
                      onChange={(e) => {
                        setTripChoice(e.target.value);
                      }}
                    >
                      {data.trips.map((tr) => (
                        <option key={tr.id} value={tr.id}>
                          {tr.name}
                        </option>
                      ))}
                      <option value="new">{t('newTrip')}</option>
                    </Select>
                  )}
                </Field>
                {tripChoice === 'new' && (
                  <>
                    <Field label={t('newTripName')} className="@lg:col-span-2">
                      {(f) => (
                        <Input
                          id={f.id}
                          className="h-12 text-base"
                          value={newName}
                          maxLength={120}
                          onChange={(e) => {
                            setNewName(e.target.value);
                          }}
                        />
                      )}
                    </Field>
                    <Field label={t('newTripStart')}>
                      {(f) => (
                        <Input
                          id={f.id}
                          type="date"
                          className="h-12 text-base"
                          value={newStart}
                          onChange={(e) => {
                            setNewStart(e.target.value);
                          }}
                        />
                      )}
                    </Field>
                    <Field label={t('newTripEnd')}>
                      {(f) => (
                        <Input
                          id={f.id}
                          type="date"
                          className="h-12 text-base"
                          value={newEnd}
                          min={newStart}
                          onChange={(e) => {
                            setNewEnd(e.target.value);
                          }}
                        />
                      )}
                    </Field>
                    <Field
                      label={t('newTripBudget', { currency })}
                      hint={t('newTripBudgetHint')}
                      required
                      className="@lg:col-span-2"
                    >
                      {(f) => (
                        <Input
                          id={f.id}
                          aria-describedby={f.describedBy}
                          inputMode="decimal"
                          numeric
                          className="h-12 text-base"
                          value={newBudget}
                          onChange={(e) => {
                            setNewBudget(e.target.value.replace(/,/g, '.').replace(/[^\d.]/g, ''));
                          }}
                        />
                      )}
                    </Field>
                    {p.passengers.length > 0 && (
                      <p className="text-sm text-[color:var(--color-ink-secondary)] @lg:col-span-2">
                        {t('travelersFound', {
                          names: p.passengers.map((ps) => ps.name).join(', '),
                          weight: DEFAULT_TRAVELER_WEIGHT.adult,
                        })}
                      </p>
                    )}
                  </>
                )}
              </div>
            </Card>

            {errorText && (
              <p role="alert" className="text-sm text-[color:var(--color-negative)]">
                {errorText}
              </p>
            )}

            <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[color:var(--color-rule)] bg-[color:var(--color-ground-raised)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:static lg:border-0 lg:bg-transparent lg:p-0">
              <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  loading={pending}
                  className="min-w-0 flex-1 @lg:flex-none"
                  onClick={() => {
                    confirm(false);
                  }}
                >
                  <span className="truncate">{confirmLabel}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={pending}
                  className="hidden @lg:inline-flex"
                  onClick={() => {
                    confirm(true);
                  }}
                >
                  {t('confirmAndScan')}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  disabled={pending}
                  onClick={() => {
                    start(async () => {
                      await discardTripDocument(data.id, lang);
                      router.push('/trips');
                    });
                  }}
                >
                  {t('discard')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
