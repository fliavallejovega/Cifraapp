# Viajes — progreso

| Fase                      | Estado             | Entregable                                                                                                                                    |
| ------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 · Reconocimiento        | Hecha (2026-10-01) | [00-reconocimiento.md](00-reconocimiento.md)                                                                                                  |
| 1 · Diseño técnico        | Hecha (2026-10-01) | [01-diseno.md](01-diseno.md)                                                                                                                  |
| 2 · Base de datos         | Hecha (2026-10-01) | `20261001210000_trips.sql`, aplicada en producción; 10 pruebas de RLS e invariantes                                                           |
| 3 · Motor de presupuesto  | Hecha (2026-10-01) | `@app/trip-engine`, 27 pruebas (incluye 2.000 viajes aleatorios y < 50 ms)                                                                    |
| 4 · Servidor              | Hecha (2026-10-01) | `trip-actions.ts`, `trip-ledger.ts`, `trip-plan.ts`, `repositories/trips.ts`; 14 pruebas (4 contra la base)                                   |
| 5 · Planificación         | Hecha (2026-10-01) | Lista, asistente de 6 pasos, tablero, escenarios, plan de ahorro; 207 pantallas en 69 perfiles                                                |
| 6 · Documentos de viaje   | Hecha (2026-10-01) | Lector de pasajes, hoteles y recibos sobre el mismo pipeline; revisión y confirmación atómica; probado de punta a punta con el proveedor real |
| 7 · En viaje              | Hecha (2026-10-01) | «Hoy puedes gastar», gasto en 3 toques, presupuesto rodante, calendario, reserva, cola sin conexión con sincronización idempotente            |
| 8 · Varias monedas        | Hecha (2026-10-02) | Tasa de planificación y real, efecto cambiario, escenario de tipo de cambio, compra de moneda o retiro como transferencia con su tasa real    |
| 9 · Cierre e informe      | Hecha (2026-10-02) | Informe planificado contra real (categoría, día, ciudad, persona, reserva, cambio), cierre con destino del sobrante, plantilla, CSV           |
| 10 · Avisos y texto libre | Hecha (2026-10-02) | Pendientes de dinero automáticos, un aviso al día por viaje (antes, durante, después) y crear un viaje escribiéndolo                          |
| 11 · Pulido y pruebas     | Hecha (2026-10-02) | Error de hidratación #418 corregido en toda la app, contraste en tarjetas oscuras, semilla de 3 viajes, e2e, 621 pantallas en 69 perfiles     |

Notas de la Fase 2:

- La base no se reconstruía desde cero por `20260910260000` (catálogo de tarjetas); las pruebas locales usan una copia con esa restricción `not valid`. El repo no se tocó.
- La auditoría de seguridad fallaba en `main` por el catálogo y las plantillas de correo; `20261001200000_catalogue_row_security.sql` lo arregla.
- Flag `trips_module` apagado por defecto, encendido para el hogar «Flia Vallejo Vega».
- La semilla de desarrollo con tres viajes llega con el servidor (Fase 4), porque usa sus acciones.

- Fase 5: la revisión en 69 perfiles (WebKit y Chromium) no encontró desbordes, traslapes ni toques chicos en las pantallas de Viajes. El único grave es un error de hidratación de React (#418) que ya existía en toda la app: aparece también en `/goals` con el build anterior a Viajes y, a veces, en producción. Queda propuesto como arreglo aparte.

- Fase 6: arreglados los dos fallos del OCR de estados de cuenta (el trabajo ya recibe el tipo de archivo; el selector acepta fotos). Tasas del BCE vía Frankfurter con cron diario (`/api/cron/fx`), adelantadas de la Fase 8 porque confirmar un recibo en euros las necesita. El límite de las acciones del servidor sube a 4 MB y los documentos viajan uno por petición.

- Fase 7: las barras de acción usan `sticky` y las hojas un portal, porque el contenedor de la página tiene `transform` (animación de entrada) y ahí `fixed` no funciona. La cola sin conexión vive en IndexedDB; abrir la app en frío sin señal no está cubierto (el service worker no guarda páginas).

- Fase 8: las cuentas siguen en USD/PAB. El efectivo del viaje vive en una cuenta de efectivo en la moneda del hogar que guarda al lado el monto local y la tasa real; los gastos en efectivo usan esa tasa. Cuentas en cualquier moneda quedan como decisión abierta (tocan `Money` en todo el producto).

- Fase 9: el informe se calcula con el motor como si fuera el día siguiente al viaje y, al cerrar, se congela en `trips.closing_report`. Las frases («en comida gastaron 37 % menos») salen de reglas sobre esas cifras, nunca del modelo, y nombran como mucho las tres categorías más alejadas del plan. El sobrante va a una meta (crédito con origen `trip_surplus`), a una cuenta (transferencia real) o se queda; `20261002010000_trip_close.sql` aplicada en producción. Probado con un viaje de prueba en producción (cierre a meta y CSV), revertido después.

- Fase 10: los pendientes «avisar al banco», «comprar el seguro» y «sacar efectivo» se derivan del viaje (`trip-checklist.ts`): aparecen si aplican, mueven su fecha con el viaje y se marcan solos al registrar un seguro o un retiro; lo que alguien marcó a mano no se toca. Los avisos (`tripDigest`, uno al día por viaje como máximo) corren dentro del cron diario de recordatorios y respetan el canal que cada persona eligió. «Cuéntennos el viaje en una frase» usa el modelo solo para transcribir; noches, totales por persona o por día y el reparto de fechas entre ciudades los calcula `trip-quick.ts`. El tipo `trip_quick_create` ya existía desde la Fase 2, así que no hubo migración. Encontrado y corregido en la prueba: un formulario anidado en el asistente provocaba un error de hidratación que borraba lo escrito.

- Fase 11: el #418 venía del script del tema escrito a mano en `<head>`; con el código minificado React no lo casaba y reconstruía el documento entero en cada página. Ahora abre `<body>`. Los colores de estado dentro de las tarjetas oscuras (`panel-scope`) toman los pasos del modo oscuro: estaban en 2,5:1. Revisión final contra producción con sesión real: 621 pantallas, 69 perfiles (motores reales de Safari y Chrome con las medidas de cada modelo, no el teléfono físico), cero graves en las seis pantallas de Viajes. Los graves que quedan son de `/overview`, `/goals` y `/accounts`, anteriores a Viajes: toques de 17–20 px y montos recortados en tablas.
