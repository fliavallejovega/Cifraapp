# Viajes — Fase 0: reconocimiento

Informe previo al diseño del módulo Viajes. Cada afirmación lleva la ruta que la
respalda. A partir de aquí la especificación se lee con los nombres reales de la
tabla «Adaptación de la especificación».

Estado de accesos al cerrar esta fase (`pime-git preflight`, 2026-10-01):
**amarillo**. Identidad y git en verde; Vercel autentica como
`fliavallejovega-5937` pero el repo no está vinculado (`npx vercel link`); falta
`SUPABASE_DB_PASSWORD`, sin la cual `db push` se cuelga. Hasta resolverlo no se
aplican migraciones ni se despliega.

---

## 1. Stack y rutas clave

| Área          | Qué hay                                                                                                                                                                                                                                               | Evidencia                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Framework     | Next.js 16.3 App Router, React 19.2, TypeScript 6.0 estricto, pnpm 11.20 + Turbo                                                                                                                                                                      | `package.json`, `apps/web/package.json`                                                                           |
| Base de datos | Supabase Postgres; Drizzle 0.45 para consultas; SQL revisado a mano para migraciones (ADR-004)                                                                                                                                                        | `packages/database/src/schema/*.ts`, `supabase/migrations/` (94 archivos), `packages/database/scripts/migrate.ts` |
| Esquemas      | `app` (hogar), `platform` (empresa), `audit` (rastro) — ADR-010                                                                                                                                                                                       | `docs/decisions.md`                                                                                               |
| Sesión        | Supabase Auth; `requireSession` (con MFA), `requireHousehold`, `queryAsUser`; hogar activo por cookie `cifrapp_household`                                                                                                                             | `apps/web/src/server/session.ts`, `supabase.ts`                                                                   |
| Tenencia      | `household_id` en toda tabla de `app`                                                                                                                                                                                                                 | `20260806130000_identity.sql`                                                                                     |
| RLS           | `app.is_household_member(uuid)`, `app.has_household_role(uuid, role[])`; `force row level security` + `grant` explícito por tabla                                                                                                                     | `20260806130000_identity.sql`, `20260911120000_force_rls_on_new_tables.sql`, `20260909140000_receivables.sql`     |
| Conexiones    | `withUserContext` (con RLS); `getAdminDb` / `getPlatformDb` (sin RLS, solo jobs y seeds)                                                                                                                                                              | `packages/database/src/client.ts`, `apps/web/src/server/database.ts`                                              |
| Mutaciones    | Server actions planas `apps/web/src/server/*-actions.ts` (zod → `loadSession` → `queryAsUser` → `revalidate*`); lecturas en `server/repositories/*.ts`                                                                                                | `apps/web/src/server/goal-actions.ts` como plantilla                                                              |
| Rutas         | Segmentos bajo `apps/web/src/app/[locale]/(product)/`; un segmento nuevo se registra en `PROTECTED_SEGMENTS`                                                                                                                                          | `apps/web/src/product-routes.ts`                                                                                  |
| Validación    | zod 4.4 para formularios y env; la salida del modelo usa su propio `ObjectShape`                                                                                                                                                                      | `packages/validation/src/`, `packages/ai/src/schema.ts`                                                           |
| UI            | `packages/ui` (Button, Card, Field, EmptyState, Problem, Skeleton, Gauge, Amount, Readout, Status, Provenance, UtilizationBar…); tokens en `packages/ui/src/styles/tokens.css`; Archivo + Chivo Mono; claro/oscuro diseñados                          | `DESIGN.md`                                                                                                       |
| Gráficos      | Sin librería: hechos a mano                                                                                                                                                                                                                           | `packages/ui/src/components/gauge.tsx`, `apps/web/src/components/market-chart.tsx`                                |
| Iconos        | Propios, contorno 1,5 px                                                                                                                                                                                                                              | `apps/web/src/components/shell-icons.tsx`                                                                         |
| Navegación    | Arreglo `{href, key, group}` con grupos money, claims, intake, decide, record, household                                                                                                                                                              | `apps/web/src/components/app-shell.tsx`                                                                           |
| i18n          | next-intl 4.13; `es` por defecto y `en`; catálogos por pantalla; paridad probada; lint contra literales en JSX                                                                                                                                        | `apps/web/messages/{es,en}.json`, `apps/web/src/i18n/messages.test.ts`                                            |
| Pruebas       | vitest (unit); pruebas de base con `TEST_DATABASE_URL` (se saltan sin él), incluida RLS con dos hogares; Playwright escritorio + móvil                                                                                                                | `apps/web/vitest.config.ts`, `packages/database/src/rls.test.ts`, `apps/web/playwright.config.ts`                 |
| Jobs          | Tabla `app.jobs` (kind libre), `skip locked`, reintentos 3 con espera 2ⁿ min; `after()` + cron diario                                                                                                                                                 | `apps/web/src/server/jobs.ts`, `apps/web/vercel.json`                                                             |
| Avisos        | Preferencias y entregas, push VAPID, correo Brevo, alertas calculadas                                                                                                                                                                                 | `apps/web/src/server/notification-service.ts`, `push.ts`, `mail.ts`, `server/repositories/alerts.ts`              |
| Archivos      | Cloudflare R2 privado (no Supabase Storage); claves `{prefijo}/{householdId}/{documentId}.{ext}`; URL firmada 300 s                                                                                                                                   | `apps/web/src/server/storage.ts`                                                                                  |
| Flags         | `platform.feature_flags` + overrides por global/organización/hogar/usuario; `isEnabled` falla cerrado; **todavía no se usa en `apps/web`**                                                                                                            | `20260811190000_admin.sql`, `apps/web/src/server/flags.ts`, `apps/admin/src/app/flags/page.tsx`                   |
| Auditoría     | `audit.events` de solo anexar, escrito por SQL `security definer`; sin trigger genérico                                                                                                                                                               | `20260908120000_accept_invitation.sql`                                                                            |
| IA            | `packages/ai`: Anthropic (`claude-sonnet-5`) u OpenAI por `AI_PROVIDER`/`AI_MODEL`; salida forzada por una herramienta con JSON Schema; prompts versionados; presupuesto y registro por hogar (`ai_budgets`, `ai_invocations`, enum `app.ai_feature`) | `packages/ai/src/providers/anthropic.ts`, `prompts.ts`, `20260811100000_ai.sql`                                   |

