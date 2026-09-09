/* eslint-disable no-console -- A gate's output is its interface. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * El reparto de gastos comunes, comprobado contra la base de verdad.
 *
 * Una columna que existe en una migración y no en la base es una columna que
 * nadie tiene, así que la comprobación va contra el esquema real y contra sus
 * restricciones: que un dependiente no pueda llevar parte no es un detalle de
 * pantalla, es lo que impide que una casa reparta el alquiler entre cuatro
 * cuando lo sostienen dos.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = resolve(root, '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DIRECT_URL;
if (!url) {
  console.error('DIRECT_URL no está definido: la comprobación necesita la base.');
  process.exit(1);
}

const sql = (query) => execFileSync('psql', [url, '-At', '-c', query], { encoding: 'utf8' }).trim();

const failures = [];

// 1. La columna existe, con el tipo y el rango que la pantalla asume.
const column = sql(`
  select data_type || ' ' || coalesce(numeric_precision::text, '?')
    from information_schema.columns
   where table_schema = 'app' and table_name = 'household_people'
     and column_name = 'expense_share'
`);
if (!column.startsWith('numeric')) failures.push(`expense_share ausente o no numérica: ${column}`);

// 2. Un dependiente no puede llevar parte. Control positivo: la misma escritura
//    sin la marca de dependiente sí tiene que entrar, o el rechazo no prueba
//    nada sobre la restricción y podría venir de cualquier otro error.
const household = sql(`select id from app.households limit 1`);
if (!household) failures.push('no hay hogar contra el que comprobar');
else {
  const cleanup = () =>
    sql(`delete from app.household_people where display_name = '__gate_split__'`);
  cleanup();

  let rejected = false;
  try {
    sql(`
      insert into app.household_people (household_id, display_name, relationship, is_dependent, expense_share)
      values ('${household}', '__gate_split__', 'child', true, 40)
    `);
  } catch {
    rejected = true;
  }
  if (!rejected) failures.push('la base aceptó una parte asignada a un dependiente');
  cleanup();

  let accepted = true;
  try {
    sql(`
      insert into app.household_people (household_id, display_name, relationship, is_dependent, expense_share)
      values ('${household}', '__gate_split__', 'partner', false, 40)
    `);
  } catch (error) {
    accepted = false;
    failures.push(`la base rechazó una parte válida: ${String(error).slice(0, 120)}`);
  }
  if (accepted) {
    const stored = sql(
      `select expense_share from app.household_people where display_name = '__gate_split__'`,
    );
    if (Number(stored) !== 40) failures.push(`se guardó ${stored} en vez de 40`);
  }
  cleanup();

  // 3. Y por encima de cien tampoco: un porcentaje no es una cantidad.
  let overRejected = false;
  try {
    sql(`
      insert into app.household_people (household_id, display_name, relationship, is_dependent, expense_share)
      values ('${household}', '__gate_split__', 'partner', false, 140)
    `);
  } catch {
    overRejected = true;
  }
  if (!overRejected) failures.push('la base aceptó una parte de 140%');
  cleanup();
}

// 4. Y la pantalla la lleva de ida y de vuelta.
const wiring = [
  ['apps/web/src/components/setup-questionnaire.tsx', 'SharedSplit'],
  ['apps/web/src/server/onboarding-actions.ts', 'expenseShare'],
  ['apps/web/src/server/repositories/setup-answers.ts', 'expenseShare'],
];
for (const [file, needle] of wiring) {
  const text = execFileSync(
    'node',
    [
      '-e',
      `process.stdout.write(require('fs').readFileSync(${JSON.stringify(resolve(root, file))}, 'utf8'))`,
    ],
    { encoding: 'utf8' },
  );
  if (!text.includes(needle)) failures.push(`${file} no menciona ${needle}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log('SHARED_SPLIT_OK');
