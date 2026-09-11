import 'server-only';

import { notificationDeliveries, pushSubscriptions } from '@app/database/schema';
import { and, eq, gte } from 'drizzle-orm';

import { getAdminDb } from '@app/database';
import { getServerEnv } from '@app/validation/env';

import type { EmailLocale } from '@app/email';

import { composeNoticeMail, type NoticeMail } from './email-copy';
import { mailIsConfigured, sendMail } from './mail';
import { pushIsConfigured, sendPush } from './push';

/**
 * Quién recibe qué, por dónde, y sin repetirse.
 *
 * Un aviso llega cuando tres cosas son ciertas a la vez: hay algo que decir, la
 * persona no lo apagó, y no se lo dijimos hace un rato. Las tres viven aquí en
 * vez de repartidas por cada recordatorio, porque la que más fácil se olvida es
 * la tercera y su síntoma es el que hace que alguien apague todo: el mismo
 * correo tres días seguidos.
 *
 * ## Por qué escribe siempre, incluso cuando no manda
 *
 * Una entrega queda registrada aunque se haya saltado, con su razón. Sin eso,
 * «no me llegó nada» no se puede distinguir de «no había nada que decir», de
 * «lo apagaste» y de «falta la clave del correo» — y las cuatro se arreglan de
 * forma distinta. El historial es la única herramienta que tiene alguien para
 * saber cuál de las cuatro le está pasando.
 *
 * ## Lo que decide la persona
 *
 * El canal es suyo, por tipo de aviso: correo, push, los dos, o ninguno. Este
 * módulo no elige por nadie; lo único que hace por su cuenta es no ofrecer un
 * canal que no está configurado, porque prometer un push sin claves VAPID es
 * prometer un silencio.
 */

export type Channel = 'email' | 'push' | 'both' | 'none';

export interface Recipient {
  readonly userId: string;
  readonly householdId: string;
  readonly email: string;
  readonly displayName: string | null;
  /** El idioma de su perfil. Decide en qué idioma sale el correo. */
  readonly locale: EmailLocale;
}

export interface Notice {
  /** El tipo, que decide la preferencia y el estrangulamiento. */
  readonly kind: string;
  /**
   * Qué cosa concreta motiva el aviso.
   *
   * Es lo que impide repetir: dos avisos del mismo tipo sobre el mismo pago son
   * uno repetido, y dos sobre pagos distintos son dos avisos. Sin esta clave el
   * estrangulamiento sería por tipo y silenciaría el segundo pago del día.
   */
  readonly subjectKey: string;
  readonly title: string;
  readonly body: string;
  /** A dónde lleva. Relativa y sin idioma: el dominio y el idioma los pone quien envía. */
  readonly url: string;
  /**
   * El correo, armado desde el catálogo de plantillas.
   *
   * El título y el cuerpo de arriba siguen siendo lo que dice el push. El correo
   * sale con su propio texto —el de la consola, o el de fábrica— porque un
   * correo tiene asunto, vista previa y botón, y un push tiene dos líneas.
   */
  readonly email?: NoticeMail;
}

export interface DispatchResult {
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Manda un aviso, si toca.
 *
 * Corre con permisos de servicio a propósito: lo llama un cron, sin sesión de
 * nadie, y un barrido nocturno que no puede leer las preferencias del hogar
 * mandaría avisos que alguien apagó. Es el mismo caso que las migraciones y los
 * trabajos en cola, y por eso usa la misma puerta.
 */
export async function dispatch(
  recipient: Recipient,
  notice: Notice,
  preference: { channel: Channel; throttleHours: number; isEnabled: boolean },
  appUrl: string,
): Promise<DispatchResult> {
  const db = getAdminDb(getServerEnv().DIRECT_URL);

  const record = async (channel: string, status: string, reason: string | null) => {
    await db.insert(notificationDeliveries).values({
      householdId: recipient.householdId,
      userId: recipient.userId,
      kind: notice.kind,
      channel,
      subjectKey: notice.subjectKey,
      title: notice.title,
      body: notice.body,
      status,
      reason,
      ...(status === 'sent' ? { sentAt: new Date() } : {}),
    });
  };

  if (!preference.isEnabled || preference.channel === 'none') {
    await record('none', 'skipped', 'disabled');
    return { sent: 0, skipped: 1, failed: 0 };
  }

  // Lo mismo, otra vez, dentro de la ventana que la persona eligió. El síntoma
  // que hace que alguien apague todos los avisos es este, y por eso se comprueba
  // antes de tocar cualquier proveedor.
  if (preference.throttleHours > 0) {
    const since = new Date(Date.now() - preference.throttleHours * 60 * 60 * 1000);
    const [recent] = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.userId, recipient.userId),
          eq(notificationDeliveries.kind, notice.kind),
          eq(notificationDeliveries.subjectKey, notice.subjectKey),
          eq(notificationDeliveries.status, 'sent'),
          gte(notificationDeliveries.sentAt, since),
        ),
      )
      .limit(1);

    if (recent) {
      await record(preference.channel, 'skipped', 'throttled');
      return { sent: 0, skipped: 1, failed: 0 };
    }
  }

  const wantsMail = preference.channel === 'email' || preference.channel === 'both';
  const wantsPush = preference.channel === 'push' || preference.channel === 'both';

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  if (wantsMail) {
    if (!mailIsConfigured()) {
      await record('email', 'skipped', 'mailNotConfigured');
      skipped += 1;
    } else {
      const link = `${appUrl}/${recipient.locale}${notice.url}`;
      const composed = notice.email
        ? await composeNoticeMail(db, notice.email, recipient.locale, link, appUrl)
        : null;
      const outcome = await sendMail({
        to: recipient.email,
        ...(recipient.displayName ? { toName: recipient.displayName } : {}),
        subject: composed?.subject ?? notice.title,
        text: composed?.text ?? `${notice.body}\n\n${link}`,
        html: composed?.html,
      });
      await record('email', outcome.status, outcome.status === 'sent' ? null : outcome.reason);
      if (outcome.status === 'sent') sent += 1;
      else if (outcome.status === 'failed') failed += 1;
      else skipped += 1;
    }
  }

  if (wantsPush) {
    if (!pushIsConfigured()) {
      await record('push', 'skipped', 'pushNotConfigured');
      skipped += 1;
    } else {
      const subscriptions = await db
        .select({
          id: pushSubscriptions.id,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, recipient.userId));

      if (subscriptions.length === 0) {
        await record('push', 'skipped', 'noSubscription');
        skipped += 1;
      }

      for (const subscription of subscriptions) {
        const outcome = await sendPush(subscription, {
          title: notice.title,
          body: notice.body,
          url: notice.url,
        });

        // Una suscripción muerta que nadie retira convierte cada envío en un
        // error diario para siempre.
        if (outcome.status === 'gone') {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
        }

        await record(
          'push',
          outcome.status === 'gone' ? 'failed' : outcome.status,
          outcome.status === 'sent'
            ? null
            : outcome.status === 'gone'
              ? 'subscriptionGone'
              : outcome.reason,
        );
        if (outcome.status === 'sent') sent += 1;
        else if (outcome.status === 'failed' || outcome.status === 'gone') failed += 1;
        else skipped += 1;
      }
    }
  }

  return { sent, skipped, failed };
}
