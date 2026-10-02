-- Cerrar un viaje: lo que sobró vuelve a una meta, con su origen.
--
-- `goal_credits` sólo conocía el pago de una reserva. El sobrante de un viaje
-- cerrado es la segunda fuente: entra a la meta que la familia elija y queda
-- anotado de qué viaje vino, para poder deshacerlo.

alter table app.goal_credits drop constraint if exists goal_credits_source_kind_check;
alter table app.goal_credits
  add constraint goal_credits_source_kind_check check (source_kind in ('trip_booking', 'trip_surplus'));
