import 'server-only';

import { transactions } from '@app/database/schema';
import { and, isNull, notInArray, type SQL } from 'drizzle-orm';

/**
 * Qué movimiento necesita de verdad que alguien le ponga rubro.
 *
 * ## Por qué no alcanza con «no tiene categoría»
 *
 * Porque hay movimientos a los que **no les toca ninguna**, y contarlos como
 * pendientes convierte una cola que debería llegar a cero en una que nunca
 * llega. Un aviso que no se puede apagar se aprende a ignorar, y el día que
 * marque algo real ya nadie lo mira.
 *
 * El caso que lo hizo evidente: un pago a la tarjeta. No es consumo, es plata
 * moviéndose de un bolsillo a otro de la misma casa. Quedaba en el aviso de
 * «movimientos sin rubro» sin nada que se pudiera hacer al respecto, porque no
 * había nada que hacer.
 *
 * ## Los tres estados que quedan fuera
 *
 * - `transfer` — no es gasto ni ingreso: es la casa moviéndose plata a sí misma.
 * - `excluded` — alguien lo apartó a propósito. Volver a preguntarle es
 *   deshacerle la decisión.
 * - `duplicate` — no ocurrió dos veces. Pedirle rubro a la copia es pedirle que
 *   clasifique algo que no pasó.
 *
 * `needs_review` **sí** entra: ahí el motor propuso algo con poca confianza, y
 * eso es exactamente lo que una persona tiene que resolver.
 *
 * ## Por qué vive en un módulo y no repetido
 *
 * Estaba escrito seis veces —el aviso, la cola, el cierre del mes, el reporte
 * del contable, el barrido, el filtro— y las seis decían sólo «no tiene
 * categoría». Arreglar una y no las otras es como quedó el producto: la fila
 * dejó de decir «sin rubro» y el contador de arriba seguía contándola.
 */

/** Los estados de un movimiento al que no le corresponde ningún rubro. */
export const WITHOUT_A_CATEGORY_OF_THEIR_OWN = ['transfer', 'excluded', 'duplicate'] as const;

/**
 * El predicado, para usar dentro de un `and(...)`.
 *
 * Devuelve siempre una condición: `and` de dos cláusulas nunca es indefinido,
 * y escribir la alternativa entera es más honesto que afirmar que no lo es.
 */
export function needsACategory(): SQL {
  return (
    and(
      isNull(transactions.categoryId),
      notInArray(transactions.status, [...WITHOUT_A_CATEGORY_OF_THEIR_OWN]),
    ) ?? isNull(transactions.categoryId)
  );
}
