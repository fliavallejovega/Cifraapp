/**
 * A figure as a person actually types it.
 *
 * Deliberately not `server-only`: it is pure string arithmetic with no
 * database, secret or request behind it, and keeping it importable is what lets
 * it be tested directly. If the browser ever needs to echo a parsed figure back
 * as the user types, this is the function it should use, so that the preview
 * and the stored value can never disagree.
 *
 * Two keyboards, two conventions, one column. A Spanish keyboard produces
 * "1.234,56"; an English one "1,234.56"; a bank's app pastes "B/. 1,234.56".
 * All three mean the same money, and rejecting any of them teaches the person
 * nothing except that the field is fussy.
 *
 * The hard case is a lone separator. "3,200" is three thousand two hundred to
 * most people who type it, and this code first read it as 3.2 — which put a
 * $3,200 credit card into the database as a $3.20 one and quietly made the
 * whole plan wrong. So the rule is the one people actually follow: money is
 * written with at most two decimal places, therefore a separator with exactly
 * three digits behind it is grouping, not a decimal point. "3,200" and "1.234"
 * are thousands; "950,50" and "24.5" are decimals.
 *
 * There is no reading of "3,200" that satisfies everyone. This one is wrong
 * only for someone writing thousandths of a dollar, and right for everyone
 * writing money.
 */
export function normalizeTypedAmount(value: unknown): string {
  if (typeof value !== 'string') return '';

  // Currency symbols, spaces and stray letters go; digits, separators and a
  // leading sign stay.
  const bare = value.replace(/[^\d,.-]/g, '');
  if (bare === '') return '';

  const negative = bare.startsWith('-');
  // "B/. 1,234.56" leaves a leading dot once the letters and slash are gone.
  // A separator with no digits on one side of it is punctuation, not a decimal
  // point, so it is trimmed before anything is interpreted.
  const digitsAndSeparators = bare
    .replace(/-/g, '')
    .replace(/^[.,]+/, '')
    .replace(/[.,]+$/, '');

  if (digitsAndSeparators === '') return '';

  const lastComma = digitsAndSeparators.lastIndexOf(',');
  const lastDot = digitsAndSeparators.lastIndexOf('.');

  let normalized: string;

  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: whichever comes last is the decimal point, the other groups.
    normalized =
      lastComma > lastDot
        ? digitsAndSeparators.replace(/\./g, '').replace(',', '.')
        : digitsAndSeparators.replace(/,/g, '');
  } else if (lastComma !== -1 || lastDot !== -1) {
    const separator = lastComma !== -1 ? ',' : '.';
    const at = lastComma !== -1 ? lastComma : lastDot;
    const trailing = digitsAndSeparators.length - at - 1;
    const occurrences = digitsAndSeparators.split(separator).length - 1;

    // More than one of the same separator can only be grouping: "1.234.567".
    // A single one with exactly three digits behind it is grouping too.
    normalized =
      occurrences > 1 || trailing === 3
        ? digitsAndSeparators.split(separator).join('')
        : digitsAndSeparators.replace(separator, '.');
  } else {
    normalized = digitsAndSeparators;
  }

  return negative ? `-${normalized}` : normalized;
}
