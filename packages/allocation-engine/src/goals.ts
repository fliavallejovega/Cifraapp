import { daysBetween, type Money, type PlainDate } from '@app/domain';

/**
 * Cuándo una meta deja de ser un deseo y pasa a ser una fecha.
 *
 * Una casa ordena sus metas por importancia y eso alcanza mientras ninguna
 * tenga día. Pero «el viaje es el 20 de diciembre y ya compramos los boletos»
 * no es una preferencia más fuerte: es un compromiso con una fecha, y una meta
 * comprometida que no se llena a tiempo no queda a medias, queda incumplida.
 *
 * Por eso el compromiso lo declara la persona y no lo deduce el producto. Una
 * meta con fecha no está confirmada por tener fecha —«algún día en diciembre»
 * es una fecha— y adivinar que lo está sería mover dinero de un lado a otro
 * porque alguien escribió un día en una casilla.
 */

/**
 * El peso de una meta en el reparto. **Menor es más urgente**, igual que en el
 * resto del motor.
 *
 * Las confirmadas van todas por delante de las que no lo están, y entre ellas
 * manda la fecha: la de diciembre antes que la de marzo. Una confirmada cuya
 * fecha ya pasó es la más urgente de todas — no dejó de hacer falta por llegar
 * tarde, hace más falta.
 *
 * Las que no están confirmadas conservan exactamente el orden que la casa les
 * dio. El producto no reordena lo que nadie le pidió reordenar.
 */
export function goalWeight(input: {
  readonly priority: number;
  readonly targetDate: PlainDate | null;
  readonly isCommitted: boolean;
  readonly today: PlainDate;
}): number {
  const ranked = Math.max(input.priority, 0);
  if (!input.isCommitted) return ranked;

  // Confirmada sin fecha: por delante de todo lo no confirmado, y por detrás de
  // cualquier confirmada que sí sepa cuándo. «Lo vamos a hacer» pesa menos que
  // «lo vamos a hacer el martes».
  if (!input.targetDate) return -1;

  /**
   * Confirmada y con día. La banda es lo bastante ancha para que ninguna fecha
   * real la desborde: mil años de plazo siguen cayendo por debajo de −1, que es
   * donde tiene que estar para ganarle a las confirmadas sin fecha.
   */
  const BAND = 1_000_000;
  const days = daysBetween(input.today, input.targetDate);
  return -BAND + Math.min(Math.max(days, -BAND), BAND - 2);
}

/** Un cobro esperado, tal como el reparto necesita verlo. */
export interface ExpectedReceipt {
  readonly id: string;
  readonly name: string;
  readonly amount: Money;
  /** Nulo cuando el hogar no sabe cuándo. No se atribuye a ninguna meta. */
  readonly expectedOn: PlainDate | null;
}

/** Un cobro ya atribuido: si está aquí, sabe cuándo llega. */
export type DatedReceipt = ExpectedReceipt & { readonly expectedOn: PlainDate };

export interface GoalWithDate {
  readonly id: string;
  readonly targetDate: PlainDate | null;
}

/**
 * Qué cobro le sirve a qué meta.
 *
 * Un préstamo que te devuelven el 10 de diciembre le sirve al viaje del 20 y no
 * al carro de marzo: llega a tiempo para el primero, y para cuando llegue marzo
 * ese dinero ya se gastó. Así que cada cobro va a la **meta más cercana que
 * todavía no ha vencido cuando el cobro entra**, que es la única a la que
 * alcanza con seguridad.
 *
 * Dos cosas que a propósito no hace:
 *
 * - **No reparte un cobro entre varias metas.** Mil balboas que llegan en
 *   diciembre no son quinientos para el viaje y quinientos para el carro: son
 *   mil que llegan una vez, y prometerlos dos veces es la aritmética que deja a
 *   una casa corta en las dos.
 * - **No suma el cobro al saldo de la meta.** Esto dice «viene esto para esta
 *   fecha», no «ya lo tienes». El plan se hace con el dinero que entró; un
 *   cobro tratado como cierto es el número optimista que arruina un
 *   presupuesto.
 *
 * Un cobro sin fecha no se atribuye: no se puede saber si llega a tiempo para
 * nada. Uno posterior a todas las metas fechadas, tampoco.
 */
export function receiptsByGoal(input: {
  readonly goals: readonly GoalWithDate[];
  readonly receipts: readonly ExpectedReceipt[];
}): Map<string, DatedReceipt[]> {
  const dated = input.goals
    .filter((goal): goal is GoalWithDate & { targetDate: PlainDate } => goal.targetDate !== null)
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));

  const byGoal = new Map<string, DatedReceipt[]>();

  for (const receipt of input.receipts) {
    if (!receipt.expectedOn) continue;
    const when = receipt.expectedOn;
    // Ya fechado, y el tipo lo dice: lo que sale de aquí siempre sabe cuándo
    // llega, porque atribuir sin fecha es justo lo que esta función no hace.
    const arriving: DatedReceipt = { ...receipt, expectedOn: when };
    const goal = dated.find((one) => one.targetDate >= when);
    if (!goal) continue;
    const list = byGoal.get(goal.id);
    if (list) list.push(arriving);
    else byGoal.set(goal.id, [arriving]);
  }

  return byGoal;
}
