# Rumbo — accesos (fase 0)

Rumbo es la parte de rutas del módulo Viajes: arma el itinerario completo
(tramos, horas, hospedaje, visas y reservas) alrededor de lo que ya está
pagado. Vive en este repo y comparte cuenta, base de datos y sesión con Cifra.

Estado al 2026-10-02 (`pime-git preflight`): **verde**.

| Acceso | Estado | Detalle |
| --- | --- | --- |
| GitHub | Listo | `fliavallejovega/Cifraapp` con el perfil `fliavallejovega`; identidad, firma y origin verificados |
| Supabase | Listo | Proyecto de Cifra (`sdeeoccvwcvgsmgfsuoz`); migraciones en `supabase/migrations` |
| Vercel | Listo | Carpeta vinculada al proyecto `cifraapp` (cuenta `fliavallejovega-5937`) |
| OpenRouteService | Listo en local | `ORS_API_KEY` en el bloque `env` de `.claude/settings.local.json`; probada con Venecia → Cortina |

## Pendiente

- **`ORS_API_KEY` en Vercel y en `.env.local`.** Se agrega en la fase 1, junto
  con su entrada en `@app/validation/env`, cuando el código la lea por primera vez.
- **Cuota de OpenRouteService.** El plan gratuito alcanza con caché: cada ruta
  se guarda con su fuente y fecha y no se vuelve a pedir.
- **Token cruzado en el entorno de la terminal.** La variable `VERCEL_TOKEN`
  que hereda la terminal autentica como otra cuenta (`visita7uapa-1510`).
  El de `.claude/settings.local.json` es el correcto y es el que usan
  `scripts/deploy.mjs` y `pime-git preflight`. Ningún comando de Vercel debe
  confiar en el de la terminal.

## Decisiones de arranque

1. Vive dentro de Cifra, en el módulo Viajes, con el flag `trips_module`.
2. Rutas con OpenRouteService: Directions, Elevation Line y Geocode Search.
3. Los documentos (pasajes, estadías, reservas, entradas) se leen con el lector
   de Cifra: el modelo transcribe, el código normaliza y la persona confirma.
4. Lo confirmado o comprado entra al presupuesto de Viajes como reserva pagada;
   lo estimado se queda en Rumbo.
5. Sesión de Cifra; no hay login propio.
