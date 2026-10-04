'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Link, usePathname } from '@/i18n/navigation';
import { ThemeSwitch, type ThemeSwitchLabels } from './theme';
import { CajonRevelado, type PropiedadesDeEnlace } from './cajon/CajonRevelado';
import {
  IconAccess,
  IconAccounts,
  IconAdvice,
  IconAlerts,
  IconBudget,
  IconCards,
  IconCategories,
  IconChat,
  IconClose,
  IconCommitments,
  IconDebt,
  IconExport,
  IconGoals,
  IconHome,
  IconImport,
  IconStatements,
  IconInvestments,
  IconIncome,
  IconMerchants,
  IconMovements,
  IconOffers,
  IconNotifications,
  IconPeople,
  IconPlan,
  IconPosition,
  IconProjection,
  IconReports,
  IconReview,
  IconRules,
  IconScenarios,
  IconSettings,
  IconSimulate,
  IconSubscription,
  IconTax,
  IconTrips,
  Monogram,
} from './shell-icons';

/**
 * The product's chrome: one piece of furniture, two postures.
 *
 * On desktop it is the private-bank column — deep ink, the brass wordmark, the
 * destinations, the household at the foot. On a phone the same column is the
 * drawer underneath the page, revealed by sliding the page aside rather than by
 * covering it. Same world, same order, same accent; only the gesture changes.
 *
 * The column carries groups now, and that is not decoration. Twenty-eight flat
 * links is a list nobody reads; six headed blocks — what you have, what claims
 * it, what comes in, what to do, the record, the household — is the same
 * twenty-eight arranged the way a person already thinks about their money. The
 * headings are the product's argument, printed in the furniture.
 *
 * Client-side because the current path decides which destination is marked,
 * and the drawer is stateful. Everything readable — labels, the household, the
 * sign-out form — arrives from the server as props.
 */

export type DestinationKey =
  | 'overview'
  | 'accounts'
  | 'cards'
  | 'offers'
  | 'movements'
  | 'income'
  | 'commitments'
  | 'debts'
  | 'goals'
  | 'trips'
  | 'budgets'
  | 'familyExpenses'
  | 'documents'
  | 'merchants'
  | 'review'
  | 'plan'
  | 'advice'
  | 'alerts'
  | 'debtSimulator'
  | 'scenarios'
  | 'projection'
  | 'investments'
  | 'rules'
  | 'chat'
  | 'reports'
  | 'close'
  | 'exports'
  | 'categories'
  | 'people'
  | 'access'
  | 'tax'
  | 'notifications'
  | 'subscription'
  | 'settings'
  | 'household';

export interface ShellDestination {
  readonly href: string;
  readonly key: DestinationKey;
  readonly label: string;
  /** The heading this destination sits under. Blank groups render ungrouped. */
  readonly group: string;
  /** Other screens that belong to this destination and mark it as current. */
  readonly also?: readonly string[];
}

export interface ShellTab {
  readonly href: string;
  readonly label: string;
}

export interface ShellChromeProps {
  readonly destinations: readonly ShellDestination[];
  /** Groups of sibling screens shown as tabs while any one of them is open. */
  readonly families: readonly (readonly ShellTab[])[];
  readonly householdName: string;
  /** Present only for a platform administrator with a console to go to. */
  readonly consoleUrl: string | null;
  readonly labels: {
    readonly brand: string;
    readonly menu: string;
    readonly close: string;
    readonly back: string;
    readonly household: string;
    readonly collapse: string;
    readonly expand: string;
    readonly console: string;
    /** The one action every screen offers: getting a statement in. */
    readonly upload: string;
    readonly uploadShort: string;
    /** Accessible name of the phone's bottom bar. */
    readonly bar: string;
    /** Accessible name of the tabs across a destination's screens. */
    readonly tabs: string;
    readonly theme: ThemeSwitchLabels;
  };
  /** The sign-out form, built on the server around its action. */
  readonly signOut: ReactNode;
  readonly children: ReactNode;
}

