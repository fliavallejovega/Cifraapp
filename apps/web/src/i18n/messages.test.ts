import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

  /**
   * Every key a page asks for actually exists.
   *
   * Parity is not enough on its own: a key missing from *both* catalogs passes
   * it and then renders in production as the literal path — `cards.tiers.gold`
   * where the word «Oro» belongs. That is exactly how twenty-two keys shipped
   * on the cards screen, and neither lint, nor typecheck, nor the build, nor
   * this file's other three tests could see it.
   *
   * The scan is deliberately narrow. It only reads calls whose namespace it can
   * follow back to a literal `getTranslations('ns')` / `useTranslations('ns')`
   * in the same file, and only keys written as a plain string with no template
   * interpolation — a key built at runtime cannot be checked by reading the
   * source, and pretending otherwise would make this test lie in the other
   * direction. What it does cover, it covers exactly.
   */
  it('defines every key the application asks for', () => {
    const missing: string[] = [];

    for (const file of sourceFiles(join(import.meta.dirname, '..'))) {
      const source = readFileSync(file, 'utf8');

      // `const t = await getTranslations('cards')` → t is the `cards` catalog.
      const namespaces = new Map<string, string>();
      for (const match of source.matchAll(
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\(\s*'([^']+)'\s*\)/g,
      )) {
        if (match[1] && match[2]) namespaces.set(match[1], match[2]);
      }
      if (namespaces.size === 0) continue;

      for (const [name, namespace] of namespaces) {
        // `t('a.b')`, and the `rawOf(t)('a.b')` wrapper this codebase uses for
        // templates whose placeholders are filled where the values are.
        const calls = new RegExp(
          `(?:\\b${name}|rawOf\\(${name}\\))\\(\\s*'([^'{}$]+)'`,
          'g',
        );
        for (const call of source.matchAll(calls)) {
          const key = call[1];
          if (key === undefined) continue;

          const path = `${namespace}.${key}`;
          if (lookUp(es, path) === undefined) missing.push(`es → ${path} (${short(file)})`);
          if (lookUp(en, path) === undefined) missing.push(`en → ${path} (${short(file)})`);
        }
      }
    }

    expect(missing.sort()).toEqual([]);
  });
});

/** Every `.ts`/`.tsx` under a directory, tests excluded. */
function sourceFiles(root: string): string[] {
  const found: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;

      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) {
        found.push(path);
      }
    }
  };

  walk(root);
  return found;
}

/** A dotted path into a catalog, or `undefined` if any segment is absent. */
function lookUp(catalogue: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      catalogue,
    );
}

/** The path from `src/`, so a failure names a file someone can open. */
function short(file: string): string {
  const at = file.indexOf('/src/');
  return at === -1 ? file : file.slice(at + 1);
}

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
