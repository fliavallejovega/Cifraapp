/**
 * Branded identifiers.
 *
 * Every one of these is a UUID string at runtime, but the compiler refuses to
 * let a `HouseholdId` be passed where an `AccountId` belongs. In a multi-tenant
 * financial system that is not pedantry: the most dangerous class of bug here is
 * a query scoped by the wrong identifier, which returns another household's
 * money. This makes that mistake a type error rather than a data leak (spec §6).
 */
declare const idBrand: unique symbol;

type Branded<TBrand extends string> = string & { readonly [idBrand]: TBrand };

export type UserId = Branded<'UserId'>;
export type OrganizationId = Branded<'OrganizationId'>;
export type HouseholdId = Branded<'HouseholdId'>;
export type MembershipId = Branded<'MembershipId'>;
export type PersonId = Branded<'PersonId'>;
export type AccountId = Branded<'AccountId'>;
export type TransactionId = Branded<'TransactionId'>;
export type CategoryId = Branded<'CategoryId'>;
export type MerchantId = Branded<'MerchantId'>;
export type BudgetId = Branded<'BudgetId'>;
export type GoalId = Branded<'GoalId'>;
export type DebtId = Branded<'DebtId'>;
export type RuleId = Branded<'RuleId'>;
export type DocumentId = Branded<'DocumentId'>;
export type ImportId = Branded<'ImportId'>;
export type LedgerAccountId = Branded<'LedgerAccountId'>;
export type JournalEntryId = Branded<'JournalEntryId'>;
export type TaxRuleId = Branded<'TaxRuleId'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Validates and brands an identifier coming from outside the system — a URL
 * parameter, a form field, a webhook payload.
 */
export function asId<TId extends string>(value: string, label: string): TId {
  // Tested against the pattern directly rather than through `isUuid`, whose type
  // predicate would narrow this already-`string` parameter to `never` in the
  // failure branch and make the error message untypeable.
  if (!UUID_PATTERN.test(value)) {
    throw new TypeError(`"${value}" is not a valid ${label}.`);
  }
  return value as TId;
}

/**
 * Generates a UUID v7: a 48-bit millisecond timestamp followed by randomness.
 *
 * Version 7 rather than 4 because these become primary keys on tables that grow
 * to millions of rows. Random v4 keys scatter inserts across the whole B-tree,
 * fragmenting the index; v7 keys sort by creation time, so inserts append and
 * range scans over recent transactions stay on adjacent pages (ADR-007).
 */
export function generateUuidV7(): string {
  const bytes = new Uint8Array(16);
  // `globalThis.crypto` rather than `node:crypto`, so this file stays runnable
  // in Node, the Edge runtime and the browser without a per-runtime branch.
  globalThis.crypto.getRandomValues(bytes);

  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  // Version 7 in the high nibble of byte 6, RFC 4122 variant in byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Generates a new branded identifier of the requested type. */
export function newId<TId extends string>(): TId {
  return generateUuidV7() as TId;
}
