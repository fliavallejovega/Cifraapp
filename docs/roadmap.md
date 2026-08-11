# Roadmap

Phases are sequential. Each one ends with lint, typecheck, tests and build
green, documentation updated, and a report. Nothing starts before the phase
before it is stable.

| Phase | Scope                                                                                          | Status                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0     | Repository foundation: monorepo, strict types, migrations, money primitives, i18n, tests, CI   | **Complete**                                                                                                    |
| 1     | Design system: visual identity, typography, color, motion, components, `DESIGN.md`             | **Complete**                                                                                                    |
| 2     | Auth and multi-tenancy: users, households, memberships, organizations, RLS, audit log          | **Complete** — no MFA, magic link, OAuth, invitation sending or household switcher                              |
| 3     | Core financial data model: accounts, transactions, categories, merchants, budgets, goals, debt | **Partial** — schema, RLS and position repository done; **no per-entity CRUD**                                  |
| 4     | Import engine: CSV, XLSX, OFX, PDF, document storage, parsing, normalization                   | **Partial** — CSV/OFX, R2 and review pipeline done; **no row confirmation**, no XLSX/PDF, no background jobs    |
| 5     | Duplicate and transfer engine: fingerprints, matching, credit-card payment detection           | **Complete**                                                                                                    |
| 6     | Category and learning engine: merchant normalization, user rules, confidence, review           | **Engine complete** — live on the database; no rule-management UI, nothing to classify until transactions exist |
| 7     | Budgets and recurring expenses: automatic suggestions, safe-to-spend, projections              | **Engine complete** — safe-to-spend is on screen; no budget UI, no cron, no notifications                       |
| 8     | Debt engine: avalanche, snowball, simulations, payoff timelines                                | **Engine complete** — ordering feeds the plan; no debt CRUD, no simulation UI                                   |
| 9     | Rule engine: visual builder, conditions, actions, priorities, audit history                    | **Engine complete** — rules are read and evaluated; **no visual builder**                                       |
| 10    | Allocation engine: obligation prioritization, tax reserve, goal and debt allocation            | **Engine complete** — the plan screen renders it; plans are not yet persisted or accepted                       |
| 11    | AI copilot: provider abstraction, structured outputs, explanations                             | **Engine complete** — guardrails, cost control and the plan narrative are live; no keys configured, no chat UI  |
| 12    | Panama tax engine: jurisdiction model, versioned rules, DGI sources, review workflow           | Pending                                                                                                         |
| 13    | Reporting: statements, net worth, PDF and XLSX export                                          | Pending                                                                                                         |
| 14    | Billing: plans, Stripe abstraction, entitlements, usage, webhooks                              | Pending                                                                                                         |
| 15    | Internal SaaS accounting: chart of accounts, double-entry ledger, reconciliation               | Pending                                                                                                         |
| 16    | CMS: content model, editor, blog, SEO, media                                                   | Pending                                                                                                         |
| 17    | Landing page                                                                                   | Pending                                                                                                         |
| 18    | Accountant portal                                                                              | Pending                                                                                                         |
| 19    | White label                                                                                    | Pending                                                                                                         |
| 20    | Admin platform                                                                                 | Pending                                                                                                         |
| 21    | Hardening: security review, RLS audit, performance, accessibility, load testing                | Pending                                                                                                         |

## Priority if scope must be cut

Correctness before automation, automation before speed, speed before visuals,
visuals before AI. Financial data that is wrong is worse than financial data
that needs review.

The order to protect: authentication → household → accounts → transactions →
import → duplicate prevention → categorization → budgets → debt → goals → rules
→ allocation engine → safe-to-spend → dashboard. Everything after that is
valuable; nothing after that is worth compromising the data integrity layer for.

## Where things stand

