import { Page, PageHeader, Section, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { HouseholdSwitcher } from '@/components/household-switcher';
import { requireSession } from '@/server/session';

/**
 * Belonging to more than one household.
 *
 * A person who keeps their own finances and also helps their parents with
 * theirs is not an edge case; it is the second most common shape after «one
 * household, two people». Every figure in the product is scoped to one of them,
 * and this is where the choice is made.
 *
 * The choice lives in a cookie, so it survives a navigation without every route
 * having to carry it, and it is matched against the memberships on every read —
 * a stale value shows a household the person is actually in, never one they are
 * not.
 */
export default async function HouseholdsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireSession(locale);

  const t = await getTranslations('households');
  const accessT = await getTranslations('access');

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <Section>
        <HouseholdSwitcher
          locale={locale}
          households={session.households.map((household) => ({
            id: household.id,
            name: household.name,
            roleLabel: t('role', { role: accessT(`roles.${household.role}`) }),
            isCurrent: household.id === session.activeHouseholdId,
          }))}
          labels={{
            current: t('current'),
            switch: t('switch'),
            createTitle: t('create.title'),
            createDetail: t('create.detail'),
            name: t('create.name'),
            createSubmit: t('create.submit'),
            errorTitle: t('errorTitle'),
            errors: {
              notFound: t('errors.notFound'),
              nameRequired: t('errors.nameRequired'),
              signInRequired: t('errors.signInRequired'),
              generic: t('errors.generic'),
            },
          }}
        />
      </Section>

      {session.households.length === 1 && (
        <p className="mt-8">
          <Status tone="neutral">{t('current')}</Status>
        </p>
      )}
    </Page>
  );
}
