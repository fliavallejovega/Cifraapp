import { TOKEN_EXPRESSION } from './catalogue.js';
import { CONTENT_WIDTH, DARK, FONT_LINK, FONT_MONO, FONT_SANS, LIGHT } from './tokens.js';
import type {
  EmailCopy,
  EmailLocale,
  EmailRow,
  RenderedEmail,
  RenderInput,
  TemplateDefinition,
} from './types.js';

/**
 * El correo, armado.
 *
 * ## Por qué tablas y estilos en línea
 *
 * Porque así es como se escribe HTML que Gmail, Outlook y Apple Mail muestran
 * igual. Outlook usa el motor de Word; Gmail descarta buena parte de `<style>`.
 * Un correo escrito como una página web se ve bien en el navegador de quien lo
 * diseña y roto en el teléfono de quien lo recibe.
 *
 * ## Lo que nunca se confía
 *
 * Todo texto editable y todo valor se escapa antes de entrar al HTML: un campo
 * de la consola es texto, nunca marcado. Y las llaves se neutralizan en el HTML,
 * porque en los correos de cuenta Supabase interpreta `{{ … }}` como código de
 * plantilla — un `{{` escrito en un campo podría ejecutar algo en el servidor de
 * correo. Las únicas expresiones de Supabase que llegan al HTML son las del
 * catálogo.
 */

const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;

/** La condición que elige el idioma dentro de una plantilla de Supabase. */
export const LOCALE_CONDITION = '{{ if eq (printf "%v" .Data.locale) "en" }}';

/** Lo que se muestra cuando el botón no abre, que en correos de cuenta es el correo. */
const BUTTON_FALLBACK: Readonly<Record<EmailLocale, string>> = {
  es: '¿El botón no abre? Copiá este enlace en el navegador:',
  en: 'Button not opening? Paste this link into your browser:',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Llaves que se ven igual y no pueden abrir una expresión de plantilla. */
function neutralizeBraces(html: string): string {
  return html.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

type Target = 'html' | 'text' | 'go-text';

/**
 * Un texto editable con sus variables puestas.
 *
 * Se recorre por pedazos y no con un reemplazo global, porque cada pedazo se
 * trata distinto: el texto literal se escapa, el valor de una variable se escapa
 * aparte, y en modo Supabase la variable se vuelve una expresión de Supabase que
 * no se escapa — es la única cosa que tiene permitido llegar sin tocar.
 */
function fill(text: string, input: RenderInput, target: Target): string {
  const literal = (piece: string): string => {
    if (target === 'html') return neutralizeBraces(escapeHtml(piece));
    // En un asunto de Supabase no hay HTML, pero sí plantillas: `{{` se separa.
    if (target === 'go-text') return piece.replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }');
    return piece;
  };

  let out = '';
  let last = 0;

  for (const match of text.matchAll(PLACEHOLDER)) {
    const at = match.index;
    out += literal(text.slice(last, at));

    const name = match[1] ?? '';
    const spec = input.definition.variables.find((one) => one.name === name);

    if (!spec) {
      // Una variable que no existe se ve tal cual. Mejor un `{nombre}` visible
      // en la vista previa que un hueco que nadie nota hasta que llega.
      out += literal(match[0]);
    } else if (input.mode === 'supabase') {
      out += spec.goExpression ?? '';
    } else {
      out += literal(input.values[name] ?? '');
    }

    last = at + match[0].length;
  }

  return out + literal(text.slice(last));
}

function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((one) => one.trim())
    .filter((one) => one !== '');
}

/** El enlace del botón, si hay uno que se pueda usar. */
function buttonHref(input: RenderInput): string | null {
  const button = input.definition.button;
  if (!button || input.copy.ctaLabel.trim() === '') return null;

  if (input.mode === 'supabase') return button.supabaseExpression ?? null;

  const url = input.buttonUrl ?? '';
  // Sólo direcciones absolutas y seguras. Un `javascript:` llegado por un error
  // de configuración no puede convertirse en un botón.
  return url.startsWith('https://') || /^http:\/\/localhost[:/]/.test(url) ? url : null;
}

