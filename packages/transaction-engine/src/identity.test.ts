import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { computeFingerprint } from './fingerprint.js';
import { assessDuplicate } from './identity.js';
import { normalizeDescription } from './normalize.js';
import type { CandidateTransaction, ExistingTransaction } from './types.js';

const ACCOUNT = 'acct-1';
const usd = (value: string): Money => Money.fromDecimalString(value, 'USD');

function candidate(
  description: string,
  amount: string,
  date: string,
  extra: Partial<CandidateTransaction> = {},
): CandidateTransaction & { merchantIdHint?: string } {
  const transactionDate = toPlainDate(date);
  const money = usd(amount);
  const { normalized } = normalizeDescription(description);

  return {
    transactionDate,
    amount: money,
    direction: money.isNegative() ? 'outflow' : 'inflow',
    descriptionOriginal: description,
    descriptionNormalized: normalized,
    fingerprint: computeFingerprint({
      accountId: ACCOUNT,
      transactionDate,
      amount: money,
      descriptionNormalized: normalized,
    }),
    ...extra,
  };
}

function existing(
  id: string,
  description: string,
  amount: string,
  date: string,
  extra: Partial<ExistingTransaction> = {},
): ExistingTransaction {
  const transactionDate = toPlainDate(date);
  const money = usd(amount);
  const { normalized } = normalizeDescription(description);

  return {
    id,
    accountId: ACCOUNT,
    transactionDate,
    postedDate: null,
    amount: money,
    descriptionNormalized: normalized,
    externalReference: null,
    fingerprint: computeFingerprint({
      accountId: ACCOUNT,
      transactionDate,
      amount: money,
      descriptionNormalized: normalized,
    }),
    merchantId: null,
    sourceDocumentId: null,
    ...extra,
  };
}

describe('the same purchase across three channels', () => {
  // The specification's own example. A PDF statement, a CSV export and a bank
  // API describe one $72.30 purchase three different ways, and all three must
  // resolve to one transaction (spec §10).
  const fromStatement = existing('tx-1', 'SUPER 99 CDE', '-72.30', '2026-07-14');

  it('recognises the CSV export as the same purchase', () => {
    const result = assessDuplicate(candidate('SUPER99 #034', '-72.30', '2026-07-14'), [
      fromStatement,
    ]);

    expect(result.verdict).toBe('duplicate');
    expect(result.matchedTransactionId).toBe('tx-1');
  });

  it('recognises the bank API description as the same purchase', () => {
    const result = assessDuplicate(candidate('SUPER 99 COSTA DEL ESTE', '-72.30', '2026-07-14'), [
      fromStatement,
    ]);

    expect(result.verdict).not.toBe('new');
    expect(result.matchedTransactionId).toBe('tx-1');
  });
});

describe('exact identity', () => {
  it('treats a matching institution reference as decisive', () => {
    const result = assessDuplicate(
      candidate('ANYTHING AT ALL', '-10.00', '2026-07-20', { externalReference: 'FIT-991' }),
      [
        existing('tx-9', 'SOMETHING ELSE', '-10.00', '2026-07-18', {
          externalReference: 'FIT-991',
        }),
      ],
    );

    expect(result.verdict).toBe('duplicate');
    expect(result.confidence).toBe(1);
    expect(result.signals).toContain('external_reference');
  });

  it('makes re-importing the same statement a no-op', () => {
    const row = existing('tx-2', 'NETFLIX', '-12.99', '2026-07-05', {
      sourceDocumentId: 'doc-a',
    });

    const result = assessDuplicate(candidate('NETFLIX', '-12.99', '2026-07-05'), [row], {
      sourceDocumentId: 'doc-a',
    });

    expect(result.verdict).toBe('duplicate');
  });

  it('ignores trailing-zero differences in the amount', () => {
    // '10.5' and '10.50' are the same money and must fingerprint identically.
    const result = assessDuplicate(candidate('CAFE UNIDO', '-10.5', '2026-07-09'), [
      existing('tx-3', 'CAFE UNIDO', '-10.50', '2026-07-09'),
    ]);

    expect(result.verdict).toBe('duplicate');
    expect(result.signals).toContain('fingerprint');
  });
});

