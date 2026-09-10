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
  /**
   * Sólo se muestra cuando otro campo vale una de estas cosas.
   *
   * Un formulario que enseña todos los campos de todas las formas posibles le
   * pide a una hipoteca un límite de tarjeta y a una tarjeta un día de corte
   * que no usa. Peor que feo: cada campo que no aplica es una decisión que se
   * le traslada a alguien para nada, y un campo vacío junto a otro lleno se lee
   * como un dato que falta.
   *
   * Lo que no se muestra tampoco se envía, así que cambiar de tipo limpia lo
   * que dejó de tener sentido en vez de guardarlo escondido.
   */
  readonly showWhen?: { readonly field: string; readonly is: readonly string[] };
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
  /**
   * One extra thing this row can be told, beside edit and remove.
   *
   * The label is computed on the server per row rather than derived in the
   * client, because it is a sentence about *this* row's state — «Ya lo pagué»
   * against «Deshacer el pago» — and a client that inferred it from `muted`
   * would be guessing at the meaning of a flag that means different things on
   * different screens.
   */
  readonly action?:
    | {
        readonly label: string;
        /** Submitted as `intent`, so one action can serve both directions. */
        readonly intent: string;
      }
    | undefined;
}

export interface RecordActionResult {
  readonly error?: string;
  readonly created?: string;
  readonly ok?: true;
  /**
   * Un valor que se enseña una vez y no se puede volver a leer.
   *
   * Un enlace de calendario, un token de invitación: lo que se guarda es su
   * hash, así que este viaje de vuelta es la única oportunidad de copiarlo. La
   * pantalla que lo reciba tiene que decirlo con esas palabras.
   */
  readonly secret?: string;
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