function codeFor(input: RenderInput): string | null {
  if (input.definition.feature !== 'code') return null;
  if (input.mode === 'supabase') return TOKEN_EXPRESSION;
  return input.code ?? null;
}

// ── Piezas del diseño ─────────────────────────────────────────────────────────

const L = LIGHT;

function rowsTable(rows: readonly EmailRow[], total: EmailRow | undefined, input: RenderInput): string {
  const cell = (content: string, align: 'left' | 'right', strong: boolean, top: string) =>
    `<td class="t-ink rule" align="${align}" style="padding:12px 0;border-top:1px solid ${top};` +
    `font-family:${align === 'right' ? FONT_MONO : FONT_SANS};font-size:15px;line-height:1.4;` +
    (align === 'right' ? 'font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:16px;' : '') +
    `${strong ? 'font-weight:600;' : ''}color:${L.ink};">${content}</td>`;

  const esc = (value: string) => fill(value, { ...input, definition: { ...input.definition, variables: [] } }, 'html');

  const lines = rows
    .map((row) => `<tr>${cell(esc(row.label), 'left', false, L.rule)}${cell(esc(row.amount), 'right', false, L.rule)}</tr>`)
    .join('');

  const sum = total
    ? `<tr>${cell(esc(total.label), 'left', true, L.ink)}${cell(esc(total.amount), 'right', true, L.ink)}</tr>`
    : '';

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="margin:8px 0 24px;border-collapse:collapse;">${lines}${sum}</table>`
  );
}

function codeBlock(code: string, input: RenderInput): string {
  const shown = input.mode === 'supabase' ? code : neutralizeBraces(escapeHtml(code));
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">` +
    `<tr><td class="bg-sunk t-ink" style="background-color:${L.groundSunk};border-radius:8px;` +
    `padding:16px 24px;font-family:${FONT_MONO};font-size:28px;line-height:1;letter-spacing:0.3em;` +
    `font-weight:500;color:${L.ink};">${shown}</td></tr></table>`
  );
}

function button(label: string, href: string, input: RenderInput): string {
  const fallback =
    input.definition.group === 'account'
      ? `<p class="t-ink3" style="margin:16px 0 0;font-family:${FONT_SANS};font-size:13px;line-height:1.5;` +
        `color:${L.inkTertiary};word-break:break-all;">${escapeHtml(BUTTON_FALLBACK[input.locale])} ` +
        `<a href="${href}" class="t-ink2" style="color:${L.inkSecondary};">${href}</a></p>`
      : '';

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;">` +
    `<tr><td class="btn" style="background-color:${L.panel};border-radius:8px;">` +
    `<a href="${href}" style="display:inline-block;padding:14px 22px;font-family:${FONT_SANS};` +
    `font-size:15px;line-height:1;font-weight:600;color:${L.panelInk};text-decoration:none;` +
    `border-radius:8px;">${label}</a></td></tr></table>${fallback}`
  );
}

/**
 * Las reglas para los clientes que respetan el modo oscuro.
 *
 * `forced` es sólo para la vista previa de la consola: un iframe sigue el tema
 * de quien mira, y para enseñar el oscuro desde una pantalla clara las reglas
 * se aplican sin la condición.
 */
function darkStyles(forced: boolean): string {
  const D = DARK;
  return (
    (forced ? '@media all{' : '@media (prefers-color-scheme: dark){') +
    `.bg-ground{background-color:${D.ground} !important}` +
    `.bg-surface{background-color:${D.surface} !important;border-color:${D.surfaceBorder} !important}` +
    `.bg-sunk{background-color:${D.groundSunk} !important}` +
    `.t-ink{color:${D.ink} !important}` +
    `.t-ink2{color:${D.inkSecondary} !important}` +
    `.t-ink3{color:${D.inkTertiary} !important}` +
    `.rule{border-color:${D.rule} !important}` +
    `.btn{background-color:${D.panel} !important}` +
    `.btn a{color:${D.panelInk} !important}` +
    '}'
  );
}

