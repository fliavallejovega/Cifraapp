'use client';

import { Button, Card, Field, Input, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ClientTodo } from '@/lib/rumbo-types';
import { setTodoStatus } from '@/server/rumbo-actions';

import { useTripAction } from '../trips/use-trip-action';

/**
 * Everything to buy or book, grouped by country, soonest deadline first.
 * «Abrir» goes to the official page; «Ya lo compré» keeps the booking number
 * (never card details) and moves the item to the bottom of its group.
 */
export function TodoList({
  tripId,
  todos,
}: {
  readonly tripId: string;
  readonly todos: readonly ClientTodo[];
}) {
  const t = useTranslations('rumbo.todos');
  if (todos.length === 0) {
    return (
      <Card>
        <p className="text-[color:var(--color-ink-secondary)]">{t('empty')}</p>
      </Card>
    );
  }
  const groups = new Map<string, ClientTodo[]>();
  for (const todo of todos) {
    const key = todo.countryName;
    groups.set(key, [...(groups.get(key) ?? []), todo]);
  }
  return (
    <div className="flex flex-col gap-6">
      {[...groups.entries()].map(([country, items]) => (
        <Card key={country} padding="lg">
          <h3 className="mb-2 text-lg font-medium">{country}</h3>
          <ul className="flex flex-col">
            {[...items]
              .sort((a, b) => Number(a.status === 'bought') - Number(b.status === 'bought'))
              .map((todo) => (
                <TodoRow key={todo.key} tripId={tripId} todo={todo} />
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function TodoRow({ tripId, todo }: { readonly tripId: string; readonly todo: ClientTodo }) {
  const t = useTranslations('rumbo.todos');
  const te = useTranslations('rumbo.errors');
  const { run, pending, error } = useTripAction();
  const [marking, setMarking] = useState(false);
  const [code, setCode] = useState(todo.confirmationCode ?? '');
  const bought = todo.status === 'bought';

  return (
    <li className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className={bought ? 'text-[color:var(--color-ink-secondary)]' : 'font-medium'}>
            {todo.title}
          </span>
          {todo.reason && (
            <span className="text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {todo.reason}
            </span>
          )}
          <span className="flex flex-wrap items-center gap-2 text-sm">
            {bought ? (
              <Status tone="positive">
                {t('bought')}
                {todo.confirmationCode ? ` · ${todo.confirmationCode}` : ''}
              </Status>
            ) : todo.overdue && todo.due ? (
              <Status tone="signal">{t('overdue', { date: todo.due })}</Status>
            ) : todo.due ? (
              <Status tone="neutral">{t('due', { date: todo.due })}</Status>
            ) : null}
            {todo.saleOpens && !bought && <Status tone="caution">{todo.saleOpens}</Status>}
            {todo.certaintyLabel && (
              <span className="text-[color:var(--color-ink-secondary)]">{todo.certaintyLabel}</span>
            )}
          </span>
          {todo.source && (
            <a
              href={todo.source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center self-start text-xs text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4"
            >
              {todo.source.name} · {todo.source.checked}
            </a>
          )}
          {todo.orphaned && (
            <span className="text-xs text-[color:var(--color-ink-secondary)]">{t('orphaned')}</span>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-4">
          {todo.url && !bought && (
            <a
              href={todo.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center rounded-(--radius-md) border border-[color:var(--color-rule-strong)] px-4 text-sm font-medium hover:border-[color:var(--color-ink)]"
            >
              {t('open')}
            </a>
          )}
          {bought ? (
            <Button
              className="min-h-11"
              variant="ghost"
              size="sm"
              loading={pending}
              onClick={() => {
                run(() => setTodoStatus({ tripId, key: todo.key, status: 'pending' }));
              }}
            >
              {t('undo')}
            </Button>
          ) : (
            !marking && (
              <Button
                className="min-h-11"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setMarking(true);
                }}
              >
                {t('markBought')}
              </Button>
            )
          )}
        </div>
      </div>
      {marking && !bought && (
        <form
          className="flex flex-wrap items-end gap-4 rounded-(--radius-md) bg-[color:var(--color-ground-sunk)] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                setTodoStatus({
                  tripId,
                  key: todo.key,
                  status: 'bought',
                  confirmationCode: code.trim() || null,
                }),
              () => {
                setMarking(false);
              },
            );
          }}
        >
          <Field
            label={t('code')}
            hint={t('codeHint')}
            {...(error ? { error: te(error) } : {})}
            className="min-w-0 flex-1"
          >
            {({ id, describedBy, invalid }) => (
              <Input
                className="min-h-11"
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                autoComplete="off"
                maxLength={60}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                }}
              />
            )}
          </Field>
          <Button className="min-h-11" type="submit" loading={pending}>
            {t('saveBought')}
          </Button>
        </form>
      )}
    </li>
  );
}
