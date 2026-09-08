import { Money, type MoneyLocale } from '@app/domain';
import {
  Amount,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Provenance,
  Status,
} from '@app/ui';
import type { ReactNode } from 'react';

/**
 * The product's surfaces, on demonstration data, for the home page.
 *
 * Each is the real component the product uses, so the page cannot drift from
 * the product and the two themes come for free. The figures are the
 * demonstration household's and are consistent from device to device.
 */

/** A raised surface for a device, with the same radius the hero panel uses. */
export function Frame({
  caption,
  children,
  className = '',
}: {
  readonly caption?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[1.75rem] border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] shadow-(--shadow-sheet) ${className}`}
    >
      {caption && (
        <p className="border-b border-[color:var(--color-rule)] px-6 py-4 text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
          {caption}
        </p>
      )}
      <div className="relative overflow-x-auto p-2 sm:p-4">{children}</div>
    </div>
  );
}

export function ImportDevice({
  locale,
  minimum,
  labels,
}: {
  readonly locale: MoneyLocale;
  readonly minimum: Money;
  readonly labels: Record<string, string>;
}) {
  const usd = (value: string) => Money.fromDecimalString(value, 'USD');
  return (
    <Frame caption={labels['caption'] ?? ''}>
      <Ledger>
        <LedgerHead>
          <LedgerColumn>{labels['movement'] ?? ''}</LedgerColumn>
          <LedgerColumn align="end">{labels['amount'] ?? ''}</LedgerColumn>
          <LedgerColumn>{labels['result'] ?? ''}</LedgerColumn>
        </LedgerHead>
        <LedgerBody>
          <LedgerRow>
            <LedgerCell>{labels['cardPayment'] ?? ''}</LedgerCell>
            <LedgerCell align="end">
              <Amount value={minimum.negate()} locale={locale} size="sm" tone="plain" />
            </LedgerCell>
            <LedgerCell>
              <Status tone="neutral">{labels['transfer'] ?? ''}</Status>
            </LedgerCell>
          </LedgerRow>
          <LedgerRow>
            <LedgerCell>{labels['grocery'] ?? ''}</LedgerCell>
            <LedgerCell align="end">
              <Amount value={usd('86.40').negate()} locale={locale} size="sm" tone="plain" />
            </LedgerCell>
            <LedgerCell>
              <Provenance
                source="rule"
                label={labels['groceryCategory'] ?? ''}
                confidence="high"
                confidenceLabel={labels['high'] ?? ''}
              />
            </LedgerCell>
          </LedgerRow>
          <LedgerRow>
            <LedgerCell>{labels['ride'] ?? ''}</LedgerCell>
            <LedgerCell align="end">
              <Amount value={usd('6.75').negate()} locale={locale} size="sm" tone="plain" />
            </LedgerCell>
            <LedgerCell>
              <Provenance
                source="system"
                label={labels['rideCategory'] ?? ''}
                confidence="high"
                confidenceLabel={labels['high'] ?? ''}
              />
            </LedgerCell>
          </LedgerRow>
          <LedgerRow>
            <LedgerCell secondary>{labels['grocery'] ?? ''}</LedgerCell>
            <LedgerCell align="end" secondary>
              <Amount value={usd('86.40').negate()} locale={locale} size="sm" tone="plain" />
            </LedgerCell>
            <LedgerCell>
              <Status tone="caution">{labels['duplicate'] ?? ''}</Status>
            </LedgerCell>
          </LedgerRow>
        </LedgerBody>
      </Ledger>
    </Frame>
  );
}

export function PlanDevice({
  locale,
  lines,
  labels,
}: {
  readonly locale: MoneyLocale;
  readonly lines: readonly { key: string; amount: Money }[];
  readonly labels: Record<string, string>;
}) {
  return (
    <Frame caption={labels['caption'] ?? ''}>
      <Ledger>
        <LedgerHead>
          <LedgerColumn>{labels['line'] ?? ''}</LedgerColumn>
          <LedgerColumn>{labels['why'] ?? ''}</LedgerColumn>
          <LedgerColumn align="end">{labels['amount'] ?? ''}</LedgerColumn>
        </LedgerHead>
        <LedgerBody>
          {lines.map((line, index) => (
            <LedgerRow key={line.key}>
              <LedgerCell>
                <span className="gradation-label mr-3">{index + 1}</span>
                {labels[line.key] ?? ''}
              </LedgerCell>
              <LedgerCell secondary>{labels[`${line.key}Why`] ?? ''}</LedgerCell>
              <LedgerCell align="end">
                <Amount value={line.amount} locale={locale} size="sm" tone="plain" />
              </LedgerCell>
            </LedgerRow>
          ))}
          <LedgerRow>
            <LedgerCell>
              <span className="font-medium">{labels['total'] ?? ''}</span>
            </LedgerCell>
            <LedgerCell secondary>{''}</LedgerCell>
            <LedgerCell align="end">
              <Amount
                value={Money.sum(
                  lines.map((line) => line.amount),
                  'USD',
                )}
                locale={locale}
                size="sm"
                tone="plain"
              />
            </LedgerCell>
          </LedgerRow>
        </LedgerBody>
      </Ledger>
    </Frame>
  );
}

export function DebtDevice({
  locale,
  outcomes,
  labels,
}: {
  readonly locale: MoneyLocale;
  readonly outcomes: readonly {
    key: string;
    months: number;
    interest: Money;
    monthsLabel: string;
  }[];
  readonly labels: Record<string, string>;
}) {
  return (
    <Frame caption={labels['caption'] ?? ''}>
      <Ledger>
        <LedgerHead>
          <LedgerColumn>{labels['strategy'] ?? ''}</LedgerColumn>
          <LedgerColumn align="end">{labels['months'] ?? ''}</LedgerColumn>
          <LedgerColumn align="end">{labels['interest'] ?? ''}</LedgerColumn>
        </LedgerHead>
        <LedgerBody>
          {outcomes.map((outcome) => (
            <LedgerRow key={outcome.key}>
              <LedgerCell>{labels[outcome.key] ?? ''}</LedgerCell>
              <LedgerCell align="end">
                <span className="tabular">{outcome.monthsLabel}</span>
              </LedgerCell>
              <LedgerCell align="end">
                <Amount value={outcome.interest} locale={locale} size="sm" tone="plain" />
              </LedgerCell>
            </LedgerRow>
          ))}
        </LedgerBody>
      </Ledger>
    </Frame>
  );
}

export function TaxDevice({
  locale,
  invoice,
  reserve,
  labels,
}: {
  readonly locale: MoneyLocale;
  readonly invoice: Money;
  readonly reserve: Money;
  readonly labels: Record<string, string>;
}) {
  return (
    <Frame caption={labels['caption'] ?? ''}>
      <Ledger>
        <LedgerBody>
          <LedgerRow>
            <LedgerCell>{labels['invoice'] ?? ''}</LedgerCell>
            <LedgerCell align="end">
              <Amount value={invoice} locale={locale} size="sm" tone="plain" />
            </LedgerCell>
          </LedgerRow>
          <LedgerRow>
            <LedgerCell>
              {labels['reserve'] ?? ''}
              <span className="mt-1 block text-xs text-[color:var(--color-ink-tertiary)]">
                {labels['reserveWhy'] ?? ''}
              </span>
            </LedgerCell>
            <LedgerCell align="end">
              <Amount value={reserve.negate()} locale={locale} size="sm" tone="plain" />
            </LedgerCell>
          </LedgerRow>
          <LedgerRow>
            <LedgerCell>
              <span className="font-medium">{labels['yours'] ?? ''}</span>
            </LedgerCell>
            <LedgerCell align="end">
              <Amount value={invoice.subtract(reserve)} locale={locale} size="sm" tone="plain" />
            </LedgerCell>
          </LedgerRow>
        </LedgerBody>
      </Ledger>
    </Frame>
  );
}

export function GoalsDevice({
  locale,
  rows,
  labels,
}: {
  readonly locale: MoneyLocale;
  readonly rows: readonly { key: string; monthly: Money }[];
  readonly labels: Record<string, string>;
}) {
  return (
    <Frame caption={labels['caption'] ?? ''}>
      <Ledger>
        <LedgerHead>
          <LedgerColumn>{labels['level'] ?? ''}</LedgerColumn>
          <LedgerColumn align="end">{labels['monthly'] ?? ''}</LedgerColumn>
        </LedgerHead>
        <LedgerBody>
          {rows.map((row) => (
            <LedgerRow key={row.key}>
              <LedgerCell>{labels[row.key] ?? ''}</LedgerCell>
              <LedgerCell align="end">
                <Amount value={row.monthly} locale={locale} size="sm" tone="plain" />
              </LedgerCell>
            </LedgerRow>
          ))}
        </LedgerBody>
      </Ledger>
    </Frame>
  );
}

export function ChatDevice({
  question,
  answer,
  grounded,
  caption,
}: {
  readonly question: string;
  readonly answer: string;
  readonly grounded: string;
  readonly caption: string;
}) {
  return (
    <Frame caption={caption}>
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <p className="ml-auto max-w-[32ch] rounded-[1.25rem] rounded-br-md bg-[color:var(--color-ink)] px-5 py-3 text-sm text-[color:var(--color-ground)]">
          {question}
        </p>
        <p className="max-w-[48ch] rounded-[1.25rem] rounded-bl-md bg-[color:var(--color-ground-sunk)] px-5 py-4 text-sm/6 text-pretty">
          {answer}
        </p>
        <div>
          <Status tone="positive">{grounded}</Status>
        </div>
      </div>
    </Frame>
  );
}
