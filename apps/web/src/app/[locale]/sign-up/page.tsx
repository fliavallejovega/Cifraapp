import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthScreen } from '@/components/auth-screen';

import { AuthForm } from '@/components/auth-form';
import { Link } from '@/i18n/navigation';
import { signUp } from '@/server/auth-actions';

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const t = await getTranslations('auth');

  return (
    <AuthScreen title={t('signUp.title')} detail={t('signUp.detail')}>
      <AuthForm
        action={signUp}
        locale={locale}
        withDisplayName
        labels={{
          email: t('fields.email'),
          password: t('fields.password'),
          passwordHint: t('fields.passwordHint'),
          displayName: t('fields.displayName'),
          submit: t('signUp.submit'),
          errorTitle: t('errors.title'),
          errors: {
            signUpFailed: t('errors.signUpFailed'),
            passwordTooShort: t('errors.passwordTooShort'),
            invalidEmail: t('errors.invalidEmail'),
            generic: t('errors.generic'),
          },
          notices: { checkYourEmail: t('signUp.checkYourEmail') },
        }}
      />

      <p className="mt-8 text-sm text-[color:var(--color-ink-secondary)]">
        {t('signUp.haveAccount')}{' '}
        <Link href="/sign-in" className="underline underline-offset-4">
          {t('signUp.signInInstead')}
        </Link>
      </p>
    </AuthScreen>
  );
}
