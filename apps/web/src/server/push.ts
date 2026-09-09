import 'server-only';

import {
  createCipheriv,
  createECDH,
  createHash,
  createHmac,
  createSign,
  randomBytes,
} from 'node:crypto';

import { getServerEnv, getClientEnv } from '@app/validation/env';

/**
 * Web push, firmado y cifrado aquí mismo.
 *
 * Sin librería a propósito. `web-push` arrastra su propia criptografía y su
 * propio cliente HTTP para hacer dos cosas que el runtime de Node ya sabe
 * hacer: firmar un JWT con ECDSA P-256 y cifrar un cuerpo con AES-GCM según
 * RFC 8291. Lo que se gana con la dependencia es no leer el RFC una vez; lo que
 * se paga es actualizarla mientras el proyecto viva.
 *
 * ## Lo que garantiza
 *
 * El servicio de push —Google, Apple, Mozilla— transporta el sobre y no puede
 * abrirlo: la clave que lo cifra sale de la que dio el navegador al
 * suscribirse. Para un producto que manda avisos sobre el dinero de alguien esa
 * propiedad no es un detalle de implementación, es la razón de poder mandarlos.
 *
 * ## Lo que devuelve
 *
 * `gone` cuando el servicio dice que la suscripción murió —404 o 410—, que es
 * la señal para borrarla. Una suscripción muerta que nadie retira convierte
 * cada envío en un error diario para siempre.
 */

export type PushOutcome =
  | { readonly status: 'sent' }
  | { readonly status: 'gone' }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string };

export interface PushSubscription {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** A dónde lleva al tocarla. Relativa a la aplicación. */
  readonly url: string;
}

const base64url = (input: Buffer): string => input.toString('base64url');
const fromBase64url = (input: string): Buffer => Buffer.from(input, 'base64url');

/** Cuánto vale un JWT de push. Doce horas es lo que la especificación admite. */
const JWT_SECONDS = 12 * 60 * 60;

/**
 * El encabezado que prueba que este servidor es el dueño de la clave pública
 * con la que el navegador se suscribió.
 */
function vapidHeader(endpoint: string, privateKey: string, publicKey: string, subject: string) {
  const audience = new URL(endpoint).origin;
  const header = base64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + JWT_SECONDS,
        sub: subject,
      }),
    ),
  );

  const signingInput = `${header}.${payload}`;
  // ES256 sobre P-256. La firma sale en DER; JWS quiere r||s crudo.
  const key = privateKeyToPem(privateKey);
  const der = createSign('SHA256').update(signingInput).end().sign(key);
  const signature = base64url(derToJose(der));

  return {
    Authorization: `vapid t=${signingInput}.${signature}, k=${publicKey}`,
  };
}

/** La clave privada VAPID viene en base64url crudo; PEM es lo que Node firma. */
function privateKeyToPem(raw: string): string {
  const d = fromBase64url(raw);
  // PKCS#8 para una clave privada de curva prime256v1, con la privada embebida.
  const prefix = Buffer.from(
    '308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420',
    'hex',
  );
  const der = Buffer.concat([prefix, d]);
  return `-----BEGIN PRIVATE KEY-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
}

/** DER (SEQUENCE de dos INTEGER) a la concatenación r||s de 64 bytes que pide JWS. */
function derToJose(der: Buffer): Buffer {
  let offset = 2;
  if (der[1] !== undefined && der[1] > 0x80) offset += der[1] - 0x80;
  const readInt = (): Buffer => {
    const length = der[offset + 1] ?? 0;
    const start = offset + 2;
    offset = start + length;
    let value = der.subarray(start, start + length);
    while (value.length > 32 && value[0] === 0) value = value.subarray(1);
    return Buffer.concat([Buffer.alloc(32 - value.length), value]);
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer => {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  return createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length);
};

/**
 * El cuerpo, cifrado con `aes128gcm` según RFC 8291.
 *
 * La clave sale de un acuerdo efímero con la clave pública del navegador, así
 * que solo ese navegador puede abrirlo — ni el servicio de push ni este
 * servidor después de mandarlo.
 */
function encrypt(payload: string, p256dh: string, auth: string) {
  const clientPublic = fromBase64url(p256dh);
  const authSecret = fromBase64url(auth);

  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(clientPublic);

  const authInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPublic, serverPublic]);
  const ikm = hkdf(authSecret, shared, authInfo, 32);

  const salt = randomBytes(16);
  const contentKey = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  const body = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])]);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverPublic.length, 20);

  return Buffer.concat([header, serverPublic, encrypted]);
}

export async function sendPush(
  subscription: PushSubscription,
  message: PushMessage,
): Promise<PushOutcome> {
  const server = getServerEnv();
  const client = getClientEnv();

  if (!server.VAPID_PRIVATE_KEY || !client.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    return { status: 'skipped', reason: 'noVapidKeys' };
  }

  try {
    const body = encrypt(JSON.stringify(message), subscription.p256dh, subscription.auth);
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        ...vapidHeader(
          subscription.endpoint,
          server.VAPID_PRIVATE_KEY,
          client.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
          server.VAPID_SUBJECT ?? 'mailto:soporte@cifra.app',
        ),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '86400',
      },
      body: new Uint8Array(body),
    });

    // El servicio dice que ese navegador ya no existe: desinstalado, permiso
    // revocado, datos borrados. La suscripción se retira.
    if (response.status === 404 || response.status === 410) return { status: 'gone' };
    if (!response.ok) {
      return { status: 'failed', reason: String(response.status) };
    }
    return { status: 'sent' };
  } catch (error: unknown) {
    return { status: 'failed', reason: String(error).slice(0, 200) };
  }
}

/** Si hay con qué firmar un push. La pantalla no ofrece un canal apagado. */
export function pushIsConfigured(): boolean {
  return Boolean(getServerEnv().VAPID_PRIVATE_KEY && getClientEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

/** Sin uso todavía; deja la huella del algoritmo por si hay que depurar un endpoint. */
export const endpointFingerprint = (endpoint: string): string =>
  createHash('sha256').update(endpoint).digest('hex').slice(0, 12);
