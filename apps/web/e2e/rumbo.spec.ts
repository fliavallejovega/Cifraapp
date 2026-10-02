import { expect, test } from '@playwright/test';

/**
 * Rumbo end to end, against the real database: the reference trip seeded with
 * `pnpm db:seed:rumbo` is armed through the assistant and comes out with the
 * acceptance figures on the screen.
 *
 * Needs the E2E account (with `trips_module` on) and `RUMBO_E2E_TRIP`, the id
 * the seed prints. Skipped without them, like the other signed-in suites.
 */

const email = process.env['E2E_EMAIL'];
const password = process.env['E2E_PASSWORD'];
const trip = process.env['RUMBO_E2E_TRIP'];

const describeSignedIn = (title: string, body: () => void): void => {
  if (email && password && trip) {
    test.describe(title, body);
  } else {
    test.describe.skip(title, body);
  }
};

describeSignedIn('arming the Venice → Copenhagen trip', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/es/sign-in');
    await page.getByLabel('Correo').fill(email ?? '');
    await page.getByLabel('Contraseña').fill(password ?? '');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL(/\/es\/(overview|welcome)/, { timeout: 20_000 });
  });

  test('the assistant composes it and the route shows the acceptance figures', async ({ page }) => {
    await page.goto(`/es/trips/${trip ?? ''}/route/setup`);
    await expect(page.getByRole('heading', { name: '¿Quiénes viajan?' })).toBeVisible();
    for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByRole('button', { name: /rmar el viaje/ }).click();
    await page.waitForURL(/\/route$/, { timeout: 60_000 });

    await expect(page.getByText(/19 días · 17 noches con hospedaje/)).toBeVisible();
    await expect(page.getByText(/en 10 días/)).toBeVisible();
    await expect(page.getByText(/se quitaron Verona, Como/)).toBeVisible();
  });

  test('visas and bookings list what the trip needs', async ({ page }) => {
    await page.goto(`/es/trips/${trip ?? ''}/route?tab=entry`);
    await expect(page.getByText('Nadie necesita visa para este viaje.')).toBeVisible();
    await expect(page.getByText('16 de 90 días en 180').first()).toBeVisible();
    await expect(page.getByText('Viñeta digital de Austria (10 días)')).toBeVisible();
    await expect(page.getByText('E-vignette de Suiza')).toBeVisible();
    await expect(page.getByText('Ferry Puttgarden–Rødby')).toBeVisible();
    await expect(page.getByText(/Boletos: Weihnachtsmarkt Ravennaschlucht/)).toBeVisible();
    await expect(page.getByText(/Transfer de madrugada en Estambul/)).toBeVisible();
  });

  test('a price typed for a stop moves «Mi plan» at once', async ({ page }) => {
    await page.goto(`/es/trips/${trip ?? ''}/route?tab=stay`);
    const first = page.getByLabel('Mi precio (total de la estadía)').first();
    await first.fill('120');
    await expect(page.getByText(/1 de \d+ paradas con su precio/)).toBeVisible();
    await first.fill('');
  });
});
