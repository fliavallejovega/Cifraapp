import { describe, expect, it } from 'vitest';

import { adjudicate, worthAsking, type AiOpinion } from './adjudicate.js';
import type { DuplicateVerdict } from './identity.js';

/**
 * El límite de lo que una opinión puede hacerle a un veredicto.
 *
 * Estas pruebas no comprueban que el modelo acierte — eso no se puede afirmar
 * desde aquí. Comprueban lo único que importa si se equivoca: que **el peor
 * error posible siga siendo barato**. Un falso positivo cuesta una casilla que
 * alguien desmarca; un falso negativo con permiso para archivar costaría un
 * movimiento duplicado en el libro, o uno real que nadie volvió a ver.
 */

const VERDICTS: readonly DuplicateVerdict[] = ['new', 'review', 'duplicate'];
const OPINIONS: readonly AiOpinion[] = ['same', 'different', 'unsure'];

describe('adjudicate', () => {
  it('deja el veredicto del motor cuando nadie opinó', () => {
    for (const verdict of VERDICTS) {
      expect(adjudicate(verdict, null)).toEqual({
        verdict,
        decidedBy: 'engine',
        aiChangedIt: false,
      });
    }
  });

  it('sube a revisión una fila nueva cuando el modelo ve el mismo movimiento', () => {
    // El caso Giovanni: «pago a giovanni» anotado a mano contra
    // «GIOVANNI CINTIONE» del estado de cuenta de la pareja.
    const result = adjudicate('new', 'same');

    expect(result.verdict).toBe('review');
    expect(result.decidedBy).toBe('ai_raised');
    expect(result.aiChangedIt).toBe(true);
  });

  it('NUNCA produce «duplicate», diga lo que diga', () => {
    // `duplicate` esconde la fila del hogar. Una fila escondida por una opinión
    // es un movimiento que desapareció sin que nadie lo viera.
    for (const verdict of VERDICTS) {
      for (const opinion of OPINIONS) {
        const result = adjudicate(verdict, opinion);
        if (verdict !== 'duplicate') {
          expect(result.verdict).not.toBe('duplicate');
        }
      }
    }
  });

  it('nunca baja una fila que ya estaba en revisión', () => {
    // Bajarla sería archivarla por opinión: exactamente lo contrario de para
    // qué existe la cola.
    for (const opinion of OPINIONS) {
      expect(adjudicate('review', opinion).verdict).toBe('review');
    }
  });

  it('nunca rescata una que el motor dio por duplicada', () => {
    for (const opinion of OPINIONS) {
      expect(adjudicate('duplicate', opinion).verdict).toBe('duplicate');
    }
  });

  it('no mueve nada cuando el modelo dice que son distintos', () => {
    // «Different» no es permiso para archivar: deja la fila donde estaba, y una
    // persona la sigue confirmando.
    expect(adjudicate('new', 'different').verdict).toBe('new');
    expect(adjudicate('new', 'different').aiChangedIt).toBe(false);
  });

  it('no mueve nada cuando el modelo no sabe', () => {
    expect(adjudicate('new', 'unsure')).toEqual({
      verdict: 'new',
      decidedBy: 'engine',
      aiChangedIt: false,
    });
  });

  it('sólo admite un movimiento en todo el espacio de entradas', () => {
    // La prueba que hace honesto a este módulo: se recorren las nueve
    // combinaciones y se cuenta cuántas cambian algo. Si mañana alguien agrega
    // una segunda transición, esto falla y hay que justificarla.
    const changed = VERDICTS.flatMap((verdict) =>
      OPINIONS.map((opinion) => ({ verdict, opinion, result: adjudicate(verdict, opinion) })),
    ).filter((one) => one.result.aiChangedIt);

    expect(changed).toHaveLength(1);
    expect(changed[0]?.verdict).toBe('new');
    expect(changed[0]?.opinion).toBe('same');
    expect(changed[0]?.result.verdict).toBe('review');
  });
});

describe('worthAsking', () => {
  it('pregunta sólo donde el motor vio algo y no supo resolverlo', () => {
    expect(worthAsking({ verdict: 'new', hasSameAmountMatch: true })).toBe(true);
  });

  it('no pregunta por una fila sin ninguna coincidencia de monto', () => {
    // Doscientas líneas contra cuatrocientos movimientos son ochenta mil pares.
    // Preguntar por todos gastaría el presupuesto del mes en una tarde para
    // confirmar lo obvio.
    expect(worthAsking({ verdict: 'new', hasSameAmountMatch: false })).toBe(false);
  });

  it('no vuelve a preguntar por lo que el motor ya resolvió', () => {
    expect(worthAsking({ verdict: 'review', hasSameAmountMatch: true })).toBe(false);
    expect(worthAsking({ verdict: 'duplicate', hasSameAmountMatch: true })).toBe(false);
  });
});
