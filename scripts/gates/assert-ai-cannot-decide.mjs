#!/usr/bin/env node
/**
 * G4 — La IA puede subir un par a revisión, nunca archivarlo ni descartarlo.
 *
 * No se mide leyendo el código: se recorre el espacio entero de entradas del
 * adjudicador —tres veredictos por tres opiniones, más la ausencia de opinión— y
 * se comprueba que exista exactamente una transición y que ninguna produzca
 * `duplicate`. Un gate que buscara una cadena en un archivo no vería el día que
 * alguien agregue una segunda transición.
 */
import { adjudicate } from '../../packages/transaction-engine/dist/adjudicate.js';

const VERDICTS = ['new', 'review', 'duplicate'];
const OPINIONS = ['same', 'different', 'unsure', null];
const problems = [];

let changed = 0;

for (const verdict of VERDICTS) {
  for (const opinion of OPINIONS) {
    const result = adjudicate(verdict, opinion);

    if (result.aiChangedIt) {
      changed += 1;
      if (verdict !== 'new' || opinion !== 'same' || result.verdict !== 'review') {
        problems.push(`transición inesperada: ${verdict} + ${String(opinion)} → ${result.verdict}`);
      }
    }

    // Nada que diga una opinión puede esconder una fila del hogar.
    if (verdict !== 'duplicate' && result.verdict === 'duplicate') {
      problems.push(`una opinión produjo «duplicate»: ${verdict} + ${String(opinion)}`);
    }

    // Ni bajar una fila que ya estaba en revisión.
    if (verdict === 'review' && result.verdict !== 'review') {
      problems.push(`una opinión bajó una fila en revisión: ${String(opinion)}`);
    }
  }
}

if (changed !== 1) {
  problems.push(`el adjudicador admite ${String(changed)} transiciones; sólo puede admitir 1`);
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('AI CANNOT DECIDE OK');
