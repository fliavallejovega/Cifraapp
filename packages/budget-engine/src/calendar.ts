import type { Money, PlainDate } from '@app/domain';

/**
 * Los compromisos de la casa, como calendario suscribible.
 *
 * Un recordatorio dentro de la aplicación sólo sirve si la persona abre la
 * aplicación, y quien vive de vender abre el calendario todo el día. Publicar
 * los compromisos como un `.ics` los pone donde ya se mira: Apple Calendar los
 * suscribe por URL, Google Calendar también («Otros calendarios → Desde URL»),
 * y Outlook igual. Un formato, tres destinos, ninguna cuenta que conectar.
 *
 * ## Por qué de día completo y no a una hora
 *
 * Porque un compromiso vence un día, no a las 9:00. Ponerle hora obligaría a
 * inventar una, y una hora inventada en el calendario de alguien es una cita
 * falsa: se solapa con reuniones reales y enseña a ignorar el calendario. Con
 * `VALUE=DATE` el evento aparece arriba, donde van los cumpleaños y los
 * feriados, que es exactamente la categoría a la que pertenece.
 *
 * ## Por qué la alarma va el día antes
 *
 * Un aviso el mismo día es una acusación: ya no queda tiempo de mover dinero
 * entre cuentas ni de llamar al cliente que debe la factura. El día antes
 * todavía es una decisión.
 *
 * ## Lo que este módulo no hace
 *
 * No sabe de HTTP, de sesiones ni de bases de datos. Recibe filas y devuelve
 * texto, que es lo que lo hace comprobable sin levantar nada — la ruta que lo
 * sirve es diez líneas y no tiene lógica que probar.
 *
 * Referencia: RFC 5545. Las tres reglas que rompen los generadores caseros son
 * el fin de línea CRLF, el plegado a 75 octetos y el escapado de `\`, `;`, `,`
 * y el salto de línea. Las tres están implementadas abajo y probadas.
 */

const PRODUCT_ID = '-//Cifraapp//Compromisos//ES';

/** El máximo que RFC 5545 permite por línea, en octetos, contando el plegado. */
const MAX_OCTETS = 75;

export type CommitmentCoverageHint = 'covered' | 'conditional' | 'uncovered';

export interface CalendarCommitment {
  readonly id: string;
  readonly label: string;
  readonly due: PlainDate;
  readonly amount: Money;
  readonly isEssential: boolean;
  /** Cómo va de cubierto, si la pasada de cobertura corrió. Va en el título. */
  readonly coverage?: CommitmentCoverageHint;
  /** Una línea más de contexto: de qué cuenta sale, a quién se le paga. */
  readonly note?: string;
  /** Sube uno cada vez que el compromiso cambia, para que el cliente refresque. */
  readonly revision?: number;
}

export interface CalendarOptions {
  /** Cómo se llama el calendario en la barra lateral de quien lo suscribe. */
  readonly name: string;
  readonly description?: string;
  /** Cuándo se generó. Explícito para que el mismo insumo dé el mismo texto. */
  readonly now: Date;
  /** Cuántos días antes avisar. Cero apaga la alarma. */
  readonly alarmDaysBefore?: number;
  /** Cada cuánto pedirle al cliente que vuelva a leer. Minutos. */
  readonly refreshMinutes?: number;
  /** Cómo se escribe un monto. Lo decide quien llama: aquí no hay locale. */
  readonly formatAmount: (amount: Money) => string;
  /** El dominio que hace únicos los UID. Un UID que colisiona pisa un evento. */
  readonly uidDomain?: string;
}

export const DEFAULT_ALARM_DAYS_BEFORE = 1;
export const DEFAULT_REFRESH_MINUTES = 240;

