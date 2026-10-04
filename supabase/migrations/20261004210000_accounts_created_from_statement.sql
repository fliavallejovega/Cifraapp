-- Una cuenta que la app abrió sola, a partir de un estado de cuenta.
--
-- Subir un archivo ya no exige crear la cuenta antes. Cuando la persona no
-- elige una, el archivo entra a una cuenta provisional; al leerlo, la app la
-- reconoce por los dígitos impresos (y la junta con la que ya existía) o la
-- completa con lo que el estado dice: banco, dígitos, tipo y saldo.
alter table app.accounts
  add column if not exists needs_confirmation boolean not null default false;

comment on column app.accounts.needs_confirmation is
  'Opened by the app for a statement uploaded without an account; filled in or merged once the statement is read.';
