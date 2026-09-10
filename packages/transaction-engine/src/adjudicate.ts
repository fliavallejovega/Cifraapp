import type { DuplicateVerdict } from './identity.js';

/**
 * La segunda lectura, y hasta dónde se le deja llegar.
 *
 * ## El caso que el motor determinista no puede ver
 *
 * Alguien anota a mano «pago a Giovanni, 500, 7 de setiembre». El estado de
 * cuenta de su pareja trae «GIOVANNI CINTIONE 500.00 07/09». Mismo monto, mismo
 * día, y para el motor de similitud «a giovanni» contra «giovanni cintione» es
 * un parecido fuerte — pero no siempre alcanza, y hay casos donde la relación
 * entre los dos textos es evidente para cualquier persona y opaca para un
 * trigrama: «Zelle a G. Cintione» contra «GIOVANNI C», «transf fam» contra un
 * nombre completo, un apodo contra el nombre del banco.
 *
 * Un modelo lee esos pares bien. Por eso se le pregunta.
 *
 * ## Lo que no se le deja hacer, y por qué
 *
 * **No puede archivar.** Si el motor dijo `new` y el modelo dice `different`, el
 * resultado sigue siendo `new` — pero eso no significa «archivar»: significa que
 * la fila queda como estaba, y una persona sigue confirmándola. El modelo nunca
 * mueve una fila **hacia** menos revisión.
 *
 * **No puede descartar.** Nada de lo que diga produce `duplicate`. Ese veredicto
 * esconde la fila del hogar, y una fila escondida por una opinión es un
 * movimiento que desapareció sin que nadie lo viera. Sólo el fingerprint exacto
 * o una referencia externa idéntica —cosas que se pueden auditar— llegan ahí.
 *
 * **Sólo puede subir.** `new` → `review`. Es un llamado de atención, que es
 * exactamente el papel para el que sirve: notar un parecido que la aritmética no
 * nota, y pedir que alguien mire.
 *
 * La asimetría no es timidez. Un falso positivo del modelo cuesta una casilla
 * que alguien desmarca; un falso negativo con permiso para archivar cuesta un
 * movimiento duplicado en el libro, o uno real que nadie volvió a ver.
 */

/** Lo que un modelo puede decir de un par. Nada más. */
export type AiOpinion = 'same' | 'different' | 'unsure';

export interface Adjudication {
  readonly verdict: DuplicateVerdict;
  /** Quién produjo el veredicto final. Se guarda y se enseña. */
  readonly decidedBy: 'engine' | 'ai_raised';
  /** Verdadero cuando la opinión del modelo cambió algo. */
  readonly aiChangedIt: boolean;
}

export function adjudicate(
  engineVerdict: DuplicateVerdict,
  opinion: AiOpinion | null,
): Adjudication {
  const unchanged = {
    verdict: engineVerdict,
    decidedBy: 'engine',
    aiChangedIt: false,
  } as const;

  if (opinion === null) return unchanged;

  // El único movimiento permitido: subir una fila que el motor dio por nueva a
  // la cola de revisión. Todo lo demás deja el veredicto del motor intacto.
  if (engineVerdict === 'new' && opinion === 'same') {
    return { verdict: 'review', decidedBy: 'ai_raised', aiChangedIt: true };
  }

  return unchanged;
}

/**
 * A qué pares vale la pena preguntarle.
 *
 * No a todos: una importación de doscientas líneas contra cuatrocientos
 * movimientos son ochenta mil pares, y preguntarle a un modelo por cada uno
 * gastaría el presupuesto del mes en una tarde para confirmar lo obvio.
 *
 * Se pregunta sólo donde el motor determinista **ya vio algo y no supo
 * resolverlo**: mismo monto exacto, dentro de la ventana de fechas, y sin
 * veredicto firme. Ahí es donde una lectura humana del texto cambia la
 * respuesta, y sólo ahí.
 */
export function worthAsking(candidate: {
  readonly verdict: DuplicateVerdict;
  readonly hasSameAmountMatch: boolean;
}): boolean {
  return candidate.verdict === 'new' && candidate.hasSameAmountMatch;
}
