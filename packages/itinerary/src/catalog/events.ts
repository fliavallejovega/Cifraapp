import { toPlainDate, type PlainDate } from '@app/domain';

import type { Certainty, SourceRef } from '../types.js';

/**
 * Events with their own rules: dates, opening hours by weekday, and how the
 * tickets are sold. Some sell out within hours; for those the planner keeps
 * the day the sale opens and reminds the person before it.
 */

export interface EventInfo {
  readonly placeId: string;
  readonly name: string;
  readonly from: PlainDate;
  readonly to: PlainDate;
  /** `HH:MM`–`HH:MM` by weekday (0 = Sunday); absent weekdays are closed. */
  readonly hours: Readonly<Partial<Record<number, readonly [string, string]>>>;
  readonly onlineTicketsOnly: boolean;
  readonly saleOpensOn: PlainDate | null;
  readonly saleOpensAt?: string;
  readonly ticketUrl: string;
  /** It sold out within a day last season: book the moment the sale opens. */
  readonly sellsOutFast: boolean;
  /** The organiser warns against resale. */
  readonly resaleWarning: boolean;
  readonly certainty: Certainty;
  readonly source: SourceRef;
}

export const EVENTS: readonly EventInfo[] = [
  {
    placeId: 'ravenna',
    name: 'Weihnachtsmarkt Ravennaschlucht',
    from: toPlainDate('2026-11-26'),
    to: toPlainDate('2026-12-20'),
    hours: {
      4: ['16:00', '21:00'],
      5: ['14:00', '21:00'],
      6: ['14:00', '21:00'],
      0: ['14:00', '21:00'],
    },
    onlineTicketsOnly: true,
    saleOpensOn: toPlainDate('2026-10-14'),
    saleOpensAt: '10:00',
    ticketUrl: 'https://www.hochschwarzwald.de/weihnachtsmarkt-ravennaschlucht',
    // 75 000 tickets went in under a day in 2025.
    sellsOutFast: true,
    resaleWarning: true,
    certainty: 'confirmed',
    source: {
      name: 'Hochschwarzwald Tourismus — Weihnachtsmarkt Ravennaschlucht',
      url: 'https://www.hochschwarzwald.de/weihnachtsmarkt-ravennaschlucht',
      checkedOn: toPlainDate('2026-10-02'),
    },
  },
];

export function eventAt(placeId: string): EventInfo | null {
  return EVENTS.find((e) => e.placeId === placeId) ?? null;
}
