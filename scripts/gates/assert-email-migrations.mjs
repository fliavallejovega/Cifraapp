#!/usr/bin/env node
/**
 * E5 — Las tablas de plantillas y versiones existen en la base real, cerradas
 * como el resto de `platform`, y legibles por la conexión que las usa.
 *
 * Las dos mitades importan. Una tabla abierta a `authenticated` deja leer
 * borradores de correos de seguridad; una tabla que la conexión del despacho no
 * puede leer tumba el envío de avisos — que es lo que pasó con
 * `program_balances` y un GRANT olvidado.
 */
import { connect } from './_db.mjs';

const sql = connect();
const problems = [];

try {
  const tables = await sql`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'platform' and c.relname in ('email_templates', 'email_template_versions')`;
  for (const name of ['email_templates', 'email_template_versions']) {
    const table = tables.find((one) => one.relname === name);
    if (!table) { problems.push(`platform.${name} no existe`); continue; }
    if (!table.relrowsecurity || !table.relforcerowsecurity) problems.push(`platform.${name} sin seguridad de fila forzada`);
  }

  const leaks = await sql`
    select table_name, grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'platform' and table_name in ('email_templates', 'email_template_versions')
       and grantee in ('anon', 'authenticated')`;
  for (const one of leaks) problems.push(`${one.grantee} tiene ${one.privilege_type} sobre platform.${one.table_name}`);

  const pk = await sql`
    select string_agg(a.attname, ',' order by array_position(i.indkey, a.attnum)) as cols
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = 'platform.email_templates'::regclass and i.indisprimary`;
  if (pk[0]?.cols !== 'template_key,locale') problems.push(`la llave de email_templates es «${pk[0]?.cols}», no (template_key, locale)`);

  const checks = await sql`
    select conname from pg_constraint
     where conrelid in ('platform.email_templates'::regclass, 'platform.email_template_versions'::regclass)`;
  for (const name of ['email_templates_locale_check', 'email_templates_body_length', 'email_template_versions_unique', 'email_template_versions_reason_check']) {
    if (!checks.some((one) => one.conname === name)) problems.push(`falta la restricción ${name}`);
  }

  // La conexión que usan la consola y el despacho puede leer y escribir.
  await sql.begin(async (tx) => {
    await tx`select count(*) from platform.email_templates`;
    await tx`insert into platform.email_template_versions (template_key, locale, version, subject, preheader, heading, body, cta_label, footnote)
             values ('gate_probe', 'es', 1, 's', '', 'h', 'b', '', '')`;
    // Control negativo: un idioma que no existe tiene que rebotar.
    const rejected = await tx`savepoint probe`.then(() =>
      tx`insert into platform.email_templates (template_key, locale, subject, heading, body) values ('gate_probe', 'fr', 's', 'h', 'b')`
        .then(() => false, () => true));
    if (!rejected) problems.push('la base acepta un idioma que no es es/en');
    throw new Error('rollback');
  }).catch((error) => {
    if (String(error).includes('rollback')) return;
    problems.push(`la conexión de servicio no puede usar las tablas: ${String(error).slice(0, 160)}`);
  });
} finally {
  await sql.end();
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('EMAIL MIGRATIONS OK');
