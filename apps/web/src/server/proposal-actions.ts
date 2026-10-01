'use server';

import {
  PLAN_PROPOSAL_V1,
  readProposals,
  type PlanProposal,
  type PromptLocale,
} from '@app/ai';
import {
  chatMessages,
  goals,
  householdSettings,
  planProposals,
  receivables,
} from '@app/database/schema';
import { formatMoney, Money, type Money as MoneyType } from '@app/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ask, copilotIsConfigured } from './ai';
import { loadHouseholdContext } from './household-context';
import { loadGoals } from './repositories/administration';
import { loadPlan } from './repositories/plan';
import { loadReceivables } from './repositories/receivables';
import { localeOf } from './revalidate';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * El chat que puede pedir cambios al plan — y que no puede hacerlos.
 *
 * La queja legítima con un copiloto que sólo explica es evidente: alguien que
 * acaba de leer «tu alquiler del 30 está descubierto por $240» quiere decir
 * «entonces mové la meta del viaje», y mandarlo a buscar otra pantalla convierte
 * una conversación en una tarea.
 *
 * Dejar que el modelo escriba, en cambio, rompe la regla que sostiene el resto:
 * la IA nunca es la fuente de verdad. Un modelo que puede modificar un plan
 * puede modificarlo mal, con total seguridad, y aquí eso es dinero mal repartido.
 *
 * El reparto de responsabilidad queda así:
 *
 *   * **El modelo** convierte una frase en filas de un catálogo cerrado.
 *   * **`readProposals`** las valida sin él: tipo en la lista, identificador del
 *     hogar, cifra presente en los datos que se le dieron.
 *   * **La persona** confirma. Hasta entonces no cambia nada.
 *   * **`applyProposal`** escribe, en código determinista, guardando el valor
 *     anterior — que es lo único que hace reversible una aprobación.
 */

const requestInput = z.object({
  request: z.string().trim().min(3).max(500),
  threadId: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.uuid().optional(),
  ),
});

export async function proposePlanChange(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  if (!copilotIsConfigured()) return { error: 'copilotOff' };

  const parsed = requestInput.safeParse({
    request: formData.get('request'),
    threadId: formData.get('threadId'),
  });
  if (!parsed.success) return { error: 'requestRequired' };

  const householdId = session.activeHouseholdId;
  const locale = localeOf(formData);
  const promptLocale: PromptLocale = locale === 'en' ? 'en' : 'es';
  const context = loadHouseholdContext(session, householdId, locale);

  const [plan, expected, goalRows] = await Promise.all([
    loadPlan(session, householdId),
    loadReceivables(session, householdId, context.currency),
    loadGoals(session, householdId, context.currency),
  ]);

  const money = (value: MoneyType) => formatMoney(value, { locale: context.moneyLocale });

  /**
   * Lo que el modelo puede ver, y por tanto lo único que puede proponer.
   *
   * Los identificadores viajan a propósito: sin ellos el modelo no podría
   * nombrar un cobro concreto y propondría por nombre, que es ambiguo en cuanto
   * hay dos facturas del mismo cliente. Que estén aquí no le da acceso a nada —
   * el validador comprueba después que cada uno esté en la lista que esta misma
   * sesión cargó.
   */
  const grounding: Record<string, string> = {
    request: parsed.data.request,
    today: context.today,
    available: money(plan.safeToSpend.safeToSpend),
    'floor.current': money(plan.floor.amount),
    'floor.measured': plan.floor.measured ? money(plan.floor.measured) : 'not measurable yet',
    'cushion.target': money(plan.cushion.target),
    'cushion.held': money(plan.cushion.held),
    'cushion.months': String(plan.cushion.monthsTarget),
    'buffer.minimum': money(plan.safeToSpend.deductions.find((one) => one.kind === 'buffer')?.claimed ?? Money.zero(context.currency)),
    receivables:
      expected.length === 0
        ? 'none'
        : expected
            .filter((one) => one.receivedOn === null)
            .map(
              (one) =>
                `${one.id} · ${one.name} · ${money(one.amount)} · ${one.expectedFrom ?? 'no date'}..${one.expectedTo ?? 'no date'} · ${one.confidence}`,
            )
            .join(' | '),
    goals:
      goalRows.length === 0
        ? 'none'
        : goalRows
            .map(
              (goal) =>
                `${goal.id} · ${goal.name} · ${money(goal.currentAmount)} of ${money(goal.targetAmount)} · priority ${String(goal.priority)}`,
            )
            .join(' | '),
  };

  const result = await ask(session, householdId, {
    prompt: PLAN_PROPOSAL_V1,
    locale: promptLocale,
    currency: context.currency,
    grounding,
  });

  if (!result.ok) return { error: 'copilotUnavailable' };

  const rows = result.value.output['proposals'];
  const reading = readProposals(Array.isArray(rows) ? (rows as never) : [], {
    currency: context.currency,
    receivableIds: expected.map((one) => one.id),
    goalIds: goalRows.map((one) => one.id),
    grounding,
    today: context.today,
  });

  const summary = result.value.output['summary'];

  await queryAsUser(session, async (tx) => {
    if (parsed.data.threadId && typeof summary === 'string' && summary.trim() !== '') {
      await tx.insert(chatMessages).values({
        threadId: parsed.data.threadId,
        householdId,
        role: 'assistant',
        body: summary,
        grounding,
      });
    }

    if (reading.accepted.length === 0) return;

    await tx.insert(planProposals).values(
      reading.accepted.map((proposal) => ({
        householdId,
        threadId: parsed.data.threadId ?? null,
        kind: proposal.kind,
        targetId: targetOf(proposal),
        value: valueOf(proposal),
        reason: proposal.reason,
        proposedBy: session.profile.id,
        // Una semana. Pasado eso el mundo cambió lo bastante como para volver a
        // preguntar en vez de aplicar una decisión vieja.
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })),
    );
  });

  revalidatePath(`/${locale}/chat`);
  if (parsed.data.threadId) revalidatePath(`/${locale}/chat/${parsed.data.threadId}`);

  if (reading.accepted.length === 0) return { error: 'noProposals' };
  return { ok: true };
}

