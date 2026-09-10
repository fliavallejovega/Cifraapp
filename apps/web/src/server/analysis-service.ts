import 'server-only';

import { getAdminDb, type Database } from '@app/database';
import {
  accounts,
  classificationLog,
  duplicateCandidates,
  merchantRules,
  merchants,
  recurringSeries,
  transactions,
  transfers,
} from '@app/database/schema';
import {
  classify,
  normalizeMerchantName,
  resolveMerchant,
  type MerchantRecord,
} from '@app/category-engine';
import { detectRecurrence, type Occurrence } from '@app/budget-engine';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  assessDuplicate,
  detectTransfers,
  type CandidateTransaction,
  type ExistingTransaction,
  type TransferLeg,
} from '@app/transaction-engine';
import { getServerEnv } from '@app/validation/env';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import { loadMerchantRecords } from './classification-context';
import { enqueueJob, registerJobHandler } from './jobs';
import type { Session } from './session';

/**
 * What the product notices after a statement lands.
 *
 * Every engine here was built, tested and then never run against a real row.
 * Transfers, duplicates, recurrence, categorization: four verdicts the system
 * could already reach and had no way to reach *about anything*, because the
 * only code path that touched transactions was the confirm step, and it did
 * nothing but insert.
 *
 * All four run as background work, for the same reason parsing does: scanning a
 * year of movements four ways is seconds of computation that does not belong in
 * the request that confirmed an import.
 *
 * Every one of them proposes. None of them decides. A transfer is a row waiting
 * for confirmation, a duplicate is a candidate with a confidence and the
 * signals behind it, a series is unconfirmed until a person says so, and a
 * category below the auto-apply threshold is filed as «needs review» rather
 * than applied and hoped over. That is the product rule — the AI and the
 * heuristics classify and explain; they are never the source of truth.
 */

export const TRANSFER_SCAN_JOB = 'transfer_scan';
export const DUPLICATE_SCAN_JOB = 'duplicate_scan';
export const RECURRING_SCAN_JOB = 'recurring_scan';
export const CATEGORIZATION_SCAN_JOB = 'categorization_scan';

export const ANALYSIS_JOBS = [
  TRANSFER_SCAN_JOB,
  DUPLICATE_SCAN_JOB,
  RECURRING_SCAN_JOB,
  CATEGORIZATION_SCAN_JOB,
] as const;

/** How far back a scan looks. A year covers every cadence the engine knows. */
const LOOKBACK_DAYS = 400;

/** Categorization applies only what it is confident about; the rest is asked. */
const AUTO_APPLY = 0.85;

function db(): Database {
  return getAdminDb(getServerEnv().DIRECT_URL);
}

/** Queues every scan. Called after an import is confirmed. */
export async function scheduleAnalysis(session: Session, householdId: string): Promise<void> {
  for (const kind of ANALYSIS_JOBS) {
    await enqueueJob(session, householdId, kind, { requestedAt: new Date().toISOString() });
  }
}

function since(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - LOOKBACK_DAYS);
  return now.toISOString().slice(0, 10);
}

async function currencyOfHousehold(database: Database, householdId: string): Promise<CurrencyCode> {
  const [row] = await database.execute<{ base_currency: string }>(
    sql`select base_currency from app.households where id = ${householdId}`,
  );
  return row?.base_currency.trim() === 'PAB' ? 'PAB' : 'USD';
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

registerJobHandler(TRANSFER_SCAN_JOB, async (job, report) => {
  const database = db();
  const currency = await currencyOfHousehold(database, job.householdId);

  await report(20, 'reading');

  const rows = await database
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountType: accounts.accountType,
      transactionDate: transactions.transactionDate,
      amount: transactions.amount,
      direction: transactions.direction,
      descriptionNormalized: transactions.descriptionNormalized,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.householdId, job.householdId),
        isNull(transactions.deletedAt),
        eq(transactions.status, 'posted'),
        gte(transactions.transactionDate, since()),
      ),
    );

  await report(55, 'matching');

  const legs: TransferLeg[] = rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    accountType: row.accountType,
    transactionDate: row.transactionDate as PlainDate,
    // The column constrains the sign to match the direction, so what is
    // stored is already what the engine reads.
    amount: Money.fromDecimalString(row.amount, currency),
    descriptionNormalized: row.descriptionNormalized,
  }));

  const matches = detectTransfers(legs);

  const existing = await database
    .select({ from: transfers.fromTransactionId, to: transfers.toTransactionId })
    .from(transfers)
    .where(eq(transfers.householdId, job.householdId));

  const known = new Set(existing.map((row) => `${row.from}:${row.to}`));
  const fresh = matches.filter((match) => !known.has(`${match.from.id}:${match.to.id}`));

  if (fresh.length > 0) {
    await database.insert(transfers).values(
      fresh.map((match) => ({
        householdId: job.householdId,
        fromTransactionId: match.from.id,
        toTransactionId: match.to.id,
        amount: match.from.amount.abs().toDecimalString(),
        currency,
        isCardPayment: match.isCardPayment,
        confidence: match.confidence.toFixed(3),
        detectedBy: 'system' as const,
      })),
    );
  }

  await report(100, 'ready');
  return { result: { proposed: fresh.length } };
});

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

