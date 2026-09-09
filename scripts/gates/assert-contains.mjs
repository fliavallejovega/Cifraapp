#!/usr/bin/env node
// Comprueba que un archivo existe y contiene un símbolo. Un gate de presencia:
// dice que la pieza está donde el plan dijo que estaría, no que funcione — eso
// lo dicen las pruebas.
import { readFileSync } from 'node:fs';

const [file, needle] = process.argv.slice(2);
if (!file || !needle) {
  console.error('uso: assert-contains.mjs <archivo> <símbolo>');
  process.exit(2);
}

let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error(`No existe ${file}.`);
  process.exit(1);
}

if (!text.includes(needle)) {
  console.error(`${file} no contiene «${needle}».`);
  process.exit(1);
}

console.log(`GATE OK — ${file} define ${needle}.`);
