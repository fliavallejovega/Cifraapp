'use client';

import { Button, Problem, Status } from '@app/ui';
import { useActionState, useState } from 'react';

import { confirmImport, discardImport, type ConfirmActionResult } from '@/server/import-actions';
import {
  createCategoryForRow,
  setRowCategory,
  setRowDebt,
} from '@/server/review-row-actions';

/**
 * Deciding what enters the ledger.
 *
 * The engine's verdict sets the starting position and nothing more: a row it
 * believes is new arrives selected, a row it believes it has seen before
 * arrives unselected with the signals that matched. Neither is final. The
 * product's promise is that no movement appears in a person's records without
 * someone agreeing to it, and this screen is where that promise is either kept
 * or broken.
 *
 * The button carries the count, so the last thing read before the click is the
 * number of movements about to exist.
 */

export interface ReviewRow {
  readonly id: string;
  readonly date: string;
  readonly description: string;
  readonly amount: string;
  readonly isNegative: boolean;
  readonly verdict: 'new' | 'duplicate' | 'review' | 'rejected';
  readonly signals: readonly string[];
  readonly rejectionReason: string | null;
  readonly alreadyFiled: boolean;
  /** La cuenta donde vive la coincidencia, cuando no es la que se importa. */
  readonly matchedAccountName: string | null;
  /** El rubro que va a quedar: el elegido, o el propuesto. */
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  /** `rule`, `merchant` o nulo. Se enseña: no toda propuesta pesa lo mismo. */
  readonly categorySource: string | null;
  /** Verdadero cuando la persona ya lo eligió a mano. */
  readonly categoryChosen: boolean;
  readonly debtId: string | null;
  readonly debtName: string | null;
  /** Lo que la segunda lectura opinó, cuando opinó. */
  readonly aiReason: string | null;
}

export interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

export interface DebtOption {
  readonly id: string;
  readonly name: string;
  readonly outstanding: string;
}

export interface ImportReviewLabels {
  readonly selectAll: string;
  readonly clearAll: string;
  readonly confirm: string;
  readonly confirmOne: string;
  readonly nothingSelected: string;
  readonly discard: string;
  readonly discardConfirm: string;
  readonly discardConfirmYes: string;
  readonly cancel: string;
  readonly filed: string;
  readonly alreadyFiled: string;
  readonly settled: string;
  readonly columnDate: string;
  readonly columnDescription: string;
  readonly columnAmount: string;
  readonly verdicts: Record<string, string>;
  readonly verdictHints: Record<string, string>;
  readonly signalLabel: string;
  readonly errorTitle: string;
  readonly errors: Record<string, string>;
  readonly wizard: {
    readonly category: string;
    readonly categoryNone: string;
    readonly categoryUnknown: string;
    readonly sources: Record<string, string>;
    readonly chosen: string;
    readonly newCategory: string;
    readonly newCategoryName: string;
    readonly newCategoryKind: string;
    readonly kinds: Record<string, string>;
    readonly create: string;
    readonly cancel: string;
    readonly debt: string;
    readonly debtNone: string;
    /** «Baja {debt}, que debe {amount}» */
    readonly debtEffect: string;
    readonly matchedIn: string;
    readonly aiSaid: string;
    readonly edit: string;
    readonly done: string;
  };
}