/** El identificador sobre el que actúa, cuando el tipo tiene uno. */
function targetOf(proposal: PlanProposal): string | null {
  if ('receivableId' in proposal) return proposal.receivableId;
  if ('goalId' in proposal) return proposal.goalId;
  return null;
}

/** El valor ya normalizado, en la forma en que `applyProposal` lo vuelve a leer. */
function valueOf(proposal: PlanProposal): string {
  switch (proposal.kind) {
    case 'set_income_floor':
    case 'set_buffer_minimum':
      return proposal.amount.toDecimalString();
    case 'set_cushion_months':
      return String(proposal.months);
    case 'set_tax_reserve_rate':
      return String(proposal.rate);
    case 'set_debt_strategy':
      return proposal.strategy;
    case 'set_receivable_window':
      return `${proposal.from}..${proposal.to}`;
    case 'set_receivable_confidence':
      return proposal.confidence;
    case 'set_goal_priority':
      return String(proposal.priority);
    case 'set_goal_target_date':
      return proposal.on;
  }
}

/**
 * Aplica una propuesta que una persona aprobó.
 *
 * Todo lo que escribe está aquí, en código determinista, y ninguna rama toca una
 * fila que no sea del hogar de la sesión. El modelo no participa de este paso:
 * ya hizo lo suyo, que fue convertir una frase en una fila.
 *
 * El valor anterior se guarda antes de escribir. Sin eso, aprobar sería
 * irreversible, y una acción irreversible que empezó en una sugerencia de un
 * modelo es exactamente lo que este diseño evita.
 */
export async function applyProposal(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [proposal] = await tx
      .select({
        id: planProposals.id,
        kind: planProposals.kind,
        targetId: planProposals.targetId,
        value: planProposals.value,
        expiresAt: planProposals.expiresAt,
      })
      .from(planProposals)
      .where(
        and(
          eq(planProposals.id, id.data),
          eq(planProposals.householdId, householdId),
          eq(planProposals.status, 'pending'),
        ),
      )
      .limit(1);

    if (!proposal) return 'notFound' as const;
    if (proposal.expiresAt <= new Date()) {
      await tx
        .update(planProposals)
        .set({ status: 'expired', decidedAt: new Date() })
        .where(eq(planProposals.id, proposal.id));
      return 'expired' as const;
    }

    const previous = await write(tx, householdId, proposal);
    if (previous === FAILED) {
      await tx
        .update(planProposals)
        .set({
          status: 'rejected',
          decidedBy: session.profile.id,
          decidedAt: new Date(),
          failureReason: 'target_gone',
        })
        .where(eq(planProposals.id, proposal.id));
      return 'targetGone' as const;
    }

    await tx
      .update(planProposals)
      .set({
        status: 'applied',
        decidedBy: session.profile.id,
        decidedAt: new Date(),
        previousValue: previous,
      })
      .where(eq(planProposals.id, proposal.id));

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  revalidatePath(`/${localeOf(formData)}/chat`);
  return { ok: true };
}

