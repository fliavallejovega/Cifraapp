import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./ai', () => ({ ask: vi.fn() }));
vi.mock('./session', () => ({ queryAsUser: vi.fn() }));
vi.mock('./household-context', () => ({ loadHouseholdContext: vi.fn() }));
vi.mock('./repositories/family-expenses', () => ({ loadFamilyBoard: vi.fn() }));
vi.mock('./repositories/plan', () => ({ loadPlan: vi.fn() }));

import { validateProposals, type AgentKnown } from './agent';

/**
 * What the assistant may put in front of a person.
 *
 * The model drafts; these rules decide. A proposal naming a movement, an
 * account or a trip leg the lookups did not return is dropped, as is a value
 * outside the catalogue — and the label a person reads is built here, never
 * taken from the model.
 */

const MOVEMENT = '01a08cdf-7568-7e51-a232-5ab2004009d9';
const CATEGORY = '01a08cdf-0000-7e51-a232-5ab200400001';
const ACCOUNT = '01a08cdf-0000-7e51-a232-5ab200400002';
const PERSON = '01a08cdf-0000-7e51-a232-5ab200400003';
const LEG = '01a08cdf-0000-7e51-a232-5ab200400004';
const COMMITMENT = '01a08cdf-0000-7e51-a232-5ab200400005';

function known(): AgentKnown {
  return {
    movements: new Map([[MOVEMENT, 'SUPER 99 VIA ESPANA']]),
    categories: new Map([[CATEGORY, 'Supermercado']]),
    accounts: new Map([[ACCOUNT, 'Master Card Blei']]),
    people: new Map([[PERSON, 'Blei']]),
    legs: new Map([[LEG, { city: 'Venecia', tripId: 't' }]]),
    tripWindow: { start: '2026-12-09', end: '2026-12-27' },
    commitments: new Map([[COMMITMENT, 'Arriendo']]),
    today: '2026-10-04',
  };
}

describe('validateProposals', () => {
  it('keeps changes that name what the lookups returned, with a label built here', () => {
    const proposals = validateProposals(
      [
        { kind: 'recategorize_movement', target: MOVEMENT, value: CATEGORY, reason: 'Es comida.' },
        { kind: 'set_account_owner', target: ACCOUNT, value: PERSON, reason: 'Es de Blei.' },
        { kind: 'set_leg_dates', target: LEG, value: '2026-12-10..2026-12-12', reason: 'x' },
        { kind: 'set_leg_lodging', target: LEG, value: 'prepaid', reason: 'x' },
      ],
      known(),
      'es',
    );
    expect(proposals.map((p) => p.label)).toEqual([
      'Pasar «SUPER 99 VIA ESPANA» a Supermercado',
      'Master Card Blei es de Blei',
      'Venecia: del 2026-12-10 al 2026-12-12',
      'Venecia: hospedaje pagado',
    ]);
  });

  it('drops anything that names an id the household does not have', () => {
    expect(
      validateProposals(
        [
          { kind: 'recategorize_movement', target: 'invented', value: CATEGORY, reason: '' },
          { kind: 'set_account_owner', target: ACCOUNT, value: 'someone-else', reason: '' },
          { kind: 'delete_everything', target: ACCOUNT, value: '', reason: '' },
        ],
        known(),
        'es',
      ),
    ).toEqual([]);
  });

  it('drops leg dates outside the trip or backwards, and unknown lodging values', () => {
    expect(
      validateProposals(
        [
          { kind: 'set_leg_dates', target: LEG, value: '2026-12-01..2026-12-05', reason: '' },
          { kind: 'set_leg_dates', target: LEG, value: '2026-12-12..2026-12-10', reason: '' },
          { kind: 'set_leg_lodging', target: LEG, value: 'free', reason: '' },
        ],
        known(),
        'es',
      ),
    ).toEqual([]);
  });

  it('lets the household be the owner of a shared account', () => {
    const [proposal] = validateProposals(
      [{ kind: 'set_account_owner', target: ACCOUNT, value: 'household', reason: '' }],
      known(),
      'es',
    );
    expect(proposal?.label).toBe('Master Card Blei es de la casa');
    expect(proposal?.status).toBe('proposed');
  });

  it('records a movement the household described, and refuses one dated ahead or unnamed', () => {
    const proposals = validateProposals(
      [
        {
          kind: 'record_movement',
          target: ACCOUNT,
          value: '-20.00|2026-10-04|Supermercado',
          reason: '',
        },
        { kind: 'record_movement', target: ACCOUNT, value: '-20.00|2026-10-09|Mañana', reason: '' },
      ],
      known(),
      'es',
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.label).toContain('Registrar gasto de 20.00');
  });

  it('changes a commitment the lookups returned to the amount the household said', () => {
    const proposals = validateProposals(
      [
        { kind: 'set_commitment_amount', target: COMMITMENT, value: '900', reason: '' },
        { kind: 'set_commitment_amount', target: 'made-up', value: '900', reason: '' },
      ],
      known(),
      'es',
    );
    expect(proposals.map((p) => p.label)).toEqual(['Arriendo pasa a 900']);
  });
});
