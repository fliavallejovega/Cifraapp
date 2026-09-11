#!/usr/bin/env node
/**
 * Conecta el SMTP de Brevo a Supabase, para que los correos de cuenta salgan
 * por Brevo con el diseño de Cifraapp.
 *
 * Dos razones, y las dos son de producción:
 *   - El servidor propio de Supabase manda dos correos por hora para todo el
 *     proyecto. La tercera persona que se registra en una hora no recibe su
 *     confirmación y no puede entrar.
 *   - En el plan gratuito, Supabase no deja cambiar las plantillas mientras
 *     mande con su servidor. Sin SMTP propio, los correos de cuenta quedan con
 *     el texto en inglés de fábrica de Supabase.
 *
 * Necesita `BREVO_SMTP_KEY` —una clave SMTP de Brevo, `xsmtpsib-…`, distinta
 * de la clave de la API— en `.claude/settings.local.json` o `.env.local`. El
 * usuario SMTP se lee de la cuenta de Brevo. Nunca imprime una clave.
 *
 *   node scripts/connect-supabase-smtp.mjs            # conecta
 *   node scripts/connect-supabase-smtp.mjs --dry-run  # sólo comprueba
 */
import { loadSecrets, supabaseConfig } from './gates/_email.mjs';

const dryRun = process.argv.includes('--dry-run');
const secrets = loadSecrets();

for (const key of ['BREVO_API_KEY', 'BREVO_SMTP_KEY', 'MAIL_FROM_EMAIL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF']) {
  if (!secrets[key]) {
    console.error(`- falta ${key}`);
    process.exit(1);
  }
}
if (!secrets.BREVO_SMTP_KEY.startsWith('xsmtpsib-')) {
  console.error('- BREVO_SMTP_KEY no parece una clave SMTP de Brevo (empiezan con xsmtpsib-)');
  process.exit(1);
}

const account = await fetch('https://api.brevo.com/v3/account', {
  headers: { 'api-key': secrets.BREVO_API_KEY, accept: 'application/json' },
}).then((response) => response.json());
const relay = account.relay?.data;
if (!account.relay?.enabled || !relay?.userName) {
  console.error('- la cuenta de Brevo no tiene el relay SMTP activo');
  process.exit(1);
}

const fields = {
  smtp_host: relay.relay ?? 'smtp-relay.brevo.com',
  smtp_port: String(relay.port ?? 587),
  smtp_user: relay.userName,
  smtp_pass: secrets.BREVO_SMTP_KEY,
  smtp_admin_email: secrets.MAIL_FROM_EMAIL,
  smtp_sender_name: secrets.MAIL_FROM_NAME ?? 'Cifraapp',
  // Con un SMTP propio el tope lo pone Supabase por hora; 30 alcanza para un
  // día de registros sin dejar de proteger contra un abuso del formulario.
  rate_limit_email_sent: 30,
};

console.log(`Brevo: relay ${fields.smtp_host}:${fields.smtp_port}, remitente ${fields.smtp_admin_email}.`);
if (dryRun) process.exit(0);

await supabaseConfig(secrets, 'PATCH', fields);
const after = await supabaseConfig(secrets);
if (after.smtp_host !== fields.smtp_host) {
  console.error('- Supabase no guardó el SMTP');
  process.exit(1);
}
console.log('SMTP conectado. Ahora: node scripts/publish-auth-emails.mjs');
