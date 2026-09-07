'use client';

import { usePathname } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';

/**
 * One destination in the product nav.
 *
 * Client-side only because the current path decides which one is marked. The
 * mark is a rule under the label plus `aria-current`, not color alone — hue in
 * this system means something about money, and "you are here" is not a
 * financial fact.
 */
export function AppNavLink({ href, label }: { readonly href: string; readonly label: string }) {
  const pathname = usePathname();
  // `usePathname` from next-intl returns the path without the locale prefix, so
  // this compares like with like. A nested route (a single import) still marks
  // its section.
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={[
        'inline-flex h-11 items-center border-b-2 px-3 text-sm whitespace-nowrap',
        'transition-colors duration-(--duration-quick) ease-(--ease-settle)',
        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-ink)]',
        active
          ? 'border-[color:var(--color-ink)] font-medium text-[color:var(--color-ink)]'
          : 'border-transparent text-[color:var(--color-ink-secondary)] hover:text-[color:var(--color-ink)]',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}