export function ImportReview({
  locale,
  importId,
  rows,
  labels,
  categories,
  debts,
}: {
  readonly locale: string;
  readonly importId: string;
  readonly rows: readonly ReviewRow[];
  readonly labels: ImportReviewLabels;
  /** Los rubros del hogar, para elegir sin salir de aquí. */
  readonly categories: readonly CategoryOption[];
  /** Las deudas vivas, para poder decir que este pago baja una de ellas. */
  readonly debts: readonly DebtOption[];
}) {
  const [confirmState, confirmAction, confirming] = useActionState<ConfirmActionResult, FormData>(
    confirmImport,
    {},
  );
  const [, discardAction, discarding] = useActionState<ConfirmActionResult, FormData>(
    discardImport,
    {},
  );
  const [discardOpen, setDiscardOpen] = useState(false);

  const selectable = rows.filter((row) => row.verdict !== 'rejected' && !row.alreadyFiled);

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    // The engine's opinion, as a starting point. Everything it is unsure about
    // starts off, because filing something twice is the expensive mistake.
    () => new Set(selectable.filter((row) => row.verdict === 'new').map((row) => row.id)),
  );

  if (selectable.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Status tone="positive">{labels.settled}</Status>
        <RowList
          locale={locale}
          rows={rows}
          labels={labels}
          selected={selected}
          onToggle={null}
          categories={categories}
          debts={debts}
        />
      </div>
    );
  }

  const count = selected.size;

  return (
    <div className="flex flex-col gap-6">
      {confirmState.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[confirmState.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      {confirmState.filed !== undefined && confirmState.filed > 0 && (
        <Status tone="positive">
          {labels.filed.replace('{count}', String(confirmState.filed))}
        </Status>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setSelected(new Set(selectable.map((row) => row.id)));
          }}
        >
          {labels.selectAll}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setSelected(new Set());
          }}
        >
          {labels.clearAll}
        </Button>
      </div>

      <form action={confirmAction} className="flex flex-col gap-6">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="importId" value={importId} />
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="rows" value={id} />
        ))}

        <RowList
          locale={locale}
          categories={categories}
          debts={debts}
          rows={rows}
          labels={labels}
          selected={selected}
          onToggle={(id) => {
            const next = new Set(selected);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setSelected(next);
          }}
        />

        {/* Sticky, because the decision is made at the bottom of a long list and
            scrolling back up to act is the friction nobody notices reporting. */}
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 border-t border-[color:var(--color-rule)] bg-[color:var(--color-ground)] px-1 py-4">
          <Button type="submit" size="lg" loading={confirming} disabled={count === 0}>
            {count === 0
              ? labels.nothingSelected
              : count === 1
                ? labels.confirmOne
                : labels.confirm.replace('{count}', String(count))}
          </Button>

          {discardOpen ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[color:var(--color-ink-secondary)]">
                {labels.discardConfirm}
              </span>
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                loading={discarding}
                formAction={discardAction}
              >
                {labels.discardConfirmYes}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDiscardOpen(false);
                }}
              >
                {labels.cancel}
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDiscardOpen(true);
              }}
            >
              {labels.discard}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function RowList({
  locale,
  rows,
  labels,
  selected,
  onToggle,
  categories,
  debts,
}: {
  readonly locale: string;
  readonly rows: readonly ReviewRow[];
  readonly labels: ImportReviewLabels;
  readonly selected: ReadonlySet<string>;
  readonly onToggle: ((id: string) => void) | null;
  readonly categories: readonly CategoryOption[];
  readonly debts: readonly DebtOption[];
}) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-(--radius-lg) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] shadow-(--shadow-card)">
      {rows.map((row) => {
        const locked = row.verdict === 'rejected' || row.alreadyFiled || onToggle === null;
        const checked = row.alreadyFiled || selected.has(row.id);

        return (
          <li key={row.id} className="border-b border-[color:var(--color-rule)] last:border-b-0">
            <label
              className={[
                'flex items-start gap-3 px-4 py-4 transition-colors duration-(--duration-quick) sm:px-5',
                'has-checked:bg-[color:var(--color-brand-sunk)]/40',
                locked ? 'cursor-default opacity-70' : 'cursor-pointer',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={() => {
                  onToggle?.(row.id);
                }}
                className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--color-ink)]"
              />

              <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="readout w-24 shrink-0 text-xs text-[color:var(--color-ink-secondary)]">
                  {row.date}
                </span>

                <span className="min-w-0 flex-1">
                  {/* A statement description can run to eighty characters of
                      bank shorthand; it wraps rather than truncating, because
                      the tail is often the only part that identifies it. */}
                  <span className="block break-words text-[color:var(--color-ink)]">
                    {row.description}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase">
                      {row.alreadyFiled
                        ? labels.alreadyFiled
                        : (labels.verdicts[row.verdict] ?? row.verdict)}
                    </span>
                    <span className="text-xs text-[color:var(--color-ink-secondary)]">
                      {row.rejectionReason ??
                        (row.signals.length > 0
                          ? `${labels.signalLabel} ${row.signals.join(', ')}`
                          : (labels.verdictHints[row.verdict] ?? ''))}
                    </span>
                    {/* Dónde vive la coincidencia. «Esto ya está registrado» no
                        sirve; «esto ya lo anotó Vale en su cuenta» sí. */}
                    {row.matchedAccountName && (
                      <Status tone="signal">
                        {labels.wizard.matchedIn.replace('{account}', row.matchedAccountName)}
                      </Status>
                    )}
                    {row.aiReason && (
                      <span className="text-xs text-[color:var(--color-ink-tertiary)]">
                        {labels.wizard.aiSaid.replace('{reason}', row.aiReason)}
                      </span>
                    )}
                  </span>

                  {/* El asistente: qué rubro va a quedar y si esto baja una
                      deuda. Antes esto no existía y la casa aprobaba una lista
                      de descripciones crudas sin saber qué se iba a hacer con
                      ellas — eso no es aprobar, es firmar. */}
                  {!locked && (
                    <RowWizard
                      locale={locale}
                      row={row}
                      labels={labels}
                      categories={categories}
                      debts={debts}
                    />
                  )}
                </span>

                <span
                  className={[
                    'readout shrink-0 text-sm tabular-nums sm:w-32 sm:text-right',
                    row.isNegative
                      ? 'text-[color:var(--color-ink)]'
                      : 'text-[color:var(--color-positive)]',
                  ].join(' ')}
                >
                  {row.amount}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Lo que se decide sobre una fila antes de que sea un movimiento.
 *
 * Dos preguntas y nada más: **con qué rubro queda** y **si esto baja una
 * deuda**. Las dos llegan contestadas cuando el sistema pudo; ésta es la
 * oportunidad de corregirlo, no de empezar de cero.
 *
 * Colapsado por defecto. Una lista de cuarenta filas con dos selectores cada
 * una es una pantalla que nadie termina de revisar, y lo que hay que ver de un
 * vistazo es la propuesta, no el control para cambiarla.
 */
function RowWizard({
  locale,
  row,
  labels,
  categories,
  debts,
}: {
  readonly locale: string;
  readonly row: ReviewRow;
  readonly labels: ImportReviewLabels;
  readonly categories: readonly CategoryOption[];
  readonly debts: readonly DebtOption[];
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [, categoryAction] = useActionState(setRowCategory, {});
  const [, debtAction] = useActionState(setRowDebt, {});
  const [createState, createAction] = useActionState(createCategoryForRow, {});

  const debt = debts.find((one) => one.id === row.debtId) ?? null;

  return (
    <span
      className="mt-2 block"
      // El resumen vive dentro de un `<label>` que marca la casilla; sin esto,
      // abrir el asistente cambiaría la selección de la fila.
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
      role="presentation"
    >
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <Status tone={row.categoryName ? 'neutral' : 'caution'}>
          {row.categoryName ?? labels.wizard.categoryUnknown}
        </Status>
        {row.categoryName && (
          <span className="text-[color:var(--color-ink-tertiary)]">
            {row.categoryChosen
              ? labels.wizard.chosen
              : (labels.wizard.sources[row.categorySource ?? ''] ?? '')}
          </span>
        )}
        {debt && (
          <Status tone="signal">
            {labels.wizard.debtEffect
              .replace('{debt}', debt.name)
              .replace('{amount}', debt.outstanding)}
          </Status>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
          }}
          className="underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
        >
          {open ? labels.wizard.done : labels.wizard.edit}
        </button>
      </span>

      {open && (
        <span className="mt-3 grid gap-3 sm:grid-cols-2">
          <form action={categoryAction} className="flex flex-col gap-1">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="rowId" value={row.id} />
            <label
              htmlFor={`cat-${row.id}`}
              className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase"
            >
              {labels.wizard.category}
            </label>
            <select
              id={`cat-${row.id}`}
              name="categoryId"
              defaultValue={row.categoryId ?? ''}
              onChange={(event) => {
                event.currentTarget.form?.requestSubmit();
              }}
              className="min-h-11 rounded-(--radius-sm) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-3 text-sm"
            >
              <option value="">{labels.wizard.categoryNone}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setCreating(!creating);
              }}
              className="self-start text-xs underline decoration-[color:var(--color-rule-strong)] underline-offset-4"
            >
              {labels.wizard.newCategory}
            </button>
          </form>

          {debts.length > 0 && (
            <form action={debtAction} className="flex flex-col gap-1">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="rowId" value={row.id} />
              <label
                htmlFor={`debt-${row.id}`}
                className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase"
              >
                {labels.wizard.debt}
              </label>
              <select
                id={`debt-${row.id}`}
                name="debtId"
                defaultValue={row.debtId ?? ''}
                onChange={(event) => {
                  event.currentTarget.form?.requestSubmit();
                }}
                className="min-h-11 rounded-(--radius-sm) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-3 text-sm"
              >
                <option value="">{labels.wizard.debtNone}</option>
                {debts.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name} — {one.outstanding}
                  </option>
                ))}
              </select>
            </form>
          )}

          {/* Crear un rubro sin salir. Mandar a alguien a otra pantalla y de
              vuelta a buscar la fila donde estaba es cómo se abandona una
              revisión a la mitad. */}
          {creating && (
            <form action={createAction} className="flex flex-wrap items-end gap-2 sm:col-span-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="rowId" value={row.id} />
              <span className="flex min-w-40 flex-1 flex-col gap-1">
                <label
                  htmlFor={`new-${row.id}`}
                  className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase"
                >
                  {labels.wizard.newCategoryName}
                </label>
                <input
                  id={`new-${row.id}`}
                  name="name"
                  required
                  maxLength={80}
                  className="min-h-11 rounded-(--radius-sm) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-3 text-sm"
                />
              </span>
              <select
                name="kind"
                defaultValue="expense"
                aria-label={labels.wizard.newCategoryKind}
                className="min-h-11 rounded-(--radius-sm) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-3 text-sm"
              >
                {['expense', 'income', 'transfer', 'investment'].map((kind) => (
                  <option key={kind} value={kind}>
                    {labels.wizard.kinds[kind] ?? kind}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm">
                {labels.wizard.create}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCreating(false);
                }}
              >
                {labels.wizard.cancel}
              </Button>
              {createState.error && (
                <span className="text-xs text-[color:var(--color-negative)]">
                  {labels.errors[createState.error] ?? labels.errors['generic'] ?? ''}
                </span>
              )}
            </form>
          )}
        </span>
      )}
    </span>
  );
}