## 2. Dominio financiero

**Movimientos — `app.transactions`** (`20260806140000_financial_model.sql:161`).
`amount numeric(19,4)` con signo **y** `direction` (`inflow ≥ 0`, `outflow ≤ 0`
por check), `currency char(3)`, `transaction_date date`, `account_id`
obligatorio, `category_id` + `category_source` + `category_confidence`,
`scope`, `status` (posted, pending, transfer, excluded, duplicate…),
`source` (provenance), `source_document_id`, `source_import_id`,
`fingerprint`, `notes`. No hay `created_by`: los manuales ponen
`owner_id = session.user.id` y `source='user'`
(`apps/web/src/server/movement-actions.ts:378`). Un solo adjunto, vía
`source_document_id`.

**Divisiones — `app.transaction_splits`** (`20260907230000_household_administration.sql`):
categoría, monto, `person_id` → `app.household_people`, nota; un trigger
diferido exige que sumen el total. Sirve tal cual para «dividir un recibo entre
categorías o entre viajeros».

**No hay contabilidad de partida doble para el hogar.** El libro mayor
(`platform.journal_*`, `packages/ledger`) es de la empresa. «La contabilidad de
Cifra» del hogar es `app.transactions`.

**Categorías — `app.categories`**: jerárquicas por `parent_id`, por hogar,
creables (`category-actions.ts:47`), sembradas desde
`packages/database/src/seed-data.ts` vía `app.seed_household_categories`.
**Ya existe `travel` / «Viajes»** como gasto de primer nivel (`seed-data.ts:222`),
con icono avión.

**Cuentas — `app.accounts`**: tipos incluyen `cash`, `checking`, `savings`,
`credit_card`, `digital_wallet`; moneda por cuenta. Las transferencias son dos
movimientos `status='transfer'` unidos por `app.transfers`.

