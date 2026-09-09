import { toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { PLAN_PROPOSAL_V1 } from './prompts.js';
import { parseOutput } from './schema.js';
import { readProposals, type ProposalContext } from './proposal.js';
import type { OutputRecord } from './types.js';

/**
 * Las tres puertas que una propuesta atraviesa antes de que una persona la vea.
 *
 * Cada prueba de este archivo es un intento de que el modelo consiga algo que no
 * debería: un tipo que no está en el catálogo, un cobro de otro hogar, una cifra
 * que nadie le enseñó. Que fallen es el producto.
 */

const context = (over: Partial<ProposalContext> = {}): ProposalContext => ({
  currency: 'USD',
  receivableIds: ['rec-1', 'rec-2'],
  goalIds: ['goal-1'],
  grounding: {
    'floor.measured': '$1,000.00',
    'buffer.minimum': '$500.00',
    'receivable.rec-1': 'Factura marzo, $1,900.00, entre 2026-10-01 y 2026-10-10',
  },
  today: toPlainDate('2026-09-09'),
  ...over,
});

const row = (over: Partial<Record<string, string>> = {}): OutputRecord => ({
  kind: 'set_cushion_months',
  target: '',
  value: '4',
  reason: 'Pediste guardar cuatro meses.',
  ...over,
});

describe('la primera puerta: el catálogo es cerrado', () => {
  it('acepta un tipo del catálogo', () => {
    const reading = readProposals([row()], context());

    expect(reading.accepted).toEqual([
      { kind: 'set_cushion_months', months: 4, reason: 'Pediste guardar cuatro meses.' },
    ]);
    expect(reading.rejected).toEqual([]);
  });

  it('rechaza cualquier cosa que no esté en él, por plausible que suene', () => {
    const reading = readProposals(
      [
        row({ kind: 'delete_account', target: 'acc-1', value: '' }),
        row({ kind: 'pay_debt', value: '500' }),
        row({ kind: 'close_month', value: '2026-09' }),
      ],
      context(),
    );

    expect(reading.accepted).toEqual([]);
    expect(reading.rejected).toHaveLength(3);
    expect(reading.rejected[0]?.reason).toContain('catálogo');
  });

  it('no lee más de cinco propuestas de una sola respuesta', () => {
    const many = Array.from({ length: 9 }, () => row());
    expect(readProposals(many, context()).accepted).toHaveLength(5);
  });

  it('rechaza una propuesta sin explicación', () => {
    const reading = readProposals([row({ reason: '' })], context());

    expect(reading.accepted).toEqual([]);
    expect(reading.rejected[0]?.reason).toContain('explicación');
  });
});

describe('la segunda puerta: el objetivo tiene que ser del hogar', () => {
  it('acepta un cobro que la sesión sí cargó', () => {
    const reading = readProposals(
      [row({ kind: 'set_receivable_confidence', target: 'rec-1', value: 'likely' })],
      context(),
    );

    expect(reading.accepted[0]).toEqual({
      kind: 'set_receivable_confidence',
      receivableId: 'rec-1',
      confidence: 'likely',
      reason: 'Pediste guardar cuatro meses.',
    });
  });

  it('rechaza un cobro que no está en la lista, aunque el identificador parezca real', () => {
    const reading = readProposals(
      [
        row({ kind: 'set_receivable_confidence', target: 'rec-99', value: 'confirmed' }),
        row({ kind: 'set_goal_priority', target: 'goal-otro', value: '1' }),
      ],
      context(),
    );

    expect(reading.accepted).toEqual([]);
    expect(reading.rejected[0]?.reason).toContain('no es de este hogar');
    expect(reading.rejected[1]?.reason).toContain('no es de este hogar');
  });

  it('rechaza un grado de certeza inventado', () => {
    const reading = readProposals(
      [row({ kind: 'set_receivable_confidence', target: 'rec-1', value: 'muy probable' })],
      context(),
    );

    expect(reading.accepted).toEqual([]);
  });
});

describe('la tercera puerta: las cifras vienen del contexto', () => {
  it('acepta un monto que estaba entre los datos', () => {
    const reading = readProposals(
      [row({ kind: 'set_income_floor', value: '$1,000.00' })],
      context(),
    );

    expect(reading.accepted[0]).toMatchObject({ kind: 'set_income_floor' });
    expect(
      reading.accepted[0]?.kind === 'set_income_floor'
        ? reading.accepted[0].amount.toDecimalString()
        : null,
    ).toBe('1000.0000');
  });

  it('rechaza un monto que el modelo se inventó', () => {
    const reading = readProposals(
      [row({ kind: 'set_income_floor', value: '$1,250.00' })],
      context(),
    );

    expect(reading.accepted).toEqual([]);
    expect(reading.rejected[0]?.reason).toContain('no estaba entre los datos');
  });

  it('rechaza un monto que salió de sumar dos que sí estaban', () => {
    // 1000 + 500 son cifras del contexto; 1500 no lo es, y ese es exactamente
    // el cálculo que un modelo hace bien casi siempre y mal a veces.
    const reading = readProposals(
      [row({ kind: 'set_buffer_minimum', value: '$1,500.00' })],
      context(),
    );

    expect(reading.accepted).toEqual([]);
  });

  it('rechaza un monto negativo y algo que no es un monto', () => {
    expect(
      readProposals([row({ kind: 'set_income_floor', value: 'todo lo que puedas' })], context())
        .accepted,
    ).toEqual([]);
    expect(
      readProposals(
        [row({ kind: 'set_buffer_minimum', value: '-500' })],
        context({ grounding: { a: '-500' } }),
      ).accepted,
    ).toEqual([]);
  });
});

describe('los rangos y las fechas', () => {
  it('acepta una ventana bien formada y en el futuro', () => {
    const reading = readProposals(
      [row({ kind: 'set_receivable_window', target: 'rec-1', value: '2026-10-01..2026-10-10' })],
      context(),
    );

    expect(reading.accepted[0]).toMatchObject({
      kind: 'set_receivable_window',
      receivableId: 'rec-1',
      from: '2026-10-01',
      to: '2026-10-10',
    });
  });

  it('rechaza una ventana al revés, una entera en el pasado y una mal escrita', () => {
    const bad = (value: string) =>
      readProposals(
        [row({ kind: 'set_receivable_window', target: 'rec-1', value })],
        context(),
      );

    expect(bad('2026-10-10..2026-10-01').accepted).toEqual([]);
    expect(bad('2026-01-01..2026-01-10').accepted).toEqual([]);
    expect(bad('octubre').accepted).toEqual([]);
    expect(bad('2026-02-30..2026-03-01').accepted).toEqual([]);
  });

  it('rechaza meses de colchón y tasas fuera de rango', () => {
    expect(readProposals([row({ value: '40' })], context()).accepted).toEqual([]);
    expect(readProposals([row({ value: '0' })], context()).accepted).toEqual([]);
    expect(
      readProposals([row({ kind: 'set_tax_reserve_rate', value: '85%' })], context()).accepted,
    ).toEqual([]);
    expect(
      readProposals([row({ kind: 'set_tax_reserve_rate', value: '25%' })], context()).accepted[0],
    ).toMatchObject({ kind: 'set_tax_reserve_rate', rate: 25 });
  });

  it('rechaza una meta con fecha en el pasado', () => {
    expect(
      readProposals(
        [row({ kind: 'set_goal_target_date', target: 'goal-1', value: '2025-01-01' })],
        context(),
      ).accepted,
    ).toEqual([]);
  });

  it('acepta sólo las estrategias que el motor de deuda conoce', () => {
    expect(
      readProposals([row({ kind: 'set_debt_strategy', value: 'Avalanche' })], context()).accepted[0],
    ).toMatchObject({ strategy: 'avalanche' });
    expect(
      readProposals([row({ kind: 'set_debt_strategy', value: 'la que sea' })], context()).accepted,
    ).toEqual([]);
  });
});

describe('el prompt que produce las filas', () => {
  it('declara la misma lista cerrada que el validador acepta', () => {
    const field = PLAN_PROPOSAL_V1.output['proposals'];
    expect(field?.kind).toBe('record_list');

    const kinds =
      field?.kind === 'record_list' && field.fields['kind']?.kind === 'choice'
        ? field.fields['kind'].options
        : [];

    // Cada opción que el prompt ofrece tiene que pasar la primera puerta: si el
    // prompt y el catálogo se separan, el modelo obedece y el validador rechaza.
    for (const kind of kinds) {
      const reading = readProposals(
        [row({ kind, target: 'rec-1', value: valueFor(kind) })],
        context(),
      );
      expect(reading.rejected.map((one) => one.reason)).not.toContain(
        'No está en el catálogo de cambios que el chat puede proponer.',
      );
    }
    expect(kinds.length).toBeGreaterThan(0);
  });

  it('no se cachea: la misma frase en dos momentos habla de filas distintas', () => {
    expect(PLAN_PROPOSAL_V1.cacheable).toBe(false);
  });

  it('produce filas que el validador de esquema acepta', () => {
    const parsed = parseOutput(PLAN_PROPOSAL_V1.output, {
      summary: 'Subiría el colchón a cuatro meses.',
      proposals: [row()],
    });

    expect(parsed.ok).toBe(true);
  });
});

function valueFor(kind: string): string {
  switch (kind) {
    case 'set_income_floor':
    case 'set_buffer_minimum':
      return '$1,000.00';
    case 'set_cushion_months':
      return '4';
    case 'set_tax_reserve_rate':
      return '25';
    case 'set_debt_strategy':
      return 'avalanche';
    case 'set_receivable_window':
      return '2026-10-01..2026-10-10';
    case 'set_receivable_confidence':
      return 'likely';
    case 'set_goal_priority':
      return '1';
    default:
      return '2026-12-01';
  }
}
