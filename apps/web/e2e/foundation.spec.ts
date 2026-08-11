import { expect, test } from '@playwright/test';

/**
 * Phase 0 end-to-end coverage.
 *
 * These assert the foundation, not the product: locale negotiation resolves,
 * both language routes render their own copy, the health endpoint answers, and
 * the security headers the config declares actually reach the browser.
 */

test.describe('locale negotiation', () => {
  test('a Spanish-speaking visitor lands on the Spanish route', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'es-PA' });
    const page = await context.newPage();

    await page.goto('/');
    await expect(page).toHaveURL(/\/es(\/|$)/);

    await context.close();
  });

  test('an English-speaking visitor lands on the English route', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();

    await page.goto('/');
    await expect(page).toHaveURL(/\/en(\/|$)/);

    await context.close();
  });

  test('a visitor with an unsupported language falls back to Spanish', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();

    await page.goto('/');
    await expect(page).toHaveURL(/\/es(\/|$)/);

    await context.close();
  });
});

test('the Spanish route renders Spanish copy', async ({ page }) => {
  await page.goto('/es');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('sistema financiero');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

test('the English route renders English copy', async ({ page }) => {
  await page.goto('/en');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('financial system');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('the language switch moves between locales', async ({ page }) => {
  await page.goto('/es');
  await page.getByRole('link', { name: 'English' }).click();

  await expect(page).toHaveURL(/\/en(\/|$)/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('financial system');
});

test('an unknown locale is a 404, not a silent fallback', async ({ page }) => {
  const response = await page.goto('/fr');
  expect(response?.status()).toBe(404);
});

test('the health endpoint reports component status', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    status: string;
    checks: Record<string, { status: string }>;
  };

  expect(['ok', 'degraded']).toContain(body.status);
  expect(body.checks['application']?.status).toBe('ok');
});

test('health responses are never cached', async ({ request }) => {
  // A cached health check reports the state of a past deployment, which is
  // worse than no health check at all.
  const response = await request.get('/api/health');
  expect(response.headers()['cache-control']).toContain('no-store');
});

test('security headers reach the browser', async ({ page }) => {
  const response = await page.goto('/es');
  const headers = response?.headers() ?? {};

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-powered-by']).toBeUndefined();
});

// Desktop only. Safari does not move focus to links on Tab unless the user has
// turned on Full Keyboard Access, so asserting it under WebKit would test the
// browser's default setting rather than the page's focus order.
test('the interface is reachable by keyboard', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'WebKit gates link tabbing behind a system setting',
  );

  await page.goto('/es');
  await page.keyboard.press('Tab');

  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(focused).toBe('A');
});

test('the focused element shows a visible focus ring', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'WebKit gates link tabbing behind a system setting',
  );

  await page.goto('/es');
  await page.keyboard.press('Tab');

  const outlineWidth = await page.evaluate(() => {
    const element = document.activeElement;
    return element ? getComputedStyle(element).outlineWidth : '0px';
  });

  // A keystroke in this product can eventually move money; the user must always
  // be able to see what they are about to activate (spec §64).
  expect(outlineWidth).not.toBe('0px');
});

test('the page never scrolls horizontally', async ({ page }) => {
  // A financial table is the easiest thing in this product to overflow, and a
  // horizontally scrolling body is how a mobile user loses the amount column.
  await page.goto('/es');

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test('the landing page offers one action, however many times it asks', async ({ page }) => {
  // The marketing page repeats its call to action — once in the hero, once at
  // the close — which is ordinary and intended. The property that matters is
  // that every primary action leads to the *same* place: a visitor deciding
  // whether to trust a financial product should never be choosing between
  // competing offers.
  await page.goto('/es');

  const actions = page.getByRole('link', { name: /Crear mi sistema/i });
  await expect(actions.first()).toBeVisible();

  const destinations = await actions.evaluateAll((links) =>
    [...new Set(links.map((link) => (link as HTMLAnchorElement).getAttribute('href')))].sort(),
  );

  expect(destinations).toEqual(['/es/sign-up']);
});
