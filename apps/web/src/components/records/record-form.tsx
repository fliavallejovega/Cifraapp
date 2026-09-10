'use client';

import { Button, Problem } from '@app/ui';
import { useActionState, useState } from 'react';

import { RecordFieldset } from './record-fieldset';
import type {
  FieldSpec,
  RecordAction,
  RecordActionResult,
  RecordLabels,
  RecordValues,
} from './spec';

/**
 * The form half of a managed record.
 *
 * Every field is pre-filled when editing, because the whole reason these
 * screens exist is that a household could state a figure once and never correct
 * it. A form that opened blank on «edit» would be a second way to lose the
 * value, not a way to fix it.
 *
 * Money and rates are text inputs with `inputMode="decimal"`, never
 * `type="number"`. A number input rounds, exposes a spinner nobody wants on a
 * balance, and hands the value back through a path that has been the source of
 * float bugs in every financial product that has tried it.
 */

export interface RecordFormProps {
  readonly locale: string;
  readonly fields: readonly FieldSpec[];
  readonly labels: RecordLabels;
  readonly currencySymbol: string;
  readonly create: RecordAction;
  readonly update: RecordAction;
  /** Present when editing an existing row. */
  readonly record?: { readonly id: string; readonly values: RecordValues };
  readonly onDone?: () => void;
  /** Extra hidden inputs the screen needs on every submission. */
  readonly context?: Readonly<Record<string, string>>;
}

export function RecordForm({
  locale,
  fields,
  labels,
  currencySymbol,
  create,
  update,
  record,
  onDone,
  context,
}: RecordFormProps) {
  const editing = record !== undefined;
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    editing ? update : create,
    {},
  );

  /**
   * Lo que vale cada campo que controla a otros.
   *
   * Sólo los campos nombrados en algún `showWhen` entran aquí: seguir el resto
   * volvería a renderizar el formulario en cada tecla de un monto, para nada.
   * Se siembra con lo que trae la fila al editar y con la primera opción al
   * crear, que es lo que el navegador va a tener seleccionado.
   */
  const controllers = new Set(
    fields.map((field) => field.showWhen?.field).filter((name): name is string => name !== undefined),
  );

  const [values, setValues] = useState<RecordValues>(() =>
    Object.fromEntries(
      fields
        .filter((field) => controllers.has(field.name))
        .map((field) => [
          field.name,
          record?.values[field.name] ??
            (field.kind === 'select' ? (field.options[0]?.value ?? '') : ''),
        ]),
    ),
  );

  /**
   * Un campo se enseña si nadie lo condiciona, o si su condición se cumple.
   *
   * Y lo que no se enseña no se envía: el navegador no incluye en el formulario
   * lo que no está en el DOM. Cambiar una tarjeta a hipoteca borra su límite en
   * vez de dejarlo guardado donde nadie lo vuelve a ver.
   */
  const visible = fields.filter(
    (field) => !field.showWhen || field.showWhen.is.includes(values[field.showWhen.field] ?? ''),
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {editing && <input type="hidden" name="id" value={record.id} />}
      {Object.entries(context ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {visible.map((field) => (
          <div key={field.name} className={field.half ? '' : 'sm:col-span-2'}>
            <RecordFieldset
              field={field}
              currencySymbol={currencySymbol}
              value={record?.values[field.name] ?? ''}
              {...(controllers.has(field.name)
                ? {
                    onChange: (name: string, next: string) => {
                      setValues((current) => ({ ...current, [name]: next }));
                    },
                  }
                : {})}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} size="lg">
          {editing ? labels.submitUpdate : labels.submitCreate}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {labels.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}
