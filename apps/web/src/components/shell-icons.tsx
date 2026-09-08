import type { ReactNode } from 'react';

/**
 * The product's icon set. One style — outline, 1.5px stroke, 20-unit grid —
 * drawn here rather than pulled from a package, so the set can never drift
 * into mixed families.
 *
 * Each icon is chosen for what its screen *answers*, not for what its noun
 * looks like: a gauge for the position, a vault card for accounts, a tray for
 * import, a compass for the plan, columns for the statements. As the product
 * grew from five destinations to twenty-eight, the rule held — a screen earns
 * an icon by answering a distinct question, and screens that answer variations
 * of the same one share the group heading instead.
 */

function Icon({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      {children}
    </svg>
  );
}

/** The position: a gauge with its needle. */
export function IconPosition() {
  return (
    <Icon>
      <path d="M3 13.5a7 7 0 0 1 14 0" />
      <path d="M10 13.5 13 9" />
      <path d="M3 16.5h14" />
    </Icon>
  );
}

/** Accounts: the card in the vault. */
export function IconAccounts() {
  return (
    <Icon>
      <rect x="2.5" y="5" width="15" height="11" rx="2" />
      <path d="M2.5 8.5h15" />
      <path d="M5.5 12.5h3" />
    </Icon>
  );
}

/** Import: a statement arriving into the tray. */
export function IconImport() {
  return (
    <Icon>
      <path d="M10 3v8" />
      <path d="m6.75 8 3.25 3 3.25-3" />
      <path d="M3 12.5v2A2.5 2.5 0 0 0 5.5 17h9a2.5 2.5 0 0 0 2.5-2.5v-2" />
    </Icon>
  );
}

/** The plan: a compass pointing north. */
export function IconPlan() {
  return (
    <Icon>
      <circle cx="10" cy="10" r="7.5" />
      <path d="m12.8 7.2-1.9 4.4-3.7 1.2 1.9-4.4z" />
    </Icon>
  );
}

/** Statements: the columns of a report. */
export function IconReports() {
  return (
    <Icon>
      <path d="M3.5 16.5v-6" />
      <path d="M8 16.5v-10" />
      <path d="M12.5 16.5v-4" />
      <path d="M17 16.5V4.5" />
    </Icon>
  );
}

/** Sign out: leaving through the door. */
export function IconSignOut() {
  return (
    <Icon>
      <path d="M8 17H5.5A1.5 1.5 0 0 1 4 15.5v-11A1.5 1.5 0 0 1 5.5 3H8" />
      <path d="M13 6.5 16.5 10 13 13.5" />
      <path d="M16.5 10H8" />
    </Icon>
  );
}

/**
 * The monogram: the brand mark, drawn once and reused everywhere.
 *
 * The letter is drawn as a path rather than set as text so it renders
 * identically without waiting on a webfont — which matters most at 16px in a
 * browser tab. It follows the working name (ADR-001) and changes with it.
 */
