import 'server-only';

import { getServerEnv } from '@app/validation/env';

/**
 * El correo saliente, por Brevo.
 *
 * Una llamada HTTP y nada más: un SDK para tres campos es una dependencia que
 * hay que actualizar el resto de la vida del proyecto a cambio de no escribir
 * un `fetch`.
 *
 * ## Lo que hace cuando no está configurado
 *
 * Devuelve `skipped` y no lanza. Un despliegue sin clave de correo tiene que
 * arrancar y no mandar avisos, no negarse a abrir: una casa prefiere una
 * aplicación que funciona sin recordatorios a una que no abre porque falta la
 * clave de un tercero. La razón viaja en la respuesta y termina escrita en la
 * entrega, para que la pantalla pueda decir «no se envió porque falta el
 * remitente» en vez de callarse.
 *
 * ## Lo que nunca hace
 *
 * No reintenta por su cuenta ni guarda nada. Quien lo llama decide si un fallo
 * merece otro intento, porque solo quien llama sabe si el aviso sigue teniendo
 * sentido dentro de una hora — un «vence hoy» no lo tiene.
 */

export type MailOutcome =
  | { readonly status: 'sent'; readonly id: string | null }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string };

export interface MailMessage {
  readonly to: string;
  readonly toName?: string | undefined;
  readonly subject: string;
  /** Texto plano. Es lo que se lee en la notificación del teléfono. */
  readonly text: string;
  /** HTML, cuando vale la pena. Sin él, Brevo manda solo el texto. */
  readonly html?: string | undefined;
}

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** Cuánto se espera antes de dar por perdida una llamada al proveedor. */
const TIMEOUT_MS = 10_000;

export async function sendMail(message: MailMessage): Promise<MailOutcome> {
  const env = getServerEnv();

  if (!env.BREVO_API_KEY) return { status: 'skipped', reason: 'noMailKey' };
  if (!env.MAIL_FROM_EMAIL) return { status: 'skipped', reason: 'noSender' };

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: env.MAIL_FROM_EMAIL, name: env.MAIL_FROM_NAME ?? 'Cifra' },
        to: [{ email: message.to, ...(message.toName ? { name: message.toName } : {}) }],
        subject: message.subject,
        textContent: message.text,
        ...(message.html ? { htmlContent: message.html } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // El cuerpo de Brevo dice por qué —dominio sin verificar, cuota, clave
      // revocada— y esa frase es lo único que convierte «falló» en algo que
      // alguien puede arreglar. Acotado: un error de un tercero no debe llenar
      // una columna de la base.
      const body = await response.text().catch(() => '');
      return { status: 'failed', reason: `${String(response.status)} ${body.slice(0, 200)}` };
    }

    const payload = (await response.json().catch(() => null)) as { messageId?: string } | null;
    return { status: 'sent', id: payload?.messageId ?? null };
  } catch (error: unknown) {
    // Incluye el aborto por tiempo: para quien llama es lo mismo que un fallo
    // del proveedor, y distinguirlos solo serviría para escribir dos ramas que
    // hacen lo mismo.
    return { status: 'failed', reason: String(error).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** Si hay con qué mandar un correo. La pantalla lo usa para no ofrecer un canal muerto. */
export function mailIsConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.BREVO_API_KEY && env.MAIL_FROM_EMAIL);
}
