import { COPY_FIELDS, type CopyField, type EmailCopy, type TemplateDefinition } from './types.js';

/**
 * Lo que un texto de correo no puede tener para poder guardarse.
 *
 * Se valida en la consola al salir de cada campo y otra vez en el servidor al
 * guardar: la primera es para quien escribe, la segunda es la que manda.
 */

export type CopyProblemKind =
  | 'empty'
  | 'too_long'
  | 'unknown_variable'
  | 'raw_template'
  | 'button_required';

export interface CopyProblem {
  readonly field: CopyField;
  readonly kind: CopyProblemKind;
  /** La variable desconocida, o el largo máximo. */
  readonly detail: string;
}

/** Los mismos topes que la base, para que ningún texto válido aquí rebote allá. */
export const COPY_LIMITS: Readonly<Record<CopyField, number>> = {
  subject: 160,
  preheader: 200,
  heading: 160,
  body: 4000,
  ctaLabel: 60,
  footnote: 400,
};

const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;

export function validateCopy(definition: TemplateDefinition, copy: EmailCopy): readonly CopyProblem[] {
  const problems: CopyProblem[] = [];
  const known = new Set(definition.variables.map((one) => one.name));

  for (const field of ['subject', 'heading', 'body'] as const) {
    if (copy[field].trim() === '') problems.push({ field, kind: 'empty', detail: '' });
  }

  for (const field of COPY_FIELDS) {
    const value = copy[field];

    if (value.length > COPY_LIMITS[field]) {
      problems.push({ field, kind: 'too_long', detail: String(COPY_LIMITS[field]) });
    }

    /*
      `{{` y `}}` no se escriben, nunca.

      Son la sintaxis de las plantillas de Supabase, y el renderizador las
      neutraliza igual — pero un campo que las trae es un campo que alguien
      intentó usar para algo que no es texto, y se lo dice en vez de tragárselo.
    */
    if (/\{\{|\}\}/.test(value)) {
      problems.push({ field, kind: 'raw_template', detail: '' });
    }

    for (const match of value.matchAll(PLACEHOLDER)) {
      const name = match[1] ?? '';
      if (!known.has(name)) problems.push({ field, kind: 'unknown_variable', detail: name });
    }
  }

  /*
    La guarda que impide dejar a alguien afuera.

    En confirmar la cuenta, restablecer la contraseña o entrar con un enlace, el
    botón es el correo: sin su texto no se dibuja, y sin botón no hay enlace. Un
    texto de botón vacío ahí no es un estilo; es nadie pudiendo entrar.
  */
  if (definition.button?.required && copy.ctaLabel.trim() === '') {
    problems.push({ field: 'ctaLabel', kind: 'button_required', detail: '' });
  }

  return problems;
}
