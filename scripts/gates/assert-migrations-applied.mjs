#!/usr/bin/env node
/**
 * G8 — Toda migración de esta tanda está aplicada, no sólo escrita.
 *
 * Una migración en el repositorio y una migración en la base son dos cosas
 * distintas, y confundirlas es cómo se despliega una pantalla que consulta una
 * columna que no existe. Se mide contra `information_schema`.
 */
import { connect } from './_db.mjs';

const EXPECTED = [
  ['app', 'debts', 'counterparty_name'],
  ['app', 'debts', 'counterparty_normalized'],
  ['app', 'debt_payments', 'debt_id'],
  ['app', 'debt_payments', 'reversed_at'],
  ['app', 'import_rows', 'matched_account_id'],
  ['app', 'import_rows', 'proposed_category_id'],
  ['app', 'import_rows', 'proposed_source'],
  ['app', 'import_rows', 'chosen_category_id'],
  ['app', 'import_rows', 'apply_to_debt_id'],
  ['app', 'import_rows', 'ai_opinion'],
  ['app', 'imports', 'read_by_ocr'],
  ['platform', 'card_programs', 'program_key'],
  ['platform', 'card_promotions', 'programs'],
  ['app', 'accounts', 'card_program'],
];

const sql = connect();
const problems = [];

const rows = await sql`
  select table_schema, table_name, column_name
  from information_schema.columns
  where table_schema in ('app', 'platform')`;

const present = new Set(rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));

for (const [schema, table, column] of EXPECTED) {
  if (!present.has(`${schema}.${table}.${column}`)) {
    problems.push(`falta ${schema}.${table}.${column}`);
  }
}

// RLS en la tabla nueva: una tabla de la casa sin RLS la lee cualquiera.
const [rls] = await sql`
  select relrowsecurity from pg_class
  where oid = 'app.debt_payments'::regclass`;
if (!rls?.relrowsecurity) problems.push('app.debt_payments no tiene RLS activa');

await sql.end();

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('MIGRATIONS APPLIED OK');