**Presupuestos — `app.budgets` / `app.budget_lines`**, periodos
weekly/monthly/annual/**sinking**. Cálculo puro en
`packages/budget-engine/src/budget.ts` (`computeBudgetState`); lo gastado se
suma por categoría en `apps/web/src/server/repositories/budgets.ts`.

**Metas — `app.goals`**: `target_amount`, `current_amount` (**escrito a mano**,
no derivado de movimientos), `target_date`, `priority`, `is_committed`
(`20260909160000_committed_goals.sql`, cuyo ejemplo es justamente un viaje). El
aporte mensual no se guarda: se calcula como (meta − actual) / meses
(`goals/[goalId]/page.tsx:63`). La escalera de reparto
(`packages/allocation-engine`, `buildAllocationPlan`, `goalWeight`) pone metas
comprometidas y con fecha por delante.

**Ingresos y capacidad**: series recurrentes de entrada (`app.recurring_series`),
deducciones, quincenas (`buildPayPeriods`). La capacidad mensual sale de
`buildBaseline` (`apps/web/src/server/repositories/projection.ts:58`) menos
compromisos (`repositories/baseline.ts`).

**Monedas**: `households.base_currency` (USD por defecto). **`CURRENCY_CODES =
['USD','PAB']`** (`packages/domain/src/money/currency.ts:9`). No hay tasas de
cambio en ningún lado ni columna de tasa en movimientos. Mezclar monedas en
`Money` lanza `CurrencyMismatchError`. `packages/market-data` es de precios de
inversiones, no de divisas.

**Agrupación**: no hay etiquetas ni proyectos. `scenario-engine` ya tiene el
tipo `'vacation'`.

**Dominio**: `Money` en enteros de 1/10 000 (escala 4, ADR-005) con
`allocate(weights)` por **mayor residuo** y `allocateEvenly`; `PlainDate`
(`todayIn(tz)`, `addDays`, `daysBetween`…); `Result<T,E>`.

## 3. OCR y documentos

Recorrido actual: `import-form.tsx` → `importStatement`
(`server/import-actions.ts:37`) → `stageDocument` (`server/import-service.ts:108`:
tamaño, tipo, SHA-256, bloqueo de duplicado) → R2 → job `statement_import` →
`parseDocument` determinista (`packages/transaction-engine/src/parsers/`: CSV,
OFX, XLSX, PDF de texto) y, si falla, `readStatementByOcr`
(`server/statement-ocr.ts`, modelo con visión) → `fileImportRows` (duplicados,
clasificación) → `app.imports` / `app.import_rows` en `review` → pantalla
`documents/[importId]` → `confirmImport` crea movimientos con
`source='imported'`.

- **Siempre hay confirmación humana**; no existe auto-confirmar.
- Esquema del modelo: `ObjectShape` propio, no zod. Sin confianza por campo; la
  bandera `imports.read_by_ocr` muestra un aviso en revisión.
- Límites: 15 MB por archivo, 5 MB al modelo; PDF escaneado va entero.
- `documents.kind` ya tiene `receipt` e `invoice`, pero siempre se escribe
  `bank_statement`. `DOCUMENT_INTERPRETATION_V1` (`packages/ai/src/prompts.ts:210`)
  clasifica documentos y nunca se llama.
- El flujo está pensado para **estados de cuenta → filas**, no para un documento
  → un objeto (vuelo, hotel, recibo).

**Tres huecos que hoy rompen el camino de fotos** (verificados en código):

1. El payload del job no lleva `mimeType` (`import-service.ts:181-187`), así que
   `canReadByOcr` siempre da falso (`:232,257`): **fotos y escaneos nunca llegan
   al modelo**.
2. El `<input type=file>` no acepta imágenes (`components/import-form.tsx:131`).
3. La moneda se fuerza a USD/PAB (`import-actions.ts:79`, `:170`).

Además: no hay captura con cámara, arrastrar ni subida múltiple; el
`service worker` no guarda datos (sin modo sin conexión); no hay `share_target`;
la llamada al modelo no pasa por `invoke`, así que no se registra en
`ai_invocations` ni respeta el presupuesto de IA del hogar; nada enmascara
números de tarjeta o pasaporte dentro del contenido. `docs/context.md` registra
el OCR como «bloqueado: necesita proveedor».

## 4. Lo que reutilizo

| Pieza existente                                                              | Uso en Viajes                                                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `app.households`, `household_members`, roles                                 | Dueño del viaje y permisos                                             |
| `app.household_people` (incluye hijos sin cuenta)                            | Viajeros que son de la casa                                            |
| `app.transactions`                                                           | Cada gasto del viaje **es** un movimiento; cada reserva pagada también |
| `app.transaction_splits` (`person_id`)                                       | Dividir un recibo por categoría o viajero                              |
| `app.categories` + la semilla `travel`                                       | Destino contable de cada categoría de viaje                            |
| `app.accounts`, `app.transfers`                                              | Cuenta de pago; retiro de efectivo como transferencia                  |
| `app.goals` (`is_committed`, `target_date`) + allocation-engine              | Meta de ahorro del viaje y su lugar en la escalera                     |
| `buildBaseline`, `computeBudgetState`                                        | Capacidad de ahorro y semáforo de viabilidad                           |
| `Money.allocate` (mayor residuo), `PlainDate`, `Result`                      | Base del motor de presupuesto                                          |
| `scenario-engine` (`'vacation'`)                                             | Proyección de «¿y si viajo?» en el plan                                |
| `stageDocument`, R2, `app.documents`, `app.jobs`, proveedor de `packages/ai` | Subida, hash, cola y extracción de documentos de viaje                 |
| Patrón de revisión de importaciones                                          | Pantalla de confirmación de lo extraído                                |
| `platform.feature_flags` + `isEnabled`                                       | Flag `trips_module`                                                    |
| `notification-service`, push, Brevo, cron                                    | Avisos antes, durante y después                                        |
| `audit.events`                                                               | Rastro de altas, ediciones y borrados                                  |
| `packages/ui`, tokens, `shell-icons`, `app-shell`                            | Todas las pantallas                                                    |
| `rls.test.ts`, Playwright                                                    | Pruebas de dos hogares y recorridos                                    |

## 5. Lo que extiendo (aditivo, retrocompatible)

| Qué                                      | Cambio                                                                                                                                                                                                                    | Por qué se mantiene compatible            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `app.transactions`                       | Columnas nulas: `trip_id`, `trip_leg_id`, `trip_category`, `trip_day date`, `paid_by_person_id`, `original_amount numeric(19,4)`, `original_currency char(3)`, `fx_rate numeric(20,10)`, `fx_rate_date date`, `fx_source` | Todas nulas; nada existente las lee       |
| `app.documents`                          | `trip_id` nulo; valores nuevos en el enum de tipo (`flight_itinerary`, `lodging_confirmation`, `boarding_pass`, `ticket`, `insurance_policy`)                                                                             | `alter type … add value` no rompe filas   |
| `app.jobs`                               | Kind nuevo `trip_document`                                                                                                                                                                                                | `kind` es texto libre                     |
| `app.ai_feature`                         | `trip_document_extract`, `trip_quick_create`                                                                                                                                                                              | Valor de enum agregado                    |
| `platform.currencies` / `CURRENCY_CODES` | Monedas de destino (EUR, COP, MXN, CRC, GBP…)                                                                                                                                                                             | Depende de la pregunta de monedas: ver §8 |
| `repositories/budgets.ts`, reportes      | Filtro «con/sin viajes»                                                                                                                                                                                                   | Por defecto igual que hoy                 |
| OCR                                      | Corregir los tres huecos de §3 en los archivos que se toquen                                                                                                                                                              | Arreglo, no cambio de contrato            |
| `seed-data.ts`                           | Subcategorías de viaje bajo `travel` (si se elige esa opción)                                                                                                                                                             | Semilla idempotente                       |

## 6. Lo que creo nuevo

| Pieza                                                                                                                     | Nota                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `app.trips`, `app.trip_legs`, `app.trip_travelers`, `app.trip_scenarios`, `app.trip_bookings`, `app.trip_checklist_items` | RLS forzada y grants desde la migración que las crea                   |
| `app.trip_allocations`                                                                                                    | Solo si se decide persistir (ver §8); el motor es barato               |
| `platform.fx_rates`                                                                                                       | No existe ninguna tabla de tasas                                       |
| `packages/trip-engine`                                                                                                    | Motor puro, creado en la fase que lo usa con su primera prueba         |
| `apps/web/src/app/[locale]/(product)/trips/…`                                                                             | Lista, asistente, tablero, en viaje, cierre                            |
| `server/trip-actions.ts`, `server/repositories/trips.ts`                                                                  | Siguiendo el patrón de `goal-actions.ts`                               |
| Extractor de documentos de viaje                                                                                          | Mismo staging, R2, jobs y proveedor; prompt y esquemas nuevos por tipo |
| Lista ligera de países y ciudades                                                                                         | Con moneda y zona horaria; texto libre si falta                        |

## 7. Adaptación de la especificación

| La especificación dice                            | En Cifra es                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `households` / `household_id`                     | `app.households` / `household_id`                                                         |
| miembros del hogar                                | `app.household_members` (con cuenta) y `app.household_people` (sin cuenta, incluye hijos) |
| `transactions`                                    | `app.transactions`                                                                        |
| `categories` / `ledger_category_id`               | `app.categories` / `category_id`                                                          |
| `goals`                                           | `app.goals`                                                                               |
| `trip_expenses`                                   | No se crea: columnas nuevas en `app.transactions`                                         |
| `trip_documents`                                  | `app.documents` + `trip_id` + tipos nuevos                                                |
| montos en enteros de unidades menores (`*_minor`) | `numeric(19,4)` y `Money` a escala 4 (ADR-005); los nombres pierden el sufijo `_minor`    |
| Supabase Storage y políticas de storage           | R2 privado; la ruta la arma el servidor tras comprobar membresía; URL firmada de 300 s    |
| Zod para la salida del OCR                        | `ObjectShape` de `packages/ai`; zod para formularios                                      |
| rol «niño con cuenta»                             | No existe; los hijos son `household_people` sin acceso                                    |
| rol «solo lectura»                                | `viewer`; **hoy la base no le impide escribir en la mayoría de tablas** (ver riesgos)     |
| librería de gráficos                              | No hay: gráficos propios con los tokens                                                   |
| down-migrations                                   | No se usan; las migraciones son solo hacia adelante                                       |
| `.env.example`                                    | Variables nuevas en `packages/validation/src/env/schema.ts` y su ejemplo                  |

## 8. Riesgos y decisiones abiertas

1. **Monedas.** Cifra solo conoce USD y PAB, y `Money` se niega a mezclar.
   Viajes necesita EUR, COP, etc. Ampliar `CURRENCY_CODES` toca todo el
   producto; guardar la moneda local solo como dato original del gasto es
   contenido. → Pregunta.
2. **Tasas de cambio.** No hay fuente. → Pregunta.
3. **OCR sin proveedor encendido y con tres huecos.** Los documentos de viaje
   dependen del modelo con visión. → Pregunta.
4. **`viewer` puede escribir** en casi todas las tablas de dominio porque las
   políticas usan `is_household_member` para `all`. Para las tablas nuevas se
   puede exigir rol de escritura. → Pregunta.
5. **Metas con avance manual.** `current_amount` se escribe a mano; que las
   reservas pagadas cuenten como avance requiere decidir si Cifra lo mueve sola.
   → Pregunta.
6. **Categorías.** Subcategorías bajo «Viajes» o mapeo a las categorías de
   siempre (Restaurantes, Transporte). Cambia cómo se leen los reportes
   generales. → Pregunta.
7. **Persistir asignaciones.** El motor es puro y barato (objetivo < 50 ms);
   propuesta: calcular al vuelo y persistir solo los ajustes manuales y el
   escenario. Se decide en la Fase 1.
8. **Sin conexión.** El service worker no guarda datos; una cola offline de
   gastos es trabajo nuevo. → Pregunta.
9. **Accesos.** Preflight en amarillo: sin `SUPABASE_DB_PASSWORD` no se aplican
   migraciones; sin `vercel link` el deploy manual no está listo. Empujar a
   `main` despliega producción. → Pregunta.
10. **Tamaño.** Doce fases. La regla del repo es no empezar una fase sin que se
    pida. → Pregunta sobre el ritmo.
