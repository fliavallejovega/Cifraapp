import 'server-only';

import { QUESTION_ANSWER_V1, type PromptLocale } from '@app/ai';
import { formatMoney, type MoneyLocale } from '@app/domain';
import type { GoalPlan } from '@app/investment-engine';

import { ask, copilotIsConfigured } from '../ai';
import type { Session } from '../session';

import type { InvestmentProfileView } from './investments';

/**
 * The assistant's part in the investing module, and its limits.
 *
 * It is handed figures the engine already computed and asked to explain the
 * trade between them in the household's own terms. It is given the household's
 * stated interests so the explanation is about their situation rather than a
 * generic one.
 *
 * What it is not given, and cannot therefore produce: a price, a rating, a
 * forecast, or the name of anything to buy. The grounding contains no market
 * data because the product holds none, and the guardrail rejects any figure in
 * the answer that is not in the grounding — so an invented return cannot reach
 * the screen even if the model produces one.
 *
 * The question is fixed rather than taken from the household. This surface
 * explains a table; the place to ask an open question is the chat, where the
 * answer is stored with its grounding and can be read back.
 */

export type InvestmentNarrative =
  | { readonly state: 'unavailable' }
  | { readonly state: 'declined'; readonly reason: 'budget' | 'quality' | 'error' }
  | { readonly state: 'answered'; readonly body: string };

export async function explainInvestmentPlan(
  session: Session,
  householdId: string,
  profile: InvestmentProfileView,
  plans: readonly GoalPlan[],
  locale: PromptLocale,
  moneyLocale: MoneyLocale,
): Promise<InvestmentNarrative> {
  if (!copilotIsConfigured() || plans.length === 0) return { state: 'unavailable' };

  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: moneyLocale });

  const chosen = plans
    .map((plan) => {
      const outcome = plan.outcomes.find((entry) => entry.level === profile.riskLevel);
      if (!outcome) return '';

      return [
        plan.goal.name,
        `${money(plan.goal.current)} of ${money(plan.goal.target)}`,
        `${String(plan.goal.months)} months`,
        `${money(outcome.monthly)} a month at the ${profile.riskLevel} assumption`,
        `range ${money(outcome.ifPoor)} to ${money(outcome.ifGood)}`,
        `without any growth ${money(plan.withoutGrowth)} a month`,
        outcome.tooShort ? 'horizon shorter than this level suits' : '',
      ]
        .filter((part) => part !== '')
        .join(' · ');
    })
    .filter((line) => line !== '')
    .join('\n');

  const result = await ask(session, householdId, {
    prompt: QUESTION_ANSWER_V1,
    locale,
    currency: profile.monthlyCapacity.currency,
    grounding: {
      question:
        locale === 'en'
          ? 'Explain what these figures mean for this household, in plain words. Do not name any investment to buy, do not predict a return, and use only the figures given.'
          : 'Explica qué significan estas cifras para este hogar, en palabras llanas. No nombres ninguna inversión que comprar, no predigas un rendimiento, y usa solo las cifras dadas.',
      riskLevel: profile.riskLevel,
      capacity: money(profile.monthlyCapacity),
      emergencyFund: profile.hasEmergencyFund ? 'yes' : 'no',
      interests: profile.interests.length > 0 ? profile.interests.join(', ') : 'none stated',
      goals: chosen,
      // Named so the answer can say it: these are assumptions the household can
      // change, not measurements the product made.
      assumptions: profile.usingDefaultBand ? "the product's own band" : 'set by the household',
    },
  });

  if (!result.ok) {
    switch (result.error.kind) {
      case 'not_configured':
        return { state: 'unavailable' };
      case 'budget_exhausted':
        return { state: 'declined', reason: 'budget' };
      case 'ungrounded_figures':
      case 'malformed_output':
      case 'refused':
        // The guardrail found a figure it could not tie to the grounding. On
        // this screen in particular that is the system working exactly as it
        // should: an invented return is the one thing it must never print.
        return { state: 'declined', reason: 'quality' };
      case 'missing_grounding':
      case 'transport':
        return { state: 'declined', reason: 'error' };
    }
  }

  const answerable = result.value.output['answerable'];
  if (answerable === false) return { state: 'declined', reason: 'quality' };

  const answer = result.value.output['answer'];
  if (typeof answer !== 'string' || answer.trim() === '') {
    return { state: 'declined', reason: 'quality' };
  }

  return { state: 'answered', body: answer };
}