const ICONS: Record<DestinationKey, () => ReactNode> = {
  overview: IconPosition,
  accounts: IconAccounts,
  cards: IconCards,
  offers: IconOffers,
  movements: IconMovements,
  income: IconIncome,
  commitments: IconCommitments,
  debts: IconDebt,
  goals: IconGoals,
  trips: IconTrips,
  budgets: IconBudget,
  familyExpenses: IconStatements,
  documents: IconImport,
  merchants: IconMerchants,
  review: IconReview,
  plan: IconPlan,
  advice: IconAdvice,
  alerts: IconAlerts,
  debtSimulator: IconSimulate,
  scenarios: IconScenarios,
  projection: IconProjection,
  investments: IconInvestments,
  rules: IconRules,
  chat: IconChat,
  reports: IconReports,
  close: IconClose,
  exports: IconExport,
  categories: IconCategories,
  people: IconPeople,
  access: IconAccess,
  tax: IconTax,
  notifications: IconNotifications,
  subscription: IconSubscription,
  settings: IconSettings,
  household: IconHome,
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
  families,
  householdName,
  consoleUrl,
  labels,
  signOut,
  children,
}: ShellChromeProps) {
  const pathname = usePathname();
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const family = families.find((tabs) => tabs.some((tab) => under(tab.href)));
  const tabsRef = useRef<HTMLUListElement>(null);

  // The current tab is always in view inside its own strip. Only the strip
  // scrolls — never the page — so a phone opening «Compromisos» sees it marked.
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const center = () => {
      const active = strip.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      const box = strip.getBoundingClientRect();
      const mark = active.getBoundingClientRect();
      const left = mark.left - box.left + strip.scrollLeft;
      const right = left + mark.width;
      if (left < strip.scrollLeft || right > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = Math.max(0, left - (strip.clientWidth - mark.width) / 2);
      }
    };
    // Again once layout settles and whenever the strip changes size: the first
    // pass can run before the fonts give the tabs their real width.
    const frame = requestAnimationFrame(center);
    const observer = new ResizeObserver(center);
    observer.observe(strip);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);
  const isActive = (href: string) => {
    const destination = destinations.find((entry) => entry.href === href);
    return under(href) || (destination?.also ?? []).some(under);
  };
  const navRef = useRef<HTMLElement>(null);

  // The active destination is always in view inside the column, which scrolls
  // on its own: on a short landscape screen the column is taller than the
  // window, and an active item below its fold read as no item being active.
  // Only the column moves — never the page.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const top =
      active.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
    const bottom = top + active.offsetHeight;
    if (top < nav.scrollTop || bottom > nav.scrollTop + nav.clientHeight) {
      nav.scrollTop = Math.max(0, top - nav.clientHeight / 2 + active.offsetHeight / 2);
    }
  }, [pathname]);

  const footer = (
    <div className="flex flex-col gap-4">
      {consoleUrl && (
        // A plain anchor: the console is another application on another
        // origin, and the product's router has no business prefetching it.
        <a
          href={`${consoleUrl}/sign-in`}
          className="block rounded-(--radius-sm) text-xs text-[color:var(--color-panel-ink-secondary)] underline underline-offset-4 transition-opacity duration-(--duration-quick) hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
        >
          {labels.console}
        </a>
      )}
      <ThemeSwitch labels={labels.theme} />
      <div className="flex min-w-0 items-center justify-between gap-3">
        {/* The household's name is the switcher. A person who belongs to two —
          their own and their parents' — needs somewhere to change which one
          every figure on screen belongs to, and the name is where they look. */}
        <Link
          href="/households"
          className="flex min-h-11 min-w-0 flex-col justify-center rounded-(--radius-sm) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
        >
          <span className="block truncate text-sm font-medium text-[color:var(--color-panel-ink)]">
            {householdName}
          </span>
          <span className="block text-xs text-[color:var(--color-panel-ink-secondary)]">
            {labels.household}
          </span>
        </Link>
        {signOut}
      </div>
    </div>
  );

  return (
    <CajonRevelado
      entradas={destinations.map((destination) => ({
        href: destination.href,
        titulo: destination.label,
        grupo: destination.group,
        icono: ICONS[destination.key](),
      }))}
      rutaActual={pathname}
      esActiva={(_ruta, href) => isActive(href)}
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

          <nav ref={navRef} aria-label={labels.menu} className="flex-1 overflow-y-auto px-3 pb-4">
            {/* Getting a statement in is what the product runs on, so it is never
                more than one click away and never buried in a group. */}
            <div className="pb-4">
              <Link
                href="/documents"
                className="flex h-11 w-full items-center justify-center gap-2 rounded-(--radius-md) bg-[color:var(--color-brand)] px-4 text-sm font-semibold text-[color:var(--color-panel)] transition-opacity duration-(--duration-quick) hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-panel-ink)]"
              >
                <IconImport />
                {labels.upload}
              </Link>
            </div>
            {/* Subir is the button above; the list holds the other four. */}
            {groupsOf(destinations.filter((entry) => entry.key !== 'documents')).map((group) => (
              <NavGroup
                key={group.name}
                name={group.name}
                entries={group.entries}
                isActive={isActive}
                labels={labels}
              />
            ))}
          </nav>

          <div className="border-t border-[color:var(--color-panel-rule)] px-6 py-5">{footer}</div>
        </aside>

        {/* The content, offset by the column's width — and on a phone, clear of the bar. */}
        <div className="min-w-0 flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-0 md:pl-[16.5rem]">
          {family && (
            <nav
              aria-label={labels.tabs}
              className="mx-auto w-full max-w-5xl px-5 pt-4 sm:px-10 sm:pt-6"
            >
              <ul
                ref={tabsRef}
                className="-mx-1 flex [scrollbar-width:none] list-none gap-1 overflow-x-auto p-0 pb-1"
              >
                {family.map((tab) => {
                  const current = under(tab.href);
                  return (
                    <li key={tab.href} className="shrink-0">
                      <Link
                        href={tab.href}
                        aria-current={current ? 'page' : undefined}
                        className={[
                          'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap',
                          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-ink)]',
                          current
                            ? 'bg-[color:var(--color-panel)] text-[color:var(--color-panel-ink)]'
                            : 'text-[color:var(--color-ink-secondary)] hover:bg-[color:var(--color-ground-sunk)] hover:text-[color:var(--color-ink)]',
                        ].join(' ')}
                      >
                        {tab.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
          {children}
        </div>
      </div>

      {/* ------------------------------------------------------------------
          The phone's bar. The same five destinations, under the thumb, with
          the upload in the middle because it is what the product runs on.
          ------------------------------------------------------------------ */}
      <nav
        aria-label={labels.bar}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-[color:var(--color-rule)] bg-[color:var(--color-surface)] pb-[env(safe-area-inset-bottom,0px)] md:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {destinations.map((destination) => {
            const active = isActive(destination.href);
            const upload = destination.key === 'documents';
            return (
              <li key={destination.href} className="min-w-0">
                <Link
                  href={destination.href}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs font-medium',
                    'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-brand)]',
                    active
                      ? 'text-[color:var(--color-ink)]'
                      : 'text-[color:var(--color-ink-secondary)]',
                  ].join(' ')}
                >
                  <span
                    aria-hidden
                    className={
                      upload
                        ? 'flex h-8 w-12 items-center justify-center rounded-full bg-[color:var(--color-panel)] text-[color:var(--color-panel-ink)]'
                        : active
                          ? 'flex h-8 w-12 items-center justify-center rounded-full bg-[color:var(--color-ground-sunk)]'
                          : 'flex h-8 w-12 items-center justify-center'
                    }
                  >
                    {ICONS[destination.key]()}
                  </span>
                  <span className="max-w-full truncate">{destination.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </CajonRevelado>
  );
}

/**
 * One heading and the destinations under it, collapsible.
 *
 * Twenty-eight links is a lot of column, and most days a household lives in
 * three of them. Folding a block away is how the two they use stay above the
 * fold on a laptop — so the state is remembered per device, in `localStorage`,
 * the same place the theme lives.
 *
 * The group holding the current page always opens, whatever was stored. Landing
 * on a screen whose section is folded shut leaves a person unable to see where
 * they are, and that costs more than the row it saves.
 */
function NavGroup({
  name,
  entries,
  isActive,
  labels,
}: {
  readonly name: string;
  readonly entries: readonly ShellDestination[];
  readonly isActive: (href: string) => boolean;
  readonly labels: ShellChromeProps['labels'];
}) {
  const holdsCurrentPage = entries.some((entry) => isActive(entry.href));

  // Open on the server and on the first client render, then corrected from
  // storage. Starting closed would collapse the whole column for an instant on
  // every load, which reads as a broken menu rather than as a preference.
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (holdsCurrentPage) {
      setOpen(true);
      return;
    }

    try {
      setOpen(localStorage.getItem(`${GROUP_STORAGE_PREFIX}${name}`) !== 'closed');
    } catch {
      // Site data blocked. Open is the honest default: nothing is hidden.
    }
  }, [name, holdsCurrentPage]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(`${GROUP_STORAGE_PREFIX}${name}`, next ? 'open' : 'closed');
    } catch {
      // It still folds; it just will not be remembered.
    }
  };

  const panelId = `nav-group-${name.replace(/\s+/g, '-').toLowerCase()}`;

  if (name === '') {
    return (
      <ul className="flex flex-col gap-0.5">
        {entries.map((destination) => (
          <NavLink
            key={destination.href}
            destination={destination}
            active={isActive(destination.href)}
          />
        ))}
      </ul>
    );
  }

  return (
    <section className="mt-5 first:mt-0">
      <h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          title={open ? labels.collapse : labels.expand}
          className="flex min-h-11 w-full items-center gap-1.5 rounded-(--radius-sm) px-3.5 text-left font-(family-name:--font-mono) text-[0.6875rem] font-medium tracking-[0.14em] text-[color:var(--color-panel-ink-secondary)] uppercase opacity-70 transition-colors duration-(--duration-quick) hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-brand)]"
        >
          <span
            aria-hidden
            className="shrink-0 transition-transform duration-(--duration-quick) ease-(--ease-settle) motion-reduce:transition-none"
            style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          >
            <svg
              viewBox="0 0 12 12"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m4.5 2.5 4 3.5-4 3.5" />
            </svg>
          </span>
          <span className="truncate">{name}</span>
        </button>
      </h2>

      <ul id={panelId} hidden={!open} className="flex flex-col gap-0.5">
        {entries.map((destination) => (
          <NavLink
            key={destination.href}
            destination={destination}
            active={isActive(destination.href)}
          />
        ))}
      </ul>
    </section>
  );
}

/** One destination. Extracted so the group renders the same row either way. */
function NavLink({
  destination,
  active,
}: {
  readonly destination: ShellDestination;
  readonly active: boolean;
}) {
  return (
    <li>
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
}

const GROUP_STORAGE_PREFIX = 'cifrapp-nav:';

/**
 * The destinations, in the order given, gathered under their headings.
 *
 * Order is preserved rather than sorted: the server decided the sequence and
 * the sequence is the argument. A group is opened by its first member and
 * everything with the same heading joins it.
 */
function groupsOf(
  destinations: readonly ShellDestination[],
): readonly { name: string; entries: readonly ShellDestination[] }[] {
  const groups: { name: string; entries: ShellDestination[] }[] = [];

  for (const destination of destinations) {
    const existing = groups.find((group) => group.name === destination.group);
    if (existing) existing.entries.push(destination);
    else groups.push({ name: destination.group, entries: [destination] });
  }

  return groups;
}
