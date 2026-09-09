import { Money, toPlainDate, type CurrencyCode, type PlainDate } from '@app/domain';

import { computeFingerprint } from '../fingerprint.js';
import { normalizeDescription } from '../normalize.js';
import type { CandidateTransaction } from '../types.js';

/**
 * El aviso de transacción que manda el banco, leído como un movimiento.
 *
 * Un estado de cuenta llega una vez al mes y describe un pasado que ya se
 * gastó. El aviso llega en el segundo en que la tarjeta se pasa —«compra de
 * B/.48.20 en SUPER 99»—, es texto plano y no trae adjunto que abrir. Para un
 * hogar que quiere saber cómo va el mes *durante* el mes, es el mejor insumo
 * que existe y el más barato de procesar.
 *
 * ## Lo que este módulo decide y lo que no
 *
 * Decide qué dice el correo: cuánto, cuándo, dónde, y en qué dirección se movió
 * el dinero. No decide nada más. El movimiento sale con `verdict` de revisión
 * como cualquier fila importada: los avisos se duplican con el estado de cuenta
 * del mes siguiente, y quien concilia eso es el motor de duplicados, no este.
 *
 * ## Por qué no hay una plantilla por banco
 *
 * Porque los bancos cambian el texto sin avisar, y un producto que exige una
 * plantilla exacta deja de leer los avisos el día que Banco General le agrega
 * una coma. Se buscan las cuatro señales —monto, dirección, comercio, fecha— en
 * cualquier orden y en cualquier redacción, y se reporta cuáles se encontraron.
 * Un aviso del que sólo se saca el monto entra igual, con la confianza baja y
 * diciendo qué le falta; es la persona quien completa, no el parser quien
 * adivina.
 *
 * ## Lo que se rechaza a propósito
 *
 * «Su estado de cuenta está listo, ingrese al portal» no tiene monto y no es un
 * movimiento. Tampoco lo es una promoción, ni un aviso de clave temporal.
 * Devolver `null` es la respuesta correcta: inventarle un movimiento de cero al
 * hogar sería peor que no leer el correo.
 */

/** Un correo ya reducido a texto, tal como lo entrega el lector de Gmail. */
export interface EmailAlert {
  /** El identificador del proveedor. Es lo que hace idempotente la lectura. */
  readonly messageId: string;
  readonly from: string;
  readonly subject: string;
  /** Cuerpo en texto plano. El HTML se aplana antes de llegar aquí. */
  readonly body: string;
  /** Cuándo llegó. Es la fecha de respaldo cuando el cuerpo no trae una. */
  readonly receivedOn: PlainDate;
}

export interface ParsedAlert {
  readonly transactionDate: PlainDate;
  readonly amount: Money;
  readonly direction: 'inflow' | 'outflow';
  readonly descriptionOriginal: string;
  readonly descriptionNormalized: string;
  /** El identificador del correo. Es lo que hace idempotente volver a leerlo. */
  readonly externalReference: string;
  /** El banco, cuando el remitente lo identifica. */
  readonly institutionKey: string | null;
  /** Los últimos cuatro dígitos de la tarjeta o cuenta, si el aviso los trae. */
  readonly accountHint: string | null;
  readonly currency: CurrencyCode;
  /** 0–1. Cuántas de las cinco señales se encontraron, y con qué firmeza. */
  readonly confidence: number;
  /** Qué se reconoció. Es lo que la pantalla enseña para justificar la fila. */
  readonly signals: readonly string[];
  /** Verdadero cuando el aviso no trajo fecha y se usó la de llegada. */
  readonly dateFromDelivery: boolean;
}

/**
 * Los remitentes que mandan avisos en Panamá.
 *
 * Se compara por dominio y no por dirección completa: un banco manda desde
 * `notificaciones@`, `alertas@` y `no-reply@` sin ninguna coherencia, y listar
 * las tres por banco garantiza que la cuarta se pierda.
 */
