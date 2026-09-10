import 'server-only';

import { getPlatformDb } from '@app/database';
import { accounts, cardPromotions } from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import { getServerEnv } from '@app/validation/env';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

import { loadProgramNames } from './card-programs';
import { matches } from './offer-match';

/**
 * Las ofertas del mes, y cuáles puede usar esta casa.
 *
 * ## Por qué se leen todas y no sólo las suyas
 *
 * Porque la pregunta del martes a las siete es «¿con cuál pago aquí?», y la
 * respuesta a veces es «con ninguna de las tuyas, y por eso conviene saber que
 * el banco de al lado da 50% donde el tuyo no da nada». Esconder las ajenas
 * ahorraría ruido y borraría exactamente la información que hace falta para
 * decidir abrir una cuenta.
 *
 * El filtro «sólo las mías» existe para el momento de decidir. El resto no
 * desaparece: se ordena detrás.
 *
 * ## Cómo se decide que una oferta es «tuya»
 *
 * Por emisor y por red. Una promoción de Banco General para Visa y Mastercard
 * es tuya si tenés una tarjeta de Banco General de cualquiera de las dos redes.
 * Una que no nombra red aplica a todas las de ese banco, que es lo que dice una
 * promoción que no distingue.
 *
 * El tipo cuenta: la mitad de las promociones de Panamá son de débito, y una
 * casa con tarjeta de crédito de BAC no puede usar la de débito de BAC. Las
 * cuentas de banco cuentan como débito, que es lo que son cuando se pagan.
 *
 * Y el programa cuenta cuando la promoción lo nombra. «Doble millas
 * ConnectMiles este mes» no le sirve a la Visa Estrellas del mismo banco, con
 * la misma red y el mismo nivel. Una tarjeta que todavía no declaró su programa
 * no se descarta —eso escondería promociones que quizá sí puede usar— pero
 * tampoco se afirma que la promoción es suya: queda como incierta, y la
 * pantalla lo dice en vez de decidir por la casa.
 */

export interface OfferView {
  readonly id: string;
  readonly issuerKey: string;
  readonly issuerName: string;
  readonly merchantName: string;
  readonly merchantNote: string | null;
  readonly category: string | null;
  readonly headline: string;
  readonly detail: string | null;
  readonly maxDiscount: Money | null;
  readonly maxSpend: Money | null;
  /** ISO: 1 es lunes. Vacío es todos los días. */
  readonly weekdays: readonly number[];
  readonly validFrom: PlainDate | null;
  readonly validUntil: PlainDate | null;
  readonly channel: string | null;
  readonly networks: readonly string[];
  readonly cardTypes: readonly string[];
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly capturedOn: PlainDate;
  /** `verified` la comprobó una persona; `unverified` la leyó el barrido. */
  readonly status: string;
  /** Verdadero cuando alguna tarjeta o cuenta del hogar la puede usar. */
  readonly isMine: boolean;
  /** Cuáles, por nombre. Es la respuesta a «¿con cuál pago?». */
  readonly usableWith: readonly string[];
  /**
   * Las mismas, por identificador de cuenta.
   *
   * El nombre sirve para leerlo; el identificador para que la pantalla de una
   * tarjeta sepa cuáles de estas ofertas son suyas sin comparar cadenas — dos
   * tarjetas de la misma casa se pueden llamar igual.
   */
  readonly usableWithIds: readonly string[];
  /** Verdadero si hoy es uno de sus días. Contesta «¿me sirve ahora?». */
  readonly isToday: boolean;
  /**
   * Las tarjetas que encajan en todo menos el programa, porque no lo declararon.
   *
   * Ni suyas ni ajenas: no se sabe. Descartarlas escondería una promoción que
   * quizá aplica; contarlas como suyas afirmaría algo que nadie dijo.
   */
  readonly maybeWith: readonly string[];
  readonly maybeWithIds: readonly string[];
  /** Los programas que exige, por nombre. Vacío es «no exige ninguno». */
  readonly programNames: readonly string[];
}

export interface OffersView {
  readonly offers: readonly OfferView[];
  readonly mineCount: number;
  readonly todayCount: number;
  /** Los emisores presentes, para poder filtrar por banco. */
  readonly issuers: readonly { readonly key: string; readonly name: string }[];
  readonly categories: readonly string[];
  /** Cuándo corrió el último barrido. Sin esto, «del mes» no dice nada. */
  readonly lastRefresh: Date | null;
  readonly isEmpty: boolean;
}

