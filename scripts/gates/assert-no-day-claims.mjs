#!/usr/bin/env node
/**
 * G14 — Una promoción sin días declarados nunca sale como disponible hoy.
 *
 * Este producto trató el silencio de una fuente como una afirmación: cuatro
 * promociones con el arreglo de días vacío se enseñaban como «todos los días»
 * con un «Hoy» verde encima. Un 50% que en realidad es los martes, marcado
 * disponible un jueves, manda a una familia a comer confiando en un descuento
 * que ese día no existe.
 *
 * Se mide en los tres sitios donde la regla puede romperse: la consulta que
 * calcula si sirve hoy, el texto que la describe, y la base que la guarda.
 */
import { readFileSync } from 'node:fs';

import { connect } from './_db.mjs';

const strip = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const problems = [];

// 1. La consulta. Un vacío no puede contar como hoy.
const repo = strip(readFileSync('apps/web/src/server/repositories/offers.ts', 'utf8'));
if (/weekdays\.length === 0 \|\|/.test(repo)) {
  problems.push('la consulta sigue tratando «sin días» como «todos los días»');
}
if (!repo.includes('row.weekdays.length > 0 && row.weekdays.includes(weekdayToday)')) {
  problems.push('la consulta no exige días declarados para marcar algo como de hoy');
}

// 2. El texto. «Todos los días» era la afirmación, y no puede volver.
for (const file of [
  'apps/web/src/components/offers-board.tsx',
  'apps/web/src/components/cards-manager.tsx',
]) {
  const source = strip(readFileSync(file, 'utf8'));
  if (/everyDay/.test(source)) {
    problems.push(`${file} vuelve a decir «todos los días» cuando la fuente no lo dijo`);
  }
}

// 3. La base. El barrido mensual inserta sin pasar por la pantalla.
const sql = connect();

const [loose] = await sql`
  select count(*)::int as n from platform.card_promotions
  where status = 'verified' and cardinality(weekdays) = 0`;
if (loose.n > 0) {
  problems.push(`${String(loose.n)} promociones comprobadas no declaran sus días`);
}

const [guard] = await sql`
  select 1 as ok from pg_constraint
  where conname = 'card_promotions_verified_declares_days'`;
if (!guard) {
  problems.push('la base no impide que una fila comprobada omita sus días');
}

await sql.end();

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('NO DAY CLAIMS OK');