**Phases 0 through 10 are done.** The deterministic Financial Decision Engine —
transaction identity, deduplication, transfer detection, categorization,
recurrence, safe-to-spend, debt strategy, rules and allocation — is complete,
tested, and running against the live database at **schema version 9**: 35 tables,
40 policies, row-level security forced on every one of them. Phases 3 and 4
remain partly built; their exact gaps are in the table above.

270 unit and integration tests, 38 end-to-end tests, all passing. The end-to-end
suite runs against the **live Supabase project and the live R2 bucket** — there
are no mocks.

**The engines run ahead of the data.** They were built as pure, dependency-free
packages the way Phase 5 was, so they are provable in isolation — and every table
they read is empty, because the product has no way to fill it. Categorization has
nothing to classify, recurrence has no history to find a cadence in, and the plan
screen renders one obligation against one balance.

Nothing that remains is a rewrite. It is all data entry the engines already know
how to consume.

### What remains, in order

1. **Account and transaction CRUD** (Phase 3's remainder). Nothing can be entered
   through the product today; the test account was inserted with SQL.
2. **Import row confirmation** (Phase 4's remainder). The identity engine writes
   verdicts into `app.import_rows` and stops. Nothing turns them into
   transactions. The account picker, XLSX/PDF and background jobs belong here too.
3. **The management surfaces** each engine is waiting for: debt, goal and budget
   CRUD, the visual rule builder, category and recurring-series review, and
   accept/modify on a plan. Each is a screen over a table that already exists.
4. **Cross-cutting work** the engines assume: background jobs, notifications,
   cron.
5. **Phase 11 onward.** The AI copilot explains what the engines decide; it has
   nothing to explain until 1 and 2 are closed.

With 1 and 2 closed, the golden flow runs end to end for the first time: sign up
→ household → account → import → review → transactions — and categorization,
recurrence and forecasting start working with no further engine work.

Full detail on every item is in [context.md](context.md).

Credentials for Supabase and R2 were pasted into a chat transcript and **need
rotating** — see [context.md](context.md).

---

## Phase 0 report (historical)

**Completed**

- pnpm workspace with Turborepo orchestration and task-level caching
- `@app/config` — strict tsconfig bases, ESLint 10 flat configs with type-aware
  rules plus domain-specific guards (money arithmetic, `process.env`, JSX copy
  literals)
- `@app/domain` — `Money` (bigint at scale 4, cent-exact `allocate`),
  `PlainDate`, `Currency`, branded identifiers, UUID v7, `Result`
- `@app/validation` — Zod environment validation split server/client, shared
  money, date, locale and pagination primitives
- `@app/database` — Drizzle schema and clients, RLS-scoped `withUserContext`,
  service-role connection, migration/seed/reset scripts
- `@app/ui` — provisional design tokens, including motion tokens
- `apps/web` — Next.js 16 App Router, bilingual `/[locale]/` routing, security
  headers, provisional status screen, `/api/health`
- CI workflow, `.env.example`, documentation

**Database**

- `20260806120000_foundation.sql`
- `20260806120100_reference_data.sql`

**APIs**

- `GET /api/health` — application and database readiness, schema version

**UI**

- `/[locale]` status screen, `not-found`, `error` boundary

**Tests** — 74 passing

- 42 unit (domain): money arithmetic, cent-exact allocation across every amount
  from 1 to 1000 cents and 2 to 7 buckets, DST-safe date math, UUID v7 ordering
- 11 unit (validation): schema boundaries
- 10 unit (database): category tree integrity, bilingual coverage
- 4 unit (web): message catalog parity
- 4 integration (database): skipped pending credentials
- 22 end-to-end + 2 skipped: locale negotiation, security headers, health,
  keyboard access, across Chrome desktop and Safari mobile

**Validation** — lint clean, typecheck clean, build clean, all suites green

**Known issues**

1. Database integration tests skip until Supabase credentials are supplied.
2. `setRequestLocale` deprecation suppressed pending `next/root-params` types
   (ADR-011).
3. Product name is provisional (ADR-001).
4. Visual identity is provisional and replaced wholesale in Phase 1.
