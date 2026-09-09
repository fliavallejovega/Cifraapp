-- Qué piensa hacer la casa con cada posición.
--
-- Tener una posición y saber qué se va a hacer con ella son dos hechos
-- distintos, y hasta aquí el producto sólo guardaba el primero. La consecuencia
-- práctica es que medio bitcoin y diez acciones se leían igual —dos filas con un
-- valor— cuando para el hogar son cosas opuestas: una es la reserva que no se
-- toca en cinco años y la otra es lo que se piensa vender el mes que viene para
-- el fondo de emergencia. Sin esa diferencia, cualquier lectura de «qué tengo
-- disponible» está mal para una de las dos.
--
-- ## Lo que esto NO es
--
-- No es una recomendación. El producto **no opina** sobre si conviene vender,
-- mantener o cambiar de instrumento: eso es asesoría de inversión, hace falta
-- licencia para darla, y los términos de servicio dicen con todas sus letras que
-- Cifraapp no es un asesor. Lo que se guarda aquí es **lo que la persona
-- decidió**, dicho por ella, para que el resto del sistema pueda dejar de
-- adivinarlo.
--
-- La diferencia se nota en el orden: primero la casa declara, después el
-- producto calcula la consecuencia. Al revés sería el producto sugiriendo una
-- operación y la casa confirmándola, que es exactamente lo que no puede hacer.
--
-- ## Los cuatro valores
--
--   long_term    No se toca. Un horizonte de años, no de meses.
--   hold         Se mantiene por ahora, sin plazo declarado.
--   exit         Se quiere salir: esto va a volverse efectivo.
--   reallocate   Se quiere mover a otro instrumento.
--
-- `null` es «nadie lo ha dicho», que no es lo mismo que `hold`. Un valor por
-- defecto convertiría el silencio de todo el mundo en una decisión que nadie
-- tomó, y después el plan leería esa decisión como si fuera cierta.

create type app.holding_intent as enum ('long_term', 'hold', 'exit', 'reallocate');

alter table app.holdings
  add column if not exists intent         app.holding_intent,
  -- Para cuándo, cuando la decisión tiene fecha. «Salgo cuando termine el
  -- semestre» es una respuesta real; obligar a una fecha exacta la volvería
  -- falsa, así que es opcional como todo lo demás que este esquema fecha.
  add column if not exists intent_horizon date,
  -- El porqué, en las palabras de la casa. Es lo que hace que la decisión siga
  -- teniendo sentido cuando alguien la relea en marzo.
  add column if not exists intent_note    text check (intent_note is null or length(intent_note) <= 500),
  -- Cuándo se decidió. Una decisión de hace dos años sobre un mercado que se
  -- movió no es la misma decisión, y la pantalla tiene que poder decir eso.
  add column if not exists intent_set_at  timestamptz;

-- Una nota o una fecha sin decisión es un dato huérfano: describe una intención
-- que no existe. La base lo rechaza en vez de dejar que la pantalla lo interprete.
alter table app.holdings
  drop constraint if exists holdings_intent_detail_needs_intent;
alter table app.holdings
  add constraint holdings_intent_detail_needs_intent
  check (
    intent is not null
    or (intent_horizon is null and intent_note is null and intent_set_at is null)
  );

comment on column app.holdings.intent is
  'What the household decided to do with this position. Stated by them, never suggested by the product: recommending a trade is investment advice and this is not an adviser. Null means nobody has said, which is not the same as «hold».';
comment on column app.holdings.intent_horizon is
  'When, if the decision has a date. Optional: «when the term ends» is a real answer and forcing an exact day would turn it into a false one.';
comment on column app.holdings.intent_set_at is
  'When it was decided. A two-year-old decision about a market that moved is not the same decision, and the screen has to be able to say so.';

-- Lo que el plan lee para separar lo que no se toca de lo que va a volverse
-- efectivo.
create index if not exists holdings_intent_idx
  on app.holdings (household_id, intent)
  where intent is not null and deleted_at is null;
