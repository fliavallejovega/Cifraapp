#!/usr/bin/env node
/**
 * E1 — El paquete de correo pasa sus pruebas, y entre ellas están las que
 * inyectan marcado en cada campo y en cada variable.
 *
 * Que la suite pase no alcanza: una suite a la que alguien le borró la prueba
 * de inyección también pasa. Por eso se exige, además, que las pruebas que
 * importan existan con su nombre y hayan corrido.
 */
import { spawnSync } from 'node:child_process';

const run = spawnSync('pnpm', ['--filter', '@app/email', 'exec', 'vitest', 'run', '--reporter=verbose'], {
  encoding: 'utf8',
});
const output = `${run.stdout}\n${run.stderr}`;

const required = [
  'escapa el marcado escrito en cualquier campo',
  'escapa el marcado que llega en el valor de una variable',
  'no deja que un «{{» escrito en un campo abra una plantilla de Supabase',
  'rechaza un botón con un enlace que no es https',
  'no se guarda sin el texto del botón',
];

const problems = [];
if (run.status !== 0) problems.push('la suite de @app/email falló');
for (const name of required) {
  if (!output.includes(`✓`) || !output.split('\n').some((line) => line.includes('✓') && line.includes(name))) {
    problems.push(`no corrió en verde: «${name}»`);
  }
}
const passed = /Tests\s+(\d+) passed/.exec(output);
if (!passed) problems.push('no se encontró el resumen de pruebas');

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log(`EMAIL PACKAGE OK (${passed[1]} pruebas)`);
