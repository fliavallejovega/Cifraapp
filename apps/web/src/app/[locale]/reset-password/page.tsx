import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthScreen } from '@/components/auth-screen';

import { ResetPasswordForm } from '@/components/reset-password-form';

/**
 * Where a recovery link lands.
 *
 * The page itself reads no session. It cannot: half the recovery links in
 * circulation carry their tokens in the URL fragment, which never reaches a
 * server. The client component below is the only thing that can see them.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const t = await getTranslations('auth');

  return (
    <AuthScreen title={t('reset.title')} detail={t('reset.detail')}>
      <ResetPasswordForm
        locale={locale}
        labels={{
          password: t('fields.password'),
          passwordHint: t('fields.passwordHint'),
          showPassword: t('fields.showPassword'),
          hidePassword: t('fields.hidePassword'),
          submit: t('reset.submit'),
          checking: t('reset.checking'),
          expiredTitle: t('reset.expiredTitle'),
          expiredBody: t('reset.expiredBody'),
          requestAgain: t('reset.requestAgain'),
          errorTitle: t('errors.title'),
          errorBody: t('errors.generic'),
          tooShort: t('errors.passwordTooShort'),
        }}
      />
    </AuthScreen>
  );
}
