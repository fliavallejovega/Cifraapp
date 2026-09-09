'use client';

import { Button, Card, EmptyState, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState, useEffect, useState } from 'react';

import { KindIcon, SymbolSearch } from '@/components/symbol-search';
import type { RecordActionResult } from '@/components/records/spec';
import { createHolding, removeHolding, updateHolding } from '@/server/holdings-actions';
import type { SymbolCandidate } from '@/server/holdings-actions';

/**
 * Lo que la casa tiene invertido, administrable.
 *
 * El cuestionario inicial creaba estas filas y después nada podía tocarlas.
 * Esta es la misma corrección que recibieron los ingresos y las cuentas: la
 * pantalla donde vive el dinero es donde se administra.
 *
 * ## Por qué el símbolo se elige de una lista y no se teclea
 *
 * Porque `BTC` es un ticker real —el Grayscale Bitcoin Mini Trust, un fondo en
 * NYSE Arca— y quien lo teclea casi siempre quiere bitcoin. Tecleado, el
 * sistema encuentra el fondo, lo cotiza y guarda algo que la persona no tiene,
 * sin que nada falle. Elegido de una lista, la moneda y el fondo que lleva su
 * nombre son dos filas visiblemente distintas.
 *
 * ## La clase es del proveedor, no del formulario
 *
 * Acción, ETF, cripto, fondo o índice viene de quien cotiza el instrumento. El
 * formulario lo enseña con su icono para que se vea qué se está registrando —
 * ver «cripto» al lado de BTC-USD es la confirmación de que se eligió bien— y
 * el servidor lo vuelve a leer de la cotización guardada antes de escribirlo.
 *
 * ## Qué se pide y qué no
 *
 * El símbolo y la cantidad. El precio no: pertenece a quien lo cotizó. El costo
 * es opcional a propósito — mucha gente no lo sabe, e inventarlo convierte una
 * ganancia desconocida en una declarada.
 */

export interface HoldingRowView {
  readonly id: string;
  readonly symbol: string;
  readonly label: string;
  readonly kind: string;
  readonly quantity: string;
  readonly holderId: string | null;
  readonly holderName: string | null;
  readonly costBasis: string | null;
  /** El valor de hoy, ya formateado, o null si nadie lo ha podido cotizar. */
  readonly value: string | null;
  readonly price: string | null;
  readonly stale: boolean;
}

export interface HoldingsLabels {
  readonly addAction: string;
  readonly addTitle: string;
  readonly edit: string;
  readonly remove: string;
  readonly removeConfirm: string;
  readonly removeConfirmYes: string;
  readonly cancel: string;
  readonly submitCreate: string;
  readonly submitUpdate: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly symbol: string;
  readonly symbolHint: string;
  readonly quantity: string;
  readonly quantityHint: string;
  readonly label: string;
  readonly labelHint: string;
  readonly holder: string;
  readonly holderShared: string;
  readonly cost: string;
  readonly costHint: string;
  readonly unpriced: string;
  readonly stale: string;
  readonly kinds: Readonly<Record<string, string>>;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
  /**
   * Las cadenas del buscador de símbolos, ya resueltas.
   *
   * Un **objeto**, no la función `t` del servidor. Pasar una función de un
   * componente de servidor a uno de cliente es un error de ejecución que ni el
   * compilador ni el build detectan: React no puede serializarla, la página
   * revienta en producción y el gate entero pasa en verde. Tipar esta prop como
   * datos es lo que devuelve esa comprobación al compilador.
   *
   * Las claves llegan tal cual las pide `SymbolSearch` —`holdings.…`— porque el
   * catálogo sigue siendo uno solo, el del cuestionario, aplanado al cruzar.
   */
  readonly search: Readonly<Record<string, string>>;
}

export interface HoldingsManagerProps {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly rows: readonly HoldingRowView[];
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly labels: HoldingsLabels;
}