const SENDERS: readonly { readonly domain: string; readonly key: string }[] = [
  { domain: 'bgeneral.com', key: 'banco_general' },
  { domain: 'bancogeneral.com', key: 'banco_general' },
  { domain: 'banistmo.com', key: 'banistmo' },
  { domain: 'baccredomatic.com', key: 'bac' },
  { domain: 'credomatic.com', key: 'bac' },
  { domain: 'globalbank.com.pa', key: 'global_bank' },
  { domain: 'multibank.com.pa', key: 'multibank' },
  { domain: 'bancanacional.com.pa', key: 'banco_nacional' },
  { domain: 'banconal.com.pa', key: 'banco_nacional' },
  { domain: 'cajadeahorros.com.pa', key: 'caja_de_ahorros' },
  { domain: 'towerbank.com', key: 'tower_bank' },
  { domain: 'scotiabank.com', key: 'scotiabank' },
  { domain: 'stgeorgesbank.com', key: 'st_georges' },
];

/** Verbos que sacan dinero. Se comparan sin tildes y en minúscula. */
const OUTFLOW_MARKERS: readonly string[] = [
  'compra',
  'consumo',
  'retiro',
  'debito',
  'cargo',
  'pago realizado',
  'pago efectuado',
  'transferencia enviada',
  'transferencia realizada',
  'ach enviado',
  'envio de dinero',
  'avance de efectivo',
  'se debito',
  'ha sido debitada',
];

/** Y los que lo meten. */
const INFLOW_MARKERS: readonly string[] = [
  'deposito',
  'abono',
  'credito a su cuenta',
  'ach recibido',
  'transferencia recibida',
  'pago recibido',
  'se acredito',
  'ha sido acreditada',
  'reverso',
  'devolucion',
];

/**
 * Frases que descartan el correo antes de intentar leerlo.
 *
 * Un estado de cuenta disponible, una clave temporal o una promoción pueden
 * traer cifras —«ahorra hasta 30%», «su saldo es de B/.4,180.00»— y sacarles un
 * movimiento le metería a alguien un gasto que no existió.
 */
const NOT_A_MOVEMENT: readonly string[] = [
  'estado de cuenta',
  'clave temporal',
  'codigo de verificacion',
  'codigo de seguridad',
  'restablecer su contrasena',
  'promocion',
  'aproveche',
  'terminos y condiciones de la campana',
];

/** El banco que manda este correo, o nulo si no es ninguno conocido. */
export function institutionOf(from: string): string | null {
  const lower = from.toLowerCase();
  for (const sender of SENDERS) {
    if (lower.includes(`@${sender.domain}`) || lower.endsWith(sender.domain)) return sender.key;
  }
  return null;
}

export interface ParseAlertOptions {
  readonly currency?: CurrencyCode;
  /**
   * Aceptar correos de remitentes desconocidos.
   *
   * Apagado por defecto: leer cualquier correo que mencione una cifra convierte
   * una factura de un proveedor en un gasto del hogar. Se enciende cuando la
   * casa etiqueta a mano el remitente de su banco.
   */
  readonly allowUnknownSender?: boolean;
}

