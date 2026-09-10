#!/usr/bin/env node
/**
 * G10 — Cada clave de copy que una pantalla pide existe en los dos idiomas.
 *
 * Es el mismo control que la prueba de `messages.test.ts`, ejecutado aquí para
 * que el ledger lo pueda medir por su cuenta. La paridad sola no alcanza: una
 * clave ausente en ambos catálogos la pasa, y se renderiza como su propia ruta.
 */
import { spawnSync } from 'node:child_process';

const run = spawnSync(
  'pnpm',
  ['--filter', '@app/web', 'exec', 'vitest', 'run', 'src/i18n/messages.test.ts'],
  { encoding: 'utf8', env: { ...process.env, SKIP_ENV_VALIDATION: 'true' } },
);

const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

if (run.status !== 0) {
  console.error(output.slice(-3000));
  process.exit(1);
}

if (!/Test Files\s+\d+ passed/.test(output)) {
  console.error('la suite de copy no reportó pruebas pasando');
  console.error(output.slice(-2000));
  process.exit(1);
}

console.log('COPY COMPLETE OK');
