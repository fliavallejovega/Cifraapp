import 'server-only';

import {
  getCurrency,
  todayIn,
  type CurrencyCode,
  type MoneyLocale,
  type PlainDate,
} from '@app/domain';

import type { Session } from './session';

/**
 * The four facts every screen needs before it can render a figure.
 *
 * Currency, the household's own time zone, today *in that zone*, and the locale
 * the money is formatted for. Each screen used to derive these itself, and each
 * derived them slightly differently — a page reading `baseCurrency` off the
 * session's membership list, another querying the household row, a third
 * calling `todayIn` with a hardcoded 'America/Panama'.
 *
 * Today is the one that actually breaks. A household in Panama at 21:00 is
 * already tomorrow in UTC, and a plan that thinks it is tomorrow moves rent
 * from «due today» to «overdue» for three hours every night.
 *
 * None of it costs a query. Every field comes from the session, which already
 * joined `households` to know which ones the caller belongs to — and the
 * session is memoized per render. This used to be a second round trip on every
 * single product screen, against a database a continent away, for two columns
 * that were already in memory.
 */

export interface HouseholdContext {
  readonly householdId: string;
  readonly currency: CurrencyCode;
  readonly currencySymbol: string;
  readonly timeZone: string;
  readonly today: PlainDate;
  readonly moneyLocale: MoneyLocale;
}

export function loadHouseholdContext(
  session: Session,
  householdId: string,
  locale: string,
): HouseholdContext {
  const household = session.households.find((entry) => entry.id === householdId);

  const currency = (household?.baseCurrency.trim() ?? 'USD') as CurrencyCode;
  const timeZone = household?.timeZone ?? 'America/Panama';

  return {
    householdId,
    currency,
    currencySymbol: getCurrency(currency).symbol,
    timeZone,
    today: todayIn(timeZone),
    moneyLocale: locale === 'en' ? 'en-US' : 'es-PA',
  };
}

/** The currency a write should stamp on a row, without a second round trip. */
export function currencyOf(session: Session, householdId: string): string {
  return (
    session.households.find((household) => household.id === householdId)?.baseCurrency.trim() ??
    'USD'
  );
}