export function Monogram({ size = 34 }: { readonly size?: number }) {
  return (
    <svg viewBox="0 0 34 34" aria-hidden="true" width={size} height={size}>
      <rect
        x="0.75"
        y="0.75"
        width="32.5"
        height="32.5"
        rx="8"
        fill="var(--color-panel)"
        stroke="var(--color-brand)"
        strokeWidth="1"
      />
      {/* The same stroked arc the app icons use, scaled to this grid. */}
      <path
        d="M23.7 23 A9 9 0 1 1 23.7 11"
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Movements: the ledger line, and the entry that moves it. */
export function IconMovements() {
  return (
    <Icon>
      <path d="M3 6h14" />
      <path d="M3 10h9" />
      <path d="M3 14h11" />
      <path d="M15.5 9.5v5" />
      <path d="m13.5 12.5 2 2 2-2" />
    </Icon>
  );
}

/** Income: what arrives. */
export function IconIncome() {
  return (
    <Icon>
      <path d="M10 16.5V4.5" />
      <path d="m5.75 8.75 4.25-4.25 4.25 4.25" />
      <path d="M4 17h12" />
    </Icon>
  );
}

/** Commitments: the calendar claim with its day marked. */
export function IconCommitments() {
  return (
    <Icon>
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.5h14" />
      <path d="M6.5 2.5v3" />
      <path d="M13.5 2.5v3" />
      <path d="M9 12.5h2.5" />
    </Icon>
  );
}

/** Debt: the weight that compounds. */
export function IconDebt() {
  return (
    <Icon>
      <circle cx="10" cy="10" r="7" />
      <path d="M12.5 7.5H9a1.75 1.75 0 0 0 0 3.5h2a1.75 1.75 0 0 1 0 3.5H7.5" />
      <path d="M10 5.5v9" />
    </Icon>
  );
}

/** Goals: the target and what is aimed at it. */
export function IconGoals() {
  return (
    <Icon>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="3" />
      <circle cx="10" cy="10" r="0.75" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Budgets: the planned share against the spent one. */
export function IconBudget() {
  return (
    <Icon>
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M6.5 13.5v-3" />
      <path d="M10 13.5v-6" />
      <path d="M13.5 13.5v-4.5" />
    </Icon>
  );
}

/** Categories: the tree the household names its spending with. */
export function IconCategories() {
  return (
    <Icon>
      <path d="M5 3.5v10a2 2 0 0 0 2 2h2" />
      <path d="M5 9.5h4" />
      <rect x="11" y="7.5" width="5.5" height="4" rx="1" />
      <rect x="11" y="13.5" width="5.5" height="4" rx="1" />
    </Icon>
  );
}

/** People: who the money has to cover. */
export function IconPeople() {
  return (
    <Icon>
      <circle cx="7.5" cy="7" r="2.75" />
      <path d="M3 16c0-2.5 2-4.25 4.5-4.25S12 13.5 12 16" />
      <path d="M13.5 6.25a2.5 2.5 0 0 1 0 4.75" />
      <path d="M14.5 12.25c1.5.5 2.5 1.8 2.5 3.75" />
    </Icon>
  );
}

/** Review: the queue waiting for a decision. */
export function IconReview() {
  return (
    <Icon>
      <path d="M3.5 5.5h13" />
      <path d="M3.5 10h13" />
      <path d="M3.5 14.5h7" />
      <circle cx="14.5" cy="14.5" r="2.5" />
    </Icon>
  );
}

/** Advice: what to do about it, in words. */
export function IconAdvice() {
  return (
    <Icon>
      <path d="M7.5 15.5h5" />
      <path d="M8.25 17.5h3.5" />
      <path d="M10 2.75a5 5 0 0 1 3 9c-.5.4-.75 1-.75 1.75h-4.5c0-.75-.25-1.35-.75-1.75a5 5 0 0 1 3-9Z" />
    </Icon>
  );
}

/** Alerts: the thing that will go wrong if nothing changes. */
export function IconAlerts() {
  return (
    <Icon>
      <path d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5c0 4-1.5 5-1.5 5h12s-1.5-1-1.5-5A4.5 4.5 0 0 0 10 3.5Z" />
      <path d="M8.75 16a1.5 1.5 0 0 0 2.5 0" />
    </Icon>
  );
}

/** Simulation: two paths from the same point. */
export function IconSimulate() {
  return (
    <Icon>
      <path d="M3 16.5 7 9l3.5 4L17 4" />
      <path d="M3 16.5 8 14l4 2.5" />
      <circle cx="17" cy="4" r="1.25" />
    </Icon>
  );
}

/** Scenarios: the fork in the road. */
export function IconScenarios() {
  return (
    <Icon>
      <path d="M10 17V9" />
      <path d="M10 9 5 4.5" />
      <path d="m10 9 5-4.5" />
      <circle cx="4.25" cy="3.75" r="1.5" />
      <circle cx="15.75" cy="3.75" r="1.5" />
    </Icon>
  );
}

/** Projection: what the months ahead look like. */
export function IconProjection() {
  return (
    <Icon>
      <path d="M3 16.5h14" />
      <path d="M3 13l4-3 3 2 6.5-6" />
      <path d="M13 3.5h4v4" />
    </Icon>
  );
}

/** Chat: asking the system about your own money. */
export function IconChat() {
  return (
    <Icon>
      <path d="M17 11.5a3 3 0 0 1-3 3H8l-4 3v-3a3 3 0 0 1-1-2.25v-5A3 3 0 0 1 6 4.5h8a3 3 0 0 1 3 3Z" />
      <path d="M7 8.5h6" />
      <path d="M7 11h3.5" />
    </Icon>
  );
}

/** Rules: the condition and what it does. */
export function IconRules() {
  return (
    <Icon>
      <circle cx="5" cy="5.5" r="2" />
      <circle cx="15" cy="14.5" r="2" />
      <path d="M5 7.5v4a3 3 0 0 0 3 3h5" />
      <path d="M7.5 5.5H17" />
    </Icon>
  );
}

/** Closing the month: the period sealed. */
export function IconClose() {
  return (
    <Icon>
      <rect x="3" y="5" width="14" height="12" rx="2" />
      <path d="M3 9h14" />
      <path d="m7.5 12.75 1.75 1.75 3.25-3.5" />
    </Icon>
  );
}

/** Export: the figures leaving in a format somebody else reads. */
export function IconExport() {
  return (
    <Icon>
      <path d="M10 12.5v-9" />
      <path d="m6.75 6.75 3.25-3.25 3.25 3.25" />
      <path d="M3.5 12.5v2.5A2 2 0 0 0 5.5 17h9a2 2 0 0 0 2-2v-2.5" />
    </Icon>
  );
}

/** Settings: the household's own choices. */
export function IconSettings() {
  return (
    <Icon>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.75v2M10 15.25v2M17.25 10h-2M5 10H2.75M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9" />
    </Icon>
  );
}

/** Access: who else can see this household. */
export function IconAccess() {
  return (
    <Icon>
      <rect x="4" y="8.5" width="12" height="8" rx="2" />
      <path d="M7 8.5V6.5a3 3 0 0 1 6 0v2" />
      <circle cx="10" cy="12.5" r="1.25" />
    </Icon>
  );
}

/** Tax: the share that was never yours. */
export function IconTax() {
  return (
    <Icon>
      <path d="M5.5 3.5h9a1 1 0 0 1 1 1v12l-2.5-1.5-2 1.5-2-1.5-2 1.5L4.5 16.5v-12a1 1 0 0 1 1-1Z" />
      <path d="M8 7.5h4" />
      <path d="M8 10.5h4" />
    </Icon>
  );
}

/** Notifications: what the product will tell you, and when. */
export function IconNotifications() {
  return (
    <Icon>
      <rect x="3" y="5" width="14" height="10" rx="2" />
      <path d="m3.5 6.5 6.5 4.5 6.5-4.5" />
    </Icon>
  );
}

/** Subscription: what the household pays for this. */
export function IconSubscription() {
  return (
    <Icon>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v8" />
      <path d="M12.25 7.75h-3a1.75 1.75 0 0 0 0 3.5h1.5a1.75 1.75 0 0 1 0 3.5h-3" />
    </Icon>
  );
}

/** Merchants: where the money actually went. */
export function IconMerchants() {
  return (
    <Icon>
      <path d="M4 8h12l-.75 8.5a1 1 0 0 1-1 .9H5.75a1 1 0 0 1-1-.9Z" />
      <path d="M7.25 8V6a2.75 2.75 0 0 1 5.5 0v2" />
    </Icon>
  );
}
