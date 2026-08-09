import { toPlainDate } from '@app/domain';
import { normalizeDescription } from '@app/transaction-engine';
import { describe, expect, it } from 'vitest';

import {
  CORRECTIONS_BEFORE_PROPOSAL,
  confirmProposal,
  proposeRule,
  recordCorrection,
  type Correction,
} from './learning.js';
import { resolveMerchant } from './merchants.js';
import { sourceAuthority, type MerchantRecord } from './types.js';

const SOFTWARE = 'category-software';
const ENTERTAINMENT = 'category-entertainment';
const TODAY = toPlainDate('2026-07-20');

function correction(
  overrides: Partial<Correction> & Pick<Correction, 'transactionId' | 'at'>,
): Correction {
  return {
    descriptionNormalized: normalizeDescription('ADOBE INC 800-833-6687').normalized,
    merchantId: 'm-adobe',
    categoryId: SOFTWARE,
    previousCategoryId: null,
    previousSource: 'system',
    actorId: 'user-1',
    source: 'user',
    ...overrides,
  };
}

describe('learning from corrections', () => {
  it('proposes nothing from a single correction', () => {
    // People re-file one-off purchases constantly. A rule built from one of them
    // is wrong every month afterwards.
    const proposal = proposeRule([correction({ transactionId: 't1', at: TODAY })], [], TODAY);

    expect(proposal).toBeNull();
    expect(CORRECTIONS_BEFORE_PROPOSAL).toBeGreaterThan(1);
  });

  it('proposes a rule once corrections settle into a habit', () => {
    const proposal = proposeRule(
      [
        correction({ transactionId: 't1', at: toPlainDate('2026-05-15') }),
        correction({ transactionId: 't2', at: toPlainDate('2026-06-15') }),
        correction({ transactionId: 't3', at: toPlainDate('2026-07-15') }),
      ],
      [],
      TODAY,
    );

    expect(proposal).not.toBeNull();
    expect(proposal?.categoryId).toBe(SOFTWARE);
    expect(proposal?.supportingCorrections).toBe(3);
    expect(proposal?.matchKind).toBe('equals');
  });

  it('proposes a token pattern when the descriptions vary', () => {
    const proposal = proposeRule(
      [
        correction({
          transactionId: 't1',
          at: toPlainDate('2026-06-15'),
          descriptionNormalized: normalizeDescription('UBER TRIP 8FK2 PANAMA').normalized,
        }),
        correction({
          transactionId: 't2',
          at: toPlainDate('2026-07-15'),
          descriptionNormalized: normalizeDescription('UBER TRIP 91XX PANAMA').normalized,
        }),
      ],
      [],
      TODAY,
    );

    // The normalizer glues a trailing reference onto the word before it, so
    // `trip 8fk2` and `trip 91xx` stay distinct tokens and drop out of the
    // intersection on their own. What survives is the part that is actually the
    // same purchase every month.
    expect(proposal?.matchKind).toBe('tokens');
    expect(proposal?.pattern).toContain('uber');
    expect(proposal?.pattern).toContain('panama');
    expect(proposal?.pattern).not.toContain('8fk2');
  });

  it('proposes nothing when descriptions share nothing meaningful', () => {
    // A pattern that matches more than it should is worse than no pattern.
    const proposal = proposeRule(
      [
        correction({
          transactionId: 't1',
          at: toPlainDate('2026-06-15'),
          descriptionNormalized: 'aaaa bbbb',
        }),
        correction({
          transactionId: 't2',
          at: toPlainDate('2026-07-15'),
          descriptionNormalized: 'cccc dddd',
        }),
      ],
      [],
      TODAY,
    );

    expect(proposal).toBeNull();
  });

  it('follows the most recent habit when the household changed its mind', () => {
    const proposal = proposeRule(
      [
        correction({
          transactionId: 't1',
          at: toPlainDate('2026-01-15'),
          categoryId: ENTERTAINMENT,
        }),
        correction({
          transactionId: 't2',
          at: toPlainDate('2026-02-15'),
          categoryId: ENTERTAINMENT,
        }),
        correction({ transactionId: 't3', at: toPlainDate('2026-06-15'), categoryId: SOFTWARE }),
        correction({ transactionId: 't4', at: toPlainDate('2026-07-15'), categoryId: SOFTWARE }),
      ],
      [],
      TODAY,
    );

    expect(proposal?.categoryId).toBe(SOFTWARE);
    expect(proposal?.supportingCorrections).toBe(2);
  });

  it('proposes nothing when the latest corrections disagree', () => {
    const proposal = proposeRule(
      [
        correction({ transactionId: 't1', at: toPlainDate('2026-06-15'), categoryId: SOFTWARE }),
        correction({
          transactionId: 't2',
          at: toPlainDate('2026-07-15'),
          categoryId: ENTERTAINMENT,
        }),
      ],
      [],
      TODAY,
    );

    expect(proposal).toBeNull();
  });

  it('proposes nothing when a rule already sends it there', () => {
    const proposal = proposeRule(
      [
        correction({ transactionId: 't1', at: toPlainDate('2026-06-15') }),
        correction({ transactionId: 't2', at: toPlainDate('2026-07-15') }),
      ],
      [
        {
          id: 'r1',
          matchKind: 'contains',
          pattern: 'adobe',
          merchantId: null,
          categoryId: SOFTWARE,
          taxClassification: null,
          businessPercentage: null,
          source: 'user',
          confidence: 1,
          priority: 100,
          isActive: true,
          effectiveFrom: null,
          effectiveTo: null,
        },
      ],
      TODAY,
    );

    expect(proposal).toBeNull();
  });

  it('carries the lowest authority until it is confirmed', () => {
    const proposal = proposeRule(
      [
        correction({ transactionId: 't1', at: toPlainDate('2026-06-15') }),
        correction({ transactionId: 't2', at: toPlainDate('2026-07-15') }),
      ],
      [],
      TODAY,
    );

    expect(proposal?.source).toBe('ai');
    expect(sourceAuthority('ai')).toBeLessThan(sourceAuthority('user'));

    const confirmed = confirmProposal(proposal!, 'user');
    expect(confirmed.source).toBe('user');
    expect(confirmed.confidence).toBe(1);
    expect(sourceAuthority(confirmed.source)).toBeGreaterThan(sourceAuthority('ai'));
  });
});

