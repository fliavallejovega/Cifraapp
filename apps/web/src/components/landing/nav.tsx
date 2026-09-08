'use client';

import { useMotionValueEvent, useScroll } from 'motion/react';
import { useState } from 'react';

import { Link } from '@/i18n/navigation';

/**
 * The site's bar.
 *
 * Fixed, and transparent until the page moves under it; then it takes a
 * hairline and a blur so the words stay readable over whatever scrolls past.
 * Blur is the one place the design system allows it — chrome floating over
 * content — and this is that place.
 */
export function LandingNav({
  brand,
  links,
  signIn,
  start,
  otherLocale,
  switchLabel,
}: {
  readonly brand: string;
  readonly links: readonly { href: string; label: string }[];
  readonly signIn: string;
  readonly start: string;
  readonly otherLocale: string;
  readonly switchLabel: string;
}) {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (latest) => {
    setScrolled(latest > 16);
  });

  return (
    <header
      className={[
        'fixed inset-x-0 top-0 z-40 transition-[background-color,border-color,box-shadow] duration-(--duration-settle) ease-(--ease-settle)',
        scrolled
          ? 'border-b border-[color:var(--color-rule)] bg-[color:color-mix(in_oklch,var(--color-ground)_78%,transparent)] backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent',
      ].join(' ')}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <Link
          href="/"
          className="font-(family-name:--font-mono) text-sm font-semibold tracking-[0.18em] uppercase"
        >
          {brand}
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[color:var(--color-ink-secondary)] transition-colors duration-(--duration-quick) hover:text-[color:var(--color-ink)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <Link
            href="/"
            locale={otherLocale}
            className="hidden text-xs text-[color:var(--color-ink-tertiary)] transition-colors duration-(--duration-quick) hover:text-[color:var(--color-ink)] sm:block"
          >
            {switchLabel}
          </Link>
          <Link
            href="/sign-in"
            className="text-sm text-[color:var(--color-ink-secondary)] transition-colors duration-(--duration-quick) hover:text-[color:var(--color-ink)]"
          >
            {signIn}
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-9 items-center rounded-full bg-[color:var(--color-ink)] px-4 text-sm font-medium text-[color:var(--color-ground)] transition-[transform,opacity] duration-(--duration-tap) ease-(--ease-settle) hover:opacity-90 active:scale-[0.985]"
          >
            {start}
          </Link>
        </div>
      </div>
    </header>
  );
}
