import 'server-only';

import { sendWithBrevo } from '@app/email';
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

export async function sendMail(message: MailMessage): Promise<MailOutcome> {
  const env = getServerEnv();

  if (!env.BREVO_API_KEY) return { status: 'skipped', reason: 'noMailKey' };
  if (!env.MAIL_FROM_EMAIL) return { status: 'skipped', reason: 'noSender' };

  // La llamada vive en `@app/email`, que la consola usa para mandar pruebas:
  // una sola implementación de cómo se habla con Brevo.
  return sendWithBrevo(
    {
      apiKey: env.BREVO_API_KEY,
      fromEmail: env.MAIL_FROM_EMAIL,
      fromName: env.MAIL_FROM_NAME ?? 'Cifraapp',
    },
    message,
  );
}

/** Si hay con qué mandar un correo. La pantalla lo usa para no ofrecer un canal muerto. */
export function mailIsConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.BREVO_API_KEY && env.MAIL_FROM_EMAIL);
}
