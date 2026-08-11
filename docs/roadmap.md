# Roadmap

Phases are sequential. Each one ends with lint, typecheck, tests and build
green, documentation updated, and a report. Nothing starts before the phase
before it is stable.

| Phase | Scope                                                                                          | Status                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0     | Repository foundation: monorepo, strict types, migrations, money primitives, i18n, tests, CI   | **Complete**                                                                                                    |
| 1     | Design system: visual identity, typography, color, motion, components, `DESIGN.md`             | **Complete**                                                                                                    |
| 2     | Auth and multi-tenancy: users, households, memberships, organizations, RLS, audit log          | **Complete** — password recovery included; no MFA, magic link, OAuth, invitation sending or household switcher  |
| 3     | Core financial data model: accounts, transactions, categories, merchants, budgets, goals, debt | **Partial** — schema, RLS and position repository done; **no per-entity CRUD**                                  |
| 4     | Import engine: CSV, XLSX, OFX, PDF, document storage, parsing, normalization                   | **Partial** — CSV/OFX, R2 and review pipeline done; **no row confirmation**, no XLSX/PDF, no background jobs    |
| 5     | Duplicate and transfer engine: fingerprints, matching, credit-card payment detection           | **Complete**                                                                                                    |
| 6     | Category and learning engine: merchant normalization, user rules, confidence, review           | **Engine complete** — live on the database; no rule-management UI, nothing to classify until transactions exist |
| 7     | Budgets and recurring expenses: automatic suggestions, safe-to-spend, projections              | **Engine complete** — safe-to-spend is on screen; no budget UI, no cron, no notifications                       |
| 8     | Debt engine: avalanche, snowball, simulations, payoff timelines                                | **Engine complete** — ordering feeds the plan; no debt CRUD, no simulation UI                                   |
| 9     | Rule engine: visual builder, conditions, actions, priorities, audit history                    | **Engine complete** — rules are read and evaluated; **no visual builder**                                       |
| 10    | Allocation engine: obligation prioritization, tax reserve, goal and debt allocation            | **Engine complete** — the plan screen renders it; plans are not yet persisted or accepted                       |
| 11    | AI copilot: provider abstraction, structured outputs, explanations                             | **Engine complete** — guardrails, cost control and the plan narrative are live; no keys configured, no chat UI  |
| 12    | Panama tax engine: jurisdiction model, versioned rules, DGI sources, review workflow           | **Engine complete** — rules are versioned rows; the Panama set is an **unreviewed draft** and shows to nobody   |
| 13    | Reporting: statements, net worth, PDF and XLSX export                                          | **Substantially built** — statements, reconciliation, close, health score and CSV/JSON; **no PDF, no XLSX**     |
| 14    | Billing: plans, Stripe abstraction, entitlements, usage, webhooks                              | **Engine complete** — catalogue, entitlements and idempotent webhooks; **no Stripe account, no pricing UI**     |
| 15    | Internal SaaS accounting: chart of accounts, double-entry ledger, reconciliation               | **Engine complete** — postings, trial balance and SaaS metrics; balance enforced by a database trigger          |
| 16    | CMS: content model, editor, blog, SEO, media                                                   | **Model complete** — pages, media with required alt, FAQs, redirects, versioned legal; **no editor** (Phase 20) |
| 17    | Landing page                                                                                   | **Built** — 15 routes, content-driven, no fake testimonials or logos; **product name still provisional**        |
| 18    | Accountant portal                                                                              | **Built** — explicit scoped revocable grants, client list and detail; **no invitation flow, no grant UI**       |
| 19    | White label                                                                                    | **Model built** — branding, verified domains, per-household resolution; **no admin UI, no domain automation**   |
| 20    | Admin platform                                                                                 | **Built** — separate app, roles, metrics, flags; **read-only, no support or CMS tooling**                       |
| 21    | Hardening: security review, RLS audit, performance, accessibility, load testing                | **Partly done** — the security audit is a test and it found real drift; **no load testing, e2e not run**        |

## Priority if scope must be cut

Correctness before automation, automation before speed, speed before visuals,
visuals before AI. Financial data that is wrong is worse than financial data
that needs review.

The order to protect: authentication → household → accounts → transactions →
import → duplicate prevention → categorization → budgets → debt → goals → rules
→ allocation engine → safe-to-spend → dashboard. Everything after that is
valuable; nothing after that is worth compromising the data integrity layer for.

## Where things stand

**Every phase has been through once.** Phases 0–2, 5 and 17–18 are complete;
6–15 are complete as engines with their databases and, in most cases, a screen;
3, 4, 13, 16, 19, 20 and 21 are partly built, and the table above says exactly
where each stops.

431 unit and integration tests, all passing. **20 migrations apply cleanly from
an empty database**, producing 75 tables across `app`, `platform` and `audit` at
schema version 20, with row-level security enabled _and forced_ on every one —
asserted by `security-audit.test.ts` over the whole schema rather than a list of
known tables.

The live Supabase project is **migrated to version 20** and the end-to-end suite
passes against it: 48 public specs green, 10 skipped because
`E2E_EMAIL`/`E2E_PASSWORD` are unset.

### The one thing that blocks everything else

**Account and transaction CRUD still does not exist** (Phase 3's remainder), and
neither does import row confirmation (Phase 4's). Nothing can be entered through
the product; the test account was inserted with SQL. Every engine above reads
rows the product cannot create.

### Then, in order

3. **The management surfaces** each engine waits for: debt, goal and budget CRUD,
   the visual rule builder, category and recurring-series review, accept/modify
   on a plan, tax onboarding, expense-classification review, and the accountant
   invitation flow. Each is a screen over a table that already exists.
4. **Cross-cutting work** the engines assume: background jobs, notifications,
   cron, and the jobs that post to the ledger and expire trials.
5. **What Phase 21 could not measure**: end-to-end, accessibility, performance
   and load. No claim is made about any of them.

With 1 and 2 closed, the golden flow runs end to end for the first time: sign up
→ household → account → import → review → transactions — and categorization,
recurrence, forecasting, reporting and the tax reserve all begin working with no
further engine work.

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
