import { describe, expect, it } from 'vitest';

import { assessDuplicate } from '../identity.js';
import { StatementParseError } from '../types.js';

import { detectStatementFormat, parseStatement } from './index.js';
import { parseAmountText, parseStatementDate } from './csv.js';

const OPTIONS = { accountId: 'acct-1', currency: 'USD' } as const;

const BANCO_GENERAL_CSV = `Fecha,Descripción,Débito,Crédito,Referencia
14/07/2026,SUPER 99 CDE,72.30,,REF-0011
15/07/2026,SALARIO JULIO,,2450.00,REF-0012
16/07/2026,"NETFLIX.COM, CA",12.99,,REF-0013
17/07/2026,PAGO TARJETA VISA,1200.00,,REF-0014`;

const SIGNED_AMOUNT_CSV = `Date;Description;Amount
2026-07-14;SUPER 99 CDE;-72.30
2026-07-15;SALARIO JULIO;2450.00`;

const EUROPEAN_DECIMAL_CSV = `Fecha;Concepto;Monto
14/07/2026;SUPER 99 CDE;-1.234,56`;

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>USD
<BANKACCTFROM><ACCTID>0000123456</ACCTID></BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260701
<DTEND>20260731
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260714120000[-5:EST]
<TRNAMT>-72.30
<FITID>2026071400001
<NAME>SUPER 99 COSTA DEL ESTE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260715
<TRNAMT>2450.00
<FITID>2026071500002
<NAME>SALARIO
<MEMO>DEPOSITO NOMINA
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>4180.00</BALAMT></LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe('format detection', () => {
  it('reads the content, not the file name', () => {
    // A bank that serves OFX named .qfx, or a user who renames a download, must
    // still get the right parser.
    expect(detectStatementFormat(OFX, 'statement.txt')).toBe('ofx');
    expect(detectStatementFormat(OFX, 'statement.qfx')).toBe('qfx');
    expect(detectStatementFormat(BANCO_GENERAL_CSV, 'weird.dat')).toBe('csv');
    expect(detectStatementFormat('%PDF-1.7 ...')).toBe('pdf');
    expect(detectStatementFormat('PK...')).toBe('xlsx');
    expect(detectStatementFormat('nothing useful here')).toBeNull();
  });

  it('says plainly what it cannot do yet', () => {
    // An error that names the recovery, not the rule that was broken.
    expect(() => parseStatement('%PDF-1.7', OPTIONS)).toThrow(StatementParseError);
    expect(() => parseStatement('%PDF-1.7', OPTIONS)).toThrow(/CSV or OFX/);
  });
});

describe('amount parsing', () => {
  it('handles both thousands conventions', () => {
    // Confusing these changes a figure by three orders of magnitude.
    expect(parseAmountText('1,234.56')).toBe('1234.56');
    expect(parseAmountText('1.234,56')).toBe('1234.56');
    expect(parseAmountText('1234.56')).toBe('1234.56');
    expect(parseAmountText('1,56')).toBe('1.56');
    expect(parseAmountText('1,560')).toBe('1560');
  });

  it('reads accounting notation as negative', () => {
    expect(parseAmountText('(72.30)')).toBe('-72.30');
    expect(parseAmountText('-72.30')).toBe('-72.30');
  });

  it('strips currency symbols', () => {
    expect(parseAmountText('B/. 1,234.56')).toBe('1234.56');
    expect(parseAmountText('$72.30')).toBe('72.30');
  });

  it('refuses what it cannot read rather than guessing', () => {
    expect(parseAmountText('n/a')).toBeNull();
    expect(parseAmountText('')).toBeNull();
  });
});

describe('date parsing', () => {
  it('reads the Panamanian day-first convention', () => {
    expect(parseStatementDate('14/07/2026', true)).toBe('2026-07-14');
    expect(parseStatementDate('07/14/2026', false)).toBe('2026-07-14');
    expect(parseStatementDate('2026-07-14', true)).toBe('2026-07-14');
  });

  it('resolves the order from the value when one component exceeds twelve', () => {
    // Unambiguous whatever the configured convention says.
    expect(parseStatementDate('14/07/2026', false)).toBe('2026-07-14');
    expect(parseStatementDate('07/14/2026', true)).toBe('2026-07-14');
  });

  it('refuses a date that does not exist', () => {
    expect(parseStatementDate('31/02/2026', true)).toBeNull();
    expect(parseStatementDate('not a date', true)).toBeNull();
  });
});

