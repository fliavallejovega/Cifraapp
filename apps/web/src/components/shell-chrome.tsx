'use client';

import { type ReactNode } from 'react';

import { Link, usePathname } from '@/i18n/navigation';
import { CajonRevelado, type PropiedadesDeEnlace } from './cajon/CajonRevelado';
import {
  IconAccess,
  IconAccounts,
  IconAdvice,
  IconAlerts,
  IconBudget,
  IconCategories,
  IconChat,
  IconClose,
  IconCommitments,
  IconDebt,
  IconExport,
  IconGoals,
  IconImport,
  IconIncome,
  IconMerchants,
  IconMovements,
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
  | 'movements'
  | 'income'
  | 'commitments'
  | 'debts'
  | 'goals'
  | 'budgets'
  | 'documents'
  | 'merchants'
  | 'review'
  | 'plan'
  | 'advice'
  | 'alerts'
  | 'debtSimulator'
  | 'scenarios'
  | 'projection'
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
  | 'settings';

export interface ShellDestination {
  readonly href: string;
  readonly key: DestinationKey;
  readonly label: string;
  /** The heading this destination sits under. Blank groups render ungrouped. */
  readonly group: string;
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

const ICONS: Record<DestinationKey, () => ReactNode> = {
  overview: IconPosition,
  accounts: IconAccounts,
  movements: IconMovements,
  income: IconIncome,
  commitments: IconCommitments,
  debts: IconDebt,
  goals: IconGoals,
  budgets: IconBudget,
  documents: IconImport,
  merchants: IconMerchants,
  review: IconReview,
  plan: IconPlan,
  advice: IconAdvice,
  alerts: IconAlerts,
  debtSimulator: IconSimulate,
  scenarios: IconScenarios,
  projection: IconProjection,
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
      {/* The household's name is the switcher. A person who belongs to two —
          their own and their parents' — needs somewhere to change which one
          every figure on screen belongs to, and the name is where they look. */}
      <Link
        href="/households"
        className="min-w-0 rounded-(--radius-sm) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
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

          <nav aria-label={labels.menu} className="flex-1 overflow-y-auto px-3 pb-4">
            {groupsOf(destinations).map((group) => (
              <section key={group.name} className="mt-5 first:mt-0">
                {group.name !== '' && (
                  <h2 className="px-3.5 pb-1.5 font-(family-name:--font-mono) text-[0.6875rem] font-medium tracking-[0.14em] text-[color:var(--color-panel-ink-tertiary,var(--color-panel-ink-secondary))] uppercase opacity-70">
                    {group.name}
                  </h2>
                )}
                <ul className="flex flex-col gap-0.5">
                  {group.entries.map((destination) => {
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
              </section>
            ))}
          </nav>

          <div className="border-t border-[color:var(--color-panel-rule)] px-6 py-5">{footer}</div>
        </aside>

        {/* The content, offset by the column's width. */}
        <div className="min-w-0 flex-1 md:pl-[16.5rem]">{children}</div>
      </div>
    </CajonRevelado>
  );
}

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
