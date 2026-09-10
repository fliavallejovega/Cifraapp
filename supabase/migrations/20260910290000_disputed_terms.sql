-- Cuando el banco se contradice a sí mismo.
--
-- La página de producto de Credicorp dice «3 puntos x $1.00 de compra». El
-- reglamento del mismo programa, enlazado desde esa misma página, dice «1.25
-- Puntos Rewards por cada $1.00» para la Clásica. Hasta 2.4x de diferencia.
--
-- Scotiabank publica «Sus puntos +Premios nunca vencen» y su propio reglamento
-- dice «los puntos vencerán si después de veinticuatro (24) meses de haber sido
-- otorgados, los mismos no han sido utilizados».
--
-- ## Qué hace este producto con eso
--
-- No elige. Elegir sería inventar la resolución de un conflicto que las fuentes
-- no resuelven: el reglamento es más viejo y tiene fuerza contractual, la página
-- es actual y es mercadeo, y cuál rige hoy sólo lo sabe el banco.
--
-- Se enseñan **las dos**, marcadas como en conflicto, con las dos direcciones a
-- la vista. Una casa que ve «la página dice 3, el reglamento dice 1.75» sabe qué
-- preguntar. Una que ve sólo una de las dos cree que sabe algo que no sabe.
--
-- Es la misma disciplina que el resto del catálogo: cuando la fuente no alcanza,
-- se dice que no alcanza.

alter table platform.card_benefit_catalogue
  add column if not exists is_disputed boolean not null default false;

alter table platform.card_benefit_catalogue
  add column if not exists dispute_note text;

alter table platform.card_benefit_catalogue
  add column if not exists dispute_source_url text;

comment on column platform.card_benefit_catalogue.is_disputed is
  'Verdadero cuando otra publicación del mismo emisor dice algo distinto. No se elige un ganador: se enseñan las dos y se dice cuál documento es cuál.';

alter table platform.card_benefit_catalogue
  drop constraint if exists card_benefit_catalogue_dispute_is_explained;

-- Una fila en conflicto sin la explicación del conflicto es peor que ninguna
-- marca: pone una alarma y no dice de qué.
alter table platform.card_benefit_catalogue
  add constraint card_benefit_catalogue_dispute_is_explained
  check (not is_disputed or (dispute_note is not null and dispute_source_url is not null));