describe('CSV statements', () => {
  it('reads separate debit and credit columns with the right signs', () => {
    const statement = parseStatement(BANCO_GENERAL_CSV, OPTIONS);

    expect(statement.transactions).toHaveLength(4);
    expect(statement.rejected).toEqual([]);

    const [purchase, salary] = statement.transactions;
    expect(purchase?.amount.toCurrencyString()).toBe('-72.30');
    expect(purchase?.direction).toBe('outflow');
    expect(salary?.amount.toCurrencyString()).toBe('2450.00');
    expect(salary?.direction).toBe('inflow');
  });

  it('handles a quoted field containing the delimiter', () => {
    const statement = parseStatement(BANCO_GENERAL_CSV, OPTIONS);
    expect(statement.transactions[2]?.descriptionOriginal).toBe('NETFLIX.COM, CA');
  });

  it('reads a single signed amount column', () => {
    const statement = parseStatement(SIGNED_AMOUNT_CSV, OPTIONS);

    expect(statement.transactions[0]?.amount.toCurrencyString()).toBe('-72.30');
    expect(statement.transactions[1]?.amount.toCurrencyString()).toBe('2450.00');
  });

  it('reads a comma decimal separator with a semicolon delimiter', () => {
    const statement = parseStatement(EUROPEAN_DECIMAL_CSV, OPTIONS);
    expect(statement.transactions[0]?.amount.toCurrencyString()).toBe('-1234.56');
  });

  it('reports unreadable rows instead of dropping them', () => {
    // A silently skipped row is a missing transaction the user never learns
    // about, which is worse than a failed import.
    const statement = parseStatement(
      `Fecha,Descripción,Monto\n14/07/2026,OK,-10.00\nbasura,SIN FECHA,-5.00\n15/07/2026,SIN MONTO,`,
      OPTIONS,
    );

    expect(statement.transactions).toHaveLength(1);
    expect(statement.rejected).toHaveLength(2);
    expect(statement.rejected[0]?.reason).toMatch(/date/i);
    expect(statement.rejected[1]?.reason).toMatch(/amount/i);
  });

  it('refuses a file with no recognisable columns', () => {
    expect(() => parseStatement('a,b,c\n1,2,3', OPTIONS)).toThrow(StatementParseError);
  });
});

describe('OFX statements', () => {
  it('reads transactions, period and closing balance', () => {
    const statement = parseStatement(OFX, OPTIONS);

    expect(statement.format).toBe('ofx');
    expect(statement.transactions).toHaveLength(2);
    expect(statement.periodStart).toBe('2026-07-01');
    expect(statement.periodEnd).toBe('2026-07-31');
    expect(statement.closingBalance?.toCurrencyString()).toBe('4180.00');
    expect(statement.accountHint).toBe('0000123456');
  });

  it('carries the institution identifier through as the strongest dedupe signal', () => {
    const statement = parseStatement(OFX, OPTIONS);
    expect(statement.transactions[0]?.externalReference).toBe('2026071400001');
  });

  it('handles a timezone-suffixed date without shifting the day', () => {
    // `20260714120000[-5:EST]` is July 14. Parsing it through a Date would risk
    // landing on the 13th depending on where the server stands.
    const statement = parseStatement(OFX, OPTIONS);
    expect(statement.transactions[0]?.transactionDate).toBe('2026-07-14');
  });

  it('joins NAME and MEMO into one description', () => {
    const statement = parseStatement(OFX, OPTIONS);
    expect(statement.transactions[1]?.descriptionOriginal).toBe('SALARIO — DEPOSITO NOMINA');
  });
});

describe('importing the same statement twice', () => {
  it('produces no new transactions the second time', () => {
    // The product's central promise, end to end: parse, then assess every row
    // against what parsing produced the first time (spec §10, §67).
    const first = parseStatement(BANCO_GENERAL_CSV, OPTIONS);

    const stored = first.transactions.map((transaction, index) => ({
      id: `tx-${String(index)}`,
      accountId: OPTIONS.accountId,
      transactionDate: transaction.transactionDate,
      postedDate: null,
      amount: transaction.amount,
      descriptionNormalized: transaction.descriptionNormalized,
      externalReference: transaction.externalReference ?? null,
      fingerprint: transaction.fingerprint,
      merchantId: null,
      sourceDocumentId: 'doc-1',
    }));

    const second = parseStatement(BANCO_GENERAL_CSV, OPTIONS);
    const verdicts = second.transactions.map(
      (transaction) => assessDuplicate(transaction, stored).verdict,
    );

    expect(verdicts).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate']);
  });

  it('recognises the OFX export of a purchase already imported from CSV', () => {
    // Same purchase, two channels, different descriptions. One transaction.
    const csv = parseStatement(BANCO_GENERAL_CSV, OPTIONS);
    const purchase = csv.transactions[0];
    expect(purchase).toBeDefined();

    const stored = [
      {
        id: 'tx-csv',
        accountId: OPTIONS.accountId,
        transactionDate: purchase?.transactionDate ?? '2026-07-14',
        postedDate: null,
        amount: purchase?.amount ?? csv.transactions[0]?.amount,
        descriptionNormalized: purchase?.descriptionNormalized ?? '',
        externalReference: null,
        fingerprint: purchase?.fingerprint ?? '',
        merchantId: null,
        sourceDocumentId: 'doc-csv',
      },
    ] as never;

    const ofx = parseStatement(OFX, OPTIONS);
    const result = assessDuplicate(ofx.transactions[0] as never, stored);

    expect(result.verdict).not.toBe('new');
    expect(result.matchedTransactionId).toBe('tx-csv');
  });
});
