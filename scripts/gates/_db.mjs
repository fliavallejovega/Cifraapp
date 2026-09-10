import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * La conexión que usan los gates que miden contra la base real.
 *
 * `postgres` es dependencia de `@app/database` y no de la raíz. Se resuelve
 * desde el almacén de pnpm en vez de agregarla dos veces al workspace, y la
 * versión se descubre en vez de fijarse: fijarla haría que este gate dejara de
 * correr —silenciosamente, con un error de módulo— la próxima vez que alguien
 * actualice el paquete.
 */
function resolvePostgres() {
  const store = 'node_modules/.pnpm';
  const dir = readdirSync(store).find((one) => one.startsWith('postgres@'));
  if (!dir) throw new Error('no se encontró el paquete postgres en node_modules/.pnpm');

  const require = createRequire(import.meta.url);
  return require(join(process.cwd(), store, dir, 'node_modules/postgres/cjs/src/index.js'));
}

export function connect() {
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find((one) => one.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL no está en .env.local');

  const postgres = resolvePostgres();
  return postgres(line.slice('DATABASE_URL='.length).trim(), { max: 1 });
}
