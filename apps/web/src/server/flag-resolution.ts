/**
 * Feature flags, resolved most-specific-first.
 *
 * The ordering is the whole feature: switching something on for one household to
 * reproduce a bug must not switch it on for everyone, and switching it off
 * globally during an incident must not require deleting anyone's override.
 *
 * `user` beats `household` beats `organization` beats `global` beats the flag's
 * default. A flag with no override anywhere falls to its default, and every
 * default in this system is `false` — a flag that defaults on is not a flag, it
 * is a release.
 *
 * Pure and separate from the module that reads the database, so the precedence
 * rules can be tested without one.
 */

export type FlagScope = 'global' | 'organization' | 'household' | 'user';

export interface FlagOverride {
  readonly scope: FlagScope;
  readonly targetId: string | null;
  readonly enabled: boolean;
}

export interface FlagContext {
  readonly userId?: string | null;
  readonly householdId?: string | null;
  readonly organizationId?: string | null;
}

/** Most specific first. The first scope that matches decides. */
const PRECEDENCE: readonly FlagScope[] = ['user', 'household', 'organization', 'global'];

export function resolveFlag(
  defaultEnabled: boolean,
  overrides: readonly FlagOverride[],
  context: FlagContext,
): boolean {
  for (const scope of PRECEDENCE) {
    const target = targetFor(scope, context);
    // A scope the caller has no identity for cannot match. Falling through is
    // correct: a request with no household is not a request whose household
    // override happens to be absent.
    if (scope !== 'global' && !target) continue;

    const match = overrides.find(
      (override) => override.scope === scope && override.targetId === target,
    );

    if (match) return match.enabled;
  }

  return defaultEnabled;
}

function targetFor(scope: FlagScope, context: FlagContext): string | null {
  switch (scope) {
    case 'user':
      return context.userId ?? null;
    case 'household':
      return context.householdId ?? null;
    case 'organization':
      return context.organizationId ?? null;
    case 'global':
      return null;
  }
}
