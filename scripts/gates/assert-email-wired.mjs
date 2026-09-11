#!/usr/bin/env node
/**
 * E6 — Los avisos salen con el diseño, en el idioma de quien los recibe, y lo
 * editado en la consola gana sobre lo de fábrica.
 *
 * Se mide la precedencia en el código que decide, no la presencia de palabras:
 * `copyFor` tiene que devolver la fila editada cuando existe y el catálogo
 * sólo cuando no. Al revés, la consola guardaría y nada cambiaría.
 */
import { readFileSync } from 'node:fs';

const problems = [];
const read = (path) => readFileSync(path, 'utf8');

const copy = read('apps/web/src/server/email-copy.ts');
if (!/from\(emailTemplates\)/.test(copy)) problems.push('email-copy.ts no lee lo editado en platform.email_templates');
if (!/return row \?\? definition\.defaults\[locale\];/.test(copy)) {
  problems.push('email-copy.ts no pone lo editado antes que lo de fábrica');
}
if (!/renderEmail\(\{/.test(copy)) problems.push('email-copy.ts no arma el correo con el renderizador del catálogo');

const service = read('apps/web/src/server/notification-service.ts');
if (!/composeNoticeMail\(db, notice\.email, recipient\.locale/.test(service)) problems.push('el despacho no arma el correo en el idioma de la persona');
if (!/html: composed\?\.html/.test(service)) problems.push('el despacho no manda el HTML');
if (!/text: composed\?\.text \?\?/.test(service)) problems.push('el despacho no manda la versión en texto del correo');
if (!/\$\{appUrl\}\/\$\{recipient\.locale\}\$\{notice\.url\}/.test(service)) problems.push('el enlace del correo no lleva el idioma');

const reminders = read('apps/web/src/server/reminders.ts');
for (const key of ['commitment_due', 'statement_upload']) {
  if (!reminders.includes(`template: '${key}'`)) problems.push(`reminders.ts no manda «${key}» con su plantilla`);
}
if (!/locale: profiles\.locale/.test(reminders)) problems.push('reminders.ts no lee el idioma del perfil');

const mail = read('apps/web/src/server/mail.ts');
if (!/sendWithBrevo\(/.test(mail)) problems.push('mail.ts no usa el envío compartido de @app/email');

const signup = read('apps/web/src/server/auth-actions.ts');
if (!/locale: signUpLocale === 'en' \? 'en' : 'es'/.test(signup)) problems.push('el registro no guarda el idioma que lee Supabase');

// Control negativo: el oráculo de precedencia rechaza el orden invertido.
if (/return row \?\? definition\.defaults\[locale\];/.test('return definition.defaults[locale] ?? row;')) {
  problems.push('el oráculo de precedencia acepta el orden invertido');
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('EMAIL WIRED OK');