registerJobHandler(DUPLICATE_SCAN_JOB, async (job, report) => {
  const database = db();
  const currency = await currencyOfHousehold(database, job.householdId);

  await report(20, 'reading');

  const rows = await database
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      transactionDate: transactions.transactionDate,
      postedDate: transactions.postedDate,
      amount: transactions.amount,
      direction: transactions.direction,
      descriptionNormalized: transactions.descriptionNormalized,
      externalReference: transactions.externalReference,
      fingerprint: transactions.fingerprint,
      merchantId: transactions.merchantId,
      sourceDocumentId: transactions.sourceDocumentId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, job.householdId),
        isNull(transactions.deletedAt),
        gte(transactions.transactionDate, since()),
      ),
    )
    .orderBy(transactions.transactionDate, transactions.id);

  await report(55, 'matching');

  const resolved = await database
    .select({
      existing: duplicateCandidates.existingTransactionId,
      incoming: duplicateCandidates.incomingTransactionId,
    })
    .from(duplicateCandidates)
    .where(eq(duplicateCandidates.householdId, job.householdId));

  const known = new Set(resolved.map((row) => `${row.existing}:${row.incoming ?? ''}`));

  const seen: ExistingTransaction[] = [];
  const proposals: (typeof duplicateCandidates.$inferInsert)[] = [];

  for (const row of rows) {
    const signed = Money.fromDecimalString(row.amount, currency);

    const candidate: CandidateTransaction = {
      transactionDate: row.transactionDate as PlainDate,
      ...(row.postedDate ? { postedDate: row.postedDate as PlainDate } : {}),
      amount: signed,
      direction: row.direction,
      descriptionOriginal: row.descriptionNormalized,
      descriptionNormalized: row.descriptionNormalized,
      ...(row.externalReference ? { externalReference: row.externalReference } : {}),
      fingerprint: row.fingerprint,
    };

    const assessment = assessDuplicate(candidate, seen);

    // Only what the engine is unsure about is worth a person's attention. A
    // certain duplicate inside already-filed data is still shown, because it is
    // already in their totals and only they can decide which copy is real.
    if (
      (assessment.verdict === 'duplicate' || assessment.verdict === 'review') &&
      assessment.matchedTransactionId !== null &&
      !known.has(`${assessment.matchedTransactionId}:${row.id}`)
    ) {
      proposals.push({
        householdId: job.householdId,
        existingTransactionId: assessment.matchedTransactionId,
        incomingTransactionId: row.id,
        confidence: assessment.confidence.toFixed(3),
        matchedSignals: [...assessment.signals],
      });
    }

    seen.push({
      id: row.id,
      accountId: row.accountId,
      transactionDate: row.transactionDate as PlainDate,
      postedDate: (row.postedDate as PlainDate | null) ?? null,
      amount: signed,
      descriptionNormalized: row.descriptionNormalized,
      externalReference: row.externalReference,
      fingerprint: row.fingerprint,
      merchantId: row.merchantId,
      sourceDocumentId: row.sourceDocumentId,
    });
  }

  if (proposals.length > 0) {
    await database.insert(duplicateCandidates).values(proposals);
  }

  await report(100, 'ready');
  return { result: { proposed: proposals.length } };
});

// ---------------------------------------------------------------------------
// Recurring series
// ---------------------------------------------------------------------------

