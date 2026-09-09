-- De quién es la deuda, y la cuenta que la lleva.
--
-- Dos huecos que se notaban juntos. El primero: una deuda no sabía de quién
-- era. Un hogar de dos con «Visa Davo» y «Master Card Blei» tiene esa
-- información en el nombre, que es donde la información va a morir — ninguna
-- consulta puede leerla y ninguna pantalla puede agrupar por persona.
--
-- El segundo: `debts.account_id` existía desde el modelo original y nada lo
-- llenaba nunca. El efecto práctico es que un estado de cuenta de tarjeta no
-- tenía contra qué importarse: las únicas cuentas del sistema eran las de
-- banco, y las tarjetas vivían como deudas sin movimientos. Para conciliar de
-- verdad una tarjeta tiene que ser una cuenta como cualquier otra, con su
-- saldo, sus movimientos y su cupo.
--
-- Lo que esta migración *no* hace es decidir cuáles de las deudas de un hogar
-- son tarjetas. Las tres de este hogar se llaman «Visa» y «Master Card» y
-- están registradas con clase `other`; adivinar por el nombre es exactamente la
-- clase de inferencia que este sistema no hace sobre datos financieros. La
-- conversión la pide el hogar, deuda por deuda, desde la pantalla.

alter table app.debts
  add column if not exists person_id uuid references app.household_people (id) on delete set null;

comment on column app.debts.person_id is
  'Whose debt this is, within the household. Null means the household''s, not unknown.';

create index if not exists debts_person_idx on app.debts (household_id, person_id);

-- La cuenta que respalda la deuda es única: dos deudas apuntando a la misma
-- tarjeta contarían sus movimientos dos veces.
create unique index if not exists debts_account_unique
  on app.debts (account_id)
  where account_id is not null and deleted_at is null;

comment on column app.debts.account_id is
  'The account that carries this debt''s movements — a credit card is an account like any other. The two balances are kept separately on purpose: the account holds what the bank says today, the debt holds what the household is managing, and the day they differ that gap is the finding.';
