import { expect, test } from '@playwright/test';

/**
 * The import path, end to end, against real Supabase and real R2.
 *
 * The case that matters is the second one: importing the same statement twice
 * must produce nothing the second time. That is the product's central promise,
 * and it is only genuinely proven with a real object store and a real database
 * behind it — a mock would happily agree with whatever the code did.
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

/** A Banco General shaped export: day-first dates, separate debit and credit. */
function statement(marker: string): string {
  return [
    'Fecha,Descripción,Débito,Crédito,Referencia',
    `14/07/2026,SUPER 99 CDE ${marker},72.30,,REF-${marker}-1`,
    `15/07/2026,SALARIO JULIO,,2450.00,REF-${marker}-2`,
    `16/07/2026,"NETFLIX.COM, CA",12.99,,REF-${marker}-3`,
    'basura,LINEA ILEGIBLE,,,',
  ].join('\n');
}

describeSignedIn('importing a statement', () => {
  // Serial: one account, one document hash, one shared household.
  test.describe.configure({ mode: 'serial' });

  const marker = String(Date.now());

  test.beforeEach(async ({ page }) => {
    await page.goto('/es/sign-in');
    await page.getByLabel('Correo').fill(email ?? '');
    await page.getByLabel('Contraseña').fill(password ?? '');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL(/\/es\/(overview|welcome)/, { timeout: 20_000 });
    await page.goto('/es/documents');
  });

  test('reads the statement and reports a checkable summary', async ({ page }) => {
    await page.getByLabel('Archivo del estado de cuenta').setInputFiles({
      name: `estado-${marker}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(statement(marker), 'utf8'),
    });
    await page.getByRole('button', { name: 'Analizar archivo' }).click();

    const status = page.getByRole('status');
    await expect(status).toBeVisible({ timeout: 30_000 });

    // Three readable rows, all new; one line the parser could not read, which
    // is reported rather than silently dropped.
    await expect(status).toContainText('3 found');
    await expect(status).toContainText('3 new');
    await expect(status).toContainText('0 duplicate');
  });

  test('importing the same statement again creates nothing', async ({ page }) => {
    await page.getByLabel('Archivo del estado de cuenta').setInputFiles({
      name: `otro-nombre-${marker}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(statement(marker), 'utf8'),
    });
    await page.getByRole('button', { name: 'Analizar archivo' }).click();

    // A different filename, identical bytes. The content hash catches it before
    // the file is even parsed — a filename is not identity.
    const alert = page.locator('form [role="alert"]');
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText(/ya importaste este mismo archivo/i);
  });

  test('records the run with its provenance', async ({ page }) => {
    const row = page.getByRole('row').filter({ hasText: `estado-${marker}.csv` });

    await expect(row).toBeVisible();
    // The file the figures came from stays visible, so any number can be traced
    // back to its source.
    await expect(row).toContainText('3');
  });

  test('refuses a format it cannot read, naming the recovery', async ({ page }) => {
    await page.getByLabel('Archivo del estado de cuenta').setInputFiles({
      name: 'extracto.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('esto no es un estado de cuenta', 'utf8'),
    });
    await page.getByRole('button', { name: 'Analizar archivo' }).click();

    const alert = page.locator('form [role="alert"]');
    await expect(alert).toBeVisible({ timeout: 30_000 });
    // Names what to do, not which rule was broken.
    await expect(alert).toContainText(/CSV|OFX/i);
  });
});
