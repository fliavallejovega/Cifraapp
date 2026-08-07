'use server';

import { accounts } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';

import { runImport, type ImportSummary } from './import-service';
import { loadSession, queryAsUser } from './session';

/**
 * The upload action.
 *
 * The file is read into memory and handed to the import service. For the file
 * sizes a bank statement actually reaches that is fine; when PDF and OCR arrive
 * this moves to a background job, because parsing must never happen inside a
 * synchronous request (spec §12).
 */

export interface ImportActionResult {
  readonly error?: string;
  readonly detail?: string;
  readonly summary?: ImportSummary;
  readonly summaryLabel?: string;
}

export async function importStatement(
  _previous: ImportActionResult,
  formData: FormData,
): Promise<ImportActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'noAccount' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'unsupportedType' };
  }

  const householdId = session.activeHouseholdId;

  // An import needs an account to belong to. Rather than guessing, the first
  // active account is used and Phase 4's account picker replaces this — a
  // transaction filed against the wrong account is worse than one not filed.
  const account = await queryAsUser(session, (tx) =>
    tx
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.status, 'active'),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1),
  );

  const target = account[0];
  if (!target) return { error: 'noAccount' };

  const bytes = new Uint8Array(await file.arrayBuffer());

  const outcome = await runImport(session, {
    householdId,
    accountId: target.id,
    currency: target.currency.trim() === 'PAB' ? 'PAB' : 'USD',
    fileName: file.name,
    mimeType: file.type || 'text/csv',
    bytes,
  });

  if (!outcome.ok) {
    return { error: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) };
  }

  return {
    summary: outcome.summary,
    // Literally true, and checkable. Never "100% automated" (spec §105).
    summaryLabel: `${String(outcome.summary.found)} found · ${String(outcome.summary.created)} new · ${String(outcome.summary.duplicate)} duplicate · ${String(outcome.summary.review)} need review`,
  };
}
