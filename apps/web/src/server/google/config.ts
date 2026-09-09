import 'server-only';

import { getClientEnv, getServerEnv } from '@app/validation/env';

/**
 * La conexión con Google, y qué se le pide exactamente.
 *
 * Dos funciones independientes viven detrás de la misma cuenta, y se piden por
 * separado a propósito:
 *
 *   * **Leer los avisos del banco.** `gmail.readonly` es un *restricted scope*:
 *     Google exige verificación de la aplicación y una evaluación de seguridad
 *     anual por un tercero antes de que un despliegue lo use con usuarios que no
 *     sean de prueba. Eso no es un detalle de configuración, es un calendario y
 *     un costo, y está escrito aquí para que quien despliegue lo lea antes de
 *     prometerle la función a nadie. Mientras la aplicación esté sin verificar:
 *     cien usuarios de prueba y tokens que caducan cada siete días.
 *
 *   * **Escribir el calendario.** `calendar` es *sensitive*, no restricted: pide
 *     verificación pero no evaluación de seguridad. Es notablemente más barato
 *     de llegar a producción, y por eso el producto no obliga a dar los dos.
 *
 * Una casa puede conectar sólo el calendario y no el correo. La pantalla lo
 * ofrece así, y el barrido de correo simplemente no encuentra conexiones con ese
 * alcance.
 */

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export type GoogleCapability = 'mail' | 'calendar';

export function scopesFor(capabilities: readonly GoogleCapability[]): string[] {
  const scopes = new Set<string>([EMAIL_SCOPE]);
  if (capabilities.includes('mail')) scopes.add(GMAIL_SCOPE);
  if (capabilities.includes('calendar')) scopes.add(CALENDAR_SCOPE);
  return [...scopes];
}

export function capabilitiesOf(scopes: readonly string[]): GoogleCapability[] {
  const found: GoogleCapability[] = [];
  if (scopes.includes(GMAIL_SCOPE)) found.push('mail');
  if (scopes.includes(CALENDAR_SCOPE)) found.push('calendar');
  return found;
}

/**
 * Si este despliegue puede conectar con Google.
 *
 * Las tres piezas hacen falta: sin la llave de cifrado no se guarda un refresh
 * token, y guardarlo en claro para «que funcione ya» es exactamente la decisión
 * que se lamenta después.
 */
export function googleIsConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_TOKEN_KEY);
}

/** Por qué no está configurado, para poder decirlo en vez de deshabilitar sin más. */
export function googleMissingPieces(): string[] {
  const env = getServerEnv();
  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!env.GOOGLE_TOKEN_KEY) missing.push('GOOGLE_TOKEN_KEY');
  return missing;
}

export function redirectUri(): string {
  return new URL('/api/google/callback', getClientEnv().NEXT_PUBLIC_APP_URL).toString();
}

/**
 * La dirección a la que se manda a la persona a dar el consentimiento.
 *
 * `access_type=offline` con `prompt=consent` es lo que hace que Google entregue
 * un refresh token. Sin `prompt=consent`, una segunda autorización de la misma
 * cuenta devuelve sólo un token de acceso, y la conexión guardada queda sin
 * forma de renovarse — un fallo que aparece una hora después de conectar y
 * parece cualquier otra cosa.
 */
export function authorizationUrl(state: string, capabilities: readonly GoogleCapability[]): string {
  const env = getServerEnv();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');

  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopesFor(capabilities).join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);

  return url.toString();
}
