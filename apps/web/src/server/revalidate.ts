import 'server-only';

import { revalidatePath } from 'next/cache';

/**
 * What has to be redrawn when a figure changes.
 *
 * Nothing in this product is a screen that owns its own numbers. A debt's
 * minimum payment moves the plan, the position, the budget and the month's
 * statement at once, and refreshing only the page that submitted the form
 * leaves four screens showing a figure that stopped being true.
 *
 * So the answer is deliberately blunt: any change to household financial state
 * invalidates every screen that reads it. A narrower map would be faster and
 * would, sooner or later, be wrong in the one case nobody thought of — and a
 * stale balance is not a performance problem, it is a lie.
 */

/** Every signed-in route that displays a derived figure. */
const FINANCIAL_SCREENS = [
  'overview',
  'accounts',
  'movements',
  'income',
  'commitments',
  'debts',
  'goals',
  'budgets',
  'categories',
  'plan',
  'advice',
  'alerts',
  'debt-simulator',
  'scenarios',
  'projection',
  'investments',
  'reports',
  'close',
  'documents',
  'review/duplicates',
  'review/transfers',
  'review/recurring',
  'review',
  'review/categories',
  'merchants',
  'people',
  'settings',
  'tax',
  'trips',
] as const;

export function localeOf(formData: FormData): 'en' | 'es' {
  return formData.get('locale') === 'en' ? 'en' : 'es';
}

/** Redraws every screen that reads household financial state. */
export function revalidateFinancials(formData: FormData): void {
  const locale = localeOf(formData);
  for (const screen of FINANCIAL_SCREENS) {
    revalidatePath(`/${locale}/${screen}`);
  }
}

/** Redraws one screen and its detail pages — for state nothing else reads. */
export function revalidateScreen(formData: FormData, ...screens: readonly string[]): void {
  const locale = localeOf(formData);
  for (const screen of screens) {
    revalidatePath(`/${locale}/${screen}`);
  }
}

/**
 * Redraws a trip and every screen its money reaches. A trip expense is a
 * household movement, so the financial screens change with it.
 */
export function revalidateTrip(locale: 'en' | 'es', tripId?: string | null): void {
  for (const screen of FINANCIAL_SCREENS) {
    revalidatePath(`/${locale}/${screen}`);
  }
  if (tripId) {
    revalidatePath(`/${locale}/trips/${tripId}`);
    revalidatePath(`/${locale}/trips/${tripId}/today`);
    revalidatePath(`/${locale}/trips/${tripId}/report`);
  }
}
