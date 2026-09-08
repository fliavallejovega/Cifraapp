/**
 * The shape of a managed record, and of the form that edits it.
 *
 * Twelve screens in this product do the same thing: show a list of rows a
 * household owns, let one be added, corrected or removed, and refuse to lose a
 * figure quietly. Writing that twelve times would produce twelve slightly
 * different answers to «what does the delete confirmation say» — and the one
 * that matters, «can I fix a number I got wrong», is exactly the promise the
 * product broke by having none of these screens at all.
 *
 * So the list and the form are one component driven by a description. This
 * module is that description: plain data, built on the server where the words
 * and the money conventions live, handed to the client as props.
 *
 * Field kinds exist for *meaning*, not for markup. `money` is not a number
 * input with a symbol glued on — it is the one kind that never becomes a
 * JavaScript number anywhere between the keyboard and `numeric(19,4)`.
 */

export interface FieldOption {
  readonly value: string;
  readonly label: string;
  /** Groups a long option list, the way an account type list is grouped. */
  readonly group?: string;
}

interface FieldBase {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly required?: boolean;
  /** Half-width on a wide screen. Two short fields read as one line. */
  readonly half?: boolean;
}

export type FieldSpec =
  | (FieldBase & {
      readonly kind: 'text';
      readonly maxLength?: number;
      readonly placeholder?: string;
    })
  | (FieldBase & { readonly kind: 'note'; readonly maxLength?: number })
  | (FieldBase & { readonly kind: 'money' })
  | (FieldBase & { readonly kind: 'rate'; readonly suffix: string })
  | (FieldBase & {
      readonly kind: 'integer';
      readonly min?: number;
      readonly max?: number;
      readonly placeholder?: string;
    })
  | (FieldBase & { readonly kind: 'date' })
  | (FieldBase & { readonly kind: 'select'; readonly options: readonly FieldOption[] })
  | (FieldBase & { readonly kind: 'toggle'; readonly toggleLabel: string });

export type RecordValues = Readonly<Record<string, string>>;

export interface RecordBadge {
  readonly label: string;
  readonly tone: 'neutral' | 'positive' | 'negative' | 'caution' | 'signal';
}

/**
 * One row as the list shows it, already formatted.
 *
 * `values` is the same record as raw form input — the decimal string, the ISO
 * date, the `'true'`. The list never derives what it displays from those; a
 * formatted figure and the string that refills the form are two different
 * things and conflating them is how a balance gets re-saved with a thousands
 * separator in it.
 */
export interface RecordRow {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  /** Formatted for reading, aligned right, in the measurement face. */
  readonly amount?: string;
  readonly amountDetail?: string;
  readonly badges?: readonly RecordBadge[];
  /** A detail screen for this row, when one exists. */
  readonly href?: string;
  readonly values: RecordValues;
  /** Archived, settled, inactive — shown, but not counted. */
  readonly muted?: boolean;
}

export interface RecordActionResult {
  readonly error?: string;
  readonly created?: string;
  readonly ok?: true;
}

export type RecordAction = (
  previous: RecordActionResult,
  formData: FormData,
) => Promise<RecordActionResult>;

export interface RecordLabels {
  /** Every label the manager can show. Filled on the server, from the catalog. */
  readonly addAction: string;
  readonly addTitle: string;
  readonly submitCreate: string;
  readonly submitUpdate: string;
  readonly cancel: string;
  readonly edit: string;
  readonly remove: string;
  readonly removeConfirm: string;
  readonly removeConfirmYes: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
  readonly openDetail?: string;
}
