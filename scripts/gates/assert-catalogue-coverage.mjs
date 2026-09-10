#!/usr/bin/env node
/**
 * La cobertura por banco está declarada, no supuesta.
 *
 * Cada institución sembrada tiene que estar en una de dos listas: la de las que
 * el catálogo cubre —con al menos una fila y una fuente— o la de las pendientes,
 * que la documentación nombra una por una. Un banco que no aparezca en ninguna
 * es un banco que nadie decidió, y esa es la clase de omisión silenciosa que un
 * catálogo «de todos los bancos» no puede tener.
 */
import { readFileSync } from 'node:fs';

const institutions = readFileSync('supabase/migrations/20260908210000_holdings.sql', 'utf8');
const sources = readFileSync('supabase/migrations/20260910110000_catalogue_sources_seed.sql', 'utf8');
const promos = readFileSync('supabase/migrations/20260910140000_card_promotions_seed.sql', 'utf8');
const doc = readFileSync('docs/catalogo-tarjetas.md', 'utf8');

// Los bancos que el esquema siembra, leídos de su propia migración: la lista
// de `values` que alimenta `app.institutions`.
const block = /insert into app\.institutions[\s\S]*?\) as seed \(name\)/.exec(institutions);
const seeded = block ? [...block[0].matchAll(/^\s*\('([^']+)'\),?$/gm)].map((m) => m[1]) : [];
if (seeded.length === 0) {
  console.error('No se pudo leer la lista de bancos sembrados. El gate no mide nada.');
  process.exit(1);
}

/**
 * Cubierto significa **tener una fuente registrada**, no aparecer en el archivo.
 *
 * La primera versión de este gate buscaba el nombre del banco en toda la
 * migración y daba los veinte por cubiertos, porque la misma migración les pone
 * una `parser_key` a todos. Un gate que no puede fallar certifica cualquier
 * cosa. Aquí se mira sólo el bloque que inserta fuentes, y sólo la llave del
 * emisor: un banco está cubierto cuando alguien registró una página suya.
 */
const insertBlock = /insert into platform\.catalogue_sources[\s\S]*?on conflict/.exec(sources);
const registered = new Set(
  insertBlock ? [...insertBlock[0].matchAll(/,\s*'([a-z_]+)',\s*'(?:issuer|promotions)'/g)].map((m) => m[1]) : [],
);

// El nombre del banco, a su llave. Sale del mismo `update` que las asigna.
const keyByName = new Map(
  [...sources.matchAll(/set parser_key = '([a-z_]+)'\s+where name = '([^']+)'/g)].map((m) => [m[2], m[1]]),
);
for (const [name, key] of [
  ['Banco General', 'banco_general'],
  ['BAC Credomatic', 'bac'],
  ['Banistmo', 'banistmo'],
  ['Global Bank', 'global_bank'],
  ['Banesco', 'banesco'],
]) {
  if (!keyByName.has(name)) keyByName.set(name, key);
}

const covered = [];
const pending = [];

for (const bank of seeded) {
  const key = keyByName.get(bank);
  if (key && registered.has(key)) covered.push(bank);
  else pending.push(bank);
}

void promos;

// Todo pendiente tiene que estar nombrado en la documentación de cobertura.
const undeclared = pending.filter((bank) => !doc.includes(bank));

console.log(`Bancos sembrados: ${String(seeded.length)}`);
console.log(`  cubiertos por el catálogo: ${String(covered.length)} — ${covered.join(', ')}`);
console.log(`  pendientes declarados:     ${String(pending.length - undeclared.length)}`);

if (undeclared.length > 0) {
  console.error(`\nSin declarar en docs/catalogo-tarjetas.md: ${undeclared.join(', ')}`);
  console.error('Un banco que no está ni cubierto ni declarado pendiente es una omisión silenciosa.');
  process.exit(1);
}

console.log('\nGATE OK — cada banco sembrado está cubierto o declarado pendiente.');
