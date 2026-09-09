import 'server-only';

import { flatten, institutionOf, type EmailAlert } from '@app/transaction-engine';
import { toPlainDate, type PlainDate } from '@app/domain';

/**
 * Gmail, leído con `fetch` y una consulta estrecha.
 *
 * ## Lo que se pide, y por qué tan poco
 *
 * `gmail.readonly` da el buzón entero. Que Google lo dé no significa que este
 * producto deba leerlo: la consulta se limita a los remitentes de bancos
 * conocidos y a los últimos días, así que un correo del médico o del abogado de
 * alguien no llega nunca a esta aplicación aunque el permiso lo permitiría.
 * Ese recorte es la diferencia entre «leemos tus avisos del banco» y «leemos tu
 * correo», y está en el código y no sólo en la política de privacidad.
 *
 * ## Lo que no se guarda
 *
 * El cuerpo. Se lee, se saca el movimiento y se descarta; lo que persiste es el
 * identificador del mensaje —para no leerlo dos veces— y el veredicto.
 */

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Cuántos mensajes se traen de una pasada. Un buzón grande se lee en varias. */
const PAGE_SIZE = 50;

/** Cuántos días atrás mira un barrido. Un aviso de hace un mes ya está en el PDF. */
export const LOOKBACK_DAYS = 10;

export interface GmailPage {
  readonly alerts: readonly EmailAlert[];
  readonly nextPageToken: string | null;
  /** Ids que se saltaron por estar ya leídos. Se cuentan, no se procesan. */
  readonly skipped: number;
}

/**
 * La consulta que Gmail entiende.
 *
 * Los remitentes van en un `OR` explícito en vez de un `has:attachment` o una
 * etiqueta: una etiqueta la tendría que crear la persona, y sin lista de
 * remitentes la consulta sería «todo el correo reciente», que es exactamente lo
 * que este archivo existe para no hacer.
 */
export function alertQuery(domains: readonly string[], days = LOOKBACK_DAYS): string {
  const senders = domains.map((domain) => `from:${domain}`).join(' OR ');
  return `(${senders}) newer_than:${String(days)}d`;
}

/** Los dominios que el parser reconoce, para armar la consulta. */
export const BANK_DOMAINS: readonly string[] = [
  'bgeneral.com',
  'bancogeneral.com',
  'banistmo.com',
  'baccredomatic.com',
  'credomatic.com',
  'globalbank.com.pa',
  'multibank.com.pa',
  'bancanacional.com.pa',
  'banconal.com.pa',
  'cajadeahorros.com.pa',
  'towerbank.com',
  'scotiabank.com',
  'stgeorgesbank.com',
];

interface GmailListResponse {
  messages?: { id?: unknown }[];
  nextPageToken?: unknown;
}

export async function listAlertIds(
  accessToken: string,
  options: { query: string; pageToken?: string },
): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const url = new URL(`${API}/messages`);
  url.searchParams.set('q', options.query);
  url.searchParams.set('maxResults', String(PAGE_SIZE));
  if (options.pageToken) url.searchParams.set('pageToken', options.pageToken);

  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`gmail_list_${String(response.status)}`);

  const body = (await response.json()) as GmailListResponse;
  const ids = (body.messages ?? [])
    .map((one) => (typeof one.id === 'string' ? one.id : null))
    .filter((one): one is string => one !== null);

  return {
    ids,
    nextPageToken: typeof body.nextPageToken === 'string' ? body.nextPageToken : null,
  };
}

interface GmailPart {
  mimeType?: unknown;
  body?: { data?: unknown };
  parts?: GmailPart[];
}

interface GmailMessage {
  id?: unknown;
  internalDate?: unknown;
  payload?: GmailPart & { headers?: { name?: unknown; value?: unknown }[] };
}

/** Trae un mensaje y lo reduce a las cuatro cosas que el parser necesita. */
export async function readAlert(
  accessToken: string,
  messageId: string,
  timeZone: string,
): Promise<EmailAlert | null> {
  const url = new URL(`${API}/messages/${messageId}`);
  url.searchParams.set('format', 'full');

  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`gmail_get_${String(response.status)}`);

  const message = (await response.json()) as GmailMessage;
  const headers = message.payload?.headers ?? [];

  const header = (name: string): string => {
    const found = headers.find(
      (one) => typeof one.name === 'string' && one.name.toLowerCase() === name,
    );
    return typeof found?.value === 'string' ? found.value : '';
  };

  const from = header('from');
  // Segunda puerta: la consulta ya filtró por remitente, pero un `from:` de
  // Gmail casa por subcadena y `from:scotiabank.com` traería
  // `no-reply@scotiabank.com.phishing.example`. El parser decide de verdad.
  if (!institutionOf(from)) return null;

  const body = collectBody(message.payload);
  if (!body) return null;

  return {
    messageId,
    from,
    subject: header('subject'),
    body: flatten(body),
    receivedOn: deliveredOn(message.internalDate, timeZone),
  };
}

/**
 * El cuerpo, preferiendo texto plano y cayendo en HTML.
 *
 * Un aviso bancario llega casi siempre como `multipart/alternative` con las dos
 * versiones. El texto plano es el mismo contenido sin la maquetación, así que
 * usarlo ahorra el aplanado y evita que una tabla de tres columnas pegue el
 * monto al comercio sin espacio.
 */
function collectBody(part: GmailPart | undefined): string | null {
  if (!part) return null;

  const decoded = (): string | null => {
    const data = part.body?.data;
    if (typeof data !== 'string') return null;
    return Buffer.from(data, 'base64url').toString('utf8');
  };

  if (part.mimeType === 'text/plain') return decoded();

  if (part.parts) {
    for (const child of part.parts) {
      if (child.mimeType === 'text/plain') {
        const text = collectBody(child);
        if (text) return text;
      }
    }
    for (const child of part.parts) {
      const text = collectBody(child);
      if (text) return text;
    }
  }

  if (part.mimeType === 'text/html') return decoded();
  return decoded();
}

/**
 * El día en que llegó, en la zona del hogar.
 *
 * `internalDate` son milisegundos en UTC. Convertirlo con la zona del servidor
 * pondría en el día anterior toda compra hecha después de las siete de la tarde
 * en Panamá — que son muchas.
 */
function deliveredOn(internalDate: unknown, timeZone: string): PlainDate {
  const millis = typeof internalDate === 'string' ? Number(internalDate) : Number.NaN;
  const when = Number.isFinite(millis) ? new Date(millis) : new Date();

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when);

  return toPlainDate(parts);
}
