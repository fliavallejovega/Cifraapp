import { comparePlainDates, Money, toPlainDate, type PlainDate } from '@app/domain';

/**
 * SYNTHETIC DEMONSTRATION DATA — not a real household.
 *
 * This is the fixture from the specification (§69): Alex and Taylor, four
 * accounts, two cards, two goals. It exists so the design system can be built
 * and judged against realistic figures before Phase 3 provides real ones, and
 * so the allocation engine has a deterministic case to be validated against
 * later.
 *
 * Every screen that renders this must say so. Phase 3 replaces it with queries;
 * nothing here may survive into a surface a customer sees unlabeled.
 */

const usd = (value: string): Money => Money.fromDecimalString(value, 'USD');

export interface DemoClaim {
  readonly id: string;
  readonly labelKey: string;
  readonly due: PlainDate;
  readonly amount: Money;
  readonly kind: 'essential' | 'debt' | 'reserve';
}

export interface DemoPosition {
  readonly liquid: Money;
  readonly committed: Money;
  readonly available: Money;
  readonly bufferMinimum: Money;
  readonly netWorth: Money;
  readonly claims: readonly DemoClaim[];
}

const CLAIMS: readonly DemoClaim[] = [
  {
    id: 'rent',
    labelKey: 'rent',
    due: toPlainDate('2026-09-01'),
    amount: usd('850.00'),
    kind: 'essential',
  },
  {
    id: 'electricity',
    labelKey: 'electricity',
    due: toPlainDate('2026-08-22'),
    amount: usd('132.40'),
    kind: 'essential',
  },
  {
    id: 'visa-minimum',
    labelKey: 'visaMinimum',
    due: toPlainDate('2026-08-12'),
    amount: usd('145.00'),
    kind: 'debt',
  },
  {
    id: 'mastercard-minimum',
    labelKey: 'mastercardMinimum',
    due: toPlainDate('2026-08-18'),
    amount: usd('98.00'),
    kind: 'debt',
  },
  {
    id: 'tax-reserve',
    labelKey: 'taxReserve',
    due: toPlainDate('2026-08-15'),
    amount: usd('312.50'),
    kind: 'reserve',
  },
  {
    id: 'internet',
    labelKey: 'internet',
    due: toPlainDate('2026-08-25'),
    amount: usd('79.99'),
    kind: 'essential',
  },
];

const LIQUID = usd('4180.00');
const BUFFER_MINIMUM = usd('600.00');

const COMMITTED = Money.sum(
  CLAIMS.map((claim) => claim.amount),
  'USD',
);

/** Sorted by due date, because that is the order the screen claims to show. */
const CLAIMS_BY_DUE_DATE = [...CLAIMS].sort((a, b) => comparePlainDates(a.due, b.due));

export const DEMO_POSITION: DemoPosition = {
  liquid: LIQUID,
  committed: COMMITTED,
  available: LIQUID.subtract(COMMITTED),
  bufferMinimum: BUFFER_MINIMUM,
  netWorth: usd('48210.44'),
  claims: CLAIMS_BY_DUE_DATE,
};
