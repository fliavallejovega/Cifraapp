import { Page } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthForm } from '@/components/auth-form';
import { Link } from '@/i18n/navigation';
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

  const { next, error } = await searchParams;
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
          {t('signIn.title')}
        </h1>
        <p className="mt-2 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {t('signIn.detail')}
        </p>
      </header>

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

      <p className="mt-8 text-sm text-[color:var(--color-ink-secondary)]">
        {t('signIn.noAccount')}{' '}
        <Link href="/sign-up" className="underline underline-offset-4">
          {t('signIn.createOne')}
        </Link>
      </p>
    </Page>
  );
}
