import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { ProposalView } from './proposals';

/**
 * Qué haría una propuesta, escrito por código y no por el modelo.
 *
 * La distinción es el punto entero de la pantalla. La frase que justifica la
 * propuesta la escribió un modelo y se presenta como suya; **la descripción de
 * lo que va a pasar** se construye aquí, a partir del tipo y el valor que ya
 * pasaron el validador. Si las dos vinieran del modelo, un botón podría decir
 * una cosa y hacer otra, y la persona que aprueba estaría leyendo prosa en vez
 * de un contrato.
 *
 * Un tipo que el catálogo ya no reconoce se describe por su nombre crudo en vez
 * de desaparecer: una fila vieja tiene que poder explicarse, aunque el código
 * que la produjo se haya ido.
 */
export async function describeProposal(proposal: ProposalView, locale: string): Promise<string> {
  const t = await getTranslations({ locale, namespace: 'chat.proposals.kinds' });

  const key = proposal.kind;
  const parts = proposal.value.split('..');

  switch (proposal.kind) {
    case 'set_income_floor':
    case 'set_buffer_minimum':
    case 'set_cushion_months':
    case 'set_tax_reserve_rate':
    case 'set_goal_priority':
    case 'set_goal_target_date':
    case 'set_receivable_confidence':
      return t(key, { value: proposal.value });
    case 'set_debt_strategy':
      return t(key, { value: t(`strategy_${proposal.value}`) });
    case 'set_receivable_window':
      return t(key, { from: parts[0] ?? '', to: parts[1] ?? '' });
    default:
      return `${proposal.kind}: ${proposal.value}`;
  }
}
