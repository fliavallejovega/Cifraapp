import 'server-only';

import { households } from '@app/database/schema';
import {
  getCurrency,
  todayIn,
  type CurrencyCode,
  type MoneyLocale,
  type PlainDate,
} from '@app/domain';
import { eq } from 'drizzle-orm';

import { queryAsUser, type Session } from './session';

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
 */

export interface HouseholdContext {
  readonly householdId: string;
  readonly currency: CurrencyCode;
  readonly currencySymbol: string;
  readonly timeZone: string;
  readonly today: PlainDate;
  readonly moneyLocale: MoneyLocale;
}

export async function loadHouseholdContext(
  session: Session,
  householdId: string,
  locale: string,
): Promise<HouseholdContext> {
  const [row] = await queryAsUser(session, (tx) =>
    tx
      .select({ currency: households.baseCurrency, timeZone: households.timeZone })
      .from(households)
      .where(eq(households.id, householdId))
      .limit(1),
  );

  const currency = (row?.currency.trim() ?? 'USD') as CurrencyCode;
  const timeZone = row?.timeZone ?? 'America/Panama';

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
