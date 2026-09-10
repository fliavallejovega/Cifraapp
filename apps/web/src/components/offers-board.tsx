'use client';

import { Card, EmptyState, Status } from '@app/ui';
import { useMemo, useState } from 'react';

/**
 * Las ofertas del mes, filtrables.
 *
 * ## Tres filtros y ningún buscador
 *
 * «Sólo las mías», por banco y por categoría. No hay caja de búsqueda porque la
 * lista cabe en una pantalla y un buscador sobre veinte filas es un campo que
 * obliga a saber qué se busca — y quien abre esta pantalla viene justamente a
 * ver qué hay.
 *
 * ## Por qué las ajenas no se esconden
 *
 * Saber que el banco de al lado da 50% donde el tuyo no da nada es información,
 * no ruido: es, de hecho, cómo alguien decide abrir una cuenta. Van detrás, no
 * fuera.
 *
 * ## Confirmado y leído
 *
 * Una promoción que leyó el barrido automático lleva su marca. No está
 * escondida —una oferta que nadie sube es una oferta que nadie usa— pero
 * tampoco se presenta como comprobada, que es la diferencia entre informar y
 * afirmar.
 */

export interface OfferRow {
  readonly id: string;
  readonly issuerKey: string;
  readonly issuerName: string;
  readonly merchantName: string;
  readonly merchantNote: string | null;
  readonly category: string | null;
  readonly headline: string;
  readonly detail: string | null;
  readonly cap: string | null;
  readonly weekdayNames: readonly string[];
  readonly validUntil: string | null;
  readonly channel: string | null;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly capturedOn: string;
  readonly isVerified: boolean;
  readonly isMine: boolean;
  readonly usableWith: readonly string[];
  readonly isToday: boolean;
}

export interface OffersBoardLabels {
  readonly onlyMine: string;
  readonly allCards: string;
  readonly everyIssuer: string;
  readonly everyCategory: string;
  readonly categories: Readonly<Record<string, string>>;
  readonly payWith: string;
  readonly notYours: string;
  readonly today: string;
  /**
   * Qué se dice cuando la fuente no declaró días.
   *
   * No «todos los días». Ese texto era una afirmación que ninguna página del
   * banco había hecho, y venía con un «Hoy» verde encima.
   */
  readonly daysUnknown: string;
  readonly until: string;
  readonly cap: string;
  readonly unverified: string;
  readonly capturedOn: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly noneMatch: string;
}

export function OffersBoard({
  offers,
  issuers,
  categories,
  labels,
}: {
  readonly offers: readonly OfferRow[];
  readonly issuers: readonly { readonly key: string; readonly name: string }[];
  readonly categories: readonly string[];
  readonly labels: OffersBoardLabels;
}) {
  const [onlyMine, setOnlyMine] = useState(false);
  const [issuer, setIssuer] = useState('');
  const [category, setCategory] = useState('');

  const shown = useMemo(
    () =>
      offers.filter(
        (offer) =>
          (!onlyMine || offer.isMine) &&
          (issuer === '' || offer.issuerKey === issuer) &&
          (category === '' || offer.category === category),
      ),
    [offers, onlyMine, issuer, category],
  );

  if (offers.length === 0) {
    return <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* El filtro que más se usa, primero y como interruptor: es una pregunta
            de sí o no, y un selector de dos opciones sería una pregunta de más. */}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(event) => {
              setOnlyMine(event.target.checked);
            }}
            className="h-4 w-4 accent-[color:var(--color-brand)]"
          />
          {labels.onlyMine}
        </label>

        <select
          aria-label={labels.everyIssuer}
          value={issuer}
          onChange={(event) => {
            setIssuer(event.target.value);
          }}
          className="min-h-11 rounded-(--radius-sm) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-3 text-sm"
        >
          <option value="">{labels.everyIssuer}</option>
          {issuers.map((one) => (
            <option key={one.key} value={one.key}>
              {one.name}
            </option>
          ))}
        </select>

        <select
          aria-label={labels.everyCategory}
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
          }}
          className="min-h-11 rounded-(--radius-sm) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-3 text-sm"
        >
          <option value="">{labels.everyCategory}</option>
          {categories.map((one) => (
            <option key={one} value={one}>
              {labels.categories[one] ?? one}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-[color:var(--color-ink-secondary)]">{labels.noneMatch}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((offer) => (
            <Card key={offer.id} {...(offer.isMine ? {} : { tone: 'sunk' as const })}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-medium break-words">{offer.merchantName}</h3>
                {offer.isToday && offer.isMine && (
                  <Status tone="positive">{labels.today}</Status>
                )}
              </div>

              <p className="mt-1 text-lg font-medium text-[color:var(--color-ink)]">
                {offer.headline}
              </p>

              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--color-ink-secondary)]">
                <span className="font-medium">{offer.issuerName}</span>
                {offer.category && <span>{labels.categories[offer.category] ?? offer.category}</span>}
                <span>
                  {offer.weekdayNames.length === 0
                    ? labels.daysUnknown
                    : offer.weekdayNames.join(', ')}
                </span>
                {offer.validUntil && (
                  <span>{labels.until.replace('{date}', offer.validUntil)}</span>
                )}
              </p>

              {offer.detail && (
                <p className="mt-3 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                  {offer.detail}
                </p>
              )}

              {offer.merchantNote && (
                <p className="mt-1 text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
                  {offer.merchantNote}
                </p>
              )}

              {offer.cap && (
                <p className="mt-2 text-xs text-[color:var(--color-ink-tertiary)]">
                  {labels.cap.replace('{cap}', offer.cap)}
                </p>
              )}

              {offer.channel && (
                <p className="mt-1 text-xs text-[color:var(--color-caution)]">{offer.channel}</p>
              )}

              {/* La respuesta a «¿con cuál pago?», que es la pregunta entera. */}
              <p className="mt-3 border-t border-[color:var(--color-rule)] pt-3 text-sm">
                {offer.isMine ? (
                  <span className="text-[color:var(--color-ink)]">
                    {labels.payWith.replace('{cards}', offer.usableWith.join(', '))}
                  </span>
                ) : (
                  <span className="text-[color:var(--color-ink-tertiary)]">{labels.notYours}</span>
                )}
              </p>

              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--color-ink-tertiary)]">
                {!offer.isVerified && <Status tone="caution">{labels.unverified}</Status>}
                <span>{labels.capturedOn.replace('{date}', offer.capturedOn)}</span>
                <a
                  href={offer.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                >
                  {offer.sourceName}
                </a>
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
