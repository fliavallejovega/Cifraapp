-- El catálogo y la cuenta hablaban del mismo programa con nombres distintos.
--
-- `app.accounts.card_program` guarda la llave: `connectmiles`.
-- `platform.card_benefit_catalogue.program` guardaba el nombre: `ConnectMiles`.
--
-- Mientras nadie cruzaba las dos columnas, la diferencia no molestaba. Al
-- filtrar por programa —que es lo que hay que hacer para no ofrecerle Estrellas
-- a una ConnectMiles— el cruce no encontraba nada, y la pantalla habría pasado
-- de enseñar los tres programas del banco a no enseñar ninguno.
--
-- Es la misma razón por la que este catálogo tiene llaves y no texto libre:
-- «ConnectMiles», «Connect Miles» y `connectmiles` son tres cosas para una
-- consulta y la misma para una persona. Al programa le faltaba la suya.

alter table platform.card_benefit_catalogue
  add column if not exists program_key text;

comment on column platform.card_benefit_catalogue.program_key is
  'La llave estable del programa, la misma que guarda app.accounts.card_program. El nombre vive en `program` y es para leer; ésta es para cruzar.';

-- La llave se deriva del nombre: minúsculas, sin tildes, sin espacios ni
-- puntuación. Es la misma forma con que se sembraron las llaves en
-- platform.card_programs, así que las dos coinciden sin escribirlas dos veces.
update platform.card_benefit_catalogue
set program_key = regexp_replace(
      lower(translate(program, 'áéíóúÁÉÍÓÚñÑ+', 'aeiouAEIOUnN_')),
      '[^a-z0-9]+', '_', 'g'
    )
where program is not null and program_key is null;

-- Y donde el nombre no cuadre exactamente con la llave del catálogo de
-- programas, se corrige contra él: es la fuente de verdad de las llaves.
update platform.card_benefit_catalogue c
set program_key = p.program_key
from platform.card_programs p
where c.program is not null
  and c.issuer_key = p.issuer_key
  and lower(translate(c.program, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) =
      lower(translate(p.name, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'));

create index if not exists card_benefit_catalogue_program_key_idx
  on platform.card_benefit_catalogue (program_key)
  where program_key is not null;
