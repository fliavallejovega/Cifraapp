#!/usr/bin/env node
/**
 * G1 — El cruce de una importación abarca el hogar entero.
 *
 * Se mide sobre la fuente y no sobre una corrida: el filtro es una línea, y una
 * línea que vuelva a decir `accountId` reintroduce el bug entero sin romper
 * ninguna prueba de comportamiento.
 */
import { readFileSync } from 'node:fs';

const file = 'apps/web/src/server/import-service.ts';
const source = readFileSync(file, 'utf8');
const problems = [];

// El bloque que carga el conjunto de comparación.
const start = source.indexOf('const storedRows =');
const end = source.indexOf('const counts = {', start);
if (start === -1 || end === -1) problems.push('no se encontró el bloque del conjunto de comparación');

/**
 * Sin comentarios.
 *
 * La primera versión de este gate falló contra su propio arreglo: el comentario
 * que explica el bug cita la línea vieja, y un gate que lee prosa mide la prosa.
 * Se quitan los comentarios antes de decidir.
 */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const block = stripComments(source.slice(start, end));

if (!block.includes('eq(transactions.householdId, input.householdId)')) {
  problems.push('el conjunto de comparación no filtra por hogar');
}
if (/eq\(transactions\.accountId,\s*input\.accountId\)/.test(block)) {
  problems.push('el conjunto de comparación sigue limitado a una sola cuenta');
}
if (!block.includes('accountName')) {
  problems.push('la coincidencia no viaja con el nombre de su cuenta');
}
if (!stripComments(source).includes('matchedAccountId: matchedId')) {
  problems.push('la fila no guarda en qué cuenta está la coincidencia');
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('HOUSEHOLD SCOPE OK');
