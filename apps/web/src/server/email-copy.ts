import 'server-only';

import type { getAdminDb } from '@app/database';
import { emailTemplates } from '@app/database/schema';
import {
  definitionFor,
  renderEmail,
  type EmailCopy,
  type EmailLocale,
  type EmailRow,
  type RenderedEmail,
} from '@app/email';
import { and, eq } from 'drizzle-orm';

/**
 * El texto con el que sale un correo: lo editado en la consola, o el de fábrica.
 *
 * La tabla guarda sólo lo que alguien cambió. Sin fila, manda el catálogo de
 * `@app/email` — así una corrección en el código llega sola, y una edición en la
 * consola llega sin desplegar.
 */
export async function copyFor(
  db: ReturnType<typeof getAdminDb>,
  key: string,
  locale: EmailLocale,
): Promise<EmailCopy> {
  const definition = definitionFor(key);
  if (!definition) throw new Error(`No existe la plantilla de correo «${key}».`);

  const [row] = await db
    .select({
      subject: emailTemplates.subject,
      preheader: emailTemplates.preheader,
      heading: emailTemplates.heading,
      body: emailTemplates.body,
      ctaLabel: emailTemplates.ctaLabel,
      footnote: emailTemplates.footnote,
    })
    .from(emailTemplates)
    .where(and(eq(emailTemplates.templateKey, key), eq(emailTemplates.locale, locale)))
    .limit(1);

  return row ?? definition.defaults[locale];
}

export interface NoticeMail {
  /** La plantilla del catálogo. */
  readonly template: string;
  /** Los valores de sus variables, por idioma: «3 pagos» y «3 payments» no son el mismo texto. */
  readonly values: Readonly<Record<EmailLocale, Readonly<Record<string, string>>>>;
  readonly rows?: readonly EmailRow[];
  /** El total de las filas, ya formateado. */
  readonly total?: string;
}

/** Un aviso, armado con el diseño de los correos y en el idioma de quien lo recibe. */
export async function composeNoticeMail(
  db: ReturnType<typeof getAdminDb>,
  mail: NoticeMail,
  locale: EmailLocale,
  buttonUrl: string,
  appUrl: string,
): Promise<RenderedEmail> {
  const definition = definitionFor(mail.template);
  if (!definition) throw new Error(`No existe la plantilla de correo «${mail.template}».`);

  return renderEmail({
    definition,
    copy: await copyFor(db, mail.template, locale),
    locale,
    mode: 'send',
    values: mail.values[locale],
    appUrl,
    buttonUrl,
    ...(mail.rows ? { rows: mail.rows } : {}),
    ...(mail.total ? { total: { label: 'Total', amount: mail.total } } : {}),
  });
}
