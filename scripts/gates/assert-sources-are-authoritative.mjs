#!/usr/bin/env node
/**
 * G17 — Ningún término de una tarjeta sale de una fuente sin autoridad.
 *
 * El catálogo afirmaba que una Visa ConnectMiles Platinum de Banco General daba
 * «una milla por cada US$3.00 de compra». La página del producto dice «1 milla
 * por cada dólar de compra en otros comercios»; el $3 es sólo para impuestos y
 * multas. La casa creía que su tarjeta rinde un tercio de lo que rinde.
 *
 * El error no fue leer mal un número: fue leerlo de la página equivocada — una
 * promoción de «doble millas de bienvenida», que describe la bienvenida y ni
 * menciona la tasa base.
 *
 * Y al auditar aparecieron dos filas peores: una de un blog y otra de un diario.
 *
 * Este gate mide tres cosas que ninguna prueba de código puede ver.
 */
import { connect } from './_db.mjs';

const sql = connect();
const problems = [];

/*
  1. Toda fila declara de qué clase es su fuente, y sólo de las cuatro con
     autoridad. Un blog o un diario no tienen dónde encajar.
*/
const kinds = await sql`
  select source_kind, count(*)::int as n
  from platform.card_benefit_catalogue group by 1 order by 1`;

const allowed = new Set(['product_page', 'network', 'regulator', 'comparator', 'promotion']);
for (const row of kinds) {
  if (!allowed.has(row.source_kind)) {
    problems.push(`${String(row.n)} filas citan una fuente de clase «${row.source_kind}»`);
  }
}

/*
  2. Una tasa de acumulación nunca desde una promoción.

     Es el error exacto que costó el 3x. Una promoción describe la promoción; lo
     que la tarjeta da todos los días está en otra página.
*/
const [promoRates] = await sql`
  select count(*)::int as n from platform.card_benefit_catalogue
  where kind in ('miles', 'points', 'cashback') and source_kind = 'promotion'`;
if (promoRates.n > 0) {
  problems.push(`${String(promoRates.n)} tasas de acumulación salen de una página de promoción`);
}

/*
  3. Nada de dominios que no sean el emisor, su red o el regulador.

     Se comprueba por lista negra y no por lista blanca a propósito: una lista
     blanca hay que ampliarla cada vez que entra un banco, y la vez que alguien
     se olvide de ampliarla el gate va a rechazar un dato bueno — que enseña a
     desactivarlo. La negra sólo crece cuando aparece una fuente mala.
*/
const banned = ['hellofyros', 'laestrella.com.pa', 'medium.com', 'blogspot', 'wordpress.com',
                'reddit.com', 'facebook.com', 'youtube.com', 'wikipedia.org'];
const rows = await sql`select id, label, source_url from platform.card_benefit_catalogue`;
for (const row of rows) {
  const bad = banned.find((one) => row.source_url.includes(one));
  if (bad) problems.push(`«${row.label}» sale de ${bad}, que no es el emisor ni su red ni el regulador`);
}

/*
  4. Y las llaves de programa del catálogo existen en el catálogo de programas.

     Banistmo reemplazó «Regálate» por «MultiPuntos» y las cuatro URLs del viejo
     devuelven 404. Una llave huérfana es un programa que ya no existe todavía
     ofreciéndose como propio.
*/
const orphans = await sql`
  select distinct c.issuer_key, c.program_key
  from platform.card_benefit_catalogue c
  where c.program_key is not null
    and not exists (
      select 1 from platform.card_programs p
      where p.issuer_key = c.issuer_key and p.program_key = c.program_key
    )`;
for (const row of orphans) {
  problems.push(`el programa ${row.issuer_key}/${row.program_key} no existe en el catálogo de programas`);
}

const [total] = await sql`select count(*)::int as n from platform.card_benefit_catalogue`;

await sql.end();

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log(`SOURCES ARE AUTHORITATIVE OK (${String(total.n)} filas)`);
