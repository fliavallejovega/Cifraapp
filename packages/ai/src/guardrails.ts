import type { Grounding } from './types.js';

/**
 * The check that stops a hallucinated balance reaching a household.
 *
 * A model asked to explain a plan will, sooner or later, produce a sentence like
 * "this leaves you about $1,400 for the month" when the real figure is $1,340.
 * It reads fluently, it is wrong, and nothing downstream would catch it — the
 * number is prose, not a field.
 *
 * So every figure in generated text must appear in the grounding the call was
 * given. The grounding comes from rows and engines; it is the only place a
 * number is allowed to originate. Anything else is reported and the caller falls
 * back to the deterministic explanation, which was always there.
 *
 * The check is strict on purpose. A guardrail with an allowance for "small
 * numbers" is a guardrail with a hole exactly where a small balance lives, and
 * failing here is cheap: the product has a correct answer to show instead.
 */

/** `$1,234.56`, `18.9%`, `1 400`, `42` — anything a reader would take as a figure. */
const FIGURE_PATTERN = /\d[\d.,\s]*\d|\d/g;

export interface GuardrailOptions {
  /**
   * Figures the caller vouches for beyond the grounding — a year in a citation,
   * a count the caller computed. Each entry is normalized the same way.
   */
  readonly allow?: readonly string[];
}

/**
 * Figures in `texts` that no grounding value accounts for.
 *
 * Empty means the answer only ever restated numbers it was handed.
 */
export function ungroundedFigures(
  texts: readonly string[],
  grounding: Grounding,
  options: GuardrailOptions = {},
): string[] {
  const permitted = new Set<string>();

  for (const value of Object.values(grounding)) {
    for (const figure of extractFigures(value)) permitted.add(figure);
  }
  for (const value of options.allow ?? []) {
    for (const figure of extractFigures(value)) permitted.add(figure);
  }

  const offending = new Set<string>();
  for (const text of texts) {
    for (const token of figureReadings(text)) {
      // A written figure is grounded if *any* reading of it was supplied. The
      // ambiguity of `1,400` is the writer's, not the reader's, and accusing a
      // model of inventing a number because of a comma would make the guardrail
      // fire on correct answers — which is how a guardrail gets switched off.
      if (token.some((reading) => permitted.has(reading))) continue;
      const canonical = token[0];
      if (canonical !== undefined) offending.add(canonical);
    }
  }

  return [...offending].sort();
}

/**
 * Normalized figures found in a string.
 *
 * `$1,234.50`, `1 234.5` and `1234.500` all normalize to `1234.5`, so a model
 * that reformats a grounded amount is not accused of inventing it. Grouping
 * separators are dropped, trailing zeros after a decimal point are dropped, and
 * a bare `1,234` — ambiguous between grouping and a decimal comma — is admitted
 * under both readings rather than guessed at.
 */
export function extractFigures(text: string): string[] {
  return [...new Set(figureReadings(text).flat())];
}

/**
 * The same figures, grouped by the token they came from.
 *
 * Each inner array holds every defensible reading of one written number, most
 * likely first. Grouping is what lets the check ask "was this token grounded
 * under any reading" instead of treating each reading as a separate claim.
 */
export function figureReadings(text: string): string[][] {
  const tokens: string[][] = [];

  for (const match of text.matchAll(FIGURE_PATTERN)) {
    const token = match[0].replace(/\s/g, '');
    if (token.length === 0) continue;

    const normalized = readings(token)
      .map(normalizeDecimal)
      .filter((reading): reading is string => reading !== null);

    if (normalized.length > 0) tokens.push([...new Set(normalized)]);
  }

  return tokens;
}

/** Both plausible readings of a comma: grouping separator, or decimal point. */
function readings(token: string): string[] {
  const withoutTrailingPunctuation = token.replace(/[.,]+$/, '');
  if (withoutTrailingPunctuation.length === 0) return [];

  const asGrouping = withoutTrailingPunctuation.replace(/,/g, '');
  if (!withoutTrailingPunctuation.includes(',')) return [asGrouping];

  const asDecimalComma = withoutTrailingPunctuation.replace(/\./g, '').replace(/,/g, '.');
  return [asGrouping, asDecimalComma];
}

function normalizeDecimal(value: string): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;

  const [, whole = '0', fraction] = match;
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '');
  const trimmedFraction = (fraction ?? '').replace(/0+$/, '');

  return trimmedFraction.length > 0 ? `${trimmedWhole}.${trimmedFraction}` : trimmedWhole;
}