export function buildCommitmentCalendar(
  commitments: readonly CalendarCommitment[],
  options: CalendarOptions,
): string {
  const alarmDays = options.alarmDaysBefore ?? DEFAULT_ALARM_DAYS_BEFORE;
  const refresh = options.refreshMinutes ?? DEFAULT_REFRESH_MINUTES;
  const domain = options.uidDomain ?? 'cifraapp';
  const stamp = toUtcStamp(options.now);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    // `PUBLISH` y no `REQUEST`: esto se lee, no se responde. Un calendario que
    // pide confirmación le manda invitaciones a alguien por sus propios gastos.
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.name)}`,
    // La duplicada de Apple y la estándar. Los clientes leen una u otra.
    `REFRESH-INTERVAL;VALUE=DURATION:PT${String(refresh)}M`,
    `X-PUBLISHED-TTL:PT${String(refresh)}M`,
  ];

  if (options.description) {
    lines.push(`X-WR-CALDESC:${escapeText(options.description)}`);
  }

  for (const commitment of commitments) {
    lines.push('BEGIN:VEVENT');
    // Estable entre lecturas: el cliente tiene que reconocer el mismo evento
    // mañana. Un UID nuevo cada vez llena el calendario de duplicados.
    lines.push(`UID:${commitment.id}@${domain}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`SEQUENCE:${String(commitment.revision ?? 0)}`);
    lines.push(`DTSTART;VALUE=DATE:${compactDate(commitment.due)}`);
    // `DTEND` exclusivo, que es lo que dice la norma para fechas: sin esto,
    // media docena de clientes pintan el evento sobre dos días.
    lines.push(`DTEND;VALUE=DATE:${compactDate(nextDay(commitment.due))}`);
    lines.push(`SUMMARY:${escapeText(summaryOf(commitment, options.formatAmount))}`);

    const description = descriptionOf(commitment, options.formatAmount);
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);

    // Ocupado no: nadie está ocupado porque venza el alquiler, y marcarlo así
    // hace que quien mire su disponibilidad la vea llena de facturas.
    lines.push('TRANSP:TRANSPARENT');
    lines.push(`CATEGORIES:${commitment.isEssential ? 'ESENCIAL' : 'COMPROMISO'}`);

    if (alarmDays > 0) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`TRIGGER:-P${String(alarmDays)}D`);
      lines.push(`DESCRIPTION:${escapeText(summaryOf(commitment, options.formatAmount))}`);
      lines.push('END:VALARM');
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/**
 * El título, que es lo único que se lee de un vistazo en la vista de mes.
 *
 * El monto va delante del nombre a propósito: en una celda estrecha se corta el
 * final, y perder «Alquiler» dejando «$700» sigue siendo útil, mientras que
 * perder «$700» dejando «Alqui…» no dice nada.
 */
function summaryOf(
  commitment: CalendarCommitment,
  formatAmount: (amount: Money) => string,
): string {
  const mark =
    commitment.coverage === 'uncovered'
      ? '⚠ '
      : commitment.coverage === 'conditional'
        ? '~ '
        : '';
  return `${mark}${formatAmount(commitment.amount)} · ${commitment.label}`;
}

function descriptionOf(
  commitment: CalendarCommitment,
  formatAmount: (amount: Money) => string,
): string {
  const parts: string[] = [`${commitment.label}: ${formatAmount(commitment.amount)}`];

  if (commitment.coverage === 'covered') {
    parts.push('Cubierto con lo que hay en cuenta.');
  } else if (commitment.coverage === 'conditional') {
    parts.push('Cubierto sólo si entra un cobro que todavía no llegó.');
  } else if (commitment.coverage === 'uncovered') {
    parts.push('Descubierto: no alcanza ni contando lo que se espera.');
  }

  if (commitment.note) parts.push(commitment.note);

  return parts.join('\n');
}

/**
 * Escapa lo que la norma reserva.
 *
 * La contrabarra primero: hacerlo después escaparía las que este mismo paso
 * acaba de introducir, y «Luz; agua» saldría con una barra de más.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Pliega a 75 octetos, contando en UTF-8 y no en caracteres.
 *
 * Un nombre con acentos ocupa más octetos que letras, y cortar por longitud de
 * cadena produce líneas que superan el límite —o, peor, parte un carácter
 * multibyte por la mitad y el archivo deja de ser UTF-8 válido—. Se mide el
 * ancho real de cada carácter y no se corta nunca dentro de uno.
 */
export function foldLine(line: string): string {
  if (octets(line) <= MAX_OCTETS) return line;

  const pieces: string[] = [];
  let current = '';
  let width = 0;
  // La continuación empieza con un espacio, que también cuenta para el límite.
  let limit = MAX_OCTETS;

  for (const character of line) {
    const size = octets(character);
    if (width + size > limit) {
      pieces.push(current);
      current = '';
      width = 0;
      limit = MAX_OCTETS - 1;
    }
    current += character;
    width += size;
  }
  if (current !== '') pieces.push(current);

  return pieces.map((piece, at) => (at === 0 ? piece : ` ${piece}`)).join('\r\n');
}

function octets(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** `2026-09-30` → `20260930`. */
function compactDate(date: PlainDate): string {
  return date.replace(/-/g, '');
}

/**
 * El día siguiente, sin pasar por `Date`.
 *
 * `addDays` del dominio haría lo mismo, pero este módulo no toma más dependencia
 * que los tipos: es un formateador de texto y conviene que se pueda leer entero
 * sin salir del archivo.
 */
function nextDay(date: PlainDate): PlainDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));

  const inMonth = daysInMonth(year, month);
  if (day < inMonth) return stamp(year, month, day + 1);
  if (month < 12) return stamp(year, month + 1, 1);
  return stamp(year + 1, 1, 1);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function stamp(year: number, month: number, day: number): PlainDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as PlainDate;
}

/** `DTSTAMP` va siempre en UTC y con la `Z`. Es la única marca de tiempo aquí. */
function toUtcStamp(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}
