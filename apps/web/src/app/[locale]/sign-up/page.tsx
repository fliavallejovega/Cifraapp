import { Page } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthForm } from '@/components/auth-form';
import { Link } from '@/i18n/navigation';
import { signUp } from '@/server/auth-actions';

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const t = await getTranslations('auth');
  const common = await getTranslations('common');

  return (
    <Page className="max-w-sm">
      <header className="mb-10">
        <span className="gradation-label uppercase">{common('appName')}</span>
        <h1
          className="mt-6 text-2xl font-medium"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          {t('signUp.title')}
        </h1>
        <p className="mt-2 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {t('signUp.detail')}
        </p>
      </header>

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
    </Page>
  );
}
