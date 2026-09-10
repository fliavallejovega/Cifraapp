import 'server-only';

import { accounts } from '@app/database/schema';
import { findCoverageGaps, type AccountActivity, type CoverageReport } from '@app/transaction-engine';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Qué le falta a esta casa por subir.
 *
 * Se lee de los movimientos ya registrados y no de una lista de documentos: un
 * archivo puede traer un trimestre, y un mes puede llegar en dos archivos. Lo
 * que importa es si el mes tiene actividad, no cuántos papeles lo produjeron.
 *
 * Sólo cuentas vivas. Una archivada no tiene estados de cuenta pendientes —
 * reclamárselos sería pedir algo que ya no existe.
 */
export async function loadStatementCoverage(
  session: Session,
  householdId: string,
  currentMonth: string,
): Promise<CoverageReport> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        accountId: accounts.id,
        name: accounts.name,
        maskedNumber: accounts.maskedNumber,
        accountType: accounts.accountType,
        // Los meses con actividad, agregados por Postgres. Traer los
        // movimientos para agruparlos en memoria movería un año de filas para
        // producir doce cadenas.
        months: sql<string[]>`coalesce((
          select array_agg(distinct to_char(t.transaction_date, 'YYYY-MM'))
          from app.transactions t
          where t.account_id = ${accounts.id}
            and t.deleted_at is null
        ), '{}')`,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.status, 'active'),
          isNull(accounts.deletedAt),
        ),
      ),
  );

  const activity: AccountActivity[] = rows.map((row) => ({
    accountId: row.accountId,
    name: row.name,
    maskedNumber: row.maskedNumber,
    kind: row.accountType === 'credit_card' ? 'card' : 'bank',
    monthsSeen: row.months,
  }));

  return findCoverageGaps(activity, currentMonth);
}
