'use client';

import { Button, Card, EmptyState, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState, useEffect, useState, type ReactNode } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { createManualMovement } from '@/server/movement-actions';
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
 * ## El panel vive dentro de la tarjeta que administra
 *
 * `CardManage` se monta **dentro** del bloque de cada tarjeta y la expande al
 * abrirse. Antes era un botón por tarjeta apilado debajo de la lista entera:
 * tres «Gestionar» sueltos al pie, sin nada que dijera cuál era de cuál. Un
 * control que no toca lo que modifica obliga a contar posiciones.
 *
 * ## Cuatro pestañas
 *
 * **Datos** —nombre, red, nivel, emisor, cupo, anualidad, últimos cuatro, saldo,
 * tasa, mínimo, fechas—, **beneficios**, **ofertas** y **estado de cuenta**.
 *
 * Las ofertas van dentro y no arriba de la pantalla: el tablero de todas las
 * ofertas del mes es su propia sección del producto. Aquí sólo se contesta qué
 * ofertas sirven **con esta tarjeta**, y por eso la pestaña depende de que la
 * red y el emisor estén declarados — sin esos dos datos no hay forma de saber
 * cuál promoción aplica, y la pestaña lo dice en vez de enseñar una lista vacía.
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

/**
 * Una oferta del mes que esta tarjeta puede pagar.
 *
 * Llega ya resuelta desde el servidor —el cruce de emisor, red y tipo lo hace
 * la consulta— y ya formateada, porque lo que cruza a un componente de cliente
 * tiene que poder serializarse. Sin veredicto de «la mejor»: se enseña lo que
 * la fuente escribió y quien decide es quien va a pagar.
 */
export interface CardOfferRow {
  readonly id: string;
  readonly merchantName: string;
  readonly merchantNote: string | null;
  readonly categoryName: string | null;
  readonly headline: string;
  readonly detail: string | null;
  /** El tope, en una frase ya armada: «hasta $125 sobre un consumo de $250». */
  readonly cap: string | null;
  /** Los días con nombre. Vacío es todos los días. */
  readonly weekdayNames: readonly string[];
  readonly validUntil: string | null;
  readonly channel: string | null;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly capturedOn: string;
  readonly isVerified: boolean;
  readonly isToday: boolean;
  /** Los programas que exige, por nombre. Vacío es «no exige ninguno». */
  readonly requiresPrograms: readonly string[];
  /**
   * Verdadero cuando encaja en todo salvo el programa, que la tarjeta no
   * declaró. Ni suya ni ajena: no se sabe, y se enseña diciéndolo.
   */
  readonly isMaybe: boolean;
}

/** Un rubro del hogar, para clasificar un consumo sin salir de la tarjeta. */
export interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

/** Un programa del catálogo, tal como lo ofrece el selector. */
export interface ProgramOption {
  readonly issuerKey: string;
  readonly programKey: string;
  readonly name: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly capturedOn: string;
}

export interface CardRow {
  readonly accountId: string;
  readonly name: string;
  readonly maskedNumber: string | null;
  readonly network: string | null;
  readonly tier: string | null;
  readonly programKey: string | null;
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
  /** Las ofertas del mes que esta tarjeta puede pagar, ya cruzadas. */
  readonly offers: readonly CardOfferRow[];
  /** La deuda que esta tarjeta lleva. Sin ella un pago no baja nada. */
  readonly debtId: string | null;
  /** Lo que se debe hoy, ya formateado. Es la mitad de la frase de un pago. */
  readonly owed: string;
  readonly isArchived: boolean;
}

