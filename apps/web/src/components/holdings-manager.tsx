'use client';

import { Button, Card, EmptyState, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState, useEffect, useState } from 'react';

import { KindIcon, SymbolSearch } from '@/components/symbol-search';
import type { RecordActionResult } from '@/components/records/spec';
import { quotedValue, readablePrice } from '@/lib/quoted-value';
import {
  clearHoldingIntent,
  createHolding,
  lookupSymbol,
  removeHolding,
  setHoldingIntent,
  updateHolding,
} from '@/server/holdings-actions';
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

export type HoldingIntent = 'long_term' | 'hold' | 'exit' | 'reallocate';

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
  /** Qué decidió la casa. Nulo es «nadie lo ha dicho», no «la mantengo». */
  readonly intent: HoldingIntent | null;
  readonly intentHorizon: string | null;
  readonly intentNote: string | null;
  /** Cuándo se decidió, ya formateado. Una decisión vieja se dice vieja. */
  readonly intentDecidedOn: string | null;
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
  /** «{quantity} × {price} = {value}», la vista previa del valor. */
  readonly quoted: string;
  readonly checking: string;
  readonly unknownSymbol: string;
  readonly unavailable: string;
  /** El bloque de «¿qué vas a hacer con esto?». */
  readonly intent: {
    readonly open: string;
    readonly title: string;
    readonly detail: string;
    readonly none: string;
    readonly options: Readonly<Record<HoldingIntent, string>>;
    readonly consequence: Readonly<Record<HoldingIntent, string>>;
    readonly horizon: string;
    readonly horizonHint: string;
    readonly note: string;
    readonly noteHint: string;
    readonly save: string;
    readonly clear: string;
    readonly decidedOn: string;
    readonly notAdvice: string;
  };
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
  readonly moneyLocale: 'es-PA' | 'en-US';
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
  moneyLocale,
  currencySymbol,
  rows,
  people,
  labels,
}: HoldingsManagerProps) {
  const [editing, setEditing] = useState<Editing>({ mode: 'closed' });
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Qué posición tiene abierto su bloque de decisión. Una a la vez. */
  const [deciding, setDeciding] = useState<string | null>(null);

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
                          {/* La decisión, si la hay. `long_term` en positivo
                              porque es la que sostiene un plan; `exit` en
                              señal porque es la que va a mover dinero. */}
                          {row.intent && (
                            <Status
                              tone={
                                row.intent === 'long_term'
                                  ? 'positive'
                                  : row.intent === 'exit'
                                    ? 'signal'
                                    : 'neutral'
                              }
                            >
                              {labels.intent.options[row.intent]}
                            </Status>
                          )}
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
                          setDeciding(deciding === row.id ? null : row.id);
                        }}
                      >
                        {labels.intent.open}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setConfirming(null);
                          setDeciding(null);
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

                    {deciding === row.id && (
                      <div className="w-full">
                        <IntentPanel
                          locale={locale}
                          row={row}
                          labels={labels}
                          onDone={() => {
                            setDeciding(null);
                          }}
                        />
                      </div>
                    )}
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
          moneyLocale={moneyLocale}
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
  moneyLocale,
  currencySymbol,
  people,
  labels,
  row,
  onDone,
}: {
  readonly locale: string;
  readonly moneyLocale: 'es-PA' | 'en-US';
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
  const [quantity, setQuantity] = useState(row?.quantity ?? '');

  /**
   * La cotización del instrumento elegido, para poder decir cuánto vale lo que
   * se está tecleando.
   *
   * `checking` mientras se pregunta, `unknown` cuando el proveedor no lo
   * reconoce, `unavailable` cuando no contesta. Los tres se dicen: un campo que
   * no muestra nada después de elegir algo parece roto, y «no pude cotizarlo»
   * es una respuesta que deja seguir —la posición se guarda igual, sin valor—.
   */
  const [quote, setQuote] = useState<
    | { readonly status: 'idle' }
    | { readonly status: 'checking' }
    | { readonly status: 'unknown' | 'unavailable' }
    | {
        readonly status: 'ok';
        readonly price: string;
        readonly currency: string;
        readonly name: string;
      }
  >({ status: 'idle' });

  const priceOf = async (value: string) => {
    if (value.trim() === '') {
      setQuote({ status: 'idle' });
      return;
    }
    setQuote({ status: 'checking' });
    const result = await lookupSymbol(value);
    if (result.ok && result.price && result.currency) {
      setQuote({
        status: 'ok',
        price: result.price,
        currency: result.currency,
        name: result.name ?? value,
      });
      if (result.kind) setKind(result.kind);
    } else {
      setQuote({ status: result.reason === 'unavailable' ? 'unavailable' : 'unknown' });
    }
  };

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
    void priceOf(candidate.symbol);
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
                  onType={(value) => {
                    setSymbol(value);
                    // Lo tecleado deja de corresponder a lo cotizado en cuanto
                    // cambia una letra. Dejar el precio viejo en pantalla
                    // mostraría el valor de otro instrumento.
                    setQuote({ status: 'idle' });
                  }}
                  onChoose={choose}
                  onCommit={(value) => {
                    // Quien ya sabe el símbolo exacto no pasa por la lista, y
                    // su posición merece la misma vista previa que las demás.
                    void priceOf(value);
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
                value={quantity}
                placeholder="0"
                aria-describedby={describedBy}
                onChange={(event) => {
                  setQuantity(event.target.value);
                }}
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

        {/*
          La clase, el precio y el total: la confirmación de que se eligió el
          instrumento correcto y de que la cantidad significa lo que se cree.

          Un cero de más en una cripto no se nota mirando el campo; se nota
          mirando el total. Por eso va aquí, al lado, y no en la lista de
          después — donde ya sería tarde para corregirlo sin volver a entrar.
        */}
        {symbol.trim() !== '' && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--color-ink-secondary)]">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-(--radius-xs) bg-[color:var(--color-ground-sunk)]"
            >
              <KindIcon kind={kind} />
            </span>
            <span>{labels.kinds[kind] ?? kind}</span>

            {quote.status === 'checking' && (
              <span className="text-[color:var(--color-ink-tertiary)]">{labels.checking}</span>
            )}
            {quote.status === 'unknown' && (
              <span className="text-[color:var(--color-negative)]">{labels.unknownSymbol}</span>
            )}
            {quote.status === 'unavailable' && (
              <span className="text-[color:var(--color-caution)]">{labels.unavailable}</span>
            )}
            {quote.status === 'ok' && (
              <>
                <Status tone="positive">{quote.name}</Status>
                <span className="tabular">
                  {labels.quoted
                    .replace('{price}', `${quote.currency} ${readablePrice(quote.price)}`)
                    .replace(
                      '{value}',
                      quotedValue(quantity, quote.price, quote.currency, moneyLocale) ?? '—',
                    )}
                </span>
              </>
            )}
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

/**
 * Qué va a hacer la casa con esta posición.
 *
 * ## Por qué el producto no sugiere nada aquí
 *
 * Recomendar vender, mantener o cambiar de instrumento es asesoría de
 * inversión: hace falta licencia para darla y los términos de servicio dicen con
 * todas sus letras que Cifraapp no es un asesor. Así que ninguna opción viene
 * marcada, ninguna se presenta como la recomendable, y el bloque lo dice en voz
 * alta debajo.
 *
 * Lo que sí hace el producto es la mitad que sí le toca: **decir la
 * consecuencia** de cada decisión sobre el resto del plan. «Esto deja de contar
 * como disponible» y «esto va a volverse efectivo» son aritmética sobre lo que
 * la casa acaba de declarar, no una opinión sobre si conviene.
 *
 * ## Por qué no se guarda al cambiar el selector
 *
 * Porque es una decisión sobre dinero. Un `onChange` que guarda solo convierte
 * un roce del dedo en «voy a vender medio bitcoin», y deshacerlo exige darse
 * cuenta primero. Hay un botón, y dice qué va a pasar.
 */
function IntentPanel({
  locale,
  row,
  labels,
  onDone,
}: {
  readonly locale: string;
  readonly row: HoldingRowView;
  readonly labels: HoldingsLabels;
  readonly onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    setHoldingIntent,
    {},
  );
  const [cleared, clearAction, clearing] = useActionState<RecordActionResult, FormData>(
    clearHoldingIntent,
    {},
  );

  const [choice, setChoice] = useState<HoldingIntent | ''>(row.intent ?? '');

  useEffect(() => {
    if (state.ok || cleared.ok) onDone();
  }, [state.ok, cleared.ok, onDone]);

  const failure = state.error ?? cleared.error;

  return (
    <Card tone="sunk" className="mt-3">
      <p className="text-sm font-medium">{labels.intent.title}</p>
      <p className="mt-1 max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-secondary)]">
        {labels.intent.detail}
      </p>

      {failure && (
        <div className="mt-3">
          <Problem
            title={labels.errorTitle}
            body={labels.errors[failure] ?? labels.errors['generic'] ?? ''}
          />
        </div>
      )}

      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="id" value={row.id} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={labels.intent.title}>
            {({ id }) => (
              <Select
                id={id}
                name="intent"
                required
                value={choice}
                onChange={(event) => {
                  setChoice(event.target.value as HoldingIntent | '');
                }}
              >
                {/* Ninguna preseleccionada cuando no hay decisión: un valor por
                    defecto en esta lista es el producto opinando. */}
                <option value="" disabled>
                  {labels.intent.none}
                </option>
                {(['long_term', 'hold', 'exit', 'reallocate'] as const).map((option) => (
                  <option key={option} value={option}>
                    {labels.intent.options[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={labels.intent.horizon} hint={labels.intent.horizonHint}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="horizon"
                type="date"
                defaultValue={row.intentHorizon ?? ''}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field label={labels.intent.note} hint={labels.intent.noteHint} className="sm:col-span-2">
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="note"
                maxLength={500}
                defaultValue={row.intentNote ?? ''}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </div>

        {/* La consecuencia, que es lo único que el producto puede aportar sobre
            una decisión de inversión: qué le pasa al resto del plan. */}
        {choice !== '' && (
          <p className="max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.intent.consequence[choice].replace('{value}', row.value ?? labels.unpriced)}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending || choice === ''}>
            {labels.intent.save}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            {labels.cancel}
          </Button>
        </div>
      </form>

      {row.intent && (
        <form action={clearAction} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={row.id} />
          {row.intentDecidedOn && (
            <span className="text-xs text-[color:var(--color-ink-tertiary)]">
              {labels.intent.decidedOn.replace('{date}', row.intentDecidedOn)}
            </span>
          )}
          <Button type="submit" variant="ghost" size="sm" disabled={clearing}>
            {labels.intent.clear}
          </Button>
        </form>
      )}

      <p className="mt-4 max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
        {labels.intent.notAdvice}
      </p>
    </Card>
  );
}
