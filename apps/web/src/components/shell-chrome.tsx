'use client';

import { type ReactNode } from 'react';

import { Link, usePathname } from '@/i18n/navigation';
import { CajonRevelado, type PropiedadesDeEnlace } from './cajon/CajonRevelado';
import {
  IconAccounts,
  IconImport,
  IconPlan,
  IconPosition,
  IconReports,
  Monogram,
} from './shell-icons';

/**
 * The product's chrome: one piece of furniture, two postures.
 *
 * On desktop it is the private-bank column — deep ink, the brass wordmark, the
 * five destinations, the household at the foot. On a phone the same column is
 * the drawer underneath the page, revealed by sliding the page aside rather
 * than by covering it. Same world, same order, same accent; only the gesture
 * changes.
 *
 * Client-side because the current path decides which destination is marked,
 * and the drawer is stateful. Everything readable — labels, the household, the
 * sign-out form — arrives from the server as props.
 */

export interface ShellDestination {
  readonly href: string;
  readonly key: 'overview' | 'accounts' | 'documents' | 'plan' | 'reports';
  readonly label: string;
}

export interface ShellChromeProps {
  readonly destinations: readonly ShellDestination[];
  readonly householdName: string;
  readonly labels: {
    readonly brand: string;
    readonly menu: string;
    readonly close: string;
    readonly back: string;
    readonly household: string;
  };
  /** The sign-out form, built on the server around its action. */
  readonly signOut: ReactNode;
  readonly children: ReactNode;
}

const ICONS: Record<ShellDestination['key'], () => ReactNode> = {
  overview: IconPosition,
  accounts: IconAccounts,
  documents: IconImport,
  plan: IconPlan,
  reports: IconReports,
};

function I18nLink({ href, children, ...rest }: PropiedadesDeEnlace) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

export function ShellChrome({
  destinations,
  householdName,
  labels,
  signOut,
  children,
}: ShellChromeProps) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const footer = (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[color:var(--color-panel-ink)]">
          {householdName}
        </p>
        <p className="text-xs text-[color:var(--color-panel-ink-secondary)]">{labels.household}</p>
      </div>
      {signOut}
    </div>
  );

  return (
    <CajonRevelado
      entradas={destinations.map((destination) => ({
        href: destination.href,
        titulo: destination.label,
        icono: ICONS[destination.key](),
      }))}
      rutaActual={pathname}
      Enlace={I18nLink}
      titulo={labels.menu}
      textoCerrar={labels.close}
      textoVolver={labels.back}
      pie={footer}
      marca={
        <span className="flex items-center gap-2.5">
          <Monogram size={28} />
          <span className="cajon-marca">{labels.brand}</span>
        </span>
      }
    >
      <div className="flex min-h-dvh flex-1">
        {/* ------------------------------------------------------------------
            The desktop column. Fixed, so a long statement scrolls under a
            still piece of furniture rather than dragging its navigation along.
            ------------------------------------------------------------------ */}
        <aside
          className="fixed inset-y-0 left-0 z-10 hidden w-[16.5rem] flex-col border-r border-[color:var(--color-panel-rule)] bg-[color:var(--color-panel)] md:flex"
          style={{
            backgroundImage:
              'linear-gradient(180deg, var(--color-panel-raised) 0%, var(--color-panel) 22rem)',
          }}
        >
          <div className="flex items-center gap-3 px-6 pt-7 pb-6">
            <Monogram />
            <span className="font-(family-name:--font-mono) text-sm font-semibold tracking-[0.18em] text-[color:var(--color-panel-ink)] uppercase">
              {labels.brand}
            </span>
          </div>

          <nav aria-label={labels.menu} className="flex-1 overflow-y-auto px-3">
            <ul className="flex flex-col gap-0.5">
              {destinations.map((destination) => {
                const active = isActive(destination.href);
                return (
                  <li key={destination.href}>
                    <Link
                      href={destination.href}
                      aria-current={active ? 'page' : undefined}
                      className={[
                        'flex min-h-11 items-center gap-3 rounded-(--radius-sm) px-3.5 text-sm',
                        'transition-colors duration-(--duration-quick) ease-(--ease-settle)',
                        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-brand)]',
                        active
                          ? // The one brand mark per posture: brass on raised ink.
                            'bg-[color:var(--color-panel-raised)] font-semibold text-[color:var(--color-brand)] shadow-[inset_2px_0_0_var(--color-brand)]'
                          : 'font-medium text-[color:var(--color-panel-ink-secondary)] hover:bg-[color:var(--color-panel-raised)] hover:text-[color:var(--color-panel-ink)]',
                      ].join(' ')}
                    >
                      <span aria-hidden className="shrink-0 opacity-90">
                        {ICONS[destination.key]()}
                      </span>
                      {destination.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="border-t border-[color:var(--color-panel-rule)] px-6 py-5">{footer}</div>
        </aside>

        {/* The content, offset by the column's width. */}
        <div className="min-w-0 flex-1 md:pl-[16.5rem]">{children}</div>
      </div>
    </CajonRevelado>
  );
}
