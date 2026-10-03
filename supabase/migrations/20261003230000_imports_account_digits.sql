-- De qué cuenta dice ser el estado, y a cuál se subió.
--
-- Gastos familiares pone una zona por cuenta y por persona, y tarde o temprano
-- el estado de la Visa de una persona cae en la Visa de la otra. Los movimientos
-- quedan en el libro equivocado con cara de estar bien. El banco imprime el
-- número (enmascarado en una tarjeta), así que el importador lo lee y lo guarda
-- junto a la importación: si no coincide con la cuenta elegida, la pantalla de
-- revisión lo dice y sugiere la cuenta que sí coincide. Nunca la mueve sola.
alter table app.imports
  add column if not exists stated_account_digits text,
  add column if not exists suggested_account_id uuid
    references app.accounts (id) on delete set null;

comment on column app.imports.stated_account_digits is
  'Últimos cuatro dígitos de la cuenta o tarjeta tal como los imprime el estado. Nulo cuando el documento no los trae o no se leyeron con claridad.';
comment on column app.imports.suggested_account_id is
  'La cuenta del hogar cuyos dígitos coinciden con los del estado, cuando no es la elegida al subirlo. Es una sugerencia: la persona decide si mover la importación.';
