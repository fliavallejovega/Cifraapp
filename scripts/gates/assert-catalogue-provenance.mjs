#!/usr/bin/env node
/**
 * Ninguna línea del catálogo sin procedencia.
 *
 * Se comprueba contra las migraciones de siembra y no contra la base, para que
 * el gate corra sin credenciales y para que lo que se verifique sea el código
 * que se va a desplegar. Cada fila insertada tiene que llevar una dirección
 * `http` y una fecha `AAAA-MM-DD`: sin las dos, la línea es indistinguible de
 * una inventada, que es exactamente lo que este catálogo no puede permitirse.
 */
import { readFileSync } from 'node:fs';

const SEEDS = [
  'supabase/migrations/20260909410000_card_benefit_catalogue_seed.sql',
  'supabase/migrations/20260910120000_catalogue_more_issuers.sql',
  'supabase/migrations/20260910140000_card_promotions_seed.sql',
];

let rows = 0;
let bad = 0;

/**
 * Sólo las tablas de **datos**, no la de fuentes.
 *
 * `catalogue_sources` guarda las direcciones que el barrido relee y por diseño
 * no lleva fecha de lectura: la fecha vive en `fetched_at` y la pone el barrido,
 * no la siembra. Exigírsela hacía fallar el gate por seis filas correctas, que
 * es la forma más rápida de que alguien lo desactive.
 */
const DATA_TABLES = ['card_benefit_catalogue', 'card_promotions'];

/**
 * Las tuplas de un `values`, contadas con un recorrido y no con una expresión.
 *
 * La primera versión usaba una expresión regular sobre varias líneas y contaba
 * siete de cuarenta y nueve: una tupla que abarca cinco líneas con comillas,
 * arreglos y `::text[]` dentro no es algo que una expresión empareje bien, y el
 * gate quedaba certificando el 14% de lo que decía medir.
 *
 * Un recorrido carácter a carácter que respeta las comillas no tiene ese
 * problema y se lee entero.
 */
function tuplesOf(statement) {
  const tuples = [];
  let depth = 0;
  let quoted = false;
  let current = '';

  for (let at = 0; at < statement.length; at += 1) {
    const char = statement[at];

    // El fin de la sentencia, pero sólo fuera de comillas y fuera de un
    // paréntesis: uno de los textos sembrados dice «...su propia vigencia;
    // confirmala en la página», y partir por ahí recortaba el `insert` a dos
    // filas de veintisiete. El gate certificaba el 14% de lo que decía medir.
    if (!quoted && depth === 0 && char === ';') break;

    if (quoted) {
      current += char;
      // Dos comillas seguidas dentro de una cadena son una comilla escapada.
      if (char === "'" && statement[at + 1] === "'") {
        current += statement[at + 1];
        at += 1;
      } else if (char === "'") {
        quoted = false;
      }
      continue;
    }

    if (char === "'") {
      quoted = true;
      current += char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      if (depth === 1) {
        current = '(';
        continue;
      }
    }

    if (depth > 0) current += char;

    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        tuples.push(current);
        current = '';
      }
    }
  }

  return tuples;
}

for (const path of SEEDS) {
  const text = readFileSync(path, 'utf8');

  for (const block of text.split(/insert into /).slice(1)) {
    const table = block.split(/[\s(]/)[0] ?? '';
    if (!DATA_TABLES.some((one) => table.endsWith(one))) continue;

    // La primera tupla de un `insert` es la lista de columnas, no una fila.
    const tuples = tuplesOf(block).slice(1);

    for (const tuple of tuples) {
      // `array[...]` y `now()` abren paréntesis propios: una tupla real lleva
      // al menos una cadena con comillas.
      if (!tuple.includes("'")) continue;
      rows += 1;

      const hasUrl = /'https?:\/\/[^']+'/.test(tuple);
      const hasDate = /'\d{4}-\d{2}-\d{2}'/.test(tuple);

      if (!hasUrl || !hasDate) {
        bad += 1;
        const head = tuple.slice(0, 90).replace(/\s+/g, ' ');
        console.error(
          `SIN PROCEDENCIA  ${path}\n  ${head}…\n  ${hasUrl ? '' : 'falta la dirección. '}${hasDate ? '' : 'falta la fecha de lectura.'}`,
        );
      }
    }
  }
}

if (rows === 0) {
  console.error('No se encontró ninguna fila sembrada. El gate no puede pasar sin medir nada.');
  process.exit(1);
}

if (bad > 0) {
  console.error(`\n${String(bad)} de ${String(rows)} filas sin procedencia.`);
  process.exit(1);
}

console.log(`GATE OK — ${String(rows)} filas sembradas, todas con dirección y fecha de lectura.`);
