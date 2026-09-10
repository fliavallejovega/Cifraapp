import { formatMoney, getCurrency, type CurrencyCode } from '@app/domain';
import {
  Amount,
  Card,
  EmptyState,
  Gauge,
  Page,
  PageHeader,
  Section,
  Stat,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CardCompare } from '@/components/card-compare';
import { CardsManager } from '@/components/cards-manager';
import { ImportForm } from '@/components/import-form';
import { formatPlainDate, trimRate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadInstitutions, loadPeople } from '@/server/repositories/administration';
import { loadCatalogueFor } from '@/server/repositories/card-catalogue';
import { COMPARE_CATEGORIES, compareByCategory } from '@/server/repositories/card-comparison';
import { loadCards } from '@/server/repositories/cards';
import { requireHousehold } from '@/server/session';

/**
 * Las tarjetas, con su cupo y su rastro.
 *
 * Una tarjeta era dos filas en dos pantallas distintas: la deuda en Deudas —lo
 * que se debe, la tasa, el mínimo— y la cuenta en Cuentas —el cupo, los
 * movimientos—. Ninguna de las dos respondía la pregunta que uno se hace de
 * verdad al sacar la tarjeta del bolsillo: cuánto debo, cuánto me queda, cuándo
 * se paga, y en qué la vengo usando.
 *
 * La utilización va arriba porque es la cifra que nadie mira hasta que ya está
 * alta. Sale de dos números que la casa declaró —lo debido y el cupo—, sin
 * modelo ni estimación detrás, y por eso se puede enseñar sin salvedades.
 *
 * Cuando el saldo del banco y el que la casa gestiona no coinciden, se enseñan
 * los dos. Esa diferencia es el hallazgo, no un error que resolver eligiendo
 * uno de los dos.
 */
