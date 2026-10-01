# Viajes — progreso

| Fase               | Estado             | Entregable                                                                          |
| ------------------ | ------------------ | ----------------------------------------------------------------------------------- |
| 0 · Reconocimiento | Hecha (2026-10-01) | [00-reconocimiento.md](00-reconocimiento.md)                                        |
| 1 · Diseño técnico | Hecha (2026-10-01) | [01-diseno.md](01-diseno.md)                                                        |
| 2 · Base de datos  | Hecha (2026-10-01) | `20261001210000_trips.sql`, aplicada en producción; 10 pruebas de RLS e invariantes |
| 3–11               | Pendientes         | —                                                                                   |

Notas de la Fase 2:

- La base no se reconstruía desde cero por `20260910260000` (catálogo de tarjetas); las pruebas locales usan una copia con esa restricción `not valid`. El repo no se tocó.
- La auditoría de seguridad fallaba en `main` por el catálogo y las plantillas de correo; `20261001200000_catalogue_row_security.sql` lo arregla.
- Flag `trips_module` apagado por defecto, encendido para el hogar «Flia Vallejo Vega».
- La semilla de desarrollo con tres viajes llega con el servidor (Fase 4), porque usa sus acciones.
