import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const baseURL = `http://127.0.0.1:${String(PORT)}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  // Serialized in CI so a shared database is not raced; left to Playwright's
  // own heuristic locally. Spread rather than `undefined`, which
  // `exactOptionalPropertyTypes` correctly rejects as a distinct value.
  ...(process.env['CI'] ? { workers: 1 } : {}),
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Mobile is a first-class target, not a later adaptation (spec §63).
    { name: 'mobile', use: { ...devices['iPhone 14'] } },
  ],

  webServer: {
    // Tests run against a production build: dev-mode timing, error overlays and
    // unminified bundles hide the failures that only appear in what ships.
    command: `pnpm build && pnpm start --port ${String(PORT)}`,
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    env: {
      SKIP_ENV_VALIDATION: 'true',
    },
  },
});
