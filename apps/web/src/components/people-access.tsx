'use client';

import { Button, Card, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState, useState } from 'react';

import type { PersonAccess, UnlinkedMember } from '@/server/repositories/people-access';
import type { PersonAccessResult } from '@/server/people-access-actions';

type Action = (previous: PersonAccessResult, formData: FormData) => Promise<PersonAccessResult>;

/**
 * Who can get in, read off the same list of people the household already keeps.
 *
 * Access lived on its own screen, keyed by email, and the people screen listed
 * names. Nothing joined «Blei» to «blei@…», so the household could not answer
 * whether Blei had a way in without holding both screens in their head and
 * matching by memory.
 *
 * What is *not* offered here matters as much as what is. There is no button to
 * set somebody's password, because a shared-finances product is precisely where
 * handing one member a working key to another's account is most tempting and
 * most wrong — the recovery mail goes to their own inbox. There is no button to
 * turn the second step on for somebody else, because whoever can turn it on can
 * turn it off. And there are no recovery codes to reissue: the auth server this
 * runs on has none, and a button that pretended otherwise would strand somebody
 * at the worst possible moment.
 */
export interface PeopleAccessProps {
  readonly locale: string;
  readonly people: readonly PersonAccess[];
  readonly unlinkedMembers: readonly UnlinkedMember[];
  readonly twoFactorReadable: boolean;
  readonly actions: {
    readonly invite: Action;
    readonly reset: Action;
    readonly link: Action;
    readonly revoke: Action;
  };
  readonly roles: readonly { readonly value: string; readonly label: string }[];
  readonly labels: {
    readonly hasAccount: string;
    readonly pending: string;
    readonly noAccount: string;
    readonly dependentNote: string;
    readonly twoFactorOn: string;
    readonly twoFactorOff: string;
    readonly twoFactorUnknown: string;
    readonly invite: string;
    readonly inviteAgain: string;
    readonly email: string;
    readonly emailHint: string;
    readonly role: string;
    readonly linkTitle: string;
    readonly linkHint: string;
    readonly linkAction: string;
    readonly unlink: string;
    readonly reset: string;
    readonly resetSent: string;
    readonly revoke: string;
    readonly revokeConfirm: string;
    readonly revokeYes: string;
    readonly cancel: string;
    readonly copyLink: string;
    readonly linkOnce: string;
    readonly limits: string;
    readonly emptyTitle: string;
    readonly emptyBody: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}

export function PeopleAccess({
  locale,
  people,
  unlinkedMembers,
  twoFactorReadable,
  actions,
  roles,
  labels,
}: PeopleAccessProps) {
  if (people.length === 0) {
    return (
      <Card>
        <p className="text-base font-medium text-[color:var(--color-ink)]">{labels.emptyTitle}</p>
        <p className="mt-2 max-w-[60ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {labels.emptyBody}
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {people.map((person) => (
        <PersonRow
          key={person.personId}
          locale={locale}
          person={person}
          unlinkedMembers={unlinkedMembers}
          twoFactorReadable={twoFactorReadable}
          actions={actions}
          roles={roles}
          labels={labels}
        />
      ))}

      <p className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {labels.limits}
      </p>
    </div>
  );
}

function PersonRow({
  locale,
  person,
  unlinkedMembers,
  twoFactorReadable,
  actions,
  roles,
  labels,
}: {
  readonly locale: string;
  readonly person: PersonAccess;
  readonly unlinkedMembers: readonly UnlinkedMember[];
  readonly twoFactorReadable: boolean;
  readonly actions: PeopleAccessProps['actions'];
  readonly roles: PeopleAccessProps['roles'];
  readonly labels: PeopleAccessProps['labels'];
}) {
  const [inviting, setInviting] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const [inviteState, inviteAction, invitePending] = useActionState<PersonAccessResult, FormData>(
    actions.invite,
    {},
  );
  const [resetState, resetAction, resetPending] = useActionState<PersonAccessResult, FormData>(
    actions.reset,
    {},
  );
  const [linkState, linkAction, linkPending] = useActionState<PersonAccessResult, FormData>(
    actions.link,
    {},
  );
  const [revokeState, revokeAction, revokePending] = useActionState<PersonAccessResult, FormData>(
    actions.revoke,
    {},
  );

  const error =
    inviteState.error ?? resetState.error ?? linkState.error ?? revokeState.error ?? null;

  const status = person.memberId
    ? { label: labels.hasAccount, tone: 'positive' as const }
    : person.pendingInvitation
      ? { label: labels.pending, tone: 'caution' as const }
      : { label: labels.noAccount, tone: 'neutral' as const };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium break-words text-[color:var(--color-ink)]">
                {person.displayName}
              </span>
              <Status tone={status.tone}>{status.label}</Status>
              {person.memberId && (
                <Status tone={twoFactorLabel(person, twoFactorReadable).tone}>
                  {
                    {
                      on: labels.twoFactorOn,
                      off: labels.twoFactorOff,
                      unknown: labels.twoFactorUnknown,
                    }[twoFactorLabel(person, twoFactorReadable).state]
                  }
                </Status>
              )}
            </p>
            {person.email && (
              <p className="mt-1 text-sm break-all text-[color:var(--color-ink-secondary)]">
                {person.email}
              </p>
            )}
            {!person.memberId && person.isDependent && (
              <p className="mt-1 max-w-[52ch] text-sm text-pretty text-[color:var(--color-ink-tertiary)]">
                {labels.dependentNote}
              </p>
            )}
          </div>
        </div>

        {error && (
          <div className="max-w-sm">
            <Problem
              title={labels.errorTitle}
              body={labels.errors[error] ?? labels.errors['generic'] ?? ''}
            />
          </div>
        )}

        {/* Returned once, never stored readable. Most deployments have no mail
            of their own, and «invitación enviada» when nothing left the
            building costs the household a week of waiting. */}
        {inviteState.link && (
          <div className="flex flex-col gap-2 border-l border-[color:var(--color-positive)] bg-[color:var(--color-positive-sunk)] px-4 py-3">
            <p className="text-sm font-medium">{labels.linkOnce}</p>
            <code className="text-xs break-all text-[color:var(--color-ink-secondary)]">
              {inviteState.link}
            </code>
          </div>
        )}

        {resetState.ok && (
          <p role="status" className="text-sm text-[color:var(--color-positive)]">
            {labels.resetSent}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {person.memberId ? (
            <>
              <form action={resetAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="personId" value={person.personId} />
                <input type="hidden" name="email" value={person.email ?? ''} />
                <Button type="submit" size="sm" variant="secondary" loading={resetPending}>
                  {labels.reset}
                </Button>
              </form>

              {confirmingRevoke ? (
                <form action={revokeAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="personId" value={person.personId} />
                  <span className="text-xs text-[color:var(--color-ink-secondary)]">
                    {labels.revokeConfirm}
                  </span>
                  <Button type="submit" size="sm" variant="secondary" loading={revokePending}>
                    {labels.revokeYes}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setConfirmingRevoke(false);
                    }}
                  >
                    {labels.cancel}
                  </Button>
                </form>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setConfirmingRevoke(true);
                  }}
                >
                  {labels.revoke}
                </Button>
              )}

              <form action={linkAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="personId" value={person.personId} />
                <input type="hidden" name="memberId" value="" />
                <Button type="submit" size="sm" variant="ghost" loading={linkPending}>
                  {labels.unlink}
                </Button>
              </form>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setInviting((open) => !open);
              }}
            >
              {person.pendingInvitation ? labels.inviteAgain : labels.invite}
            </Button>
          )}
        </div>

        {!person.memberId && inviting && (
          <form action={inviteAction} className="flex max-w-md flex-col gap-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="personId" value={person.personId} />
            <Field label={labels.email} hint={labels.emailHint} required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  name="email"
                  type="email"
                  required
                  defaultValue={person.pendingInvitation?.email ?? ''}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <Field label={labels.role}>
              {({ id, describedBy }) => (
                <Select id={id} name="role" defaultValue="member" aria-describedby={describedBy}>
                  {roles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button type="submit" size="sm" loading={invitePending} className="self-start">
              {person.pendingInvitation ? labels.inviteAgain : labels.invite}
            </Button>
          </form>
        )}

        {/* An account that signs in and that nobody has claimed. Every household
            that had members before this screen existed has these. */}
        {!person.memberId && unlinkedMembers.length > 0 && (
          <form action={linkAction} className="flex max-w-md flex-col gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="personId" value={person.personId} />
            <Field label={labels.linkTitle} hint={labels.linkHint}>
              {({ id, describedBy }) => (
                <Select id={id} name="memberId" aria-describedby={describedBy}>
                  {unlinkedMembers.map((member) => (
                    <option key={member.memberId} value={member.memberId}>
                      {member.email}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={linkPending}
              className="self-start"
            >
              {labels.linkAction}
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}

/**
 * The second step, as a state rather than a boolean.
 *
 * «No pudimos consultarlo» must never render as «no tiene»: telling a household
 * that nobody is protected when the truth is that the question failed is the
 * worst direction to be wrong in.
 */
function twoFactorLabel(
  person: PersonAccess,
  readable: boolean,
): { state: 'on' | 'off' | 'unknown'; tone: 'positive' | 'caution' | 'neutral' } {
  if (!readable || person.twoFactorEnabled === null) return { state: 'unknown', tone: 'neutral' };
  return person.twoFactorEnabled
    ? { state: 'on', tone: 'positive' }
    : { state: 'off', tone: 'caution' };
}
