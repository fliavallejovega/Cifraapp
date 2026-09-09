import 'server-only';

import { cache } from 'react';

import { createRequestClient, getAuthenticatedUser } from './supabase';

/**
 * Two-step verification, read side.
 *
 * Supabase models it as *factors* on the user and an *assurance level* on the
 * session. A person who has enrolled an authenticator app holds a verified
 * TOTP factor, and a session that signed in with only a password sits at
 * `aal1` with `aal2` as the level it could reach. The product's rule is
 * simple: if a higher level is reachable, it is required — a second step that
 * exists but is optional protects nobody.
 *
 * The assurance level is local: it decodes the session's own token. The factors
 * are read off the user object that `getAuthenticatedUser` already verified for
 * this render — `supabase.auth.mfa.listFactors()` looks like a local read and
 * is not, because internally it calls `getUser()` and so spends a second round
 * trip to the auth server on *every* navigation, re-fetching a user the request
 * had already fetched. Same data, one call.
 */

export interface TwoFactorState {
  /** Whether the person has finished enrolling an authenticator. */
  readonly enabled: boolean;
  /** The verified factor, if any. Needed to challenge and to unenroll. */
  readonly factorId: string | null;
  /** Whether this session has already passed the second step. */
  readonly verified: boolean;
  /** Whether this session still owes the second step. */
  readonly required: boolean;
}

export const loadTwoFactorState = cache(async (): Promise<TwoFactorState> => {
  const supabase = await createRequestClient();

  const [user, { data: level }] = await Promise.all([
    getAuthenticatedUser(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  const verifiedFactor =
    user?.factors?.find(
      (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
    ) ?? null;
  const verified = level?.currentLevel === 'aal2';
  const required = level?.nextLevel === 'aal2' && level.currentLevel !== 'aal2';

  return {
    enabled: verifiedFactor !== null,
    factorId: verifiedFactor?.id ?? null,
    verified,
    required,
  };
});
