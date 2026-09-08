'use client';

import { Button, EmptyState, Problem, Select, Status } from '@app/ui';
import { useActionState, useState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { revokeMember, setMemberRole } from '@/server/access-actions';

/**
 * The people who sign in.
 *
 * Revoking asks first, and says what survives: the movements somebody recorded
 * stay, because they are a record of what happened, not a property of the
 * person who typed them.
 */

export interface MemberRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly roleLabel: string;
  readonly status: string;
  readonly joined: string;
  readonly isSelf: boolean;
}

export interface MemberListLabels {
  readonly you: string;
  readonly role: string;
  readonly joined: string;
  readonly changeRole: string;
  readonly revoke: string;
  readonly revokeConfirm: string;
  readonly cancel: string;
  readonly empty: string;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
}

export function MemberList({
  locale,
  members,
  roles,
  canManage,
  labels,
}: {
  readonly locale: string;
  readonly members: readonly MemberRow[];
  readonly roles: readonly { readonly value: string; readonly label: string }[];
  readonly canManage: boolean;
  readonly labels: MemberListLabels;
}) {
  const active = members.filter((member) => member.status !== 'revoked');

  if (active.length === 0) {
    return <EmptyState title={labels.empty} />;
  }

  return (
    <ul className="flex flex-col">
      {active.map((member) => (
        <li key={member.id} className="border-b border-[color:var(--color-rule)] last:border-b-0">
          <MemberRowItem
            locale={locale}
            member={member}
            roles={roles}
            canManage={canManage}
            labels={labels}
          />
        </li>
      ))}
    </ul>
  );
}

function MemberRowItem({
  locale,
  member,
  roles,
  canManage,
  labels,
}: {
  readonly locale: string;
  readonly member: MemberRow;
  readonly roles: readonly { readonly value: string; readonly label: string }[];
  readonly canManage: boolean;
  readonly labels: MemberListLabels;
}) {
  const [confirming, setConfirming] = useState(false);
  const [roleState, roleAction, rolePending] = useActionState<RecordActionResult, FormData>(
    setMemberRole,
    {},
  );
  const [revokeState, revokeAction, revokePending] = useActionState<RecordActionResult, FormData>(
    revokeMember,
    {},
  );

  const error = roleState.error ?? revokeState.error;
  // The owner is not managed from here, and neither is the reader themselves.
  const manageable = canManage && member.role !== 'owner' && !member.isSelf;

  return (
    <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium break-words text-[color:var(--color-ink)]">
            {member.name}
          </span>
          {member.isSelf && <Status tone="signal">{labels.you}</Status>}
        </p>
        <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
          {member.email} · {member.roleLabel} · {labels.joined} {member.joined}
        </p>
        {error && (
          <div className="mt-3 max-w-sm">
            <Problem
              title={labels.errorTitle}
              body={labels.errors[error] ?? labels.errors['generic'] ?? ''}
            />
          </div>
        )}
      </div>

      {manageable && (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <form action={roleAction} className="flex items-center gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={member.id} />
            <label className="sr-only" htmlFor={`role-${member.id}`}>
              {labels.role}
            </label>
            <Select id={`role-${member.id}`} name="role" defaultValue={member.role}>
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" variant="secondary" loading={rolePending}>
              {labels.changeRole}
            </Button>
          </form>

          {confirming ? (
            <form action={revokeAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={member.id} />
              <span className="text-xs text-[color:var(--color-ink-secondary)]">
                {labels.revokeConfirm}
              </span>
              <Button type="submit" size="sm" variant="destructive" loading={revokePending}>
                {labels.revoke}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
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
                setConfirming(true);
              }}
            >
              {labels.revoke}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