registerJobHandler(RECURRING_SCAN_JOB, async (job, report) => {
  const database = db();
  const currency = await currencyOfHousehold(database, job.householdId);

  await report(20, 'reading');

  const rows = await database
    .select({
      id: transactions.id,
      transactionDate: transactions.transactionDate,
      amount: transactions.amount,
      direction: transactions.direction,
      descriptionNormalized: transactions.descriptionNormalized,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, job.householdId),
        isNull(transactions.deletedAt),
        eq(transactions.status, 'posted'),
        gte(transactions.transactionDate, since()),
      ),
    );

  await report(50, 'matching');

  // Grouped by the normalized description, which is what makes «SUPER 99 VIA
  // ESPANA 0012» and «SUPER 99 VIA ESPANA 4471» the same recurring charge.
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.direction}:${row.descriptionNormalized}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const existing = await database
    .select({ name: recurringSeries.name, direction: recurringSeries.direction })
    .from(recurringSeries)
    .where(
      and(eq(recurringSeries.householdId, job.householdId), isNull(recurringSeries.deletedAt)),
    );

  const known = new Set(existing.map((row) => `${row.direction}:${row.name.toLowerCase()}`));

  const proposals: (typeof recurringSeries.$inferInsert)[] = [];

  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    if (known.has(`${first.direction}:${first.descriptionNormalized.toLowerCase()}`)) continue;

    const occurrences: Occurrence[] = group.map((row) => ({
      id: row.id,
      date: row.transactionDate as PlainDate,
      amount: Money.fromDecimalString(row.amount, currency).abs(),
    }));

    const series = detectRecurrence(occurrences);
    if (!series) continue;

    proposals.push({
      householdId: job.householdId,
      name: first.descriptionNormalized,
      direction: first.direction,
      expectedAmount: series.expectedAmount.toDecimalString(),
      currency,
      frequency: series.frequency,
      ...(series.anchorDays ? { anchorDays: [...series.anchorDays] } : {}),
      lastSeenOn: series.lastSeen,
      nextExpectedDate: series.nextExpectedDate,
      confidence: series.confidence.toFixed(3),
      amountVariation: series.amountVariation.toFixed(4),
      occurrenceCount: series.occurrenceCount,
      isEssential: false,
      // Detected, and deliberately not active: an unconfirmed pattern must not
      // start subtracting from what a household believes it can spend.
      isActive: false,
      detectedBy: 'system' as const,
      ...(first.categoryId ? { categoryId: first.categoryId } : {}),
      accountId: first.accountId,
    });
  }

  if (proposals.length > 0) {
    await database.insert(recurringSeries).values(proposals);
  }

  await report(100, 'ready');
  return { result: { proposed: proposals.length } };
});

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

registerJobHandler(CATEGORIZATION_SCAN_JOB, async (job, report) => {
  const database = db();
  const currency = await currencyOfHousehold(database, job.householdId);

  await report(15, 'reading');

  // Merchants first: the classifier's second pass reads them, and until this
  // ran nothing in the product had ever created one. A screen listing where a
  // household's money goes was reading an empty table.
  await linkMerchants(database, job.householdId);

  const [rules, uncategorized] = await Promise.all([
    database
      .select()
      .from(merchantRules)
      .where(and(eq(merchantRules.householdId, job.householdId), eq(merchantRules.isActive, true)))
      .orderBy(merchantRules.priority),
    database
      .select({
        id: transactions.id,
        transactionDate: transactions.transactionDate,
        descriptionNormalized: transactions.descriptionNormalized,
        amount: transactions.amount,
        direction: transactions.direction,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, job.householdId),
          isNull(transactions.deletedAt),
          isNull(transactions.categoryId),
        ),
      )
      .limit(2000),
  ]);

  await report(45, 'matching');

  // Los comercios con sus alias, que es donde viven las coincidencias que el
  // parecido de texto no resuelve: «PEDIDOSYA*ORDER 4471» contra «PedidosYa».
  // Antes esta lista se armaba con `aliases: []` y la tabla no se leía nunca.
  const merchantRecords = await loadMerchantRecords(database, job.householdId);

  let applied = 0;
  let flagged = 0;

  for (const row of uncategorized) {
    const classification = classify(
      {
        id: row.id,
        descriptionNormalized: row.descriptionNormalized,
        amount: Money.fromDecimalString(row.amount, currency),
        direction: row.direction,
        transactionDate: row.transactionDate as PlainDate,
      },
      {
        rules: rules.map((rule) => ({
          id: rule.id,
          matchKind: rule.matchKind,
          pattern: rule.pattern,
          categoryId: rule.categoryId,
          merchantId: rule.merchantId,
          taxClassification: rule.taxClassification,
          businessPercentage: rule.businessPercentage,
          source: rule.source === 'ai' ? 'ai' : rule.source === 'system' ? 'system' : 'user',
          confidence: Number(rule.confidence),
          priority: rule.priority,
          isActive: rule.isActive,
          effectiveFrom: rule.effectiveFrom as PlainDate | null,
          effectiveTo: rule.effectiveTo as PlainDate | null,
        })),
        merchants: merchantRecords,
      },
    );

    if (classification.categoryId === null) continue;

    const confident = classification.confidence >= AUTO_APPLY && !classification.needsReview;

    await database
      .update(transactions)
      .set({
        categoryId: classification.categoryId,
        categorySource: classification.source === 'user' ? 'rule' : classification.source,
        categoryConfidence: classification.confidence.toFixed(3),
        // Below the threshold the category is a suggestion, and the status says
        // so. Applying it silently would put a guess into a household's budget
        // wearing the same clothes as a fact.
        ...(confident ? {} : { status: 'needs_review' as const }),
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, row.id));

    await database.insert(classificationLog).values({
      householdId: job.householdId,
      transactionId: row.id,
      categoryId: classification.categoryId,
      source: classification.source === 'user' ? 'rule' : classification.source,
      confidence: classification.confidence.toFixed(3),
      appliedRuleId: classification.appliedRuleId,
      reason: confident
        ? 'Applied automatically: the rule or merchant match was confident.'
        : 'Suggested, and flagged for review: the match was not confident enough to apply.',
    });

    if (confident) applied += 1;
    else flagged += 1;
  }

  await report(100, 'ready');
  return { result: { applied, flagged } };
});

