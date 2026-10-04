import { describe, expect, it } from 'vitest';

import { resolveRepeatLines, type RepeatFile, type RepeatLine } from './repeat-lines.js';

/**
 * Two screenshots of the same bank list, taken while scrolling. The cases come
 * from real captures: a transfer list whose descriptions the bank cuts short,
 * so two different thousand-dollar transfers on one day read the same.
 */

let counter = 0;
const line = (print: string, date: string, ref: string | null = null): RepeatLine => {
  counter += 1;
  return { id: `${print}#${String(counter)}`, fingerprint: print, date, externalReference: ref };
};
const file = (order: number, lines: RepeatLine[]): RepeatFile => ({
  importId: `f${String(order)}`,
  order,
  lines,
});

describe('resolveRepeatLines', () => {
  it('une las líneas de dos capturas que se solapan', () => {
    const first = file(1, [
      line('a-123', '2026-08-17'),
      line('b-750', '2026-08-05'),
      line('c-5', '2026-08-05'),
      line('d+750', '2026-08-05'),
      line('e-50', '2026-07-28'),
      line('f-1000', '2026-07-24'),
      line('g+1000', '2026-07-24'),
      line('h-1000', '2026-07-21'),
      line('i-1200', '2026-07-21'),
    ]);
    // Starts halfway through 5 August and goes on into March.
    const second = file(2, [
      line('d+750', '2026-08-05'),
      line('e-50', '2026-07-28'),
      line('f-1000', '2026-07-24'),
      line('g+1000', '2026-07-24'),
      line('h-1000', '2026-07-21'),
      line('i-1200', '2026-07-21'),
      line('j-500', '2026-03-19'),
    ]);
    const result = resolveRepeatLines([second, first]);
    expect(result.duplicates).toHaveLength(6);
    expect(result.duplicates.every((d) => d.reason === 'screenshot_overlap')).toBe(true);
    expect(result.duplicates.every((d) => second.lines.some((l) => l.id === d.id))).toBe(true);
  });

  it('no une si entre las fechas compartidas una captura tiene algo que la otra no', () => {
    const first = file(1, [
      line('x', '2026-07-24'),
      line('y', '2026-07-22'),
      line('z', '2026-07-20'),
    ]);
    const second = file(2, [line('x', '2026-07-24'), line('z', '2026-07-20')]);
    expect(resolveRepeatLines([first, second]).duplicates).toHaveLength(0);
  });

  it('une una sola línea cuando es la costura entre dos capturas', () => {
    const first = file(1, [line('p', '2026-09-30'), line('q', '2026-09-29')]);
    const second = file(2, [line('q', '2026-09-29'), line('r', '2026-09-20')]);
    const result = resolveRepeatLines([first, second]);
    expect(result.duplicates).toEqual([{ id: second.lines[0]?.id, reason: 'screenshot_seam' }]);
  });

  it('deja como pregunta una coincidencia suelta en medio de las dos', () => {
    const first = file(1, [
      line('s', '2026-09-30'),
      line('t', '2026-09-15'),
      line('u', '2026-09-01'),
    ]);
    const second = file(2, [
      line('v', '2026-09-28'),
      line('t', '2026-09-15'),
      line('w', '2026-09-02'),
    ]);
    const result = resolveRepeatLines([first, second]);
    expect(result.duplicates).toHaveLength(0);
    expect(result.distinct).toHaveLength(0);
  });

  it('decide por número de referencia cuando las dos copias lo traen', () => {
    const first = file(1, [line('k', '2026-09-10', 'REF-1'), line('m', '2026-09-10', 'REF-7')]);
    const second = file(2, [line('k', '2026-09-10', 'REF-1'), line('m', '2026-09-10', 'REF-9')]);
    const result = resolveRepeatLines([first, second]);
    expect(result.duplicates).toEqual([{ id: second.lines[0]?.id, reason: 'same_reference' }]);
    expect(result.distinct).toEqual(
      expect.arrayContaining([second.lines[1]?.id, first.lines[1]?.id]),
    );
  });

  it('no une más copias de las que la captura vieja mostraba', () => {
    const first = file(1, [line('n', '2026-09-10'), line('o', '2026-09-09')]);
    const second = file(2, [
      line('n', '2026-09-10'),
      line('n', '2026-09-10'),
      line('o', '2026-09-09'),
    ]);
    expect(resolveRepeatLines([first, second]).duplicates).toHaveLength(2);
  });
});
