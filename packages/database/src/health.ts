import type { Database } from './client.js';
import { schemaVersion } from './schema/platform.js';

export interface SchemaVersion {
  readonly version: number;
  readonly description: string;
  readonly appliedAt: Date;
}

/**
 * Reads the applied schema generation.
 *
 * This is the cheapest query that proves the whole chain works: credentials
 * resolve, the pooler accepts the connection, the migrations ran, and the
 * application and the database agree on which schema they are talking about.
 * The health endpoint reports it so a deployment mismatch is visible before a
 * user finds it.
 */
export async function getSchemaVersion(db: Database): Promise<SchemaVersion | null> {
  const rows = await db
    .select({
      version: schemaVersion.version,
      description: schemaVersion.description,
      appliedAt: schemaVersion.appliedAt,
    })
    .from(schemaVersion)
    .limit(1);

  return rows[0] ?? null;
}
