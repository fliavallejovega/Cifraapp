import { formatMoney, getCurrency, type CurrencyCode } from '@app/domain';
import { HOLDING_KINDS } from '@app/market-data';
import {
  Amount,
  Card,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  PageHeader,
  Section,
  Stat,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccountsManager, type AccountRowView } from '@/components/accounts-manager';
import { HoldingsManager } from '@/components/holdings-manager';
import { formatMoment } from '@/lib/format';
import { ACCOUNT_TYPE_GROUPS, ACCOUNT_TYPES, loadAccounts } from '@/server/repositories/accounts';
import { loadHouseholdContext } from '@/server/household-context';
import { loadPeople } from '@/server/repositories/administration';
import { loadPortfolio } from '@/server/repositories/portfolio';
import { requireHousehold } from '@/server/session';

/**
 * Where money gets a place to live.
 *
 * This screen is the entry point the product went without: no account meant no
 * import, no plan and no statement, and the button that claimed to add one did
 * nothing. Everything downstream reads rows that begin here.
 *
 * The two figures at the top are the only summary worth showing — what is
 * liquid and what is owed — because those are the two numbers every other
 * screen is built on, and seeing them here is how a person checks that what
 * they typed is what the product understood.
 */
export default async function AccountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const household = session.households.find((entry) => entry.id === session.activeHouseholdId);
  const currency = (household?.baseCurrency.trim() ?? 'USD') as CurrencyCode;
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);

  const [view, people, portfolio] = await Promise.all([
    loadAccounts(session, session.activeHouseholdId, currency),
    loadPeople(session, session.activeHouseholdId),
    loadPortfolio(session, session.activeHouseholdId, currency),
  ]);
  const personNames = new Map(people.map((person) => [person.id, person.displayName]));

  const t = await getTranslations('accounts');
  const setup = await getTranslations('setup');
  const raw = rawOf(t);
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  const rows: AccountRowView[] = view.accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    maskedNumber: account.maskedNumber,
    personId: account.personId,
    personName: account.personId ? (personNames.get(account.personId) ?? null) : null,
    balance: formatMoney(account.balance, { locale: moneyLocale }),
    rawBalance: account.balance.toDecimalString(),
    status: account.status,
    transactionCount: account.transactionCount,
  }));

  const typeLabels = Object.fromEntries(
    ACCOUNT_TYPES.map((type) => [type, t(`types.${type}`)]),
  ) as Record<string, string>;

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {/* Only once there is something to summarize. Two zeroes above an empty
          list would be a measurement of nothing. */}
      {!view.isEmpty && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <Stat label={t('summary.liquid')} detail={t('summary.liquidDetail')}>
              {formatMoney(view.liquid, { locale: moneyLocale })}
            </Stat>
          </Card>
          {!view.liabilities.isZero() && (
            <Card>
              <Stat label={t('summary.owed')} detail={t('summary.owedDetail')}>
                {formatMoney(view.liabilities, { locale: moneyLocale })}
              </Stat>
            </Card>
          )}
        </div>
      )}

      {/* El desglose por persona. Sólo cuando hay más de un dueño: una tabla de
          una fila repite la cifra de arriba y no dice nada nuevo. */}
      {view.byPerson.length > 0 && (
        <Section
          title={t('byPerson.title')}
          detail={t('byPerson.detail')}
          className="mt-12"
        >
          <Card>
            <Ledger caption={t('byPerson.title')}>
              <LedgerHead>
                <LedgerColumn>{t('byPerson.person')}</LedgerColumn>
                <LedgerColumn align="end">{t('byPerson.liquid')}</LedgerColumn>
                <LedgerColumn align="end">{t('byPerson.owed')}</LedgerColumn>
                <LedgerColumn align="end">{t('byPerson.net')}</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {view.byPerson.map((entry) => (
                  <LedgerRow key={entry.personId ?? 'unassigned'}>
                    <LedgerCell>
                      <span className="font-medium">
                        {entry.name === 'unassigned' ? t('byPerson.unassigned') : entry.name}
                      </span>
                      <span className="mt-1 block text-xs text-[color:var(--color-ink-secondary)]">
                        {t('byPerson.counts', {
                          accounts: entry.accountCount,
                          debts: entry.debtCount,
                        })}
                      </span>
                    </LedgerCell>
                    <LedgerCell align="end">
                      <Amount value={entry.liquid} locale={moneyLocale} tone="plain" />
                    </LedgerCell>
                    <LedgerCell align="end">
                      <Amount value={entry.liabilities} locale={moneyLocale} tone="plain" />
                    </LedgerCell>
                    <LedgerCell align="end">
                      <Amount value={entry.net} locale={moneyLocale} />
                    </LedgerCell>
                  </LedgerRow>
                ))}
              </LedgerBody>
            </Ledger>
          </Card>
        </Section>
      )}

      {/* Y cuando hay cuentas pero nadie les puso dueño, se dice qué falta y
          dónde se hace, en vez de callar una sección que existe. */}
      {!view.isEmpty && view.byPerson.length === 0 && people.length > 1 && (
        <p className="mt-12 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {t('byPerson.unassignedHint')}
        </p>
      )}

      <Section title={t('list.title')} detail={t('list.detail')} className="mt-12">
        <Card>
          <AccountsManager
            people={people.map((person) => ({ id: person.id, name: person.displayName }))}
            locale={locale}
            currencySymbol={getCurrency(currency).symbol}
            accounts={rows}
            groups={ACCOUNT_TYPE_GROUPS.map((group) => ({ key: group.key, types: group.types }))}
            labels={{
              form: {
                name: t('form.name'),
                nameHint: t('form.nameHint'),
                type: t('form.type'),
                balance: t('form.balance'),
                balanceHintAsset: t('form.balanceHintAsset'),
                balanceHintDebt: t('form.balanceHintDebt'),
                mask: t('form.mask'),
                person: t('form.person'),
                personHint: t('form.personHint'),
                personHousehold: t('form.personHousehold'),
                maskHint: t('form.maskHint'),
                submitCreate: t('form.submitCreate'),
                submitUpdate: t('form.submitUpdate'),
                cancel: t('form.cancel'),
                errorTitle: t('errors.title'),
                errors: errorLabels(t),
                types: typeLabels,
                groups: {
                  liquid: t('groups.liquid'),
                  debt: t('groups.debt'),
                  other: t('groups.other'),
                },
              },
              addAction: t('list.add'),
              addTitle: t('list.addTitle'),
              edit: t('list.edit'),
              archive: t('list.archive'),
              restore: t('list.restore'),
              archiveConfirm: t('list.archiveConfirm'),
              archiveConfirmYes: t('list.archiveConfirmYes'),
              cancel: t('form.cancel'),
              archivedBadge: t('list.archivedBadge'),
              movements: raw('list.movements'),
              noMovements: t('list.noMovements'),
              addMovement: t('list.addMovement'),
              maskPrefix: t('list.maskPrefix'),
              emptyTitle: t('empty.title'),
              emptyBody: t('empty.body'),
              errorTitle: t('errors.title'),
              errors: errorLabels(t),
              types: typeLabels,
            }}
          />
        </Card>
      </Section>

      {/*
        Lo que la casa tiene invertido.

        Va en Cuentas y no en una pantalla aparte porque responde a la misma
        pregunta —«¿dónde está mi dinero?»— y porque la pantalla de inversiones
        es para mirar la posición, no para administrarla. Aquí se registra, se
        corrige y se quita, igual que una cuenta de banco.

        Sumado al total sólo cuando hay cotización: una posición que nadie pudo
        cotizar se enseña sin valor y se dice, en vez de contarse como cero.
      */}
      <Section
        title={t('investments.title')}
        detail={t('investments.detail')}
        className="mt-12"
      >
        {portfolio.positions.length > 0 && (
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <Card>
              <Stat label={t('investments.total')} detail={t('investments.totalDetail')}>
                {formatMoney(portfolio.total, { locale: moneyLocale })}
              </Stat>
            </Card>
            {portfolio.change && (
              <Card>
                <Stat label={t('investments.change')} detail={t('investments.changeDetail')}>
                  {formatMoney(portfolio.change, { locale: moneyLocale, signDisplay: 'always' })}
                </Stat>
              </Card>
            )}
            {/* Los dos totales que el total general no puede dar. Sólo cuando
                hay una decisión detrás: una cifra en cero sobre algo que nadie
                decidió no es un dato, es una casilla vacía con aspecto de dato. */}
            {portfolio.untouchable.isPositive() && (
              <Card>
                <Stat
                  label={t('investments.untouchable')}
                  detail={t('investments.untouchableDetail')}
                >
                  {formatMoney(portfolio.untouchable, { locale: moneyLocale })}
                </Stat>
              </Card>
            )}
            {portfolio.leaving.isPositive() && (
              <Card>
                <Stat label={t('investments.leaving')} detail={t('investments.leavingDetail')}>
                  {formatMoney(portfolio.leaving, { locale: moneyLocale })}
                </Stat>
              </Card>
            )}
          </div>
        )}

        {/* Cuántas quedan sin decidir, dicho una vez y sin alarma: es una
            invitación a completar, no un error. */}
        {portfolio.undecided > 0 && portfolio.positions.length > 0 && (
          <p className="mb-4 text-sm text-[color:var(--color-ink-secondary)]">
            {t('investments.undecided', { count: portfolio.undecided })}
          </p>
        )}

        <HoldingsManager
          locale={locale}
          moneyLocale={moneyLocale}
          currencySymbol={getCurrency(currency).symbol}
          people={people.map((person) => ({ id: person.id, name: person.displayName }))}
          rows={portfolio.positions.map((position) => ({
            id: position.id,
            symbol: position.symbol,
            label: position.label,
            kind: position.kind,
            quantity: position.quantity,
            holderId: position.holderId,
            holderName: position.holder,
            costBasis: position.costBasis,
            value: position.valuation
              ? formatMoney(position.valuation.value, { locale: moneyLocale })
              : null,
            price: position.valuation ? position.valuation.quote.price : null,
            stale: position.stale,
            intent: position.intent,
            intentHorizon: position.intentHorizon,
            intentNote: position.intentNote,
            intentDecidedOn: position.intentSetAt
              ? formatMoment(position.intentSetAt, locale, context.timeZone)
              : null,
          }))}
          labels={{
            addAction: t('investments.add'),
            addTitle: t('investments.addTitle'),
            edit: t('list.edit'),
            remove: t('investments.remove'),
            removeConfirm: t('investments.removeConfirm'),
            removeConfirmYes: t('list.archiveConfirmYes'),
            cancel: t('form.cancel'),
            submitCreate: t('investments.submitCreate'),
            submitUpdate: t('investments.submitUpdate'),
            emptyTitle: t('investments.emptyTitle'),
            emptyBody: t('investments.emptyBody'),
            symbol: t('investments.symbol'),
            symbolHint: t('investments.symbolHint'),
            quantity: t('investments.quantity'),
            quantityHint: t('investments.quantityHint'),
            label: t('investments.label'),
            labelHint: t('investments.labelHint'),
            holder: t('investments.holder'),
            holderShared: t('investments.holderShared'),
            cost: t('investments.cost'),
            costHint: t('investments.costHint'),
            unpriced: t('investments.unpriced'),
            stale: t('investments.stale'),
            // Las cuatro del buscador, reutilizadas del catálogo del
            // cuestionario: dicen exactamente lo mismo y ya están traducidas.
            // `raw`, no `t`: lleva {price} y {value} dentro y los rellena el
            // navegador con lo que se está tecleando. `t()` intentaría
            // resolverlos aquí y lanzaría, que es cómo una plantilla se lleva
            // una pantalla por delante.
            quoted: rawOf(setup)('holdings.quoted'),
            intent: {
              open: t('investments.intent.open'),
              title: t('investments.intent.title'),
              detail: t('investments.intent.detail'),
              none: t('investments.intent.none'),
              options: {
                long_term: t('investments.intent.options.long_term'),
                hold: t('investments.intent.options.hold'),
                exit: t('investments.intent.options.exit'),
                reallocate: t('investments.intent.options.reallocate'),
              },
              // Llevan {value} dentro y lo rellena el navegador con el valor
              // de la posición: `raw`, no `t`.
              consequence: {
                long_term: rawOf(t)('investments.intent.consequence.long_term'),
                hold: rawOf(t)('investments.intent.consequence.hold'),
                exit: rawOf(t)('investments.intent.consequence.exit'),
                reallocate: rawOf(t)('investments.intent.consequence.reallocate'),
              },
              horizon: t('investments.intent.horizon'),
              horizonHint: t('investments.intent.horizonHint'),
              note: t('investments.intent.note'),
              noteHint: t('investments.intent.noteHint'),
              save: t('investments.intent.save'),
              clear: t('investments.intent.clear'),
              decidedOn: rawOf(t)('investments.intent.decidedOn'),
              notAdvice: t('investments.intent.notAdvice'),
            },
            checking: setup('holdings.checking'),
            unknownSymbol: setup('holdings.unknown'),
            unavailable: setup('holdings.unavailable'),
            // Leída del paquete, no copiada. Una lista de seis clases repetida
            // a mano es la que se queda en cuatro cuando el proveedor aprende a
            // distinguir dos más.
            kinds: Object.fromEntries(
              HOLDING_KINDS.map((kind) => [kind, setup(`holdings.kind.${kind}`)]),
            ),
            errorTitle: t('errors.title'),
            errors: {
              ...errorLabels(t),
              symbolInvalid: t('investments.errors.symbolInvalid'),
              quantityInvalid: t('investments.errors.quantityInvalid'),
              intentInvalid: t('investments.errors.intentInvalid'),
              amountInvalid: t('errors.balanceInvalid'),
            },
            // El buscador de símbolos trae su propio catálogo, que vive con el
            // cuestionario porque nació ahí. Se pasa aplanado en vez de copiarse:
            // dos copias de quince cadenas se separan, y el día que se separen la
            // pantalla nueva es la que enseña la versión vieja.
            search: flattenMessages(setup.raw('holdings'), 'holdings'),
          }}
        />
      </Section>

      <p className="mt-12 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('scopeNote')}
      </p>
    </Page>
  );
}

