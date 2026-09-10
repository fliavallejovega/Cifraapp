-- Una promoción que no dice qué días, no dice qué días.
--
-- Este producto sembró cuatro promociones con el arreglo de días vacío, y la
-- pantalla leía ese vacío como «todos los días» y les ponía un «Hoy» verde
-- encima. Ninguna página de banco había afirmado eso: lo afirmó este sistema,
-- llenando un silencio con la respuesta más conveniente.
--
-- No es un error de presentación. Un 50% en restaurantes que en realidad es los
-- martes, marcado «Hoy» un jueves, manda a una familia a comer confiando en un
-- descuento que ese día no existe. Es la clase de error que este producto
-- existe para no cometer.
--
-- El código ya no lo hace: vacío significa «no se sabe», y una promoción sin
-- días declarados nunca puede salir como disponible hoy. Esta migración corrige
-- lo que quedó sembrado.

-- El programa de restaurantes de Banco General no es una promoción: es un
-- catálogo cuyos comercios y días cambian mes a mes, y la propia fila lo decía
-- en su detalle mientras el encabezado prometía un 50% sin condiciones.
--
-- El hogar reporta que el descuento corre los martes. Se anota como tal y la
-- fila baja a `unverified`, que es lo que es: un dato que este sistema no leyó
-- de la fuente.
update platform.card_promotions
set weekdays = '{2}',
    status = 'unverified',
    detail = 'Descuento en los restaurantes participantes al pagar con tarjetas de Banco General. Los comercios y los días de cada uno cambian mes a mes; el hogar reporta que corre los martes. Confirmá en la página del banco antes de contar con él.',
    updated_at = now()
where source_url = 'https://www.bgeneral.com/restaurantes/';

-- Las demás con días sin declarar bajan a `unverified` también. Estaban
-- marcadas como comprobadas por una persona, y lo que una persona comprobó fue
-- el descuento — no que aplicara todos los días, que es lo que la pantalla
-- terminó diciendo.
update platform.card_promotions
set status = 'unverified',
    updated_at = now()
where cardinality(weekdays) = 0
  and status = 'verified';

-- Y la regla, en la base: una promoción comprobada declara sus días.
--
-- Vive aquí y no sólo en el código porque el barrido mensual escribe filas sin
-- pasar por la pantalla, y una regla que sólo existe en la capa que renderiza
-- no protege a la que inserta.
alter table platform.card_promotions
  drop constraint if exists card_promotions_verified_declares_days;

alter table platform.card_promotions
  add constraint card_promotions_verified_declares_days
  check (status <> 'verified' or cardinality(weekdays) > 0);

comment on column platform.card_promotions.weekdays is
  'Los días en ISO, 1 es lunes. Vacío significa que la fuente NO los declaró — nunca «todos los días». Una fila vacía no puede estar en estado verified ni presentarse como disponible hoy.';
