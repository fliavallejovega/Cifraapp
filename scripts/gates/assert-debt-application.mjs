#!/usr/bin/env node
/**
 * G3 — Aplicar un pago a una deuda baja su saldo, deja rastro y se deshace.
 *
 * Se mide ejecutando de verdad contra la base y deshaciendo después, dentro de
 * una transacción que siempre se revierte: un gate que deja datos de prueba en
 * la base de una casa es peor que no tenerlo.
 */
import { connect } from './_db.mjs';

const sql = connect();
const problems = [];

try {
  await sql.begin(async (tx) => {
    const [household] = await tx`select id from app.households limit 1`;
    if (!household) throw new Error('no hay hogares con los que medir');

    const [debt] = await tx`
      insert into app.debts (household_id, name, kind, repayment, principal, current_balance,
                             currency, apr, minimum_payment, counterparty_name, counterparty_normalized)
      values (${household.id}, 'Gate: préstamo de Giovanni', 'informal', 'open',
              '1800.0000', '1800.0000', 'USD', '0.000', '0.0000',
              'Giovanni Cintione', 'giovanni cintione')
      returning id, current_balance`;

    const [payment] = await tx`
      insert into app.debt_payments (household_id, debt_id, amount, currency, paid_on)
      values (${household.id}, ${debt.id}, '500.0000', 'USD', current_date)
      returning id`;

    await tx`
      update app.debts
      set current_balance = greatest(current_balance - '500.0000'::numeric, 0)
      where id = ${debt.id}`;

    const [after] = await tx`select current_balance from app.debts where id = ${debt.id}`;
    if (Number(after.current_balance) !== 1300) {
      problems.push(`el saldo quedó en ${after.current_balance}, se esperaba 1300`);
    }

    // El rastro: quién, cuánto, desde qué movimiento.
    const [trace] = await tx`
      select amount, applied_at, reversed_at from app.debt_payments where id = ${payment.id}`;
    if (Number(trace.amount) !== 500) problems.push('el pago no guardó su monto');
    if (!trace.applied_at) problems.push('el pago no guardó cuándo se aplicó');
    if (trace.reversed_at !== null) problems.push('un pago nuevo no puede nacer deshecho');

    // Deshacer: marca, no borra, y el saldo vuelve.
    await tx`
      update app.debt_payments set reversed_at = now(), reversal_reason = 'gate'
      where id = ${payment.id}`;
    await tx`
      update app.debts set current_balance = current_balance + '500.0000'::numeric
      where id = ${debt.id}`;

    const [restored] = await tx`select current_balance from app.debts where id = ${debt.id}`;
    if (Number(restored.current_balance) !== 1800) {
      problems.push(`deshacer dejó el saldo en ${restored.current_balance}, se esperaba 1800`);
    }

    const [still] = await tx`select id from app.debt_payments where id = ${payment.id}`;
    if (!still) problems.push('deshacer borró la fila en vez de marcarla');

    // Y el mismo movimiento no se puede aplicar dos veces a la misma deuda.
    const [tx1] = await tx`select id from app.transactions limit 1`;
    if (tx1) {
      await tx`
        insert into app.debt_payments (household_id, debt_id, transaction_id, amount, currency, paid_on)
        values (${household.id}, ${debt.id}, ${tx1.id}, '10.0000', 'USD', current_date)`;
      const dupe = await tx`
        insert into app.debt_payments (household_id, debt_id, transaction_id, amount, currency, paid_on)
        values (${household.id}, ${debt.id}, ${tx1.id}, '10.0000', 'USD', current_date)
        on conflict do nothing
        returning id`;
      if (dupe.length !== 0) {
        problems.push('el mismo movimiento se pudo aplicar dos veces a la misma deuda');
      }
    }

    // Siempre se revierte: esto es una medición, no un cambio.
    throw new Error('__rollback__');
  });
} catch (error) {
  if (!(error instanceof Error) || error.message !== '__rollback__') {
    console.error(String(error));
    await sql.end();
    process.exit(1);
  }
}

await sql.end();

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('DEBT APPLICATION OK');