export function parseBankAlert(
  alert: EmailAlert,
  options: ParseAlertOptions = {},
): ParsedAlert | null {
  const currency = options.currency ?? 'USD';
  const institutionKey = institutionOf(alert.from);
  if (!institutionKey && !options.allowUnknownSender) return null;

  const text = flatten(`${alert.subject}\n${alert.body}`);
  const folded = fold(text);

  if (NOT_A_MOVEMENT.some((phrase) => folded.includes(phrase))) return null;

  const amount = readAmount(text, currency);
  if (!amount?.isPositive()) return null;

  const direction = readDirection(folded);
  if (!direction) return null;

  const signals: string[] = ['amount', `direction:${direction}`];

  const merchant = readMerchant(text);
  if (merchant) signals.push('merchant');

  const bodyDate = readDate(text);
  if (bodyDate) signals.push('date');

  const accountHint = readAccountHint(text);
  if (accountHint) signals.push('account');

  if (institutionKey) signals.push(`institution:${institutionKey}`);

  const transactionDate = bodyDate ?? alert.receivedOn;
  const descriptionOriginal = merchant ?? (alert.subject.trim() || 'Aviso del banco');

  return {
    transactionDate,
    amount,
    direction,
    descriptionOriginal,
    descriptionNormalized: normalizeDescription(descriptionOriginal).normalized,
    // El identificador del proveedor, que es lo único verdaderamente único que
    // trae un correo. Sirve para no leer dos veces el mismo aviso; no sirve para
    // casarlo con la línea del estado de cuenta, que trae la referencia del
    // banco y no la del correo.
    externalReference: alert.messageId,
    institutionKey,
    accountHint,
    currency,
    confidence: confidenceOf(signals),
    signals,
    dateFromDelivery: bodyDate === null,
  };
}

/**
 * El aviso, ya como la fila que el resto del canal de importación consume.
 *
 * Va aparte de `parseBankAlert` porque la huella necesita la cuenta, y la cuenta
 * no está en el correo: sale de casar los últimos cuatro dígitos contra las
 * cuentas del hogar, que es trabajo de la aplicación y no del parser. Separarlas
 * es lo que permite leer el buzón entero sin haber resuelto todavía de qué
 * tarjeta salió cada compra.
 */
export function alertToCandidate(alert: ParsedAlert, accountId: string): CandidateTransaction {
  return {
    transactionDate: alert.transactionDate,
    amount: alert.amount,
    direction: alert.direction,
    descriptionOriginal: alert.descriptionOriginal,
    descriptionNormalized: alert.descriptionNormalized,
    externalReference: alert.externalReference,
    // La misma huella que produciría el estado de cuenta del mes que viene para
    // esta misma compra: cuenta, día, monto exacto y descripción normalizada. Es
    // lo que permite que el aviso y la línea del PDF se reconozcan como uno.
    fingerprint: computeFingerprint({
      accountId,
      transactionDate: alert.transactionDate,
      amount: alert.amount,
      descriptionNormalized: alert.descriptionNormalized,
    }),
  };
}

/**
 * Cuánta confianza merece lo leído.
 *
 * Monto y dirección son obligatorios y valen la base. Comercio, fecha propia y
 * últimos cuatro dígitos suben desde ahí. Un aviso con las cinco señales es
 * prácticamente una línea de estado de cuenta; uno con dos es un punto de
 * partida que alguien tiene que mirar, y sale diciéndolo.
 */
function confidenceOf(signals: readonly string[]): number {
  let score = 0.5;
  if (signals.includes('merchant')) score += 0.2;
  if (signals.includes('date')) score += 0.15;
  if (signals.includes('account')) score += 0.1;
  if (signals.some((one) => one.startsWith('institution:'))) score += 0.05;
  return Math.min(Math.round(score * 100) / 100, 1);
}

/**
 * El monto, en unidades exactas y nunca por `parseFloat`.
 *
 * Panamá escribe `B/.1,234.56` — balboa a la par del dólar — y también `USD`,
 * `US$` y `$`. Se toma **el mayor** de los montos que aparezcan, no el primero:
 * los avisos suelen cerrar con «saldo disponible B/.312.44», y el primero en
 * aparecer a veces es una comisión de B/.0.10.
 */
export function readAmount(text: string, currency: CurrencyCode): Money | null {
  const pattern = /(?:B\/\.?|USD|US\$|\$)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;

  let best: Money | null = null;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1];
    if (!raw) continue;
    const value = Money.fromDecimalString(raw.replace(/,/g, ''), currency);
    if (!best || value.greaterThan(best)) best = value;
  }
  return best;
}