export async function rejectProposal(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(planProposals)
      .set({ status: 'rejected', decidedBy: session.profile.id, decidedAt: new Date() })
      .where(
        and(
          eq(planProposals.id, id.data),
          eq(planProposals.householdId, session.activeHouseholdId ?? ''),
          eq(planProposals.status, 'pending'),
        ),
      )
      .returning({ id: planProposals.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidatePath(`/${localeOf(formData)}/chat`);
  return { ok: true };
}

type Tx = Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0];

/**
 * Lo que había antes, o la señal de que no había fila que tocar.
 *
 * `FAILED` es un objeto centinela y no la cadena `'failed'`: el valor anterior
 * es texto libre, y una fila cuyo valor previo fuera literalmente «failed»
 * confundiría un valor con un fallo.
 */
const FAILED = Symbol('failed');
type WriteOutcome = string | null | typeof FAILED;

/**
 * Escribe el cambio y devuelve lo que había antes, o `failed`.
 *
 * `failed` cubre el caso de que la fila objetivo haya desaparecido entre la
 * propuesta y la aprobación — el cobro se borró, la meta se cerró. Aplicar sobre
 * cero filas devolvería «ok» sin haber cambiado nada, que es la peor de las tres
 * respuestas posibles.
 */
async function write(
  tx: Tx,
  householdId: string,
  proposal: { kind: string; targetId: string | null; value: string },
): Promise<WriteOutcome> {
  const settingsPatch = async (
    column: 'incomeFloor' | 'cushionMonths' | 'bufferMinimum' | 'taxReserveRate' | 'debtStrategy',
    value: string | number | null,
  ): Promise<string | null> => {
    const [row] = await tx
      .select({
        incomeFloor: householdSettings.incomeFloor,
        cushionMonths: householdSettings.cushionMonths,
        bufferMinimum: householdSettings.bufferMinimum,
        taxReserveRate: householdSettings.taxReserveRate,
        debtStrategy: householdSettings.debtStrategy,
      })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, householdId))
      .limit(1);

    const before = row ? (row[column] ?? null) : null;

    await tx
      .insert(householdSettings)
      .values({ householdId, [column]: value } as never)
      .onConflictDoUpdate({
        target: householdSettings.householdId,
        set: { [column]: value, updatedAt: new Date() },
      });

    return before === null ? null : String(before);
  };

  switch (proposal.kind) {
    case 'set_income_floor':
      return settingsPatch('incomeFloor', proposal.value);
    case 'set_buffer_minimum':
      return settingsPatch('bufferMinimum', proposal.value);
    case 'set_cushion_months':
      return settingsPatch('cushionMonths', Number(proposal.value));
    case 'set_tax_reserve_rate':
      return settingsPatch('taxReserveRate', proposal.value);
    case 'set_debt_strategy':
      return settingsPatch('debtStrategy', proposal.value);

    case 'set_receivable_window': {
      if (!proposal.targetId) return FAILED;
      const [from, to] = proposal.value.split('..');
      if (!from || !to) return FAILED;

      const [updated] = await tx
        .update(receivables)
        .set({
          expectedFrom: from,
          expectedTo: to,
          expectedOn: from === to ? from : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(receivables.id, proposal.targetId),
            eq(receivables.householdId, householdId),
            isNull(receivables.deletedAt),
          ),
        )
        .returning({ from: receivables.expectedFrom, to: receivables.expectedTo });

      return updated ? `${updated.from ?? ''}..${updated.to ?? ''}` : FAILED;
    }

    case 'set_receivable_confidence': {
      if (!proposal.targetId) return FAILED;
      const [before] = await tx
        .select({ confidence: receivables.confidence })
        .from(receivables)
        .where(
          and(eq(receivables.id, proposal.targetId), eq(receivables.householdId, householdId)),
        )
        .limit(1);

      if (!before) return FAILED;

      await tx
        .update(receivables)
        .set({
          confidence: proposal.value as 'confirmed' | 'likely' | 'estimated',
          updatedAt: new Date(),
        })
        .where(eq(receivables.id, proposal.targetId));

      return before.confidence;
    }

    case 'set_goal_priority':
    case 'set_goal_target_date': {
      if (!proposal.targetId) return FAILED;
      const [before] = await tx
        .select({ priority: goals.priority, targetDate: goals.targetDate })
        .from(goals)
        .where(and(eq(goals.id, proposal.targetId), eq(goals.householdId, householdId)))
        .limit(1);

      if (!before) return FAILED;

      await tx
        .update(goals)
        .set(
          proposal.kind === 'set_goal_priority'
            ? { priority: Number(proposal.value), updatedAt: new Date() }
            : { targetDate: proposal.value, updatedAt: new Date() },
        )
        .where(eq(goals.id, proposal.targetId));

      return proposal.kind === 'set_goal_priority'
        ? String(before.priority)
        : (before.targetDate ?? null);
    }

    default:
      return FAILED;
  }
}
