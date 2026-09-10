/**
 * Si una tarjeta puede pagar una promoción.
 *
 * Vive aparte de la consulta y sin `server-only` a propósito: es la regla que
 * decide qué se le enseña a la casa como suyo, y una regla sobre plata que no
 * se puede probar en aislamiento acaba probándose en producción.
 */

/** Una tarjeta o cuenta del hogar, tal como la lee el cruce. */
interface Payer {
  readonly type: string;
  readonly network: string | null;
  readonly program: string | null;
  readonly issuerKey: string | null;
}

/** Lo que una promoción exige. */
interface Demand {
  readonly issuerKey: string;
  readonly cardTypes: readonly string[];
  readonly networks: readonly string[];
  readonly programs: readonly string[];
}

/**
 * Si esta tarjeta puede pagar esta promoción.
 *
 * Tres respuestas y no dos. `maybe` es el caso en que todo encaja salvo que la
 * promoción exige un programa y la tarjeta no declaró el suyo: no se sabe.
 * Convertir ese «no se sabe» en un sí o en un no es el error, en cualquiera de
 * las dos direcciones — uno esconde una promoción que quizá aplica, el otro
 * afirma sobre plata algo que nadie dijo.
 *
 * Un arreglo vacío siempre significa «a todas», que es lo que dice una
 * promoción que no distingue.
 */
export function matches(card: Payer, demand: Demand): 'yes' | 'maybe' | 'no' {
  // Sin coincidencia de banco no hay nada más que mirar.
  if (!card.issuerKey || card.issuerKey !== demand.issuerKey) return 'no';

  const isCredit = card.type === 'credit_card';
  if (demand.cardTypes.length > 0) {
    if (isCredit && !demand.cardTypes.includes('credit')) return 'no';
    if (!isCredit && !demand.cardTypes.includes('debit')) return 'no';
  }

  // La red sólo se exige a las tarjetas: una cuenta de la que sale un débito no
  // declara red, y descartarla por eso sería descartar la mitad de las
  // promociones de Panamá.
  if (demand.networks.length > 0 && isCredit) {
    if (!card.network || !demand.networks.includes(card.network)) return 'no';
  }

  if (demand.programs.length > 0) {
    if (card.program === null) return 'maybe';
    if (!demand.programs.includes(card.program)) return 'no';
  }

  return 'yes';
}
