import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { AuthScreen } from '@/components/auth-screen';
import { TwoFactorForm } from '@/components/two-factor-form';
import { loadTwoFactorState } from '@/server/mfa';
import { loadSession } from '@/server/session';

/**
 * The second step.
 *
 * Reached only by a session that signed in with a password and owes a code.
 * Anyone else is sent where they belong — no session to sign-in, a session
 * that already passed to the product — so the screen can never be used to
 * probe whether an account has the second step switched on.
 */
export default async function TwoFactorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await loadSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const { next } = await searchParams;
  const state = await loadTwoFactorState();
  if (!state.required) redirect(`/${locale}${next?.startsWith('/') ? next : '/overview'}`);

  const t = await getTranslations('auth');

  return (
    <AuthScreen title={t('mfa.title')} detail={t('mfa.detail')}>
      <TwoFactorForm
        locale={locale}
        {...(next ? { next } : {})}
        labels={{
          code: t('mfa.code'),
          submit: t('mfa.submit'),
          errorTitle: t('errors.title'),
          errors: {
            invalidCode: t('mfa.errors.invalidCode'),
            codeRejected: t('mfa.errors.codeRejected'),
            signInRequired: t('mfa.errors.signInRequired'),
            generic: t('errors.generic'),
          },
        }}
      />
    </AuthScreen>
  );
}
