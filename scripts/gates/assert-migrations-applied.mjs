#!/usr/bin/env node
/**
 * Las migraciones locales están aplicadas en la base real.
 *
 * Escribir una migración y desplegar sin empujarla es cómo una pantalla nueva
 * revienta contra columnas que no existen. Este gate lo comprueba contra el
 * proyecto de verdad, con el token del entorno; sin token no pasa, en vez de
 * pasar por no haber podido mirar.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

let token = process.env['SUPABASE_ACCESS_TOKEN'];
if (!token) {
  try {
    const settings = JSON.parse(readFileSync('.claude/settings.local.json', 'utf8'));
    token = settings?.env?.SUPABASE_ACCESS_TOKEN;
  } catch {
    /* Sin archivo tampoco hay token. */
  }
}

if (!token) {
  console.error('Falta SUPABASE_ACCESS_TOKEN. El gate no puede comprobar la base y no pasa.');
  process.exit(1);
}

const local = readdirSync('supabase/migrations')
  .filter((name) => name.endsWith('.sql'))
  .map((name) => name.slice(0, 14))
  .sort();

const run = spawnSync('npx', ['supabase', 'migration', 'list', '--linked'], {
  encoding: 'utf8',
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
});

const line = (run.stdout ?? '').split('\n').find((one) => one.trim().startsWith('{'));
if (!line) {
  console.error('No se pudo leer el estado de migraciones del proyecto enlazado.');
  console.error((run.stderr ?? '').slice(0, 400));
  process.exit(1);
}

const remote = new Set(
  JSON.parse(line).migrations.filter((m) => m.remote).map((m) => m.remote),
);

const missing = local.filter((version) => !remote.has(version));

console.log(`Migraciones locales: ${String(local.length)} · aplicadas: ${String(remote.size)}`);

if (missing.length > 0) {
  console.error(`\nSin aplicar: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('\nGATE OK — todas las migraciones locales están aplicadas en la base.');