// ── El documento ──────────────────────────────────────────────────────────────

export function renderEmail(input: RenderInput): RenderedEmail {
  const { copy, locale } = input;

  const subject = fill(copy.subject, input, input.mode === 'supabase' ? 'go-text' : 'text').trim();
  const preheaderHtml = fill(copy.preheader, input, 'html');
  const heading = fill(copy.heading, input, 'html');
  const body = paragraphs(copy.body)
    .map(
      (paragraph) =>
        `<p class="t-ink" style="margin:0 0 16px;font-family:${FONT_SANS};font-size:16px;` +
        `line-height:1.55;color:${L.ink};">${fill(paragraph, input, 'html').replace(/\n/g, '<br>')}</p>`,
    )
    .join('');

  const rows = input.definition.feature === 'rows' && input.rows && input.rows.length > 0
    ? rowsTable(input.rows, input.total, input)
    : '';
  const code = codeFor(input);
  const href = buttonHref(input);
  const cta = href ? button(fill(copy.ctaLabel, input, 'html'), href, input) : '';

  const footnote = copy.footnote.trim()
    ? `<tr><td class="t-ink3" style="padding:20px 8px 0;font-family:${FONT_SANS};font-size:13px;` +
      `line-height:1.5;color:${L.inkTertiary};">${fill(copy.footnote, input, 'html')}</td></tr>`
    : '';

  // El preheader se rellena con espacios invisibles: sin eso, el cliente
  // completa la vista previa con las primeras palabras del cuerpo.
  const preheaderPad = '&#8199;&#65279;&#847;'.repeat(40);

  const html =
    `<!doctype html><html lang="${locale}" xmlns="http://www.w3.org/1999/xhtml"><head>` +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="x-apple-disable-message-reformatting">' +
    '<meta name="color-scheme" content="light dark">' +
    '<meta name="supported-color-schemes" content="light dark">' +
    `<title>${escapeHtml(subject)}</title>` +
    `<link href="${FONT_LINK}" rel="stylesheet">` +
    '<style>' +
    'body{margin:0;padding:0;-webkit-text-size-adjust:100%;}' +
    'table{border-collapse:collapse;}' +
    'img{border:0;display:block;}' +
    '@media (max-width:600px){.card{padding:24px !important}.wrap{padding:24px 12px !important}}' +
    (input.preview === 'light' ? '' : darkStyles(input.preview === 'dark')) +
    '</style></head>' +
    `<body class="bg-ground" style="margin:0;padding:0;background-color:${L.ground};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheaderHtml}${preheaderPad}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-ground" style="background-color:${L.ground};">` +
    `<tr><td class="wrap" align="center" style="padding:40px 16px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${String(CONTENT_WIDTH)}px;">` +
    // La marca: el monograma y el nombre. Es el único latón del correo.
    `<tr><td style="padding:0 8px 20px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="padding-right:10px;"><img src="${input.appUrl}/icons/icon-192.png" width="28" height="28" alt="" style="border-radius:7px;"></td>` +
    `<td class="t-ink" style="font-family:${FONT_MONO};font-size:12px;font-weight:600;letter-spacing:0.16em;` +
    `text-transform:uppercase;color:${L.ink};">Cifraapp</td></tr></table></td></tr>` +
    // La tarjeta: el documento sobre el papel, sostenido por una línea fina.
    `<tr><td class="card bg-surface" style="background-color:${L.surface};border:1px solid ${L.surfaceBorder};` +
    `border-radius:12px;padding:32px;">` +
    `<h1 class="t-ink" style="margin:0 0 16px;font-family:${FONT_SANS};font-size:22px;line-height:1.2;` +
    `font-weight:600;letter-spacing:-0.014em;color:${L.ink};">${heading}</h1>` +
    body +
    rows +
    (code ? codeBlock(code, input) : '') +
    cta +
    '</td></tr>' +
    footnote +
    '</table></td></tr></table></body></html>';

  const text = [
    fill(copy.heading, input, 'text'),
    '',
    ...paragraphs(copy.body).flatMap((paragraph) => [fill(paragraph, input, 'text'), '']),
    ...(rows
      ? [
          ...(input.rows ?? []).map((row) => `· ${row.label} — ${row.amount}`),
          ...(input.total ? [`${input.total.label} — ${input.total.amount}`] : []),
          '',
        ]
      : []),
    ...(code ? [code, ''] : []),
    ...(href ? [`${fill(copy.ctaLabel, input, 'text')}: ${href}`, ''] : []),
    ...(copy.footnote.trim() ? [fill(copy.footnote, input, 'text')] : []),
  ]
    .join('\n')
    .trim();

  return { subject, preheader: fill(copy.preheader, input, 'text'), html, text };
}

