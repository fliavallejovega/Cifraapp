import 'server-only';

import { parseOutput, toJsonSchema, type ObjectShape, type StructuredOutput } from '@app/ai';
import { getAdminDb } from '@app/database';
import { aiInvocations, documents, trips, tripLegs } from '@app/database/schema';
import { newId, toPlainDate, todayIn } from '@app/domain';
import { normalizeExtraction, type RawExtraction } from '@app/trip-engine';
import { getServerEnv } from '@app/validation/env';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { buildProvider } from './ai';
import { enqueueJob, registerJobHandler } from './jobs';
import { queryAsUser, type Session } from './session';
import { buildStorageKey, putDocument, readDocument } from './storage';

/**
 * Travel documents: tickets, hotel confirmations and receipts, read by the
 * same provider, stored in the same bucket and queued on the same job table
 * as bank statements. There is no second pipeline — only a second prompt.
 *
 * The model transcribes. Everything after — amounts, currencies, dates, which
 * stops are layovers, which numbers must not be kept — is deterministic code
 * in `@app/trip-engine`. Nothing reaches the books until a person confirms the
 * proposal on the review screen.
 */

export const TRIP_DOCUMENT_JOB = 'trip_document';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_MODEL_BYTES = 5 * 1024 * 1024;
const PROMPT_ID = 'trip-document-v1';

export const TRIP_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const text = (description: string, maxLength = 120) =>
  ({ kind: 'text', description, maxLength }) as const;

const SHAPE = {
  kind: {
    kind: 'choice',
    description: 'What this document is.',
    options: [
      'flight_itinerary',
      'boarding_pass',
      'lodging_confirmation',
      'receipt',
      'invoice',
      'ticket',
      'insurance_policy',
      'other',
    ],
  },
  kind_confidence: {
    kind: 'number',
    description: 'How sure you are of the kind, 0 to 1.',
    minimum: 0,
    maximum: 1,
  },
  provider: text('Airline, hotel, platform or merchant name as printed. Empty if absent.'),
  reference_code: text(
    'Booking reference, PNR or confirmation code as printed. Empty if absent.',
    40,
  ),
  total_amount: text(
    'The total to pay as printed, with its symbol and separators: "1.234,56 €", "$85.900". Never compute it.',
    40,
  ),
  currency_text: text('Currency symbol or code as printed next to the total. Empty if none.', 12),
  amount_paid: text('Amount already paid as printed, if the document says. Empty otherwise.', 40),
  amount_due: text('Balance still to pay as printed, if the document says. Empty otherwise.', 40),
  due_date: text('When the balance is due, as printed. Empty if not stated.', 40),
  city: text('City of the hotel, merchant or destination, as printed.'),
  country: text(
    'ISO 3166 two-letter country code if you can tell it from the address, else empty.',
    2,
  ),
  check_in: text('Lodging check-in date as printed.', 60),
  check_out: text('Lodging check-out date as printed.', 60),
  guests: text('Number of guests as printed.', 20),
  pay_at_property: {
    kind: 'choice',
    description: 'Whether lodging is paid at the property.',
    options: ['yes', 'no', 'unknown'],
  },
  city_tax_pending: {
    kind: 'choice',
    description: 'Whether a city or tourist tax is still to be paid there.',
    options: ['yes', 'no', 'unknown'],
  },
  breakfast_included: {
    kind: 'choice',
    description: 'Whether breakfast is included.',
    options: ['yes', 'no', 'unknown'],
  },
  cancellation_deadline: text('Free-cancellation deadline as printed, if any.', 60),
  purchase_date: text('Purchase or issue date as printed.', 60),
  datetime_local: text('For receipts and tickets: the local date and time printed on it.', 60),
  subtotal: text('Subtotal as printed.', 40),
  tax: text('Tax as printed.', 40),
  tip: text('Tip or service charge as printed.', 40),
  payment_method: {
    kind: 'choice',
    description: 'How it was paid, if printed.',
    options: ['cash', 'card', 'unknown'],
  },
  category_guess: {
    kind: 'choice',
    description: 'For receipts: the kind of spending.',
    options: [
      'food',
      'local_transport',
      'activities',
      'shopping',
      'lodging',
      'other',
      'flights',
      'insurance',
      'visas',
      'long_transport',
    ],
  },
  segments: {
    kind: 'record_list',
    description:
      'Every flight segment in order, for itineraries and boarding passes. Empty otherwise.',
    maxItems: 12,
    fields: {
      from_iata: text('Origin airport IATA code.', 3),
      to_iata: text('Destination airport IATA code.', 3),
      from_city: text('Origin city as printed.', 80),
      to_city: text('Destination city as printed.', 80),
      departure_local: text('Departure local date and time as printed.', 60),
      arrival_local: text('Arrival local date and time as printed.', 60),
      flight_number: text('Flight number as printed.', 12),
    },
  },
  passengers: {
    kind: 'record_list',
    description:
      'Passenger or guest names as printed, with their type if the document says. Never document numbers.',
    maxItems: 12,
    fields: {
      name: text('Name as printed.', 120),
      type: {
        kind: 'choice',
        description: 'Passenger type if printed.',
        options: ['adult', 'child', 'infant', 'unknown'],
      },
    },
  },
  uncertain_fields: {
    kind: 'text_list',
    description:
      'Names of the fields above you could not read clearly (for example "total_amount").',
    maxItems: 20,
    itemMaxLength: 40,
  },
} as const satisfies ObjectShape;

