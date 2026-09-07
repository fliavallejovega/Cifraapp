import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthScreen } from '@/components/auth-screen';

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
  const origin = await requestAppOrigin();
  const redirectTo = `${origin}/${locale}/reset-password`;

  return (
    <AuthScreen title={t('forgot.title')} detail={t('forgot.detail')}>
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
    </AuthScreen>
  );
}