function readDirection(folded: string): 'inflow' | 'outflow' | null {
  const outflowAt = firstIndexOf(folded, OUTFLOW_MARKERS);
  const inflowAt = firstIndexOf(folded, INFLOW_MARKERS);

  if (outflowAt === null && inflowAt === null) return null;
  if (inflowAt === null) return 'outflow';
  if (outflowAt === null) return 'inflow';
  // Los dos aparecen: manda el que el banco escribió primero, que es el titular
  // del aviso. «Depósito» al final suele ser el nombre de la cuenta destino.
  return outflowAt <= inflowAt ? 'outflow' : 'inflow';
}

function firstIndexOf(folded: string, markers: readonly string[]): number | null {
  let found: number | null = null;
  for (const marker of markers) {
    const at = folded.indexOf(marker);
    if (at >= 0 && (found === null || at < found)) found = at;
  }
  return found;
}

/**
 * El comercio.
 *
 * Se prueban las etiquetas explícitas primero —«Comercio:», «Establecimiento:»—
 * porque cuando existen son exactas, y sólo después el «en X» de la redacción
 * suelta, que es más frágil y por eso va al final.
 */
export function readMerchant(text: string): string | null {
  const labelled =
    /(?:comercio|establecimiento|afiliado|beneficiario|descripci[óo]n)\s*:\s*([^\n\r]{2,80})/i.exec(
      text,
    );
  if (labelled?.[1]) return tidy(labelled[1]);

  const inline =
    /\ben\s+([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .,'&*/-]{2,60}?)(?=\s+(?:con|el|por|a\s+las|mediante|usando)\b|[.\n\r]|$)/.exec(
      text,
    );
  if (inline?.[1]) return tidy(inline[1]);

  return null;
}

/** Limpia lo que la etiqueta arrastra: espacios dobles, puntos y comas sueltas. */
function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[.,;:\s]+$/, '').trim();
}

/**
 * La fecha del cuerpo, cuando la hay.
 *
 * `dd/mm/aaaa` es lo que usa todo Panamá, y es exactamente el formato en que un
 * lector descuidado ve `03/09` y entiende marzo. Aquí el día va primero siempre:
 * no se «detecta» el orden, porque detectarlo con `05/06/2026` es imposible y
 * fallar en silencio es peor que no leer la fecha.
 */
export function readDate(text: string): PlainDate | null {
  const numeric = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(text);
  if (numeric) {
    const [, day, month, year] = numeric;
    const parsed = build(year, month, day);
    if (parsed) return parsed;
  }

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    const parsed = build(year, month, day);
    if (parsed) return parsed;
  }

  const written =
    /\b(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})\b/i.exec(text) ?? null;
  if (written) {
    const [, day, name, year] = written;
    const month = MONTHS.indexOf(fold(name ?? ''));
    if (month >= 0) return build(year, String(month + 1), day);
  }

  return null;
}

const MONTHS: readonly string[] = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function build(year?: string, month?: string, day?: string): PlainDate | null {
  if (!year || !month || !day) return null;
  const stamped = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  try {
    return toPlainDate(stamped);
  } catch {
    // Un 31 de febrero en un correo es un correo mal formado, no una excepción
    // que deba tumbar la lectura del resto del buzón.
    return null;
  }
}

/** Los últimos cuatro dígitos, que es lo que permite adivinar de qué cuenta salió. */
export function readAccountHint(text: string): string | null {
  const match =
    /(?:termina(?:da|do)?\s+en|final(?:izada)?\s+en|\*{2,}|x{3,}|n[úu]mero\s+)\s*(\d{4})\b/i.exec(
      text,
    );
  return match?.[1] ?? null;
}

/** Aplana un cuerpo HTML a texto legible, sin traerse una librería para ello. */
export function flatten(body: string): string {
  return body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Minúsculas sin tildes: «Débito» y «DEBITO» son la misma palabra. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}
