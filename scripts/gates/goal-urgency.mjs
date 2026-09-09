/* eslint-disable no-console -- A gate's output is its interface. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Una meta confirmada con fecha se llena antes, y el abono reduce lo que falta.
 *
 * Se comprueba en tres capas porque el resultado necesita las tres: la
 * aritmética del peso (tests del motor), la columna que la sostiene (la base
 * real), y el cable entre las dos (el repositorio del plan). Cualquiera de
 * ellas rota deja la función correcta y el producto igual que antes.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = resolve(root, '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const failures = [];
const read = (file) =>
  execFileSync(
    'node',
    [
      '-e',
      `process.stdout.write(require('fs').readFileSync(${JSON.stringify(resolve(root, file))},'utf8'))`,
    ],
    { encoding: 'utf8' },
  );

// 1. La aritmética, con sus propios casos.
try {
  const out = execFileSync('pnpm', ['--filter', '@app/allocation-engine', 'test'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Un token de éxito y nada más: «no falló» no es lo mismo que «corrió».
  if (!/Tests\s+\d+ passed/.test(out) || /\d+ failed/.test(out)) {
    failures.push('los casos del motor de metas no pasan');
  }
} catch (error) {
  failures.push(`los casos del motor de metas fallaron: ${String(error).slice(0, 160)}`);
}

// 2. La columna, y la restricción que impide confirmar algo ya cerrado.
const url = process.env.DIRECT_URL;
if (!url) failures.push('DIRECT_URL no está definido');
else {
  const sql = (q) => execFileSync('psql', [url, '-At', '-c', q], { encoding: 'utf8' }).trim();
  const kind = sql(`
    select data_type from information_schema.columns
     where table_schema='app' and table_name='goals' and column_name='is_committed'
  `);
  if (kind !== 'boolean') failures.push(`goals.is_committed ausente o no booleana: ${kind}`);

  const household = sql(`select id from app.households limit 1`);
  const cleanup = () => sql(`delete from app.goals where name = '__gate_goal__'`);
  cleanup();

  // Control positivo: una meta activa sí se puede confirmar. Sin él, el rechazo
  // de la cerrada no probaría nada sobre esta restricción en particular.
  let activeOk = true;
  try {
    sql(`insert into app.goals (household_id, name, target_amount, currency, status, is_committed)
         values ('${household}', '__gate_goal__', 100, 'USD', 'active', true)`);
  } catch (error) {
    activeOk = false;
    failures.push(`no se pudo confirmar una meta activa: ${String(error).slice(0, 120)}`);
  }
  if (activeOk) cleanup();

  let closedRejected = false;
  try {
    sql(`insert into app.goals (household_id, name, target_amount, currency, status, is_committed)
         values ('${household}', '__gate_goal__', 100, 'USD', 'reached', true)`);
  } catch {
    closedRejected = true;
  }
  if (!closedRejected) failures.push('la base aceptó confirmar una meta ya lograda');
  cleanup();
}

// 3. El cable: el plan usa el peso, y la pantalla ofrece confirmarla y abonar.
const wiring = [
  ['apps/web/src/server/repositories/plan.ts', 'goalWeight('],
  ['apps/web/src/components/setup-questionnaire.tsx', "copy('goals.committed')"],
  ['apps/web/src/components/setup-questionnaire.tsx', "copy('goals.saved')"],
  ['apps/web/src/server/onboarding-actions.ts', 'isCommitted: entry.isCommitted'],
];
for (const [file, needle] of wiring) {
  if (!read(file).includes(needle)) failures.push(`${file} no menciona ${needle}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log('GOAL_URGENCY_OK');
