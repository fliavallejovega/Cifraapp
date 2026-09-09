'use server';

import { holdings, householdPeople, marketPrices } from '@app/database/schema';
import type { CurrencyCode } from '@app/domain';
import { HOLDING_KINDS, lookup, search, type SearchScope } from '@app/market-data';
import { getServerEnv } from '@app/validation/env';
import { getPlatformDb } from '@app/database';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { firstIssueKey } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

type Tx = Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0];

/**
 * Finding an instrument, and pricing the one that was chosen.
 *
 * Two things happen, and only one of them is for the person at the keyboard.
 * They get told whether the symbol is real, what it is called, and what it
 * costs — so «BTC» and «BTC-USD» and a typo stop being the same silent
 * outcome. The quote is also written to `app.market_prices`, so the portfolio
 * screen has something to value the holding at without asking the provider
 * again for every render.
 *
 * The write goes through the platform connection, not the household's. A quote
 * belongs to no household — it is what a market said — and letting one
 * household's request write a row every other household reads is exactly the
 * kind of thing that should require deciding to, rather than happening because
 * the connection was already open.
 */

export interface SymbolLookup {
  readonly ok: boolean;
  readonly symbol?: string;
  readonly name?: string;
  readonly price?: string;
  readonly currency?: string;
  readonly kind?: string;
  readonly asOf?: string;
  readonly reason?: 'not-found' | 'unavailable' | 'unsupported-currency' | 'empty';
}

export async function lookupSymbol(rawSymbol: string): Promise<SymbolLookup> {
  const symbol = rawSymbol.trim();
  if (symbol === '') return { ok: false, reason: 'empty' };

  const result = await lookup(symbol);
  if (!result.ok) return { ok: false, reason: result.reason };

  const { quote } = result;

  try {
    await getPlatformDb(getServerEnv().DATABASE_URL)
      .insert(marketPrices)
      .values({
        symbol: quote.symbol,
        kind: quote.kind,
        displayName: quote.displayName,
        price: quote.price,
        currency: quote.currency,
        previousClose: quote.previousClose,
        source: quote.source,
        asOf: quote.asOf,
      })
      .onConflictDoUpdate({
        target: marketPrices.symbol,
        set: {
          kind: quote.kind,
          displayName: quote.displayName,
          price: quote.price,
          currency: quote.currency,
          previousClose: quote.previousClose,
          source: quote.source,
          asOf: quote.asOf,
          updatedAt: new Date(),
        },
      });
  } catch {
    // The person asked what a symbol is worth and they are getting an answer.
    // Failing to cache it is this system's problem, not theirs.
  }

  return {
    ok: true,
    symbol: quote.symbol,
    name: quote.displayName,
    price: quote.price,
    currency: quote.currency,
    kind: quote.kind,
    asOf: quote.asOf.toISOString(),
  };
}

/**
 * What the provider knows by this name.
 *
 * The reason this exists is a holding somebody nearly recorded by accident:
 * they typed «BTC» meaning bitcoin, and `BTC` is a real ticker — the Grayscale
 * Bitcoin Mini Trust, a fund on NYSE Arca. The old field found it, priced it,
 * and would have stored a fund they do not own. Nothing failed, which is what
 * made it dangerous. Searching turns the symbol from something typed into
 * something chosen from a list where the coin and the fund named after it are
 * two visibly different rows.
 *
 * Nothing is written here. A search is a question, and the quote is only
 * recorded once somebody has picked the instrument they actually hold.
 */
export interface SymbolCandidate {
  readonly symbol: string;
  readonly name: string;
  readonly kind: string;
  readonly exchange: string | null;
}

export type SymbolSearch =
  | { readonly ok: true; readonly candidates: readonly SymbolCandidate[] }
  | { readonly ok: false; readonly reason: 'unavailable' | 'too-short' };

const SCOPES: readonly SearchScope[] = ['all', 'equity', 'fund', 'crypto', 'bond', 'other'];

export async function searchSymbols(term: string, rawScope: string): Promise<SymbolSearch> {
  const scope = SCOPES.includes(rawScope as SearchScope) ? (rawScope as SearchScope) : 'all';
  const result = await search(term, { scope, limit: 8 });
  if (!result.ok) return { ok: false, reason: result.reason };

  return {
    ok: true,
    candidates: result.candidates.map((candidate) => ({
      symbol: candidate.symbol,
      name: candidate.name,
      kind: candidate.kind,
      exchange: candidate.exchange,
    })),
  };
}

