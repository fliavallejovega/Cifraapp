# Rumbo

La parte de Viajes que arma el viaje de punta a punta: con quién, qué ya está
pagado, qué no se mueve y qué quieren ver, Rumbo compone los días, los tramos,
el hospedaje, los requisitos de entrada y lo que hay que comprar. Accesos en
[SETUP.md](SETUP.md).

## Piezas

| Pieza     | Dónde                                                                                                                                            | Qué hace                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Motor     | `packages/itinerary`                                                                                                                             | Puro, sin reloj ni red. Compone la parte en carro alrededor de las anclas y los deseos (`composeGround`), arma los días (`buildItinerary`), evalúa la entrada (`evaluateEntry`), genera las compras (`generateTodos`) y suma el hospedaje con `Money` (`lodgingTotals`). |
| Catálogo  | `packages/itinerary/src/catalog`                                                                                                                 | Lugares con coordenadas y fuente, corredores entre puntos fijos, aeropuertos y traslados, pasos de montaña, eventos (la Ravennaschlucht) y actividades con días de cierre.                                                                                               |
| Base      | `supabase/migrations/20261002120000_rumbo.sql` y siguientes                                                                                      | `trip_places`, `trip_anchors`, `trip_wishes`, `trip_flight_segments`, `trip_drives` (la caché de rutas), `trip_lodging_options`, `trip_todos`, `trip_shares`; `platform.entry_rules` y `platform.border_systems`. RLS forzada por hogar.                                 |
| Servidor  | `apps/web/src/server/rumbo*.ts`                                                                                                                  | Lee, compone y guarda; pide rutas a openrouteservice en segundo plano; toma vuelos, estadías y eventos de los documentos confirmados en Viajes; presenta, exporta, comparte y avisa.                                                                                     |
| Pantallas | `/trips/[id]/route` (Ruta en 3D · Dónde dormir · Visas y reservas), `/trips/[id]/route/setup` (asistente), `/v/[token]` (enlace de solo lectura) |                                                                                                                                                                                                                                                                          |

## Decisiones

1. **Dentro de Cifra.** Mismo repo, cuenta, Supabase y sesión. Las estadías
   son `trip_legs` marcados con `stay_origin`, así el presupuesto de Viajes las
   ve. Lo confirmado o comprado entra al presupuesto como reserva; lo estimado
   se queda en Rumbo.
2. **Certeza en cada dato.** `confirmed` (lo dice un boleto o una fuente
   oficial), `estimated` (calculado), `unverified` (nadie lo confirmó). En la
   pantalla: «En su boleto», «~», «Por verificar».
3. **Horas con la base de zonas del sistema (`Intl`)**, no con una librería
   aparte: cada hora se guarda como hora de pared con su zona IANA y se
   convierte a instante para sumar. Probado en el cambio de horario de verano.
4. **Rutas con openrouteservice** y caché por hogar (`request_hash`). El
   enrutador calcula sin nieve; de noviembre a marzo el plan suma 30 % en
   montaña y 15 % en llano, y muestra las dos cifras.
5. **Hospedaje en modo manual.** Airbnb y Booking no tienen API abierta: Rumbo
   arma los links con fechas y personas, y la persona pega las opciones. No se
   incrustan fotos de terceros.
6. **Reglas de entrada como datos** con fuente y fecha; más de 30 días se leen
   «por verificar». ETIAS con fecha nula y editable.
7. **Mapa con datos estáticos** (`apps/web/public/rumbo`): contornos de
   Natural Earth y relieve de Terrarium, generados con
   `scripts/rumbo-map-data.mjs`. ~350 KB, servidos por Vercel, no por R2.
8. **Compartir es de solo lectura** y sin montos. Editar sigue siendo de
   quien pertenece al hogar.
9. **PDF desde el navegador**: el HTML de un archivo se imprime a PDF; no hay
   generador de PDF en el servidor.
10. **El aviso semanal** de reglas viaja dentro del cron diario (el plan Hobby
    admite pocos crons) y corre los lunes.

## El caso de referencia

`pnpm db:seed:rumbo` siembra el viaje como lo escribiría una persona. La prueba
`apps/web/src/server/rumbo.test.ts` lo compone desde la base y verifica:

- 19 días (9–27 dic), 17 noches con hospedaje, 10 días de manejo.
- Venecia → Cortina → Falzarego → Pordoi → Canazei → Sella → Ortisei →
  Bolzano → Merano → Reschenpass → Arlberg → Chur → Arosa → Zúrich →
  Rheinfall → Hinterzarten (Ravennaschlucht el sábado 19) → Friburgo →
  Heidelberg → Rüdesheim → Colonia → Hamburgo → Lübeck → ferry
  Puttgarden–Rødby → Copenhague.
- «En su boleto» solo en PTY 22:00, VCE 13:50, CPH 10:35 y PTY 17:10.
- Sin visa para Türkiye ni Schengen, 16 de 90 días en Schengen.
- Viñetas de Austria y Suiza, ferry, boletos de la Ravennaschlucht (venta el
  14 oct 2026, 10:00), transfer de madrugada del 27.

**Diferencia con el plan hecho a mano:** decía «unos 2.500 km y ~37 h». El
enrutador mide **2.165 km**; con invierno son **35 h 31 min**. Rumbo muestra
sus cifras, no las del plan a mano.

## Lo que falta o queda por verificar

- Precios de viñetas y peajes de 2026: marcados «por verificar».
- Horarios de traslados y de transporte local: estimados.
- Las horas de las escalas en Estambul son estimadas hasta que la persona
  escriba las de «Itinerary details».
- Corredores del catálogo: solo los de este viaje. Otros viajes usan paradas
  fijas y deseos sin corredor sugerido.
