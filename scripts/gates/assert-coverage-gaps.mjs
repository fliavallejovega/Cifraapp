#!/usr/bin/env node
/**
 * G11 — El sistema dice qué documentos faltan, por cuenta y por mes.
 *
 * Se ejecuta el motor real contra el caso que el usuario describió: falta el
 * estado de agosto de la cuenta 1783 y el de la tarjeta 0209. Y se comprueba lo
 * que **no** reclama, que es lo que decide si el aviso se lee o se ignora.
 */
import { findCoverageGaps } from '../../packages/transaction-engine/dist/statement-coverage.js';
import { readFileSync } from 'node:fs';

const problems = [];

const report = findCoverageGaps(
  [
    {
      accountId: 'a',
      name: 'Cuenta de ahorros',
      maskedNumber: '1783',
      kind: 'bank',
      monthsSeen: ['2026-06', '2026-07'],
    },
    {
      accountId: 'b',
      name: 'Visa',
      maskedNumber: '0209',
      kind: 'card',
      monthsSeen: ['2026-06', '2026-07'],
    },
  ],
  '2026-09',
);

if (report.gaps.length !== 2) {
  problems.push(`se esperaban 2 cuentas con huecos, hubo ${String(report.gaps.length)}`);
}

const digits = report.gaps.map((gap) => gap.maskedNumber).sort();
if (digits.join(',') !== '0209,1783') {
  problems.push(`no nombra las cuentas por sus últimos cuatro: ${digits.join(',')}`);
}

for (const gap of report.gaps) {
  if (gap.missing.join(',') !== '2026-08') {
    problems.push(`${String(gap.maskedNumber)} reclama ${gap.missing.join(',')} en vez de 2026-08`);
  }
}

// El mes en curso no se reclama: pedir algo que el banco no cerró enseña a
// ignorar el aviso, y el aviso que se ignora es el mismo que no avisa de agosto.
const current = findCoverageGaps(
  [{ accountId: 'a', name: 'x', maskedNumber: '1783', kind: 'bank', monthsSeen: ['2026-08'] }],
  '2026-09',
);
if (current.gaps.length !== 0) {
  problems.push('reclama el mes en curso, que el banco todavía no cerró');
}

// Y que exista la pantalla que lo dice, no sólo el motor que lo calcula.
const page = readFileSync('apps/web/src/app/[locale]/(product)/documents/page.tsx', 'utf8');
if (!page.includes('loadStatementCoverage') || !page.includes('missing.title')) {
  problems.push('la pantalla de importar no enseña lo que falta');
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('COVERAGE GAPS OK');
