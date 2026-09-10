'use server';

import { getPlatformDb } from '@app/database';
import { accounts, cardBenefits, cardBenefitCatalogue, debts } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import {
  firstIssueKey,
  optionalAmount,
  optionalUuid,
  percentageRate,
  positiveAmount,
  recordName,
} from './record-input';
import { getServerEnv } from '@app/validation/env';

import { revalidateFinancials, revalidateScreen } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Las tarjetas, administradas desde su propia pantalla.
 *
 * ## Una tarjeta son dos filas, y aquí se escriben las dos
 *
 * Una **deuda** —lo que se debe, la tasa, el mínimo, lo que el motor de pago
 * ataca— y una **cuenta** —el cupo, la red, los movimientos, contra qué se
 * importa el estado de cuenta—. El producto las guarda separadas a propósito y
 * hasta ahora eso obligaba a la persona a saberlo: registrabas la deuda en una
 * pantalla y la cuenta aparecía en otra.
 *
 * Nadie piensa en su tarjeta como dos cosas. Estas acciones escriben las dos a
 * la vez, en una transacción, desde el sitio donde uno la está mirando.
 *
 * ## El saldo se escribe una vez y no se sincroniza
 *
 * La cuenta guarda lo que dice el banco; la deuda, lo que la casa gestiona.
 * Suelen coincidir, y **el día que no, esa diferencia es el hallazgo** que la
 * pantalla existe para enseñar. Al crear se escriben iguales porque no hay nada
 * que destruir; al editar, el saldo va a la deuda y la cuenta conserva el suyo.
 */

const NETWORKS = ['visa', 'mastercard', 'amex', 'discover', 'other'] as const;

/**
 * El nivel decide la mitad de lo que da una tarjeta.
 *
 * Sin él, el catálogo tendría que enseñar el seguro de una Infinite al lado de
 * una Classic, que es la forma más rápida de que alguien crea que tiene una
 * cobertura que no tiene.
 */
const TIERS = ['classic', 'gold', 'platinum', 'signature', 'infinite', 'black', 'other'] as const;

const optionalDay = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  z.coerce.number().int().min(1).max(31).optional(),
);

const cardInput = z.object({
  name: recordName,
  currentBalance: positiveAmount,
  apr: percentageRate,
  minimumPayment: positiveAmount,
  creditLimit: optionalAmount,
  annualFee: optionalAmount,
  network: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.enum(NETWORKS).optional(),
  ),
  tier: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.enum(TIERS).optional(),
  ),
  institutionId: optionalUuid,
  maskedNumber: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z
      .string()
      .trim()
      .regex(/^\d{4}$/)
      .optional(),
  ),
  statementDay: optionalDay,
  dueDay: optionalDay,
  personId: optionalUuid,
});

const FIELD_ERRORS = {
  name: 'nameRequired',
  currentBalance: 'balanceInvalid',
  apr: 'aprInvalid',
  minimumPayment: 'minimumInvalid',
  creditLimit: 'limitInvalid',
  annualFee: 'amountInvalid',
  maskedNumber: 'maskInvalid',
  statementDay: 'dayInvalid',
  dueDay: 'dayInvalid',
  network: 'kindInvalid',
  tier: 'kindInvalid',
  institutionId: 'notFound',
} as const;

function parse(formData: FormData) {
  return cardInput.safeParse({
    name: formData.get('name'),
    currentBalance: formData.get('currentBalance'),
    apr: formData.get('apr'),
    minimumPayment: formData.get('minimumPayment'),
    creditLimit: formData.get('creditLimit'),
    annualFee: formData.get('annualFee'),
    network: formData.get('network'),
    tier: formData.get('tier'),
    institutionId: formData.get('institutionId'),
    maskedNumber: formData.get('maskedNumber'),
    statementDay: formData.get('statementDay'),
    dueDay: formData.get('dueDay'),
    personId: formData.get('personId'),
  });
}

