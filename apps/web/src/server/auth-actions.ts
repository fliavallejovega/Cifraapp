'use server';

import { getClientEnv } from '@app/validation/env';
import { redirect } from 'next/navigation';
import { z } from 'zod';

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

const signUpInput = credentials.extend({
  displayName: z.string().trim().min(1).max(80).optional(),
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

  redirect(`/${typeof locale === 'string' ? locale : 'es'}${destination}`);
}

export async function signUp(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signUpInput.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    displayName: formData.get('displayName') ?? undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.path[0] === 'password' ? 'passwordTooShort' : 'invalidEmail' };
  }

  const env = getClientEnv();
  const supabase = await createRequestClient();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: parsed.data.displayName ? { display_name: parsed.data.displayName } : {},
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
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

  const locale = formData.get('locale');
  redirect(`/${typeof locale === 'string' ? locale : 'es'}/welcome`);
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

  const locale = formData.get('locale');
  redirect(`/${typeof locale === 'string' ? locale : 'es'}/overview`);
}
