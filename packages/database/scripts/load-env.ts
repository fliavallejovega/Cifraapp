import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads `.env.local` from the repository root before anything reads
 * configuration.
 *
 * Imported for its side effect, and imported first — the env module memoizes on
 * first access, so a later load would be ignored. Values already present in the
 * environment win, which is what lets CI and one-off overrides work.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = resolve(repoRoot, '.env.local');

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