export async function createCard(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;
  const currency = currencyOf(session, householdId);
  const data = parsed.data;

  const created = await queryAsUser(session, async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({
        householdId,
        name: data.name,
        accountType: 'credit_card',
        // Lo que se debe, en negativo: sumar todas las cuentas tiene que dar
        // patrimonio neto y no una cifra que necesite nota al pie.
        currentBalance: `-${data.currentBalance}`,
        creditLimit: data.creditLimit ?? null,
        annualFee: data.annualFee ?? null,
        cardNetwork: data.network ?? null,
        cardTier: data.tier ?? null,
        institutionId: data.institutionId ?? null,
        maskedNumber: data.maskedNumber ?? null,
        interestRate: data.apr,
        currency,
        personId: data.personId ?? null,
        scope: data.personId ? 'personal' : 'household',
        status: 'active',
        source: 'user',
        createdBy: session.user.id,
        ownerId: session.user.id,
      })
      .returning({ id: accounts.id });

    if (!account) return null;

    const [debt] = await tx
      .insert(debts)
      .values({
        householdId,
        accountId: account.id,
        name: data.name,
        // Nada aquí sabe cuánto se pidió prestado originalmente, e inventarlo
        // pondría una cifra que nadie declaró en una columna financiera.
        principal: data.currentBalance,
        currentBalance: data.currentBalance,
        currency,
        apr: data.apr,
        minimumPayment: data.minimumPayment,
        creditLimit: data.creditLimit ?? null,
        dueDay: data.dueDay ?? null,
        statementDay: data.statementDay ?? null,
        kind: 'credit_card',
        repayment: 'revolving',
        personId: data.personId ?? null,
      })
      .returning({ id: debts.id });

    return debt ? account.id : null;
  });

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  revalidateScreen(formData, 'cards', 'accounts', 'debts');
  return { created };
}

export async function updateCard(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const accountId = z.uuid().safeParse(formData.get('id'));
  if (!accountId.success) return { error: 'notFound' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;
  const data = parsed.data;

  const outcome = await queryAsUser(session, async (tx) => {
    const [account] = await tx
      .update(accounts)
      .set({
        name: data.name,
        creditLimit: data.creditLimit ?? null,
        annualFee: data.annualFee ?? null,
        cardNetwork: data.network ?? null,
        cardTier: data.tier ?? null,
        institutionId: data.institutionId ?? null,
        maskedNumber: data.maskedNumber ?? null,
        interestRate: data.apr,
        personId: data.personId ?? null,
        scope: data.personId ? 'personal' : 'household',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accounts.id, accountId.data),
          eq(accounts.householdId, householdId),
          eq(accounts.accountType, 'credit_card'),
          isNull(accounts.deletedAt),
        ),
      )
      .returning({ id: accounts.id });

    if (!account) return 'notFound' as const;

    // El saldo va a la deuda y no a la cuenta: la cuenta guarda lo que dice el
    // banco, y pisarlo desde un formulario borraría la diferencia que la
    // pantalla existe para enseñar.
    await tx
      .update(debts)
      .set({
        name: data.name,
        currentBalance: data.currentBalance,
        apr: data.apr,
        minimumPayment: data.minimumPayment,
        creditLimit: data.creditLimit ?? null,
        dueDay: data.dueDay ?? null,
        statementDay: data.statementDay ?? null,
        personId: data.personId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(debts.accountId, account.id),
          eq(debts.householdId, householdId),
          isNull(debts.deletedAt),
        ),
      );

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  revalidateScreen(formData, 'cards', 'accounts', 'debts');
  return { ok: true };
}

/**
 * Quitar una tarjeta.
 *
 * Archiva la cuenta y borra en suave la deuda. **No borra los movimientos**: lo
 * que se gastó con esa tarjeta pasó, y una tarjeta cancelada que se lleva sus
 * movimientos deja al mes pasado sin explicación y a los totales del año sin
 * cuadrar. Archivada, sigue leyéndose en el historial y deja de sumar.
 */
export async function archiveCard(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const accountId = z.uuid().safeParse(formData.get('id'));
  if (!accountId.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [account] = await tx
      .update(accounts)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(
          eq(accounts.id, accountId.data),
          eq(accounts.householdId, householdId),
          eq(accounts.accountType, 'credit_card'),
          isNull(accounts.deletedAt),
        ),
      )
      .returning({ id: accounts.id });

    if (!account) return 'notFound' as const;

    await tx
      .update(debts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(debts.accountId, account.id),
          eq(debts.householdId, householdId),
          isNull(debts.deletedAt),
        ),
      );

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  revalidateScreen(formData, 'cards', 'accounts', 'debts');
  return { ok: true };
}

const BENEFIT_KINDS = [
  'cashback',
  'miles',
  'points',
  'insurance',
  'lounge',
  'discount',
  'waiver',
  'other',
] as const;

const benefitInput = z.object({
  accountId: z.uuid(),
  kind: z.enum(BENEFIT_KINDS).default('other'),
  label: recordName,
  value: z.preprocess(
    (raw) => (raw === '' || raw === null || raw === undefined ? undefined : raw),
    z.string().trim().max(200).optional(),
  ),
  source: z.preprocess(
    (raw) => (raw === '' || raw === null || raw === undefined ? undefined : raw),
    z.string().trim().max(200).optional(),
  ),
  expiresOn: z.preprocess(
    (raw) => (raw === '' || raw === null || raw === undefined ? undefined : raw),
    z.iso.date().optional(),
  ),
});

/**
 * Registrar un beneficio, tal como su titular lo leyó en su contrato.
 *
 * El producto no trae un catálogo de las tarjetas de Panamá y no lo inventa.
 * Los beneficios cambian por nivel, por promoción y por mes; una tabla vieja
 * dentro de una aplicación financiera le dice a alguien que tiene un seguro que
 * no tiene, y esa es una afirmación que puede costar dinero de verdad.
 */
export async function addCardBenefit(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = benefitInput.safeParse({
    accountId: formData.get('accountId'),
    kind: formData.get('kind') ?? 'other',
    label: formData.get('label'),
    value: formData.get('value'),
    source: formData.get('source'),
    expiresOn: formData.get('expiresOn'),
  });

  if (!parsed.success) return { error: firstIssueKey(parsed.error, { label: 'nameRequired' }) };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    // La tarjeta tiene que ser de este hogar. Sin esto, un identificador
    // copiado de otra sesión colgaría un beneficio de una cuenta ajena.
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, parsed.data.accountId),
          eq(accounts.householdId, householdId),
          eq(accounts.accountType, 'credit_card'),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1);

    if (!account) return 'notFound' as const;

    await tx.insert(cardBenefits).values({
      householdId,
      accountId: account.id,
      kind: parsed.data.kind,
      label: parsed.data.label,
      value: parsed.data.value ?? null,
      source: parsed.data.source ?? null,
      expiresOn: parsed.data.expiresOn ?? null,
    });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateScreen(formData, 'cards');
  return { ok: true };
}

