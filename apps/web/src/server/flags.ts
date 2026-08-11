import 'server-only';

import { getDb } from '@app/database';
import { featureFlagOverrides, featureFlags } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { eq } from 'drizzle-orm';

import { resolveFlag, type FlagContext } from './flag-resolution';

/**
 * Reading a flag for a caller.
 *
 * Fails closed: an unknown key is off, and so is a flag whose row cannot be
 * read. A feature that switches itself on because a query failed is the
 * opposite of what a flag is for.
 */
export async function isEnabled(key: string, context: FlagContext): Promise<boolean> {
  const db = getDb(getServerEnv().DATABASE_URL);

  const [flag] = await db
    .select({ defaultEnabled: featureFlags.defaultEnabled })
    .from(featureFlags)
    .where(eq(featureFlags.key, key))
    .limit(1);

  if (!flag) return false;

  const overrides = await db
    .select({
      scope: featureFlagOverrides.scope,
      targetId: featureFlagOverrides.targetId,
      enabled: featureFlagOverrides.enabled,
    })
    .from(featureFlagOverrides)
    .where(eq(featureFlagOverrides.flagKey, key));

  return resolveFlag(flag.defaultEnabled, overrides, context);
}

export {
  resolveFlag,
  type FlagContext,
  type FlagOverride,
  type FlagScope,
} from './flag-resolution';