const SYSTEM = [
  'You read travel documents: flight itineraries, boarding passes, hotel confirmations, receipts, tickets and insurance policies.',
  'You are a transcriber. Copy what is printed. Do not compute, convert, total or round anything.',
  'Leave a field empty when the document does not show it. Do not guess dates, years or currencies.',
  'Never copy card numbers, passport numbers or national ID numbers into any field.',
  'List in uncertain_fields every field you could not read clearly.',
].join('\n');

/** Records the file and queues the reading. Returns the document id, or why it was refused. */
export async function stageTripDocument(
  session: Session,
  request: {
    householdId: string;
    tripId: string | null;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  },
): Promise<
  | { ok: true; documentId: string; duplicate: boolean; jobId: string | null }
  | {
      ok: false;
      reason: 'tooLarge' | 'unsupportedType' | 'storageUnavailable' | 'queueUnavailable';
    }
> {
  if (request.bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, reason: 'tooLarge' };
  if (!TRIP_DOCUMENT_TYPES.has(request.mimeType)) return { ok: false, reason: 'unsupportedType' };

  const contentHash = createHash('sha256').update(request.bytes).digest('hex');
  const [existing] = await queryAsUser(session, (tx) =>
    tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.householdId, request.householdId),
          eq(documents.contentHash, contentHash),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1),
  );
  // The same file twice is the same document: point at the first one.
  if (existing) return { ok: true, documentId: existing.id, duplicate: true, jobId: null };

  const documentId = newId<string>();
  const extension = (request.fileName.split('.').pop() ?? 'bin').toLowerCase().slice(0, 8);
  const storageKey = buildStorageKey('receipts', request.householdId, documentId, extension);
  try {
    await putDocument(storageKey, request.bytes, request.mimeType);
  } catch {
    return { ok: false, reason: 'storageUnavailable' };
  }

  await queryAsUser(session, (tx) =>
    tx.insert(documents).values({
      id: documentId,
      householdId: request.householdId,
      uploadedBy: session.user.id,
      kind: 'other',
      fileName: request.fileName.slice(0, 200),
      mimeType: request.mimeType,
      byteSize: request.bytes.byteLength,
      storageKey,
      contentHash,
      tripId: request.tripId,
      tripStatus: 'pending',
    }),
  );

  const jobId = await enqueueJob(session, request.householdId, TRIP_DOCUMENT_JOB, {
    documentId,
    storageKey,
    mimeType: request.mimeType,
    tripId: request.tripId,
    userId: session.user.id,
  });
  if (!jobId) return { ok: false, reason: 'queueUnavailable' };
  return { ok: true, documentId, duplicate: false, jobId };
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const asRecords = (value: unknown): readonly Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