/**
 * Registrar, corregir y quitar lo que la casa tiene invertido.
 *
 * El cuestionario inicial creaba estas filas y después nada en el producto
 * podía tocarlas: una cantidad tecleada con un cero de más, una posición
 * vendida, una compra nueva — todo permanente. Es exactamente el mismo hueco
 * que tenían los ingresos y las cuentas antes de que existiera su pantalla, y
 * se cierra igual.
 *
 * ## Qué se guarda y qué no
 *
 * El símbolo y la cantidad. **El precio no**: pertenece a quien lo cotizó, vive
 * en `market_prices` con su momento y su fuente, y aceptarlo de un formulario
 * dejaría que una pantalla afirme lo que dijo un mercado.
 *
 * `kind` tampoco se acepta a ciegas. Llega del formulario porque el buscador ya
 * lo sabe, pero si hay una cotización guardada para ese símbolo, manda la del
 * proveedor: la clase de un instrumento es un hecho suyo, no del hogar. Esa
 * distinción es la que impide que alguien registre bitcoin como si fuera una
 * acción y luego lea un total que no significa nada.
 */

const HOLDING_SYMBOL = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9.\-^=]+$/);

/** Diez decimales: una cripto se divide mucho más allá de un centavo. */
const QUANTITY = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,10})?$/)
  .refine((value) => Number(value) > 0, { message: 'quantityInvalid' });

const holdingInput = z.object({
  symbol: HOLDING_SYMBOL,
  label: z.string().trim().min(1).max(120),
  quantity: QUANTITY,
  kind: z.enum(HOLDING_KINDS).default('other'),
  personId: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.uuid().optional(),
  ),
  costBasis: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,4})?$/)
      .optional(),
  ),
  notes: z.string().trim().max(500).optional(),
});

const FIELD_ERRORS = {
  symbol: 'symbolInvalid',
  label: 'nameRequired',
  quantity: 'quantityInvalid',
  costBasis: 'amountInvalid',
  personId: 'notFound',
} as const;

function parseHolding(formData: FormData) {
  return holdingInput.safeParse({
    symbol: formData.get('symbol'),
    label: formData.get('label'),
    quantity: formData.get('quantity'),
    kind: formData.get('kind') ?? 'other',
    personId: formData.get('personId'),
    costBasis: formData.get('costBasis'),
    notes: formData.get('notes') ?? undefined,
  });
}

/**
 * La clase que manda: la del proveedor si existe, la del formulario si no.
 *
 * Un símbolo que nadie ha cotizado todavía no tiene fila en `market_prices`, y
 * en ese caso lo que dijo el buscador es lo mejor que hay. En cuanto haya
 * cotización, la del proveedor gana.
 */
async function kindOf(tx: Tx, symbol: string, stated: string): Promise<string> {
  const [quoted] = await tx
    .select({ kind: marketPrices.kind })
    .from(marketPrices)
    .where(eq(marketPrices.symbol, symbol))
    .limit(1);

  return quoted?.kind ?? stated;
}

/**
 * La persona tiene que ser de este hogar, o no hay dueño que asignar.
 *
 * `INVALID` es un centinela y no la cadena `'invalid'`: un identificador es
 * texto, y confundir un valor con un fallo es el error que este tipo evita.
 */
const INVALID = Symbol('invalid');

async function personOf(
  tx: Tx,
  householdId: string,
  personId: string | undefined,
): Promise<string | null | typeof INVALID> {
  if (!personId) return null;

  const [person] = await tx
    .select({ id: householdPeople.id })
    .from(householdPeople)
    .where(
      and(
        eq(householdPeople.id, personId),
        eq(householdPeople.householdId, householdId),
        isNull(householdPeople.deletedAt),
      ),
    )
    .limit(1);

  return person ? person.id : INVALID;
}

export async function createHolding(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parseHolding(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const holder = await personOf(tx, householdId, parsed.data.personId);
    if (holder === INVALID) return 'notFound' as const;

    const [created] = await tx
      .insert(holdings)
      .values({
        householdId,
        personId: holder,
        symbol: parsed.data.symbol.toUpperCase(),
        label: parsed.data.label,
        quantity: parsed.data.quantity,
        kind: await kindOf(tx, parsed.data.symbol.toUpperCase(), parsed.data.kind),
        costBasis: parsed.data.costBasis ?? null,
        notes: parsed.data.notes ?? null,
        currency: currencyOf(session, householdId) as CurrencyCode,
        createdBy: session.profile.id,
      })
      .returning({ id: holdings.id });

    return created ? created.id : ('createFailed' as const);
  });

  if (outcome === 'notFound' || outcome === 'createFailed') return { error: outcome };

  revalidateFinancials(formData);
  return { created: outcome };
}

