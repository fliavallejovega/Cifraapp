'use server';

import { accounts, householdSettings } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { firstIssueKey } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * El piso, el objetivo del colchón y la cuenta de retención.
 *
 * Cuatro ajustes que sólo se pueden declarar, nunca deducir:
 *
 * **El piso declarado.** Mientras no haya seis meses de cobros, el percentil no
 * tiene de dónde salir. «En mi peor mes cobro como $1,500» es una respuesta
 * verdadera y utilizable, y el sistema la corrige contra la realidad en cuanto
 * la haya — marcándola como declarada y no medida, para que nadie confunda una
 * impresión con una medición.
 *
 * **El percentil.** Se puede tocar porque la tolerancia al riesgo es de la casa
 * y no del producto. Se limita a (0, 0.5]: por encima de la mediana el «piso»
 * sería un mes mejor que la mitad de los meses vividos, que es exactamente el
 * error que esta fase existe para evitar.
 *
 * **Los meses de colchón.** Nulo significa «que lo decida mi volatilidad», que
 * es el caso normal. Fijarlo a mano es una decisión legítima y se respeta.
 *
 * **La cuenta de retención.** Sin ella el colchón es un número en una pantalla.
 */

const settingsInput = z.object({
  incomeFloor: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z
      .string()
      .regex(/^\d+(\.\d{1,4})?$/)
      .optional(),
  ),
  percentile: z.coerce.number().gt(0).lte(0.5),
  cushionMonths: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.coerce.number().int().min(1).max(24).optional(),
  ),
  retentionAccountId: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.uuid().optional(),
  ),
});

const FIELD_ERRORS = {
  incomeFloor: 'amountInvalid',
  percentile: 'percentileInvalid',
  cushionMonths: 'monthsInvalid',
  retentionAccountId: 'notFound',
} as const;

export async function saveFloorSettings(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = settingsInput.safeParse({
    incomeFloor: formData.get('incomeFloor'),
    percentile: formData.get('percentile') ?? '0.25',
    cushionMonths: formData.get('cushionMonths'),
    retentionAccountId: formData.get('retentionAccountId'),
  });

  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    // La cuenta tiene que ser de este hogar y estar viva. Sin esta comprobación,
    // un identificador copiado de otra sesión apuntaría el colchón de una casa a
    // una cuenta que no puede leer, y el saldo saldría en cero sin explicación.
    if (parsed.data.retentionAccountId) {
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.id, parsed.data.retentionAccountId),
            eq(accounts.householdId, householdId),
            isNull(accounts.deletedAt),
          ),
        )
        .limit(1);

      if (!account) return 'notFound' as const;
    }

    await tx
      .insert(householdSettings)
      .values({
        householdId,
        incomeFloor: parsed.data.incomeFloor ?? null,
        incomeFloorPercentile: String(parsed.data.percentile),
        cushionMonths: parsed.data.cushionMonths ?? null,
        retentionAccountId: parsed.data.retentionAccountId ?? null,
      })
      .onConflictDoUpdate({
        target: householdSettings.householdId,
        set: {
          incomeFloor: parsed.data.incomeFloor ?? null,
          incomeFloorPercentile: String(parsed.data.percentile),
          cushionMonths: parsed.data.cushionMonths ?? null,
          retentionAccountId: parsed.data.retentionAccountId ?? null,
          updatedAt: new Date(),
        },
      });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  return { ok: true };
}
