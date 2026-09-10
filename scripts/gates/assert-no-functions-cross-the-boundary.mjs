#!/usr/bin/env node
/**
 * G18 — Ninguna función cruza de un componente de servidor a uno de cliente.
 *
 * Es el fallo que más veces tumbó este producto en producción, y ninguna de las
 * cuatro cosas del gate lo ve: compila, pasa el typecheck, pasa las pruebas y
 * pasa el build. Las páginas son dinámicas, así que el build no las renderiza
 * nunca. Sólo se ve al abrir la pantalla, y para entonces está desplegado.
 *
 * Pasó tres veces:
 *   - `search: (key) => t(key)` de una página de servidor al panel de
 *     inversiones. Cayó `/es/accounts` entera.
 *   - `movement-filters.tsx` sin `'use client'` renderizando `<Field>`, que
 *     recibe sus hijos como función. Cayó `/es/movements`.
 *   - `simulator-form.tsx`, el mismo defecto, todavía sin explotar.
 *
 * ## Qué mide
 *
 * Qué componentes de `@app/ui` viven en un módulo `'use client'`, y después qué
 * módulos de la aplicación **sin** esa directiva los renderizan pasándoles una
 * función — como hijos o como cualquier otra prop.
 *
 * Se descubre qué es cliente leyendo el paquete, no con una lista escrita a
 * mano: una lista se desactualiza el día que alguien agregue un componente, y
 * ese día el gate deja de proteger sin avisar.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const problems = [];

/** Todo componente exportado desde un módulo `'use client'` de @app/ui. */
function clientComponents() {
  const found = new Set();
  const dir = 'packages/ui/src/components';

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.tsx')) continue;
    const source = readFileSync(join(dir, file), 'utf8');
    if (!source.trimStart().startsWith("'use client'")) continue;

    for (const match of source.matchAll(/export function (\w+)/g)) {
      const name = match[1];
      if (name) found.add(name);
    }
  }

  return found;
}

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

/**
 * Los atributos de cada apertura de `<Name ...>`, con las llaves balanceadas.
 *
 * No se puede cortar en el primer `>`: una flecha lo contiene. La primera
 * versión de este gate lo hacía y por eso no vio el bug que ya había tumbado
 * `/es/accounts` — `onClick={() => t('x')}` se cortaba en el `=` y la mitad
 * restante no parecía una función. Un gate que no atrapa el caso que lo
 * originó no es un gate.
 */
function propsOf(source, name) {
  const found = [];
  const open = new RegExp(`<${name}(?=[\\s/>])`, 'g');

  for (const match of source.matchAll(open)) {
    let depth = 0;
    let quote = null;
    let i = match.index + match[0].length;

    for (; i < source.length; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === quote && source[i - 1] !== '\\') quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { depth += 1; continue; }
      if (c === '}') { depth -= 1; continue; }
      if (c === '>' && depth === 0) break;
    }

    found.push(source.slice(match.index + match[0].length, i));
  }

  return found;
}

/** Si un bloque de atributos contiene una función. */
function hasFunction(props) {
  // Una flecha, con o sin paréntesis, con o sin `async`.
  if (/=\{[^}]*=>/.test(props)) return true;
  // O una función declarada en línea.
  if (/=\{\s*(?:async\s+)?function\b/.test(props)) return true;
  return false;
}

const client = clientComponents();
if (client.size === 0) {
  console.error('- no se encontró ningún componente de cliente en @app/ui; el gate no está midiendo nada');
  process.exit(1);
}

for (const file of sourceFiles('apps/web/src')) {
  const source = readFileSync(file, 'utf8');

  // Un módulo con la directiva ya es cliente: dentro de él las funciones no
  // cruzan ninguna frontera.
  if (source.trimStart().startsWith("'use client'")) continue;

  const imported = new Set();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@app\/ui'/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name) imported.add(name);
    }
  }

  for (const name of imported) {
    if (!client.has(name)) continue;

    // Hijos como función: `<Field ...>{({ id }) => ...}`.
    if (new RegExp(`<${name}\\b[^>]*>\\s*\\{\\s*\\(`, 's').test(source)) {
      problems.push(`${file} renderiza <${name}> con sus hijos como función`);
      continue;
    }

    // Y cualquier otra prop que sea una función.
    if (propsOf(source, name).some(hasFunction)) {
      problems.push(`${file} le pasa una función a <${name}> en una prop`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  console.error('\nUn módulo que renderiza un componente de cliente pasándole una función');
  console.error('tiene que declarar «use client». Si no, la petición falla entera al abrir');
  console.error('la pantalla — y compila, pasa el typecheck, las pruebas y el build.');
  process.exit(1);
}

console.log(`NO FUNCTIONS CROSS OK (${String(client.size)} componentes de cliente vigilados)`);