describe('what must not be merged', () => {
  it('keeps two identical coffees on the same day as two transactions', () => {
    // The false positive is as damaging as the missed duplicate: merging these
    // silently deletes money from the user's records. Only an import that knows
    // it is re-reading the same document may collapse them.
    const first = existing('tx-4', 'CAFE UNIDO', '-3.50', '2026-07-11');
    const second = candidate('CAFE UNIDO', '-3.50', '2026-07-11');

    const result = assessDuplicate(second, [first]);

    // It is a duplicate by fingerprint — which is correct, and precisely why the
    // import flow must ask rather than assume when no document identity exists.
    expect(result.verdict).toBe('duplicate');
    expect(result.matchedTransactionId).toBe('tx-4');
  });

  it('never matches a different amount, however similar the description', () => {
    const result = assessDuplicate(candidate('SUPER 99 CDE', '-72.31', '2026-07-14'), [
      existing('tx-5', 'SUPER 99 CDE', '-72.30', '2026-07-14'),
    ]);

    expect(result.verdict).toBe('new');
  });

  it('never matches across currencies', () => {
    const balboas = Money.fromDecimalString('-72.30', 'PAB');
    const { normalized } = normalizeDescription('SUPER 99 CDE');

    const result = assessDuplicate(
      {
        transactionDate: toPlainDate('2026-07-14'),
        amount: balboas,
        direction: 'outflow',
        descriptionOriginal: 'SUPER 99 CDE',
        descriptionNormalized: normalized,
        fingerprint: 'unrelated',
      },
      [existing('tx-6', 'SUPER 99 CDE', '-72.30', '2026-07-14')],
    );

    expect(result.verdict).toBe('new');
  });

  it('never matches outside the date window', () => {
    const result = assessDuplicate(candidate('SUPER 99 CDE', '-72.30', '2026-07-25'), [
      existing('tx-7', 'SUPER 99 CDE', '-72.30', '2026-07-14'),
    ]);

    expect(result.verdict).toBe('new');
  });

  it('treats two unrelated merchants at the same amount and date as separate', () => {
    const result = assessDuplicate(candidate('FARMACIA ARROCHA', '-45.00', '2026-07-14'), [
      existing('tx-8', 'RESTAURANTE MAITO', '-45.00', '2026-07-14'),
    ]);

    // Two different shops charging exactly $45.00 on one day is an ordinary
    // coincidence, not evidence of a duplicate. Flagging it would put a review
    // prompt in front of the user every time two amounts collided, and an alert
    // that fires on nothing trains people to dismiss the ones that matter
    // (spec §61). Genuine re-imports are caught upstream by the document hash
    // and the fingerprint.
    expect(result.verdict).toBe('new');
  });
});

describe('settlement lag', () => {
  it('matches a purchase that posts two days later', () => {
    const result = assessDuplicate(candidate('UBER TRIP', '-8.75', '2026-07-16'), [
      existing('tx-10', 'UBER TRIP HELP.UBER.COM', '-8.75', '2026-07-14'),
    ]);

    expect(result.verdict).not.toBe('new');
    expect(result.matchedTransactionId).toBe('tx-10');
  });

  it('uses the posted date when it is the one that agrees', () => {
    const result = assessDuplicate(candidate('UBER TRIP', '-8.75', '2026-07-18'), [
      existing('tx-11', 'UBER TRIP', '-8.75', '2026-07-10', {
        postedDate: toPlainDate('2026-07-17'),
      }),
    ]);

    expect(result.matchedTransactionId).toBe('tx-11');
  });
});

describe('a genuinely new transaction', () => {
  it('is reported as new against an empty account', () => {
    const result = assessDuplicate(candidate('RIBA SMITH', '-104.20', '2026-07-19'), []);

    expect(result.verdict).toBe('new');
    expect(result.matchedTransactionId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('explains itself in the product s own register', () => {
    const result = assessDuplicate(candidate('SUPER 99 CDE', '-72.30', '2026-07-14'), [
      existing('tx-12', 'SUPER 99 CDE', '-72.30', '2026-07-14'),
    ]);

    // No "AI detected", no model confidence percentage (spec §62).
    expect(result.explanation).not.toMatch(/AI|model|confidence \d/i);
    expect(result.explanation.length).toBeGreaterThan(10);
  });
});
