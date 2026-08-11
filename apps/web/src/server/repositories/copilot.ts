import 'server-only';

import { ALLOCATION_EXPLANATION_V1, type AIFailure, type PromptLocale } from '@app/ai';
import { formatMoney } from '@app/domain';

import { ask, copilotIsConfigured } from '../ai';
import type { Session } from '../session';

import type { PlanView } from './plan';

/**
 * The copilot's one job on the plan screen: the paragraph above the lines.
 *
 * Every line of a plan already carries a deterministic reason, rendered from the
 * message catalogue. This adds the sentence that reads the plan as a whole — and
 * it is additive by construction. If the provider is missing, over budget, slow
 * or wrong, the screen loses a paragraph and keeps the plan.
 *
 * The grounding is built from the same `PlanView` the screen renders, formatted
 * exactly as the screen formats it, so the guardrail's comparison is against the
 * strings the household will actually see.
 */

export type PlanNarrative =
  | { readonly state: 'unavailable' }
  | { readonly state: 'declined'; readonly reason: 'budget' | 'quality' | 'error' }
  | { readonly state: 'answered'; readonly summary: string; readonly cautions: readonly string[] };

export async function explainPlan(
  session: Session,
  householdId: string,
  view: PlanView,
  locale: PromptLocale,
): Promise<PlanNarrative> {
  if (!copilotIsConfigured() || view.isEmpty) return { state: 'unavailable' };

  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';
  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: moneyLocale });

  const lines = view.plan.lines
    .map((line) => `${line.label} ${money(line.allocated)} of ${money(line.requested)}`)
    .join(' · ');

  const result = await ask(session, householdId, {
    prompt: ALLOCATION_EXPLANATION_V1,
    locale,
    currency: view.currency,
    grounding: {
      incoming: money(view.plan.incoming),
      lines: lines.length > 0 ? lines : 'none',
      unallocated: money(view.plan.unallocated),
      safeToSpend: money(view.safeToSpend.safeToSpend),
    },
  });

  if (!result.ok) return declined(result.error);

  const summary = result.value.output['summary'];
  const cautions = result.value.output['cautions'];

  return {
    state: 'answered',
    summary: typeof summary === 'string' ? summary : '',
    cautions: Array.isArray(cautions) ? (cautions as readonly string[]) : [],
  };
}

function declined(failure: AIFailure): PlanNarrative {
  switch (failure.kind) {
    case 'not_configured':
      return { state: 'unavailable' };
    case 'budget_exhausted':
      return { state: 'declined', reason: 'budget' };
    case 'ungrounded_figures':
    case 'malformed_output':
    case 'refused':
      // The model produced something the product will not show. This is the
      // guardrail working, and the household is told the assistant declined
      // rather than shown a sentence nobody could verify.
      return { state: 'declined', reason: 'quality' };
    case 'missing_grounding':
    case 'transport':
      return { state: 'declined', reason: 'error' };
  }
}
