import { Money, plainDateFromParts, type CurrencyCode, type PlainDate } from '@app/domain';

import { computeFingerprint } from '../fingerprint.js';
import { normalizeDescription } from '../normalize.js';
import {
  StatementParseError,
  type CandidateTransaction,
  type ParsedStatement,
  type RejectedRow,
} from '../types.js';

/**
 * OFX and QFX parsing.
 *
 * OFX is the one format in this system that carries a real transaction
 * identifier: `FITID` is assigned by the institution and is stable across
 * exports. That makes it the strongest deduplication signal available, so it is
 * carried through as `externalReference` and sits at the top of the identity
 * ladder.
 *
 * The format is SGML rather than XML — tags are frequently unclosed — so it is
 * scanned rather than parsed as a document tree. Both the SGML-header variant
 * and the XML-declaration variant are accepted.
 */

export interface OfxParseOptions {
  readonly accountId: string;
  /** Falls back to the currency declared in the file, then to this. */
  readonly currency: CurrencyCode;
}

/** Reads a value whether or not the tag is closed. */
function readTag(block: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i');
  const match = pattern.exec(block);
  return match?.[1]?.trim() ?? null;
}

/** OFX dates are `YYYYMMDD` with an optional time and bracketed zone offset. */
export function parseOfxDate(raw: string): PlainDate | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!match) return null;

  try {
    return plainDateFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
  } catch {
    return null;
  }
}

export function parseOfxStatement(contents: string, options: OfxParseOptions): ParsedStatement {
  const blocks = contents.split(/<STMTTRN>/i).slice(1);

  if (blocks.length === 0) {
    throw new StatementParseError('ofx', 'The file contains no transaction records.');
  }

  const declaredCurrency = readTag(contents, 'CURDEF');
  const currency: CurrencyCode =
    declaredCurrency === 'USD' || declaredCurrency === 'PAB' ? declaredCurrency : options.currency;

  const accountHint = readTag(contents, 'ACCTID');
  const periodStart = parseOfxDate(readTag(contents, 'DTSTART') ?? '');
  const periodEnd = parseOfxDate(readTag(contents, 'DTEND') ?? '');
  const closingRaw = readTag(contents, 'BALAMT');

  const transactions: CandidateTransaction[] = [];
  const rejected: RejectedRow[] = [];

  for (const [index, block] of blocks.entries()) {
    const dateRaw = readTag(block, 'DTPOSTED');
    const amountRaw = readTag(block, 'TRNAMT');
    const fitid = readTag(block, 'FITID');

    // NAME is the merchant; MEMO is often the fuller description. Both appear,
    // and either may be the only one present.
    const name = readTag(block, 'NAME') ?? '';
    const memo = readTag(block, 'MEMO') ?? '';
    const descriptionOriginal = [name, memo].filter(Boolean).join(' — ').trim();

    const transactionDate = dateRaw ? parseOfxDate(dateRaw) : null;
    if (!transactionDate) {
      rejected.push({
        line: index + 1,
        raw: block.slice(0, 200),
        reason: 'The date could not be read.',
      });
      continue;
    }

    if (!amountRaw) {
      rejected.push({
        line: index + 1,
        raw: block.slice(0, 200),
        reason: 'The amount is missing.',
      });
      continue;
    }

    let amount: Money;
    try {
      amount = Money.fromDecimalString(amountRaw.replace(/[+]/g, ''), currency);
    } catch {
      rejected.push({
        line: index + 1,
        raw: block.slice(0, 200),
        reason: 'The amount is not a valid decimal.',
      });
      continue;
    }

    if (amount.isZero()) {
      rejected.push({
        line: index + 1,
        raw: block.slice(0, 200),
        reason: 'The row has no amount.',
      });
      continue;
    }

    const { normalized } = normalizeDescription(descriptionOriginal);

    transactions.push({
      transactionDate,
      amount,
      direction: amount.isNegative() ? 'outflow' : 'inflow',
      descriptionOriginal,
      descriptionNormalized: normalized,
      // The institution's own identifier. The strongest duplicate signal there
      // is, and the reason OFX imports are effectively exact.
      ...(fitid ? { externalReference: fitid } : {}),
      fingerprint: computeFingerprint({
        accountId: options.accountId,
        transactionDate,
        amount,
        descriptionNormalized: normalized,
      }),
    });
  }

  const closingBalance = closingRaw !== null ? tryMoney(closingRaw, currency) : null;

  return {
    format: 'ofx',
    currency,
    ...(accountHint ? { accountHint } : {}),
    ...(periodStart ? { periodStart } : {}),
    ...(periodEnd ? { periodEnd } : {}),
    ...(closingBalance ? { closingBalance } : {}),
    transactions,
    rejected,
  };
}

function tryMoney(raw: string, currency: CurrencyCode): Money | null {
  try {
    return Money.fromDecimalString(raw.replace(/[+]/g, ''), currency);
  } catch {
    return null;
  }
}
