import { Card, EmptyState, Page, PageHeader, Problem, Section, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { GrantForm } from '@/components/grant-form';
import { RevokeGrantButton } from '@/components/revoke-grant-button';
import { Link } from '@/i18n/navigation';
import { formatMoment } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { isOwner, loadGrants } from '@/server/repositories/access';
import { requireHousehold } from '@/server/session';

/**
 * The accountant's key.
 *
 * The portal on the other side of this has existed since Phase 16 and respected
 * every permission; there was simply no way for a household to hand one out.
 * That gap is also the product's distribution problem — an accountant with
 * thirty independent clients is a channel, and none of it works until this
 * screen exists.
 *
 * Scope, expiry and revocation are all on one screen because they are one
 * decision. «Read only, ninety days» is a sentence somebody can hold; three
 * separate settings is a policy they will get wrong.
 */
export default async function AccountantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const householdId = session.activeHouseholdId;
  const context = await loadHouseholdContext(session, householdId, locale);
  const now = new Date();

  const [grants, owner] = await Promise.all([
    loadGrants(session, householdId, now),
    isOwner(session, householdId),
  ]);

  const t = await getTranslations('accountants');
  const accessT = await getTranslations('access');

  const errors = {
    notAllowed: accessT('errors.notAllowed'),
    emailInvalid: accessT('errors.emailInvalid'),
    accountantNotFound: t('grant.detail'),
    cannotGrantSelf: accessT('errors.cannotRemoveSelf'),
    notFound: accessT('errors.notFound'),
    signInRequired: accessT('errors.signInRequired'),
    generic: accessT('errors.generic'),
  };

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/access"
          className="text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)]"
        >
          {t('back')}
        </Link>
      </div>

      <PageHeader title={t('title')} detail={t('detail')} />

      {!owner && (
        <div className="mb-8">
          <Problem title={accessT('notAllowed.title')} body={accessT('notAllowed.body')} />
        </div>
      )}

      {owner && (
        <Section title={t('grant.title')} detail={t('grant.detail')}>
          <Card>
            <GrantForm
              locale={locale}
              scopes={(['read', 'comment', 'classify'] as const).map((value) => ({
                value,
                label: t(`scopes.${value}`),
              }))}
              labels={{
                email: t('grant.email'),
                scope: t('grant.scope'),
                expires: t('grant.expires'),
                expiresHint: t('grant.expiresHint'),
                submit: t('grant.submit'),
                errorTitle: accessT('errorTitle'),
                errors,
              }}
            />
          </Card>
        </Section>
      )}

      <Section title={t('list.title')} className="mt-12">
        <Card>
          {grants.length === 0 ? (
            <EmptyState title={t('list.empty')} />
          ) : (
            <ul className="flex flex-col">
              {grants.map((grant) => (
                <li
                  key={grant.id}
                  className="border-b border-[color:var(--color-rule)] last:border-b-0"
                >
                  <GrantRow
                    locale={locale}
                    canManage={owner}
                    grant={{
                      id: grant.id,
                      name: grant.displayName ?? grant.email,
                      email: grant.email,
                      scopeLabel: t(`scopes.${grant.scope}`),
                      granted: t('list.granted', {
                        date: formatMoment(grant.grantedAt, locale, context.timeZone),
                      }),
                      expiry: grant.expiresAt
                        ? t('list.expiresOn', {
                            date: formatMoment(grant.expiresAt, locale, context.timeZone),
                          })
                        : t('list.noExpiry'),
                      isActive: grant.isActive,
                      revoked: grant.revokedAt
                        ? t('list.revoked', {
                            date: formatMoment(grant.revokedAt, locale, context.timeZone),
                          })
                        : null,
                    }}
                    labels={{
                      active: t('list.active'),
                      revoke: t('list.revoke'),
                      revokeConfirm: t('list.revokeConfirm'),
                      cancel: accessT('invite.cancel'),
                      errorTitle: accessT('errorTitle'),
                      errors,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </Page>
  );
}

/** One grant, rendered on the server; only its revoke control is interactive. */
function GrantRow({
  locale,
  grant,
  canManage,
  labels,
}: {
  readonly locale: string;
  readonly canManage: boolean;
  readonly grant: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly scopeLabel: string;
    readonly granted: string;
    readonly expiry: string;
    readonly isActive: boolean;
    readonly revoked: string | null;
  };
  readonly labels: {
    readonly active: string;
    readonly revoke: string;
    readonly revokeConfirm: string;
    readonly cancel: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}) {
  return (
    <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium break-words text-[color:var(--color-ink)]">
            {grant.name}
          </span>
          {grant.isActive && <Status tone="positive">{labels.active}</Status>}
        </p>
        <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
          {grant.email} · {grant.scopeLabel} · {grant.granted} · {grant.expiry}
        </p>
        {grant.revoked && (
          <p className="mt-1 text-sm text-[color:var(--color-ink-tertiary)]">{grant.revoked}</p>
        )}
      </div>

      {canManage && grant.isActive && (
        <RevokeGrantButton locale={locale} grantId={grant.id} labels={labels} />
      )}
    </div>
  );
}
