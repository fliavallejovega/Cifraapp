'use client';

import { Button, Card, Field, Select, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { linkCardDigits } from '@/server/import-actions';

/**
 * «PAGO VISA 4468» and no card ending in 4468: the bank printed the first four
 * digits, the household stored the last four. Saved like that, every payment
 * is an expense and the card's debt never goes down. One choice per set of
 * digits fixes those payments and every statement after them.
 */

export interface UnmatchedGroup {
  readonly digits: string;
  readonly example: string;
  readonly count: number;
  readonly total: ReactNode;
}

export interface CardOption {
  readonly accountId: string;
  readonly label: string;
  readonly network: string | null;
}

export function CardLinks({
  groups,
  cards,
  locale,
}: {
  readonly groups: readonly UnmatchedGroup[];
  readonly cards: readonly CardOption[];
  readonly locale: string;
}) {
  const t = useTranslations('cardLinks');
  if (groups.length === 0) return null;
  return (
    <Card tone="sunk">
      <h2 className="text-base font-medium text-balance">{t('title', { count: groups.length })}</h2>
      <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('detail')}
      </p>
      <ul className="mt-4 flex list-none flex-col gap-4 p-0">
        {groups.map((group) => (
          <Group key={group.digits} group={group} cards={cards} locale={locale} />
        ))}
      </ul>
    </Card>
  );
}

function Group({
  group,
  cards,
  locale,
}: {
  readonly group: UnmatchedGroup;
  readonly cards: readonly CardOption[];
  readonly locale: string;
}) {
  const t = useTranslations('cardLinks');
  const router = useRouter();
  const [pending, start] = useTransition();
  // Pre-chosen: a card of the network the bank printed («PAGO VISA …»).
  const printed = /master/i.test(group.example)
    ? 'mastercard'
    : /visa/i.test(group.example)
      ? 'visa'
      : /amex|american/i.test(group.example)
        ? 'amex'
        : null;
  const guess =
    cards.find((card) => printed !== null && card.network === printed) ??
    cards.find((card) => printed !== null && card.label.toLowerCase().includes(printed)) ??
    cards[0];
  const [accountId, setAccountId] = useState(guess?.accountId ?? '');
  const [result, setResult] = useState<{ linked?: number; error?: string } | null>(null);
  const chosen = cards.find((card) => card.accountId === accountId);

  return (
    <li className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
          {t('digits', { digits: group.digits })}
        </p>
        <span className="shrink-0">{group.total}</span>
      </div>
      <p className="text-xs [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
        {t('seen', { count: group.count, example: group.example })}
      </p>

      {result?.linked !== undefined ? (
        <Status tone="positive">
          {t('linked', { count: result.linked, card: chosen?.label ?? '' })}
        </Status>
      ) : (
        <>
          {cards.length > 0 && (
            <Field label={t('which')} hint={t('whichHint')}>
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  className="h-11"
                  aria-describedby={describedBy}
                  value={accountId}
                  onChange={(event) => {
                    setAccountId(event.target.value);
                  }}
                >
                  {cards.map((card) => (
                    <option key={card.accountId} value={card.accountId}>
                      {card.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {cards.length > 0 && (
              <Button
                size="md"
                className="min-h-11"
                loading={pending}
                disabled={!accountId}
                onClick={() => {
                  setResult(null);
                  start(async () => {
                    const outcome = await linkCardDigits({
                      digits: group.digits,
                      accountId,
                      locale,
                    });
                    setResult(outcome);
                    if (outcome.linked !== undefined) router.refresh();
                  });
                }}
              >
                {t('link', { card: chosen?.label ?? '' })}
              </Button>
            )}
            <Link
              href="/cards"
              className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
            >
              {t('register')}
            </Link>
          </div>
          {result?.error && <Status tone="negative">{t('failed')}</Status>}
        </>
      )}
    </li>
  );
}
