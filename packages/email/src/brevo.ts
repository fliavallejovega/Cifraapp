/**
 * Mandar un correo por Brevo.
 *
 * Una llamada HTTP y nada más: un SDK para tres campos es una dependencia que
 * hay que actualizar el resto de la vida del proyecto a cambio de no escribir
 * un `fetch`. La clave llega como argumento y nunca se lee del entorno aquí: el
 * paquete no sabe dónde corre, y quien lo llama ya validó su configuración.
 *
 * No reintenta ni guarda nada. Quien llama decide si un fallo merece otro
 * intento, porque sólo quien llama sabe si el aviso sigue teniendo sentido
 * dentro de una hora — un «vence hoy» no lo tiene.
 */

export interface BrevoConfig {
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly fromName: string;
}

export interface OutgoingMail {
  readonly to: string;
  readonly toName?: string | undefined;
  readonly subject: string;
  readonly text: string;
  readonly html?: string | undefined;
}

export type SendOutcome =
  | { readonly status: 'sent'; readonly id: string | null }
  | { readonly status: 'failed'; readonly reason: string };

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 10_000;

export async function sendWithBrevo(config: BrevoConfig, mail: OutgoingMail): Promise<SendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': config.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: config.fromEmail, name: config.fromName },
        to: [{ email: mail.to, ...(mail.toName ? { name: mail.toName } : {}) }],
        subject: mail.subject,
        textContent: mail.text,
        ...(mail.html ? { htmlContent: mail.html } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // El cuerpo de Brevo dice por qué —remitente sin verificar, cuota, clave
      // revocada— y esa frase es lo único que convierte «falló» en algo que
      // alguien puede arreglar. Acotado: un error de un tercero no llena una
      // columna de la base.
      const body = await response.text().catch(() => '');
      return { status: 'failed', reason: `${String(response.status)} ${body.slice(0, 200)}` };
    }

    const payload = (await response.json().catch(() => null)) as { messageId?: string } | null;
    return { status: 'sent', id: payload?.messageId ?? null };
  } catch (error: unknown) {
    return { status: 'failed', reason: String(error).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}
