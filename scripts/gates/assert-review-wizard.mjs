#!/usr/bin/env node
/**
 * G7 — El asistente deja resolver una fila sin salir de la pantalla.
 *
 * Tres cosas: elegir rubro, crear uno nuevo, y decir que el pago baja una deuda.
 * Cada una tiene que existir como acción de servidor —una interfaz sin acción es
 * un control que no hace nada— y estar montada en el componente.
 */
import { readFileSync } from 'node:fs';

const strip = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const problems = [];
const actions = strip(readFileSync('apps/web/src/server/review-row-actions.ts', 'utf8'));

for (const name of ['setRowCategory', 'createCategoryForRow', 'setRowDebt']) {
  if (!new RegExp(`export async function ${name}\\b`).test(actions)) {
    problems.push(`falta la acción ${name}`);
  }
}

// Que ninguna acepte una fila ya archivada: cambiarle el rubro a un movimiento
// existente es una corrección y se hace donde queda registrada como tal.
if (!actions.includes('row.createdTransactionId !== null) return null')) {
  problems.push('las acciones no rechazan una fila que ya es un movimiento');
}

const ui = strip(readFileSync('apps/web/src/components/import-review.tsx', 'utf8'));
for (const name of ['setRowCategory', 'createCategoryForRow', 'setRowDebt']) {
  if (!ui.includes(name)) problems.push(`el componente no usa ${name}`);
}
if (!ui.includes('RowWizard')) problems.push('el componente no monta el asistente');

// Y que una fila sin rubro se vea como tal en vez de quedar invisible.
if (!ui.includes('categoryUnknown')) {
  problems.push('una fila sin rubro no se distingue de una resuelta');
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('REVIEW WIZARD OK');
