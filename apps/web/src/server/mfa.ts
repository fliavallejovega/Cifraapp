import 'server-only';

import { createRequestClient } from './supabase';

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
 * Both reads are local to the session's token; neither costs a round trip to
 * the auth server.
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

export async function loadTwoFactorState(): Promise<TwoFactorState> {
  const supabase = await createRequestClient();

  const [{ data: factors }, { data: level }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  const verifiedFactor = factors?.totp.find((factor) => factor.status === 'verified') ?? null;
  const verified = level?.currentLevel === 'aal2';
  const required = level?.nextLevel === 'aal2' && level.currentLevel !== 'aal2';

  return {
    enabled: verifiedFactor !== null,
    factorId: verifiedFactor?.id ?? null,
    verified,
    required,
  };
}
