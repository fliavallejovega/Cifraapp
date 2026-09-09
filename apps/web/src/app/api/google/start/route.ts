import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getServerEnv } from '@app/validation/env';

import { authorizationUrl, googleIsConfigured, type GoogleCapability } from '@/server/google/config';
import { loadSession } from '@/server/session';

/**
 * Empieza el consentimiento de Google.
 *
 * El `state` es lo único que protege este flujo: sin él, cualquiera puede hacer
 * que la víctima complete un consentimiento hacia **su** cuenta de Google, y la
 * casa acaba con el buzón de un desconocido conectado. Se genera aquí, se guarda
 * en una cookie de sesión —`httpOnly`, `sameSite=lax`, porque la vuelta de
 * Google es una navegación de arriba— y la respuesta se compara con ella.
 *
 * La cookie lleva también qué se pidió y para qué hogar, porque la vuelta de
 * Google no trae ninguna de las dos cosas y confiar en la sesión activa dejaría
 * la conexión en el hogar equivocado si alguien cambió de hogar en otra pestaña
 * mientras daba el consentimiento.
 */

export const dynamic = 'force-dynamic';

export const STATE_COOKIE = 'cifraapp_google_state';

export async function GET(request: Request): Promise<Response> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });
  }

  if (!googleIsConfigured()) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const url = new URL(request.url);
  const asked = url.searchParams.getAll('capability');
  const capabilities: GoogleCapability[] = [
    ...(asked.includes('mail') ? (['mail'] as const) : []),
    ...(asked.includes('calendar') ? (['calendar'] as const) : []),
  ];

  if (capabilities.length === 0) {
    return NextResponse.json({ error: 'no_capability' }, { status: 400 });
  }

  const state = randomBytes(32).toString('base64url');
  const locale = url.searchParams.get('locale') ?? 'es';

  const store = await cookies();
  store.set(STATE_COOKIE, JSON.stringify({ state, householdId: session.activeHouseholdId, locale }), {
    httpOnly: true,
    sameSite: 'lax',
    // Sólo por HTTPS fuera de desarrollo. En local no hay TLS y la cookie
    // nunca llegaría, que es un fallo de consentimiento imposible de leer.
    secure: getServerEnv().APP_ENV !== 'development',
    path: '/',
    // Diez minutos. Un consentimiento que tarda más que eso es uno que alguien
    // dejó abierto, y su `state` no debe seguir siendo válido mañana.
    maxAge: 600,
  });

  return NextResponse.redirect(authorizationUrl(state, capabilities));
}
