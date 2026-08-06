import { describe, expect, it } from 'vitest';

import { CATEGORY_SEED, CURRENCY_SEED, JURISDICTION_SEED } from './seed-data.js';

describe('category seed', () => {
  it('has unique slugs, because they are the upsert key', () => {
    const slugs = CATEGORY_SEED.map((category) => category.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('never references a parent that does not exist', () => {
    const slugs = new Set(CATEGORY_SEED.map((category) => category.slug));
    const orphans = CATEGORY_SEED.filter(
      (category) => category.parentSlug !== null && !slugs.has(category.parentSlug),
    );
    expect(orphans).toEqual([]);
  });

  it('keeps the hierarchy one level deep, so a child is never its own ancestor', () => {
    const parents = new Set(
      CATEGORY_SEED.filter((category) => category.parentSlug === null).map((c) => c.slug),
    );
    const badParents = CATEGORY_SEED.filter(
      (category) => category.parentSlug !== null && !parents.has(category.parentSlug),
    );
    expect(badParents).toEqual([]);
  });

  it('inherits its parent kind, so a child cannot turn a transfer into an expense', () => {
    const kindBySlug = new Map(CATEGORY_SEED.map((category) => [category.slug, category.kind]));
    const mismatched = CATEGORY_SEED.filter(
      (category) =>
        category.parentSlug !== null && kindBySlug.get(category.parentSlug) !== category.kind,
    );
    expect(mismatched).toEqual([]);
  });

  it('is fully bilingual — a missing translation would surface as a blank label', () => {
    const untranslated = CATEGORY_SEED.filter(
      (category) => category.nameEn.trim() === '' || category.nameEs.trim() === '',
    );
    expect(untranslated).toEqual([]);
  });

  it('classifies credit card payments and internal movements as transfers, not spending', () => {
    const byKind = (slug: string) => CATEGORY_SEED.find((c) => c.slug === slug)?.kind;

    expect(byKind('transfers-card-payment')).toBe('transfer');
    expect(byKind('transfers-internal')).toBe('transfer');
    expect(byKind('savings')).toBe('transfer');
  });

  it('offers a category for every kind the engine can produce', () => {
    const kinds = new Set(CATEGORY_SEED.map((category) => category.kind));
    expect([...kinds].sort()).toEqual(['expense', 'income', 'investment', 'transfer']);
  });
});

describe('reference seed', () => {
  it('covers both currencies that circulate in Panama', () => {
    expect(CURRENCY_SEED.map((currency) => currency.code).sort()).toEqual(['PAB', 'USD']);
  });

  it('does not claim tax support that has not been implemented and reviewed', () => {
    // Phase 12 flips this once versioned DGI rules exist. Until then the product
    // must not imply coverage it does not have (spec §45).
    expect(JURISDICTION_SEED.every((jurisdiction) => !jurisdiction.isSupported)).toBe(true);
  });

  it('points every jurisdiction at a currency the system knows', () => {
    const codes = new Set(CURRENCY_SEED.map((currency) => currency.code));
    expect(JURISDICTION_SEED.every((jurisdiction) => codes.has(jurisdiction.defaultCurrency))).toBe(
      true,
    );
  });
});