/** The structured answer as the normalizer's input. */
export function toRawExtraction(output: StructuredOutput): RawExtraction {
  return {
    kind: asText(output['kind']),
    kindConfidence: typeof output['kind_confidence'] === 'number' ? output['kind_confidence'] : 0.5,
    provider: asText(output['provider']),
    referenceCode: asText(output['reference_code']),
    totalAmount: asText(output['total_amount']),
    currencyText: asText(output['currency_text']),
    amountPaid: asText(output['amount_paid']),
    amountDue: asText(output['amount_due']),
    dueDate: asText(output['due_date']),
    city: asText(output['city']),
    country: asText(output['country']),
    checkIn: asText(output['check_in']),
    checkOut: asText(output['check_out']),
    guests: asText(output['guests']),
    payAtProperty: asText(output['pay_at_property']),
    cityTaxPending: asText(output['city_tax_pending']),
    breakfastIncluded: asText(output['breakfast_included']),
    cancellationDeadline: asText(output['cancellation_deadline']),
    purchaseDate: asText(output['purchase_date']),
    datetimeLocal: asText(output['datetime_local']),
    subtotal: asText(output['subtotal']),
    tax: asText(output['tax']),
    tip: asText(output['tip']),
    paymentMethod: asText(output['payment_method']),
    categoryGuess: asText(output['category_guess']),
    segments: asRecords(output['segments']).map((s) => ({
      from_iata: asText(s['from_iata']),
      to_iata: asText(s['to_iata']),
      from_city: asText(s['from_city']),
      to_city: asText(s['to_city']),
      departure_local: asText(s['departure_local']),
      arrival_local: asText(s['arrival_local']),
      flight_number: asText(s['flight_number']),
    })),
    passengers: asRecords(output['passengers']).map((p) => ({
      name: asText(p['name']),
      type: asText(p['type']),
    })),
    uncertainFields: Array.isArray(output['uncertain_fields'])
      ? (output['uncertain_fields'] as unknown[]).filter((f): f is string => typeof f === 'string')
      : [],
  };
}

const KIND_FOR_DOCUMENT: Readonly<Record<string, typeof documents.$inferInsert.kind>> = {
  flight_itinerary: 'flight_itinerary',
  boarding_pass: 'boarding_pass',
  lodging_confirmation: 'lodging_confirmation',
  receipt: 'receipt',
  invoice: 'invoice',
  ticket: 'ticket',
  insurance_policy: 'insurance_policy',
  other: 'other',
};

/**
 * The worker: read the file, ask for a transcription, retry once with the
 * validation error if the answer does not fit the schema, normalize, and
 * leave the proposal waiting for review. Runs with the admin handle, scoped by
 * the household id the job carries, like every job.
 */
