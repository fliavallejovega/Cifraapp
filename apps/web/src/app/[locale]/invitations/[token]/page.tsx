import { Card, EmptyState, Page, PageHeader } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AcceptInvitation } from '@/components/accept-invitation';
import { Link } from '@/i18n/navigation';
import { loadSession } from '@/server/session';

/**
 * The other end of an invitation link.
 *
 * Outside the product shell, deliberately: whoever opens this may not be in the
 * household yet, and rendering a navigation column for a household they cannot
 * see would be both wrong and confusing.
 *
 * Signed out, the screen asks them to sign in rather than accepting into
 * whatever session happens to exist. The invitation names an email address, and
 * accepting one addressed to somebody else would move an account into a
 * household nobody invited it to.
 */
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await loadSession();
  const t = await getTranslations('invitation');

  if (!session) {
    return (
      <Page>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState
            title={t('signInFirst.title')}
            body={t('signInFirst.body')}
            action={
              <Link
                href="/sign-in"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('signInFirst.action')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />
      <Card padding="lg">
        <AcceptInvitation
          locale={locale}
          token={token}
          email={session.profile.email}
          labels={{
            accept: t('accept'),
            errorTitle: t('errorTitle'),
            errors: {
              invalid: t('errors.invalid'),
              wrongAccount: t('errors.wrongAccount'),
              notFound: t('errors.notFound'),
              signInRequired: t('errors.signInRequired'),
              generic: t('errors.generic'),
            },
          }}
        />
      </Card>
    </Page>
  );
}
