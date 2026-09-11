#!/usr/bin/env node
/**
 * E3 — Un correo de cuenta no se puede guardar sin lo que lo hace funcionar.
 *
 * Tres capas, y el gate mide las tres:
 *   1. La validación rechaza el botón vacío donde el botón es obligatorio.
 *   2. Lo que se publica en Supabase lleva el enlace o el código en los dos
 *      idiomas, y no depende de ningún campo editable.
 *   3. El servidor de la consola valida antes de escribir, en cada escritura.
 */
import { readFileSync } from 'node:fs';

import { loadEmail } from './_email.mjs';

const { CATALOGUE, renderForSupabase, validateCopy } = await loadEmail();
const problems = [];

const gated = CATALOGUE.filter((one) => one.button?.required);
const coded = CATALOGUE.filter((one) => one.feature === 'code');
if (gated.length < 5) problems.push(`sólo ${gated.length} correos con botón obligatorio; confirmar, restablecer, entrar, invitar y cambiar correo lo necesitan`);
if (coded.length < 1) problems.push('ningún correo lleva código: el de verificación lo necesita');

for (const definition of gated) {
  for (const locale of ['es', 'en']) {
    const problemsFor = validateCopy(definition, { ...definition.defaults[locale], ctaLabel: '   ' });
    if (!problemsFor.some((one) => one.kind === 'button_required')) {
      problems.push(`${definition.key} (${locale}): se puede guardar sin el botón`);
    }
  }
  const { html } = renderForSupabase(definition, definition.defaults);
  const links = html.split('{{ .ConfirmationURL }}').length - 1;
  // Botón y enlace de respaldo, en cada idioma.
  if (links < 4) problems.push(`${definition.key}: el enlace aparece ${links} veces; se esperan 4 (botón y respaldo, dos idiomas)`);
}

for (const definition of coded) {
  const { html } = renderForSupabase(definition, {
    es: { ...definition.defaults.es, body: 'x' },
    en: { ...definition.defaults.en, body: 'x' },
  });
  // El código lo pone el diseño, no el cuerpo: sigue ahí aunque el cuerpo cambie.
  if (html.split('{{ .Token }}').length - 1 < 2) problems.push(`${definition.key}: el código no está en los dos idiomas`);
}

// Control negativo: sin la obligación, el mismo texto vacío sí pasa.
const loose = { ...gated[0], button: { required: false } };
if (validateCopy(loose, { ...loose.defaults.es, ctaLabel: '' }).some((one) => one.kind === 'button_required')) {
  problems.push('la validación marca el botón aunque no sea obligatorio: no está midiendo la obligación');
}

// La consola valida antes de escribir, en cada escritura de texto.
const actions = readFileSync('apps/admin/src/server/email-actions.ts', 'utf8');
for (const name of ['saveEmailTemplate', 'restoreEmailVersion', 'sendEmailTest']) {
  const start = actions.indexOf(`export async function ${name}`);
  const next = actions.indexOf('export async function', start + 1);
  const body = actions.slice(start, next === -1 ? undefined : next);
  const validates = body.indexOf('validateCopy(');
  const writes = Math.max(body.indexOf('writeCopy('), body.indexOf('sendWithBrevo('));
  if (start === -1 || validates === -1 || writes === -1 || validates > writes) {
    problems.push(`${name}: no valida el texto antes de escribirlo o enviarlo`);
  }
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log(`LOCKOUT GUARD OK (${gated.length} con enlace obligatorio, ${coded.length} con código)`);
