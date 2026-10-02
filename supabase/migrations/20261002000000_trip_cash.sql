-- El efectivo del viaje.
--
-- Comprar euros o sacar del cajero en destino es mover dinero, no gastarlo: el
-- banco baja, el efectivo sube, y el gasto ocurre después, billete a billete.
-- La cuenta de efectivo del viaje se lleva en la moneda del hogar —las cuentas
-- de Cifra siguen en USD y PAB— y cada entrada guarda al lado el monto local y
-- la tasa real que se obtuvo, que es la que usan después los gastos en
-- efectivo.

alter table app.trips
  add column cash_account_id uuid references app.accounts (id) on delete set null;

comment on column app.trips.cash_account_id is
  'The cash account this trip draws local currency into. Kept in the household currency; each withdrawal stores the local amount and real rate.';
