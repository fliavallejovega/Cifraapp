import 'server-only';

import { accounts } from '@app/database/schema';
import {
  findCoverageGaps,
  type AccountActivity,
  type CoverageReport,
} from '@app/transaction-engine';
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
): Promise<CoverageWithPending> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        accountId: accounts.id,
        name: accounts.name,
        maskedNumber: accounts.maskedNumber,
        accountType: accounts.accountType,
        // `app.accounts.id` escrito a mano y no interpolado: en una consulta de
        // una sola tabla Drizzle lo imprime como `"id"` sin calificar, y dentro
        // de la subconsulta Postgres lo resuelve contra `t.id` — la condición
        // nunca se cumple y toda cuenta parece no tener movimientos.
        // Los meses con actividad, agregados por Postgres. Traer los
        // movimientos para agruparlos en memoria movería un año de filas para
        // producir doce cadenas.
        months: sql<string[]>`coalesce((
          select array_agg(distinct to_char(t.transaction_date, 'YYYY-MM'))
          from app.transactions t
          where t.account_id = app.accounts.id
            and t.deleted_at is null
        ), '{}')`,
        // Lo que ya se subió y espera que alguien lo guarde. No está en los
        // movimientos todavía, pero decir «nunca subiste» de una cuenta con
        // once capturas leídas es falso.
        pendingMonths: sql<string[]>`coalesce((
          select array_agg(distinct to_char(r.transaction_date, 'YYYY-MM'))
          from app.import_rows r
          join app.imports i on i.id = r.import_id
          where i.account_id = app.accounts.id
            and i.status = 'review'
            and r.created_transaction_id is null
            and r.verdict <> 'rejected'
            and r.transaction_date is not null
        ), '{}')`,
        pendingFiles: sql<number>`(
          select count(*)::int from app.imports i
          where i.account_id = app.accounts.id and i.status = 'review'
        )`,
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
    monthsSeen: [...new Set([...row.months, ...row.pendingMonths])],
  }));

  return {
    ...findCoverageGaps(activity, currentMonth),
    awaiting: rows
      .filter((row) => row.pendingFiles > 0)
      .map((row) => ({
        accountId: row.accountId,
        name: row.name,
        maskedNumber: row.maskedNumber,
        kind: row.accountType === 'credit_card' ? ('card' as const) : ('bank' as const),
        files: row.pendingFiles,
      })),
  };
}

export interface CoverageWithPending extends CoverageReport {
  /** Accounts with files read and not saved yet: uploaded, not missing. */
  readonly awaiting: readonly {
    readonly accountId: string;
    readonly name: string;
    readonly maskedNumber: string | null;
    readonly kind: 'card' | 'bank';
    readonly files: number;
  }[];
}
