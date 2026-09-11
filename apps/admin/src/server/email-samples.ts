import type { EmailLocale, EmailRow, TemplateDefinition } from '@app/email';

/**
 * Los valores de ejemplo con los que se ve y se prueba un correo.
 *
 * Nunca datos de nadie: la vista previa la miran administradores, y un correo
 * de prueba enseñado con los pagos de un hogar real es una filtración con buena
 * intención. Los montos de las filas suman el total que enseña la variable.
 */

const ROWS: Readonly<Record<EmailLocale, readonly EmailRow[]>> = {
  es: [
    { label: 'Colegio', amount: '$450.00' },
    { label: 'Tarjeta Visa ···0209', amount: '$620.00' },
    { label: 'Luz', amount: '$175.00' },
  ],
  en: [
    { label: 'School', amount: '$450.00' },
    { label: 'Visa card ···0209', amount: '$620.00' },
    { label: 'Electricity', amount: '$175.00' },
  ],
};

/** A dónde lleva el botón de cada aviso. Los de cuenta llevan un enlace de Supabase. */
const NOTICE_PATHS: Readonly<Record<string, string>> = {
  commitment_due: '/commitments',
  statement_upload: '/imports',
};

export function sampleFor(definition: TemplateDefinition, locale: EmailLocale, appUrl: string) {
  const base = appUrl.replace(/\/$/, '');
  const values = Object.fromEntries(definition.variables.map((one) => [one.name, one.example[locale]]));
  const path = NOTICE_PATHS[definition.key] ?? '/sign-in';
  const token = definition.variables.find((one) => one.name === 'token')?.example[locale];

  return {
    values,
    appUrl: base,
    buttonUrl: `${base}/${locale}${path}`,
    ...(definition.feature === 'rows' ? { rows: ROWS[locale], total: { label: 'Total', amount: '$1,245.00' } } : {}),
    ...(token ? { code: token } : {}),
  };
}
