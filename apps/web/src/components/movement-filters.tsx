import { Button, Field, Input, Select } from '@app/ui';

/**
 * The filter bar, as a plain GET form.
 *
 * No client state, no JavaScript, no server action: submitting navigates to the
 * same route with the fields as query parameters, and the page re-renders from
 * the database with the new predicate. The filters are therefore in the URL,
 * which is what makes «send me the link to that search» work, makes the back
 * button behave, and makes a filtered view bookmarkable.
 *
 * A client-side filter would have been faster to type and would have had to
 * hold the whole ledger in memory to be correct.
 */

export interface MovementFilterOption {
  readonly value: string;
  readonly label: string;
}

export interface MovementFiltersProps {
  readonly labels: {
    readonly query: string;
    readonly queryHint: string;
    readonly account: string;
    readonly allAccounts: string;
    readonly category: string;
    readonly allCategories: string;
    readonly uncategorized: string;
    readonly from: string;
    readonly to: string;
    readonly min: string;
    readonly max: string;
    readonly direction: string;
    readonly allDirections: string;
    readonly inflow: string;
    readonly outflow: string;
    readonly status: string;
    readonly allStatuses: string;
    readonly apply: string;
    readonly clear: string;
  };
  readonly accounts: readonly MovementFilterOption[];
  readonly categories: readonly MovementFilterOption[];
  readonly statuses: readonly MovementFilterOption[];
  readonly current: {
    readonly q: string;
    readonly account: string;
    readonly category: string;
    readonly from: string;
    readonly to: string;
    readonly min: string;
    readonly max: string;
    readonly direction: string;
    readonly status: string;
  };
  readonly hasFilters: boolean;
  readonly clearHref: string;
  readonly currencySymbol: string;
}

export function MovementFilters({
  labels,
  accounts,
  categories,
  statuses,
  current,
  hasFilters,
  clearHref,
  currencySymbol,
}: MovementFiltersProps) {
  return (
    <form method="get" className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label={labels.query} hint={labels.queryHint}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="q"
                type="search"
                defaultValue={current.q}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </div>

        <Field label={labels.account}>
          {({ id }) => (
            <Select id={id} name="account" defaultValue={current.account}>
              <option value="">{labels.allAccounts}</option>
              {accounts.map((account) => (
                <option key={account.value} value={account.value}>
                  {account.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={labels.category}>
          {({ id }) => (
            <Select id={id} name="category" defaultValue={current.category}>
              <option value="">{labels.allCategories}</option>
              <option value="none">{labels.uncategorized}</option>
              {categories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={labels.direction}>
          {({ id }) => (
            <Select id={id} name="direction" defaultValue={current.direction}>
              <option value="">{labels.allDirections}</option>
              <option value="inflow">{labels.inflow}</option>
              <option value="outflow">{labels.outflow}</option>
            </Select>
          )}
        </Field>

        <Field label={labels.from}>
          {({ id }) => <Input id={id} name="from" type="date" defaultValue={current.from} />}
        </Field>

        <Field label={labels.to}>
          {({ id }) => <Input id={id} name="to" type="date" defaultValue={current.to} />}
        </Field>

        <Field label={labels.status}>
          {({ id }) => (
            <Select id={id} name="status" defaultValue={current.status}>
              <option value="">{labels.allStatuses}</option>
              {statuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={labels.min}>
          {({ id }) => (
            <AmountInput id={id} name="min" value={current.min} symbol={currencySymbol} />
          )}
        </Field>

        <Field label={labels.max}>
          {({ id }) => (
            <AmountInput id={id} name="max" value={current.max} symbol={currencySymbol} />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{labels.apply}</Button>
        {hasFilters && (
          <a
            href={clearHref}
            className="text-sm font-medium text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
          >
            {labels.clear}
          </a>
        )}
      </div>
    </form>
  );
}

function AmountInput({
  id,
  name,
  value,
  symbol,
}: {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly symbol: string;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
      >
        {symbol}
      </span>
      <Input
        id={id}
        name={name}
        numeric
        inputMode="decimal"
        placeholder="0.00"
        defaultValue={value}
        className="pl-8"
      />
    </div>
  );
}
