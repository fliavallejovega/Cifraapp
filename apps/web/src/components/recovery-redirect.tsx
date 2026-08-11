'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { getBrowserClient } from '@/lib/supabase-browser';

/**
 * Catches a recovery link wherever it lands.
 *
 * A password reset email points at whatever origin and path the auth provider
 * was configured with — usually the site root — and carries its tokens in the
 * URL fragment. That combination is a dead end by default: the fragment never
 * reaches a server, so the page renders as if nobody had arrived, and the person
 * is left staring at marketing with a valid recovery token in their address bar.
 *
 * Mounting this in the locale layout makes the flow independent of that
 * configuration. Any page in the application will now recognise a recovery
 * fragment, install the session, clear the fragment and move the person to the
 * form that sets a new password. Nothing has to be right in a dashboard for it
 * to work.
 *
 * It acts on `type=recovery` alone. Other fragments — a magic link, an OAuth
 * return — belong to flows that have their own landing places, and hijacking
 * them here would break those instead.
 */

const RESET_PATH = 'reset-password';

export function RecoveryRedirect({ locale }: { locale: string }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // The reset page reads the same fragment itself. Two components racing to
    // consume a one-time token is how it gets consumed by the one that then
    // navigates away from it.
    if (pathname.includes(RESET_PATH)) return;

    const hash = window.location.hash.replace(/^#/, '');
    if (hash.length === 0) return;

    const fragment = new URLSearchParams(hash);
    const isRecovery =
      fragment.get('type') === 'recovery' ||
      // An expired or already-used recovery link arrives with an error and no
      // type at all. It still belongs on the reset page, which explains it.
      fragment.get('error_code') === 'otp_expired';

    if (!isRecovery) return;

    async function move() {
      const accessToken = fragment.get('access_token');
      const refreshToken = fragment.get('refresh_token');

      if (accessToken && refreshToken) {
        await getBrowserClient().auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      }

      // Cleared before navigating, so the token never survives into history.
      window.history.replaceState(null, '', window.location.pathname);
      router.replace(`/${locale}/${RESET_PATH}`);
    }

    void move();
  }, [locale, pathname, router]);

  return null;
}