export async function loadOffers(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
  today: PlainDate,
): Promise<OffersView> {
  /**
   * Lo que la casa tiene con qué pagar.
   *
   * Tarjetas de crédito con su red, y las cuentas de las que sale un débito.
   * Una cuenta de ahorros sin tarjeta no paga en un restaurante, pero el
   * producto no sabe cuáles tienen plástico — así que cuentan todas las
   * líquidas y la pantalla dice «con tu débito de X» en vez de afirmar que
   * existe una tarjeta concreta.
   */
  const mine = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.accountType,
        network: accounts.cardNetwork,
        program: accounts.cardProgram,
        issuerKey: sql<string | null>`(
          select i.parser_key from app.institutions i where i.id = ${accounts.institutionId}
        )`,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.status, 'active'),
          isNull(accounts.deletedAt),
          or(
            eq(accounts.accountType, 'credit_card'),
            eq(accounts.accountType, 'checking'),
            eq(accounts.accountType, 'savings'),
          ),
        ),
      ),
  );

  const db = getPlatformDb(getServerEnv().DATABASE_URL);
  const programNames = await loadProgramNames();

  const rows = await db
    .select()
    .from(cardPromotions)
    .where(sql`${cardPromotions.status} in ('verified', 'unverified')`)
    .orderBy(asc(cardPromotions.merchantName));

  const weekdayToday = isoWeekday(today);

  const offers: OfferView[] = rows.map((row) => {
    /**
     * Con cuáles se puede pagar esta oferta.
     *
     * Emisor primero: sin coincidencia de banco no hay nada que mirar. Después
     * la red, y sólo si la promoción la nombra — una que no la nombra aplica a
     * todas las de ese banco.
     */
    const verdicts = mine.map((card) => [card, matches(card, row)] as const);
    const usable = verdicts.filter(([, verdict]) => verdict === 'yes').map(([card]) => card);
    const maybe = verdicts.filter(([, verdict]) => verdict === 'maybe').map(([card]) => card);

    const usableWith = usable.map((card) => card.name);

    return {
      id: row.id,
      issuerKey: row.issuerKey,
      issuerName: row.issuerName,
      merchantName: row.merchantName,
      merchantNote: row.merchantNote,
      category: row.category,
      headline: row.headline,
      detail: row.detail,
      maxDiscount: row.maxDiscount ? Money.fromDecimalString(row.maxDiscount, currency) : null,
      maxSpend: row.maxSpend ? Money.fromDecimalString(row.maxSpend, currency) : null,
      weekdays: row.weekdays,
      validFrom: (row.validFrom as PlainDate | null) ?? null,
      validUntil: (row.validUntil as PlainDate | null) ?? null,
      channel: row.channel,
      networks: row.networks,
      cardTypes: row.cardTypes,
      sourceName: row.sourceName,
      sourceUrl: row.sourceUrl,
      capturedOn: row.capturedOn as PlainDate,
      status: row.status,
      isMine: usableWith.length > 0,
      usableWith,
      usableWithIds: usable.map((card) => card.id),
      maybeWith: maybe.map((card) => card.name),
      maybeWithIds: maybe.map((card) => card.id),
      programNames: row.programs.map((key) => programNames.get(key) ?? key),
      // Vacío es todos los días, que es lo que dice una promoción sin restricción.
      isToday: row.weekdays.length === 0 || row.weekdays.includes(weekdayToday),
    };
  });

  const [lastRun] = await db
    .select({ finishedAt: sql<Date | null>`max(finished_at)` })
    .from(sql`platform.catalogue_refresh_runs`);

  return {
    // Lo tuyo primero, y dentro de eso lo de hoy: es el orden en que se hacen
    // las preguntas, no una jerarquía de importancia.
    offers: offers.sort((a, b) => {
      if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
      if (a.isToday !== b.isToday) return a.isToday ? -1 : 1;
      return a.merchantName.localeCompare(b.merchantName);
    }),
    mineCount: offers.filter((one) => one.isMine).length,
    todayCount: offers.filter((one) => one.isMine && one.isToday).length,
    issuers: [...new Map(offers.map((one) => [one.issuerKey, one.issuerName])).entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    categories: [...new Set(offers.map((one) => one.category).filter((one): one is string => one !== null))].sort(),
    lastRefresh: lastRun?.finishedAt ?? null,
    isEmpty: offers.length === 0,
  };
}

/** El día de hoy en ISO: 1 es lunes, 7 domingo. Sin pasar por la zona del servidor. */
function isoWeekday(date: PlainDate): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
