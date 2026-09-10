'use client';

import { Button, Card, EmptyState, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState, useEffect, useState, type ReactNode } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import {
  addCardBenefit,
  adoptCatalogueBenefit,
  archiveCard,
  createCard,
  removeCardBenefit,
  updateCard,
} from '@/server/card-actions';

/**
 * Todo lo que se hace con una tarjeta, en la pantalla de las tarjetas.
 *
 * Antes estaba repartido: la deuda se editaba en Deudas, la cuenta en Cuentas,
 * el estado de cuenta se subía en Importar eligiendo de una lista de todas las
 * cuentas del hogar. Nadie piensa en su tarjeta como tres sitios.
 *
 * ## Un panel por tarjeta, tres pestañas
 *
 * **Datos** —nombre, red, cupo, anualidad, últimos cuatro, saldo, tasa, mínimo,
 * fechas—, **beneficios**, y **estado de cuenta**. Sólo una tarjeta abierta a la
 * vez: tres formularios abiertos sobre tres tarjetas parecidas es cómo se edita
 * la equivocada.
 *
 * ## Archivar, no borrar
 *
 * Lo que se gastó con esa tarjeta pasó. Una tarjeta cancelada que se lleva sus
 * movimientos deja el mes pasado sin explicación y el año sin cuadrar. Se
 * archiva: deja de sumar, se sigue leyendo.
 */

export type BenefitKind =
  | 'cashback'
  | 'miles'
  | 'points'
  | 'insurance'
  | 'lounge'
  | 'discount'
  | 'waiver'
  | 'other';

export interface CardBenefitRow {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly value: string | null;
  readonly source: string | null;
  readonly expiresOn: string | null;
  readonly isExpired: boolean;
}

/** Una línea del catálogo, con su procedencia intacta. */
export interface CatalogueRow {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly value: string | null;
  readonly program: string | null;
  readonly sourceName: string;
  readonly sourceUrl: string;
  /** Cuándo se leyó, ya formateado. Lo que más pesa al juzgar la línea. */
  readonly capturedOn: string;
  readonly validUntil: string | null;
  readonly reviewBy: string | null;
  readonly notes: string | null;
  readonly isStale: boolean;
}

export interface CardRow {
  readonly accountId: string;
  readonly name: string;
  readonly maskedNumber: string | null;
  readonly network: string | null;
  readonly tier: string | null;
  readonly institutionId: string | null;
  readonly catalogue: readonly CatalogueRow[];
  readonly holderId: string | null;
  readonly balance: string;
  readonly apr: string;
  readonly minimumPayment: string;
  readonly creditLimit: string;
  readonly annualFee: string;
  readonly statementDay: string;
  readonly dueDay: string;
  readonly benefits: readonly CardBenefitRow[];
  readonly isArchived: boolean;
}

export interface CardsManagerLabels {
  readonly manage: string;
  readonly close: string;
  readonly tabs: { readonly data: string; readonly benefits: string; readonly statement: string };
  readonly form: {
    readonly name: string;
    readonly nameHint: string;
    readonly network: string;
    readonly networkNone: string;
    readonly networks: Readonly<Record<string, string>>;
    readonly tier: string;
    readonly tierNone: string;
    readonly tiers: Readonly<Record<string, string>>;
    readonly issuer: string;
    readonly issuerNone: string;
    readonly issuerHint: string;
    readonly mask: string;
    readonly maskHint: string;
    readonly balance: string;
    readonly balanceHint: string;
    readonly apr: string;
    readonly minimum: string;
    readonly limit: string;
    readonly limitHint: string;
    readonly annualFee: string;
    readonly annualFeeHint: string;
    readonly statementDay: string;
    readonly statementDayHint: string;
    readonly dueDay: string;
    readonly dueDayHint: string;
    readonly person: string;
    readonly personHousehold: string;
    readonly save: string;
    readonly create: string;
    readonly cancel: string;
    readonly archive: string;
    readonly archiveConfirm: string;
    readonly archiveConfirmYes: string;
  };
  readonly benefits: {
    readonly title: string;
    readonly detail: string;
    readonly emptyTitle: string;
    readonly emptyBody: string;
    readonly kind: string;
    readonly kinds: Readonly<Record<BenefitKind, string>>;
    readonly label: string;
    readonly labelHint: string;
    readonly value: string;
    readonly valueHint: string;
    readonly source: string;
    readonly sourceHint: string;
    readonly expires: string;
    readonly expiresHint: string;
    readonly add: string;
    readonly remove: string;
    readonly expired: string;
    readonly noCatalogue: string;
    readonly catalogue: {
      readonly title: string;
      readonly detail: string;
      readonly empty: string;
      readonly capturedOn: string;
      readonly validUntil: string;
      readonly reviewBy: string;
      readonly stale: string;
      readonly adopt: string;
      readonly openSource: string;
      readonly warning: string;
    };
  };
  readonly addCard: string;
  readonly addCardTitle: string;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
}

