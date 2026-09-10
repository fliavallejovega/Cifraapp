-- Lo que hace falta saber de una fila **antes** de confirmarla.
--
-- El orden estaba al revés. Se confirmaba a ciegas y recién después corrían el
-- barrido de duplicados entre cuentas, la detección de transferencias y la
-- categorización. Quien aprobaba una lista no podía ver que un cargo ya lo había
-- anotado su pareja a mano en otra cuenta, ni con qué rubro iba a quedar, ni qué
-- le iba a hacer al presupuesto del mes.
--
-- Aprobar algo que todavía no se puede mirar no es aprobar: es firmar.

-- La cuenta donde vive la coincidencia, cuando no es la que se está importando.
-- Es la mitad de la frase que hace útil una alerta: «esto ya está registrado» no
-- sirve; «esto ya lo anotó Vale en su cuenta el 7» sí.
alter table app.import_rows
  add column if not exists matched_account_id uuid references app.accounts (id) on delete set null;

-- La categoría que el motor propone, resuelta antes de confirmar.
alter table app.import_rows
  add column if not exists proposed_category_id uuid references app.categories (id) on delete set null;

alter table app.import_rows
  add column if not exists proposed_confidence numeric(4, 3);

-- De dónde salió la propuesta: `rule`, `merchant`, `ai`, o nulo si de ninguna.
-- Se enseña. Una categoría propuesta por una regla que la casa escribió y una
-- adivinada por un modelo merecen distinta confianza, y esconder cuál es cuál
-- las iguala hacia abajo.
alter table app.import_rows
  add column if not exists proposed_source text;

-- El rubro que la persona eligió en la revisión, que gana sobre la propuesta.
alter table app.import_rows
  add column if not exists chosen_category_id uuid references app.categories (id) on delete set null;

-- La deuda a la que esta fila se va a aplicar al confirmar, cuando alguien lo
-- pidió en la revisión. Nula es lo normal.
alter table app.import_rows
  add column if not exists apply_to_debt_id uuid references app.debts (id) on delete set null;

-- Lo que la IA opinó sobre si esto es un duplicado, marcado como suyo.
--
-- Se guarda aparte del veredicto determinista a propósito. El veredicto es del
-- motor; esto es una segunda lectura que puede *subir* una fila a revisión y
-- nunca archivarla ni descartarla. Mezclarlos en una columna borraría para
-- siempre quién dijo qué.
alter table app.import_rows
  add column if not exists ai_opinion text;

alter table app.import_rows
  add column if not exists ai_reason text;

create index if not exists import_rows_proposed_category_idx
  on app.import_rows (import_id)
  where proposed_category_id is not null;

comment on column app.import_rows.ai_opinion is
  'La segunda lectura de un modelo sobre si esta fila ya estaba registrada: same, different o unsure. Puede subir la fila a revisión; nunca archivarla ni descartarla.';
