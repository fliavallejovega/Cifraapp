'use server';

import { parseOutput, toJsonSchema, type ObjectShape } from '@app/ai';
import { aiInvocations } from '@app/database/schema';
import { todayIn } from '@app/domain';

import { buildProvider, copilotIsConfigured } from './ai';
import { currencyOf } from './household-context';
import { tripsEnabled } from './repositories/trips';
import { loadSession, queryAsUser } from './session';
import { normalizeQuickTrip, type QuickTrip } from './trip-quick';

/**
 * «Describe the trip» on the wizard's first step. The model transcribes the
 * sentence into fields; `normalizeQuickTrip` does every sum and check; the
 * wizard shows the result as editable answers. Nothing is saved here.
 */

const PROMPT_ID = 'trip-quick-create-v1';

const text = (description: string, maxLength = 80) =>
  ({ kind: 'text', description, maxLength }) as const;

const SHAPE = {
  name: text(
    'A short name for the trip in the language of the text, e.g. "Navidad en Madrid".',
    80,
  ),
  legs: {
    kind: 'record_list',
    description: 'Each place the travellers stay, in order. Empty if no place is named.',
    maxItems: 6,
    fields: {
      city: text('City as written.'),
      country: text('ISO 3166 two-letter country code of the city if you know it, else empty.', 2),
      arrival_date: text(
        'Arrival date as YYYY-MM-DD if the text gives a day. Use the year given; if none, the first future occurrence after the reference date. Empty otherwise.',
        10,
      ),
      departure_date: text('Departure date as YYYY-MM-DD, same rule. Empty otherwise.', 10),
      nights: text(
        'Number of nights there if the text says it ("una semana" is 7). Digits only.',
        2,
      ),
    },
  },
  adults: text('Number of adults as stated, digits only. Empty if not said.', 2),
  children: text('Number of children (2 to 11) as stated, digits only. Empty if not said.', 2),
  infants: text('Number of babies under 2 as stated, digits only. Empty if not said.', 2),
  budget_amount: text(
    'The amount of money as stated, digits with an optional decimal point ("6 mil" is 6000). Do not add, multiply or convert. Empty if none.',
    14,
  ),
  budget_currency: text('ISO currency code of that amount if stated or obvious, else empty.', 3),
  budget_scope: {
    kind: 'choice',
    description: 'Whether the amount is for the whole trip, per person, or per day.',
    options: ['total', 'per_person', 'per_day', 'unknown'],
  },
  style: {
    kind: 'choice',
    description: 'The travel style if the text suggests one.',
    options: ['economy', 'balanced', 'comfort', 'unknown'],
  },
} as const satisfies ObjectShape;

const SYSTEM = [
  'You turn one sentence about a planned family trip into fields.',
  'You are a transcriber. Never add, multiply, convert or estimate amounts, and never invent places, people or dates.',
  'Leave a field empty when the text does not say it.',
].join('\n');

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

export async function readTripText(
  sentence: string,
): Promise<{ readonly trip: QuickTrip } | { readonly error: string }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const householdId = session.activeHouseholdId;
  if (!(await tripsEnabled(session, householdId))) return { error: 'moduleOff' };
  const clean = sentence.trim().slice(0, 600);
  if (clean.length < 4) return { error: 'tooShort' };
  if (!copilotIsConfigured()) return { error: 'notConfigured' };

  const timeZone =
    session.households.find((h) => h.id === householdId)?.timeZone ?? 'America/Panama';
  const today = todayIn(timeZone);
  const provider = buildProvider();
  const started = Date.now();
  const result = await provider.complete({
    system: SYSTEM,
    user: `Reference date: ${today}.\nText: """${clean}"""`,
    outputSchema: toJsonSchema(SHAPE),
    maxOutputTokens: 800,
    temperature: 0,
    timeoutMs: 30_000,
  });
  const parsed = result.ok ? parseOutput(SHAPE, result.value.raw) : null;

  try {
    await queryAsUser(session, (tx) =>
      tx.insert(aiInvocations).values({
        householdId,
        profileId: session.profile.id,
        feature: 'trip_quick_create',
        promptId: PROMPT_ID,
        provider: provider.id,
        model: result.ok ? result.value.model : provider.model,
        inputTokens: result.ok ? result.value.usage.inputTokens : 0,
        outputTokens: result.ok ? result.value.usage.outputTokens : 0,
        latencyMs: Date.now() - started,
        outcome: !result.ok ? 'transport_error' : parsed?.ok ? 'ok' : 'malformed_output',
      }),
    );
  } catch {
    // The log must never be the reason a reading fails.
  }

  if (!parsed?.ok) return { error: 'unreadable' };
  const out = parsed.value;
  const legs = Array.isArray(out['legs']) ? (out['legs'] as Record<string, unknown>[]) : [];
  const trip = normalizeQuickTrip(
    {
      name: asText(out['name']),
      legs: legs.map((leg) => ({
        city: asText(leg['city']),
        country: asText(leg['country']),
        arrival_date: asText(leg['arrival_date']),
        departure_date: asText(leg['departure_date']),
        nights: asText(leg['nights']),
      })),
      adults: asText(out['adults']),
      children: asText(out['children']),
      infants: asText(out['infants']),
      budget_amount: asText(out['budget_amount']),
      budget_currency: asText(out['budget_currency']),
      budget_scope: asText(out['budget_scope']),
      style: asText(out['style']),
    },
    { today, currency: currencyOf(session, householdId) },
  );
  return { trip };
}
