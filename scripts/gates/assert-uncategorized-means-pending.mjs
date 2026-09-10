#!/usr/bin/env node
/**
 * G20 — «Sin rubro» significa «le falta uno», no «no tiene».
 *
 * Hay movimientos a los que no les toca ninguna categoría: un pago a la tarjeta
 * es plata moviéndose de un bolsillo a otro de la misma casa, no consumo. Un
 * aviso que los cuenta como pendientes nunca llega a cero, y un aviso que no se
 * puede apagar se aprende a ignorar — el día que marque algo real, ya nadie lo
 * mira.
 *
 * El predicado estaba escrito seis veces —el aviso, la cola, el cierre del mes,
 * el reporte del contable, el barrido y el filtro— y las seis decían sólo «no
 * tiene categoría». Se arregló la fila y el contador de arriba seguía
 * contándola.
 *
 * Ahora vive en un módulo. Este gate impide que nazca el séptimo suelto.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HOME = 'apps/web/src/server/repositories/needs-category.ts';
const problems = [];

function sourceFiles(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) found.push(path);
    }
  };
  walk(root);
  return found;
}

const home = readFileSync(HOME, 'utf8');
for (const status of ['transfer', 'excluded', 'duplicate']) {
  if (!home.includes(`'${status}'`)) {
    problems.push(`el predicado no excluye los movimientos en estado «${status}»`);
  }
}

for (const file of sourceFiles('apps/web/src')) {
  if (file.endsWith('needs-category.ts')) continue;

  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  if (/isNull\(\s*transactions\.categoryId\s*\)/.test(source)) {
    problems.push(
      `${file} pregunta directamente si falta la categoría; tiene que usar needsACategory(), ` +
        'o va a contar como pendiente un pago a tarjeta que no necesita ninguna',
    );
  }
}

/*
  Y el plural. «1 movimientos sin rubro» es un detalle que dice, sin querer, que
  nadie miró esta pantalla con un solo movimiento adentro.
*/
for (const locale of ['es', 'en']) {
  const messages = JSON.parse(readFileSync(`apps/web/messages/${locale}.json`, 'utf8'));
  const banner = messages.movements?.uncategorizedBanner?.title ?? '';
  if (banner.includes('{count}') && !banner.includes('plural')) {
    problems.push(`el aviso en ${locale} no declina el plural: diría «1 movimientos»`);
  }
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('UNCATEGORIZED MEANS PENDING OK');
