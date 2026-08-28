import { Page } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ForgotPasswordForm } from '@/components/forgot-password-form';
import { Link } from '@/i18n/navigation';
import { requestAppOrigin } from '@/server/app-origin';

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const t = await getTranslations('auth');
  const common = await getTranslations('common');
  const origin = await requestAppOrigin();
  const redirectTo = `${origin}/${locale}/reset-password`;

  return (
    <Page className="max-w-sm">
      <header className="mb-10">
        <span className="gradation-label uppercase">{common('appName')}</span>
        <h1
          className="mt-6 text-2xl font-medium"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          {t('forgot.title')}
        </h1>
        <p className="mt-2 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {t('forgot.detail')}
        </p>
      </header>

      <ForgotPasswordForm
        redirectTo={redirectTo}
        labels={{
          email: t('fields.email'),
          submit: t('forgot.submit'),
          sent: t('forgot.sent'),
          rateLimited: t('forgot.rateLimited'),
          errorTitle: t('errors.title'),
          errorBody: t('errors.generic'),
        }}
      />

      <p className="mt-8 text-sm text-[color:var(--color-ink-secondary)]">
        <Link href="/sign-in" className="underline underline-offset-4">
          {t('forgot.backToSignIn')}
        </Link>
      </p>
    </Page>
  );
}
