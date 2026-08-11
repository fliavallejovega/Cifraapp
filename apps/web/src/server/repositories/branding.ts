import 'server-only';

import { sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * The firm a household belongs to, if any.
 *
 * Resolved per household rather than per domain. A custom domain is how a client
 * arrives; it is not what decides whose branding they see — a person with
 * households under two different firms would otherwise get whichever domain they
 * happened to type, which is exactly the kind of confusion a white-label product
 * cannot afford.
 *
 * The read goes through a `security definer` function that returns presentation
 * fields only. A household can render its firm's name and logo without being
 * able to read the firm's row, which carries a support address, a domain and a
 * default plan that are the firm's business and not its clients'.
 */

export interface Branding {
  readonly displayName: string;
  readonly primaryColor: string | null;
  readonly logoAssetId: string | null;
  readonly supportEmail: string | null;
  readonly termsUrl: string | null;
  readonly privacyUrl: string | null;
}

/** The function's row shape, in the snake_case Postgres returns it in. */
interface BrandingRow extends Record<string, unknown> {
  display_name: string;
  primary_color: string | null;
  logo_asset_id: string | null;
  support_email: string | null;
  terms_url: string | null;
  privacy_url: string | null;
}

export async function loadBranding(
  session: Session,
  householdId: string,
): Promise<Branding | null> {
  const rows = await queryAsUser(session, (tx) =>
    tx.execute<BrandingRow>(sql`select * from app.branding_for_household(${householdId})`),
  );

  const row = rows[0];
  if (!row) return null;

  return {
    displayName: row.display_name,
    primaryColor: row.primary_color,
    logoAssetId: row.logo_asset_id,
    supportEmail: row.support_email,
    termsUrl: row.terms_url,
    privacyUrl: row.privacy_url,
  };
}

/**
 * The branding as CSS custom properties.
 *
 * Exactly one token is overridable. The design system carries meaning in its
 * neutrals and reserves a single signal colour for a crossed threshold; handing
 * a firm a whole palette would let them make a shortfall look like a suggestion
 * (DESIGN.md).
 */
export function brandingStyle(branding: Branding | null): Record<string, string> {
  if (!branding?.primaryColor) return {};
  return { '--color-signal': branding.primaryColor };
}
