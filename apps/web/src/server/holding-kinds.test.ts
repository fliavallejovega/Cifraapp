import { HOLDING_KINDS } from '@app/market-data';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The list of kinds, in every place it has to agree with itself.
 *
 * Widening `HoldingKind` from four to six was a one-line change in the market
 * data package — and there were two other copies of the old four: a Zod enum
 * on the way into the database, and a check constraint in the schema. The Zod
 * copy was the dangerous one. A household with a mutual fund sent `fund`, the
 * enum rejected it, and the *whole* setup payload failed to parse: not the
 * holding, the entire questionnaire. Six steps of answers, refused with an
 * error naming nothing anybody could act on.
 *
 * Types could not catch it, because a string literal union and a Zod enum
 * built from a different literal list are both perfectly well typed. So the
 * agreement is asserted here instead, against the files themselves.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const literals = (source: string) =>
  [...source.matchAll(/'([a-z]+)'/g)].map((match) => match[1] ?? '').sort();

describe('the kinds a holding can be', () => {
  it('is the same list the setup action accepts', () => {
    const action = read('./onboarding-actions.ts');
    // The point is that the action does not carry its own copy at all.
    expect(action).toContain('z.enum(HOLDING_KINDS)');
    expect(action).not.toMatch(/z\.enum\(\[\s*'(equity|etf|crypto|fund|index)'/);
  });

  it('is the same list the database will accept', () => {
    const migration = read('../../../../supabase/migrations/20260908230000_holding_kinds.sql');
    const constraints = [...migration.matchAll(/check \(kind in \(([^)]+)\)\)/g)].map((match) =>
      literals(match[1] ?? ''),
    );
    expect(constraints).toHaveLength(2);
    for (const accepted of constraints) {
      expect(accepted).toEqual([...HOLDING_KINDS].sort());
    }
  });

  it('still refuses a kind nobody defined, so the check can fail', () => {
    // The positive control: if this list silently accepted anything, the two
    // assertions above would prove nothing.
    expect([...HOLDING_KINDS]).not.toContain('bond');
    expect([...HOLDING_KINDS]).not.toContain('whatever');
  });
});
