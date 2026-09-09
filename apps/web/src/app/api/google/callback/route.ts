import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getClientEnv } from '@app/validation/env';

import { EMAIL_SCOPE } from '@/server/google/config';
import { saveConnection } from '@/server/google/connection';
import { exchangeCode, sameSecret } from '@/server/google/tokens';
import { loadSession } from '@/server/session';
import { STATE_COOKIE } from '../start/route';

/**
 * La vuelta del consentimiento de Google.
 *
 * Todo lo que puede salir mal se responde igual hacia el usuario: se vuelve a
 * Ajustes con un motivo corto en la dirección. Un error de OAuth pintado en una
 * pantalla en blanco deja a alguien sin saber si conectó o no, y lo que hace
 * entonces es volver a intentarlo hasta que algo se duplica.
 *
 * El código se cambia por tokens **aquí**, en el servidor. El secreto de la
 * aplicación no aparece en ninguna respuesta y el refresh token no llega nunca
 * al navegador: se cifra y se guarda antes de que esta función devuelva.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const store = await cookies();
  const raw = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);

  const settings = (locale: string, outcome: string): string =>
    new URL(`/${locale}/settings?google=${outcome}`, getClientEnv().NEXT_PUBLIC_APP_URL).toString();

  const intent = readIntent(raw);

  const locale = intent?.locale ?? 'es';

  if (!intent) return NextResponse.redirect(settings(locale, 'expired'));

  // La persona pulsó «Cancelar» en la pantalla de Google. No es un error.
  const denied = url.searchParams.get('error');
  if (denied) return NextResponse.redirect(settings(locale, 'cancelled'));

  const state = url.searchParams.get('state') ?? '';
  if (!sameSecret(state, intent.state)) {
    return NextResponse.redirect(settings(locale, 'state_mismatch'));
  }

  const session = await loadSession();
  // El hogar es el que se guardó al empezar, no el activo ahora: cambiar de
  // hogar en otra pestaña mientras se consiente dejaría la conexión en el sitio
  // equivocado. Y tiene que seguir siendo un hogar de esta persona.
  if (!session?.households.some((one) => one.id === intent.householdId)) {
    return NextResponse.redirect(settings(locale, 'sign_in_required'));
  }

  const code = url.searchParams.get('code');
  if (!code) return NextResponse.redirect(settings(locale, 'no_code'));

  const granted = await exchangeCode(code);
  if (!granted.ok) return NextResponse.redirect(settings(locale, 'exchange_failed'));

  if (!granted.value.refreshToken) {
    // Sin refresh token la conexión moriría en una hora sin forma de renovarse.
    // Pasa cuando Google reconoce un consentimiento previo; `prompt=consent` en
    // la ida existe justamente para evitarlo, y si aun así falta, es mejor no
    // guardar nada que guardar algo que deja de funcionar solo.
    return NextResponse.redirect(settings(locale, 'no_refresh_token'));
  }

  const email = await readEmail(granted.value.accessToken);
  if (!email) return NextResponse.redirect(settings(locale, 'no_email'));

  await saveConnection({
    householdId: intent.householdId,
    userId: session.profile.id,
    googleEmail: email,
    refreshToken: granted.value.refreshToken,
    scopes: granted.value.scopes,
  });

  return NextResponse.redirect(settings(locale, 'connected'));
}

/**
 * Con qué cuenta se conectó.
 *
 * Se pregunta en vez de deducirlo del correo de la sesión: la persona puede
 * conectar una cuenta de Google distinta de la que usa para entrar, y enseñar
 * la equivocada haría imposible saber cuál desconectar.
 */
async function readEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { email?: unknown };
    return typeof body.email === 'string' ? body.email : null;
  } catch {
    return null;
  }
}

// Referenciado para que quede claro que este alcance es el que hace legible el
// correo de la cuenta; sin él, `readEmail` devolvería 403 y la conexión no se
// guardaría con nombre.
void EMAIL_SCOPE;

/**
 * Lee la cookie de intención, o devuelve nulo.
 *
 * Nulo cubre a la vez la cookie ausente, la caducada y la manipulada. Las tres
 * llevan al mismo sitio —volver a empezar— y distinguirlas hacia fuera sólo le
 * diría a quien la manipula qué tan cerca estuvo.
 */
function readIntent(raw: string | undefined): {
  state: string;
  householdId: string;
  locale: string;
} | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { state, householdId, locale } = parsed as Record<string, unknown>;
    if (typeof state !== 'string' || typeof householdId !== 'string') return null;
    return { state, householdId, locale: typeof locale === 'string' ? locale : 'es' };
  } catch {
    return null;
  }
}
