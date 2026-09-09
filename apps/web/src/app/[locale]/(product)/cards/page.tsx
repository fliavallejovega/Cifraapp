import { formatMoney, type CurrencyCode } from '@app/domain';
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

import { Link } from '@/i18n/navigation';
import { formatPlainDate, trimRate } from '@/lib/format';
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

  const view = await loadCards(session, session.activeHouseholdId, currency);

  const t = await getTranslations('cards');
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';
  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: moneyLocale });

  /** La utilización como porcentaje entero. Un decimal aquí no cambia ninguna decisión. */
  const percent = (ratio: number) => `${String(Math.round(ratio * 100))}%`;

  if (view.isEmpty) {
    return (
      <Page>
        <PageHeader title={t('title')} detail={t('detail')} />
        <Card>
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            action={
              <Link
                href="/debts"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('empty.action')}
              </Link>
            }
          />
        </Card>
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
                    {card.holder && <span>{card.holder}</span>}
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
              {card.creditLimit && card.available && card.utilization !== null && (
                <div className="mt-5">
                  <Gauge
                    value={card.owed}
                    max={card.creditLimit}
                    label={t('list.gauge', { name: card.name })}
                    locale={moneyLocale}
                    tone={card.utilization > 0.3 ? 'caution' : 'neutral'}
                    thresholds={[
                      {
                        at: card.creditLimit.percentage(30),
                        label: t('list.threshold'),
                        kind: 'target',
                      },
                    ]}
                  />
                  <p className="mt-3 text-sm text-[color:var(--color-ink-secondary)]">
                    {t('list.availableOf', {
                      available: money(card.available),
                      limit: money(card.creditLimit),
                      used: percent(card.utilization),
                    })}
                  </p>
                </div>
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
            </Card>
          ))}
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
