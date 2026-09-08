import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { AuthScreen } from '@/components/auth-screen';

import { AuthForm } from '@/components/auth-form';
import { Link } from '@/i18n/navigation';
import { loadSession } from '@/server/session';
import { signIn } from '@/server/auth-actions';

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  // A signed-in visitor has no reason to be here. This used to live in the
  // proxy, where it ran on every navigation in the product; it belongs on the
  // two screens it is actually about. Verified, not read from the cookie —
  // redirecting on an unverified cookie would bounce a forged session between
  // here and the product forever.
  const session = await loadSession();
  if (session) redirect(`/${locale}/overview`);

  const { next, error } = await searchParams;
  const t = await getTranslations('auth');

  return (
    <AuthScreen title={t('signIn.title')} detail={t('signIn.detail')}>
      {error && (
        <p role="alert" className="mb-6 text-sm text-[color:var(--color-negative)]">
          {t(`errors.${error === 'link_expired' ? 'linkExpired' : 'generic'}`)}
        </p>
      )}

      <AuthForm
        action={signIn}
        locale={locale}
        {...(next ? { next } : {})}
        labels={{
          email: t('fields.email'),
          password: t('fields.password'),
          passwordHint: t('fields.passwordHint'),
          submit: t('signIn.submit'),
          errorTitle: t('errors.title'),
          errors: {
            signInFailed: t('errors.signInFailed'),
            invalidCredentialsFormat: t('errors.invalidCredentialsFormat'),
            generic: t('errors.generic'),
          },
          notices: {},
        }}
      />

      <p className="mt-6 text-sm">
        <Link href="/forgot-password" className="underline underline-offset-4">
          {t('signIn.forgotPassword')}
        </Link>
      </p>

      <p className="mt-8 text-sm text-[color:var(--color-ink-secondary)]">
        {t('signIn.noAccount')}{' '}
        <Link href="/sign-up" className="underline underline-offset-4">
          {t('signIn.createOne')}
        </Link>
      </p>
    </AuthScreen>
  );
}
