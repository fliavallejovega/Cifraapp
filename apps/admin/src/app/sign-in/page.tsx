import { Page, PageHeader } from '@app/ui';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth-form';
import { loadAdminSession } from '@/server/admin-session';
import { signIn } from '@/server/auth-actions';

/**
 * Administrator sign-in.
 *
 * Not linked from the 404 page — employees bookmark this URL. Unauthorized
 * callers who guess product routes get the same not-found surface as a missing
 * page; this route is the deliberate entry for people who already know where to
 * go.
 */
export default async function SignInPage() {
  // The door from the product lands here. Somebody already signed in as an
  // administrator has nothing to type, so they go straight through.
  if (await loadAdminSession()) redirect('/');

  return (
    <Page>
      <PageHeader
        title="Sign in"
        detail="Administrative access is granted row by row. A customer account without a role in platform.admin_users cannot proceed."
      />

      <AuthForm action={signIn} />
    </Page>
  );
}
