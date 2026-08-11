import { describe, expect, it } from 'vitest';

import { resolveFlag, type FlagOverride } from './flag-resolution';

const CONTEXT = { userId: 'u1', householdId: 'h1', organizationId: 'o1' };

describe('feature flag resolution', () => {
  it('falls to the default when nothing overrides it', () => {
    expect(resolveFlag(false, [], CONTEXT)).toBe(false);
    expect(resolveFlag(true, [], CONTEXT)).toBe(true);
  });

  it('lets a global override beat the default', () => {
    const overrides: FlagOverride[] = [{ scope: 'global', targetId: null, enabled: true }];
    expect(resolveFlag(false, overrides, CONTEXT)).toBe(true);
  });

  it('lets one household differ from the platform', () => {
    // The point of the feature: reproduce a bug for one household without
    // switching anything on for everyone.
    const overrides: FlagOverride[] = [
      { scope: 'global', targetId: null, enabled: false },
      { scope: 'household', targetId: 'h1', enabled: true },
    ];

    expect(resolveFlag(false, overrides, CONTEXT)).toBe(true);
    expect(resolveFlag(false, overrides, { ...CONTEXT, householdId: 'h2' })).toBe(false);
  });

  it('lets a user override beat their household', () => {
    const overrides: FlagOverride[] = [
      { scope: 'household', targetId: 'h1', enabled: true },
      { scope: 'user', targetId: 'u1', enabled: false },
    ];

    expect(resolveFlag(true, overrides, CONTEXT)).toBe(false);
  });

  it('lets an organization cover its households', () => {
    const overrides: FlagOverride[] = [{ scope: 'organization', targetId: 'o1', enabled: true }];
    expect(resolveFlag(false, overrides, CONTEXT)).toBe(true);
  });

  it('can switch something off for one household that an organization turned on', () => {
    const overrides: FlagOverride[] = [
      { scope: 'organization', targetId: 'o1', enabled: true },
      { scope: 'household', targetId: 'h1', enabled: false },
    ];

    expect(resolveFlag(false, overrides, CONTEXT)).toBe(false);
  });

  it('ignores a scope the caller has no identity for', () => {
    const overrides: FlagOverride[] = [
      { scope: 'household', targetId: 'h1', enabled: true },
      { scope: 'global', targetId: null, enabled: false },
    ];

    // A request with no household is not a request whose household override is
    // merely absent — the scope cannot match at all.
    expect(resolveFlag(true, overrides, { userId: null, householdId: null })).toBe(false);
  });

  it('respects an explicit off at a more specific scope during an incident', () => {
    const overrides: FlagOverride[] = [
      { scope: 'global', targetId: null, enabled: true },
      { scope: 'user', targetId: 'u1', enabled: false },
    ];

    expect(resolveFlag(true, overrides, CONTEXT)).toBe(false);
  });
});
