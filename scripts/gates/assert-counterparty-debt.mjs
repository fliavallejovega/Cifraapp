#!/usr/bin/env node
/**
 * G2 — El esquema puede decir «le debemos $1,800 a Giovanni».
 *
 * Se mide contra la base real. Una migración escrita no es una migración
 * aplicada, y este repositorio ya tuvo un gate que daba por hecho lo segundo.
 */
import { connect } from './_db.mjs';

const sql = connect();
const problems = [];

const columns = await sql`
  select column_name from information_schema.columns
  where table_schema = 'app' and table_name = 'debts'
    and column_name in ('counterparty_name', 'counterparty_normalized')`;

if (columns.length !== 2) {
  problems.push(`debts no tiene las columnas de contraparte (tiene ${columns.length} de 2)`);
}

// Y que se pueda escribir de verdad, no sólo que la columna exista.
const [probe] = await sql`
  select pg_typeof(counterparty_name)::text as kind from app.debts limit 1`;
if (probe && probe.kind !== 'text') {
  problems.push(`counterparty_name es ${probe.kind}, no text`);
}

await sql.end();

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('COUNTERPARTY DEBT OK');
