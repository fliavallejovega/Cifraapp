import { Card, EmptyState, Page, PageHeader, Section, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NotificationPreferences } from '@/components/notification-preferences';
import { formatMoment } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadDeliveries, loadPreferences } from '@/server/repositories/notifications';
import { requireHousehold } from '@/server/session';

/**
 * What the product will tell you, and what it already told you.
 *
 * The preferences belong to the person, not to the household: what one partner
 * wants pushed at them the moment the card comes due is not what the other
 * wants, and a shared setting would make one of them wrong every time.
 *
 * The log underneath is not decoration. «I never got that» is a real
 * conversation, and a suppressed notice with its reason — throttled, disabled,
 * no channel — is the only way to tell «nothing happened» from «we decided not
 * to tell you».
 */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const householdId = session.activeHouseholdId;
  const context = await loadHouseholdContext(session, householdId, locale);

  const [preferences, deliveries] = await Promise.all([
    loadPreferences(session, householdId),
    loadDeliveries(session, householdId),
  ]);

  const t = await getTranslations('notifications');
  const shared = await getTranslations('records');

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <Card>
        <NotificationPreferences
          locale={locale}
          preferences={preferences.map((preference) => ({
            kind: preference.kind,
            title: t(`kinds.${preference.kind}`),
            detail: t(`kinds.${preference.kind}Detail`),
            channel: preference.channel,
            throttleHours: preference.throttleHours,
            isDefault: preference.isDefault,
          }))}
          channels={(['email', 'push', 'none'] as const).map((value) => ({
            value,
            label: t(`channels.${value}`),
          }))}
          frequencies={(['0', '24', '168'] as const).map((value) => ({
            value,
            label: t(`frequencies.${value}`),
          }))}
          labels={{
            channel: t('form.channel'),
            frequency: t('form.frequency'),
            submit: t('form.submit'),
            saved: t('form.saved'),
            isDefault: t('default'),
            errorTitle: shared('errorTitle'),
            generic: shared('errors.generic'),
          }}
        />
      </Card>

      <p className="mt-6 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('pending')}
      </p>

      <Section title={t('log.title')} detail={t('log.detail')} className="mt-12">
        <Card>
          {deliveries.length === 0 ? (
            <EmptyState title={t('log.empty')} />
          ) : (
            <ul className="flex flex-col">
              {deliveries.map((delivery) => (
                <li
                  key={delivery.id}
                  className="border-b border-[color:var(--color-rule)] py-4 last:border-b-0"
                >
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-[color:var(--color-ink)]">
                      {delivery.title}
                    </span>
                    <Status tone={delivery.status === 'sent' ? 'positive' : 'neutral'}>
                      {t(`log.statuses.${delivery.status}`)}
                    </Status>
                  </p>
                  <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
                    {delivery.body}
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--color-ink-tertiary)]">
                    <span className="readout">
                      {formatMoment(delivery.createdAt, locale, context.timeZone)}
                    </span>
                    {delivery.reason && ` · ${delivery.reason}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </Page>
  );
}
