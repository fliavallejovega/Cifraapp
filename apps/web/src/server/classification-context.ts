import 'server-only';

import type { Database } from '@app/database';
import { merchantAliases, merchantRules, merchants } from '@app/database/schema';
import type { PlainDate } from '@app/domain';
import type { MerchantRecord, MerchantRule } from '@app/category-engine';
import { and, eq, isNull, or } from 'drizzle-orm';

/**
 * Lo que hace falta para clasificar, cargado una sola vez y completo.
 *
 * ## Los alias estaban muertos
 *
 * `merchant_aliases` existía, se poblaba y **nunca se leía**: los dos sitios que
 * construían la lista de comercios pasaban `aliases: []`, con un comentario que
 * decía que cargarlos cambiaría un viaje a la base por un puñado de coincidencias
 * extra.
 *
 * El cálculo estaba mal por dos motivos. El primero es que no es un puñado: un
 * alias es justamente el caso que el parecido de texto **no** resuelve —
 * «PEDIDOSYA*ORDER 4471» contra «PedidosYa», «RIBA SMITH SA» contra «Riba
 * Smith», el nombre legal de un comercio contra el nombre del local. El segundo
 * es que el viaje a la base es uno, para toda la corrida.
 *
 * El resultado era un motor que sabía usar alias, una tabla que los guardaba, y
 * una ruta que garantizaba que no se tocaran nunca.
 *
 * ## Por qué un módulo y no una función suelta
 *
 * Porque ahora se carga desde tres sitios —el barrido de categorización, el
 * enlace de comercios y la importación, que clasifica antes de confirmar— y tres
 * copias de la misma consulta es como se vuelve a colar un `aliases: []`.
 */

export interface ClassificationInputs {
  readonly rules: readonly MerchantRule[];
  readonly merchants: readonly MerchantRecord[];
}

/**
 * Los comercios del hogar, con sus alias.
 *
 * Los alias de la plataforma —los que no cuelgan de ningún hogar— entran junto
 * con los propios: que Banco General escriba «PEDIDOSYA*» en todos los estados
 * de cuenta del país no es un dato privado de esta casa.
 */
export async function loadMerchantRecords(
  db: Database,
  householdId: string,
): Promise<readonly MerchantRecord[]> {
  const [rows, aliasRows] = await Promise.all([
    db
      .select({
        id: merchants.id,
        name: merchants.name,
        normalizedName: merchants.normalizedName,
        defaultCategoryId: merchants.defaultCategoryId,
      })
      .from(merchants)
      .where(eq(merchants.householdId, householdId)),
    db
      .select({ merchantId: merchantAliases.merchantId, pattern: merchantAliases.pattern })
      .from(merchantAliases)
      .innerJoin(merchants, eq(merchants.id, merchantAliases.merchantId))
      .where(or(eq(merchants.householdId, householdId), isNull(merchants.householdId))),
  ]);

  const byMerchant = new Map<string, string[]>();
  for (const alias of aliasRows) {
    const list = byMerchant.get(alias.merchantId) ?? [];
    list.push(alias.pattern);
    byMerchant.set(alias.merchantId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    aliases: byMerchant.get(row.id) ?? [],
    defaultCategoryId: row.defaultCategoryId,
  }));
}

/**
 * Las reglas vigentes del hogar, y los comercios con sus alias.
 *
 * No recibe una fecha a propósito: la ventana de vigencia de cada regla la
 * evalúa el motor contra la fecha **del movimiento**, no contra hoy.
 * Reclasificar marzo con la regla de junio reescribiría el pasado.
 */
export async function loadClassificationInputs(
  db: Database,
  householdId: string,
): Promise<ClassificationInputs> {
  const [ruleRows, merchantRecords] = await Promise.all([
    db
      .select()
      .from(merchantRules)
      .where(and(eq(merchantRules.householdId, householdId), eq(merchantRules.isActive, true)))
      .orderBy(merchantRules.priority),
    loadMerchantRecords(db, householdId),
  ]);

  const rules: MerchantRule[] = ruleRows.map((row) => ({
    id: row.id,
    matchKind: row.matchKind,
    pattern: row.pattern,
    categoryId: row.categoryId,
    merchantId: row.merchantId,
    taxClassification: row.taxClassification,
    businessPercentage: row.businessPercentage,
    source: row.source === 'ai' ? 'ai' : row.source === 'system' ? 'system' : 'user',
    confidence: Number(row.confidence),
    priority: row.priority,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom as PlainDate | null,
    effectiveTo: row.effectiveTo as PlainDate | null,
  }));

  return { rules, merchants: merchantRecords };
}