export interface CardsManagerLabels {
  readonly manage: string;
  readonly close: string;
  readonly tabs: {
    readonly data: string;
    readonly movements: string;
    readonly benefits: string;
    readonly offers: string;
    readonly statement: string;
  };
  readonly form: {
    readonly name: string;
    readonly nameHint: string;
    readonly network: string;
    readonly networkNone: string;
    readonly networks: Readonly<Record<string, string>>;
    readonly tier: string;
    readonly tierNone: string;
    readonly tierHint: string;
    readonly tiers: Readonly<Record<string, string>>;
    readonly issuer: string;
    readonly issuerNone: string;
    readonly issuerHint: string;
    /** Por qué la red, el nivel y el emisor deciden qué ofertas se enseñan. */
    readonly identityNote: string;
    readonly networkHint: string;
    readonly program: string;
    readonly programNone: string;
    readonly programHint: string;
    /** Cuando el emisor todavía no se eligió, no hay lista que ofrecer. */
    readonly programNeedsIssuer: string;
    /** Cuando ese emisor no tiene ningún programa leído. */
    readonly programNoneKnown: string;
    readonly programSource: string;
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
  readonly offers: {
    readonly detail: string;
    readonly emptyTitle: string;
    readonly emptyBody: string;
    /** Cuando falta la red o el emisor no se puede cruzar nada. Se dice. */
    readonly needsTypeTitle: string;
    readonly needsTypeBody: string;
    readonly goToData: string;
    readonly today: string;
    readonly everyDay: string;
    readonly until: string;
    readonly unverified: string;
    readonly capturedOn: string;
    readonly seeAll: string;
    /** «Pide {programs}» — qué programa exige una promoción. */
    readonly requiresProgram: string;
    /** Las que quizá sirven porque el programa de la tarjeta no se declaró. */
    readonly maybeTitle: string;
    readonly maybeBody: string;
    readonly maybeTag: string;
  };
  readonly movements: {
    readonly detail: string;
    /** Los dos actos, nombrados por lo que le hacen a la tarjeta. */
    readonly charge: string;
    readonly chargeHint: string;
    readonly payment: string;
    readonly paymentHint: string;
    readonly amount: string;
    readonly date: string;
    readonly description: string;
    readonly descriptionHint: string;
    readonly category: string;
    readonly categoryNone: string;
    readonly save: string;
    readonly saved: string;
    /** «Baja tu saldo de {balance}» / «Sube tu saldo a …» */
    readonly chargeEffect: string;
    readonly paymentEffect: string;
    readonly noDebt: string;
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

/**
 * El control de una tarjeta, dentro de la tarjeta.
 *
 * Se monta al pie del bloque que describe esa tarjeta y la expande hacia abajo.
 * El estado es suyo y no de la lista: el motivo de abrir una sola a la vez era
 * no editar la equivocada, y eso ya lo resuelve tener el formulario debajo del
 * nombre al que pertenece.
 */
export function CardManage({
  locale,
  currencySymbol,
  people,
  issuers,
  card,
  programs,
  categories,
  today,
  labels,
  statement,
  offersHref,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly people: readonly { readonly id: string; readonly name: string }[];
  /** Los bancos de la lista, para poder decir cuál emite esta tarjeta. */
  readonly issuers: readonly {
    readonly id: string;
    readonly name: string;
    /** La llave del catálogo. Es lo que enlaza el banco con sus programas. */
    readonly key: string | null;
  }[];
  /** El catálogo de programas de lealtad, para el selector. */
  readonly programs: readonly ProgramOption[];
  /** Los rubros del hogar, para clasificar un consumo al anotarlo. */
  readonly categories: readonly CategoryOption[];
  /** La fecha del hogar. Un consumo es de hoy casi siempre. */
  readonly today: string;
  readonly card: CardRow;
  readonly labels: CardsManagerLabels;
  /** El formulario de importación de esta tarjeta, armado en el servidor. */
  readonly statement: ReactNode;
  /** El tablero con todas las ofertas del mes, incluidas las de otros bancos. */
  readonly offersHref: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `card-panel-${card.accountId}`;

  return (
    <div className="mt-5 border-t border-[color:var(--color-rule)] pt-4">
      <Button
        type="button"
        variant={open ? 'secondary' : 'ghost'}
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? labels.close : labels.manage}
      </Button>

      {open && (
        <div id={panelId}>
          <CardPanel
            locale={locale}
            currencySymbol={currencySymbol}
            people={people}
            issuers={issuers}
            programs={programs}
            categories={categories}
            today={today}
            card={card}
            labels={labels}
            statement={statement}
            offersHref={offersHref}
            onDone={() => {
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Agregar una tarjeta.
 *
 * Aparte del panel de cada tarjeta y al final de la lista, que es donde se
 * busca lo que todavía no existe.
 */
export function AddCard({
  locale,
  currencySymbol,
  people,
  issuers,
  programs,
  labels,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly issuers: readonly {
    readonly id: string;
    readonly name: string;
    /** La llave del catálogo. Es lo que enlaza el banco con sus programas. */
    readonly key: string | null;
  }[];
  readonly programs: readonly ProgramOption[];
  readonly labels: CardsManagerLabels;
}) {
  const [creating, setCreating] = useState(false);

  if (!creating) {
    return (
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setCreating(true);
        }}
      >
        {labels.addCard}
      </Button>
    );
  }

  return (
    <Card>
      <p className="mb-4 text-sm font-medium">{labels.addCardTitle}</p>
      <CardForm
        locale={locale}
        currencySymbol={currencySymbol}
        people={people}
        issuers={issuers}
        programs={programs}
        card={null}
        labels={labels}
        onDone={() => {
          setCreating(false);
        }}
      />
    </Card>
  );
}

function CardPanel({
  locale,
  currencySymbol,
  people,
  issuers,
  card,
  programs,
  categories,
  today,
  labels,
  statement,
  offersHref,
  onDone,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly issuers: readonly {
    readonly id: string;
    readonly name: string;
    /** La llave del catálogo. Es lo que enlaza el banco con sus programas. */
    readonly key: string | null;
  }[];
  readonly programs: readonly ProgramOption[];
  readonly categories: readonly CategoryOption[];
  readonly today: string;
  readonly card: CardRow;
  readonly labels: CardsManagerLabels;
  readonly statement: ReactNode;
  readonly offersHref: string;
  readonly onDone: () => void;
}) {
  const [tab, setTab] = useState<'data' | 'movements' | 'benefits' | 'offers' | 'statement'>(
    'data',
  );

  const tabs = [
    ['data', labels.tabs.data],
    ['movements', labels.tabs.movements],
    ['benefits', labels.tabs.benefits],
    ['offers', labels.tabs.offers],
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
            programs={programs}
            card={card}
            labels={labels}
            onDone={onDone}
          />
        )}
        {tab === 'movements' && (
          <CardMovements
            locale={locale}
            currencySymbol={currencySymbol}
            card={card}
            categories={categories}
            today={today}
            labels={labels}
          />
        )}
        {tab === 'benefits' && <Benefits locale={locale} card={card} labels={labels} />}
        {tab === 'offers' && (
          <Offers
            card={card}
            labels={labels}
            offersHref={offersHref}
            onFixType={() => {
              setTab('data');
            }}
          />
        )}
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
  programs,
  card,
  labels,
  onDone,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly issuers: readonly {
    readonly id: string;
    readonly name: string;
    /** La llave del catálogo. Es lo que enlaza el banco con sus programas. */
    readonly key: string | null;
  }[];
  readonly programs: readonly ProgramOption[];
  readonly card: CardRow | null;
  readonly labels: CardsManagerLabels;
  readonly onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    card ? updateCard : createCard,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  /*
    El emisor elegido, en estado, porque de él depende la lista de programas.
    Un selector con los once programas del país obligaría a la casa a saber cuál
    de ellos es de su banco — que es exactamente lo que el catálogo ya sabe.
  */
  const [issuerId, setIssuerId] = useState(card?.institutionId ?? '');
  const issuerKey = issuers.find((issuer) => issuer.id === issuerId)?.key ?? null;
  const forIssuer = issuerKey
    ? programs.filter((program) => program.issuerKey === issuerKey)
    : [];
  const chosen = forIssuer.find((program) => program.programKey === card?.programKey) ?? null;

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

          {/*
            Qué tarjeta es: red, nivel y emisor.

            No son adorno ni clasificación: son los tres datos con los que se
            cruzan las promociones del mes y el catálogo de beneficios. Una
            promoción de Banco General para Visa no se le puede enseñar a quien
            no dijo de qué banco ni de qué red es su tarjeta, y adivinarlo por
            el nombre —«Visa Blei BG»— sería inventar la respuesta. Por eso la
            nota está aquí arriba, donde se contestan, y no escondida en la
            pestaña que las usa.
          */}
          <p className="max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-secondary)] sm:col-span-2">
            {labels.form.identityNote}
          </p>

          <Field label={labels.form.network} hint={labels.form.networkHint}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                name="network"
                defaultValue={card?.network ?? ''}
                aria-describedby={describedBy}
              >
                <option value="">{labels.form.networkNone}</option>
                {NETWORKS.map((network) => (
                  <option key={network} value={network}>
                    {labels.form.networks[network] ?? network}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={labels.form.tier} hint={labels.form.tierHint}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                name="tier"
                defaultValue={card?.tier ?? ''}
                aria-describedby={describedBy}
              >
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
          <Field
            label={labels.form.issuer}
            hint={labels.form.issuerHint}
            className="sm:col-span-2"
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                name="institutionId"
                value={issuerId}
                onChange={(event) => {
                  setIssuerId(event.target.value);
                }}
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

          {/*
            El programa de lealtad: Estrellas, ConnectMiles, Regálate.

            Es lo que distingue dos Visa Platinum del mismo banco. La lista sale
            del catálogo y se filtra por el emisor que se acaba de elegir, así
            que la casa nunca tiene que decidir cuál de los once programas del
            país es el suyo. Y lleva su fuente al lado: un nombre de programa sin
            de dónde salió es una afirmación sin respaldo, igual que cualquier
            otra línea de este catálogo.
          */}
          <Field
            label={labels.form.program}
            {...(forIssuer.length > 0 ? { hint: labels.form.programHint } : {})}
            className="sm:col-span-2"
          >
            {({ id, describedBy }) =>
              issuerKey === null ? (
                <p
                  id={describedBy}
                  className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]"
                >
                  {labels.form.programNeedsIssuer}
                </p>
              ) : forIssuer.length === 0 ? (
                <p
                  id={describedBy}
                  className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]"
                >
                  {labels.form.programNoneKnown}
                </p>
              ) : (
                <>
                  <Select
                    id={id}
                    name="cardProgram"
                    defaultValue={card?.programKey ?? ''}
                    aria-describedby={describedBy}
                  >
                    <option value="">{labels.form.programNone}</option>
                    {forIssuer.map((program) => (
                      <option key={program.programKey} value={program.programKey}>
                        {program.name}
                      </option>
                    ))}
                  </Select>
                  {chosen && (
                    <p className="mt-2 text-xs text-[color:var(--color-ink-tertiary)]">
                      {labels.form.programSource
                        .replace('{source}', chosen.sourceName)
                        .replace('{date}', chosen.capturedOn)}
                    </p>
                  )}
                </>
              )
            }
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

/**
 * Las ofertas del mes que se pagan con esta tarjeta.
 *
 * ## Sin veredicto
 *
 * No hay «la mejor». Se enseña la frase que el banco publicó, el comercio, los
 * días, el tope y de dónde salió; cuál conviene depende de dónde se va a comer
 * y de cuánto se va a gastar, y eso no está en esta pantalla. Poner una corona
 * sobre una de ellas sería afirmar algo que nadie midió.
 *
 * ## Sin la red y el emisor no hay nada que cruzar
 *
 * Y una lista vacía por falta de datos se lee igual que «no hay ofertas», que
 * es falso. Se distingue el caso y se ofrece el camino: la pestaña de datos,
 * que es donde se contesta.
 *
 * ## El resto del mercado no se esconde
 *
 * Al pie, el camino al tablero completo. Saber que el banco de al lado da 50%
 * donde el tuyo no da nada es información, y esta pestaña —que por definición
 * sólo mira una tarjeta— no la puede dar.
 */
function Offers({
  card,
  labels,
  offersHref,
  onFixType,
}: {
  readonly card: CardRow;
  readonly labels: CardsManagerLabels;
  readonly offersHref: string;
  readonly onFixType: () => void;
}) {
  const knowsWhatItIs = card.institutionId !== null && card.network !== null;
  const sure = card.offers.filter((offer) => !offer.isMaybe);
  const maybe = card.offers.filter((offer) => offer.isMaybe);

  if (!knowsWhatItIs) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState title={labels.offers.needsTypeTitle} body={labels.offers.needsTypeBody} />
        <div>
          <Button type="button" size="sm" onClick={onFixType}>
            {labels.offers.goToData}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {labels.offers.detail}
      </p>

      {card.offers.length === 0 ? (
        <EmptyState title={labels.offers.emptyTitle} body={labels.offers.emptyBody} />
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {sure.map((offer) => (
            <li key={offer.id}>
              <Card tone="sunk">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium break-words">{offer.merchantName}</span>
                  {offer.isToday && <Status tone="positive">{labels.offers.today}</Status>}
                </div>

                <p className="mt-1 text-sm text-pretty">{offer.headline}</p>

                {offer.merchantNote && (
                  <p className="mt-1 text-xs text-pretty text-[color:var(--color-ink-secondary)]">
                    {offer.merchantNote}
                  </p>
                )}
                {offer.detail && (
                  <p className="mt-1 text-xs text-pretty text-[color:var(--color-ink-secondary)]">
                    {offer.detail}
                  </p>
                )}
                {/* El tope es la parte que decide si conviene, y la que los
                    bancos ponen en letra chica. Va al mismo tamaño que todo. */}
                {offer.cap && (
                  <p className="mt-1 text-xs text-pretty text-[color:var(--color-ink-secondary)]">
                    {offer.cap}
                  </p>
                )}

                <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--color-ink-tertiary)]">
                  <span>
                    {offer.weekdayNames.length === 0
                      ? labels.offers.everyDay
                      : offer.weekdayNames.join(' · ')}
                  </span>
                  {offer.categoryName && <span>{offer.categoryName}</span>}
                  {offer.channel && <span>{offer.channel}</span>}
                  {offer.validUntil && (
                    <span>{labels.offers.until.replace('{date}', offer.validUntil)}</span>
                  )}
                  <a
                    href={offer.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                  >
                    {offer.sourceName}
                  </a>
                  <span>{labels.offers.capturedOn.replace('{date}', offer.capturedOn)}</span>
                  {/* Qué programa exige, cuando exige alguno. Es lo que separa
                      «doble millas ConnectMiles» de una promoción del banco
                      entero, y sin decirlo la casa no puede juzgar si le toca. */}
                  {offer.requiresPrograms.length > 0 && (
                    <span>
                      {labels.offers.requiresProgram.replace(
                        '{programs}',
                        offer.requiresPrograms.join(' · '),
                      )}
                    </span>
                  )}
                  {offer.isMaybe && <Status tone="signal">{labels.offers.maybeTag}</Status>}
                  {!offer.isVerified && (
                    <Status tone="caution">{labels.offers.unverified}</Status>
                  )}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/*
        Las inciertas, en su propia sección y detrás de las seguras.

        Encajan en banco, red y tipo, pero la promoción pide un programa y esta
        tarjeta no declaró el suyo. Mezclarlas con las seguras afirmaría que son
        suyas; esconderlas escondería promociones que quizá sí puede usar. Van
        aparte, dichas por su nombre, con el camino a resolverlo.
      */}
      {maybe.length > 0 && (
        <section className="border-t border-[color:var(--color-rule)] pt-5">
          <h4 className="text-sm font-medium">{labels.offers.maybeTitle}</h4>
          <p className="mt-1 max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.offers.maybeBody}
          </p>
          <ul className="mt-4 flex list-none flex-col p-0">
            {maybe.map((offer) => (
              <li
                key={offer.id}
                className="border-b border-[color:var(--color-rule)] py-3 last:border-b-0"
              >
                <span className="text-sm font-medium">{offer.merchantName}</span>
                <span className="ml-2 text-sm text-[color:var(--color-ink-secondary)]">
                  {offer.headline}
                </span>
                {offer.requiresPrograms.length > 0 && (
                  <span className="mt-1 block text-xs text-[color:var(--color-ink-tertiary)]">
                    {labels.offers.requiresProgram.replace(
                      '{programs}',
                      offer.requiresPrograms.join(' · '),
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Button type="button" size="sm" variant="secondary" onClick={onFixType}>
              {labels.offers.goToData}
            </Button>
          </div>
        </section>
      )}

      <p className="text-sm">
        <a
          href={offersHref}
          className="underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
        >
          {labels.offers.seeAll}
        </a>
      </p>
    </div>
  );
}

/**
 * Anotar un consumo o un pago, sin salir de la tarjeta.
 *
 * ## Por qué vive aquí y no en otra pantalla
 *
 * Porque es la misma razón por la que el panel entero vive dentro de su
 * tarjeta: un control que no toca lo que modifica obliga a contar posiciones,
 * y un enlace que saca a alguien de donde estaba le cobra el viaje de vuelta.
 * Quien está mirando su Visa y se acuerda del taxi de ayer no debería tener que
 * buscar esa misma Visa en un selector de otra pantalla.
 *
 * ## Los dos actos son opuestos y se nombran así
 *
 * Un **consumo** sube lo que se debe. Un **pago** lo baja. En la contabilidad
 * de la cuenta tienen signos contrarios —el consumo sale, el pago entra— y esa
 * es exactamente la parte que nadie tiene por qué saber: la pantalla pregunta
 * cuál de los dos es, en las palabras en que la gente lo piensa, y el signo lo
 * pone el sistema.
 *
 * Sólo el consumo pide rubro. Un pago a la tarjeta no es un gasto: es plata
 * moviéndose de un bolsillo a otro de la misma casa, y clasificarlo como gasto
 * lo contaría dos veces — una al comprar, otra al pagar.
 */
function CardMovements({
  locale,
  currencySymbol,
  card,
  categories,
  today,
  labels,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly card: CardRow;
  readonly categories: readonly CategoryOption[];
  readonly today: string;
  readonly labels: CardsManagerLabels;
}) {
  const [mode, setMode] = useState<'charge' | 'payment'>('charge');
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    createManualMovement,
    {},
  );

  const isPayment = mode === 'payment';
  const canPay = card.debtId !== null;

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {labels.movements.detail}
      </p>

      {/* Los dos actos, elegidos antes que nada: cambian qué se pregunta y qué
          le pasa al saldo, así que preguntarlo al final sería pedir que se
          rellene un formulario sin saber cuál. */}
      <div role="radiogroup" aria-label={labels.tabs.movements} className="flex flex-wrap gap-3">
        {(['charge', 'payment'] as const).map((one) => {
          const active = mode === one;
          const disabled = one === 'payment' && !canPay;

          return (
            <button
              key={one}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => {
                setMode(one);
              }}
              className={`min-h-11 rounded-(--radius-sm) border px-4 text-sm transition-colors ${
                active
                  ? 'border-[color:var(--color-ink)] bg-[color:var(--color-surface)] font-medium'
                  : 'border-[color:var(--color-rule)] text-[color:var(--color-ink-secondary)] hover:text-[color:var(--color-ink)]'
              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {one === 'charge' ? labels.movements.charge : labels.movements.payment}
            </button>
          );
        })}
      </div>

      <p className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {!canPay && isPayment
          ? labels.movements.noDebt
          : isPayment
            ? labels.movements.paymentEffect.replace('{balance}', card.owed)
            : labels.movements.chargeEffect.replace('{balance}', card.owed)}
      </p>

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      {state.ok && (
        <Status tone="positive">{labels.movements.saved}</Status>
      )}

      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="accountId" value={card.accountId} />
        {/* Quedarse aquí. Es la diferencia entre anotar el taxi y perder de
            vista la tarjeta que se estaba mirando. */}
        <input type="hidden" name="stay" value="true" />
        {/*
          El signo lo pone el sistema. Un consumo sale de la cuenta de la
          tarjeta y sube lo que se debe; un pago entra y lo baja. Preguntárselo
          a la casa sería pedirle que tradujera su vida a contabilidad.
        */}
        <input type="hidden" name="direction" value={isPayment ? 'inflow' : 'outflow'} />
        {isPayment && card.debtId && <input type="hidden" name="debtId" value={card.debtId} />}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={labels.movements.description}
            hint={labels.movements.descriptionHint}
            required
            className="sm:col-span-2"
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="description"
                required
                maxLength={200}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field label={labels.movements.amount} required>
            {({ id }) => (
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
                >
                  {currencySymbol}
                </span>
                <Input
                  id={id}
                  name="amount"
                  numeric
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                  className="pl-8"
                />
              </div>
            )}
          </Field>

          <Field label={labels.movements.date} required>
            {({ id }) => (
              <Input id={id} name="transactionDate" type="date" required defaultValue={today} />
            )}
          </Field>

          {/* Sólo el consumo. Un pago a la tarjeta no es un gasto: es plata
              moviéndose dentro de la misma casa, y darle rubro lo contaría dos
              veces. */}
          {!isPayment && categories.length > 0 && (
            <Field label={labels.movements.category} className="sm:col-span-2">
              {({ id }) => (
                <Select id={id} name="categoryId" defaultValue="">
                  <option value="">{labels.movements.categoryNone}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        <div>
          <Button type="submit" disabled={pending || (isPayment && !canPay)}>
            {labels.movements.save}
          </Button>
        </div>
      </form>
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
