export {
  closeConnections,
  getAdminDb,
  getDb,
  withUserContext,
  type Database,
  type UserContext,
} from './client.js';

export * as schema from './schema/index.js';

export { getSchemaVersion, type SchemaVersion } from './health.js';