registerJobHandler(TRIP_DOCUMENT_JOB, async (job, report) => {
  const payload = job.payload as {
    documentId?: string;
    storageKey?: string;
    mimeType?: string;
    tripId?: string | null;
    userId?: string;
  };
  if (!payload.documentId || !payload.storageKey || !payload.mimeType) {
    return { failure: 'This document is missing its file.', retryable: false };
  }
  const db = getAdminDb(getServerEnv().DIRECT_URL);
  const documentId = payload.documentId;
  const fail = async (reason: string, retryable: boolean) => {
    await db
      .update(documents)
      .set({ tripStatus: retryable ? 'pending' : 'failed', tripFailure: reason })
      .where(and(eq(documents.id, documentId), eq(documents.householdId, job.householdId)));
    return { failure: reason, retryable };
  };

  await db
    .update(documents)
    .set({ tripStatus: 'processing' })
    .where(and(eq(documents.id, documentId), eq(documents.householdId, job.householdId)));
  await report(10, 'reading');

  let bytes: Uint8Array;
  try {
    bytes = await readDocument(payload.storageKey);
  } catch {
    return fail('storage', true);
  }
  if (bytes.byteLength > MAX_MODEL_BYTES) return fail('too_large', false);

  const provider = buildProvider();
  if (provider.id === 'none') return fail('not_configured', false);

  const schema = toJsonSchema(SHAPE);
  const attachment = {
    kind: payload.mimeType === 'application/pdf' ? ('pdf' as const) : ('image' as const),
    mediaType: payload.mimeType,
    dataBase64: Buffer.from(bytes).toString('base64'),
  };
  const started = Date.now();
  let user = 'Read the attached travel document and fill every field you can see.';
  let output: StructuredOutput | null = null;
  let model = provider.model;
  let usage = { inputTokens: 0, outputTokens: 0 };

  await report(30, 'reading_document');
  for (let attempt = 0; attempt < 2 && !output; attempt += 1) {
    const result = await provider.complete({
      system: SYSTEM,
      user,
      attachment,
      outputSchema: schema,
      maxOutputTokens: 4000,
      temperature: 0,
      timeoutMs: 90_000,
    });
    if (!result.ok) {
      await logInvocation(
        db,
        job.householdId,
        payload.userId ?? null,
        provider.id,
        model,
        usage,
        Date.now() - started,
        'transport_error',
      );
      return fail('transport', result.error.kind === 'transport');
    }
    model = result.value.model;
    usage = {
      inputTokens: usage.inputTokens + result.value.usage.inputTokens,
      outputTokens: usage.outputTokens + result.value.usage.outputTokens,
    };
    const parsed = parseOutput(SHAPE, result.value.raw);
    if (parsed.ok) output = parsed.value;
    else {
      // One retry, told exactly what did not fit.
      user = `${user}\nYour previous answer did not match the schema: ${parsed.error.slice(0, 5).join('; ')}. Answer again, matching it exactly.`;
    }
  }
  await logInvocation(
    db,
    job.householdId,
    payload.userId ?? null,
    provider.id,
    model,
    usage,
    Date.now() - started,
    output ? 'ok' : 'malformed_output',
  );
  if (!output) return fail('malformed', false);

  await report(70, 'normalizing');

  // What the household already knows about the trip sharpens the reading.
  const [trip] = payload.tripId
    ? await db
        .select({ base: trips.baseCurrency, start: trips.startDate })
        .from(trips)
        .where(and(eq(trips.id, payload.tripId), eq(trips.householdId, job.householdId)))
        .limit(1)
    : [];
  const legs = payload.tripId
    ? await db
        .select({ country: tripLegs.countryCode, currency: tripLegs.localCurrency })
        .from(tripLegs)
        .where(eq(tripLegs.tripId, payload.tripId))
        .orderBy(asc(tripLegs.arrivalDate))
    : [];
  const raw = toRawExtraction(output);
  const printed = raw.country.trim().toUpperCase();
  const countryCode = printed !== '' ? printed : (legs[0]?.country?.trim() ?? null);
  const legForCountry = legs.find((leg) => leg.country?.trim() === countryCode) ?? legs[0];
  const proposal = normalizeExtraction(raw, {
    countryCode,
    countryCurrency: legForCountry?.currency.trim() ?? null,
    fallbackCurrency: legForCountry?.currency.trim() ?? trip?.base.trim() ?? 'USD',
    reference: trip ? toPlainDate(trip.start) : todayIn('America/Panama'),
  });

  await db
    .update(documents)
    .set({
      kind: KIND_FOR_DOCUMENT[proposal.kind] ?? 'other',
      tripStatus: 'needs_review',
      tripExtraction: proposal as unknown as Record<string, unknown>,
      tripConfidence: proposal.confidence.toFixed(3),
      tripFailure: null,
    })
    .where(and(eq(documents.id, documentId), eq(documents.householdId, job.householdId)));

  await report(100, 'ready');
  return { result: { kind: proposal.kind, confidence: proposal.confidence } };
});

async function logInvocation(
  db: ReturnType<typeof getAdminDb>,
  householdId: string,
  profileId: string | null,
  providerId: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number },
  latencyMs: number,
  outcome: 'ok' | 'malformed_output' | 'transport_error',
): Promise<void> {
  try {
    await db.insert(aiInvocations).values({
      householdId,
      profileId,
      feature: 'trip_document_extract',
      promptId: PROMPT_ID,
      provider: providerId,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs,
      outcome,
    });
  } catch {
    // The log must never be the reason a reading fails.
  }
}
