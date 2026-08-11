'use client';

import { Button, Field, Input, Problem } from '@app/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getBrowserClient } from '@/lib/supabase-browser';

/**
 * Setting a new password after following a recovery link.
 *
 * Recovery links arrive in two shapes and this handles both, because which one
 * you get depends on where the reset was started rather than on anything the
 * person did:
 *
 *   **`?code=`** — a reset requested through this product. `/auth/callback`
 *   exchanges it for a session before this page renders, so there is nothing
 *   left to do here but ask for the password.
 *
 *   **`#access_token=…&type=recovery`** — a reset triggered from the Supabase
 *   dashboard, or by an older email template. The tokens sit in the URL
 *   fragment, which is never sent to a server, so only this component can see
 *   them. It installs the session and strips the fragment immediately: a
 *   recovery token sitting in the address bar ends up in a screenshot, a
 *   bookmark, or a shoulder.
 *
 * Without this component the second shape is a dead end — the browser lands on a
 * page that reads the session server-side, finds none, and shows marketing.
 */

export interface ResetPasswordLabels {
  readonly password: string;
  readonly passwordHint: string;
  readonly submit: string;
  readonly checking: string;
  readonly expiredTitle: string;
  readonly expiredBody: string;
  readonly requestAgain: string;
  readonly errorTitle: string;
  readonly errorBody: string;
  readonly tooShort: string;
}

type Phase = 'checking' | 'ready' | 'expired' | 'saving' | 'failed';

export function ResetPasswordForm({
  labels,
  locale,
}: {
  labels: ResetPasswordLabels;
  locale: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('checking');
  const [problem, setProblem] = useState<string>(labels.errorBody);

  useEffect(() => {
    const supabase = getBrowserClient();

    async function establish() {
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));

      // Supabase reports an expired or already-used link in the fragment too,
      // and it arrives with no tokens at all.
      if (fragment.get('error')) {
        setPhase('expired');
        return;
      }

      const accessToken = fragment.get('access_token');
      const refreshToken = fragment.get('refresh_token');

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        // Out of the address bar before anything else happens, whether or not
        // the session took.
        window.history.replaceState(null, '', window.location.pathname);

        if (error) {
          setPhase('expired');
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      setPhase(data.session ? 'ready' : 'expired');
    }

    void establish();
  }, []);

  async function save(form: FormData) {
    const password = form.get('password');
    if (typeof password !== 'string' || password.length < 8) {
      setProblem(labels.tooShort);
      setPhase('failed');
      return;
    }

    setPhase('saving');
    const supabase = getBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setProblem(error.message);
      setPhase('failed');
      return;
    }

    // A password reset usually happens because somebody lost control of the
    // account. Leaving every other session alive would defeat the point, so they
    // go — best effort, because failing to end them must not block the person
    // who just proved they own the address.
    await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);

    router.replace(`/${locale}/overview`);
    router.refresh();
  }

  if (phase === 'checking') {
    return (
      <p role="status" className="text-sm text-[color:var(--color-ink-secondary)]">
        {labels.checking}
      </p>
    );
  }

  if (phase === 'expired') {
    return (
      <div className="flex flex-col gap-6">
        <Problem title={labels.expiredTitle} body={labels.expiredBody} />
        <a href={`/${locale}/forgot-password`} className="text-sm underline underline-offset-4">
          {labels.requestAgain}
        </a>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save(new FormData(event.currentTarget));
      }}
      className="flex flex-col gap-5"
    >
      {phase === 'failed' && <Problem title={labels.errorTitle} body={problem} />}

      <Field label={labels.password} hint={labels.passwordHint} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <Button type="submit" loading={phase === 'saving'} size="lg" className="mt-2 w-full">
        {labels.submit}
      </Button>
    </form>
  );
}
