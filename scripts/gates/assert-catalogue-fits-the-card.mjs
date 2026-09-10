#!/usr/bin/env node
/**
 * G15 — A una tarjeta sólo se le ofrece lo que puede ser suyo.
 *
 * La pantalla le ofrecía a una Visa ConnectMiles de Banco General los programas
 * Estrellas y CashBack —tres programas incompatibles como si tuviera los tres— y
 * «la anualidad más baja del mercado: US$84 en Davivienda», con un botón que
 * decía «Tengo este». Eso es pedirle a alguien declarar como propio un dato
 * sobre otro banco.
 *
 * Se mide contra la base con la misma consulta que usa el producto.
 */
import { readFileSync } from 'node:fs';

import { connect } from './_db.mjs';

const strip = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const problems = [];
const sql = connect();

/** El mismo filtro que el repositorio, escrito una vez y usado por los dos casos. */
const catalogueFor = async ({ issuerKey, network, tier, program }) => sql`
  select label, program_key as program, is_market_reference
  from platform.card_benefit_catalogue
  where (issuer_key is null or issuer_key = ${issuerKey})
    and (network is null or network = ${network})
    and (tier is null or tier = ${tier})
    and (program_key is null or program_key = ${program})`;

// El caso real: la Visa ConnectMiles de Banco General.
const rows = await catalogueFor({
  issuerKey: 'banco_general',
  network: 'visa',
  tier: 'platinum',
  program: 'connectmiles',
});

const offered = rows.filter((row) => !row.is_market_reference).map((row) => row.program);

for (const wrong of ['estrellas', 'cashback']) {
  if (offered.includes(wrong)) {
    problems.push(`a una ConnectMiles se le ofrece el programa ${wrong}`);
  }
}
if (!offered.includes('connectmiles')) {
  problems.push('a una ConnectMiles no se le ofrece su propio programa');
}

// Y el filtro tiene que estar en el código, no sólo en esta consulta.
const repo = strip(readFileSync('apps/web/src/server/repositories/card-catalogue.ts', 'utf8'));
if (!repo.includes('matches(cardBenefitCatalogue.programKey, card.program)')) {
  problems.push('el repositorio no filtra por programa');
}
if (!repo.includes('marketReferences')) {
  problems.push('el repositorio no separa las referencias de mercado');
}

// Ninguna referencia de mercado puede llegar a la lista que se adopta.
const ui = strip(readFileSync('apps/web/src/components/cards-manager.tsx', 'utf8'));
const adopt = ui.slice(ui.indexOf('function AdoptBenefit'));
if (adopt.includes('marketReferences')) {
  problems.push('una referencia de mercado se puede adoptar como propia');
}
if (!ui.includes('card.marketReferences')) {
  problems.push('la pantalla no enseña las referencias de mercado en su propia sección');
}

// Y las seis siguen marcadas: un update posterior podría desmarcarlas.
const [marked] = await sql`
  select count(*)::int as n from platform.card_benefit_catalogue
  where is_market_reference and label like '%mercado%'`;
if (marked.n < 6) {
  problems.push(`sólo ${String(marked.n)} referencias de mercado están marcadas; eran 6`);
}

await sql.end();

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('CATALOGUE FITS THE CARD OK');
