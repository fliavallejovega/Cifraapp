import 'server-only';

import { getAdminDb } from '@app/database';
import { currencies, fxRates } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';

/**
 * The daily reference rate, from the European Central Bank via Frankfurter
 * (no key, no account). Stored as «units of quote per one unit of base» at
 * ten decimals, read from the response text so no rate ever passes through a
 * floating-point number on its way to the database.
 *
 * The balboa is at par with the dollar by law, so a PAB household gets the
 * same rows with PAB as base. Currencies the ECB does not publish (colones,
 * pesos colombianos, soles…) have no reference rate; the family types the
 * rate on the expense, and the trip remembers it as its planning rate.
 */

const SOURCE = 'https://api.frankfurter.dev/v1/latest?base=USD';

export async function refreshFxRates(): Promise<{ stored: number; date: string | null }> {
  const response = await fetch(SOURCE, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`fx source answered ${String(response.status)}`);
  const body = await response.text();
  const date = /"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/.exec(body)?.[1] ?? null;
  const ratesBlock = /"rates"\s*:\s*\{([^}]*)\}/.exec(body)?.[1] ?? '';
  const pairs = [...ratesBlock.matchAll(/"([A-Z]{3})"\s*:\s*(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g)]
    .map(([, code, value]) => [code ?? '', value ?? ''] as const)
    .filter(([code, value]) => code !== '' && /^\d+(\.\d+)?$/.test(value));
  if (!date || pairs.length === 0) return { stored: 0, date };

  const db = getAdminDb(getServerEnv().DIRECT_URL);
  const known = new Set(
    (await db.select({ code: currencies.code }).from(currencies)).map((row) => row.code.trim()),
  );
  const fit = (value: string): string => {
    const [whole = '0', fraction = ''] = value.split('.');
    return fraction ? `${whole}.${fraction.slice(0, 10)}` : whole;
  };
  const rows = pairs
    .filter(([code]) => known.has(code))
    .flatMap(([code, value]) => [
      { base: 'USD', quote: code, rate: fit(value), rateDate: date, source: 'ecb' },
      { base: 'PAB', quote: code, rate: fit(value), rateDate: date, source: 'ecb' },
    ]);
  if (rows.length === 0) return { stored: 0, date };
  await db.insert(fxRates).values(rows).onConflictDoNothing();
  return { stored: rows.length, date };
}
