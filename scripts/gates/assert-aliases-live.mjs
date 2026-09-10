#!/usr/bin/env node
/**
 * G5 — Los alias de comercio se leen de verdad.
 *
 * Dos mediciones. La primera es que ninguna ruta vuelva a construir la lista de
 * comercios con `aliases: []`, que es cómo la tabla estuvo muerta. La segunda es
 * que un alias declarado **cambie el resultado**: sin ella, el gate pasaría con
 * los alias cargados y el motor ignorándolos.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { resolveMerchant } from '../../packages/category-engine/dist/merchants.js';

const problems = [];

const walk = (dir, found = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) found.push(path);
  }
  return found;
};

for (const file of walk('apps/web/src')) {
  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  if (/aliases:\s*\[\s*\]/.test(source)) {
    problems.push(`${file} sigue construyendo comercios con aliases vacíos`);
  }
}

/*
  El control positivo: un alias que no se parece al nombre.

  Tiene que no parecerse, o el gate pasaría igual con los alias ignorados —
  «pedidosya order» contra «PedidosYa» coincide por el nombre solo, y medir con
  eso no mide nada. «pya delivery» no tiene ninguna relación de texto con
  «PedidosYa»: si coincide, es porque el alias se leyó.
*/
const merchant = {
  id: 'm1',
  name: 'PedidosYa',
  normalizedName: 'pedidosya',
  aliases: ['pya delivery'],
  defaultCategoryId: 'c1',
};

const withAlias = resolveMerchant('pya delivery 4471', [merchant]);
const withoutAlias = resolveMerchant('pya delivery 4471', [{ ...merchant, aliases: [] }]);

if (!withAlias) {
  problems.push('un alias declarado no produjo coincidencia; el motor lo está ignorando');
}
if (withoutAlias) {
  problems.push('el control no sirve: coincide igual sin el alias');
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('ALIASES LIVE OK');
