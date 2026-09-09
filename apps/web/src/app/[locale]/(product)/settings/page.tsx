import { formatMoney } from '@app/domain';
import { Card, Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { IntegrationsPanel } from '@/components/integrations-panel';
import { SingleForm } from '@/components/records';
import { TwoFactorSettings } from '@/components/two-factor-settings';
import type { FieldSpec } from '@/components/records/spec';
import { Link } from '@/i18n/navigation';
import { formatMoment, trimRate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadTwoFactorState } from '@/server/mfa';
import { googleIsConfigured, googleMissingPieces } from '@/server/google/config';
import { loadSettings } from '@/server/repositories/administration';
import { loadIntegrations } from '@/server/repositories/integrations';
import { saveSettings } from '@/server/settings-actions';
import { requireHousehold } from '@/server/session';

/**
 * The household's own choices.
 *
 * Four settings, each of which changes a figure read every day. The buffer is
 * the one worth naming: it is the floor «available» refuses to go below, and it
 * is why the plan says $2,740 rather than the whole balance. A household that
 * cannot set it is being handed somebody else's idea of a safe cushion and told
 * it is theirs.
 *
 * Currency is shown and not editable, and the screen says why rather than
 * disabling a control and leaving the person to guess.
 */
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const [settings, twoFactor, integrations] = await Promise.all([
    loadSettings(session, session.activeHouseholdId, context.currency),
    loadTwoFactorState(),
    loadIntegrations(session, session.activeHouseholdId),
  ]);

  const t = await getTranslations('settings');
  const shared = await getTranslations('records');
  const errors: unknown = shared.raw('errors');

  const fields: readonly FieldSpec[] = [
    {
      kind: 'text',
      name: 'householdName',
      label: t('form.name'),
      hint: t('form.nameHint'),
      required: true,
    },
    {
      kind: 'money',
      name: 'bufferMinimum',
      label: t('form.buffer'),
      hint: t('form.bufferHint'),
      half: true,
    },
    {
      kind: 'rate',
      name: 'taxReserveRate',
      label: t('form.taxRate'),
      hint: t('form.taxRateHint'),
      suffix: '%',
      half: true,
    },
    {
      kind: 'select',
      name: 'debtStrategy',
      label: t('form.strategy'),
      hint: t('form.strategyHint'),
      options: (['avalanche', 'snowball', 'hybrid', 'custom'] as const).map((value) => ({
        value,
        label: t(`strategies.${value}`),
      })),
    },
  ];

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <Card>
        <SingleForm
          locale={locale}
          fields={fields}
          currencySymbol={context.currencySymbol}
          action={saveSettings}
          values={{
            householdName: settings.householdName,
            bufferMinimum: settings.bufferMinimum.toDecimalString(),
            taxReserveRate: settings.taxReserveRate ? trimRate(settings.taxReserveRate) : '',
            debtStrategy: settings.debtStrategy,
          }}
          labels={{
            submit: t('form.submit'),
            saved: t('form.saved'),
            errorTitle: shared('errorTitle'),
            errors: isStringRecord(errors) ? errors : {},
          }}
        >
          <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('strategyNote')}
          </p>
        </SingleForm>
      </Card>

      <Section title={t('profile.title')} className="mt-12">
        <Card>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[color:var(--color-ink)]">
              {settings.recordedPeople === 0
                ? t('profile.peopleNone')
                : t('profile.people', { count: settings.recordedPeople })}
            </p>
            {settings.memberCount !== null && (
              <p className="text-sm text-[color:var(--color-ink-secondary)]">
                {t('profile.stated', { count: settings.memberCount })}
              </p>
            )}
            <Link
              href="/people"
              className="self-start text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
            >
              {t('profile.manage')}
            </Link>
          </div>
        </Card>
      </Section>

      <Section title={t('security.title')} detail={t('security.detail')} className="mt-12">
        <TwoFactorSettings
          enabled={twoFactor.enabled}
          labels={{
            enabled: t('security.enabled'),
            disabled: t('security.disabled'),
            enabledDetail: t('security.enabledDetail'),
            disabledDetail: t('security.disabledDetail'),
            enable: t('security.enable'),
            scanTitle: t('security.scanTitle'),
            scanDetail: t('security.scanDetail'),
            secretLabel: t('security.secretLabel'),
            code: t('security.code'),
            confirm: t('security.confirm'),
            confirmed: t('security.confirmed'),
            cancel: t('security.cancel'),
            disable: t('security.disable'),
            disableTitle: t('security.disableTitle'),
            disableDetail: t('security.disableDetail'),
            disabledDone: t('security.disabledDone'),
            errorTitle: t('security.errorTitle'),
            errors: {
              invalidCode: t('security.errors.invalidCode'),
              codeRejected: t('security.errors.codeRejected'),
              signInRequired: t('security.errors.signInRequired'),
              alreadyEnabled: t('security.errors.alreadyEnabled'),
              generic: t('security.errors.generic'),
            },
          }}
        />
      </Section>

      <Section
        title={t('integrations.title')}
        detail={t('integrations.detail')}
        className="mt-12"
      >
        <IntegrationsPanel
          locale={locale}
          configured={googleIsConfigured()}
          feeds={integrations.feeds.map((feed) => ({
            id: feed.id,
            label: feed.label,
            hint: feed.hint,
            lastRead: feed.lastReadAt
              ? formatMoment(feed.lastReadAt, locale, context.timeZone)
              : null,
            readCount: feed.readCount,
          }))}
          connections={integrations.google.map((connection) => ({
            id: connection.id,
            googleEmail: connection.googleEmail,
            capabilities: connection.capabilities,
            status: connection.status,
            isMine: connection.isMine,
          }))}
          labels={{
            feedTitle: t('integrations.feed.title'),
            feedDetail: t('integrations.feed.detail'),
            feedEmptyTitle: t('integrations.feed.emptyTitle'),
            feedEmptyBody: t('integrations.feed.emptyBody'),
            feedCreate: t('integrations.feed.create'),
            feedLabelField: t('integrations.feed.label'),
            feedLabelPlaceholder: t('integrations.feed.labelPlaceholder'),
            feedRevoke: t('integrations.feed.revoke'),
            feedNever: t('integrations.feed.never'),
            feedRead: rawOf(t)('integrations.feed.read'),
            feedSecretTitle: t('integrations.feed.secretTitle'),
            feedSecretBody: t('integrations.feed.secretBody'),
            feedHowTo: t('integrations.feed.howTo'),
            googleTitle: t('integrations.google.title'),
            googleDetail: t('integrations.google.detail'),
            googleOff: t('integrations.google.off', {
              missing: googleMissingPieces().join(', ') || '—',
            }),
            googleConnectCalendar: t('integrations.google.connectCalendar'),
            googleConnectMail: t('integrations.google.connectMail'),
            googleConnectBoth: t('integrations.google.connectBoth'),
            googleDisconnect: t('integrations.google.disconnect'),
            googleMailScope: t('integrations.google.mailScope'),
            googleCalendarScope: t('integrations.google.calendarScope'),
            googleBroken: t('integrations.google.broken'),
            googleNotMine: t('integrations.google.notMine'),
            errorTitle: shared('errorTitle'),
            errors: {
              generic: shared('errors.generic'),
              notFound: shared('errors.notFound'),
              signInRequired: shared('errors.signInRequired'),
              tooManyFeeds: t('integrations.feed.errors.tooMany'),
              horizonInvalid: t('integrations.feed.errors.horizon'),
            },
          }}
        />
      </Section>

      <Section title={t('currency.title')} detail={t('currency.detail')} className="mt-12">
        <Card>
          <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('currency.current')}</p>
          <p className="readout mt-1 text-lg text-[color:var(--color-ink)]">
            {settings.baseCurrency} ·{' '}
            {formatMoney(settings.bufferMinimum, { locale: context.moneyLocale })}
          </p>
        </Card>
      </Section>

      <Section title={t('danger.title')} detail={t('danger.detail')} className="mt-12">
        <Card>
          <Link
            href="/welcome"
            className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
          >
            {t('danger.action')}
          </Link>
        </Card>
      </Section>
    </Page>
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

/** Una plantilla cuyos marcadores se rellenan donde están los valores. */
function rawOf(t: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = t.raw(key);
    return typeof value === 'string' ? value : '';
  };
}
