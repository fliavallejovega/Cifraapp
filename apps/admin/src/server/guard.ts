import 'server-only';

import { notFound } from 'next/navigation';

import { loadAdminSession, satisfies, type AdminRole, type AdminSession } from './admin-session';

/**
 * The gate every page in this application passes through.
 *
 * A caller who is not an administrator gets a 404, not a 403. There is nothing
 * at this address as far as they are concerned, and confirming that an admin
 * console exists at a URL somebody guessed is free reconnaissance.
 *
 * The same applies to a role that does not satisfy a page's requirement: a
 * support administrator asking for the revenue page is told the page does not
 * exist rather than that they are not allowed. They already know what they are;
 * the useful property is that the response says nothing.
 */
export async function requireAdmin(required?: AdminRole): Promise<AdminSession> {
  const session = await loadAdminSession();

  if (!session) notFound();
  if (required && !satisfies(session.role, required)) notFound();

  return session;
}
