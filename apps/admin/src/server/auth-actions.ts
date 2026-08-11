'use server';

import { redirect } from 'next/navigation';

import { loadAdminSessionForProfileId } from './admin-session';
import { createRequestClient } from './supabase';

/**
 * Administrator sign-in.
 *
 * English-only copy lives on the page; errors here are keys the page maps. A
 * failed login and a valid customer session without an admin row return the same
 * key, because distinguishing them is reconnaissance.
 */

export interface ActionResult {
  readonly error?: string;
}

export async function signIn(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = formData.get('email');
  const password = formData.get('password');

  if (
    typeof email !== 'string' ||
    !email.trim().includes('@') ||
    typeof password !== 'string' ||
    password.length < 8
  ) {
    return { error: 'invalidCredentials' };
  }

  const supabase = await createRequestClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    return { error: 'signInFailed' };
  }

  // After sign-in, cookies are not always readable on a fresh client in the same
  // request. The user id from the auth response is authoritative here.
  const session = await loadAdminSessionForProfileId(data.user.id);
  if (!session) {
    await supabase.auth.signOut();
    return { error: 'signInFailed' };
  }

  redirect('/');
}

export async function signOut(): Promise<void> {
  const supabase = await createRequestClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}
