#!/usr/bin/env node
/**
 * G6 — Cada fila llega a la revisión con su categoría propuesta.
 *
 * El orden es lo que se mide: la clasificación tiene que ocurrir donde se
 * escriben las filas del import, no después de confirmar. Confirmar una lista
 * de descripciones crudas sin saber con qué rubro van a quedar no es aprobar.
 */
import { readFileSync } from 'node:fs';

const strip = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const problems = [];
const service = strip(readFileSync('apps/web/src/server/import-service.ts', 'utf8'));

if (!service.includes('loadClassificationInputs')) {
  problems.push('la importación no carga reglas ni comercios');
}
if (!/classify\(/.test(service)) {
  problems.push('la importación no clasifica ninguna fila');
}
if (!service.includes('proposedCategoryId: one.classification.categoryId')) {
  problems.push('la fila no guarda la categoría propuesta');
}
if (!service.includes('proposedSource')) {
  problems.push('la fila no guarda de dónde salió la propuesta');
}

// Y que la propuesta llegue a la pantalla, no sólo a la base.
const repo = strip(readFileSync('apps/web/src/server/repositories/import-review.ts', 'utf8'));
if (!repo.includes('categoryName')) {
  problems.push('la pantalla de revisión no lee la categoría de la fila');
}

/*
  Y que al confirmar se aplique, con lo elegido ganando sobre lo propuesto.

  Se mide la precedencia y no la línea entera: la línea creció para dejar sin
  rubro a los pagos —que no necesitan ninguno— y una aserción atada al texto
  exacto falló ahí sin que nada estuviera mal. Un gate tiene que medir lo que
  significa, o pide que lo desactiven.
*/
const confirm = strip(readFileSync('apps/web/src/server/import-actions.ts', 'utf8'));
if (!confirm.includes('row.chosenCategoryId ?? row.proposedCategoryId')) {
  problems.push('confirmar no aplica la categoría de la fila');
}
if (confirm.includes('row.proposedCategoryId ?? row.chosenCategoryId')) {
  problems.push('la propuesta del motor le gana al rubro que la persona eligió');
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('CATEGORY BEFORE CONFIRM OK');