export default async function CardsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const household = session.households.find((entry) => entry.id === session.activeHouseholdId);
  const currency = (household?.baseCurrency.trim() ?? 'USD') as CurrencyCode;
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);

  const [view, people, issuers] = await Promise.all([
    loadCards(session, session.activeHouseholdId, currency),
    loadPeople(session, session.activeHouseholdId),
    loadInstitutions(),
  ]);

  /**
   * El catálogo de cada tarjeta, resuelto en paralelo.
   *
   * Una consulta por tarjeta y no una para todas: el filtro depende de la red,
   * el nivel y el emisor de cada una, y una consulta común obligaría a filtrar
   * en memoria lo que la base ya sabe hacer con un índice.
   */
  const catalogues = Object.fromEntries(
    await Promise.all(
      view.cards.map(async (card) => [
        card.accountId,
        await loadCatalogueFor(
          { issuerKey: card.issuerKey, network: card.network, tier: card.tier },
          context.today,
        ),
      ] as const),
    ),
  );

  const t = await getTranslations('cards');
  const documents = await getTranslations('documents');
  const offersCopy = await getTranslations('offers');
  const shared = await getTranslations('records');

  /**
   * El comparativo, sobre lo propio y lo del mercado a la vez.
   *
   * Lo que la casa anotó de su contrato entra como confirmado; lo del mercado,
   * con la marca que traiga. Van a la misma comparación porque contestan la
   * misma pregunta — cuál conviene aquí — y lo que las distingue es de dónde
   * salieron, no en qué lista aparecen.
   */
  const comparison = await compareByCategory(
    view.cards.flatMap((card) =>
      card.benefits.map((benefit) => ({
        cardId: card.accountId,
        cardName: card.name,
        issuerName: card.issuerName,
        kind: benefit.kind,
        label: benefit.label,
        value: benefit.value,
        capturedOn: context.today,
        expiresOn: benefit.expiresOn,
      })),
    ),
    context.today,
  );
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';
  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: moneyLocale });

  /** La utilización como porcentaje entero. Un decimal aquí no cambia ninguna decisión. */
  const percent = (ratio: number) => `${String(Math.round(ratio * 100))}%`;

  const managerLabels = {
    manage: t('manage.open'),
    close: t('manage.close'),
    tabs: {
      data: t('manage.tabs.data'),
      benefits: t('manage.tabs.benefits'),
      statement: t('manage.tabs.statement'),
    },
    form: {
      name: t('manage.form.name'),
      nameHint: t('manage.form.nameHint'),
      network: t('manage.form.network'),
      networkNone: t('manage.form.networkNone'),
      networks: {
        visa: t('networks.visa'),
        mastercard: t('networks.mastercard'),
        amex: t('networks.amex'),
        discover: t('networks.discover'),
        other: t('networks.other'),
      },
      tier: t('manage.form.tier'),
      tierNone: t('manage.form.tierNone'),
      tiers: {
        classic: t('tiers.classic'),
        gold: t('tiers.gold'),
        platinum: t('tiers.platinum'),
        signature: t('tiers.signature'),
        infinite: t('tiers.infinite'),
        black: t('tiers.black'),
        other: t('tiers.other'),
      },
      issuer: t('manage.form.issuer'),
      issuerNone: t('manage.form.issuerNone'),
      issuerHint: t('manage.form.issuerHint'),
      mask: t('manage.form.mask'),
      maskHint: t('manage.form.maskHint'),
      balance: t('manage.form.balance'),
      balanceHint: t('manage.form.balanceHint'),
      apr: t('manage.form.apr'),
      minimum: t('manage.form.minimum'),
      limit: t('manage.form.limit'),
      limitHint: t('manage.form.limitHint'),
      annualFee: t('manage.form.annualFee'),
      annualFeeHint: t('manage.form.annualFeeHint'),
      statementDay: t('manage.form.statementDay'),
      statementDayHint: t('manage.form.statementDayHint'),
      dueDay: t('manage.form.dueDay'),
      dueDayHint: t('manage.form.dueDayHint'),
      person: t('manage.form.person'),
      personHousehold: t('manage.form.personHousehold'),
      save: t('manage.form.save'),
      create: t('manage.form.create'),
      cancel: shared('cancel'),
      archive: t('manage.form.archive'),
      archiveConfirm: t('manage.form.archiveConfirm'),
      archiveConfirmYes: t('manage.form.archiveConfirmYes'),
    },
    benefits: {
      title: t('manage.benefits.title'),
      detail: t('manage.benefits.detail'),
      emptyTitle: t('manage.benefits.emptyTitle'),
      emptyBody: t('manage.benefits.emptyBody'),
      kind: t('manage.benefits.kind'),
      kinds: {
        cashback: t('benefitKinds.cashback'),
        miles: t('benefitKinds.miles'),
        points: t('benefitKinds.points'),
        insurance: t('benefitKinds.insurance'),
        lounge: t('benefitKinds.lounge'),
        discount: t('benefitKinds.discount'),
        waiver: t('benefitKinds.waiver'),
        other: t('benefitKinds.other'),
      },
      label: t('manage.benefits.label'),
      labelHint: t('manage.benefits.labelHint'),
      value: t('manage.benefits.value'),
      valueHint: t('manage.benefits.valueHint'),
      source: t('manage.benefits.source'),
      sourceHint: t('manage.benefits.sourceHint'),
      expires: t('manage.benefits.expires'),
      expiresHint: t('manage.benefits.expiresHint'),
      add: t('manage.benefits.add'),
      remove: t('manage.benefits.remove'),
      expired: t('manage.benefits.expired'),
      noCatalogue: t('manage.benefits.noCatalogue'),
      catalogue: {
        title: t('manage.catalogue.title'),
        detail: t('manage.catalogue.detail'),
        empty: t('manage.catalogue.empty'),
        capturedOn: rawOf(t)('manage.catalogue.capturedOn'),
        validUntil: rawOf(t)('manage.catalogue.validUntil'),
        reviewBy: rawOf(t)('manage.catalogue.reviewBy'),
        stale: t('manage.catalogue.stale'),
        adopt: t('manage.catalogue.adopt'),
        openSource: t('manage.catalogue.openSource'),
        warning: t('manage.catalogue.warning'),
      },
    },
    addCard: t('manage.addCard'),
    addCardTitle: t('manage.addCardTitle'),
    errorTitle: shared('errorTitle'),
    errors: errorsOf(shared),
  };

  /**
   * El formulario de importación de cada tarjeta, armado en el servidor.
   *
   * Uno por tarjeta y con la cuenta fijada: se está mirando esa tarjeta, así que
   * un selector con todas las cuentas del hogar sería una pregunta cuya
   * respuesta ya está en la pantalla — y la ocasión de archivar el estado de
   * cuenta de la Visa contra la Mastercard.
   */
  const statementFor = Object.fromEntries(
    view.cards.map((card) => [
      card.accountId,
      <ImportForm
        key={card.accountId}
        locale={locale}
        accounts={[]}
        fixedAccountId={card.accountId}
        labels={{
          file: documents('form.file'),
          fileHint: documents('form.fileHint'),
          account: documents('form.account'),
          accountHint: documents('form.accountHint'),
          submit: documents('form.submit'),
          errorTitle: documents('errors.title'),
          queuedHeading: documents('queued.heading'),
          queuedDetail: documents('queued.detail'),
          watchLink: documents('queued.watch'),
          errors: errorsOf(documents, 'errors'),
        }}
      />,
    ]),
  );

  if (view.isEmpty) {
    return (
      <Page>
        <PageHeader title={t('title')} detail={t('detail')} />
        <Card>
          <EmptyState title={t('empty.title')} body={t('empty.body')} />
        </Card>
        {/* La primera acción, aquí mismo: mandar a otra pantalla a crear lo que
            esta pantalla administra es la razón por la que había que registrar
            una tarjeta en dos sitios. */}
        <div className="mt-6">
          <CardsManager
            locale={locale}
            currencySymbol={getCurrency(currency).symbol}
            people={people.map((person) => ({ id: person.id, name: person.displayName }))}
            issuers={issuers}
            cards={[]}
            statementFor={{}}
            labels={managerLabels}
          />
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <Stat label={t('summary.owed')} detail={t('summary.owedDetail')}>
            {money(view.totalOwed)}
          </Stat>
        </Card>
        {view.totalAvailable && (
          <Card>
            <Stat label={t('summary.available')} detail={t('summary.availableDetail')}>
              {money(view.totalAvailable)}
            </Stat>
          </Card>
        )}
        {view.utilization !== null && (
          <Card>
            <Stat label={t('summary.utilization')} detail={t('summary.utilizationDetail')}>
              {percent(view.utilization)}
            </Stat>
          </Card>
        )}
      </div>

      {/* El comparativo antes del listado: quien abre esta pantalla suele venir
          con una compra en la mano, y «cuál uso» se contesta antes que «qué
          tengo». */}
      <Section title={t('compare.title')} detail={t('compare.detail')} className="mt-12">
        <CardCompare
          categories={[...COMPARE_CATEGORIES]}
          byCategory={Object.fromEntries(
            Object.entries(comparison).map(([category, result]) => [
              category,
              {
                ranked: result.ranked.map(toCompareOffer(locale)),
                unquantified: result.unquantified.map(toCompareOffer(locale)),
                expired: result.expired.map(toCompareOffer(locale)),
              },
            ]),
          )}
          labels={{
            title: t('compare.title'),
            detail: t('compare.detail'),
            category: t('compare.category'),
            categories: {
              restaurantes: offersCopy('categories.restaurantes'),
              supermercados: offersCopy('categories.supermercados'),
              combustible: offersCopy('categories.combustible'),
              farmacias: offersCopy('categories.farmacias'),
              viajes: offersCopy('categories.viajes'),
              entretenimiento: offersCopy('categories.entretenimiento'),
              tecnologia: offersCopy('categories.tecnologia'),
              salud: offersCopy('categories.salud'),
              otros: offersCopy('categories.otros'),
            },
            best: t('compare.best'),
            unquantified: t('compare.unquantified'),
            unquantifiedHint: t('compare.unquantifiedHint'),
            expired: t('compare.expired'),
            mine: t('compare.mine'),
            notMine: t('compare.notMine'),
            unverified: offersCopy('unverified'),
            capturedOn: rawOf(offersCopy)('capturedOn'),
            emptyTitle: t('compare.emptyTitle'),
            emptyBody: t('compare.emptyBody'),
          }}
        />
      </Section>

      <Section title={t('list.title')} detail={t('list.detail')} className="mt-12">
        <div className="flex flex-col gap-4">
          {view.cards.map((card) => (
            <Card key={card.accountId} {...(card.isArchived ? { className: 'opacity-60' } : {})}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-medium break-words">{card.name}</h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--color-ink-secondary)]">
                    {card.maskedNumber && (
                      <span className="tabular">{t('list.mask', { mask: card.maskedNumber })}</span>
                    )}
                    {card.network && <span>{t(`networks.${card.network}`)}</span>}
                    {card.holder && <span>{card.holder}</span>}
                    {card.annualFee && !card.annualFee.isZero() && (
                      <span>{t('list.annualFee', { fee: money(card.annualFee) })}</span>
                    )}
                    {card.isArchived && <Status tone="neutral">{t('list.archived')}</Status>}
                    {/* Sin deuda ligada, el motor no la ataca y nadie lo sabría
                        mirando esta tarjeta. Se dice, con el camino al lado. */}
                    {card.debtId === null && (
                      <Status tone="caution">{t('list.noDebt')}</Status>
                    )}
                  </p>
                </div>
                <Amount value={card.owed} locale={moneyLocale} size="lg" tone="plain" />
              </div>

              {/* El cupo, cuando se declaró. La marca del 30% no es una regla del
                  producto: es el umbral por encima del cual la utilización
                  empieza a pesar en un puntaje de crédito, y decirlo con una
                  marca es más honesto que teñir la barra de rojo sin explicar. */}
              {card.creditLimit && card.available && card.utilization !== null && card.band && (
                <div className="mt-5">
                  <Gauge
                    value={card.owed}
                    max={card.creditLimit}
                    label={t('list.gauge', { name: card.name })}
                    locale={moneyLocale}
                    tone={
                      card.band === 'stretched'
                        ? 'negative'
                        : card.band === 'tight'
                          ? 'caution'
                          : 'neutral'
                    }
                    thresholds={[
                      {
                        at: card.creditLimit.percentage(30),
                        label: t('list.threshold'),
                        kind: 'target',
                      },
                    ]}
                  />
                  <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[color:var(--color-ink-secondary)]">
                    {/*
                      La banda lleva su palabra y no sólo su color. Quien no
                      distingue el ámbar del rojo tiene que poder leer lo mismo,
                      y en una cifra que decide si conviene usar la tarjeta este
                      mes eso no es un detalle de accesibilidad, es la
                      información.
                    */}
                    <Status
                      tone={
                        card.band === 'stretched'
                          ? 'negative'
                          : card.band === 'tight'
                            ? 'caution'
                            : 'positive'
                      }
                    >
                      {t(`bands.${card.band}`, { used: percent(card.utilization) })}
                    </Status>
                    <span>
                      {t('list.availableOf', {
                        available: money(card.available),
                        limit: money(card.creditLimit),
                        used: percent(card.utilization),
                      })}
                    </span>
                  </p>
                </div>
              )}

              {/* Sin cupo declarado no hay porcentaje que calcular, y el
                  producto prefiere decirlo a inventarlo. */}
              {card.creditLimit === null && (
                <p className="mt-4 text-sm text-[color:var(--color-ink-secondary)]">
                  {t('list.noLimit')}
                </p>
              )}

              <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[color:var(--color-rule)] pt-4 sm:grid-cols-4">
                <Detail label={t('list.apr')} value={card.apr ? `${trimRate(card.apr)}%` : '—'} />
                <Detail
                  label={t('list.minimum')}
                  value={card.minimumPayment ? money(card.minimumPayment) : '—'}
                />
                <Detail
                  label={t('list.dueDay')}
                  value={card.dueDay ? t('list.dayOfMonth', { day: card.dueDay }) : '—'}
                />
                <Detail
                  label={t('list.movements')}
                  value={
                    card.movementCount === 0
                      ? t('list.noMovements')
                      : String(card.movementCount)
                  }
                />
              </dl>

              {card.lastMovementOn && (
                <p className="mt-4 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                  {t('list.lastMovement', {
                    date: formatPlainDate(card.lastMovementOn, locale),
                    description: card.lastMovementDescription ?? '',
                  })}
                </p>
              )}

              {/* Los dos saldos, cuando no coinciden. */}
              {card.balancesDiffer && card.managed && (
                <p className="mt-4 max-w-[68ch] text-sm text-pretty text-[color:var(--color-caution)]">
                  {t('list.mismatch', {
                    bank: money(card.owed),
                    managed: money(card.managed),
                  })}
                </p>
              )}

              {/* Los beneficios que la casa anotó, resumidos. El detalle y la
                  edición viven en el panel, para no llenar la tarjeta de
                  formulario cuando lo que se vino a hacer es mirar. */}
              {card.benefits.length > 0 && (
                <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-ink-secondary)]">
                  {card.benefits.slice(0, 4).map((benefit) => (
                    <Status
                      key={benefit.id}
                      tone={benefit.isExpired ? 'neutral' : 'positive'}
                    >
                      {benefit.label}
                    </Status>
                  ))}
                  {card.benefits.length > 4 && (
                    <span>{t('list.moreBenefits', { count: card.benefits.length - 4 })}</span>
                  )}
                </p>
              )}
            </Card>
          ))}
        </div>

        <div className="mt-6">
          <CardsManager
            locale={locale}
            currencySymbol={getCurrency(currency).symbol}
            people={people.map((person) => ({ id: person.id, name: person.displayName }))}
            issuers={issuers}
            cards={view.cards.map((card) => ({
              accountId: card.accountId,
              name: card.name,
              maskedNumber: card.maskedNumber,
              network: card.network,
              tier: card.tier,
              institutionId: card.institutionId,
              catalogue: (catalogues[card.accountId] ?? []).map((entry) => ({
                id: entry.id,
                kind: entry.kind,
                label: entry.label,
                value: entry.value,
                program: entry.program,
                sourceName: entry.sourceName,
                sourceUrl: entry.sourceUrl,
                capturedOn: formatPlainDate(entry.capturedOn, locale),
                validUntil: entry.validUntil ? formatPlainDate(entry.validUntil, locale) : null,
                reviewBy: entry.reviewBy ? formatPlainDate(entry.reviewBy, locale) : null,
                notes: entry.notes,
                isStale: entry.isStale,
              })),
              holderId: card.holderId,
              // La deuda es la que el formulario edita: la cuenta guarda lo que
              // dice el banco y no se pisa desde aquí.
              balance: (card.managed ?? card.owed).toDecimalString(),
              apr: card.apr ? trimRate(card.apr) : '',
              minimumPayment: card.minimumPayment?.toDecimalString() ?? '',
              creditLimit: card.creditLimit?.toDecimalString() ?? '',
              annualFee: card.annualFee?.toDecimalString() ?? '',
              statementDay: card.statementDay === null ? '' : String(card.statementDay),
              dueDay: card.dueDay === null ? '' : String(card.dueDay),
              benefits: card.benefits.map((benefit) => ({
                id: benefit.id,
                kind: benefit.kind,
                label: benefit.label,
                value: benefit.value,
                source: benefit.source,
                expiresOn: benefit.expiresOn,
                isExpired: benefit.isExpired,
              })),
              isArchived: card.isArchived,
            }))}
            statementFor={statementFor}
            labels={managerLabels}
          />
        </div>
      </Section>

      <p className="mt-12 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('note')}
      </p>
    </Page>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
        {label}
      </dt>
      <dd className="tabular text-sm">{value}</dd>
    </div>
  );
}

