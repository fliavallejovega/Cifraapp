export type ClassValue = string | number | null | undefined | false | ClassValue[];

/**
 * Joins class names, dropping anything falsy.
 *
 * Deliberately not `clsx` + `tailwind-merge`: conflict resolution only earns its
 * dependency once components accept overriding class props, which is a Phase 1
 * concern. Until then this is the whole job.
 */
export function cn(...values: ClassValue[]): string {
  const classes: string[] = [];

  for (const value of values) {
    if (!value) continue;

    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested) classes.push(nested);
    } else {
      classes.push(String(value));
    }
  }

  return classes.join(' ');
}