const NETWORKS = ['visa', 'mastercard', 'amex', 'discover', 'other'] as const;
const TIERS = ['classic', 'gold', 'platinum', 'signature', 'infinite', 'black', 'other'] as const;
const BENEFIT_KINDS: readonly BenefitKind[] = [
  'cashback',
  'miles',
  'points',
  'insurance',
  'lounge',
  'discount',
  'waiver',
  'other',
];

export function CardsManager({
  locale,
  currencySymbol,
  people,
  issuers,
  cards,
  labels,
  statementFor,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly people: readonly { readonly id: string; readonly name: string }[];
  /** Los bancos de la lista, para poder decir cuál emite esta tarjeta. */
  readonly issuers: readonly { readonly id: string; readonly name: string }[];
  readonly cards: readonly CardRow[];
  readonly labels: CardsManagerLabels;
  /** El formulario de importación de cada tarjeta, armado en el servidor. */
  readonly statementFor: Readonly<Record<string, ReactNode>>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {cards.map((card) => (
        <div key={card.accountId}>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant={open === card.accountId ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setCreating(false);
                setOpen(open === card.accountId ? null : card.accountId);
              }}
            >
              {open === card.accountId ? labels.close : labels.manage}
            </Button>
          </div>

          {open === card.accountId && (
            <CardPanel
              locale={locale}
              currencySymbol={currencySymbol}
              people={people}
              issuers={issuers}
              card={card}
              labels={labels}
              statement={statementFor[card.accountId]}
              onDone={() => {
                setOpen(null);
              }}
            />
          )}
        </div>
      ))}

      {creating ? (
        <Card>
          <p className="mb-4 text-sm font-medium">{labels.addCardTitle}</p>
          <CardForm
            locale={locale}
            currencySymbol={currencySymbol}
            people={people}
            issuers={issuers}
            card={null}
            labels={labels}
            onDone={() => {
              setCreating(false);
            }}
          />
        </Card>
      ) : (
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setOpen(null);
              setCreating(true);
            }}
          >
            {labels.addCard}
          </Button>
        </div>
      )}
    </div>
  );
}