export async function removeCardBenefit(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const [removed] = await queryAsUser(session, (tx) =>
    tx
      .delete(cardBenefits)
      .where(
        and(
          eq(cardBenefits.id, id.data),
          eq(cardBenefits.householdId, session.activeHouseholdId ?? ''),
        ),
      )
      .returning({ id: cardBenefits.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateScreen(formData, 'cards');
  return { ok: true };
}

/**
 * Adoptar un beneficio del catálogo como propio.
 *
 * El catálogo dice lo que un emisor publicó; esto dice lo que **esta** casa
 * tiene. La diferencia no es formal: una es información de referencia que
 * envejece sola, y la otra es una afirmación de alguien sobre su propio
 * contrato. Por eso se copia en vez de enlazarse — el día que el banco cambie
 * su página, lo que la casa confirmó sigue siendo lo que confirmó.
 *
 * La fuente viaja con la copia, y con ella la fecha en que se leyó. Sin eso,
 * dentro de un año la línea sería indistinguible de una que alguien tecleó de
 * memoria.
 *
 * Nada se adopta solo. El botón lo pulsa una persona que, idealmente, acaba de
 * mirar su contrato — y la pantalla se lo pide con esas palabras.
 */
export async function adoptCatalogueBenefit(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const accountId = z.uuid().safeParse(formData.get('accountId'));
  const entryId = z.uuid().safeParse(formData.get('entryId'));
  if (!accountId.success || !entryId.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  // El catálogo vive en `platform` y no pertenece a ningún hogar, así que se
  // lee con la conexión de plataforma y fuera de la transacción del hogar.
  const [entry] = await getPlatformDb(getServerEnv().DATABASE_URL)
    .select({
      kind: cardBenefitCatalogue.kind,
      label: cardBenefitCatalogue.label,
      value: cardBenefitCatalogue.value,
      sourceName: cardBenefitCatalogue.sourceName,
      sourceUrl: cardBenefitCatalogue.sourceUrl,
      capturedOn: cardBenefitCatalogue.capturedOn,
      validUntil: cardBenefitCatalogue.validUntil,
    })
    .from(cardBenefitCatalogue)
    .where(eq(cardBenefitCatalogue.id, entryId.data))
    .limit(1);

  if (!entry) return { error: 'notFound' };

  const outcome = await queryAsUser(session, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId.data),
          eq(accounts.householdId, householdId),
          eq(accounts.accountType, 'credit_card'),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1);

    if (!account) return 'notFound' as const;

    await tx.insert(cardBenefits).values({
      householdId,
      accountId: account.id,
      kind: entry.kind,
      label: entry.label,
      value: entry.value,
      // La fuente y la fecha de lectura, pegadas: sin ellas, dentro de un año
      // esta línea sería indistinguible de una tecleada de memoria.
      source: `${entry.sourceName} · leído el ${entry.capturedOn}`,
      expiresOn: entry.validUntil,
    });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateScreen(formData, 'cards');
  return { ok: true };
}
