#!/usr/bin/env node
/**
 * Publica en Supabase los correos de cuenta, con lo editado en la consola.
 *
 * Es lo mismo que hace el botón «Save and publish» de la consola, para cuando
 * la consola no puede: un despliegue sin token de Supabase, o el primer
 * despliegue del diseño. Nunca imprime el token.
 *
 *   node scripts/publish-auth-emails.mjs            # publica
 *   node scripts/publish-auth-emails.mjs --dry-run  # sólo dice qué cambiaría
 */
import { connect } from './gates/_db.mjs';
import { effectiveCopiesFromDb, loadEmail, loadSecrets, supabaseConfig } from './gates/_email.mjs';

const dryRun = process.argv.includes('--dry-run');
const { CATALOGUE, supabaseFieldsFor } = await loadEmail();
const secrets = loadSecrets();
const sql = connect();

const fields = {};
try {
  for (const definition of CATALOGUE.filter((one) => one.channel === 'supabase')) {
    Object.assign(fields, supabaseFieldsFor(definition, await effectiveCopiesFromDb(sql, definition)));
  }
} finally {
  await sql.end();
}

// Supabase interpreta `{{ … }}` como código. Antes de mandar nada se comprueba
// que las únicas expresiones sean las que el catálogo pone: una más es un
// correo que Supabase podría no poder armar, y eso deja a alguien sin entrar.
const ALLOWED = new Set([
  '{{ if eq (printf "%v" .Data.locale) "en" }}',
  '{{ else }}',
  '{{ end }}',
  '{{ .ConfirmationURL }}',
  '{{ .Token }}',
  '{{ .SiteURL }}',
  '{{ .Email }}',
  '{{ .NewEmail }}',
  '{{ .OldEmail }}',
  '{{ .Phone }}',
  '{{ .OldPhone }}',
  '{{ .Provider }}',
  '{{ .FactorType }}',
]);
for (const [field, value] of Object.entries(fields)) {
  for (const expression of value.match(/\{\{.*?\}\}/g) ?? []) {
    if (!ALLOWED.has(expression)) {
      console.error(`- ${field} lleva una expresión que el catálogo no pone: ${expression}`);
      process.exit(1);
    }
  }
  const opens = (value.match(/\{\{/g) ?? []).length;
  const closes = (value.match(/\}\}/g) ?? []).length;
  if (field.endsWith('_content') ? opens > closes : opens !== closes) {
    console.error(`- ${field} tiene llaves desbalanceadas`);
    process.exit(1);
  }
}

const live = await supabaseConfig(secrets);
const changed = Object.keys(fields).filter((field) => live[field] !== fields[field]);
console.log(`${changed.length} de ${Object.keys(fields).length} campos distintos de lo que Supabase tiene.`);

if (dryRun || changed.length === 0) process.exit(0);

// En el plan gratuito, Supabase rechaza cambiar plantillas mientras mande con
// su propio servidor. Se dice antes de intentarlo, con lo que hay que hacer.
if (!live.smtp_host) {
  console.error('- Supabase todavía manda con su propio servidor de correo, y en el plan gratuito');
  console.error('  no deja cambiar plantillas sin un SMTP propio. Primero:');
  console.error('    node scripts/connect-supabase-smtp.mjs   (necesita BREVO_SMTP_KEY)');
  process.exit(1);
}

await supabaseConfig(secrets, 'PATCH', fields);
console.log('Publicado.');
