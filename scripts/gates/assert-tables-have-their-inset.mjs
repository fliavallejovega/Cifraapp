#!/usr/bin/env node
/**
 * G19 — Una tabla dentro de una tarjeta sin relleno tiene que traer el suyo.
 *
 * Las celdas del `Ledger` usan `first:pl-0 last:pr-0`: la primera y la última
 * columna renuncian a su relleno lateral para alinearse con el borde del texto
 * de la tarjeta que las contiene. Eso es correcto cuando la tarjeta tiene
 * relleno, y produce una tabla pegada al borde —con el encabezado y el monto
 * cortados por la esquina redondeada— cuando la tarjeta lleva `padding="none"`.
 *
 * Cuatro pantallas ya lo compensaban a mano con `px-5 sm:px-6` y las demás no.
 * Un acuerdo que hay que recordar en cada sitio es un acuerdo que se rompe.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const problems = [];

function sourceFiles(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.tsx') && !entry.includes('.test.')) found.push(path);
    }
  };
  walk(root);
  return found;
}

for (const file of sourceFiles('apps/web/src')) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('<Ledger')) continue;

  /*
    Cada `<Card padding="none">` que contenga un `<Ledger>` antes del siguiente
    `<Card`. Se mira el bloque entre las dos aperturas: es tosco, y es
    suficiente — lo que se busca es si alguien puso el relleno en algún sitio
    de ese bloque, no reconstruir el árbol.
  */
  const opens = [...source.matchAll(/<Card\b[^>]*>/gs)];

  for (let i = 0; i < opens.length; i += 1) {
    const open = opens[i];
    const tag = open[0];
    if (!/padding="none"/.test(tag)) continue;

    const start = open.index ?? 0;
    const end = opens[i + 1]?.index ?? source.length;
    const block = source.slice(start, end);
    if (!block.includes('<Ledger')) continue;

    // El relleno puede venir en la propia tarjeta o en el contenedor que
    // envuelve la tabla. Cualquiera de los dos sirve; ninguno no.
    const hasInset = /\bpx-\d|\bpx-\[/.test(block.slice(0, block.indexOf('<Ledger')));
    if (!hasInset) {
      problems.push(
        `${file} pone un <Ledger> dentro de <Card padding="none"> sin relleno lateral: ` +
          'las columnas de los extremos quedan pegadas al borde y la esquina las corta',
      );
    }
  }
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('TABLES HAVE THEIR INSET OK');
