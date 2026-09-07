import type { ReactNode } from 'react';

/**
 * The product's icon set. One style — outline, 1.5px stroke, 20-unit grid —
 * drawn here rather than pulled from a package, so the set can never drift
 * into mixed families.
 *
 * Five destinations, five icons, each chosen for what the screen answers:
 * a gauge for the position, a vault card for accounts, a tray for import, a
 * compass for the plan (the product is called Norte for a reason), columns for
 * the statements.
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

/** The monogram: the brand mark, drawn once and reused everywhere. */
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
      <path d="M11 23.5v-13h2.4l7.2 8.9v-8.9H23v13h-2.4l-7.2-8.9v8.9z" fill="var(--color-brand)" />
    </svg>
  );
}
