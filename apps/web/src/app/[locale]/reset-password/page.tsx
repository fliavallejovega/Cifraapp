import { Page } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

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
  const common = await getTranslations('common');

  return (
    <Page className="max-w-sm">
      <header className="mb-10">
        <span className="gradation-label uppercase">{common('appName')}</span>
        <h1
          className="mt-6 text-2xl font-medium"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          {t('reset.title')}
        </h1>
        <p className="mt-2 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {t('reset.detail')}
        </p>
      </header>

      <ResetPasswordForm
        locale={locale}
        labels={{
          password: t('fields.password'),
          passwordHint: t('fields.passwordHint'),
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
    </Page>
  );
}
