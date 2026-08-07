/**
 * Description normalization.
 *
 * Bank statements describe the same purchase differently depending on the
 * channel it came through:
 *
 *   SUPER 99 CDE              (PDF statement)
 *   SUPER99 #034              (CSV export)
 *   SUPER 99 COSTA DEL ESTE   (bank API)
 *
 * These are one purchase. Normalization strips the parts that vary — terminal
 * numbers, reference codes, dates baked into the text, card fragments, payment
 * network prefixes — and leaves the part that identifies the merchant.
 *
 * The original string is never discarded. A normalizer that is wrong about a
 * merchant must be correctable later, which is impossible if it destroyed the
 * evidence (spec §10).
 */

/**
 * Prefixes local and international processors prepend. Stripped because they
 * describe how the money moved, not where it went.
 */
const CHANNEL_PREFIXES = [
  'compra',
  'consumo',
  'pago',
  'debito',
  'credito',
  'pos',
  'tarjeta',
  'purchase',
  'payment',
  'card',
  'ach',
  'sinpe',
  'yappy',
  'nequi',
  'visa',
  'mastercard',
  'amex',
];

/** Fragments that carry a reference rather than a name. */
const REFERENCE_PATTERNS: readonly RegExp[] = [
  /\bref(?:erencia)?[.:# ]*[a-z0-9-]+\b/gi,
  /\bauth(?:orization)?[.:# ]*[a-z0-9-]+\b/gi,
  /\btrace[.:# ]*[a-z0-9-]+\b/gi,
  /\bcomprobante[.:# ]*[a-z0-9-]+\b/gi,
  /\bterminal[.:# ]*[a-z0-9-]+\b/gi,
  /\bnro?[.:# ]*\d+\b/gi,
  /\bno[.:# ]*\d{3,}\b/gi,
  /#\s*\d+/g,
  /\*{2,}\d{2,}/g,
  /\bx{3,}\d{2,}/gi,
  /\b\d{2}[/-]\d{2}(?:[/-]\d{2,4})?\b/g,
  /\b\d{6,}\b/g,
];

/**
 * Removes diacritics so `PANADERÍA` and `PANADERIA` are the same merchant.
 * Panamanian statements are inconsistent about accents even within one bank.
 */
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface NormalizationResult {
  /** The comparable form. Lowercase, punctuation collapsed, references removed. */
  readonly normalized: string;
  /** A display form: title-cased, references removed, accents preserved. */
  readonly display: string;
  /** What was removed, so a wrong normalization can be explained. */
  readonly removed: readonly string[];
}

export function normalizeDescription(original: string): NormalizationResult {
  const removed: string[] = [];
  let working = original.trim();

  for (const pattern of REFERENCE_PATTERNS) {
    working = working.replace(pattern, (match) => {
      removed.push(match.trim());
      return ' ';
    });
  }

  const display = working.replace(/\s{2,}/g, ' ').trim();

  let normalized = stripDiacritics(display)
    .toLowerCase()
    // Punctuation carries no merchant identity and varies by channel.
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Strip channel words only from the start, and only while they lead. A
  // merchant genuinely called "Pago Fácil" must survive.
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of CHANNEL_PREFIXES) {
      if (normalized.startsWith(`${prefix} `)) {
        removed.push(prefix);
        normalized = normalized.slice(prefix.length + 1).trim();
        changed = true;
      }
    }
  }

  // `SUPER 99` and `SUPER99` must collapse to the same key. Digits attached to
  // a word are part of the name; the space between them is not reliable.
  normalized = normalized.replace(/([a-z])\s+(\d)/g, '$1$2');

  return { normalized, display, removed };
}

/**
 * Similarity between two normalized descriptions, 0 to 1.
 *
 * Trigram overlap rather than edit distance, matching what `pg_trgm` computes
 * in the database — the same pair must score the same whether the comparison
 * happens in Postgres or in TypeScript, or the two passes disagree about what
 * is a duplicate.
 */
export function descriptionSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;

  const leftGrams = trigrams(left);
  const rightGrams = trigrams(right);
  if (leftGrams.size === 0 || rightGrams.size === 0) return 0;

  let shared = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) shared += 1;
  }

  return shared / (leftGrams.size + rightGrams.size - shared);
}

/**
 * Whether two normalized descriptions name the same merchant at different
 * verbosity.
 *
 * Trigram overlap alone underrates this case badly. `super99` and `super99 cde`
 * are plainly the same shop, but the second carries a branch suffix that dilutes
 * the score enough to push a certain match down into review — and a statement
 * channel that abbreviates is the common case, not the exception.
 *
 * So containment is checked separately: if every meaningful token of the shorter
 * description appears in the longer one, the two are describing one merchant.
 * Short tokens are dropped because `de`, `la` and `sa` appear everywhere and
 * would make unrelated names look related.
 */
export function describesSameMerchant(left: string, right: string): boolean {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) return false;

  const [smaller, larger] =
    leftTokens.size <= rightTokens.size ? [leftTokens, rightTokens] : [rightTokens, leftTokens];

  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }

  return true;
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(value.split(' ').filter((token) => token.length >= 3));
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const grams = new Set<string>();
  for (let index = 0; index < padded.length - 2; index += 1) {
    grams.add(padded.slice(index, index + 3));
  }
  return grams;
}
