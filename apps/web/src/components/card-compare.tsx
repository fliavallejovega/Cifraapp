'use client';

import { Card, EmptyState, Status } from '@app/ui';
import { useState } from 'react';

/**
 * Cuál de tus tarjetas conviene aquí.
 *
 * Se elige la categoría y la pantalla ordena. Lo que se enseña es **la frase
 * que la fuente escribió**, no una cifra que este producto haya calculado: «3%
 * hasta $200 al mes» y «3%» deciden cosas distintas, y quedarse con el 3
 * tiraría la mitad de la información.
 *
 * ## Tres grupos y no una lista
 *
 * Las que tienen cifra, ordenadas. Las que dicen algo sin cifra comparable
 * —millas, salas VIP— aparte. Y las vencidas, aparte también. Poner una tarjeta
 * cuyo beneficio nadie cargó debajo de la que da 1% afirmaría que da menos, y
 * eso nadie lo sabe.
 */

export interface CompareOffer {
  readonly cardId: string;
  readonly cardName: string;
  readonly issuerName: string | null;
  readonly headline: string;
  readonly detail: string | null;
  readonly isVerified: boolean;
  readonly isOwned: boolean;
  readonly capturedOn: string;
  readonly rate: number | null;
  readonly position: number;
}

export interface CardCompareLabels {
  readonly title: string;
  readonly detail: string;
  readonly category: string;
  readonly categories: Readonly<Record<string, string>>;
  readonly best: string;
  readonly unquantified: string;
  readonly unquantifiedHint: string;
  readonly expired: string;
  readonly mine: string;
  readonly notMine: string;
  readonly unverified: string;
  readonly capturedOn: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
}

export function CardCompare({
  categories,
  byCategory,
  labels,
}: {
  readonly categories: readonly string[];
  /** Ya comparado en el servidor, una entrada por categoría. */
  readonly byCategory: Readonly<
    Record<
      string,
      {
        readonly ranked: readonly CompareOffer[];
        readonly unquantified: readonly CompareOffer[];
        readonly expired: readonly CompareOffer[];
      }
    >
  >;
  readonly labels: CardCompareLabels;
}) {
  const [category, setCategory] = useState(categories[0] ?? '');
  const result = byCategory[category];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="compare-category" className="text-sm">
          {labels.category}
        </label>
        <select
          id="compare-category"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
          }}
          className="min-h-11 rounded-(--radius-sm) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-3 text-sm"
        >
          {categories.map((one) => (
            <option key={one} value={one}>
              {labels.categories[one] ?? one}
            </option>
          ))}
        </select>
      </div>

      {!result || (result.ranked.length === 0 && result.unquantified.length === 0) ? (
        <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />
      ) : (
        <>
          {result.ranked.length > 0 && (
            <ol className="flex list-none flex-col gap-3 p-0">
              {result.ranked.map((offer) => (
                <li key={`${offer.cardId}-${offer.headline}`}>
                  <Card {...(offer.position === 1 ? {} : { tone: 'sunk' as const })}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{offer.cardName}</span>
                      {offer.position === 1 && <Status tone="positive">{labels.best}</Status>}
                    </div>
                    <p className="mt-1 text-sm">{offer.headline}</p>
                    {offer.detail && (
                      <p className="mt-1 text-xs text-pretty text-[color:var(--color-ink-secondary)]">
                        {offer.detail}
                      </p>
                    )}
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--color-ink-tertiary)]">
                      {offer.issuerName && <span>{offer.issuerName}</span>}
                      <Status tone={offer.isOwned ? 'neutral' : 'signal'}>
                        {offer.isOwned ? labels.mine : labels.notMine}
                      </Status>
                      {!offer.isVerified && <Status tone="caution">{labels.unverified}</Status>}
                      <span>{labels.capturedOn.replace('{date}', offer.capturedOn)}</span>
                    </p>
                  </Card>
                </li>
              ))}
            </ol>
          )}

          {result.unquantified.length > 0 && (
            <section>
              <h4 className="text-sm font-medium">{labels.unquantified}</h4>
              <p className="mt-1 max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-secondary)]">
                {labels.unquantifiedHint}
              </p>
              <ul className="mt-3 flex list-none flex-col p-0">
                {result.unquantified.map((offer) => (
                  <li
                    key={`${offer.cardId}-${offer.headline}`}
                    className="border-b border-[color:var(--color-rule)] py-2 last:border-b-0"
                  >
                    <span className="text-sm font-medium">{offer.cardName}</span>
                    <span className="ml-2 text-sm text-[color:var(--color-ink-secondary)]">
                      {offer.headline}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.expired.length > 0 && (
            <section>
              <h4 className="text-sm font-medium text-[color:var(--color-ink-secondary)]">
                {labels.expired}
              </h4>
              <ul className="mt-2 flex list-none flex-col p-0">
                {result.expired.map((offer) => (
                  <li
                    key={`${offer.cardId}-${offer.headline}`}
                    className="py-1 text-sm text-[color:var(--color-ink-tertiary)] line-through"
                  >
                    {offer.cardName} · {offer.headline}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
