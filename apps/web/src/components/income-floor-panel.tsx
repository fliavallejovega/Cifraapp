import { formatMoney, type Money, type MoneyLocale } from '@app/domain';
import { Card, EmptyState, Gauge, Stat, Status } from '@app/ui';

import { SingleForm } from '@/components/records';
import type { FieldSpec } from '@/components/records/spec';
import { saveFloorSettings } from '@/server/floor-actions';
import type { IncomeFloorView } from '@/server/repositories/income-floor';

/**
 * El piso y el colchón, en pantalla.
 *
 * La pantalla tiene que decir tres cosas distintas según cuánta historia haya, y
 * la diferencia entre ellas es exactamente la información:
 *
 *   * **Sin nada.** No hay piso y no se finge uno de cero. Se explica qué es y
 *     se ofrece la primera acción, que es declararlo.
 *   * **Declarado.** El número es de la persona, se dice que lo es, y se dice
 *     cuántos meses faltan para poder medirlo. Un piso declarado presentado como
 *     medido es una impresión disfrazada de dato.
 *   * **Medido.** El número sale de los cobros propios, con el peor mes, el
 *     típico y el mejor al lado — porque un piso sin su contexto parece un
 *     recorte arbitrario y con él se entiende de dónde viene.
 *
 * El indicador de progreso del colchón sólo aparece cuando hay objetivo. Una
 * barra en cero sobre un objetivo que nadie fijó arranca al lector en el peor
 * lugar posible: pareciendo que va perdiendo una carrera que no empezó.
 */

export interface IncomeFloorLabels {
  readonly floorLabel: string;
  readonly floorMeasured: string;
  readonly floorDeclared: string;
  readonly floorUnknown: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly monthsObserved: string;
  readonly monthsNeeded: string;
  readonly worst: string;
  readonly typical: string;
  readonly best: string;
  readonly cushionLabel: string;
  readonly cushionTarget: string;
  readonly cushionGauge: string;
  readonly cushionFunded: string;
  readonly cushionMissing: string;
  readonly cushionShort: string;
  readonly noRetention: string;
  readonly retentionHolds: string;
  readonly release: string;
  readonly form: {
    readonly floor: string;
    readonly floorHint: string;
    readonly percentile: string;
    readonly percentileHint: string;
    readonly months: string;
    readonly monthsHint: string;
    readonly account: string;
    readonly accountHint: string;
    readonly accountNone: string;
    readonly submit: string;
    readonly saved: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}

export interface IncomeFloorPanelProps {
  readonly view: IncomeFloorView;
  readonly locale: string;
  readonly moneyLocale: MoneyLocale;
  readonly currencySymbol: string;
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly labels: IncomeFloorLabels;
}

export function IncomeFloorPanel({
  view,
  locale,
  moneyLocale,
  currencySymbol,
  accounts,
  labels,
}: IncomeFloorPanelProps) {
  const money = (value: Money) => formatMoney(value, { locale: moneyLocale });
  const { floor, cushion } = view;

  const fields: readonly FieldSpec[] = [
    {
      kind: 'money',
      name: 'incomeFloor',
      label: labels.form.floor,
      hint: labels.form.floorHint,
      half: true,
    },
    {
      kind: 'rate',
      name: 'percentile',
      label: labels.form.percentile,
      hint: labels.form.percentileHint,
      suffix: '',
      half: true,
    },
    {
      kind: 'integer',
      name: 'cushionMonths',
      label: labels.form.months,
      hint: labels.form.monthsHint,
      half: true,
    },
    {
      kind: 'select',
      name: 'retentionAccountId',
      label: labels.form.account,
      hint: labels.form.accountHint,
      half: true,
      options: [
        { value: '', label: labels.form.accountNone },
        ...accounts.map((account) => ({ value: account.id, label: account.name })),
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {floor.source === 'unknown' ? (
        <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />
      ) : (
        <Card>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Stat
                label={labels.floorLabel}
                detail={
                  floor.source === 'measured'
                    ? labels.monthsObserved.replace('{count}', String(floor.monthsObserved))
                    : labels.monthsNeeded.replace('{count}', String(floor.monthsObserved))
                }
              >
                {money(floor.amount)}
              </Stat>
              <Status tone={floor.source === 'measured' ? 'positive' : 'caution'}>
                {floor.source === 'measured' ? labels.floorMeasured : labels.floorDeclared}
              </Status>
            </div>

            <Stat
              label={labels.cushionLabel}
              detail={labels.cushionTarget
                .replace('{months}', String(cushion.monthsTarget))
                .replace('{amount}', money(cushion.target))}
            >
              {money(cushion.held)}
            </Stat>
          </div>

          {/* El indicador sólo con objetivo. Una barra en cero contra un objetivo
              que nadie fijó arranca al lector perdiendo una carrera que no empezó. */}
          {cushion.target.isPositive() && (
            <div className="mt-6">
              <Gauge
                value={cushion.held}
                max={cushion.target}
                label={labels.cushionGauge}
                locale={moneyLocale}
                tone={cushion.shortOfFloor.isPositive() ? 'caution' : 'neutral'}
                thresholds={[
                  { at: cushion.target, label: labels.cushionTarget.split('.')[0] ?? '', kind: 'target' },
                ]}
              />
              <p className="mt-3 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                {cushion.isFunded
                  ? labels.cushionFunded
                  : labels.cushionMissing.replace('{amount}', money(cushion.missing))}
              </p>
            </div>
          )}

          {/* La frase que hay que decir en voz alta antes de que la casa gaste
              como si el piso hubiera llegado entero. */}
          {cushion.shortOfFloor.isPositive() && (
            <p className="mt-4 text-sm text-pretty text-[color:var(--color-caution)]">
              {labels.cushionShort.replace('{amount}', money(cushion.shortOfFloor))}
            </p>
          )}

          {floor.source === 'measured' && (
            <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-[color:var(--color-rule)] pt-4">
              {(
                [
                  [labels.worst, floor.worstMonth],
                  [labels.typical, floor.typicalMonth],
                  [labels.best, floor.bestMonth],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1">
                  <dt className="text-xs tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
                    {label}
                  </dt>
                  <dd className="tabular text-sm">{value ? money(value) : '—'}</dd>
                </div>
              ))}
            </dl>
          )}

          <p className="mt-6 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {view.retention
              ? labels.retentionHolds
                  .replace('{account}', view.retention.name)
                  .replace('{amount}', money(cushion.release))
              : labels.noRetention}
          </p>
        </Card>
      )}

      <Card>
        <SingleForm
          locale={locale}
          fields={fields}
          currencySymbol={currencySymbol}
          action={saveFloorSettings}
          values={{
            incomeFloor: view.declared?.toDecimalString() ?? '',
            percentile: String(floor.percentile ?? 0.25),
            cushionMonths: view.declaredMonths === null ? '' : String(view.declaredMonths),
            retentionAccountId: view.retention?.id ?? '',
          }}
          labels={{
            submit: labels.form.submit,
            saved: labels.form.saved,
            errorTitle: labels.form.errorTitle,
            errors: labels.form.errors,
          }}
        />
      </Card>
    </div>
  );
}
