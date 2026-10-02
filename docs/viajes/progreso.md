# Viajes — progreso

| Fase                     | Estado             | Entregable                                                                                                                                    |
| ------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 · Reconocimiento       | Hecha (2026-10-01) | [00-reconocimiento.md](00-reconocimiento.md)                                                                                                  |
| 1 · Diseño técnico       | Hecha (2026-10-01) | [01-diseno.md](01-diseno.md)                                                                                                                  |
| 2 · Base de datos        | Hecha (2026-10-01) | `20261001210000_trips.sql`, aplicada en producción; 10 pruebas de RLS e invariantes                                                           |
| 3 · Motor de presupuesto | Hecha (2026-10-01) | `@app/trip-engine`, 27 pruebas (incluye 2.000 viajes aleatorios y < 50 ms)                                                                    |
| 4 · Servidor             | Hecha (2026-10-01) | `trip-actions.ts`, `trip-ledger.ts`, `trip-plan.ts`, `repositories/trips.ts`; 14 pruebas (4 contra la base)                                   |
| 5 · Planificación        | Hecha (2026-10-01) | Lista, asistente de 6 pasos, tablero, escenarios, plan de ahorro; 207 pantallas en 69 perfiles                                                |
| 6 · Documentos de viaje  | Hecha (2026-10-01) | Lector de pasajes, hoteles y recibos sobre el mismo pipeline; revisión y confirmación atómica; probado de punta a punta con el proveedor real |
| 7 · En viaje             | Hecha (2026-10-01) | «Hoy puedes gastar», gasto en 3 toques, presupuesto rodante, calendario, reserva, cola sin conexión con sincronización idempotente            |
| 8 · Varias monedas       | Hecha (2026-10-02) | Tasa de planificación y real, efecto cambiario, escenario de tipo de cambio, compra de moneda o retiro como transferencia con su tasa real    |
| 9–11                     | Pendientes         | —                                                                                                                                             |

Notas de la Fase 2:

- La base no se reconstruía desde cero por `20260910260000` (catálogo de tarjetas); las pruebas locales usan una copia con esa restricción `not valid`. El repo no se tocó.
- La auditoría de seguridad fallaba en `main` por el catálogo y las plantillas de correo; `20261001200000_catalogue_row_security.sql` lo arregla.
- Flag `trips_module` apagado por defecto, encendido para el hogar «Flia Vallejo Vega».
- La semilla de desarrollo con tres viajes llega con el servidor (Fase 4), porque usa sus acciones.

- Fase 5: la revisión en 69 perfiles (WebKit y Chromium) no encontró desbordes, traslapes ni toques chicos en las pantallas de Viajes. El único grave es un error de hidratación de React (#418) que ya existía en toda la app: aparece también en `/goals` con el build anterior a Viajes y, a veces, en producción. Queda propuesto como arreglo aparte.

- Fase 6: arreglados los dos fallos del OCR de estados de cuenta (el trabajo ya recibe el tipo de archivo; el selector acepta fotos). Tasas del BCE vía Frankfurter con cron diario (`/api/cron/fx`), adelantadas de la Fase 8 porque confirmar un recibo en euros las necesita. El límite de las acciones del servidor sube a 4 MB y los documentos viajan uno por petición.

- Fase 7: las barras de acción usan `sticky` y las hojas un portal, porque el contenedor de la página tiene `transform` (animación de entrada) y ahí `fixed` no funciona. La cola sin conexión vive en IndexedDB; abrir la app en frío sin señal no está cubierto (el service worker no guarda páginas).

- Fase 8: las cuentas siguen en USD/PAB. El efectivo del viaje vive en una cuenta de efectivo en la moneda del hogar que guarda al lado el monto local y la tasa real; los gastos en efectivo usan esa tasa. Cuentas en cualquier moneda quedan como decisión abierta (tocan `Money` en todo el producto).