function CardPanel({
  locale,
  currencySymbol,
  people,
  issuers,
  card,
  labels,
  statement,
  onDone,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly issuers: readonly { readonly id: string; readonly name: string }[];
  readonly card: CardRow;
  readonly labels: CardsManagerLabels;
  readonly statement: ReactNode;
  readonly onDone: () => void;
}) {
  const [tab, setTab] = useState<'data' | 'benefits' | 'statement'>('data');

  const tabs = [
    ['data', labels.tabs.data],
    ['benefits', labels.tabs.benefits],
    ['statement', labels.tabs.statement],
  ] as const;

  return (
    <Card tone="sunk" className="mt-3">
      {/* Pestañas de verdad, con roles: se recorren con las flechas y el lector
          de pantalla dice cuál está activa. Tres botones sueltos no hacen eso. */}
      <div role="tablist" aria-label={labels.manage} className="flex flex-wrap gap-2">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
            }}
            className={`min-h-11 rounded-(--radius-sm) px-3 text-sm transition-colors ${
              tab === key
                ? 'bg-[color:var(--color-surface)] font-medium text-[color:var(--color-ink)] shadow-(--shadow-card)'
                : 'text-[color:var(--color-ink-secondary)] hover:text-[color:var(--color-ink)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'data' && (
          <CardForm
            locale={locale}
            currencySymbol={currencySymbol}
            people={people}
            issuers={issuers}
            card={card}
            labels={labels}
            onDone={onDone}
          />
        )}
        {tab === 'benefits' && <Benefits locale={locale} card={card} labels={labels} />}
        {tab === 'statement' && <div className="max-w-lg">{statement}</div>}
      </div>
    </Card>
  );
}

function CardForm({
  locale,
  currencySymbol,
  people,
  issuers,
  card,
  labels,
  onDone,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly issuers: readonly { readonly id: string; readonly name: string }[];
  readonly card: CardRow | null;
  readonly labels: CardsManagerLabels;
  readonly onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    card ? updateCard : createCard,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state.ok || state.created) onDone();
  }, [state.ok, state.created, onDone]);

  const money = (name: string, label: string, hint: string | null, value: string) => (
    <Field label={label} {...(hint ? { hint } : {})}>
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
            name={name}
            numeric
            inputMode="decimal"
            defaultValue={value}
            placeholder="0.00"
            aria-describedby={describedBy}
            className="pl-8"
          />
        </div>
      )}
    </Field>
  );

  return (
    <>
      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="locale" value={locale} />
        {card && <input type="hidden" name="id" value={card.accountId} />}

        {state.error && (
          <Problem
            title={labels.errorTitle}
            body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
          />
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={labels.form.name} hint={labels.form.nameHint} required className="sm:col-span-2">
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="name"
                required
                maxLength={120}
                defaultValue={card?.name ?? ''}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field label={labels.form.network}>
            {({ id }) => (
              <Select id={id} name="network" defaultValue={card?.network ?? ''}>
                <option value="">{labels.form.networkNone}</option>
                {NETWORKS.map((network) => (
                  <option key={network} value={network}>
                    {labels.form.networks[network] ?? network}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={labels.form.tier}>
            {({ id }) => (
              <Select id={id} name="tier" defaultValue={card?.tier ?? ''}>
                <option value="">{labels.form.tierNone}</option>
                {TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {labels.form.tiers[tier] ?? tier}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/* El emisor: es lo que permite enseñar los beneficios que ese banco
              publicó y no los de otro. */}
          <Field label={labels.form.issuer} hint={labels.form.issuerHint}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                name="institutionId"
                defaultValue={card?.institutionId ?? ''}
                aria-describedby={describedBy}
              >
                <option value="">{labels.form.issuerNone}</option>
                {issuers.map((issuer) => (
                  <option key={issuer.id} value={issuer.id}>
                    {issuer.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={labels.form.mask} hint={labels.form.maskHint}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="maskedNumber"
                numeric
                inputMode="numeric"
                maxLength={4}
                defaultValue={card?.maskedNumber ?? ''}
                placeholder="0000"
                aria-describedby={describedBy}
              />
            )}
          </Field>

          {money('currentBalance', labels.form.balance, labels.form.balanceHint, card?.balance ?? '')}

          <Field label={labels.form.apr} required>
            {({ id }) => (
              <div className="relative">
                <Input
                  id={id}
                  name="apr"
                  numeric
                  inputMode="decimal"
                  required
                  defaultValue={card?.apr ?? ''}
                  placeholder="0.0"
                  className="pr-8"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
                >
                  %
                </span>
              </div>
            )}
          </Field>

          {money('minimumPayment', labels.form.minimum, null, card?.minimumPayment ?? '')}
          {money('creditLimit', labels.form.limit, labels.form.limitHint, card?.creditLimit ?? '')}
          {money('annualFee', labels.form.annualFee, labels.form.annualFeeHint, card?.annualFee ?? '')}

          <Field label={labels.form.statementDay} hint={labels.form.statementDayHint}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="statementDay"
                numeric
                inputMode="numeric"
                defaultValue={card?.statementDay ?? ''}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field label={labels.form.dueDay} hint={labels.form.dueDayHint}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="dueDay"
                numeric
                inputMode="numeric"
                defaultValue={card?.dueDay ?? ''}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          {people.length > 0 && (
            <Field label={labels.form.person}>
              {({ id }) => (
                <Select id={id} name="personId" defaultValue={card?.holderId ?? ''}>
                  <option value="">{labels.form.personHousehold}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {card ? labels.form.save : labels.form.create}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            {labels.form.cancel}
          </Button>
        </div>
      </form>

      {/* Archivar, aparte del formulario y detrás de una confirmación: es la
          única acción de esta pantalla que quita algo de la vista. */}
      {card && !card.isArchived && (
        <div className="mt-6 border-t border-[color:var(--color-rule)] pt-4">
          {confirming ? (
            <ArchiveForm locale={locale} card={card} labels={labels} onCancel={() => { setConfirming(false); }} />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {labels.form.archive}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function ArchiveForm({
  locale,
  card,
  labels,
  onCancel,
}: {
  readonly locale: string;
  readonly card: CardRow;
  readonly labels: CardsManagerLabels;
  readonly onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    archiveCard,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={card.accountId} />
      <span className="text-sm text-[color:var(--color-ink-secondary)]">
        {labels.form.archiveConfirm}
      </span>
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        {labels.form.archiveConfirmYes}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        {labels.form.cancel}
      </Button>
      {state.error && (
        <span className="text-xs text-[color:var(--color-negative)]">
          {labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        </span>
      )}
    </form>
  );
}

function Benefits({
  locale,
  card,
  labels,
}: {
  readonly locale: string;
  readonly card: CardRow;
  readonly labels: CardsManagerLabels;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    addCardBenefit,
    {},
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {labels.benefits.detail}
      </p>

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      {card.benefits.length === 0 ? (
        <EmptyState title={labels.benefits.emptyTitle} body={labels.benefits.emptyBody} />
      ) : (
        <ul className="flex list-none flex-col p-0">
          {card.benefits.map((benefit) => (
            <li
              key={benefit.id}
              className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-rule)] py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <span
                  className={`text-sm font-medium ${benefit.isExpired ? 'line-through opacity-60' : ''}`}
                >
                  {benefit.label}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--color-ink-secondary)]">
                  <Status tone="neutral">
                    {labels.benefits.kinds[benefit.kind as BenefitKind] ?? benefit.kind}
                  </Status>
                  {benefit.value && <span>{benefit.value}</span>}
                  {benefit.source && (
                    <span className="text-[color:var(--color-ink-tertiary)]">{benefit.source}</span>
                  )}
                  {benefit.isExpired && (
                    <Status tone="caution">{labels.benefits.expired}</Status>
                  )}
                </span>
              </div>
              <RemoveBenefit locale={locale} id={benefit.id} labels={labels} />
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="accountId" value={card.accountId} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={labels.benefits.kind}>
            {({ id }) => (
              <Select id={id} name="kind" defaultValue="cashback">
                {BENEFIT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {labels.benefits.kinds[kind]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={labels.benefits.label} hint={labels.benefits.labelHint} required>
            {({ id, describedBy }) => (
              <Input id={id} name="label" required maxLength={120} aria-describedby={describedBy} />
            )}
          </Field>

          <Field label={labels.benefits.value} hint={labels.benefits.valueHint}>
            {({ id, describedBy }) => (
              <Input id={id} name="value" maxLength={200} aria-describedby={describedBy} />
            )}
          </Field>

          <Field label={labels.benefits.expires} hint={labels.benefits.expiresHint}>
            {({ id, describedBy }) => (
              <Input id={id} name="expiresOn" type="date" aria-describedby={describedBy} />
            )}
          </Field>

          <Field
            label={labels.benefits.source}
            hint={labels.benefits.sourceHint}
            className="sm:col-span-2"
          >
            {({ id, describedBy }) => (
              <Input id={id} name="source" maxLength={200} aria-describedby={describedBy} />
            )}
          </Field>
        </div>

        <div>
          <Button type="submit" size="sm" disabled={pending}>
            {labels.benefits.add}
          </Button>
        </div>
      </form>

      {/*
        El catálogo: lo que el emisor publicó, con cuándo se leyó.

        Va después de lo propio y no antes, a propósito. Lo que la casa
        confirmó de su contrato manda sobre lo que un banco publica en su
        página, y el orden de la pantalla tiene que decir eso sin explicarlo.
      */}
      <section className="border-t border-[color:var(--color-rule)] pt-5">
        <h4 className="text-sm font-medium">{labels.benefits.catalogue.title}</h4>
        <p className="mt-1 max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-secondary)]">
          {labels.benefits.catalogue.detail}
        </p>

        {card.catalogue.length === 0 ? (
          <p className="mt-4 max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
            {labels.benefits.catalogue.empty}
          </p>
        ) : (
          <ul className="mt-4 flex list-none flex-col p-0">
            {card.catalogue.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--color-rule)] py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{entry.label}</span>
                  {entry.value && (
                    <span className="mt-0.5 block text-xs text-pretty text-[color:var(--color-ink-secondary)]">
                      {entry.value}
                    </span>
                  )}
                  {entry.notes && (
                    <span className="mt-1 block text-xs text-pretty text-[color:var(--color-caution)]">
                      {entry.notes}
                    </span>
                  )}

                  {/* La procedencia, completa y a la vista. Es lo que separa
                      esto de una lista inventada, así que no se esconde detrás
                      de un icono ni de un «ver más». */}
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--color-ink-tertiary)]">
                    <Status tone="neutral">
                      {labels.benefits.kinds[entry.kind as BenefitKind] ?? entry.kind}
                    </Status>
                    {entry.program && <span>{entry.program}</span>}
                    <span>
                      {labels.benefits.catalogue.capturedOn.replace('{date}', entry.capturedOn)}
                    </span>
                    {entry.validUntil && (
                      <span>
                        {labels.benefits.catalogue.validUntil.replace('{date}', entry.validUntil)}
                      </span>
                    )}
                    {entry.reviewBy && (
                      <span>
                        {labels.benefits.catalogue.reviewBy.replace('{date}', entry.reviewBy)}
                      </span>
                    )}
                    <a
                      href={entry.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                    >
                      {entry.sourceName}
                    </a>
                    {entry.isStale && (
                      <Status tone="caution">{labels.benefits.catalogue.stale}</Status>
                    )}
                  </span>
                </div>

                <AdoptBenefit
                  locale={locale}
                  accountId={card.accountId}
                  entryId={entry.id}
                  labels={labels}
                />
              </li>
            ))}
          </ul>
        )}

        {/* Lo que el catálogo no es. Debajo de la lista y no encima: quien ya
            leyó las líneas es quien necesita esta advertencia. */}
        <p className="mt-4 max-w-[68ch] text-xs text-pretty text-[color:var(--color-caution)]">
          {labels.benefits.catalogue.warning}
        </p>
        <p className="mt-3 max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
          {labels.benefits.noCatalogue}
        </p>
      </section>
    </div>
  );
}

function RemoveBenefit({
  locale,
  id,
  labels,
}: {
  readonly locale: string;
  readonly id: string;
  readonly labels: CardsManagerLabels;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    removeCardBenefit,
    {},
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {labels.benefits.remove}
      </Button>
      {state.error && (
        <span className="text-xs text-[color:var(--color-negative)]">
          {labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        </span>
      )}
    </form>
  );
}

/**
 * Copiar una línea del catálogo a los beneficios de esta tarjeta.
 *
 * El botón dice «tengo este» y no «agregar», porque lo que se está haciendo es
 * una afirmación sobre el propio contrato y no un movimiento de datos. Quien lo
 * pulsa debería acabar de mirarlo; la advertencia de arriba se lo pide.
 */
function AdoptBenefit({
  locale,
  accountId,
  entryId,
  labels,
}: {
  readonly locale: string;
  readonly accountId: string;
  readonly entryId: string;
  readonly labels: CardsManagerLabels;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    adoptCatalogueBenefit,
    {},
  );

  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="entryId" value={entryId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {labels.benefits.catalogue.adopt}
      </Button>
      {state.error && (
        <span className="mt-1 block text-xs text-[color:var(--color-negative)]">
          {labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        </span>
      )}
    </form>
  );
}
