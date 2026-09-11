'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requestAuthCallbackUrl } from '@/server/app-origin';
import { loadTwoFactorState } from './mfa';
import { createHousehold, loadSession } from './session';
import { createRequestClient } from './supabase';

/**
 * Authentication actions.
 *
 * Errors are returned rather than thrown, so a form can show them inline; and
 * they name the recovery rather than the rule that was broken. Supabase's own
 * messages are deliberately not passed through — they are written for
 * developers, occasionally leak whether an address is registered, and are only
 * ever in English.
 */

export interface ActionResult {
  readonly error?: string;
  readonly notice?: string;
}

const credentials = z.object({
  email: z.email(),
  password: z.string().min(8),
});

/**
 * The version of the terms a new account is agreeing to.
 *
 * Hard-coded rather than read from the database, and that is the point:
 * consent is to a specific text, and an account created today must record
 * agreement to the text that was on the page today. Reading «whatever the
 * latest version is» at insert time would silently re-point old consents at
 * new wording.
 *
 * Raising it here without seeding that version is a bug the acceptance record
 * will make obvious, which is the right direction for this to fail in.
 *
 * Not exported: a `'use server'` module may only export async functions, and a
 * constant leaving through that door fails the build rather than the type
 * check — which is a long way from where the mistake was made.
 */
const CURRENT_TERMS_VERSION = '1.0';

const signUpInput = credentials.extend({
  displayName: z.string().trim().min(1).max(80).optional(),
  /**
   * Ticked, or there is no account.
   *
   * A checkbox that defaults to off and blocks the button is the only form of
   * this that means anything. Pre-ticking it, or treating silence as assent,
   * would make the record worthless precisely when it is needed.
   */
  acceptTerms: z.literal('on', { message: 'termsRequired' }),
});

export async function signIn(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: 'invalidCredentialsFormat' };
  }

  const supabase = await createRequestClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately identical whether the address is unknown or the password is
    // wrong. Distinguishing them tells an attacker which addresses are
    // registered.
    return { error: 'signInFailed' };
  }

  const next = formData.get('next');
  const locale = formData.get('locale');
  const destination = typeof next === 'string' && next.startsWith('/') ? next : '/overview';
  const prefix = `/${typeof locale === 'string' ? locale : 'es'}`;

  // The password was right; whether that is enough is the session's to say.
  const twoFactor = await loadTwoFactorState();
  if (twoFactor.required) {
    redirect(`${prefix}/mfa?next=${encodeURIComponent(destination)}`);
  }

  redirect(`${prefix}${destination}`);
}

export async function signUp(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signUpInput.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    displayName: formData.get('displayName') ?? undefined,
    acceptTerms: formData.get('acceptTerms'),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    if (field === 'acceptTerms') return { error: 'termsRequired' };
    return { error: field === 'password' ? 'passwordTooShort' : 'invalidEmail' };
  }

  const locale = formData.get('locale');
  const signUpLocale = typeof locale === 'string' ? locale : 'es';
  const supabase = await createRequestClient();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // The acceptance travels on the auth user because there is no profile row
      // to hang it off yet — the profile is created on first sign-in, and a
      // foreign key to a row that does not exist cannot be written. It is
      // turned into a `legal_acceptances` row the moment the profile appears.
      data: {
        ...(parsed.data.displayName ? { display_name: parsed.data.displayName } : {}),
        terms_version: CURRENT_TERMS_VERSION,
        terms_locale: signUpLocale,
        terms_accepted_at: new Date().toISOString(),
        // Lo que lee la plantilla de Supabase para elegir el idioma del correo
        // de confirmación. Sin esto, todo correo de cuenta sale en español.
        locale: signUpLocale === 'en' ? 'en' : 'es',
      },
      emailRedirectTo: await requestAuthCallbackUrl(`/${signUpLocale}/overview`),
    },
  });

  if (error) {
    return { error: 'signUpFailed' };
  }

  // With email confirmation on, no session exists yet and the user must check
  // their inbox. Saying so plainly beats a silent redirect to a sign-in page
  // that will reject them.
  if (!data.session) {
    return { notice: 'checkYourEmail' };
  }

  redirect(`/${signUpLocale}/welcome`);
}

export async function signOut(formData: FormData): Promise<void> {
  const supabase = await createRequestClient();
  await supabase.auth.signOut();

  const locale = formData.get('locale');
  redirect(`/${typeof locale === 'string' ? locale : 'es'}/sign-in`);
}

const householdInput = z.object({
  name: z.string().trim().min(1).max(120),
  currency: z.enum(['USD', 'PAB']).default('USD'),
});

export async function createFirstHousehold(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await loadSession();
  if (!session) return { error: 'signInRequired' };

  const parsed = householdInput.safeParse({
    name: formData.get('name'),
    currency: formData.get('currency') ?? 'USD',
  });

  if (!parsed.success) return { error: 'householdNameRequired' };

  try {
    await createHousehold(session, parsed.data.name, parsed.data.currency);
  } catch {
    return { error: 'householdCreateFailed' };
  }

  // Back to `/welcome`, which now has a second half: the household exists and
  // the questionnaire that gives it its figures has not been answered yet.
  // Sending them to the position here would land them on an empty gauge with
  // nothing to explain it.
  const locale = formData.get('locale');
  redirect(`/${typeof locale === 'string' ? locale : 'es'}/welcome`);
}
