'use client';

import { Button, Field, Input, PasswordInput, Problem } from '@app/ui';

import { Link } from '@/i18n/navigation';
import { useActionState } from 'react';

import type { ActionResult } from '@/server/auth-actions';

/**
 * The sign-in and sign-up form.
 *
 * One component for both, because they differ by a single field and a label
 * set — and two near-identical forms drift apart until one of them loses its
 * error handling.
 *
 * Passwords are never echoed back into the form on failure. The browser's own
 * password manager is the right place for them to persist, not a server round
 * trip.
 */

export interface AuthFormLabels {
  readonly email: string;
  readonly password: string;
  readonly passwordHint: string;
  readonly showPassword: string;
  readonly hidePassword: string;
  readonly displayName?: string;
  readonly submit: string;
  /** Only on the sign-up form: the sentence beside the acceptance box. */
  readonly acceptTerms?: string;
  readonly acceptTermsLink?: string;
  readonly acceptTermsSummary?: string;
  readonly errorTitle: string;
  readonly errors: Record<string, string>;
  readonly notices: Record<string, string>;
}

export interface AuthFormProps {
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly labels: AuthFormLabels;
  readonly locale: string;
  readonly next?: string;
  readonly withDisplayName?: boolean;
  /**
   * Whether this form opens an account, and so must take consent.
   *
   * Separate from `withDisplayName` on purpose: signing in must never ask
   * again, and a single flag conflating «new account» with «show the name
   * field» would put the box on the wrong form the first time either changed.
   */
  readonly withTerms?: boolean;
}

export function AuthForm({
  action,
  labels,
  locale,
  next,
  withDisplayName,
  withTerms,
}: AuthFormProps) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {next && <input type="hidden" name="next" value={next} />}

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      {state.notice && (
        <p
          role="status"
          className="border-l border-[color:var(--color-positive)] bg-[color:var(--color-positive-sunk)] px-4 py-3 text-sm"
        >
          {labels.notices[state.notice] ?? state.notice}
        </p>
      )}

      {withDisplayName && labels.displayName && (
        <Field label={labels.displayName}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              name="displayName"
              autoComplete="name"
              aria-describedby={describedBy}
              maxLength={80}
            />
          )}
        </Field>
      )}

      <Field label={labels.email} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <Field label={labels.password} hint={labels.passwordHint} required>
        {({ id, describedBy }) => (
          <PasswordInput
            id={id}
            name="password"
            autoComplete={withDisplayName ? 'new-password' : 'current-password'}
            required
            minLength={8}
            aria-describedby={describedBy}
            showLabel={labels.showPassword}
            hideLabel={labels.hidePassword}
          />
        )}
      </Field>

      {withTerms && (
        <div className="flex flex-col gap-2">
          {/* Unticked, always. A pre-ticked box is not consent, and this is the
              record the product would have to stand behind if it were ever
              asked what somebody actually agreed to. */}
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="acceptTerms"
              required
              className="mt-0.5 size-4 shrink-0 accent-[color:var(--color-brand)]"
            />
            <span className="text-pretty text-[color:var(--color-ink-secondary)]">
              {labels.acceptTerms}{' '}
              <Link
                href="/terms"
                target="_blank"
                className="underline underline-offset-4 hover:no-underline"
              >
                {labels.acceptTermsLink}
              </Link>
            </span>
          </label>
          {/* The three things the long document exists to say, said here too.
              Nobody reads the terms; everybody reads the sentence above the
              button, and burying these there would be a technicality. */}
          <p className="max-w-[54ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
            {labels.acceptTermsSummary}
          </p>
        </div>
      )}

      <Button type="submit" loading={pending} size="lg" className="mt-2 w-full">
        {labels.submit}
      </Button>
    </form>
  );
}
