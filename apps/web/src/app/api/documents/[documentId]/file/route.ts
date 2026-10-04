import { documents } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';

import { queryAsUser, loadSession } from '@/server/session';
import { readDocument } from '@/server/storage';

/**
 * One uploaded image, shown back to the household that uploaded it — so a
 * person asked «is this one movement or two?» can look at the captures.
 *
 * Read under the person's own RLS: another household's document is simply not
 * found. Served through here instead of a signed storage link, so the page's
 * image policy stays the app's own origin. Images only; a PDF opens from its
 * import screen.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return new Response('Unauthorized', { status: 401 });
  const { documentId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(documentId)) return new Response('Not found', { status: 404 });
  const householdId = session.activeHouseholdId;

  const [doc] = await queryAsUser(session, (tx) =>
    tx
      .select({ storageKey: documents.storageKey, mimeType: documents.mimeType })
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.householdId, householdId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1),
  );
  if (!doc?.mimeType.startsWith('image/')) return new Response('Not found', { status: 404 });

  const bytes = await readDocument(doc.storageKey).catch(() => null);
  if (!bytes) return new Response('Not found', { status: 404 });

  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': doc.mimeType,
      'cache-control': 'private, max-age=600',
      'x-content-type-options': 'nosniff',
    },
  });
}
