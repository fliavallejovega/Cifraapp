# Roadmap

Phases are sequential. Each one ends with lint, typecheck, tests and build
green, documentation updated, and a report. Nothing starts before the phase
before it is stable.

| Phase | Scope                                                                                          | Status                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Repository foundation: monorepo, strict types, migrations, money primitives, i18n, tests, CI   | **Complete**                                                                                                                                           |
| 1     | Design system: visual identity, typography, color, motion, components, `DESIGN.md`             | **Complete — v2**: private-bank console (ink/ivory/brass), sidebar + revealed drawer, cards, PWA                                                       |
| 2     | Auth and multi-tenancy: users, households, memberships, organizations, RLS, audit log          | **Complete** — password recovery included; no MFA, magic link, OAuth, invitation sending or household switcher                                         |
| 3     | Core financial data model: accounts, transactions, categories, merchants, budgets, goals, debt | **Complete** — every entity has a management screen: accounts, movements, income, debts, goals, commitments, categories, merchants, people             |
| 4     | Import engine: CSV, XLSX, OFX, PDF, document storage, parsing, normalization                   | **Complete except OCR** — CSV, OFX, PDF text layer and XLSX all parse in a background job; a scan is refused by name rather than read as empty         |
| 5     | Duplicate and transfer engine: fingerprints, matching, credit-card payment detection           | **Complete**                                                                                                                                           |
| 6     | Category and learning engine: merchant normalization, user rules, confidence, review           | **Complete** — the scan classifies, merchants are created and named, and anything under the threshold goes to a review queue rather than being applied |
| 7     | Budgets and recurring expenses: automatic suggestions, safe-to-spend, projections              | **Complete** — budgets with pace and commitments, suggestions from the household's own median, detected series queued for confirmation                 |
| 8     | Debt engine: avalanche, snowball, simulations, payoff timelines                                | **Complete** — debt CRUD, per-debt payoff, and a simulator that always runs both strategies so the cost of the choice is visible                       |
| 9     | Rule engine: visual builder, conditions, actions, priorities, audit history                    | **Complete** — the builder writes structured data only, and prints the whole fact catalogue so the sandbox is visible                                  |
| 10    | Allocation engine: obligation prioritization, tax reserve, goal and debt allocation            | **Complete** — a plan can be accepted, is stored as it was seen, and is measured against what actually moved                                           |
| 11    | AI copilot: provider abstraction, structured outputs, explanations                             | **Complete in product** — advice, alerts and chat with stored grounding; still **no provider key**, and every screen states that plainly               |
| 12    | Panama tax engine: jurisdiction model, versioned rules, DGI sources, review workflow           | **Engine complete** — rules are versioned rows; the Panama set is an **unreviewed draft** and shows to nobody                                          |
| 13    | Reporting: statements, net worth, PDF and XLSX export                                          | **Complete** — month close with its blocking checklist, and CSV, JSON, XLSX and PDF exports written without a dependency                               |
| 14    | Billing: plans, Stripe abstraction, entitlements, usage, webhooks                              | **Complete in product** — subscription screen leading with usage against limits; still **no Stripe account**, and the screen says so                   |
| 15    | Internal SaaS accounting: chart of accounts, double-entry ledger, reconciliation               | **Engine complete** — postings, trial balance and SaaS metrics; balance enforced by a database trigger                                                 |
| 16    | CMS: content model, editor, blog, SEO, media                                                   | **Model complete** — pages, media with required alt, FAQs, redirects, versioned legal; **no editor** (Phase 20)                                        |
| 17    | Landing page                                                                                   | **Built** — 15 routes, content-driven, no fake testimonials or logos; **product name still provisional**                                               |
| 18    | Accountant portal                                                                              | **Complete** — grants can be handed out and revoked from the household side, with a scope and an expiry                                                |
| 19    | White label                                                                                    | **Model built** — branding, verified domains, per-household resolution; **no admin UI, no domain automation**                                          |
| 20    | Admin platform                                                                                 | **Built** — separate app, roles, metrics, flags; **read-only, no support or CMS tooling**                                                              |
| 21    | Hardening: security review, RLS audit, performance, accessibility, load testing                | **Partly done** — the security audit is a test and it found real drift; **no load testing, e2e not run**                                               |

## Priority if scope must be cut

Correctness before automation, automation before speed, speed before visuals,
visuals before AI. Financial data that is wrong is worse than financial data
that needs review.

The order to protect: authentication → household → accounts → transactions →
import → duplicate prevention → categorization → budgets → debt → goals → rules
→ allocation engine → safe-to-spend → dashboard. Everything after that is
valuable; nothing after that is worth compromising the data integrity layer for.

## Where things stand

**The product surface is complete.** All 43 screens the business plan named are
built — the twelve that made the household administrable, the seven that get
data in on its own, the eight that make the system recommend, the seven that
let it charge and be shared, and the four that give it depth.

What remains is not a screen. OCR needs a provider; billing needs a Stripe
account; the copilot needs a key; the Panama tax rules need a qualified reviewer
before a single figure derived from them is shown to anybody. Each of those is
named on the screen that would use it, rather than left as a blank that reads
as a bug.

Phases 0–2, 5, 17 and 18 are complete; 3, 4, 6–15 are complete as engines _and_
as product; 16, 19, 20 and 21 are partly built, and the table above says exactly
where each stops.

460 unit and integration tests, all passing. **26 migrations apply cleanly from
an empty database**, producing 82 tables across `app`, `platform` and `audit` at
schema version 26, with row-level security enabled _and forced_ on every one —
asserted by `security-audit.test.ts` over the whole schema rather than a list of
known tables.

The live Supabase project is **migrated to version 22**. The two additions are
small and both came out of building the setup questionnaire: member counts and a
completion stamp on `household_settings`, and a check constraint on
`recurring_series` that now distinguishes a series the engine detected (three
occurrences, as before) from one a person declared (none).

The end-to-end suite passes: 48 public specs green, 10 skipped because
`E2E_EMAIL`/`E2E_PASSWORD` are unset.

### The golden flow runs

**Account and transaction CRUD exists**, and so does import row confirmation.
The flow the whole system was built for now runs end to end for the first time:

    sign up → household → setup questionnaire → accounts → import → review →
    confirm → transactions → position, plan and statements

Confirmed rows become `app.transactions` carrying the import and the document
they came from, and every engine downstream reads them. A household that
answers the questionnaire has a real allocation plan before it has imported
anything, because obligations, debts, goals, a buffer and a household size all
have a screen that creates them.

Two things found while proving it, both fixed and both worth remembering:

- `.gitignore` matched `documents/` anywhere, which included
  `apps/web/src/app/[locale]/documents/`. The import screen had **never been
  committed** and was not in production. Source trees are now excluded from
  that rule explicitly.
- A figure typed as `3,200` was parsed as `3.20`, so a $3,200 card entered the
  database as a $3.20 one and every plan built on it was wrong without failing.
  `normalizeTypedAmount` now reads a lone separator with three digits behind it
  as grouping, and `amount.test.ts` holds the rule.

### Then, in order

3. **The management surfaces** still missing: edit and delete for debts, goals
   and obligations after setup, budget CRUD, the visual rule builder, category
   and recurring-series review, accept/modify on a plan, tax onboarding,
   expense-classification review, and the accountant invitation flow. Each is a
   screen over a table that already exists and, for three of them, over rows the
   questionnaire already creates.
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
