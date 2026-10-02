import { describe, expect, it } from 'vitest';

import { parseTicketText } from './rumbo-ticket';

describe('a ticket pasted as text', () => {
  it('reads the Turkish Airlines journeys and estimates the Istanbul connections', () => {
    const text = `Turkish Airlines — Reservation PNR ABC123
PTY - VCE
09 Dec 2026 22:00 Panama City
11 Dec 2026 13:50 Venice   Duration 32h 50m
CPH - PTY
26 Dec 2026 10:35 Copenhagen
27 Dec 2026 17:10 Panama City`;
    const { segments, unread } = parseTicketText(text, '2026-10-02');
    expect(unread).toBe(0);
    expect(segments.map((s) => `${s.from}-${s.to}`)).toEqual([
      'PTY-IST',
      'IST-VCE',
      'CPH-IST',
      'IST-PTY',
    ]);
    expect(segments[0]?.departs).toEqual({
      date: '2026-12-09',
      time: '22:00',
      timeZone: 'America/Panama',
    });
    expect(segments[0]?.departsCertainty).toBe('confirmed');
    expect(segments[0]?.arrivesCertainty).toBe('estimated');
    expect(segments[3]?.departs.time).toBe('06:40');
  });

  it('skips what it cannot read instead of guessing', () => {
    const { segments, unread } = parseTicketText('VCE - CPH\nfecha por confirmar', '2026-10-02');
    expect(segments).toEqual([]);
    expect(unread).toBe(1);
  });
});
