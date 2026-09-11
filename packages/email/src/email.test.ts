import { describe, expect, it } from 'vitest';

import { CATALOGUE, definitionFor } from './catalogue.js';
import { LOCALE_CONDITION, renderEmail, renderForSupabase, supabaseFieldsFor, supabaseSwitchFor } from './render.js';
import { EMAIL_LOCALES, type EmailCopy, type TemplateDefinition } from './types.js';
import { validateCopy } from './validate.js';

/**
 * Lo que un correo no puede hacer, diga lo que diga quien lo edite.
 *
 * Los textos se editan desde una consola; estas pruebas miden los límites que
 * esa libertad no puede cruzar: meter marcado en un correo, ejecutar una
 * plantilla de Supabase, o dejar a alguien sin forma de entrar.
 */

const APP = 'https://norte-web-three.vercel.app';

function def(key: string): TemplateDefinition {
  const found = definitionFor(key);
  if (!found) throw new Error(`no existe ${key}`);
  return found;
}

function sampleValues(definition: TemplateDefinition): Record<string, string> {
  return Object.fromEntries(definition.variables.map((one) => [one.name, one.example.es]));
}

describe('escapar lo editable', () => {
  const hostile = '<script>alert(1)</script>"><img src=x onerror=alert(1)>';

  it('escapa el marcado escrito en cualquier campo', () => {
    const definition = def('statement_upload');
    const copy: EmailCopy = {
      subject: 'Asunto',
      preheader: hostile,
      heading: hostile,
      body: hostile,
      ctaLabel: hostile,
      footnote: hostile,
    };
    const { html } = renderEmail({ definition, copy, locale: 'es', mode: 'send', values: {}, appUrl: APP, buttonUrl: `${APP}/es/documents` });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapa el marcado que llega en el valor de una variable', () => {
    const definition = def('commitment_due');
    const copy = definition.defaults.es;
    const { html } = renderEmail({
      definition,
      copy,
      locale: 'es',
      mode: 'send',
      values: { due: hostile, total: '$1.00', count: '1' },
      appUrl: APP,
      rows: [{ label: hostile, amount: '$1.00' }],
    });

    expect(html).not.toContain('<script>');
    // El texto escapado puede decir «onerror»: lo que no puede haber es una etiqueta abierta.
    expect(html).not.toContain('<img src=x');
  });

  it('no deja que un «{{» escrito en un campo abra una plantilla de Supabase', () => {
    const definition = def('auth_recovery');
    const copy = { ...definition.defaults.es, body: 'Hola {{ template "x" }} y {{ .Token }}' };
    const { html } = renderForSupabase(definition, { es: copy, en: definition.defaults.en });

    expect(html).not.toContain('{{ template');
    // El único `{{ .Token }}` válido es el del catálogo, y la recuperación no tiene código.
    expect(html).not.toContain('y {{ .Token }}');
    expect(html).toContain('&#123;&#123;');
  });

  it('rechaza un botón con un enlace que no es https', () => {
    const definition = def('statement_upload');
    const { html } = renderEmail({
      definition,
      copy: definition.defaults.es,
      locale: 'es',
      mode: 'send',
      values: {},
      appUrl: APP,
      buttonUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('javascript:');
  });
});

describe('el catálogo entero', () => {
  for (const definition of CATALOGUE) {
    for (const locale of EMAIL_LOCALES) {
      it(`${definition.key} (${locale}) renderiza completo y liviano`, () => {
        const copy = definition.defaults[locale];
        expect(validateCopy(definition, copy)).toEqual([]);

        const { html, text, subject } = renderEmail({
          definition,
          copy,
          locale,
          mode: 'send',
          values: Object.fromEntries(definition.variables.map((one) => [one.name, one.example[locale]])),
          appUrl: APP,
          buttonUrl: `${APP}/${locale}/overview`,
          rows: [{ label: 'Colegio', amount: '$450.00' }],
          total: { label: 'Total', amount: '$450.00' },
          code: '48291375',
        });

        expect(subject.length).toBeGreaterThan(0);
        expect(text.length).toBeGreaterThan(0);
        // Gmail recorta el HTML de más de 102 KB y esconde el resto.
        expect(Buffer.byteLength(html)).toBeLessThan(102 * 1024);
        // Ningún cliente de correo entiende OKLCH ni las variables del producto.
        expect(html).not.toMatch(/oklch|var\(--/);
        expect(html).not.toMatch(/\{[a-z_]+\}/);
      });
    }
  }

  it('cada correo de cuenta publica su enlace o su código', () => {
    for (const definition of CATALOGUE.filter((one) => one.channel === 'supabase')) {
      const { html } = renderForSupabase(definition, definition.defaults);
      if (definition.button?.required) expect(html).toContain('{{ .ConfirmationURL }}');
      if (definition.feature === 'code') expect(html).toContain('{{ .Token }}');
      expect(html).toContain(LOCALE_CONDITION);
    }
  });

  it('los montos van en cifras tabulares, como en cada columna del producto', () => {
    const definition = def('commitment_due');
    const { html } = renderEmail({
      definition,
      copy: definition.defaults.es,
      locale: 'es',
      mode: 'send',
      values: sampleValues(definition),
      appUrl: APP,
      rows: [{ label: 'Colegio', amount: '$450.00' }],
      total: { label: 'Total', amount: '$450.00' },
    });
    expect(html).toContain('font-variant-numeric:tabular-nums');
  });
});

describe('la guarda que impide dejar a alguien afuera', () => {
  for (const definition of CATALOGUE.filter((one) => one.button?.required)) {
    it(`${definition.key} no se guarda sin el texto del botón`, () => {
      const problems = validateCopy(definition, { ...definition.defaults.es, ctaLabel: '  ' });
      expect(problems.some((one) => one.kind === 'button_required')).toBe(true);
    });
  }

  it('rechaza una variable que la plantilla no conoce', () => {
    const definition = def('auth_recovery');
    const problems = validateCopy(definition, { ...definition.defaults.es, body: 'Hola {nombre_inventado}' });
    expect(problems).toContainEqual({ field: 'body', kind: 'unknown_variable', detail: 'nombre_inventado' });
  });

  it('rechaza la sintaxis cruda de Supabase', () => {
    const definition = def('auth_recovery');
    const problems = validateCopy(definition, { ...definition.defaults.es, body: 'Hola {{ .Email }}' });
    expect(problems.some((one) => one.kind === 'raw_template')).toBe(true);
  });

  it('rechaza un asunto vacío', () => {
    const definition = def('statement_upload');
    const problems = validateCopy(definition, { ...definition.defaults.es, subject: '' });
    expect(problems).toContainEqual({ field: 'subject', kind: 'empty', detail: '' });
  });
});

describe('la vista previa', () => {
  it('fuerza el oscuro sin depender del tema de quien mira', () => {
    const definition = def('statement_upload');
    const base = { definition, copy: definition.defaults.es, locale: 'es' as const, mode: 'send' as const, values: {}, appUrl: APP };
    expect(renderEmail({ ...base, preview: 'dark' }).html).toContain('@media all{');
    expect(renderEmail({ ...base, preview: 'light' }).html).not.toContain('prefers-color-scheme: dark');
    // Un correo enviado deja el tema al cliente.
    expect(renderEmail(base).html).toContain('@media (prefers-color-scheme: dark){');
  });
});

describe('los nombres de Supabase', () => {
  it('arma los campos de su API para cada correo de cuenta, y ninguno para los avisos', () => {
    expect(Object.keys(supabaseFieldsFor(def('auth_recovery'), def('auth_recovery').defaults))).toEqual([
      'mailer_subjects_recovery',
      'mailer_templates_recovery_content',
    ]);
    expect(supabaseFieldsFor(def('statement_upload'), def('statement_upload').defaults)).toEqual({});
  });

  it('sólo los avisos de seguridad tienen interruptor', () => {
    expect(supabaseSwitchFor(def('auth_password_changed'))).toBe('mailer_notifications_password_changed_enabled');
    expect(supabaseSwitchFor(def('auth_recovery'))).toBeNull();
  });

  it('el logo publicado sale de la dirección que Supabase conoce', () => {
    const { html } = renderForSupabase(def('auth_confirmation'), def('auth_confirmation').defaults);
    expect(html).toContain('{{ .SiteURL }}/icons/icon-192.png');
  });
});