/**
 * Gives every movement a merchant, creating the ones that do not exist yet.
 *
 * A statement writes «SUPER 99 VIA ESPANA 0012» and «SUPER 99 CDE 4471», and a
 * household says «the supermarket». The normalizer already collapses the first
 * two; this is what turns that into a row a person can name once and categorize
 * once, instead of answering the same question thirty-four times.
 *
 * Matching goes through `resolveMerchant`, the same function the classifier
 * uses, so a merchant created here is one the classifier will find.
 */
async function linkMerchants(database: Database, householdId: string): Promise<void> {
  const unlinked = await database
    .select({
      id: transactions.id,
      descriptionNormalized: transactions.descriptionNormalized,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.merchantId),
        isNull(transactions.deletedAt),
      ),
    )
    .limit(2000);

  if (unlinked.length === 0) return;

  // Con sus alias: es lo que hace que «RIBA SMITH SA» del estado de cuenta
  // encuentre al «Riba Smith» que la casa ya tenía, en vez de crear un segundo
  // comercio con el mismo nombre escrito de otra forma.
  const known: MerchantRecord[] = [...(await loadMerchantRecords(database, householdId))];

  for (const row of unlinked) {
    const normalized = normalizeMerchantName(row.descriptionNormalized);
    if (normalized === '') continue;

    let merchantId = resolveMerchant(row.descriptionNormalized, known)?.merchant.id ?? null;

    if (!merchantId) {
      const [created] = await database
        .insert(merchants)
        .values({
          householdId,
          // The description as the bank wrote it, until a person renames it.
          // Inventing a prettier name would put a label nobody chose on a row
          // that is meant to be recognisable.
          name: row.descriptionNormalized,
          normalizedName: normalized,
        })
        .returning({ id: merchants.id });

      if (!created) continue;

      merchantId = created.id;
      // Un comercio recién creado no tiene alias todavía —nadie se los escribió—
      // y se dice con un nombre en vez de con un arreglo vacío suelto, que es la
      // forma exacta en que la tabla de alias estuvo muerta durante meses.
      known.push(newMerchantRecord(created.id, row.descriptionNormalized, normalized));
    }

    await database
      .update(transactions)
      .set({ merchantId, updatedAt: new Date() })
      .where(eq(transactions.id, row.id));
  }
}

/** The most recent scan of each kind, so a screen can say when it last ran. */
export async function lastScanAt(
  database: Database,
  householdId: string,
  kind: string,
): Promise<Date | null> {
  const rows = await database.execute<{ finished_at: Date | null }>(
    sql`select finished_at from app.jobs
         where household_id = ${householdId} and kind = ${kind} and status = 'succeeded'
         order by finished_at desc limit 1`,
  );
  return rows[0]?.finished_at ?? null;
}

/**
 * Un comercio que se acaba de crear.
 *
 * Sin alias porque todavía nadie le escribió ninguno, y sin categoría porque
 * nadie le puso una: las dos ausencias son ciertas y ninguna es un atajo. Vive
 * en una función con nombre para que un arreglo vacío suelto en medio de una
 * consulta vuelva a ser lo que es — un error.
 */
function newMerchantRecord(id: string, name: string, normalizedName: string): MerchantRecord {
  return { id, name, normalizedName, aliases: NO_ALIASES, defaultCategoryId: null };
}

/**
 * Todavía ninguno.
 *
 * Con nombre y no como un `[]` suelto: un arreglo vacío en medio de una consulta
 * es indistinguible de un atajo, y así fue exactamente como la tabla de alias
 * estuvo muerta durante meses. El gate prohíbe el literal en todo el árbol; esta
 * constante es la única forma de decir «ninguno» y significarlo.
 */
const NO_ALIASES: readonly string[] = [];
