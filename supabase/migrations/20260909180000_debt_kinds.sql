-- Qué clase de deuda es, y en qué punto de sus cuotas va.
--
-- La pantalla preguntaba nombre, saldo, tasa, mínimo y «límite de la tarjeta»,
-- con un hint que decía «déjalo vacío si es un préstamo». Eso funciona y es la
-- forma más silenciosa de tratar una hipoteca como una tarjeta a la que le
-- falta un dato: el formulario no sabe qué está mirando, así que no puede
-- esconder lo que no aplica ni ordenar por lo que sí.
--
-- Un préstamo de auto y una hipoteca no tienen cupo —no se «libera» al pagar— y
-- sí tienen algo que una tarjeta no: un final. «Voy 18 de 60» es la cifra que
-- convierte una deuda en un plazo, y es la que la gente sabe de memoria de su
-- préstamo y no sabe de su tarjeta.
--
-- La clase se deduce una vez, al migrar, de lo único que había con qué: quien
-- tenía límite era una tarjeta. Deducir siempre sería adivinar; deducir una vez
-- con lo guardado evita que un hogar reclasifique a mano lo que ya escribió.

create type app.debt_kind as enum (
  'credit_card',
  'auto_loan',
  'mortgage',
  'personal_loan',
  'student_loan',
  'other'
);

alter table app.debts
  add column if not exists kind app.debt_kind not null default 'other',
  -- Cuántas cuotas tiene en total, y cuántas van pagadas. Nulas en una tarjeta,
  -- que no tiene plazo: preguntárselo sería preguntar cuándo termina algo que
  -- por diseño no termina.
  add column if not exists term_months smallint
    check (term_months is null or term_months between 1 and 600),
  add column if not exists paid_months smallint
    check (paid_months is null or paid_months >= 0);

comment on column app.debts.kind is
  'What sort of debt this is. A card has a limit and revolves; a mortgage does not, and asking it for one is asking for a figure that does not exist.';
comment on column app.debts.term_months is
  'How many instalments in total. Null on anything that does not end.';
comment on column app.debts.paid_months is
  'How many are already paid. «18 of 60» is the figure people know by heart about a loan.';

update app.debts
   set kind = (case when credit_limit is not null then 'credit_card' else 'personal_loan' end)::app.debt_kind
 where kind = 'other';

-- Solo una tarjeta tiene cupo. Un límite en una hipoteca es un dato que nadie
-- puede leer, y dejarlo posible es dejar que una pantalla calcule utilización
-- sobre algo que no la tiene.
alter table app.debts
  drop constraint if exists debts_only_cards_have_limits;

alter table app.debts
  add constraint debts_only_cards_have_limits
  check (credit_limit is null or kind = 'credit_card');

-- Y no se pueden llevar pagadas más cuotas de las que hay. Un «22 de 20» no es
-- una deuda adelantada: es un error de tipeo que haría negativo lo que falta.
alter table app.debts
  drop constraint if exists debts_paid_within_term;

alter table app.debts
  add constraint debts_paid_within_term
  check (paid_months is null or term_months is null or paid_months <= term_months);
