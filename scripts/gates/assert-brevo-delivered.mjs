#!/usr/bin/env node
/**
 * E11 — Un correo con el diseño nuevo sale por Brevo y queda entregado.
 *
 * Se manda el aviso de estados de cuenta, renderizado por el paquete compilado,
 * a la dirección remitente verificada —la única a la que este gate escribe— y
 * se espera a que Brevo registre la entrega. «Aceptado» no alcanza: Brevo
 * acepta y después rebota, y el rebote es justo lo que hay que ver.
 */
import { loadEmail, loadSecrets } from './_email.mjs';

const { definitionFor, renderEmail, sendWithBrevo } = await loadEmail();
const secrets = loadSecrets();
const { BREVO_API_KEY: apiKey, MAIL_FROM_EMAIL: from } = secrets;
if (!apiKey || !from) {
  console.error('- faltan BREVO_API_KEY o MAIL_FROM_EMAIL');
  process.exit(1);
}

const definition = definitionFor('statement_upload');
const app = 'https://norte-web-three.vercel.app';
const rendered = renderEmail({
  definition,
  copy: definition.defaults.es,
  locale: 'es',
  mode: 'send',
  values: {},
  appUrl: app,
  buttonUrl: `${app}/es/imports`,
});

const outcome = await sendWithBrevo(
  { apiKey, fromEmail: from, fromName: secrets.MAIL_FROM_NAME ?? 'Cifraapp' },
  { to: from, subject: `[Prueba de diseño] ${rendered.subject}`, text: rendered.text, html: rendered.html },
);
if (outcome.status !== 'sent' || !outcome.id) {
  console.error(`- Brevo no aceptó el envío: ${outcome.reason ?? 'sin id'}`);
  process.exit(1);
}

const messageId = outcome.id;
for (let attempt = 0; attempt < 24; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const response = await fetch(
    `https://api.brevo.com/v3/smtp/statistics/events?messageId=${encodeURIComponent(messageId)}&limit=20`,
    { headers: { 'api-key': apiKey, accept: 'application/json' } },
  );
  if (!response.ok) continue;
  const events = ((await response.json()).events ?? []).map((one) => one.event);
  if (events.some((one) => /bounce|blocked|invalid|error/i.test(one))) {
    console.error(`- Brevo registró: ${events.join(', ')}`);
    process.exit(1);
  }
  if (events.includes('delivered')) {
    console.log(`eventos: ${events.join(', ')}`);
    console.log(`BREVO DELIVERED OK (${Buffer.byteLength(rendered.html)} bytes de HTML)`);
    process.exit(0);
  }
}

console.error('- Brevo no registró la entrega en dos minutos');
process.exit(1);
