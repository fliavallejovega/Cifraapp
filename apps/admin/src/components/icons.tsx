/**
 * One icon set, outline, 1.5px, drawn here.
 *
 * The product's rule, and it applies to the console for the same reason: a
 * mixed icon family is the fastest way to make a considered interface look
 * assembled from parts.
 */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Frame({ children }: { readonly children: React.ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden {...stroke}>
      {children}
    </svg>
  );
}

/** The business at a glance. */
export function IconOverview() {
  return (
    <Frame>
      <path d="M3 15.5h14" />
      <path d="M5.5 15.5V9M9.5 15.5V5M13.5 15.5v-4.5M17 15.5V7" />
    </Frame>
  );
}

/** Money in. */
export function IconRevenue() {
  return (
    <Frame>
      <path d="M3 13.5 7.5 8l3.5 3.5L17 5" />
      <path d="M13 5h4v4" />
      <path d="M3 17h14" />
    </Frame>
  );
}

/** The customers. */
export function IconHouseholds() {
  return (
    <Frame>
      <path d="M3 9.5 10 4l7 5.5" />
      <path d="M5 9v7.5h10V9" />
      <path d="M8.5 16.5v-4h3v4" />
    </Frame>
  );
}

/** What the product is being used for. */
export function IconUsage() {
  return (
    <Frame>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3.5v6.5l4.5 2.5" />
    </Frame>
  );
}

/** The queue, the schema, the things that break at night. */
export function IconOperations() {
  return (
    <Frame>
      <path d="M4 6h12M4 10h12M4 14h7" />
      <circle cx="15" cy="14" r="2.2" />
    </Frame>
  );
}

/** Switches. */
export function IconFlags() {
  return (
    <Frame>
      <path d="M5 3.5v13" />
      <path d="M5 4.5h9l-2 3 2 3H5" />
    </Frame>
  );
}

/** What the product writes to people. */
export function IconEmails() {
  return (
    <Frame>
      <rect x="3" y="5" width="14" height="10.5" rx="1.5" />
      <path d="m3.5 6 6.5 5 6.5-5" />
    </Frame>
  );
}

/** The way out. */
export function IconSignOut() {
  return (
    <Frame>
      <path d="M8 4.5H5.5A1.5 1.5 0 0 0 4 6v8a1.5 1.5 0 0 0 1.5 1.5H8" />
      <path d="M12 13.5 15.5 10 12 6.5" />
      <path d="M15 10H8" />
    </Frame>
  );
}

/**
 * The wordmark's mark. Brass on ink, as everywhere else: a rule crossing a
 * measure, which is what this product does to a balance.
 */
export function Monogram({ size = 32 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden>
      <rect
        x="0.75"
        y="0.75"
        width="32.5"
        height="32.5"
        rx="8"
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="1.5"
      />
      <path d="M9 22.5h16" stroke="var(--color-brand)" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M12 22.5V13M17 22.5V9M22 22.5v-6"
        stroke="var(--color-panel-ink)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