/**
 * El diccionario de errores de un catálogo, como datos.
 *
 * Datos y no la función `t`: lo que cruza a un componente de cliente tiene que
 * poder serializarse, y pasar `t` compila, construye, pasa el gate entero y
 * revienta en producción con «Functions cannot be passed directly to Client
 * Components». Ya pasó una vez en este repositorio.
 */
function errorsOf(
  catalogue: { raw: (key: string) => unknown },
  key = 'errors',
): Record<string, string> {
  const value = catalogue.raw(key);
  if (typeof value !== 'object' || value === null) return {};

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

/** Una plantilla cuyos marcadores se rellenan donde están los valores. */
function rawOf(catalogue: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = catalogue.raw(key);
    return typeof value === 'string' ? value : '';
  };
}

/** Una oferta comparada, lista para cruzar al cliente como datos. */
function toCompareOffer(locale: string) {
  return (offer: {
    cardId: string;
    cardName: string;
    issuerName: string | null;
    headline: string;
    detail: string | null;
    isVerified: boolean;
    isOwned: boolean;
    capturedOn: string;
    rate: number | null;
    position: number;
  }) => ({
    cardId: offer.cardId,
    cardName: offer.cardName,
    issuerName: offer.issuerName,
    headline: offer.headline,
    detail: offer.detail,
    isVerified: offer.isVerified,
    isOwned: offer.isOwned,
    capturedOn: formatPlainDate(offer.capturedOn, locale),
    rate: offer.rate,
    position: offer.position,
  });
}
