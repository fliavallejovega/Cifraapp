import type { Money } from '@app/domain';

/**
 * A qué deuda pertenece un pago.
 *
 * ## Los dos casos que esto resuelve
 *
 * **El pago a la tarjeta.** Sale $600 de la cuenta de ahorros el 15. Sin esto es
 * un gasto de $600 —el mes se ve peor de lo que fue— y la tarjeta sigue debiendo
 * lo mismo. Es dinero moviéndose de un bolsillo a otro de la misma casa, y
 * contarlo como gasto es contarlo dos veces: una al comprar, otra al pagar.
 *
 * **El pago a una persona.** «Pago a Giovanni 500» contra la deuda informal de
 * $1,800 con Giovanni Cintione. Sin esto la deuda dice $1,800 para siempre y la
 * casa lleva la cuenta en la cabeza.
 *
 * ## Por qué propone y no aplica
 *
 * Porque equivocarse de deuda mueve plata de un saldo a otro sin que nadie lo
 * note. Lo que sale de aquí llega a la pantalla de revisión con la deuda
 * preseleccionada y la razón a la vista; alguien la confirma o la cambia. La
 * preselección ahorra el trabajo; no lo reemplaza.
 *
 * ## Qué se exige para proponer
 *
 * Que la deuda esté nombrada en el texto. No se propone por monto ni por fecha:
 * dos deudas de la casa pueden coincidir en cuota y en día, y elegir una de las
 * dos por aritmética es elegirla al azar con cara de certeza. El nombre —de la
 * contraparte, del banco emisor, o los últimos cuatro de la tarjeta— es la
 * única señal que distingue.
 */

export interface DebtTarget {
  readonly debtId: string;
  /** Cómo se llama la deuda: «Visa Blei BG», «Préstamo de Giovanni». */
  readonly label: string;
  /** El nombre normalizado de la contraparte, cuando la hay. */
  readonly counterpartyNormalized: string | null;
  /** Los últimos cuatro de la tarjeta que la lleva, cuando es una tarjeta. */
  readonly maskedNumber: string | null;
  readonly isCard: boolean;
  readonly outstanding: Money;
}

export interface DebtProposal {
  readonly debtId: string;
  /** Por qué se propuso: se enseña junto a la fila. */
  readonly because: 'counterparty_named' | 'card_digits' | 'card_named';
  readonly label: string;
}

/**
 * Un mínimo de caracteres para que un nombre cuente como nombrado.
 *
 * Sin esto, una contraparte llamada «Ana» aparecería dentro de «ANARANJADO» y
 * de media docena de comercios. Tres letras es el punto donde una coincidencia
 * de texto deja de ser casualidad en descripciones de estados de cuenta.
 */
const MIN_NAME_LENGTH = 4;

export function proposeDebt(
  payment: { readonly descriptionNormalized: string; readonly direction: 'inflow' | 'outflow' },
  debts: readonly DebtTarget[],
): DebtProposal | null {
  // Un pago sale. Una entrada no baja una deuda — la sube, o es otra cosa, y en
  // los dos casos no es esto.
  if (payment.direction !== 'outflow') return null;

  const text = payment.descriptionNormalized.toLowerCase();
  if (text.trim() === '') return null;

  /*
    La contraparte primero.

    Una deuda con nombre propio es la que menos formas tiene de aparecer en un
    estado de cuenta, así que cuando aparece es la señal más fuerte. Y es el
    caso que hoy no tiene ninguna otra forma de resolverse.
  */
  for (const debt of debts) {
    const name = debt.counterpartyNormalized?.toLowerCase().trim();
    if (!name || name.length < MIN_NAME_LENGTH) continue;

    if (namedIn(text, name)) {
      return { debtId: debt.debtId, because: 'counterparty_named', label: debt.label };
    }
  }

  /*
    Después los últimos cuatro de una tarjeta.

    «PAGO TARJETA *0209» es literal y no se confunde con nada. Se exige que la
    deuda sea de tarjeta: cuatro dígitos sueltos aparecen en referencias de
    transferencia todo el tiempo.
  */
  for (const debt of debts) {
    if (!debt.isCard || !debt.maskedNumber) continue;
    if (new RegExp(`(^|\\D)${debt.maskedNumber}(\\D|$)`).test(text)) {
      return { debtId: debt.debtId, because: 'card_digits', label: debt.label };
    }
  }

  // Y por último el nombre de la tarjeta, que la casa escribió y suele repetir
  // en el concepto de la transferencia.
  for (const debt of debts) {
    if (!debt.isCard) continue;
    const label = debt.label.toLowerCase().trim();
    if (label.length >= MIN_NAME_LENGTH && namedIn(text, label)) {
      return { debtId: debt.debtId, because: 'card_named', label: debt.label };
    }
  }

  return null;
}

/**
 * Si un nombre está nombrado en un texto, y no sólo contenido en una palabra.
 *
 * Se comparan palabras completas: «giovanni» aparece en «pago a giovanni» y no
 * en «giovannistore». Un nombre de varias palabras cuenta cuando **todas** sus
 * palabras largas aparecen — «giovanni cintione» coincide con «GIOVANNI C
 * CINTIONE REF 8891», que es como lo escriben los bancos.
 */
function namedIn(text: string, name: string): boolean {
  const words = new Set(text.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== ''));

  const parts = name.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length >= 3);
  if (parts.length === 0) return false;

  return parts.every((part) => words.has(part));
}
