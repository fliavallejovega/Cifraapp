import { Card, Page, PageHeader, Problem, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { InviteForm } from '@/components/invite-form';
import { MemberList } from '@/components/member-list';
import { Link } from '@/i18n/navigation';
import { formatMoment } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { isOwner, loadInvitations, loadMembers } from '@/server/repositories/access';
import { requireHousehold } from '@/server/session';

/**
 * Bringing the partner in.
 *
 * A household with one member is a spreadsheet with better fonts. The whole
 * argument of the product — one figure both people trust, one plan they agreed
 * on — needs a second person in it, and until now the invitation flow existed
 * in the database and nowhere else.
 *
 * Members and accountants are separate screens because they are separate
 * things: a partner shares the money, an accountant looks at it with a scoped,
 * revocable, expiring permission. Putting them in one list would be the
 * product's first quiet lie about who can see what.
 */
export default async function AccessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const householdId = session.activeHouseholdId;
  const context = loadHouseholdContext(session, householdId, locale);
  const now = new Date();

  const [members, invitations, owner] = await Promise.all([
    loadMembers(session, householdId),
    loadInvitations(session, householdId, now),
    isOwner(session, householdId),
  ]);

  const t = await getTranslations('access');

  const errors = {
    notAllowed: t('errors.notAllowed'),
    emailInvalid: t('errors.emailInvalid'),
    alreadyMember: t('errors.alreadyMember'),
    cannotChangeOwner: t('errors.cannotChangeOwner'),
    cannotRemoveOwner: t('errors.cannotRemoveOwner'),
    cannotRemoveSelf: t('errors.cannotRemoveSelf'),
    notFound: t('errors.notFound'),
    signInRequired: t('errors.signInRequired'),
    generic: t('errors.generic'),
  };

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {!owner && (
        <div className="mb-8">
          <Problem title={t('notAllowed.title')} body={t('notAllowed.body')} />
        </div>
      )}

      <Section title={t('members.title')} detail={t('members.detail')}>
        <Card>
          <MemberList
            locale={locale}
            canManage={owner}
            members={members.map((member) => ({
              id: member.id,
              name: member.displayName ?? member.email,
              email: member.email,
              role: member.role,
              roleLabel: t(`roles.${member.role}`),
              status: member.status,
              joined: formatMoment(member.joinedAt, locale, context.timeZone),
              isSelf: member.isSelf,
            }))}
            roles={(['partner', 'member', 'viewer'] as const).map((value) => ({
              value,
              label: t(`roles.${value}`),
            }))}
            labels={{
              you: t('members.you'),
              role: t('members.role'),
              joined: t('members.joined', { date: '' }).trim(),
              changeRole: t('members.changeRole'),
              revoke: t('members.revoke'),
              revokeConfirm: t('members.revokeConfirm'),
              cancel: t('invite.cancel'),
              empty: t('members.empty'),
              errorTitle: t('errorTitle'),
              errors,
            }}
          />
        </Card>
      </Section>

      {owner && (
        <Section title={t('invite.title')} detail={t('invite.detail')} className="mt-12">
          <Card>
            <InviteForm
              locale={locale}
              roles={(['partner', 'member', 'viewer'] as const).map((value) => ({
                value,
                label: t(`roles.${value}`),
              }))}
              invitations={invitations.map((invitation) => ({
                id: invitation.id,
                email: invitation.email,
                roleLabel: t(`roles.${invitation.role}`),
                state: invitation.acceptedAt
                  ? t('invite.accepted')
                  : invitation.isExpired
                    ? t('invite.expired')
                    : t('invite.expires', {
                        date: formatMoment(invitation.expiresAt, locale, context.timeZone),
                      }),
                isOpen: invitation.acceptedAt === null && !invitation.isExpired,
              }))}
              labels={{
                email: t('invite.email'),
                role: t('invite.role'),
                submit: t('invite.submit'),
                linkTitle: t('invite.linkTitle'),
                linkNote: t('invite.linkNote'),
                pending: t('invite.pending'),
                none: t('invite.none'),
                cancel: t('invite.cancel'),
                cancelConfirm: t('invite.cancelConfirm'),
                dismiss: t('members.revoke'),
                errorTitle: t('errorTitle'),
                errors,
              }}
            />
          </Card>
        </Section>
      )}

      <Section title={t('accountants.title')} detail={t('accountants.detail')} className="mt-12">
        <Card>
          <Link
            href="/access/accountants"
            className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
          >
            {t('accountants.open')}
          </Link>
        </Card>
      </Section>
    </Page>
  );
}
