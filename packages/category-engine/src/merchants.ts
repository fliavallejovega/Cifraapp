import {
  describesSameMerchant,
  descriptionSimilarity,
  normalizeDescription,
} from '@app/transaction-engine';

import type { MerchantRecord } from './types.js';

/**
 * Merchant resolution.
 *
 * The import pipeline already normalizes a description down to the part that
 * identifies a shop (`@app/transaction-engine`). This turns that string into a
 * merchant the household knows, which is what makes categorization stable: a
 * category attached to `SUPER 99` keeps working when next month's statement
 * spells it `SUPER99 #034`.
 *
 * The rungs are ordered by how much they can be trusted, and each one carries a
 * confidence out rather than a boolean, because "probably the same shop" and
 * "certainly the same shop" must lead to different behaviour downstream.
 */

/** Below this, two names are not describing the same business. */
export const MERCHANT_SIMILARITY_FLOOR = 0.7;

export type MerchantSignal = 'alias_exact' | 'name_exact' | 'token_containment' | 'similarity';

export interface MerchantMatch {
  readonly merchant: MerchantRecord;
  readonly confidence: number;
  readonly signal: MerchantSignal;
}

/** Normalizes a merchant name the same way descriptions are normalized. */
export function normalizeMerchantName(name: string): string {
  return normalizeDescription(name).normalized;
}

/**
 * Finds the merchant a normalized description refers to.
 *
 * Returns null rather than a weak guess. An unresolved merchant sends the
 * transaction to review, which is a correct outcome; a wrong merchant silently
 * inherits someone else's category and tax treatment, which is not.
 */
export function resolveMerchant(
  descriptionNormalized: string,
  merchants: readonly MerchantRecord[],
): MerchantMatch | null {
  if (!descriptionNormalized) return null;

  let best: MerchantMatch | null = null;

  for (const merchant of merchants) {
    const candidate = scoreMerchant(descriptionNormalized, merchant);
    if (!candidate) continue;
    if (!best || candidate.confidence > best.confidence) {
      best = candidate;
    }
  }

  return best;
}

function scoreMerchant(description: string, merchant: MerchantRecord): MerchantMatch | null {
  for (const alias of merchant.aliases) {
    if (alias && alias === description) {
      return { merchant, confidence: 1, signal: 'alias_exact' };
    }
  }

  if (merchant.normalizedName === description) {
    return { merchant, confidence: 1, signal: 'name_exact' };
  }

  const names = [merchant.normalizedName, ...merchant.aliases].filter(Boolean);

  // One channel spelling out what another abbreviates. Common enough that
  // trigram overlap alone would miss it (see the Phase 5 calibration notes).
  for (const name of names) {
    if (describesSameMerchant(description, name)) {
      return { merchant, confidence: 0.9, signal: 'token_containment' };
    }
  }

  let bestSimilarity = 0;
  for (const name of names) {
    const similarity = descriptionSimilarity(description, name);
    if (similarity > bestSimilarity) bestSimilarity = similarity;
  }

  if (bestSimilarity >= MERCHANT_SIMILARITY_FLOOR) {
    return { merchant, confidence: bestSimilarity, signal: 'similarity' };
  }

  return null;
}