export async function updateHolding(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = parseHolding(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const holder = await personOf(tx, householdId, parsed.data.personId);
    if (holder === INVALID) return 'notFound' as const;

    const [updated] = await tx
      .update(holdings)
      .set({
        personId: holder,
        symbol: parsed.data.symbol.toUpperCase(),
        label: parsed.data.label,
        quantity: parsed.data.quantity,
        kind: await kindOf(tx, parsed.data.symbol.toUpperCase(), parsed.data.kind),
        costBasis: parsed.data.costBasis ?? null,
        notes: parsed.data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(holdings.id, id.data),
          eq(holdings.householdId, householdId),
          isNull(holdings.deletedAt),
        ),
      )
      .returning({ id: holdings.id });

    return updated ? ('ok' as const) : ('notFound' as const);
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Quitar una posición.
 *
 * Borrado suave, como todo lo demás que este esquema fecha: haber tenido una
 * posición es historia del hogar, y el mes en que se vendió deja de tener
 * explicación si la fila desaparece.
 */
export async function removeHolding(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const [removed] = await queryAsUser(session, (tx) =>
    tx
      .update(holdings)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(holdings.id, id.data),
          eq(holdings.householdId, session.activeHouseholdId ?? ''),
          isNull(holdings.deletedAt),
        ),
      )
      .returning({ id: holdings.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Qué piensa hacer la casa con una posición.
 *
 * La decisión es suya y el producto no la sugiere. Recomendar vender, mantener
 * o cambiar de instrumento es asesoría de inversión: hace falta licencia para
 * darla y los términos de servicio dicen con todas sus letras que Cifraapp no es
 * un asesor. Lo que hace esta acción es **guardar lo que la persona decidió**,
 * para que el resto del sistema deje de adivinarlo.
 *
 * El orden importa y es el que separa una cosa de la otra: primero la casa
 * declara, después el producto calcula la consecuencia —cuánto liberaría salir,
 * qué deja de estar disponible si no se toca—. Al revés sería el producto
 * proponiendo una operación y la casa confirmándola.
 *
 * `intent_set_at` se estampa aquí. Una decisión de hace dos años sobre un
 * mercado que se movió no es la misma decisión, y sin la fecha la pantalla no
 * puede decirlo.
 */
const INTENTS = ['long_term', 'hold', 'exit', 'reallocate'] as const;

const intentInput = z.object({
  intent: z.enum(INTENTS),
  horizon: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.iso.date().optional(),
  ),
  note: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.string().trim().max(500).optional(),
  ),
});

export async function setHoldingIntent(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = intentInput.safeParse({
    intent: formData.get('intent'),
    horizon: formData.get('horizon'),
    note: formData.get('note'),
  });
  if (!parsed.success) return { error: firstIssueKey(parsed.error, { intent: 'intentInvalid' }) };

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(holdings)
      .set({
        intent: parsed.data.intent,
        intentHorizon: parsed.data.horizon ?? null,
        intentNote: parsed.data.note ?? null,
        intentSetAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(holdings.id, id.data),
          eq(holdings.householdId, session.activeHouseholdId ?? ''),
          isNull(holdings.deletedAt),
        ),
      )
      .returning({ id: holdings.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Retirar la decisión, volviendo a «nadie lo ha dicho».
 *
 * No es lo mismo que decir «la mantengo»: una es una decisión y la otra es su
 * ausencia, y el plan las lee distinto. Que se pueda deshacer importa porque una
 * decisión sobre dinero tomada en un mal día tiene que poder retirarse sin
 * dejar rastro de una intención que ya no existe.
 */
export async function clearHoldingIntent(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(holdings)
      // Los tres juntos: la base rechaza una nota o una fecha sin decisión, que
      // es exactamente el estado huérfano que un borrado a medias produciría.
      .set({
        intent: null,
        intentHorizon: null,
        intentNote: null,
        intentSetAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(holdings.id, id.data),
          eq(holdings.householdId, session.activeHouseholdId ?? ''),
          isNull(holdings.deletedAt),
        ),
      )
      .returning({ id: holdings.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}
