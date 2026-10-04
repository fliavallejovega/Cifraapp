import type { EdgeLine } from './parsers/ocr.js';

/**
 * Where something may be missing between two captures of the same list.
 *
 * Screenshots of a banking app are taken while scrolling, and a line can end up
 * cut in half at the bottom of one and at the top of the next — read in
 * neither. Nothing in the movements shows that hole: the month just looks
 * cheaper. So each pair of neighbouring captures is checked for continuity:
 *
 *   - they share a line → they overlap, nothing in between;
 *   - the cut line at the top of the older one is the last full line of the
 *     newer one (same day, and same amount when it can be read) → they meet;
 *   - the cut line at the bottom of the newer one is the first full line of
 *     the older one → they meet;
 *   - otherwise something may be missing between the newer one's last day and
 *     the older one's first, and the household is asked.
 *
 * Captures are ordered by their newest full line, newest first, because that is
 * how a banking app lists them. Pure; no database.
 */

export interface CaptureLine {
  readonly fingerprint: string;
  /** ISO `YYYY-MM-DD`. */
  readonly date: string;
  /** Signed decimal string. */
  readonly amount: string;
}

export interface CaptureFile {
  readonly importId: string;
  readonly lines: readonly CaptureLine[];
  /** Lines cut at the edges, as far as they could be read. */
  readonly edges: { readonly top: EdgeLine | null; readonly bottom: EdgeLine | null };
}

export interface CaptureGap {
  /** The capture with the newer movements, and the one that follows it. */
  readonly newerImportId: string;
  readonly olderImportId: string;
  /** Last full day of the newer capture, first full day of the older one. */
  readonly from: string;
  readonly to: string;
  /**
   * How strong the doubt is. `cut_line`: a line cut at the seam belongs to
   * neither side. `days_apart`: the seam jumps two days or more. `no_overlap`:
   * only that the captures do not overlap, so nothing proves they meet.
   */
  readonly evidence: 'cut_line' | 'days_apart' | 'no_overlap';
}

export function findCaptureGaps(files: readonly CaptureFile[]): CaptureGap[] {
  const usable = files
    .filter((file) => file.lines.length > 0)
    .map((file) => {
      const sorted = [...file.lines].sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
      );
      return { file, newest: sorted[0], oldest: sorted.at(-1) };
    })
    .sort((a, b) => ((a.newest?.date ?? '') < (b.newest?.date ?? '') ? 1 : -1));

  const gaps: CaptureGap[] = [];
  for (let i = 0; i + 1 < usable.length; i += 1) {
    const newer = usable[i];
    const older = usable[i + 1];
    if (!newer?.oldest || !older?.newest) continue;

    const prints = new Set(newer.file.lines.map((line) => line.fingerprint));
    if (older.file.lines.some((line) => prints.has(line.fingerprint))) continue;

    // Their ranges overlap without sharing a line: not neighbours in one
    // scroll (another export, another filter). Nothing to say about a seam.
    if (older.newest.date > newer.oldest.date) continue;

    const meets = (edge: EdgeLine | null, full: CaptureLine): boolean =>
      edge !== null &&
      edge.date === full.date &&
      (edge.amount === null || edge.amount === full.amount);

    if (meets(older.file.edges.top, newer.oldest)) continue;
    if (meets(newer.file.edges.bottom, older.newest)) continue;

    const strayCut =
      (Boolean(older.file.edges.top?.date) && older.file.edges.top?.date !== newer.oldest.date) ||
      (newer.file.edges.bottom?.date != null && newer.file.edges.bottom.date !== older.newest.date);
    const days = (Date.parse(newer.oldest.date) - Date.parse(older.newest.date)) / 86_400_000;

    gaps.push({
      newerImportId: newer.file.importId,
      olderImportId: older.file.importId,
      from: newer.oldest.date,
      to: older.newest.date,
      evidence: strayCut ? 'cut_line' : days >= 2 ? 'days_apart' : 'no_overlap',
    });
  }
  return gaps;
}
