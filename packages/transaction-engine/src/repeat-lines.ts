/**
 * Lines read twice: the same movement in two files of the same account.
 *
 * A banking app shows a scrolling list, and nobody screenshots it without
 * overlap — the bottom of one capture is the top of the next. The bank's list
 * also cuts the description short («BANCA MOVIL TRANSFERENCIA ...»), so two
 * real transfers of a thousand on the same day look identical line by line.
 * What tells them apart is not the line: it is the shape around it.
 *
 * This decides what can be decided from evidence, and leaves the rest as a
 * question:
 *
 *   1. **Reference numbers.** When both copies carry one (a PDF or CSV usually
 *      does), equal means one movement and different means two. Nothing else
 *      is as strong.
 *   2. **Overlapping captures.** Two files share a block of lines. Between the
 *      oldest and newest shared dates, both files hold exactly the same lines —
 *      nothing in one that the other lacks. That is one stretch of the list
 *      captured twice, so every shared line in it is one movement. The two
 *      edge days are allowed to differ, because a capture can begin or end
 *      halfway through a day.
 *   3. **The seam.** A single shared line that is the oldest of one file and
 *      the newest of the other is where one capture ends and the next begins.
 *
 *   4. **Same details.** Anything else with the same account, day, amount and
 *      description in two files is merged too — the household's rule — and
 *      reported apart, so it can be checked and undone.
 *
 * Only different reference numbers keep two lines apart. Repeats inside one
 * file are never touched: two equal coffees on one receipt are two coffees.
 *
 * Pure: no database, no dates beyond ISO strings that compare as text.
 */

export interface RepeatLine {
  readonly id: string;
  readonly fingerprint: string;
  /** ISO `YYYY-MM-DD`. */
  readonly date: string;
  readonly externalReference: string | null;
}

export interface RepeatFile {
  readonly importId: string;
  /** Oldest first decides which copy is kept. */
  readonly order: number;
  readonly lines: readonly RepeatLine[];
}

export type RepeatReason =
  'same_reference' | 'screenshot_overlap' | 'screenshot_seam' | 'same_details';

export interface RepeatResolution {
  /** Later copies of a movement already present in an older file. */
  readonly duplicates: readonly { readonly id: string; readonly reason: RepeatReason }[];
  /** Copies proven to be different movements: their references differ. */
  readonly distinct: readonly string[];
}

export function resolveRepeatLines(files: readonly RepeatFile[]): RepeatResolution {
  const ordered = [...files].sort((a, b) => a.order - b.order);
  const duplicates = new Map<string, RepeatReason>();
  const distinct = new Set<string>();

  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const older = ordered[i];
      const newer = ordered[j];
      if (!older || !newer) continue;
      comparePair(older, newer, duplicates, distinct);
    }
  }

  return {
    duplicates: [...duplicates].map(([id, reason]) => ({ id, reason })),
    distinct: [...distinct].filter((id) => !duplicates.has(id)),
  };
}

function comparePair(
  older: RepeatFile,
  newer: RepeatFile,
  duplicates: Map<string, RepeatReason>,
  distinct: Set<string>,
) {
  const byPrint = (file: RepeatFile) => {
    const map = new Map<string, RepeatLine[]>();
    for (const line of file.lines) {
      map.set(line.fingerprint, [...(map.get(line.fingerprint) ?? []), line]);
    }
    return map;
  };
  const left = byPrint(older);
  const right = byPrint(newer);

  // Shared fingerprints whose references do not already settle the matter.
  const shared: string[] = [];
  for (const [print, mine] of left) {
    const theirs = right.get(print);
    if (!theirs) continue;

    const refsLeft = mine.map((line) => line.externalReference).filter(isText);
    const refsRight = theirs.map((line) => line.externalReference).filter(isText);
    if (refsLeft.length === mine.length && refsRight.length === theirs.length) {
      // Every copy carries a reference: the references decide, line by line.
      for (const line of theirs) {
        if (refsLeft.includes(line.externalReference ?? '')) {
          duplicates.set(line.id, 'same_reference');
        } else {
          distinct.add(line.id);
          for (const other of mine) distinct.add(other.id);
        }
      }
      continue;
    }
    shared.push(print);
  }

  if (shared.length === 0) return;

  const markShared = (reason: RepeatReason) => {
    for (const print of shared) {
      const kept = left.get(print)?.length ?? 0;
      // The newer file's copies beyond what the older one holds are lines the
      // older capture never showed: those are not repeats.
      for (const line of (right.get(print) ?? []).slice(0, kept)) {
        if (!duplicates.has(line.id)) duplicates.set(line.id, reason);
      }
    }
  };

  const sharedDates = shared
    .map((print) => left.get(print)?.[0]?.date ?? '')
    .filter(isText)
    .sort();
  const low = sharedDates[0] ?? '';
  const high = sharedDates.at(-1) ?? '';

  if (shared.length >= 2 && low < high) {
    const inside = (file: RepeatFile) =>
      file.lines
        .filter((line) => line.date > low && line.date < high)
        .map((line) => line.fingerprint)
        .sort()
        .join('|');
    if (inside(older) === inside(newer)) {
      markShared('screenshot_overlap');
      return;
    }
  }

  // The seam: a lone shared line on the newest day of one file and the oldest
  // of the other.
  if (shared.length === 1) {
    const range = (file: RepeatFile) => {
      const dates = file.lines.map((line) => line.date).sort();
      return { first: dates[0] ?? '', last: dates.at(-1) ?? '' };
    };
    const a = range(older);
    const b = range(newer);
    if ((low === a.first && low === b.last) || (low === a.last && low === b.first)) {
      markShared('screenshot_seam');
      return;
    }
  }

  // Everything else: same account, same day, same amount, same description in
  // two files. The household decided that is one movement; it is merged and
  // shown with a way back, never deleted.
  markShared('same_details');
}

function isText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
