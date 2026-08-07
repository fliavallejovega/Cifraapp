import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Append-only record of who did what. Kept in its own schema so that a mistake
 * in an application grant can never hand out the ability to rewrite history.
 */
export const auditSchema = pgSchema('audit');
