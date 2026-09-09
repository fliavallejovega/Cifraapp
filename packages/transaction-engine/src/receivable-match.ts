import { comparePlainDates, daysBetween, type Money, type PlainDate } from '@app/domain';

/**
 * Matching what a household expected to collect against what actually arrived.
 *
 * An independent professional records «la factura de Acme, unos $2,400, entra
 * en la primera quincena» and then imports a statement three weeks later. Those
 * two facts are about the same money, and until something joins them the
 * household has to do it by memory — which means, in practice, that the
 * receivable stays open for ever and the plan keeps waiting for money that is
 * already in the account.
 *
 * This proposes joins. It never makes them. Marking money as collected changes
 * what the household believes it is owed, and a wrong automatic match writes
 * off an invoice nobody paid — so every proposal here is a suggestion with its
 * reasons attached, and a person confirms it.
 *
 * The reasons travel with the score for exactly that purpose. «$2,400.00 igual
 * al monto esperado · dentro de la ventana · el concepto dice ACME» is a claim
 * somebody can check in two seconds. A bare 0.86 is not.
 */

export type MatchReason =
  'amount_exact' | 'amount_close' | 'window_inside' | 'window_near' | 'no_window' | 'name_match';

export interface ExpectedCollection {
  readonly id: string;
  readonly name: string;
  /** Who owes it. Often the strongest signal in a bank description. */
  readonly source: string | null;
  readonly amount: Money;
  /** The window it was expected in. Null when the household could not say. */
  readonly expectedFrom: PlainDate | null;
  readonly expectedTo: PlainDate | null;
}

export interface ArrivedMoney {
  readonly id: string;
  readonly date: PlainDate;
  readonly amount: Money;
  /** As the bank wrote it, normalized for comparison upstream. */
  readonly description: string;
}

export interface MatchProposal {
  readonly receivableId: string;
  readonly transactionId: string;
  /** 0–1. Only its ordering is meaningful; it is not a probability. */
  readonly score: number;
  readonly reasons: readonly MatchReason[];
}

/**
 * How far outside its window a collection is still recognisably itself.
 *
 * Two weeks, because that is roughly how late a client pays before a household
 * stops thinking of it as «the invoice from the first fortnight». Wider than
 * this and the amount is doing all the work, which is what produces the
 * confident wrong match.
 */
const WINDOW_GRACE_DAYS = 14;

/** Below this, a proposal is noise and showing it costs more than it gives. */
const MINIMUM_SCORE = 0.5;

/**
 * A payment that differs from the invoice by more than this is a different
 * payment. Bank fees and rounding move a figure by cents, not by a tenth.
 */
const AMOUNT_TOLERANCE = 0.02;

export function proposeReceivableMatches(
  expected: readonly ExpectedCollection[],
  arrived: readonly ArrivedMoney[],
): readonly MatchProposal[] {
  const proposals: MatchProposal[] = [];

  for (const collection of expected) {
    for (const money of arrived) {
      const scored = score(collection, money);
      if (scored && scored.score >= MINIMUM_SCORE) {
        proposals.push({
          receivableId: collection.id,
          transactionId: money.id,
          score: scored.score,
          reasons: scored.reasons,
        });
      }
    }
  }

  // Best first, and ties broken by id so the same inputs always produce the
  // same order — a list that reshuffles between two renders of the same data
  // is one nobody trusts.
  return proposals.sort(
    (a, b) =>
      b.score - a.score ||
      a.receivableId.localeCompare(b.receivableId) ||
      a.transactionId.localeCompare(b.transactionId),
  );
}

function score(
  collection: ExpectedCollection,
  money: ArrivedMoney,
): { score: number; reasons: MatchReason[] } | null {
  if (collection.amount.currency !== money.amount.currency) return null;

  const reasons: MatchReason[] = [];

  // Amount is the gate, not a contributor. Nothing else can rescue a figure
  // that is simply a different sum of money.
  const gap = relativeGap(collection.amount, money.amount);
  if (gap === null || gap > AMOUNT_TOLERANCE) return null;

  let total = gap === 0 ? 0.6 : 0.45;
  reasons.push(gap === 0 ? 'amount_exact' : 'amount_close');

  const dates = dateScore(collection, money, reasons);
  // A window the household stated is evidence, and money arriving far outside
  // it is evidence *against*. Letting the amount carry a match on its own here
  // is how an invoice expected in October gets written off by a December
  // payment that happened to be the same size.
  if (dates === null) return null;
  total += dates;

  if (mentionsSource(collection, money.description)) {
    total += 0.2;
    reasons.push('name_match');
  }

  return { score: Math.min(total, 1), reasons };
}

function dateScore(
  collection: ExpectedCollection,
  money: ArrivedMoney,
  reasons: MatchReason[],
): number | null {
  const from = collection.expectedFrom;
  const to = collection.expectedTo;

  // «No sé cuándo» is a real answer, and it must not be scored as a miss: a
  // household that could not name a date would otherwise never see a proposal.
  if (!from || !to) {
    reasons.push('no_window');
    return 0.1;
  }

  const insideWindow =
    comparePlainDates(money.date, from) >= 0 && comparePlainDates(money.date, to) <= 0;

  if (insideWindow) {
    reasons.push('window_inside');
    return 0.25;
  }

  const distance =
    comparePlainDates(money.date, from) < 0
      ? daysBetween(money.date, from)
      : daysBetween(to, money.date);

  if (distance <= WINDOW_GRACE_DAYS) {
    reasons.push('window_near');
    // Decays with distance rather than stepping: a payment one day late and one
    // thirteen days late are not equally likely to be the same invoice.
    return 0.15 * (1 - distance / WINDOW_GRACE_DAYS);
  }

  return null;
}

/** How far apart two amounts are, as a fraction of the expected one. */
function relativeGap(expected: Money, actual: Money): number | null {
  const expectedUnits = expected.scaledUnits < 0n ? -expected.scaledUnits : expected.scaledUnits;
  const actualUnits = actual.scaledUnits < 0n ? -actual.scaledUnits : actual.scaledUnits;

  if (expectedUnits === 0n) return null;

  const difference =
    expectedUnits > actualUnits ? expectedUnits - actualUnits : actualUnits - expectedUnits;
  // Integer arithmetic all the way: the comparison is about money and must not
  // be decided by a float that rounded the wrong way at the boundary.
  return Number((difference * 10_000n) / expectedUnits) / 10_000;
}

/**
 * Whether the bank's own wording names who owes this.
 *
 * Deliberately crude. A bank description is upper-case, truncated and full of
 * reference numbers, so anything cleverer than «does a distinctive word from
 * the payer appear here» produces confident nonsense. Words of three letters or
 * fewer are dropped: matching on «de» or «SA» would tie every payment to every
 * invoice.
 */
function mentionsSource(collection: ExpectedCollection, description: string): boolean {
  const haystack = normalize(description);
  if (!haystack) return false;

  const needles = [collection.source, collection.name]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => normalize(value).split(' '))
    .filter((word) => word.length > 3);

  return needles.some((word) => haystack.includes(word));
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
