/* eslint-disable no-console -- A gate's output is its interface. */
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * El informe dice en qué rubros se gastó más y menos que el mes anterior.
 *
 * Los dos errores que esta comparación puede cometer en silencio son los que
 * los casos vigilan: comparar contra un mes que no existió —le diría a un hogar
 * en su primer mes que bajó en todo— y contar las transferencias como gasto,
 * que movería el resultado entero sin que nadie gaste un centavo de más.
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
  const out = execFileSync('pnpm', ['--filter', '@app/reporting', 'test'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!/Tests\s+\d+ passed/.test(out) || /\d+ failed/.test(out)) {
    failures.push('los casos de la comparación no pasan');
  }
} catch (error) {
  failures.push(`los casos de la comparación fallaron: ${String(error).slice(0, 160)}`);
}

// Los casos que definen la regla, por nombre: borrarlos tiene que ser visible.
const spec = read('packages/reporting/src/spend-shift.test.ts');
for (const needle of [
  'separa lo que subió de lo que bajó, lo más movido primero',
  'no compara contra un mes que no existió',
  'distingue un mes sin movimientos de un mes que no hubo',
  'no cuenta las transferencias como gasto',
  'ignora las entradas: una devolución no es gastar menos',
]) {
  if (!spec.includes(needle)) failures.push(`falta el caso: ${needle}`);
}

// Y el cable: el informe la calcula y la pantalla la enseña, con su vacío.
for (const [file, needle] of [
  ['apps/web/src/server/repositories/reports.ts', 'spendShift({'],
  ['apps/web/src/server/repositories/reports.ts', 'hadPrevious:'],
  ['apps/web/src/app/[locale]/(product)/reports/page.tsx', 'view.shift.spentMore'],
  ['apps/web/src/app/[locale]/(product)/reports/page.tsx', 'view.shift.spentLess'],
  ['apps/web/src/app/[locale]/(product)/reports/page.tsx', "t('shift.noneTitle')"],
]) {
  if (!read(file).includes(needle)) failures.push(`${file} no menciona ${needle}`);
}

// Y su copy, en los dos idiomas: una clave en uno solo revienta en el otro.
for (const lang of ['es', 'en']) {
  const messages = JSON.parse(read(`apps/web/messages/${lang}.json`));
  const shift = messages.reports?.shift;
  if (!shift) {
    failures.push(`falta reports.shift en ${lang}.json`);
    continue;
  }
  for (const key of ['title', 'noneTitle', 'moreTitle', 'lessTitle', 'freedNote']) {
    if (typeof shift[key] !== 'string') failures.push(`falta reports.shift.${key} en ${lang}.json`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log('SPEND_SHIFT_OK');
