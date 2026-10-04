import 'server-only';

import { accounts, debts, importRows, imports, transactions } from '@app/database/schema';
import { Money } from '@app/domain';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { applyStatementBalance } from './account-balance';
import { applyPaymentToDebt, paysTheDebt } from './debt-payments';
import type { queryAsUser } from './session';

type Tx = Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0];

/**
 * Files the chosen rows of one import as transactions, in one database
 * transaction. `'proposed'` takes what the review screen would have selected
 * by itself: the rows the engine believes are new.
 */
export async function fileImportInto(
  tx: Tx,
  input: {
    readonly householdId: string;
    /** Who the movements are recorded as: the person, or the uploader for a job. */
    readonly userId: string | null;
    readonly importId: string;
    readonly chosen: ReadonlySet<string> | 'proposed';
  },
): Promise<number> {
  const [header] = await tx
    .select({
      id: imports.id,
      accountId: imports.accountId,
      documentId: imports.documentId,
    })
    .from(imports)
    .where(and(eq(imports.id, input.importId), eq(imports.householdId, input.householdId)))
    .limit(1);

  if (!header?.accountId) return 0;

  const [account] = await tx
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(eq(accounts.id, header.accountId))
    .limit(1);

  const currency = account?.currency.trim() === 'PAB' ? 'PAB' : 'USD';

  const candidates = await tx
    .select({
      id: importRows.id,
      transactionDate: importRows.transactionDate,
      amount: importRows.amount,
      descriptionOriginal: importRows.descriptionOriginal,
      descriptionNormalized: importRows.descriptionNormalized,
      externalReference: importRows.externalReference,
      fingerprint: importRows.fingerprint,
      verdict: importRows.verdict,
      createdTransactionId: importRows.createdTransactionId,
      proposedCategoryId: importRows.proposedCategoryId,
      chosenCategoryId: importRows.chosenCategoryId,
      applyToDebtId: importRows.applyToDebtId,
      distinctConfirmed: importRows.distinctConfirmed,
    })
    .from(importRows)
    .where(eq(importRows.importId, header.id));

  const selected =
    input.chosen === 'proposed'
      ? new Set(candidates.filter((row) => row.verdict === 'new').map((row) => row.id))
      : input.chosen;

  /*
    The same movement already filed from another file of this account.

    Overlapping screenshots carry the same lines, and confirming the second
    file would file them twice. A line whose fingerprint is already in the
    ledger from a different import is held back — unless the person said, on
    the repeat question, that they are two movements.
  */
  const fingerprints = candidates
    .map((row) => row.fingerprint)
    .filter((value): value is string => value !== null);
  const already = new Set(
    fingerprints.length === 0
      ? []
      : (
          await tx
            .select({ fingerprint: transactions.fingerprint })
            .from(transactions)
            .where(
              and(
                eq(transactions.householdId, input.householdId),
                eq(transactions.accountId, header.accountId),
                isNull(transactions.deletedAt),
                inArray(transactions.fingerprint, fingerprints),
                sql`${transactions.sourceImportId} is distinct from ${header.id}`,
              ),
            )
        ).map((row) => row.fingerprint),
  );

  const writable = candidates.filter(
    (row) =>
      selected.has(row.id) &&
      // Already filed once. Re-submitting the form must not double it.
      row.createdTransactionId === null &&
      row.verdict !== 'rejected' &&
      row.transactionDate !== null &&
      row.amount !== null &&
      row.fingerprint !== null &&
      (row.distinctConfirmed || !already.has(row.fingerprint)),
  );

  let count = 0;

  for (const row of writable) {
    const amount = Money.fromDecimalString(row.amount ?? '0', currency);
    const description = row.descriptionOriginal ?? '';
    const direction = amount.isNegative() ? ('outflow' as const) : ('inflow' as const);

    /*
      Si esta fila paga una deuda, se decide **antes** de insertar.

      Un pago no es un gasto: es plata moviéndose de un bolsillo a otro de la
      misma casa. Nace como transferencia y sin rubro, en una sola escritura —
      insertarlo como gasto y corregirlo después deja un instante en que las
      cifras del mes están mal, y el cierre del mes puede caer justo ahí.

      Y hacia dónde va el dinero decide si paga: entrando a la cuenta que lleva
      la deuda, o saliendo de cualquier otra.
    */
    let paysDebt = false;
    if (row.applyToDebtId) {
      const [target] = await tx
        .select({ accountId: debts.accountId })
        .from(debts)
        .where(and(eq(debts.id, row.applyToDebtId), eq(debts.householdId, input.householdId)))
        .limit(1);

      paysDebt =
        target !== undefined &&
        paysTheDebt({
          debtAccountId: target.accountId,
          movementAccountId: header.accountId,
          direction,
        });
    }

    const [created] = await tx
      .insert(transactions)
      .values({
        householdId: input.householdId,
        accountId: header.accountId,
        ownerId: input.userId,
        transactionDate: row.transactionDate ?? '',
        amount: row.amount ?? '0',
        currency,
        // The sign in the statement is the direction. Nothing infers it from
        // the description, which is where categorization guesses go wrong.
        direction,
        // Un pago no lleva rubro: no le falta uno, no le toca ninguno.
        // Fuera de ese caso, el que la persona eligió al revisar gana sobre el
        // que el motor propuso, y sin ninguno de los dos queda nulo — y una
        // fila sin rubro entra a la cola en vez de quedarse invisible.
        categoryId: paysDebt ? null : (row.chosenCategoryId ?? row.proposedCategoryId),
        descriptionOriginal: description,
        descriptionNormalized: row.descriptionNormalized ?? description,
        externalReference: row.externalReference,
        fingerprint: row.fingerprint ?? '',
        // Una transferencia no es gasto ni ingreso, así que no entra en el
        // mes ni en ningún presupuesto.
        status: paysDebt ? 'transfer' : 'posted',
        source: 'imported',
        sourceDocumentId: header.documentId,
        sourceImportId: header.id,
      })
      .returning({ id: transactions.id });

    if (!created) continue;

    await tx
      .update(importRows)
      .set({ createdTransactionId: created.id })
      .where(eq(importRows.id, row.id));

    /*
      Y si esta fila es un pago a una deuda, se aplica ahora.

      Este es el paso que faltaba entero. Un pago a Giovanni entraba como un
      gasto suelto: salía del mes, no bajaba de ningún saldo, y la deuda
      seguía diciendo mil ochocientos para siempre. La casa terminaba llevando
      esa cuenta en la cabeza, que es el trabajo que este producto existe para
      quitar.

      Se aplica dentro de la misma transacción de base que creó el movimiento:
      un pago registrado cuya deuda no bajó, o una deuda que bajó sin pago que
      la explique, son dos formas de que los números dejen de cuadrar.
    */
    if (paysDebt && row.applyToDebtId) {
      await applyPaymentToDebt(tx, {
        householdId: input.householdId,
        debtId: row.applyToDebtId,
        transactionId: created.id,
        amount: amount.abs(),
        currency,
        paidOn: row.transactionDate ?? '',
        appliedBy: input.userId,
      });
    }

    count += 1;
  }

  // Settled only when nothing importable is still waiting. A partial
  // confirmation leaves the import open, because the rest is still a decision
  // somebody has to make.
  // A line held back because it is already filed from another file is not
  // waiting on anybody: it is settled.
  const remaining = candidates.filter(
    (row) =>
      row.verdict !== 'rejected' &&
      row.createdTransactionId === null &&
      !writable.some((written) => written.id === row.id) &&
      !(row.fingerprint !== null && !row.distinctConfirmed && already.has(row.fingerprint)),
  );

  await tx
    .update(imports)
    .set(
      remaining.length === 0
        ? { status: 'completed', completedAt: new Date() }
        : { status: 'review' },
    )
    .where(eq(imports.id, header.id));

  // The balance the statement prints becomes the account's, in the same
  // transaction as its movements, so the position never shows one without
  // the other.
  await applyStatementBalance(tx, header.id);

  return count;
}
