import { expect, test } from '@playwright/test';

/**
 * Viajes, end to end, against the real database: plan a trip through the
 * wizard, see its per diem and its money errands, then archive it.
 *
 * Signed in as the E2E account, whose household must have `trips_module` on.
 * Skipped without credentials, like the other signed-in suites.
 */

const email = process.env['E2E_EMAIL'];
const password = process.env['E2E_PASSWORD'];

const describeSignedIn = (title: string, body: () => void): void => {
  if (email && password) {
    test.describe(title, body);
  } else {
    test.describe.skip(title, body);
  }
};

const inDays = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describeSignedIn('planning a trip', () => {
  test.describe.configure({ mode: 'serial' });
  // A production build against a remote database: each step is a round trip.
  test.setTimeout(120_000);
  const name = `E2E Madrid ${String(Date.now())}`;

  test.beforeEach(async ({ page }) => {
    await page.goto('/es/sign-in');
    await page.getByLabel('Correo').fill(email ?? '');
    await page.getByLabel('Contraseña').fill(password ?? '');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL(/\/es\/(overview|welcome)/, { timeout: 20_000 });
  });

  test('creates a trip with its per diem and its money errands, then archives it', async ({
    page,
  }) => {
    await page.goto('/es/trips/new');
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.reload();

    await page.getByLabel('Ciudad').first().fill('Madrid');
    await page.getByLabel('Llegada').first().fill(inDays(40));
    await page.getByLabel('Salida').first().fill(inDays(46));
    await page.getByRole('button', { name: 'Continuar: viajeros' }).first().click();
    await page.getByRole('button', { name: 'Continuar: lo comprado' }).first().click();
    await page.getByRole('button', { name: 'Continuar: el dinero' }).first().click();
    await page.getByLabel(/Fondo total del viaje/).fill('2500');
    await page.getByRole('button', { name: 'Continuar: el estilo' }).first().click();
    await page.getByRole('button', { name: 'Ver mi plan' }).first().click();
    await page.getByLabel('Nombre del viaje').fill(name);
    const goal = page.getByLabel('Ahorrar para este viaje');
    if (await goal.isChecked()) await goal.uncheck();
    await page.getByRole('button', { name: 'Crear el viaje' }).click();

    await page.waitForURL(/\/es\/trips\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('Por día pueden gastar')).toBeVisible();
    // A trip abroad brings its money errands without anyone typing them.
    await expect(page.getByText('Avisar al banco que van a viajar')).toBeVisible();
    await expect(page.getByText('Sacar efectivo en moneda local')).toBeVisible();

    await page.getByText('Ajustar el viaje').click();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Archivar el viaje' }).click();
    await page.waitForURL(/\/es\/trips$/, { timeout: 30_000 });
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
