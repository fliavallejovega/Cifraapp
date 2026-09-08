'use client';

import { Field, Input, Select } from '@app/ui';

import type { FieldSpec } from './spec';

/**
 * One field, rendered for what it *means* rather than for what it looks like.
 *
 * `money` is the case that justifies the whole indirection. It is not a number
 * input with a currency symbol glued on: `type="number"` rounds, offers a
 * spinner nobody wants on a balance, and hands the value back through a path
 * that has produced float bugs in every financial product that has tried it. A
 * money field is text, `inputMode="decimal"`, parsed once on the server by the
 * one function that knows both keyboard conventions.
 *
 * Shared by the managed-list form and the settings form, so a date is picked
 * the same way in both and a household never has to learn a field twice.
 */
export function RecordFieldset({
  field,
  currencySymbol,
  value,
}: {
  readonly field: FieldSpec;
  readonly currencySymbol: string;
  readonly value: string;
}) {
  if (field.kind === 'toggle') {
    // A checkbox carries its own label, so `Field`'s label would say the same
    // thing twice. The legend states what is being decided; the box states what
    // ticking it means.
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-[color:var(--color-ink)]">{field.label}</legend>
        <label className="flex items-start gap-2.5 text-sm text-[color:var(--color-ink-secondary)]">
          <input
            type="checkbox"
            name={field.name}
            value="true"
            defaultChecked={value === 'true'}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-brand)]"
          />
          <span>{field.toggleLabel}</span>
        </label>
        {field.hint && (
          <p className="text-xs text-[color:var(--color-ink-tertiary)]">{field.hint}</p>
        )}
      </fieldset>
    );
  }

  const hint = field.hint;

  return (
    <Field
      label={field.label}
      {...(hint ? { hint } : {})}
      {...(field.required ? { required: true } : {})}
    >
      {({ id, describedBy }) => {
        const shared = {
          id,
          name: field.name,
          defaultValue: value,
          'aria-describedby': describedBy,
          ...(field.required ? { required: true } : {}),
        } as const;

        switch (field.kind) {
          case 'select':
            return <Select {...shared}>{renderOptions(field.options)}</Select>;

          case 'money':
            return (
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
                >
                  {currencySymbol}
                </span>
                <Input
                  {...shared}
                  numeric
                  inputMode="decimal"
                  placeholder="0.00"
                  className="pl-8"
                />
              </div>
            );

          case 'rate':
            return (
              <div className="relative">
                <Input {...shared} numeric inputMode="decimal" placeholder="0.0" className="pr-9" />
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
                >
                  {field.suffix}
                </span>
              </div>
            );

          case 'integer':
            return (
              <Input
                {...shared}
                numeric
                inputMode="numeric"
                {...(field.placeholder ? { placeholder: field.placeholder } : {})}
                className="max-w-32 text-left"
              />
            );

          case 'date':
            // A native date input, because a financial date is typed rarely and
            // has to be unambiguous: 03/04 is two different days on two sides
            // of an ocean, and a picker cannot be misread.
            return <Input {...shared} type="date" className="max-w-52" />;

          case 'note':
            return (
              <textarea
                {...shared}
                rows={3}
                maxLength={field.maxLength ?? 500}
                className="w-full rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] bg-[color:var(--color-surface)] px-3 py-2.5 text-sm text-[color:var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[color:var(--color-brand)]"
              />
            );

          case 'text':
          default:
            return (
              <Input
                {...shared}
                maxLength={field.maxLength ?? 120}
                {...(field.placeholder ? { placeholder: field.placeholder } : {})}
              />
            );
        }
      }}
    </Field>
  );
}

function renderOptions(options: readonly { value: string; label: string; group?: string }[]) {
  const grouped = options.some((option) => option.group !== undefined);
  if (!grouped) {
    return options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ));
  }

  const groups: string[] = [];
  for (const option of options) {
    const key = option.group ?? '';
    if (!groups.includes(key)) groups.push(key);
  }

  return groups.map((group) => (
    <optgroup key={group} label={group}>
      {options
        .filter((option) => (option.group ?? '') === group)
        .map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
    </optgroup>
  ));
}
