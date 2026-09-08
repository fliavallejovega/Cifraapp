import { Button, Field, Input, Select } from '@app/ui';

/**
 * The simulator's controls, as a plain GET form.
 *
 * The parameters end up in the URL, which makes a simulation a link — and «look
 * at what happens if we put $600 a month at this» is a conversation between two
 * people, not a private calculation. No client state, no JavaScript.
 */
export function SimulatorForm({
  currencySymbol,
  current,
  labels,
}: {
  readonly currencySymbol: string;
  readonly current: { readonly monthly: string; readonly strategy: string };
  readonly labels: {
    readonly monthly: string;
    readonly monthlyHint: string;
    readonly strategy: string;
    readonly submit: string;
    readonly strategies: Readonly<Record<string, string>>;
  };
}) {
  return (
    <form method="get" className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={labels.monthly} hint={labels.monthlyHint} required>
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
                name="monthly"
                numeric
                inputMode="decimal"
                required
                defaultValue={current.monthly}
                aria-describedby={describedBy}
                className="pl-8"
              />
            </div>
          )}
        </Field>

        <Field label={labels.strategy}>
          {({ id }) => (
            <Select id={id} name="strategy" defaultValue={current.strategy}>
              {(['avalanche', 'snowball', 'hybrid', 'custom'] as const).map((value) => (
                <option key={value} value={value}>
                  {labels.strategies[value] ?? value}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Button type="submit" className="self-start">
        {labels.submit}
      </Button>
    </form>
  );
}
