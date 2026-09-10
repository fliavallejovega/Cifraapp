#!/usr/bin/env node
/**
 * G16 — Ninguna tabla del hogar existe sin que el rol de la aplicación la pueda leer.
 *
 * `enable row level security` decide **qué filas** ve un rol; `grant` decide si
 * puede mirar la tabla siquiera. Postgres evalúa el grant primero, así que una
 * tabla con la política perfecta y sin grant responde «permission denied» sin
 * llegar a la política.
 *
 * La pantalla de tarjetas se cayó entera por esto. Y una segunda tabla tenía el
 * mismo hueco esperando a que algo la leyera.
 *
 * Este proyecto otorga permisos tabla por tabla a propósito —una tabla nueva no
 * debería volverse legible por existir— y el costo de esa decisión es que hay
 * que acordarse. Esto reemplaza el acordarse.
 */
import { connect } from './_db.mjs';

const sql = connect();
const problems = [];

/**
 * Toda tabla de `app`, y si el rol de la aplicación puede tocarla.
 *
 * Se pregunta por los cuatro permisos y no sólo por select: una tabla que se
 * puede leer y no escribir revienta igual, sólo que más tarde y en el acto de
 * guardar, que es cuando más cuesta.
 */
const rows = await sql`
  select
    c.relname as name,
    c.relrowsecurity as rls,
    has_table_privilege('authenticated', 'app.' || quote_ident(c.relname), 'SELECT') as can_select,
    has_table_privilege('authenticated', 'app.' || quote_ident(c.relname), 'INSERT') as can_insert
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and c.relkind = 'r'
  order by c.relname`;

if (rows.length === 0) problems.push('no se encontró ninguna tabla en el esquema app');

for (const row of rows) {
  if (!row.can_select) problems.push(`app.${row.name} no se puede leer con el rol de la aplicación`);

  /*
    Y toda tabla legible del hogar tiene que tener RLS.

    Un grant sin política es lo contrario del bug de arriba y es peor: en vez de
    no ver nada, se ve todo — las filas de las demás casas incluidas. Las tablas
    de referencia que son iguales para todos no tienen `household_id` y quedan
    fuera de esta exigencia.
  */
  const looksShared = ['category_templates', 'institutions', 'organizations', 'currencies'];
  if (row.can_select && !row.rls && !looksShared.includes(row.name)) {
    const [scoped] = await sql`
      select 1 as yes from information_schema.columns
      where table_schema = 'app' and table_name = ${row.name} and column_name = 'household_id'`;
    if (scoped) problems.push(`app.${row.name} tiene datos de un hogar y no tiene RLS`);
  }
}

await sql.end();

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log(`TABLES ARE REACHABLE OK (${String(rows.length)} tablas)`);
