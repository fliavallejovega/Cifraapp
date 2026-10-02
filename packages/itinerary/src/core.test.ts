import { toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { CORRIDORS } from './catalog/corridors.js';
import { composeGround } from './compose.js';
import { routeRequestsFor } from './days.js';
import { maxDaysInWindow } from './entry.js';
import { estimateConnection, layoverAdvice, pickTransfer } from './flights.js';
import { chargesFor, winterRuleOn } from './roads.js';
import { sunTimes } from './sun.js';
import {
  addMinutes,
  fromInstant,
  minutesBetween,
  toInstant,
  zoneDifferenceMinutes,
} from './zoned.js';

const d = toPlainDate;

describe('zoned times', () => {
  it('reads a local time back unchanged', () => {
    const z = { date: d('2026-12-11'), time: '13:50', timeZone: 'Europe/Rome' };
    expect(fromInstant(toInstant(z), 'Europe/Rome')).toEqual(z);
  });

  it('crosses daylight saving without adding hours by hand', () => {
    // Europe moves to summer time on 2027-03-28 at 02:00.
    const before = { date: d('2027-03-28'), time: '01:30', timeZone: 'Europe/Berlin' };
    expect(addMinutes(before, 60).time).toBe('03:30');
  });

  it('measures across zones', () => {
    const pty = { date: d('2026-12-09'), time: '22:00', timeZone: 'America/Panama' };
    const ist = { date: d('2026-12-10'), time: '18:40', timeZone: 'Europe/Istanbul' };
    expect(minutesBetween(pty, ist)).toBe(760);
    expect(zoneDifferenceMinutes(pty, 'Europe/Istanbul')).toBe(480);
  });
});

describe('sun', () => {
  it('sets in Zurich mid-December around 16:33', () => {
    const t = sunTimes(d('2026-12-15'), 47.3769, 8.5417, 'Europe/Zurich');
    const [h, m] = (t?.sunset.time ?? '00:00').split(':').map(Number) as [number, number];
    expect(Math.abs(h * 60 + m - (16 * 60 + 33))).toBeLessThanOrEqual(4);
  });

  it('returns null in polar night', () => {
    expect(sunTimes(d('2026-12-21'), 78.22, 15.65, 'Arctic/Longyearbyen')).toBeNull();
  });
});

describe('compose', () => {
  const ground = {
    start: { placeId: 'venezia', date: d('2026-12-12') },
    end: { placeId: 'kastrup', date: d('2026-12-23') },
  };

  it('drops the lowest-priority stop when the dates are short, and says so', () => {
    const result = composeGround({
      ground: { ...ground, start: { placeId: 'venezia', date: d('2026-12-13') } },
      anchors: [
        {
          id: 'f',
          kind: 'friends',
          placeId: 'arosa',
          from: d('2026-12-15'),
          to: d('2026-12-16'),
          certainty: 'confirmed',
        },
        {
          id: 'e',
          kind: 'event',
          placeId: 'ravenna',
          from: d('2026-12-19'),
          to: d('2026-12-19'),
          certainty: 'confirmed',
        },
      ],
      wishes: [{ id: 'w', text: 'Dolomitas', tags: ['dolomitas'] }],
      corridors: CORRIDORS,
      sleepNear: { ravenna: 'hinterzarten' },
    });
    expect(result.stays.map((s) => s.placeId).slice(0, 3)).toEqual(['cortina', 'canazei', 'arosa']);
    expect(result.sacrifices).toEqual(
      expect.arrayContaining([{ kind: 'place_removed', placeId: 'bolzano' }]),
    );
  });

  it('flags anchors that cannot both be kept', () => {
    const result = composeGround({
      ground,
      anchors: [
        {
          id: 'a',
          kind: 'stay',
          placeId: 'arosa',
          from: d('2026-12-15'),
          to: d('2026-12-18'),
          certainty: 'confirmed',
        },
        {
          id: 'b',
          kind: 'event',
          placeId: 'hinterzarten',
          from: d('2026-12-17'),
          to: d('2026-12-17'),
          certainty: 'confirmed',
        },
      ],
      wishes: [],
      corridors: CORRIDORS,
    });
    expect(result.notices.map((n) => n.code)).toContain('anchors_overlap');
  });

  it('says when a wish matches nothing it knows', () => {
    const result = composeGround({
      ground,
      anchors: [],
      wishes: [{ id: 'w', text: 'Ver auroras boreales', tags: ['auroras'] }],
      corridors: CORRIDORS,
    });
    expect(result.wishes).toEqual([{ wishId: 'w', corridorId: null }]);
    expect(result.notices.map((n) => n.code)).toContain('wish_unmatched');
  });
});

describe('routing requests', () => {
  it('splits a drive at the ferry', () => {
    expect(routeRequestsFor(['hamburg', 'luebeck', 'puttgarden', 'roedby', 'kastrup'])).toEqual([
      { points: ['hamburg', 'luebeck', 'puttgarden'], mode: 'car' },
      { points: ['puttgarden', 'roedby'], mode: 'ferry' },
      { points: ['roedby', 'kastrup'], mode: 'car' },
    ]);
  });
});

describe('flights', () => {
  it('estimates the connection a ticket does not print', () => {
    const pair = estimateConnection(
      {
        from: 'PTY',
        via: 'IST',
        to: 'VCE',
        departs: { date: d('2026-12-09'), time: '22:00', timeZone: 'America/Panama' },
        arrives: { date: d('2026-12-11'), time: '13:50', timeZone: 'Europe/Rome' },
      },
      ['a', 'b'],
    );
    expect(pair?.[0].arrives).toEqual({
      date: d('2026-12-10'),
      time: '18:40',
      timeZone: 'Europe/Istanbul',
    });
    expect(pair?.[0].arrivesCertainty).toBe('estimated');
    expect(pair?.[1].departsCertainty).toBe('estimated');
    expect(pair?.[1].arrivesCertainty).toBe('confirmed');
  });

  it('takes a taxi when the metro is closed', () => {
    const late = pickTransfer('IST', {
      date: d('2026-12-10'),
      time: '01:30',
      timeZone: 'Europe/Istanbul',
    });
    expect(late?.option.mode).toBe('taxi');
    expect(late?.notices.map((n) => n.code)).toContain('transfer_not_running');
  });

  it('offers the airline stopover only past 20 hours in Istanbul', () => {
    const arrive = {
      id: 'x',
      from: 'PTY',
      to: 'IST',
      departs: { date: d('2026-12-09'), time: '22:00', timeZone: 'America/Panama' },
      departsCertainty: 'confirmed' as const,
      arrives: { date: d('2026-12-10'), time: '06:00', timeZone: 'Europe/Istanbul' },
      arrivesCertainty: 'confirmed' as const,
    };
    const leave = (time: string, date = '2026-12-11') => ({
      ...arrive,
      id: 'y',
      from: 'IST',
      to: 'VCE',
      departs: { date: d(date), time, timeZone: 'Europe/Istanbul' },
      arrives: { date: d(date), time: '23:00', timeZone: 'Europe/Rome' },
    });
    expect(layoverAdvice(arrive, leave('09:00'))?.options).toContain('airline_stopover');
    expect(layoverAdvice(arrive, leave('20:00', '2026-12-10'))?.options).not.toContain(
      'airline_stopover',
    );
    expect(layoverAdvice(arrive, leave('09:00', '2026-12-10'))).toBeNull();
  });
});

describe('roads', () => {
  it('applies the Austrian winter-tyre rule only in season', () => {
    expect(winterRuleOn('AT', d('2026-12-15'))?.kind).toBe('winter_tyres_in_conditions');
    expect(winterRuleOn('AT', d('2026-07-15'))).toBeNull();
    expect(winterRuleOn('CH', d('2026-12-15'))?.kind).toBe('no_specific_law');
  });

  it('buys the Austrian and Swiss vignettes, the Arlberg toll and the ferry before first use', () => {
    const needs = chargesFor([
      {
        date: d('2026-12-15'),
        countries: ['IT', 'AT', 'CH'],
        points: ['bolzano', 'stanton', 'arosa'],
        ferry: false,
      },
      {
        date: d('2026-12-17'),
        countries: ['CH', 'DE'],
        points: ['arosa', 'hinterzarten'],
        ferry: false,
      },
      {
        date: d('2026-12-23'),
        countries: ['DE', 'DK'],
        points: ['hamburg', 'kastrup'],
        ferry: true,
      },
    ]);
    expect(needs.map((n) => [n.charge.id, n.firstUse.slice(8)])).toEqual([
      ['at-vignette-10d', '15'],
      ['ch-vignette-year', '15'],
      ['it-motorway', '15'],
      ['at-arlberg-tunnel', '15'],
      ['scandlines-puttgarden-rodby', '23'],
    ]);
  });
});

describe('entry windows', () => {
  it('counts the worst 180-day window', () => {
    const days = [
      d('2026-01-01'),
      d('2026-01-02'),
      d('2026-06-29'),
      d('2026-06-30'),
      d('2026-12-30'),
    ];
    expect(maxDaysInWindow(days, 180)).toBe(3);
  });
});
