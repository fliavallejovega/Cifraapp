import type { Money, PlainDate } from '@app/domain';

/** A transaction as extracted from a document, before it enters the database. */
export interface CandidateTransaction {
  readonly transactionDate: PlainDate;
  readonly postedDate?: PlainDate;
  readonly amount: Money;
  readonly direction: 'inflow' | 'outflow';
  readonly descriptionOriginal: string;
  readonly descriptionNormalized: string;
  /** The institution's own identifier, when the format carries one. */
  readonly externalReference?: string;
  readonly fingerprint: string;
}

/** A transaction already stored, as the duplicate engine needs to see it. */
export interface ExistingTransaction {
  readonly id: string;
  readonly accountId: string;
  readonly transactionDate: PlainDate;
  readonly postedDate: PlainDate | null;
  readonly amount: Money;
  readonly descriptionNormalized: string;
  readonly externalReference: string | null;
  readonly fingerprint: string;
  readonly merchantId: string | null;
  readonly sourceDocumentId: string | null;
}

export interface ParsedStatement {
  readonly format: StatementFormat;
  readonly institutionKey?: string;
  readonly accountHint?: string;
  readonly currency: string;
  readonly openingBalance?: Money;
  readonly closingBalance?: Money;
  readonly periodStart?: PlainDate;
  readonly periodEnd?: PlainDate;
  readonly transactions: readonly CandidateTransaction[];
  /** Rows the parser could not read. Never silently dropped. */
  readonly rejected: readonly RejectedRow[];
}

export interface RejectedRow {
  readonly line: number;
  readonly raw: string;
  readonly reason: string;
}

export type StatementFormat = 'csv' | 'ofx' | 'qfx' | 'xlsx' | 'pdf';

export class StatementParseError extends Error {
  readonly format: StatementFormat;

  constructor(format: StatementFormat, message: string) {
    super(message);
    this.name = 'StatementParseError';
    this.format = format;
  }
}