describe('the classification log', () => {
  it('records what it was, so a correction can be undone and explained', () => {
    const entry = recordCorrection(
      correction({
        transactionId: 't1',
        at: TODAY,
        previousCategoryId: ENTERTAINMENT,
        previousSource: 'ai',
      }),
    );

    expect(entry.previousCategoryId).toBe(ENTERTAINMENT);
    expect(entry.previousSource).toBe('ai');
    expect(entry.categoryId).toBe(SOFTWARE);
    expect(entry.source).toBe('user');
    expect(entry.actorId).toBe('user-1');
  });

  it('attributes an accountant correction to the accountant', () => {
    const entry = recordCorrection(
      correction({ transactionId: 't1', at: TODAY, source: 'accountant' }),
    );

    expect(entry.source).toBe('accountant');
    expect(entry.reason).toContain('accountant');
  });
});

describe('merchant resolution', () => {
  const merchants: readonly MerchantRecord[] = [
    {
      id: 'm1',
      name: 'Super 99',
      normalizedName: 'super99',
      aliases: ['super99cde'],
      defaultCategoryId: 'groceries',
    },
    {
      id: 'm2',
      name: 'Riba Smith',
      normalizedName: 'riba smith',
      aliases: [],
      defaultCategoryId: 'groceries',
    },
  ];

  it('matches an exact alias with certainty', () => {
    const match = resolveMerchant('super99cde', merchants);
    expect(match?.merchant.id).toBe('m1');
    expect(match?.signal).toBe('alias_exact');
    expect(match?.confidence).toBe(1);
  });

  it('matches an abbreviation against the spelled-out name', () => {
    const match = resolveMerchant(
      normalizeDescription('SUPER 99 COSTA DEL ESTE').normalized,
      merchants,
    );
    expect(match?.merchant.id).toBe('m1');
  });

  it('returns nothing rather than a weak guess', () => {
    // An unresolved merchant goes to review. A wrong one silently inherits a
    // category and a tax treatment that belong to a different business.
    expect(resolveMerchant('farmacia arrocha', merchants)).toBeNull();
  });

  it('returns nothing for an empty description', () => {
    expect(resolveMerchant('', merchants)).toBeNull();
  });
});
