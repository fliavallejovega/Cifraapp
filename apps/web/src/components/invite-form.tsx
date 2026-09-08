'use client';

import { Button, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState, useState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { inviteMember, revokeInvitation, type InviteResult } from '@/server/access-actions';

/**
 * Creating an invitation, and showing the link exactly once.
 *
 * Most deployments of this product have no mail transport, so «invitation sent»
 * would be a lie. The link is handed back to the person who created it, with a
 * plain statement that it will not be shown again — because the token is hashed
 * before it is stored and there is genuinely no copy of it to show later.
 */

export interface InvitationRow {
  readonly id: string;
  readonly email: string;
  readonly roleLabel: string;
  readonly state: string;
  readonly isOpen: boolean;
}

export interface InviteFormLabels {
  readonly email: string;
  readonly role: string;
  readonly submit: string;
  readonly linkTitle: string;
  readonly linkNote: string;
  readonly pending: string;
  readonly none: string;
  readonly cancel: string;
  readonly cancelConfirm: string;
  readonly dismiss: string;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
}

export function InviteForm({
  locale,
  roles,
  invitations,
  labels,
}: {
  readonly locale: string;
  readonly roles: readonly { readonly value: string; readonly label: string }[];
  readonly invitations: readonly InvitationRow[];
  readonly labels: InviteFormLabels;
}) {
  const [state, formAction, pending] = useActionState<InviteResult, FormData>(inviteMember, {});

  return (
    <div className="flex flex-col gap-8">
      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="locale" value={locale} />

        {state.error && (
          <Problem
            title={labels.errorTitle}
            body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
          />
        )}

        {state.link && (
          <div
            role="status"
            className="flex flex-col gap-2 border-l border-[color:var(--color-positive)] bg-[color:var(--color-positive-sunk)] px-4 py-3"
          >
            <p className="text-sm font-medium">{labels.linkTitle}</p>
            {/* Selectable and wrapping. A link somebody has to copy by hand is
                one they will get wrong. */}
            <code className="readout w-full text-xs break-all text-[color:var(--color-ink)]">
              {state.link}
            </code>
            <p className="text-xs text-[color:var(--color-ink-secondary)]">{labels.linkNote}</p>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={labels.email} required>
            {({ id }) => <Input id={id} name="email" type="email" required autoComplete="email" />}
          </Field>

          <Field label={labels.role}>
            {({ id }) => (
              <Select id={id} name="role" defaultValue="member">
                {roles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Button type="submit" loading={pending} className="self-start">
          {labels.submit}
        </Button>
      </form>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-[color:var(--color-ink)]">{labels.pending}</h3>

        {invitations.length === 0 ? (
          <p className="text-sm text-[color:var(--color-ink-secondary)]">{labels.none}</p>
        ) : (
          <ul className="flex flex-col">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="border-b border-[color:var(--color-rule)] last:border-b-0"
              >
                <InvitationRowItem locale={locale} invitation={invitation} labels={labels} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function InvitationRowItem({
  locale,
  invitation,
  labels,
}: {
  readonly locale: string;
  readonly invitation: InvitationRow;
  readonly labels: InviteFormLabels;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    revokeInvitation,
    {},
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium break-words text-[color:var(--color-ink)]">
          {invitation.email}
        </p>
        <p className="mt-0.5 text-sm text-[color:var(--color-ink-secondary)]">
          {invitation.roleLabel} · {invitation.state}
        </p>
        {state.error && (
          <div className="mt-2 max-w-sm">
            <Problem
              title={labels.errorTitle}
              body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
            />
          </div>
        )}
      </div>

      {invitation.isOpen ? (
        confirming ? (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={invitation.id} />
            <span className="text-xs text-[color:var(--color-ink-secondary)]">
              {labels.cancelConfirm}
            </span>
            <Button type="submit" size="sm" variant="secondary" loading={pending}>
              {labels.dismiss}
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
            {labels.cancel}
          </Button>
        )
      ) : (
        <Status tone="neutral">{invitation.state}</Status>
      )}
    </div>
  );
}
