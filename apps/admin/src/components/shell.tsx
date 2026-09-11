import Link from 'next/link';
import type { ReactNode } from 'react';

import { signOut } from '@/server/auth-actions';
import {
  IconEmails,
  IconFlags,
  IconHouseholds,
  IconOperations,
  IconOverview,
  IconRevenue,
  IconSignOut,
  IconUsage,
  Monogram,
} from './icons';

/**
 * The console's chrome.
 *
 * The product's furniture, with one posture: the fixed ink column, the brass
 * monogram, the destinations with their icons, and the administrator at the
 * foot. It used to be a row of underlined links above a bare page, which made
 * an internal tool that reads customer money look unrelated to the product it
 * reads it from — and «this is an internal tool» is not a reason for it to be
 * harder to navigate than the thing it administers.
 *
 * There is no drawer posture. This console is used at a desk; a queue of
 * failed jobs is not read on a phone, and pretending otherwise would mean
 * carrying the gesture machinery for a case nobody has.
 */

const SECTIONS = [
  { key: 'overview', href: '/', label: 'Overview', icon: IconOverview },
  { key: 'revenue', href: '/revenue', label: 'Revenue', icon: IconRevenue },
  { key: 'households', href: '/households', label: 'Households', icon: IconHouseholds },
  { key: 'usage', href: '/usage', label: 'Usage', icon: IconUsage },
  { key: 'operations', href: '/operations', label: 'Operations', icon: IconOperations },
  { key: 'emails', href: '/emails', label: 'Emails', icon: IconEmails },
  { key: 'flags', href: '/flags', label: 'Feature flags', icon: IconFlags },
] as const;

export type AdminSectionKey = (typeof SECTIONS)[number]['key'];

export function Console({
  current,
  email,
  role,
  children,
}: {
  readonly current: AdminSectionKey;
  readonly email: string;
  readonly role: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <aside className="panel-scope sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-[color:var(--color-panel)] text-[color:var(--color-panel-ink)] lg:flex">
        <div className="flex items-center gap-3 px-6 py-6">
          <Monogram />
          <div className="min-w-0">
            <p className="font-(family-name:--font-mono) text-sm font-semibold tracking-[0.16em] uppercase">
              Cifraapp
            </p>
            <p className="text-xs text-[color:var(--color-panel-ink-secondary)]">Console</p>
          </div>
        </div>

        <nav aria-label="Console sections" className="flex-1 px-3 py-2">
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map((section) => {
              const active = section.key === current;
              const Icon = section.icon;
              return (
                <li key={section.key}>
                  <Link
                    href={section.href}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      'flex items-center gap-3 rounded-(--radius-sm) px-3 py-2.5 text-sm transition-colors duration-(--duration-quick)',
                      active
                        ? 'bg-[color:var(--color-panel-raised)] font-medium text-[color:var(--color-panel-ink)]'
                        : 'text-[color:var(--color-panel-ink-secondary)] hover:bg-[color:var(--color-panel-raised)] hover:text-[color:var(--color-panel-ink)]',
                    ].join(' ')}
                  >
                    <span
                      aria-hidden
                      className={
                        active ? 'shrink-0 text-[color:var(--color-brand)]' : 'shrink-0 opacity-90'
                      }
                    >
                      <Icon />
                    </span>
                    {section.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-[color:var(--color-panel-rule)] px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{email}</p>
              <p className="text-xs text-[color:var(--color-panel-ink-secondary)]">
                {role.replace(/_/g, ' ')}
              </p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                title="Sign out"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-(--radius-sm) text-[color:var(--color-panel-ink-secondary)] transition-colors duration-(--duration-quick) hover:bg-[color:var(--color-panel-raised)] hover:text-[color:var(--color-panel-ink)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-brand)]"
              >
                <span className="sr-only">Sign out</span>
                <IconSignOut />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* On a narrow screen the column becomes a strip across the top rather
          than a drawer: seven destinations fit, and a gesture nobody uses is
          machinery nobody should maintain. */}
      <nav
        aria-label="Console sections"
        className="panel-scope fixed inset-x-0 top-0 z-30 flex gap-1 overflow-x-auto bg-[color:var(--color-panel)] px-3 py-2 lg:hidden"
      >
        {SECTIONS.map((section) => (
          <Link
            key={section.key}
            href={section.href}
            aria-current={section.key === current ? 'page' : undefined}
            className={[
              'shrink-0 rounded-(--radius-sm) px-3 py-2 text-xs whitespace-nowrap',
              section.key === current
                ? 'bg-[color:var(--color-panel-raised)] font-medium text-[color:var(--color-panel-ink)]'
                : 'text-[color:var(--color-panel-ink-secondary)]',
            ].join(' ')}
          >
            {section.label}
          </Link>
        ))}
      </nav>

      <main className="min-w-0 flex-1 pt-14 lg:pt-0">{children}</main>
    </div>
  );
}
