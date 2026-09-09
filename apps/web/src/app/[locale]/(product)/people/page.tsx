import { Card, Page, PageHeader, Section, Stat } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PeopleAccess } from '@/components/people-access';
import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { loadHouseholdContext } from '@/server/household-context';
import { createPerson, removePerson, updatePerson } from '@/server/people-actions';
import { recordLabels } from '@/server/record-labels';
import {
  invitePersonToAccount,
  linkPersonToMember,
  revokePersonAccess,
  sendPasswordReset,
} from '@/server/people-access-actions';
import { loadPeople } from '@/server/repositories/administration';
import { loadPeopleAccess } from '@/server/repositories/people-access';
import { requireHousehold } from '@/server/session';

/**
 * Who the money has to cover.
 *
 * The questionnaire recorded «four people, two dependents» and that was all the
 * product ever knew. It is enough to reason about a figure and not enough to
 * show anybody: it cannot answer «who is the second earner» or «which child was
 * this expense for».
 *
 * A person here is not a membership. A membership is an account that signs in,
 * and a six-year-old the income has to cover does not have one — but the plan
 * still has to know they exist.
 */
export default async function PeoplePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const [people, access] = await Promise.all([
    loadPeople(session, session.activeHouseholdId),
    loadPeopleAccess(session, session.activeHouseholdId),
  ]);

  const t = await getTranslations('people');
  const shared = await getTranslations('records');

  const dependents = people.filter((person) => person.isDependent).length;

  const fields: readonly FieldSpec[] = [
    {
      kind: 'text',
      name: 'displayName',
      label: t('form.name'),
      hint: t('form.nameHint'),
      required: true,
    },
    {
      kind: 'select',
      name: 'relationship',
      label: t('form.relationship'),
      half: true,
      options: (['self', 'partner', 'child', 'parent', 'sibling', 'other'] as const).map(
        (value) => ({ value, label: t(`relationships.${value}`) }),
      ),
    },
    {
      kind: 'integer',
      name: 'birthYear',
      label: t('form.year'),
      hint: t('form.yearHint'),
      min: 1900,
      max: 2200,
      half: true,
      placeholder: '1990',
    },
    {
      kind: 'toggle',
      name: 'isDependent',
      label: t('form.dependent'),
      toggleLabel: t('form.dependent'),
      hint: t('form.dependentHint'),
    },
    { kind: 'note', name: 'notes', label: t('form.notes') },
  ];

  const rows: readonly RecordRow[] = people.map((person) => ({
    id: person.id,
    title: person.displayName,
    subtitle: [
      t(`relationships.${person.relationship}`),
      ...(person.birthYear === null ? [] : [String(person.birthYear)]),
      ...(person.memberEmail === null ? [] : [person.memberEmail]),
    ].join(' · '),
    badges: [
      ...(person.isDependent ? [{ label: t('badges.dependent'), tone: 'neutral' as const }] : []),
      ...(person.memberEmail ? [{ label: t('badges.signsIn'), tone: 'signal' as const }] : []),
    ],
    values: {
      displayName: person.displayName,
      relationship: person.relationship,
      birthYear: person.birthYear === null ? '' : String(person.birthYear),
      isDependent: String(person.isDependent),
      notes: person.notes ?? '',
    },
  }));

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {people.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <Stat label={t('summary.total')}>{people.length}</Stat>
          </Card>
          <Card>
            <Stat label={t('summary.dependents')} detail={t('summary.dependentsDetail')}>
              {dependents}
            </Stat>
          </Card>
        </div>
      )}

      <Section title={t('list.title')} detail={t('list.detail')} className="mt-12">
        <Card>
          <RecordsManager
            locale={locale}
            currencySymbol={context.currencySymbol}
            rows={rows}
            fields={fields}
            create={createPerson}
            update={updatePerson}
            remove={removePerson}
            labels={recordLabels(shared, {
              addAction: t('add'),
              addTitle: t('addTitle'),
              submitCreate: t('submitCreate'),
              submitUpdate: t('submitUpdate'),
              emptyTitle: t('empty.title'),
              emptyBody: t('empty.body'),
              removeConfirm: t('removeConfirm'),
            })}
          />
        </Card>
      </Section>

      <Section title={t('access.title')} detail={t('access.detail')} className="mt-14">
        <PeopleAccess
          locale={locale}
          people={access.people}
          unlinkedMembers={access.unlinkedMembers}
          twoFactorReadable={access.twoFactorReadable}
          actions={{
            invite: invitePersonToAccount,
            reset: sendPasswordReset,
            link: linkPersonToMember,
            revoke: revokePersonAccess,
          }}
          roles={(['owner', 'partner', 'member', 'viewer'] as const).map((value) => ({
            value,
            label: t(`access.roles.${value}`),
          }))}
          labels={{
            hasAccount: t('access.hasAccount'),
            pending: t('access.pending'),
            noAccount: t('access.noAccount'),
            dependentNote: t('access.dependentNote'),
            twoFactorOn: t('access.twoFactorOn'),
            twoFactorOff: t('access.twoFactorOff'),
            twoFactorUnknown: t('access.twoFactorUnknown'),
            invite: t('access.invite'),
            inviteAgain: t('access.inviteAgain'),
            email: t('access.email'),
            emailHint: t('access.emailHint'),
            role: t('access.role'),
            linkTitle: t('access.linkTitle'),
            linkHint: t('access.linkHint'),
            linkAction: t('access.linkAction'),
            unlink: t('access.unlink'),
            reset: t('access.reset'),
            resetSent: t('access.resetSent'),
            revoke: t('access.revoke'),
            revokeConfirm: t('access.revokeConfirm'),
            revokeYes: t('access.revokeYes'),
            cancel: shared('cancel'),
            copyLink: t('access.copyLink'),
            linkOnce: t('access.linkOnce'),
            limits: t('access.limits'),
            emptyTitle: t('access.emptyTitle'),
            emptyBody: t('access.emptyBody'),
            errorTitle: shared('errorTitle'),
            errors: {
              generic: shared('errors.generic'),
              notAllowed: t('access.errors.notAllowed'),
              emailInvalid: t('access.errors.emailInvalid'),
              alreadyMember: t('access.errors.alreadyMember'),
              noAccount: t('access.errors.noAccount'),
              mailFailed: t('access.errors.mailFailed'),
              cannotRevokeSelf: t('access.errors.cannotRevokeSelf'),
              notFound: shared('errors.notFound'),
              signInRequired: shared('errors.signInRequired'),
            },
          }}
        />
      </Section>

      <p className="mt-12 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('syncNote')}
      </p>
    </Page>
  );
}
