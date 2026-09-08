import 'server-only';

import type { RecordLabels } from '@/components/records/spec';

/**
 * The words a managed list needs, assembled from the catalogue.
 *
 * Half of them are the same on every screen — «Cancel», «Edit», «Could not
 * save», and the whole error dictionary — and half are the screen's own, because
 * «Add another debt» and «Add another goal» are not the same sentence and a
 * product that says «Add item» has stopped talking to anybody.
 *
 * The shared half lives under `records` in the catalogue and is written once.
 * Anything a screen wants to say differently, it overrides.
 */

type Translator = (key: string) => string;

export interface RecordLabelOverrides {
  readonly addAction: string;
  readonly addTitle: string;
  readonly submitCreate: string;
  readonly submitUpdate: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly removeConfirm: string;
  readonly remove?: string;
  readonly removeConfirmYes?: string;
}

export function recordLabels(
  shared: Translator & { raw: (key: string) => unknown },
  overrides: RecordLabelOverrides,
): RecordLabels {
  const errors = shared.raw('errors');

  return {
    addAction: overrides.addAction,
    addTitle: overrides.addTitle,
    submitCreate: overrides.submitCreate,
    submitUpdate: overrides.submitUpdate,
    cancel: shared('cancel'),
    edit: shared('edit'),
    remove: overrides.remove ?? shared('remove'),
    removeConfirm: overrides.removeConfirm,
    removeConfirmYes: overrides.removeConfirmYes ?? shared('removeConfirmYes'),
    emptyTitle: overrides.emptyTitle,
    emptyBody: overrides.emptyBody,
    errorTitle: shared('errorTitle'),
    openDetail: shared('openDetail'),
    errors: isStringRecord(errors) ? errors : {},
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
