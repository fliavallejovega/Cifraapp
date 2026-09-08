'use server';

import { redirect } from 'next/navigation';

import { loadTwoFactorState } from './mfa';
import { createRequestClient } from './supabase';

/**
 * Two-step verification, write side.
 *
 * Enrolment is two calls with a person in between: `enroll` hands back a
 * secret the authenticator app scans, and the factor only becomes real when a
 * code from that app is verified. An unverified factor is deleted on the way
 * out, so abandoning the screen halfway leaves nothing behind that could lock
 * the person out later.
 *
 * The code is six digits and nothing else. It is checked here before it is
 * sent, because the auth server's reply to a malformed code is slower and
 * says less.
 */

export interface EnrollmentStart {
  readonly factorId: string;
  /** An SVG data URI the authenticator app scans. */
  readonly qrCode: string;
  /** The same secret, for typing by hand when scanning is not possible. */
  readonly secret: string;
  readonly error?: 'signInRequired' | 'alreadyEnabled' | 'generic';
}

export interface MfaResult {
  readonly error?: 'invalidCode' | 'codeRejected' | 'signInRequired' | 'generic';
  readonly done?: boolean;
}

const CODE = /^\d{6}$/;

function codeFrom(formData: FormData): string | null {
  const value = formData.get('code');
  return typeof value === 'string' && CODE.test(value) ? value : null;
}

export async function beginEnrollment(): Promise<EnrollmentStart> {
  const empty = { factorId: '', qrCode: '', secret: '' };
  const supabase = await createRequestClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { ...empty, error: 'signInRequired' };

  const state = await loadTwoFactorState();
  if (state.enabled) return { ...empty, error: 'alreadyEnabled' };

  // A previous attempt that never finished leaves an unverified factor
  // behind, and Supabase refuses a second one with the same name. Clear it.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.totp ?? []) {
    if (factor.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator',
    issuer: 'Cifraapp',
  });
  if (error || !data.totp) return { ...empty, error: 'generic' };

  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmEnrollment(
  _previous: MfaResult,
  formData: FormData,
): Promise<MfaResult> {
  const code = codeFrom(formData);
  const factorId = formData.get('factorId');
  if (!code || typeof factorId !== 'string' || factorId === '') return { error: 'invalidCode' };

  const supabase = await createRequestClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: 'codeRejected' };

  return { done: true };
}

/** The second step of signing in. On success the session is raised to `aal2`. */
export async function verifySignIn(_previous: MfaResult, formData: FormData): Promise<MfaResult> {
  const code = codeFrom(formData);
  if (!code) return { error: 'invalidCode' };

  const state = await loadTwoFactorState();
  if (!state.factorId) return { error: 'signInRequired' };

  const supabase = await createRequestClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factorId, code });
  if (error) return { error: 'codeRejected' };

  const locale = formData.get('locale');
  const next = formData.get('next');
  const destination = typeof next === 'string' && next.startsWith('/') ? next : '/overview';
  redirect(`/${typeof locale === 'string' ? locale : 'es'}${destination}`);
}

/**
 * Switching it off. Requires a session that has passed the second step, which
 * the auth server enforces on its own: an `aal1` session cannot remove the
 * factor that would have raised it.
 */
export async function disableTwoFactor(
  _previous: MfaResult,
  formData: FormData,
): Promise<MfaResult> {
  const code = codeFrom(formData);
  if (!code) return { error: 'invalidCode' };

  const state = await loadTwoFactorState();
  if (!state.factorId) return { error: 'generic' };

  const supabase = await createRequestClient();

  // Asking for a fresh code before removal means a person who left a session
  // open cannot have the protection stripped by whoever sits down next.
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factorId, code });
  if (verified.error) return { error: 'codeRejected' };

  const { error } = await supabase.auth.mfa.unenroll({ factorId: state.factorId });
  if (error) return { error: 'generic' };

  return { done: true };
}
