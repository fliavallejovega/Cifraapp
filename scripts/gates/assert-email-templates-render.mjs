#!/usr/bin/env node
/**
 * E2 — Cada correo del catálogo sale completo en los dos idiomas.
 *
 * Completo quiere decir: asunto, vista previa escondida, versión en texto, sólo
 * colores hex en el HTML (Outlook y Gmail no entienden OKLCH ni variables), y
 * menos de 102 KB, que es donde Gmail corta el correo y esconde el resto
 * detrás de «Ver mensaje completo».
 */
import { loadEmail } from './_email.mjs';

const { CATALOGUE, EMAIL_LOCALES, renderEmail } = await loadEmail();

/** Todo color del HTML, y los que no son hex. */
function badColors(html) {
  const bad = [];
  for (const match of html.matchAll(/(?:^|[;"{\s])(color|background-color|border(?:-top)?(?:-color)?)\s*:\s*([^;"}!]+)/g)) {
    const value = match[2].trim();
    const colors = value.match(/#[0-9A-Fa-f]{3,8}\b|oklch\([^)]*\)|rgba?\([^)]*\)|hsla?\([^)]*\)|var\([^)]*\)/g) ?? [];
    for (const one of colors) if (!/^#[0-9A-Fa-f]{6}$/.test(one)) bad.push(one);
  }
  return bad;
}

// Control negativo: el detector tiene que ver un color que no es hex.
if (badColors('<td style="color:oklch(0.2 0 0);background-color:#FFFFFF">').length !== 1) {
  console.error('- el detector de colores no reconoce un OKLCH: el gate no mide nada');
  process.exit(1);
}

const problems = [];
let renders = 0;
const APP = 'https://norte-web-three.vercel.app';

for (const definition of CATALOGUE) {
  for (const locale of EMAIL_LOCALES) {
    const values = Object.fromEntries(definition.variables.map((one) => [one.name, one.example[locale]]));
    const { html, text, subject, preheader } = renderEmail({
      definition,
      copy: definition.defaults[locale],
      locale,
      mode: 'send',
      values,
      appUrl: APP,
      buttonUrl: `${APP}/${locale}/overview`,
      rows: [{ label: 'Colegio', amount: '$450.00' }],
      total: { label: 'Total', amount: '$450.00' },
      code: '48291375',
    });
    renders += 1;
    const where = `${definition.key} (${locale})`;

    if (!subject.trim()) problems.push(`${where}: sin asunto`);
    if (!preheader.trim()) problems.push(`${where}: sin vista previa`);
    if (!html.includes('display:none;max-height:0;overflow:hidden')) problems.push(`${where}: la vista previa no va escondida`);
    if (text.trim().length < 20) problems.push(`${where}: sin versión en texto`);
    if (!html.includes(`lang="${locale}"`)) problems.push(`${where}: el documento no declara su idioma`);
    const bad = badColors(html);
    if (bad.length > 0) problems.push(`${where}: colores que no son hex: ${bad.join(', ')}`);
    const bytes = Buffer.byteLength(html);
    if (bytes >= 102 * 1024) problems.push(`${where}: ${bytes} bytes, Gmail lo recorta`);
    if (/\{[a-z_]+\}/.test(html) || /\{[a-z_]+\}/.test(text)) problems.push(`${where}: quedó una variable sin reemplazar`);
    if (definition.button && definition.defaults[locale].ctaLabel && !html.includes(`href="${APP}/${locale}/overview"`)) {
      problems.push(`${where}: el botón no lleva a su enlace`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log(`EMAIL TEMPLATES RENDER OK (${renders} correos: ${CATALOGUE.length} plantillas × ${EMAIL_LOCALES.length} idiomas)`);