type Editing = { readonly mode: 'closed' } | { readonly mode: 'new' } | {
  readonly mode: 'edit';
  readonly row: HoldingRowView;
};

export function HoldingsManager({
  locale,
  currencySymbol,
  rows,
  people,
  labels,
}: HoldingsManagerProps) {
  const [editing, setEditing] = useState<Editing>({ mode: 'closed' });
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 && editing.mode === 'closed' ? (
        <EmptyState
          title={labels.emptyTitle}
          body={labels.emptyBody}
          action={
            <Button
              type="button"
              onClick={() => {
                setEditing({ mode: 'new' });
              }}
            >
              {labels.addAction}
            </Button>
          }
        />
      ) : (
        <>
          {rows.length > 0 && (
            <Card>
              <ul className="flex list-none flex-col p-0">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-rule)] py-3 last:border-b-0"
                  >
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span
                        aria-hidden
                        className="flex h-6 w-6 shrink-0 translate-y-1 items-center justify-center rounded-(--radius-xs) bg-[color:var(--color-ground-sunk)] text-[color:var(--color-ink-secondary)]"
                      >
                        <KindIcon kind={row.kind} />
                      </span>
                      <div className="min-w-0">
                        <span className="text-sm font-medium break-words">{row.label}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--color-ink-secondary)]">
                          <span className="tabular">{row.symbol}</span>
                          <span>{labels.kinds[row.kind] ?? row.kind}</span>
                          <span className="tabular">{row.quantity}</span>
                          {row.holderName && <span>{row.holderName}</span>}
                          {row.stale && <Status tone="caution">{labels.stale}</Status>}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {/* Un valor que nadie pudo cotizar se dice, no se pinta como
                          cero: un total que se lee entero cuando le falta una
                          posición es peor que uno que avisa. */}
                      <span className="readout text-sm">
                        {row.value ?? (
                          <span className="text-[color:var(--color-ink-tertiary)]">
                            {labels.unpriced}
                          </span>
                        )}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setConfirming(null);
                          setEditing({ mode: 'edit', row });
                        }}
                      >
                        {labels.edit}
                      </Button>
                      {confirming === row.id ? (
                        <RemoveForm
                          locale={locale}
                          id={row.id}
                          labels={labels}
                          onCancel={() => {
                            setConfirming(null);
                          }}
                        />
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setConfirming(row.id);
                          }}
                        >
                          {labels.remove}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {editing.mode === 'closed' && (
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing({ mode: 'new' });
                }}
              >
                {labels.addAction}
              </Button>
            </div>
          )}
        </>
      )}

      {editing.mode !== 'closed' && (
        <HoldingForm
          key={editing.mode === 'edit' ? editing.row.id : 'new'}
          locale={locale}
          currencySymbol={currencySymbol}
          people={people}
          labels={labels}
          row={editing.mode === 'edit' ? editing.row : null}
          onDone={() => {
            setEditing({ mode: 'closed' });
          }}
        />
      )}
    </div>
  );
}

