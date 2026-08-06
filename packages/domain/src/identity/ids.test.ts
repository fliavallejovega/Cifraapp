import { describe, expect, it } from 'vitest';

import { asId, generateUuidV7, isUuid, newId, type AccountId } from './ids.js';

describe('UUID v7 generation', () => {
  it('produces a well-formed version 7 UUID', () => {
    const id = generateUuidV7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7'); // version nibble
    expect('89ab').toContain(id[19]); // RFC 4122 variant
  });

  it('sorts by creation time, which is the whole point of v7', async () => {
    const first = generateUuidV7();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = generateUuidV7();

    // Lexicographic order matches chronological order, so a B-tree index on
    // these appends instead of fragmenting.
    expect(first < second).toBe(true);
  });

  it('does not collide within a single millisecond', () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => generateUuidV7()));
    expect(ids.size).toBe(5_000);
  });
});

describe('Branded identifiers', () => {
  it('validates identifiers arriving from outside the system', () => {
    const raw = generateUuidV7();
    expect(asId<AccountId>(raw, 'account id')).toBe(raw);
    expect(() => asId<AccountId>('not-a-uuid', 'account id')).toThrow(TypeError);
    expect(() => asId<AccountId>('', 'account id')).toThrow(TypeError);
  });

  it('mints new identifiers that pass validation', () => {
    expect(isUuid(newId<AccountId>())).toBe(true);
  });
});
