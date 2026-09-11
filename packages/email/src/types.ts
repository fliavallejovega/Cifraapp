/**
 * Qué es una plantilla de correo en este producto.
 *
 * Una plantilla no es HTML. Es un puñado de campos de texto —asunto, texto de
 * vista previa, título, cuerpo, botón, nota al pie— que el diseño presenta
 * siempre de la misma forma. Quien edita un correo desde la consola cambia lo
 * que dice, nunca cómo se ve: el HTML de correo no es el de la web, y un error
 * en el correo de inicio de sesión deja a todos afuera del producto.
 */

export type EmailLocale = 'es' | 'en';

/** Español primero: es el idioma del producto, y el inglés se escribe después. */
export const EMAIL_LOCALES: readonly EmailLocale[] = ['es', 'en'];

/** Por dónde sale: los avisos por Brevo, los de la cuenta por Supabase. */
export type EmailChannel = 'brevo' | 'supabase';

/** Cómo los agrupa la consola. */
export type EmailGroup = 'notices' | 'account';

/**
 * Lo que el correo muestra además del texto.
 *
 * `rows` son montos alineados —los pagos que vencen hoy—; `code`, un código que
 * hay que escribir. Los dos los pone el sistema, no el texto editable: un código
 * de verificación que se puede borrar desde la consola es un código que alguien
 * va a borrar.
 */
export type EmailFeature = 'none' | 'rows' | 'code';

export interface EmailCopy {
  readonly subject: string;
  /** El texto que el cliente de correo muestra junto al asunto, antes de abrir. */
  readonly preheader: string;
  readonly heading: string;
  /** Párrafos separados por una línea en blanco. Sin marcado: sólo texto. */
  readonly body: string;
  /** Vacío es «sin botón», salvo donde el botón es lo que hace funcionar el correo. */
  readonly ctaLabel: string;
  /** Por qué llega este correo y cómo dejar de recibirlo, cuando aplica. */
  readonly footnote: string;
}

export const COPY_FIELDS = [
  'subject',
  'preheader',
  'heading',
  'body',
  'ctaLabel',
  'footnote',
] as const satisfies readonly (keyof EmailCopy)[];

export type CopyField = (typeof COPY_FIELDS)[number];

/** Una variable que el texto puede usar, escrita `{nombre}`. */
export interface VariableSpec {
  readonly name: string;
  /** Para la consola, en inglés como el resto de la consola. */
  readonly description: string;
  /** Lo que se ve en la vista previa. Nunca un dato real de nadie. */
  readonly example: Readonly<Record<EmailLocale, string>>;
  /**
   * La expresión de Supabase que la reemplaza en los correos de cuenta.
   *
   * Supabase rellena sus plantillas con su propio lenguaje —`{{ .Email }}`— y la
   * consola nunca lo expone: quien edita escribe `{email}` y la traducción pasa
   * al publicar. Así un error de sintaxis de Go no puede llegar desde un campo
   * de texto.
   */
  readonly goExpression?: string;
}

export interface ButtonSpec {
  /**
   * Si el correo deja de funcionar sin el botón.
   *
   * En el de confirmar la cuenta o restablecer la contraseña, el botón ES el
   * correo: sin él no hay enlace y nadie puede entrar. Esas plantillas no se
   * pueden guardar con el texto del botón vacío.
   */
  readonly required: boolean;
  /** En los correos de cuenta, la expresión de Supabase del enlace. */
  readonly supabaseExpression?: string;
}

export interface TemplateDefinition {
  readonly key: string;
  readonly channel: EmailChannel;
  readonly group: EmailGroup;
  /** Cómo se llama en la consola. */
  readonly name: string;
  /** Cuándo sale, dicho en una frase. */
  readonly purpose: string;
  readonly variables: readonly VariableSpec[];
  readonly feature: EmailFeature;
  readonly button: ButtonSpec | null;
  /** El tipo de correo de Supabase que esta plantilla reemplaza. */
  readonly supabaseKind?: string;
  /** El texto de fábrica, que manda hasta que alguien lo edite. */
  readonly defaults: Readonly<Record<EmailLocale, EmailCopy>>;
}

/** Una línea de montos. El monto llega ya formateado por `formatMoney`. */
export interface EmailRow {
  readonly label: string;
  readonly amount: string;
}

export interface RenderInput {
  readonly definition: TemplateDefinition;
  readonly copy: EmailCopy;
  readonly locale: EmailLocale;
  /**
   * `send`: un correo real con valores reales.
   * `supabase`: una plantilla para Supabase, con sus expresiones en lugar de valores.
   */
  readonly mode: 'send' | 'supabase';
  /** Los valores de las variables. Se ignoran en modo `supabase`. */
  readonly values: Readonly<Record<string, string>>;
  /** La dirección del producto, sin barra final. De ahí salen el logo y los enlaces. */
  readonly appUrl: string;
  /** El enlace del botón, en modo `send`. */
  readonly buttonUrl?: string;
  readonly rows?: readonly EmailRow[];
  readonly total?: EmailRow;
  /** El código a mostrar, en modo `send`. */
  readonly code?: string;
  /**
   * Sólo para la vista previa: fija el tema en vez de dejarlo al cliente.
   * Un correo que se envía nunca lo lleva.
   */
  readonly preview?: 'light' | 'dark';
}

export interface RenderedEmail {
  readonly subject: string;
  readonly preheader: string;
  readonly html: string;
  /** La versión en texto: lo que se lee en la notificación del teléfono. */
  readonly text: string;
}
