import { formatMoney } from '@app/domain';
import { Card, Page, PageHeader, Section, Stat } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { OffersBoard } from '@/components/offers-board';
import { formatMoment, formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadOffers } from '@/server/repositories/offers';
import { requireHousehold } from '@/server/session';

/**
 * Las ofertas del mes de todos los bancos.
 *
 * La pantalla contesta una pregunta concreta y frecuente: **con cuál de mis
 * tarjetas pago aquí**. Por eso lo primero que se ve es lo que sirve hoy y con
 * qué tarjeta, no un catálogo ordenado por banco.
 *
 * Incluye débito, porque la mitad de las promociones de Panamá lo son, y bancos
 * donde el hogar no tiene cuenta, porque saber que el de al lado da 50% donde
 * el tuyo no da nada es cómo alguien decide abrir una. El filtro «sólo las
 * mías» está para el momento de decidir; el resto se ordena detrás en vez de
 * desaparecer.
 *
 * Cada tarjeta lleva su fuente y la fecha en que se leyó, y las que subió el
 * barrido automático van marcadas. Una oferta que nadie sube es una oferta que
 * nadie usa; una que se presenta como comprobada sin serlo es peor.
 */
export default async function OffersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const currency = context.currency;

  const view = await loadOffers(session, session.activeHouseholdId, currency, context.today);

  const t = await getTranslations('offers');
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  const dayNames = [
    t('days.1'),
    t('days.2'),
    t('days.3'),
    t('days.4'),
    t('days.5'),
    t('days.6'),
    t('days.7'),
  ];

  /** El tope, en una frase: «hasta $125 sobre un consumo de $250». */
  const capOf = (offer: (typeof view.offers)[number]): string | null => {
    const discount = offer.maxDiscount
      ? formatMoney(offer.maxDiscount, { locale: moneyLocale })
      : null;
    const spend = offer.maxSpend ? formatMoney(offer.maxSpend, { locale: moneyLocale }) : null;

    if (discount && spend) return t('capBoth', { discount, spend });
    if (discount) return t('capDiscount', { discount });
    if (spend) return t('capSpend', { spend });
    return null;
  };

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {!view.isEmpty && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <Stat label={t('summary.today')} detail={t('summary.todayDetail')}>
              {String(view.todayCount)}
            </Stat>
          </Card>
          <Card>
            <Stat label={t('summary.mine')} detail={t('summary.mineDetail')}>
              {String(view.mineCount)}
            </Stat>
          </Card>
          <Card>
            <Stat label={t('summary.all')} detail={t('summary.allDetail')}>
              {String(view.offers.length)}
            </Stat>
          </Card>
        </div>
      )}

      <Section title={t('board.title')} detail={t('board.detail')} className="mt-12">
        <OffersBoard
          offers={view.offers.map((offer) => ({
            id: offer.id,
            issuerKey: offer.issuerKey,
            issuerName: offer.issuerName,
            merchantName: offer.merchantName,
            merchantNote: offer.merchantNote,
            category: offer.category,
            headline: offer.headline,
            detail: offer.detail,
            cap: capOf(offer),
            weekdayNames: offer.weekdays.map((day) => dayNames[day - 1] ?? ''),
            validUntil: offer.validUntil ? formatPlainDate(offer.validUntil, locale) : null,
            channel: offer.channel,
            sourceName: offer.sourceName,
            sourceUrl: offer.sourceUrl,
            capturedOn: formatPlainDate(offer.capturedOn, locale),
            isVerified: offer.status === 'verified',
            isMine: offer.isMine,
            usableWith: offer.usableWith,
            isToday: offer.isToday,
          }))}
          issuers={view.issuers}
          categories={view.categories}
          labels={{
            onlyMine: t('filters.onlyMine'),
            allCards: t('filters.allCards'),
            everyIssuer: t('filters.everyIssuer'),
            everyCategory: t('filters.everyCategory'),
            categories: {
              restaurantes: t('categories.restaurantes'),
              supermercados: t('categories.supermercados'),
              combustible: t('categories.combustible'),
              farmacias: t('categories.farmacias'),
              viajes: t('categories.viajes'),
              entretenimiento: t('categories.entretenimiento'),
              tecnologia: t('categories.tecnologia'),
              salud: t('categories.salud'),
              otros: t('categories.otros'),
            },
            payWith: rawOf(t)('payWith'),
            notYours: t('notYours'),
            today: t('today'),
            everyDay: t('everyDay'),
            until: rawOf(t)('until'),
            cap: rawOf(t)('cap'),
            unverified: t('unverified'),
            capturedOn: rawOf(t)('capturedOn'),
            emptyTitle: t('empty.title'),
            emptyBody: t('empty.body'),
            noneMatch: t('noneMatch'),
          }}
        />
      </Section>

      {/* Cuándo se miró por última vez. Sin esta línea, «las ofertas del mes» es
          una afirmación que nadie puede fechar. */}
      <p className="mt-12 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {view.lastRefresh
          ? t('lastRefresh', {
              when: formatMoment(view.lastRefresh, locale, context.timeZone),
            })
          : t('neverRefreshed')}
      </p>
      <p className="mt-3 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-tertiary)]">
        {t('note')}
      </p>
    </Page>
  );
}

/** Una plantilla cuyos marcadores se rellenan donde están los valores. */
function rawOf(catalogue: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = catalogue.raw(key);
    return typeof value === 'string' ? value : '';
  };
}
