import { expect, test } from '@playwright/test';

/**
 * The authenticated path, end to end, against the real Supabase project.
 *
 * Skipped unless `E2E_EMAIL` and `E2E_PASSWORD` name a confirmed account. These
 * cases sign in for real — there is no mock — because the parts that break in
 * production are session cookies, the proxy refresh and the route guards, and
 * none of those exist in a mock.
 */

const email = process.env['E2E_EMAIL'];
const password = process.env['E2E_PASSWORD'];
// Wrapped rather than aliased: `test.describe.skip` detached from `test.describe`
// loses its `this`, which the lint rule correctly objects to.
const describeSignedIn = (title: string, body: () => void): void => {
  if (email && password) {
    test.describe(title, body);
  } else {
    test.describe.skip(title, body);
  }
};

if (!email || !password) {
  console.warn('E2E_EMAIL / E2E_PASSWORD not set — skipping authenticated end-to-end tests.');
}

test.describe('guards', () => {
  test('a signed-out visitor cannot reach the product', async ({ page }) => {
    const response = await page.goto('/es/overview');

    // The redirect carries the destination, so the user lands where they were
    // going rather than on a generic page they have to navigate away from.
    await expect(page).toHaveURL(/\/es\/sign-in\?next=%2Foverview/);
    expect(response?.status()).toBe(200);
  });

  test('the landing page states the offer and exposes one action', async ({ page }) => {
    await page.goto('/es');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('sistema');
    // `first()` because the page repeats its call to action at the close.
    // `foundation.spec.ts` asserts that every repetition leads to one place.
    await expect(page.getByRole('link', { name: /Crear mi sistema/i }).first()).toBeVisible();
  });

  test('a recovery link is caught wherever the provider drops it', async ({ page }) => {
    // The failure this exists for: a reset email points at the site root and
    // carries its tokens in the URL fragment, which never reaches a server. The
    // page rendered as though nobody had arrived and the person was stranded on
    // marketing holding a valid token.
    //
    // An expired link is used here because it needs no live token and exercises
    // the same path: recognise the fragment, leave the page, land on the form.
    await page.goto('/es#error=access_denied&error_code=otp_expired&type=recovery');

    await expect(page).toHaveURL(/\/es\/reset-password/);
    await expect(page.getByText(/Ese enlace ya no sirve/i)).toBeVisible();

    // And the token never survives into history, whatever it was.
    expect(page.url()).not.toContain('access_token');
  });

  test('a recovery link reaches the reset form from any page', async ({ page }) => {
    await page.goto('/es/sign-in#error=access_denied&error_code=otp_expired&type=recovery');

    await expect(page).toHaveURL(/\/es\/reset-password/);
  });

  test('the reset page turns nobody away without a link', async ({ page }) => {
    await page.goto('/es/reset-password');

    // No session, no fragment: it says the link is spent and offers another,
    // rather than showing a password field that cannot work.
    await expect(page.getByText(/Pedir otro enlace/i)).toBeVisible();
  });

  test('password recovery can be reached from sign in', async ({ page }) => {
    await page.goto('/es/sign-in');
    await page.getByRole('link', { name: /Olvidaste tu contraseña/i }).click();

    await expect(page).toHaveURL(/\/es\/forgot-password/);
    await expect(page.getByRole('button', { name: /Enviar el enlace/i })).toBeVisible();
  });

  test('the sign-in form is reachable and labelled', async ({ page }) => {
    await page.goto('/es/sign-in');

    await expect(page.getByLabel('Correo')).toBeVisible();
    await expect(page.getByLabel('Contraseña')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });

  test('a wrong password says so without revealing whether the account exists', async ({
    page,
  }) => {
    await page.goto('/es/sign-in');
    await page.getByLabel('Correo').fill('nobody@example.test');
    await page.getByLabel('Contraseña').fill('wrong-password-here');
    await page.getByRole('button', { name: 'Entrar' }).click();

    // Scoped to the form: Next's route announcer is also role="alert", and an
    // unscoped query matches both.
    const alert = page.locator('form [role="alert"]');
    await expect(alert).toBeVisible();
    // Identical whether the address is unknown or the password is wrong.
    await expect(alert).toContainText(/no coinciden/i);
  });
});

describeSignedIn('signed in', () => {
  // Serial: these share one account, and parallel workers signing in as the
  // same user race each other through onboarding.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/es/sign-in');
    await page.getByLabel('Correo').fill(email ?? '');
    await page.getByLabel('Contraseña').fill(password ?? '');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL(/\/es\/(overview|welcome)/, { timeout: 20_000 });
  });

  test('lands on the household or on onboarding, never on an empty dashboard', async ({ page }) => {
    // Asserted on what rendered rather than on the URL: `/overview` redirects to
    // `/welcome` when there is no household, so a URL read can catch the
    // intermediate hop and describe a page that no longer exists.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /Tu posición|Empecemos por tu hogar/,
    );
  });

  test('the sign-in page redirects a signed-in user away', async ({ page }) => {
    await page.goto('/es/sign-in');
    // To the position screen, or to onboarding when there is no household yet.
    // Either way, not to a form they have already completed.
    await expect(page).toHaveURL(/\/es\/(overview|welcome)/);
  });

  test('creates a household and reaches the position screen', async ({ page }) => {
    // Navigated explicitly rather than inferred from the post-sign-in URL:
    // `/overview` bounces to `/welcome` when there is no household, and reading
    // the URL can catch the intermediate hop. `/welcome` itself bounces back to
    // `/overview` once a household exists, so this is safe either way.
    await page.goto('/es/welcome');

    if (page.url().includes('/welcome')) {
      await page.getByLabel('Nombre del hogar').fill('Hogar de prueba');
      await page.getByRole('button', { name: 'Crear hogar' }).click();
    }

    await page.waitForURL(/\/es\/overview/, { timeout: 30_000 });

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu posición');

    // A household with no accounts gets an empty state that teaches, never a
    // demonstration that would imply data the user does not have.
    await expect(
      page.getByText(/Dale a tu dinero un lugar donde vivir|Disponible para gastar/i).first(),
    ).toBeVisible();
  });

  test('signing out returns the user to sign-in and re-locks the product', async ({ page }) => {
    await page.goto('/es/overview');
    await page.getByRole('button', { name: 'Salir' }).click();
    await page.waitForURL(/\/es\/sign-in/, { timeout: 20_000 });

    await page.goto('/es/overview');
    await expect(page).toHaveURL(/\/es\/sign-in/);
  });
});
