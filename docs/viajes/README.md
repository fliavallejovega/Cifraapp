# Viajes

El módulo que presupuesta, acompaña y cierra un viaje de la familia dentro de
Cifra. Diseño en [01-diseno.md](01-diseno.md), avance en
[progreso.md](progreso.md).

## El motor (`@app/trip-engine`)

Funciones puras, sin I/O ni reloj: `computeTripBudget(input)` recibe el viaje
completo —fondo, tramos, viajeros, reservas, reserva de imprevistos, perfil,
días parciales, ajustes manuales, gastos y `today`— y devuelve los días con su
asignación por categoría, el resumen por tramo, el per diem en moneda base y
local, el reparto por viajero, «hoy puedes gastar» y el diagnóstico.

### Fórmulas

1. **Días.** Del inicio al fin, inclusive. El primero es de llegada y el último
   de salida; pesan `partial_day_weight` (0,5 por defecto) si están incluidos y
   0 si no. Un viaje de un día es un día completo. El día de transición entre
   tramos pertenece al tramo que llega.
2. **Compromisos.** Prepagado = reservas `paid` + lo pagado de las demás.
   Pendiente = el saldo de `deposit_paid`, `pay_later` y `pay_on_site`. Los dos
   salen del fondo antes de repartir.
3. **Reserva.** Porcentaje de lo que queda (redondeo hacia abajo) o monto fijo,
   nunca negativa ni mayor que lo disponible. «Usar reserva» la pasa a los días.
4. **Fondo para días** = fondo − prepagado − pendiente − reserva + reserva usada.
   Negativo es déficit: el motor no reparte y dice el faltante exacto.
5. **Reparto entre días** por `peso del día × índice de costo del tramo`, con
   mayor residuo sobre enteros.
6. **Reparto por categoría** con los puntos básicos del perfil. Si el tramo ya
   tiene dónde dormir, hospedaje queda en cero y las demás categorías conservan
   sus proporciones. Si no, el hospedaje se aparta por noche: se reúne por tramo
   y se reparte entre las noches (todos los días menos el último del viaje).
7. **Ajustes manuales** por día, por tramo o para todo el viaje: se fijan
   primero y el resto se reparte alrededor.
8. **Por viajero**: el día representativo, repartido por los pesos de los
   viajeros (adulto 1, niño 0,6, infante 0,2).
9. **Modo rodante.** Lo gastado antes de hoy (y lo pagado por adelantado para
   días futuros) se descuenta y lo que queda se reparte de nuevo entre hoy y los
   días que faltan. Con la política `fixed` el plan no cambia y el desvío se
   informa en `drift`. Nunca hay un «te queda» negativo: el exceso va aparte.

**Invariante.** Antes de devolver, el motor comprueba que la suma de prepagado,
pendiente, reserva disponible, días y, en modo rodante, lo ya gastado, es igual
al fondo, al centavo. Si no, lanza un error: un presupuesto que pierde un
centavo es un bug. La suite lo prueba con 2.000 viajes aleatorios.

### Unidades

Los montos entran y salen como texto decimal y adentro son `bigint` en unidades
menores de la moneda (centavos, o yenes enteros). Las tasas son «unidades
locales por una de la base» a diez decimales. No hay `number` para dinero.

### Extender

- **Categorías.** Las claves viven en `categories.ts`. Una categoría nueva
  necesita su plantilla `travel-*` (migración y `seed-data.ts`) y su texto en
  los catálogos.
- **Perfiles.** `PROFILES` en puntos básicos que suman 10.000.
- **Costo de vida.** `CostIndexProvider` es la interfaz para una fuente real;
  hoy la familia elige el nivel y `reference.ts` lo traduce a un estimado.
- **Tasas.** `platform.fx_rates` guarda la tasa diaria del BCE; el motor solo
  recibe la tasa del tramo.
