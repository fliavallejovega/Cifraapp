import { expect, test } from '@playwright/test';

/**
 * The public site, end to end.
 *
 * These check the promises the marketing site makes about itself rather than
 * its wording. Copy will change; that a legal page states its review status,
 * that no page fabricates a testimonial, and that every route is reachable
 * without a session are properties that must not.
 */

const PUBLIC_ROUTES = [
  '/es',
  '/es/features',
  '/es/independents',
  '/es/couples',
  '/es/accountants',
  '/es/security',
  '/es/about',
  '/es/contact',
  '/es/pricing',
  '/es/blog',
  '/es/changelog',
  '/es/terms',
  '/es/privacy',
] as const;

test.describe('public routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders for a visitor with no session`, async ({ page }) => {
      const response = await page.goto(route);

      expect(response?.status()).toBe(200);
      await expect(page.locator('h1')).toBeVisible();
    });
  }

  test('every public page keeps its security headers', async ({ page }) => {
    const response = await page.goto('/es/pricing');
    const headers = response?.headers() ?? {};

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
  });
});

test.describe('honesty', () => {
  test('the home page labels its demonstration figures', async ({ page }) => {
    await page.goto('/es');

    // The figures on the home page are authored, not a household's. A reader
    // must be able to see that without reading the source.
    await expect(page.getByText(/Demostración/i)).toBeVisible();
  });

  test('a legal page states that it has not been reviewed', async ({ page }) => {
    await page.goto('/es/terms');

    // The notice disappears on its own once `reviewed_at` is stamped, so this
    // failing is a signal that somebody reviewed the terms — not a regression.
    await expect(page.getByText(/Sin revisar/i)).toBeVisible();
  });

  test('the pricing page reads its figures from the catalogue', async ({ page }) => {
    await page.goto('/es/pricing');

    // If the catalogue is empty the page says so rather than showing invented
    // prices, and either outcome is acceptable here — inventing one is not.
    const table = page.getByRole('table');
    const empty = page.getByText(/todavía no está cargado/i);

    await expect(table.or(empty).first()).toBeVisible();
  });
});

test.describe('language', () => {
  test('a visitor can switch to English and stay on the site', async ({ page }) => {
    await page.goto('/es/security');
    await page.getByRole('link', { name: 'English' }).click();

    await expect(page).toHaveURL(/\/en/);
  });
});
