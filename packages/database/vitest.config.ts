import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Loads `.env.local` from the repository root so the integration and RLS suites
 * find a database without every command needing an inline connection string.
 * Absent, those suites skip and say so.
 */
function loadLocalEnv(): Record<string, string> {
  const path = resolve(import.meta.dirname, '../../.env.local');
  if (!existsSync(path)) return {};

  const entries: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    entries[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return entries;
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: loadLocalEnv(),
    // The RLS suite mutates shared rows; concurrent files would race.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