/** Lo que Supabase pone en lugar de la dirección del producto. */
export const SITE_URL_EXPRESSION = '{{ .SiteURL }}';

/**
 * La plantilla que se publica en Supabase, con los dos idiomas.
 *
 * Supabase guarda una sola plantilla por tipo de correo. Los dos idiomas viajan
 * dentro, separados por una condición sobre el idioma de la cuenta: español
 * por defecto —el idioma del producto—, inglés si la cuenta lo dice.
 *
 * El logo sale de `{{ .SiteURL }}` y no de una dirección escrita aquí: así la
 * plantilla publicada no depende de la configuración de quien la publica, y lo
 * que se compara contra Supabase es siempre el mismo texto.
 */
export function renderForSupabase(
  definition: TemplateDefinition,
  copies: Readonly<Record<EmailLocale, EmailCopy>>,
): { readonly subject: string; readonly html: string } {
  const render = (locale: EmailLocale) =>
    renderEmail({
      definition,
      copy: copies[locale],
      locale,
      mode: 'supabase',
      values: {},
      appUrl: SITE_URL_EXPRESSION,
    });

  const es = render('es');
  const en = render('en');

  /*
    `printf "%v"` y no `.Data.locale` a secas: una cuenta sin idioma guardado no
    tiene la llave, y comparar un valor ausente con un texto es un error en
    algunas versiones de Go — un error que Supabase resolvería no mandando el
    correo. Formateado, lo ausente es siempre un texto («<nil>»), y la
    comparación nunca falla: cae en español.
  */
  const branch = (english: string, spanish: string) =>
    `${LOCALE_CONDITION}${english}{{ else }}${spanish}{{ end }}`;

  return { subject: branch(en.subject, es.subject), html: branch(en.html, es.html) };
}

/**
 * Los campos de la configuración de Supabase que corresponden a una plantilla.
 *
 * Los nombres son los de su API de administración: `mailer_subjects_<tipo>` y
 * `mailer_templates_<tipo>_content`. Se arman aquí, en un solo lugar, para que
 * la consola que publica y el gate que verifica lean los mismos nombres.
 */
export function supabaseFieldsFor(
  definition: TemplateDefinition,
  copies: Readonly<Record<EmailLocale, EmailCopy>>,
): Readonly<Record<string, string>> {
  if (!definition.supabaseKind) return {};
  const { subject, html } = renderForSupabase(definition, copies);
  return {
    [`mailer_subjects_${definition.supabaseKind}`]: subject,
    [`mailer_templates_${definition.supabaseKind}_content`]: html,
  };
}

/**
 * El interruptor de Supabase para un aviso de seguridad, o null si el correo
 * no tiene uno. Los de acceso —confirmar, restablecer— salen siempre.
 */
export function supabaseSwitchFor(definition: TemplateDefinition): string | null {
  const kind = definition.supabaseKind;
  if (!kind?.endsWith('_notification')) return null;
  return `mailer_notifications_${kind.slice(0, -'_notification'.length)}_enabled`;
}
