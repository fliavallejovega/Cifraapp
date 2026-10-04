import { describe, expect, it } from 'vitest';
import type { PlainDate } from '@app/domain';

import { findCaptureGaps, type CaptureFile } from './capture-gaps.js';

/** Built from real captures of a banking app taken while scrolling. */

const file = (
  id: string,
  lines: [string, string, string][],
  edges: CaptureFile['edges'] = { top: null, bottom: null },
): CaptureFile => ({
  importId: id,
  lines: lines.map(([fingerprint, date, amount]) => ({ fingerprint, date, amount })),
  edges,
});

describe('findCaptureGaps', () => {
  it('no ve hueco cuando las capturas se solapan', () => {
    const a = file('a', [
      ['x', '2026-08-05', '750'],
      ['y', '2026-07-28', '-50'],
    ]);
    const b = file('b', [
      ['y', '2026-07-28', '-50'],
      ['z', '2026-07-21', '-1000'],
    ]);
    expect(findCaptureGaps([b, a])).toEqual([]);
  });

  it('no ve hueco cuando la línea cortada arriba es la última completa de la anterior', () => {
    const a = file('a', [
      ['p', '2026-09-23', '-5'],
      ['q', '2026-09-17', '-6'],
    ]);
    const b = file(
      'b',
      [
        ['r', '2026-09-17', '400'],
        ['s', '2026-09-10', '-100'],
      ],
      {
        top: { date: '2026-09-17' as PlainDate, amount: null, description: 'YAPPY BG A JHASLENE' },
        bottom: null,
      },
    );
    expect(findCaptureGaps([a, b])).toEqual([]);
  });

  it('avisa cuando la línea cortada arriba es de otro día', () => {
    const a = file('a', [
      ['p', '2026-09-29', '150'],
      ['q', '2026-09-24', '5'],
    ]);
    const b = file(
      'b',
      [
        ['r', '2026-09-23', '-5'],
        ['s', '2026-09-17', '-6'],
      ],
      {
        top: { date: '2026-09-23' as PlainDate, amount: null, description: '' },
        bottom: null,
      },
    );
    expect(findCaptureGaps([a, b])).toEqual([
      {
        newerImportId: 'a',
        olderImportId: 'b',
        from: '2026-09-24',
        to: '2026-09-23',
        evidence: 'cut_line',
      },
    ]);
  });

  it('avisa cuando una línea quedó cortada en las dos y no se ve la fecha', () => {
    const a = file(
      'a',
      [
        ['p', '2026-09-29', '-150'],
        ['q', '2026-08-21', '50'],
      ],
      {
        top: null,
        bottom: { date: null, amount: null, description: 'BANCA MOVIL PAGO VISA 4468-...' },
      },
    );
    const b = file('b', [
      ['r', '2026-08-17', '-123'],
      ['s', '2026-07-21', '2250'],
    ]);
    expect(findCaptureGaps([a, b])).toEqual([
      {
        newerImportId: 'a',
        olderImportId: 'b',
        from: '2026-08-21',
        to: '2026-08-17',
        evidence: 'days_apart',
      },
    ]);
  });

  it('sin solape ni evidencia, en el mismo día, es solo una duda menor', () => {
    const a = file('a', [
      ['p', '2026-09-20', '-1'],
      ['q', '2026-09-17', '-6'],
    ]);
    const b = file('b', [
      ['r', '2026-09-17', '400'],
      ['s', '2026-09-10', '-100'],
    ]);
    expect(findCaptureGaps([a, b])[0]?.evidence).toBe('no_overlap');
  });
});