function errorLabels(t: (key: string) => string): Record<string, string> {
  return {
    nameRequired: t('errors.nameRequired'),
    balanceInvalid: t('errors.balanceInvalid'),
    maskInvalid: t('errors.maskInvalid'),
    typeInvalid: t('errors.typeInvalid'),
    createFailed: t('errors.createFailed'),
    notFound: t('errors.notFound'),
    signInRequired: t('errors.signInRequired'),
    generic: t('errors.generic'),
  };
}

/**
 * A message that carries placeholders filled in the browser, where the value is
 * client state the server never had — a selection count, a running total.
 * `t()` would try to resolve them here and throw; the template has to travel
 * whole.
 */
function rawOf(t: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = t.raw(key);
    return typeof value === 'string' ? value : '';
  };
}

/**
 * Un subárbol del catálogo, aplanado a claves con punto.
 *
 * `{ kind: { equity: 'Acción' } }` sale como `{ 'holdings.kind.equity': 'Acción' }`,
 * que es exactamente como lo pide el buscador de símbolos.
 *
 * Existe porque lo que cruza hacia un componente de cliente tiene que ser
 * **datos**. La versión anterior de esta pantalla le pasaba la función `t`
 * directamente: compilaba, construía y pasaba el gate entero, y luego reventaba
 * en producción con «Functions cannot be passed directly to Client Components».
 * Aplanar el catálogo cuesta doce líneas y devuelve esa comprobación al
 * compilador, porque la prop del otro lado ya está tipada como un registro.
 */
function flattenMessages(value: unknown, prefix: string): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  if (typeof value !== 'object' || value === null) return {};

  return Object.entries(value).reduce<Record<string, string>>(
    (flat, [key, nested]) => Object.assign(flat, flattenMessages(nested, `${prefix}.${key}`)),
    {},
  );
}
