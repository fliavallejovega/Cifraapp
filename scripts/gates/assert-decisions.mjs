#!/usr/bin/env node
/**
 * Las tres decisiones que el usuario aprobó, comprobadas contra el código.
 *
 * Cada una tiene una forma distinta de estar hecha, y este gate mira la que le
 * corresponde en vez de buscar una palabra suelta:
 *
 *   1. **El descuento de planilla lo leen los motores.** Existe `stated_basis` en
 *      la serie de ingresos, el plan lo lee, y hay una rama que resta los
 *      descuentos cuando el monto declarado es bruto.
 *   2. **Las cifras fiscales se muestran.** La reserva por cobro llega a la
 *      pantalla: existe `reservedLive` en el repositorio y la pantalla lo pinta.
 *   3. **El TOS puede quedar revisado.** Existe el mecanismo que estampa la
 *      revisión con un nombre, y **se niega** a correr sin él — que es lo que
 *      impide escribir en la base que alguien revisó lo que nadie revisó.
 */
import { readFileSync } from 'node:fs';

const checks = [
  {
    what: 'el descuento de planilla lo lee el motor',
    file: 'supabase/migrations/20260909300000_income_floor_and_cushion.sql',
    needles: ['income_basis', 'stated_basis'],
  },
  {
    what: 'el plan resta lo descontado cuando el monto es bruto',
    file: 'apps/web/src/server/repositories/plan.ts',
    needles: ['netOf(', "basis !== 'gross'", 'isDeductedAtSource'],
  },
  {
    what: 'se pregunta neto o bruto al declarar un ingreso',
    file: 'apps/web/src/server/income-actions.ts',
    needles: ['statedBasis'],
  },
  {
    what: 'la reserva fiscal por cobro llega al repositorio',
    file: 'apps/web/src/server/repositories/tax-profile.ts',
    needles: ['reservedLive', 'reservedReleased', 'ReservedReceipt'],
  },
  {
    what: 'y la pantalla de reserva la pinta',
    file: 'apps/web/src/app/[locale]/(product)/tax/reserve/page.tsx',
    needles: ['position.receipts', 'reserved.title'],
  },
  {
    what: 'el mecanismo de revisión legal existe y exige un nombre',
    file: 'scripts/mark-legal-reviewed.mjs',
    needles: ['reviewed_by', 'process.exit(2)', 'El nombre es obligatorio'],
  },
];

let failed = 0;

for (const check of checks) {
  let text;
  try {
    text = readFileSync(check.file, 'utf8');
  } catch {
    console.error(`FALTA  ${check.what} — no existe ${check.file}`);
    failed += 1;
    continue;
  }

  const missing = check.needles.filter((needle) => !text.includes(needle));
  if (missing.length > 0) {
    console.error(`FALTA  ${check.what} — ${check.file} no contiene: ${missing.join(', ')}`);
    failed += 1;
    continue;
  }

  console.log(`ok     ${check.what}`);
}

if (failed > 0) {
  console.error(`\n${String(failed)} decisión(es) sin aplicar.`);
  process.exit(1);
}

console.log('\nGATE OK — las tres decisiones aprobadas están aplicadas.');
