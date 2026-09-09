-- La quincena, y los ingresos que no son mensuales.
--
-- Todo el sistema planeaba en meses, y un mes es un promedio en el que nadie
-- cobra. Quien cobra el 15 y el 30 no tiene un problema mensual: tiene dos
-- quincenales, y no son del mismo tamaño porque las deducciones no se reparten
-- parejas entre ellas. La quincena que carga el alquiler, el colegio y el
-- préstamo es apretada; la otra no. Decirle a ese hogar «te sobran $600 este
-- mes» es cierto e inútil: responde por un período que nunca vive.
--
-- Tres cosas hacen falta para poder responder por el período real.
--
-- `daily` como cadencia, porque mucho trabajo se paga así —un puesto de
-- mercado, un conductor, trabajo a destajo— y un producto que solo entiende
-- sueldos mensuales no le dice nada a esos hogares sobre la semana que están
-- viviendo.
--
-- Los días de anclaje en las obligaciones, con el mismo significado que ya
-- tienen en `recurring_series`: los días del mes en que cae, 31 = fin de mes.
-- Es lo que permite que un pago exista en la quincena del 15 y no en la del 30.
--
-- Y la frecuencia acotada, porque hasta ahora era texto libre: una obligación
-- con frecuencia «mensualmente» no la proyecta nadie, y el motor la trataría
-- como si no se repitiera.

alter type app.recurrence_frequency add value if not exists 'daily' before 'weekly';

alter table app.obligations
  add column if not exists anchor_days smallint[];

comment on column app.obligations.anchor_days is
  'Calendar days a semimonthly obligation lands on; 31 means month end. Null for every other cadence.';

-- Texto libre hasta ahora. Se normaliza lo que ya está antes de acotarlo: una
-- fila con una frecuencia que nadie puede proyectar es una fila que el plan
-- ignora en silencio, y prefiero que quede como «mensual», que es lo que el
-- cuestionario venía escribiendo.
update app.obligations
   set frequency = 'monthly'
 where frequency is not null
   and frequency not in ('daily', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual');

alter table app.obligations
  drop constraint if exists obligations_frequency_check;

alter table app.obligations
  add constraint obligations_frequency_check
  check (
    frequency is null
    or frequency in ('daily', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual')
  );
