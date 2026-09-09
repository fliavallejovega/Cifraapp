import 'server-only';

import { planProposals } from '@app/database/schema';
import { and, desc, eq, gt } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Las propuestas del copiloto que siguen esperando una decisión.
 *
 * Se leen sólo las vivas: pendientes y sin caducar. Una propuesta sobre un cobro
 * de octubre no significa nada en diciembre, y enseñar un botón que aplica una
 * decisión tomada contra datos de hace un mes es peor que no enseñar ninguno.
 *
 * Las decididas no se borran. «¿Quién cambió mi piso de ingreso?» tiene que
 * poder responderse, y la fila guarda quién la propuso, quién la aprobó y qué
 * valor había antes.
 */

export interface ProposalView {
  readonly id: string;
  readonly kind: string;
  readonly targetId: string | null;
  readonly value: string;
  readonly reason: string;
  readonly threadId: string | null;
  readonly createdAt: Date;
}

export async function loadPendingProposals(
  session: Session,
  householdId: string,
  options: { threadId?: string } = {},
): Promise<readonly ProposalView[]> {
  return queryAsUser(session, (tx) =>
    tx
      .select({
        id: planProposals.id,
        kind: planProposals.kind,
        targetId: planProposals.targetId,
        value: planProposals.value,
        reason: planProposals.reason,
        threadId: planProposals.threadId,
        createdAt: planProposals.createdAt,
      })
      .from(planProposals)
      .where(
        and(
          eq(planProposals.householdId, householdId),
          eq(planProposals.status, 'pending'),
          gt(planProposals.expiresAt, new Date()),
          ...(options.threadId ? [eq(planProposals.threadId, options.threadId)] : []),
        ),
      )
      .orderBy(desc(planProposals.createdAt)),
  );
}
