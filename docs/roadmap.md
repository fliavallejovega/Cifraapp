# Roadmap

Phases are sequential. Each one ends with lint, typecheck, tests and build
green, documentation updated, and a report. Nothing starts before the phase
before it is stable.

| Phase | Scope                                                                                          | Status       |
| ----- | ---------------------------------------------------------------------------------------------- | ------------ |
| 0     | Repository foundation: monorepo, strict types, migrations, money primitives, i18n, tests, CI   | **Complete** |
| 1     | Design system: visual identity, typography, color, motion, components, `DESIGN.md`             | Next         |
| 2     | Auth and multi-tenancy: users, households, memberships, organizations, RLS, audit log          | Pending      |
| 3     | Core financial data model: accounts, transactions, categories, merchants, budgets, goals, debt | Pending      |
| 4     | Import engine: CSV, XLSX, OFX, PDF, document storage, parsing, normalization                   | Pending      |
| 5     | Duplicate and transfer engine: fingerprints, matching, credit-card payment detection           | Pending      |
| 6     | Category and learning engine: merchant normalization, user rules, confidence, review           | Pending      |
| 7     | Budgets and recurring expenses: automatic suggestions, safe-to-spend, projections              | Pending      |
| 8     | Debt engine: avalanche, snowball, simulations, payoff timelines                                | Pending      |
| 9     | Rule engine: visual builder, conditions, actions, priorities, audit history                    | Pending      |
| 10    | Allocation engine: obligation prioritization, tax reserve, goal and debt allocation            | Pending      |
| 11    | AI copilot: provider abstraction, structured outputs, explanations                             | Pending      |
| 12    | Panama tax engine: jurisdiction model, versioned rules, DGI sources, review workflow           | Pending      |
| 13    | Reporting: statements, net worth, PDF and XLSX export                                          | Pending      |
| 14    | Billing: plans, Stripe abstraction, entitlements, usage, webhooks                              | Pending      |
| 15    | Internal SaaS accounting: chart of accounts, double-entry ledger, reconciliation               | Pending      |
| 16    | CMS: content model, editor, blog, SEO, media                                                   | Pending      |
| 17    | Landing page                                                                                   | Pending      |
| 18    | Accountant portal                                                                              | Pending      |
| 19    | White label                                                                                    | Pending      |
| 20    | Admin platform                                                                                 | Pending      |
| 21    | Hardening: security review, RLS audit, performance, accessibility, load testing                | Pending      |

## Priority if scope must be cut

Correctness before automation, automation before speed, speed before visuals,
visuals before AI. Financial data that is wrong is worse than financial data
that needs review.

The order to protect: authentication → household → accounts → transactions →
import → duplicate prevention → categorization → budgets → debt → goals → rules
→ allocation engine → safe-to-spend → dashboard. Everything after that is
valuable; nothing after that is worth compromising the data integrity layer for.

## Phase 0 report

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
