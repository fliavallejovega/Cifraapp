import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing';

/** A message catalog. Typed explicitly, since a dynamic import resolves to `any`. */
type Messages = Record<string, unknown>;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  const catalog = (await import(`../../messages/${locale}.json`)) as { default: Messages };

  return {
    locale,
    messages: catalog.default,
    // Panama has no daylight saving and a single zone. Pinning it here keeps
    // server-rendered dates and client-rendered dates from disagreeing, which
    // is what produces a transaction that appears to move between days.
    timeZone: 'America/Panama',
  };
});
