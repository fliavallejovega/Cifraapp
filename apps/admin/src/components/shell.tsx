import { Rule } from '@app/ui';
import Link from 'next/link';

/**
 * Navigation, and the only chrome this application has.
 *
 * Deliberately plain. An internal tool that spends its budget on presentation is
 * an internal tool whose queries nobody reviewed.
 */

const SECTIONS = [
  { key: 'overview', href: '/', label: 'Overview' },
  { key: 'households', href: '/households', label: 'Households' },
  { key: 'flags', href: '/flags', label: 'Feature flags' },
] as const;

export type AdminSectionKey = (typeof SECTIONS)[number]['key'];

export function AdminNav({ current, email }: { current: AdminSectionKey; email?: string }) {
  return (
    <header className="mb-14">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
        <nav aria-label="Admin sections" className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {SECTIONS.map((section) => (
            <Link
              key={section.key}
              href={section.href}
              aria-current={section.key === current ? 'page' : undefined}
              className={
                section.key === current
                  ? 'text-sm font-medium'
                  : 'text-sm text-[color:var(--color-ink-secondary)] underline underline-offset-4'
              }
            >
              {section.label}
            </Link>
          ))}
        </nav>

        {email && <span className="text-xs text-[color:var(--color-ink-tertiary)]">{email}</span>}
      </div>

      <Rule className="mt-5" />
    </header>
  );
}
