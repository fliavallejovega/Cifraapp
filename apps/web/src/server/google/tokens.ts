import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { getServerEnv } from '@app/validation/env';

import { redirectUri } from './config';

/**
 * El refresh token: cómo se guarda y cómo se cambia por uno de acceso.
 *
 * ## Por qué se cifra en la aplicación y no en la base
 *
 * Porque la amenaza que importa es una copia de la base de datos, y `pgcrypto`
 * con la llave en la misma base no protege de eso. Además el `service_role` de
 * Supabase salta toda la seguridad de fila: cualquier cosa que lo tenga lee la
 * tabla entera. Cifrando aquí, con una llave que sólo está en el entorno del
 * despliegue, ni la copia ni el `service_role` entregan el buzón de nadie.
 *
 * AES-256-GCM: cifra y autentica a la vez, así que un token manipulado falla al
 * abrirse en vez de convertirse en una petición rara contra Google. El nonce es
 * aleatorio por cifrado y viaja delante; reutilizar un nonce con GCM es el único
 * error que rompe el esquema entero, y por eso no hay un camino en este archivo
 * que permita pasarlo.
 */

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const raw = getServerEnv().GOOGLE_TOKEN_KEY;
  if (!raw) {
    throw new Error('GOOGLE_TOKEN_KEY is not configured; refuse to store a token in the clear.');
  }
  const material = Buffer.from(raw, 'base64');
  if (material.length !== 32) {
    throw new Error('GOOGLE_TOKEN_KEY must be 32 bytes, base64 encoded.');
  }
  return material;
}

/** Cifra un token para guardarlo. `nonce.ciphertext.tag`, todo en base64url. */
export function seal(plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [nonce.toString('base64url'), body.toString('base64url'), tag.toString('base64url')].join(
    '.',
  );
}

/**
 * Lo abre, o devuelve nulo.
 *
 * Nulo y no una excepción porque el caso normal de fallo es una llave rotada, y
 * eso no es un error del programa: es una conexión que hay que volver a
 * autorizar, y el barrido tiene que poder seguir con las demás.
 */
export function open(sealed: string): string | null {
  const parts = sealed.split('.');
  if (parts.length !== 3) return null;
  const [rawNonce, rawBody, rawTag] = parts;
  if (!rawNonce || !rawBody || !rawTag) return null;

  try {
    const tag = Buffer.from(rawTag, 'base64url');
    if (tag.length !== TAG_BYTES) return null;

    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(rawNonce, 'base64url'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(rawBody, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

export interface TokenGrant {
  readonly accessToken: string;
  /** Sólo la primera vez, o cuando Google decide rotarlo. */
  readonly refreshToken: string | null;
  readonly scopes: readonly string[];
  readonly expiresInSeconds: number;
}

export type TokenResult =
  | { readonly ok: true; readonly value: TokenGrant }
  | { readonly ok: false; readonly reason: string };

/** Cambia el código del consentimiento por tokens. Una sola vez por código. */
export async function exchangeCode(code: string): Promise<TokenResult> {
  return post({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  });
}

/** Renueva el token de acceso. El de refresco casi nunca cambia, y si cambia se guarda. */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResult> {
  return post({ refresh_token: refreshToken, grant_type: 'refresh_token' });
}

async function post(fields: Record<string, string>): Promise<TokenResult> {
  const env = getServerEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return { ok: false, reason: 'not_configured' };
  }

  const body = new URLSearchParams({
    ...fields,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
  });

  let response: Response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    return { ok: false, reason: 'transport' };
  }

  if (!response.ok) {
    // El cuerpo de un fallo de OAuth puede traer el secreto de vuelta en un eco.
    // Sólo viaja el código de estado y la etiqueta corta que Google usa.
    const detail: unknown = await response.json().catch(() => null);
    const label =
      typeof detail === 'object' && detail !== null && 'error' in detail
        ? String(detail.error)
        : String(response.status);
    return { ok: false, reason: label };
  }

  const payload = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    scope?: unknown;
    expires_in?: unknown;
  };

  if (typeof payload.access_token !== 'string') {
    return { ok: false, reason: 'malformed' };
  }

  return {
    ok: true,
    value: {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
      scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
      expiresInSeconds: typeof payload.expires_in === 'number' ? payload.expires_in : 3600,
    },
  };
}

/**
 * Retira el permiso en Google, no sólo en la base.
 *
 * Borrar la fila y dejar el token vivo deja a la aplicación con acceso al buzón
 * de alguien que cree haberla desconectado. Eso es lo que hace que «desconectar»
 * signifique algo.
 */
export async function revokeAtGoogle(refreshToken: string): Promise<boolean> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Comparación en tiempo constante para el `state` del consentimiento. */
export function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
