'use server';

import { documents } from '@app/database/schema';
import { type CurrencyCode } from '@app/domain';
import { and, eq, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { runJobNow } from './jobs';
import { tripsEnabled } from './repositories/trips';
import { revalidateTrip } from './revalidate';
import { loadSession, queryAsUser } from './session';
import {
  applyTripDocument,
  confirmInput,
  type ConfirmTripDocumentInput,
} from './trip-document-apply';
import { undoAutoApplied } from './trip-auto-apply';
import { stageTripDocument, TRIP_DOCUMENT_HINTS } from './trip-documents';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Travel documents: upload, confirm, discard, retry.
 *
 * Confirming is the only path from a reading to the books, and it does its
 * whole job in one database transaction: the trip when the document starts
 * one, the leg a hotel implies, the booking, the payment movement, the goal
 * credit and the document's own status. A second confirm of the same document
 * finds it no longer waiting for review and does nothing.
 */

export type { ConfirmTripDocumentInput } from './trip-document-apply';

type Locale = 'en' | 'es';

async function context() {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' } as const;
  if (!(await tripsEnabled(session, session.activeHouseholdId)))
    return { error: 'moduleOff' } as const;
  return {
    session,
    householdId: session.activeHouseholdId,
    currency: currencyOf(session, session.activeHouseholdId) as CurrencyCode,
  } as const;
}

/** Uploads one or more files; each is read in the background and waits for review. */
export async function uploadTripDocuments(
  formData: FormData,
): Promise<RecordActionResult & { readonly documents?: readonly string[] }> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const tripIdRaw = formData.get('tripId');
  const tripId =
    typeof tripIdRaw === 'string' && z.uuid().safeParse(tripIdRaw).success ? tripIdRaw : null;
  const locale: Locale = formData.get('locale') === 'en' ? 'en' : 'es';
  const hint = TRIP_DOCUMENT_HINTS.find((h) => h === formData.get('hint')) ?? null;
  const files = formData
    .getAll('files')
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, 10);
  if (files.length === 0) return { error: 'noFile' };

  const ids: string[] = [];
  const jobs: string[] = [];
  let lastError: string | null = null;
  for (const file of files) {
    const staged = await stageTripDocument(ctx.session, {
      householdId: ctx.householdId,
      tripId,
      fileName: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      hint,
    });
    if (staged.ok) {
      ids.push(staged.documentId);
      if (staged.jobId) jobs.push(staged.jobId);
    } else lastError = staged.reason;
  }
  // Read after the response is sent: the person keeps using the app.
  after(async () => {
    for (const job of jobs) await runJobNow(job);
  });
  revalidateTrip(locale, tripId);
  if (ids.length === 0) return { error: lastError ?? 'uploadFailed' };
  return { created: ids[0] ?? '', documents: ids };
}

export async function confirmTripDocument(
  documentId: string,
  raw: ConfirmTripDocumentInput,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!z.uuid().safeParse(documentId).success) return { error: 'notFound' };
  const parsed = confirmInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;

  try {
    const result = await queryAsUser(ctx.session, async (tx) => {
      return applyTripDocument(
        tx,
        { householdId: ctx.householdId, userId: ctx.session.user.id, currency: ctx.currency },
        documentId,
        input,
      );
    });
    if ('error' in result) return { error: result.error };
    revalidateTrip(locale, result.tripId);
    return { created: result.tripId };
  } catch {
    return { error: 'saveFailed' };
  }
}

export async function discardTripDocument(
  documentId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const rows = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(documents)
      .set({ tripStatus: 'discarded', tripReviewedAt: new Date() })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.householdId, ctx.householdId),
          sql`${documents.tripStatus} <> 'confirmed'`,
        ),
      )
      .returning({ tripId: documents.tripId }),
  );
  if (rows.length === 0) return { error: 'notFound' };
  revalidateTrip(locale, rows[0]?.tripId ?? null);
  return { ok: true };
}

/** Reads the document again: after a transport failure, or when the first reading was poor. */
export async function retryTripDocument(
  documentId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const [doc] = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(documents)
      .set({ tripStatus: 'pending', tripFailure: null })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.householdId, ctx.householdId),
          sql`${documents.tripStatus} in ('failed', 'needs_review', 'pending')`,
        ),
      )
      .returning({
        storageKey: documents.storageKey,
        mimeType: documents.mimeType,
        tripId: documents.tripId,
      }),
  );
  if (!doc) return { error: 'notFound' };
  const { enqueueJob } = await import('./jobs');
  const { TRIP_DOCUMENT_JOB } = await import('./trip-documents');
  const jobId = await enqueueJob(ctx.session, ctx.householdId, TRIP_DOCUMENT_JOB, {
    documentId,
    storageKey: doc.storageKey,
    mimeType: doc.mimeType,
    tripId: doc.tripId,
    userId: ctx.session.user.id,
    retry: Date.now(),
  });
  if (jobId) {
    after(async () => {
      await runJobNow(jobId);
    });
  }
  revalidateTrip(locale, doc.tripId);
  return { ok: true };
}

/**
 * «Deshacer» on a document the reader applied by itself: its hotel nights,
 * flights, booking and new city leg come off the trip, and the document goes
 * back to the review queue for a person to decide.
 */
export async function undoAutoAppliedTripDocument(
  documentId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!z.uuid().safeParse(documentId).success) return { error: 'notFound' };
  try {
    const undone = await queryAsUser(ctx.session, (tx) =>
      undoAutoApplied(tx, ctx.householdId, documentId),
    );
    if (!undone) return { error: 'notFound' };
    revalidateTrip(locale, undone.tripId);
    return { created: undone.tripId };
  } catch {
    return { error: 'saveFailed' };
  }
}
