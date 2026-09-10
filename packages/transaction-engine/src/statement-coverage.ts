/**
 * Qué estados de cuenta faltan.
 *
 * ## Por qué el sistema tiene que pedirlos él
 *
 * Un hogar con dos personas, cuatro cuentas y tres tarjetas tiene que subir
 * siete documentos por mes. Nadie lleva esa lista en la cabeza, y el que se
 * olvida no se nota: la pantalla enseña un mes que se ve normal, con menos
 * gastos de los que hubo, y la casa concluye que gastó poco. Un hueco silencioso
 * en los datos de un producto financiero no se lee como un hueco — se lee como
 * un buen mes.
 *
 * Por eso esto no espera a que alguien pregunte. Después de cada importación
 * dice, con nombre y apellido: «falta el estado de agosto de la cuenta 1783 y
 * el de la tarjeta 0209».
 *
 * ## Qué cuenta como cubierto
 *
 * Un mes está cubierto cuando esa cuenta tiene al menos un movimiento importado
 * con fecha de ese mes. No se exige un documento por mes: un solo archivo puede
 * traer un trimestre, y exigir uno por mes marcaría como faltante un mes que ya
 * está entero.
 *
 * ## Dónde empieza a contar
 *
 * En el primer mes con actividad de esa cuenta, nunca antes. Reclamar los meses
 * anteriores a que la casa empezara a usar el producto sería reclamar una deuda
 * que nadie contrajo, y una lista de faltantes que no se puede terminar es una
 * lista que se ignora.
 *
 * ## Y el mes en curso
 *
 * No se reclama. El banco todavía no lo cerró: pedirlo es pedir algo que no
 * existe, y eso enseña a la gente a ignorar el aviso — que es como después se
 * ignora el de agosto, que sí falta.
 */

/** `2026-08`. Un mes, sin día, porque un estado de cuenta es de un mes. */
export type YearMonth = string;

export interface AccountActivity {
  readonly accountId: string;
  /** Cómo se llama, para poder nombrarla. */
  readonly name: string;
  /** Los últimos cuatro, cuando la casa los declaró: «1783». */
  readonly maskedNumber: string | null;
  /** `bank` o `card`. Cambia la frase con que se pide. */
  readonly kind: 'bank' | 'card';
  /** Los meses con al menos un movimiento. Sin orden. */
  readonly monthsSeen: readonly YearMonth[];
}

export interface CoverageGap {
  readonly accountId: string;
  readonly name: string;
  readonly maskedNumber: string | null;
  readonly kind: 'bank' | 'card';
  /** Los meses que faltan, del más viejo al más nuevo. */
  readonly missing: readonly YearMonth[];
}

export interface CoverageReport {
  readonly gaps: readonly CoverageGap[];
  /** Cuentas que nunca recibieron nada. Es un caso distinto y se dice distinto. */
  readonly neverImported: readonly Omit<CoverageGap, 'missing'>[];
  readonly isComplete: boolean;
}

/**
 * Un tope de meses reclamados por cuenta.
 *
 * Una cuenta que dejó de usarse hace dos años generaría veinticuatro reclamos y
 * ahogaría a los tres que importan. Se piden los más recientes, que son los que
 * todavía se pueden conseguir del banco.
 */
const MAX_MONTHS_PER_ACCOUNT = 6;

export function findCoverageGaps(
  accounts: readonly AccountActivity[],
  currentMonth: YearMonth,
): CoverageReport {
  const gaps: CoverageGap[] = [];
  const neverImported: Omit<CoverageGap, 'missing'>[] = [];

  for (const account of accounts) {
    const seen = new Set(account.monthsSeen);

    if (seen.size === 0) {
      neverImported.push({
        accountId: account.accountId,
        name: account.name,
        maskedNumber: account.maskedNumber,
        kind: account.kind,
      });
      continue;
    }

    const sorted = [...seen].sort();
    const first = sorted[0];
    if (first === undefined) continue;

    // Hasta el mes anterior al corriente: el banco todavía no cerró éste.
    const last = previousMonth(currentMonth);
    if (last < first) continue;

    const missing: YearMonth[] = [];
    for (let month = first; month <= last; month = nextMonth(month)) {
      if (!seen.has(month)) missing.push(month);
    }

    if (missing.length > 0) {
      gaps.push({
        accountId: account.accountId,
        name: account.name,
        maskedNumber: account.maskedNumber,
        kind: account.kind,
        missing: missing.slice(-MAX_MONTHS_PER_ACCOUNT),
      });
    }
  }

  return {
    gaps,
    neverImported,
    isComplete: gaps.length === 0 && neverImported.length === 0,
  };
}

/** El mes de una fecha ISO. `2026-08-14` → `2026-08`. */
export function monthOf(date: string): YearMonth {
  return date.slice(0, 7);
}

export function nextMonth(month: YearMonth): YearMonth {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return index === 12
    ? `${String(year + 1)}-01`
    : `${String(year)}-${String(index + 1).padStart(2, '0')}`;
}

export function previousMonth(month: YearMonth): YearMonth {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return index === 1
    ? `${String(year - 1)}-12`
    : `${String(year)}-${String(index - 1).padStart(2, '0')}`;
}
