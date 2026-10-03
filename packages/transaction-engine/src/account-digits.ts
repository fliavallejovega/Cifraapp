/**
 * The last four digits of the account a statement is about, read from its text.
 *
 * A household with «Visa Davo» and «Visa Blei» side by side drops a statement
 * under the wrong card sooner or later, and the movements then sit in the other
 * person's ledger looking right. Every bank prints the account or card number
 * near the top — masked for a card, whole for a bank account — so the importer
 * can compare it against the account that was chosen and say so before anything
 * is confirmed.
 *
 * Only the header is searched. A statement's body is full of references,
 * authorisation codes and phone numbers that look like account numbers, and a
 * false «this is another card» is worse than none.
 *
 * Deterministic and conservative: a masked number (`XXXX-1234`, `****1234`,
 * `terminada en 1234`) wins over a labelled one (`Cuenta: 04-55-01-123456-7`),
 * and when nothing reads clearly the answer is null, never a guess.
 */

const HEADER_LINES = 60;

const MASKED = [
  // XXXX-XXXX-XXXX-1234 · **** **** **** 1234 · •••• 1234 · xx1234
  /(?:[Xx*•·]{2,}[\s-]*){1,4}(\d{4})(?!\d)/,
  // terminada en 1234 · terminación 1234 · ending in 1234 · last 4 digits 1234
  /(?:terminad[ao]\s+en|terminaci[oó]n|ending\s+in|ends\s+in|last\s+(?:4|four)(?:\s+digits)?)\s*:?\s*(\d{4})(?!\d)/i,
];

const LABELLED =
  /(?:n[uú]mero\s+de\s+(?:cuenta|tarjeta)|cuenta|tarjeta|account(?:\s+number)?|card(?:\s+number)?)\s*(?:n[o°º.]*|#)?\s*:?\s*(\d[\d\s-]{4,22}\d)(?!\d)/i;

export function findAccountDigits(lines: readonly string[]): string | null {
  const header = lines.slice(0, HEADER_LINES);

  for (const pattern of MASKED) {
    for (const line of header) {
      const match = pattern.exec(line);
      if (match?.[1]) return match[1];
    }
  }

  for (const line of header) {
    const match = LABELLED.exec(line);
    if (!match?.[1]) continue;
    const digits = match[1].replace(/\D/g, '');
    // A date or an amount can follow «Cuenta»; six digits is the shortest
    // account number a Panamanian bank prints.
    if (digits.length >= 6) return digits.slice(-4);
  }

  return null;
}

/**
 * Whether what the statement says and what the account holds disagree.
 *
 * Only a clear contradiction counts: both sides present, both four digits, and
 * different. An account with no number on file is not a mismatch — it is an
 * account nobody typed the digits for yet.
 */
export function digitsDisagree(stated: string | null, onFile: string | null): boolean {
  const left = stated?.replace(/\D/g, '').slice(-4) ?? '';
  const right = onFile?.replace(/\D/g, '').slice(-4) ?? '';
  return left.length === 4 && right.length === 4 && left !== right;
}
