/* eslint-disable no-console -- A gate's output is its interface. */
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Un cobro con fecha se atribuye a la meta que todavía no venció cuando entra.
 *
 * La atribución vive en una función pura con sus casos —incluido el control
 * negativo: un cobro sin fecha y uno posterior a todas las metas no se
 * atribuyen a ninguna, que es lo que un «va a la primera que encuentre» rompería
 * sin que nada más lo notara—. Y se comprueba que el plan la use y la enseñe,
 * porque una función correcta que nadie llama no cambia nada.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
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

try {
  const out = execFileSync('pnpm', ['--filter', '@app/allocation-engine', 'test'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!/Tests\s+\d+ passed/.test(out) || /\d+ failed/.test(out)) {
    failures.push('los casos de atribución no pasan');
  }
} catch (error) {
  failures.push(`los casos de atribución fallaron: ${String(error).slice(0, 160)}`);
}

// Los cuatro casos que definen la regla tienen que existir por nombre, para que
// borrarlos sea un cambio visible y no un test que desaparece en silencio.
const spec = read('packages/allocation-engine/src/goals.test.ts');
for (const needle of [
  'lo atribuye a la meta más cercana que todavía no venció',
  'lo pasa a la siguiente meta cuando llega tarde para la primera',
  'no atribuye un cobro sin fecha',
  'no atribuye un cobro posterior a todas las metas fechadas',
  'nunca reparte un cobro entre dos metas',
]) {
  if (!spec.includes(needle)) failures.push(`falta el caso: ${needle}`);
}

for (const [file, needle] of [
  ['apps/web/src/server/repositories/plan.ts', 'receiptsByGoal('],
  ['apps/web/src/server/repositories/plan.ts', 'expectedByGoal'],
  ['apps/web/src/app/[locale]/(product)/plan/page.tsx', 'view.expectedByGoal'],
]) {
  if (!read(file).includes(needle)) failures.push(`${file} no menciona ${needle}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log('RECEIVABLE_TO_GOAL_OK');