function RemoveForm({
  locale,
  id,
  labels,
  onCancel,
}: {
  readonly locale: string;
  readonly id: string;
  readonly labels: HoldingsLabels;
  readonly onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    removeHolding,
    {},
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-[color:var(--color-ink-secondary)]">
        {labels.removeConfirm}
      </span>
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        {labels.removeConfirmYes}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        {labels.cancel}
      </Button>
      {state.error && (
        <span className="text-xs text-[color:var(--color-negative)]">
          {labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        </span>
      )}
    </form>
  );
}

function HoldingForm({
  locale,
  currencySymbol,
  people,
  labels,
  row,
  onDone,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly labels: HoldingsLabels;
  readonly row: HoldingRowView | null;
  readonly onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    row ? updateHolding : createHolding,
    {},
  );

  /**
   * Cerrar al guardar.
   *
   * La revalidación repinta la lista por debajo, pero el formulario seguiría
   * abierto con lo que se acaba de guardar dentro — y en un formulario de
   * «agregar» eso invita a pulsar otra vez y registrar la posición dos veces.
   */
  useEffect(() => {
    if (state.ok || state.created) onDone();
  }, [state.ok, state.created, onDone]);

  /**
   * El diccionario, como la función que el buscador espera.
   *
   * Se arma aquí, en el cliente, sobre un objeto que sí cruzó la frontera. Una
   * clave que faltara se devuelve tal cual en vez de reventar: un buscador con
   * una etiqueta cruda es un defecto visible y arreglable, y uno que lanza se
   * lleva la pantalla entera por delante.
   */
  const searchCopy = (key: string): string => labels.search[key] ?? key;

  const [symbol, setSymbol] = useState(row?.symbol ?? '');
  const [label, setLabel] = useState(row?.label ?? '');
  const [kind, setKind] = useState(row?.kind ?? 'other');

  /**
   * Elegir de la lista rellena el nombre y la clase.
   *
   * Pre-rellenar el nombre con el del proveedor es lo correcto: es lo que la
   * mayoría quiere y queda editable para quien llama a su posición de otra
   * forma. La clase no se edita — no es una opinión de la casa.
   */
  const choose = (candidate: SymbolCandidate) => {
    setSymbol(candidate.symbol);
    setKind(candidate.kind);
    if (label.trim() === '' || label === row?.label) setLabel(candidate.name);
  };

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="locale" value={locale} />
        {row && <input type="hidden" name="id" value={row.id} />}
        <input type="hidden" name="kind" value={kind} />

        {state.error && (
          <Problem
            title={labels.errorTitle}
            body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
          />
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={labels.symbol} hint={labels.symbolHint}>
            {({ id, describedBy }) => (
              <>
                <SymbolSearch
                  id={id}
                  describedBy={describedBy}
                  value={symbol}
                  copy={searchCopy}
                  onType={setSymbol}
                  onChoose={choose}
                  onCommit={() => {
                    /* El servidor vuelve a leer la clase de la cotización, así
                       que un símbolo tecleado a mano no necesita otra consulta
                       aquí para guardarse bien. */
                  }}
                />
                <input type="hidden" name="symbol" value={symbol} />
              </>
            )}
          </Field>

          <Field label={labels.quantity} hint={labels.quantityHint}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="quantity"
                numeric
                inputMode="decimal"
                required
                defaultValue={row?.quantity ?? ''}
                placeholder="0"
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field label={labels.label} hint={labels.labelHint} className="sm:col-span-2">
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="label"
                required
                maxLength={120}
                value={label}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setLabel(event.target.value);
                }}
              />
            )}
          </Field>

          {people.length > 0 && (
            <Field label={labels.holder}>
              {({ id }) => (
                <Select id={id} name="personId" defaultValue={row?.holderId ?? ''}>
                  <option value="">{labels.holderShared}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <Field label={labels.cost} hint={labels.costHint}>
            {({ id, describedBy }) => (
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
                >
                  {currencySymbol}
                </span>
                <Input
                  id={id}
                  name="costBasis"
                  numeric
                  inputMode="decimal"
                  defaultValue={row?.costBasis ?? ''}
                  placeholder="0.00"
                  aria-describedby={describedBy}
                  className="pl-8"
                />
              </div>
            )}
          </Field>
        </div>

        {/* La clase, a la vista y no editable: es un hecho del proveedor, y
            verla al lado del símbolo es la confirmación de que se eligió el
            instrumento correcto y no el fondo que lleva su nombre. */}
        {symbol.trim() !== '' && (
          <p className="flex items-center gap-2 text-xs text-[color:var(--color-ink-secondary)]">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-(--radius-xs) bg-[color:var(--color-ground-sunk)]"
            >
              <KindIcon kind={kind} />
            </span>
            {labels.kinds[kind] ?? kind}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending}>
            {row ? labels.submitUpdate : labels.submitCreate}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            {labels.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
