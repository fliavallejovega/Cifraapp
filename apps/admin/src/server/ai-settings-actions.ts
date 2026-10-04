'use server';

import { adminActions, aiModels, aiSettings } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { adminDb, loadAdminSession, satisfies } from './admin-session';

/**
 * Pointing a job at a model.
 *
 * Two jobs: `reading` (bank statements and travel documents) and `chat` (the
 * assistant). The choice is limited to the active models of the configured
 * provider — a key that does not exist there would fail every call — and an
 * empty choice removes the row, which sends the job back to the environment's
 * model. The before and the after go to the admin audit trail in the same
 * transaction as the change.
 */

export interface AISettingResult {
  readonly error?: 'forbidden' | 'invalid' | 'generic';
  readonly saved?: true;
}

const PURPOSES = new Set(['reading', 'chat']);

export async function saveAISetting(
  _previous: AISettingResult,
  formData: FormData,
): Promise<AISettingResult> {
  const session = await loadAdminSession();
  if (!session || !satisfies(session.role, 'super_admin')) return { error: 'forbidden' };

  const text = (key: string): string => {
    const value = formData.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };
  const purpose = text('purpose');
  const model = text('model');
  if (!PURPOSES.has(purpose)) return { error: 'invalid' };

  const db = adminDb();
  const provider = getServerEnv().AI_PROVIDER;

  if (model !== '') {
    const [known] = await db
      .select({ key: aiModels.modelKey })
      .from(aiModels)
      .where(
        and(
          eq(aiModels.provider, provider),
          eq(aiModels.modelKey, model),
          eq(aiModels.isActive, true),
        ),
      )
      .limit(1);
    if (!known) return { error: 'invalid' };
  }

  try {
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ model: aiSettings.modelKey })
        .from(aiSettings)
        .where(eq(aiSettings.purpose, purpose))
        .limit(1);

      if (model === '') {
        await tx.delete(aiSettings).where(eq(aiSettings.purpose, purpose));
      } else {
        await tx
          .insert(aiSettings)
          .values({ purpose, modelKey: model, updatedBy: session.profileId })
          .onConflictDoUpdate({
            target: aiSettings.purpose,
            set: { modelKey: model, updatedBy: session.profileId, updatedAt: new Date() },
          });
      }

      await tx.insert(adminActions).values({
        actorId: session.profileId,
        actorRole: session.role,
        action: 'ai.model.set',
        targetKind: 'ai_setting',
        targetId: purpose,
        before: { model: before?.model ?? null },
        after: { model: model === '' ? null : model },
      });
    });
  } catch {
    return { error: 'generic' };
  }

  revalidatePath('/ai');
  return { saved: true };
}
