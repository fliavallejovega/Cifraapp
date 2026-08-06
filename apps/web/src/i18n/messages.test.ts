import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

import { routing } from './routing';

/**
 * Catalog parity.
 *
 * A key present in one language and missing in the other does not fail loudly —
 * it renders as a raw key or an empty label in production, in the language the
 * team happens not to be testing in. This is the cheapest possible guard
 * against that, and it runs on every commit.
 */

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, nested]) =>
    flattenKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

describe('message catalogs', () => {
  const spanishKeys = flattenKeys(es).sort();
  const englishKeys = flattenKeys(en).sort();

  it('covers every locale the router advertises', () => {
    expect([...routing.locales].sort()).toEqual(['en', 'es']);
  });

  it('defines the same keys in both languages', () => {
    expect(englishKeys).toEqual(spanishKeys);
  });

  it('has no empty strings, which would render as a blank label', () => {
    const blanks = [
      ...flattenValues(es).filter(([, value]) => value.trim() === ''),
      ...flattenValues(en).filter(([, value]) => value.trim() === ''),
    ];
    expect(blanks).toEqual([]);
  });

  it('keeps interpolation placeholders identical across languages', () => {
    // `{version}` present in one language and absent in the other means one
    // audience silently loses the number.
    const spanish = new Map(flattenValues(es));
    const english = new Map(flattenValues(en));

    for (const [key, value] of spanish) {
      expect(placeholders(value), `placeholders differ for "${key}"`).toEqual(
        placeholders(english.get(key) ?? ''),
      );
    }
  });
});

function flattenValues(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') {
    return [[prefix, value]];
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) =>
    flattenValues(nested, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}
