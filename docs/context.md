# Full system context

Written for whoever picks this up next — including a future session of me. It
carries everything needed to continue without re-deriving anything: what the
product is, what exists today, what every remaining phase contains, and the
traps waiting in each one.

**Read this first, then `CLAUDE.md` for the working rules.** `PRODUCT.md` holds
product truth, `docs/decisions.md` holds the ADRs, `docs/roadmap.md` is the
status table.

## Status

|                         |                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Complete**            | Phase 0 (foundation) · Phase 1 (design system) · Phase 2 (auth and tenancy) · Phase 5 (duplicate and transfer engine)                                 |
| **Engines complete**    | Phases 6–11 — category, budget, debt, rule, allocation, AI and scenario engines, all live on the database, with the plan screen; **no management UI** |
| **Substantially built** | Phase 3 (schema and position repository done, no per-entity CRUD) · Phase 4 (CSV/OFX, R2 and review pipeline done, no row confirmation)               |
| **Not started**         | Phases 12–21                                                                                                                                          |
| **Tests**               | 369 unit and integration · 38 end-to-end · all passing                                                                                                |
| **Gate**                | 20/20 tasks green: `lint`, `typecheck`, `test`, `build`                                                                                               |
| **Commits**             | 14, working tree clean                                                                                                                                |

Live infrastructure is connected and exercised by the end-to-end suite. This is
not a repository that merely compiles; it signs a user in, creates their
household, stores a statement in object storage, and refuses to import it twice.

## Read this before resuming

1. **Supabase is live and fully migrated.** Project `sdeeoccvwcvgsmgfsuoz`,
   region **us-west-2**, **schema version 9**, 35 tables (31 in `app`, 1 in
   `audit`, 3 in `platform`), 40 policies, **RLS forced on every table** —
   verified by querying `pg_class` directly, not assumed. All nine migrations are
   applied and seeded.
2. **Cloudflare R2 is live.** Bucket `cifraapp`, verified by round trip.
   Documents are keyed `documents/{householdId}/{documentId}.{ext}` and read
   only through a five-minute signed URL.
3. **The direct database host resolves only to IPv6**, which this machine cannot
   route. Both connection strings go through the pooler at
   `aws-1-us-west-2.pooler.supabase.com` — 6543 for transaction mode, 5432 for
   session mode. Finding the region required probing every pooler; it is written
   here so nobody repeats that.
4. **`.env.local` lives at the repository root**, and `apps/web/.env.local` is a
   **symlink** to it, because Next reads only the app's own directory. Both are
   gitignored.
5. **Tests read `TEST_DATABASE_URL`**, pointing at local Postgres. They never
   touch the real project — the RLS suite creates and deletes users and
   households.
6. A local Postgres 17 runs on `127.0.0.1:5432` with the Supabase roles already
   created. `pnpm --filter @app/database db:local` drops and rebuilds
   `norte_dev` from the migrations, applies the `auth` shim, and seeds.
7. `DESIGN.md` is committed and authoritative. The world is the instrument
   gauge; do not reopen that decision.

## ⚠ Credentials need rotating

The Supabase service-role key, the database password and the R2 access keys were
pasted into a chat transcript. The service-role key bypasses row-level security
entirely; the R2 keys grant access to stored financial documents.

- Supabase → Settings → API → rotate `service_role`
- Supabase → Settings → Database → change password, then update both connection
  strings (URL-encode `!` as `%21`)
- Cloudflare → R2 → revoke the API token and the access key pair

The `anon` key is public by design and does not need rotating.

## Test data currently in the live project

One confirmed user (`javidavo05@gmail.com`, password `NorteTest2026!`), one
household (`Hogar de prueba`), one account (`Banco General — Corriente`,
$4,180.00), one obligation, four import runs. Delete or rotate that user before
the address is used for anything real.

Every table the Phase 6–10 engines write to is **empty**: zero transactions
(imports stop at review by design), zero debts, zero goals, zero rules, zero
allocation plans. That is the honest state and it decides what the plan screen
can currently show — one obligation against one balance, no debt ordering, no
rules, no goals. The engines are not idle because they are broken; they are idle
because the product has no way to enter the rows they read.

## What remains, in the order it should be done

Phases 0–10 are done. The decision engine the product is built on — identity,
duplicates, transfers, categorization, recurrence, safe-to-spend, debt strategy,
rules, allocation — is complete, tested and running against the live database.

**It is also starved.** Every engine reads rows the product cannot create.
Nothing below is a rewrite; it is all data entry the engines already know how to
consume. The order matters — each item unblocks the ones under it.

### 1. Account and transaction CRUD — Phase 3's remainder

The largest single gap. Nothing can be entered through the product today; the
test account was inserted with SQL. Until this exists, no household can reach any
of the work described in this document.

### 2. Import row confirmation — Phase 4's remainder

The identity engine writes verdicts into `app.import_rows` and stops. Nothing
turns them into transactions. Also outstanding here: the account picker (import
currently takes the household's first active account, and a transaction filed
against the wrong account is worse than one not filed), XLSX and PDF parsing, and
moving parsing into a background job before either arrives.

With 1 and 2 closed, the golden flow runs end to end for the first time: sign up
→ household → account → import → review → transactions. **Categorization,
recurrence detection and forecasting all begin working the moment transactions
exist**, with no further engine work.

### 3. The management surfaces the engines are waiting for

Each is a screen over a table that already exists, feeding an engine that already
works:

| Missing surface                   | Feeds                         | Table                         |
| --------------------------------- | ----------------------------- | ----------------------------- |
| Debt CRUD                         | Phase 8 ordering, simulation  | `app.debts`                   |
| Goal CRUD                         | Phase 10 goal tier            | `app.goals`                   |
| Budget CRUD                       | Phase 7 budget state          | `app.budgets`, `budget_lines` |
| Rule builder (the visual `WHEN`)  | Phase 9 evaluation            | `app.rules`                   |
| Category and merchant rule review | Phase 6 corrections, learning | `app.merchant_rules`          |
| Recurring series review           | Phase 7 detection             | `app.recurring_series`        |
| Plan accept / modify              | Phase 10 acceptance rate      | `app.allocation_plans`, lines |

The last one is worth calling out: allocation plans are computed and rendered but
**not persisted**, so acceptance rate — the single most meaningful product metric
— cannot be measured yet.

### 4. Cross-cutting work the engines assume

Background jobs, notifications, cron (Part 5 of this document), and the account
picker. All named in Phases 4 and 7 and none built.

### 5. Then Phase 11 onward

Phase 11 (AI copilot) explains what the engines decide. It should not start
before 1 and 2 are closed: an explanation layer over data that does not exist has
nothing to explain, and would be the first thing in this project built without a
way to check whether it is right.

---

# Part 1 — What this system is

## The thesis

Most personal finance software reports what already happened. This one answers
what should happen next.

Money arrives. The system knows what is already committed, what is due, what
debt costs the most, what taxes must be reserved, and what the household's own
rules say. It produces a concrete allocation plan for that money, and it can
explain every line of it.

## The central mechanism

A **deterministic Financial Decision Engine**. Transaction identity,
deduplication, transfer detection, budgets, debt strategy, tax reserves and
allocation are computed by explicit rules the user can inspect and override.

AI is an explanation and classification layer on top. It never decides a
balance, a tax figure, a permission, a ledger entry, or whether something is a
duplicate.

This is the whole product. Everything else is delivery.

## Who it serves

| Audience                                | What they need                                                      |
| --------------------------------------- | ------------------------------------------------------------------- |
| Individuals                             | Know what they have, what's committed, what's next                  |
| Couples                                 | Shared and private money in one system, without forced transparency |
| Families                                | Household-level planning across several people                      |
| Independent professionals / freelancers | Business/personal separation, tax reserve out of irregular income   |
| Accountants                             | Multiple client households, explicit and revocable access           |
| White-label partners                    | Their brand, their domain, their clients                            |

## Where it operates

Panama first. Users bank at local institutions, receive **PDF statements rather
than API feeds**, and transact in USD alongside PAB (pegged 1:1, reported
separately). Independent professionals file with the DGI.

Data enters by upload — PDF, CSV, XLSX, OFX, QFX, receipt photos, invoices. A
`BankConnectionProvider` interface exists so aggregators (Plaid, Belvo, MX,
Tink) can be added without rewriting ingestion.

## The three financial worlds — never mix these

1. **Customer personal finance** — households, accounts, transactions, budgets,
   goals, debt. Schema `app`.
2. **Customer business finance** — business income, deductible expenses, tax
   reserves, accounting method. Schema `app`, separated by scope columns.
3. **SaaS company finance** — subscriptions, invoices, double-entry ledger,
   revenue recognition. Schema `platform`.

A customer's subscription payment is _two_ records: a transaction in their
household **and** a revenue event for the company. Linked explicitly, never a
shared row.

## The five questions the dashboard must answer instantly

1. How much money do I actually have?
2. What is already committed?
3. What should I do with the next dollar?
4. Am I on track for my goals?
5. What financial risk should I know about?

If the dashboard cannot answer these, it is not finished.

## The priority order when something must give

```
CORRECTNESS > AUTOMATION > SPEED > VISUALS > AI
```

Financial data that is wrong is worse than financial data that requires review.
When uncertain: **ask, flag, or route to review. Never invent.**

---

# Part 2 — Current state

## Toolchain, verified

| Tool         | Version                           | Note                                                                     |
| ------------ | --------------------------------- | ------------------------------------------------------------------------ |
| Node         | 22.20.0                           |                                                                          |
| pnpm         | 11.20.0                           | Installed globally via npm (corepack couldn't write to `/usr/local/bin`) |
| Supabase CLI | 2.72.7                            |                                                                          |
| Vercel CLI   | 58.5.1                            |                                                                          |
| gh           | 2.92.0                            |                                                                          |
| Docker       | Installed, **daemon not running** | Irrelevant now that hosted Supabase is in use                            |
| Postgres     | 17.7, local on `127.0.0.1:5432`   | Supabase roles already created; used by the RLS and integration suites   |

## Pinned dependency versions

```
next 16.3.0 · react 19.2.8 · typescript 6.0.3 · tailwindcss 4.3.3
drizzle-orm 0.45.2 · drizzle-kit 0.31.10 · postgres 3.4.9
@supabase/supabase-js 2.112.2 · @supabase/ssr 0.12.4 · @aws-sdk/client-s3 3.x
next-intl 4.13.5 · zod 4.4.3 · vitest 4.1.10 · @playwright/test 1.62.1
eslint 10.8.0 · typescript-eslint 8.66.0 · turbo 2.10.8 · prettier 3.9.6
```

**TypeScript stays at 6.x until `typescript-eslint` supports 7.** TS 7 (native Go
compiler) is `latest` but its peer range is `<6.1.0` — adopting it means losing
type-aware linting, which is where the money guards live. See ADR-008.

## What exists, file by file

```
apps/web/
  next.config.ts              Security headers, next-intl plugin
  playwright.config.ts        Desktop Chrome + mobile Safari, builds prod first
  postcss.config.mjs          Tailwind v4
  vitest.config.ts
  eslint.config.js
  tsconfig.json
  AGENTS.md, CLAUDE.md        Generated by `next dev`; meant to be committed
  .env.local                  SYMLINK → ../../.env.local (Next reads only its own dir)
  messages/es.json            ← every user-visible string
  messages/en.json
  e2e/foundation.spec.ts      Public shell: locale, headers, health, keyboard, overflow
  e2e/auth.spec.ts            Guards, sign-in, onboarding, sign-out — real Supabase
  e2e/import.spec.ts          Statement upload, re-import refusal — real Supabase + R2
  src/
    proxy.ts                  Session refresh + locale + route guards (was middleware.ts)
    i18n/{routing,request,navigation}.ts
    i18n/messages.test.ts     Catalog parity: keys + interpolation placeholders
    lib/supabase-browser.ts   Anon-key browser client
    server/supabase.ts        Request client (RLS) / admin client (bypass) / getUser
    server/session.ts         loadSession, requireSession, requireHousehold, queryAsUser
    server/auth-actions.ts    signIn, signUp, signOut, createFirstHousehold
    server/storage.ts         R2: signed URLs, household-scoped keys
    server/import-service.ts  Upload → hash → store → parse → assess → review
    server/import-actions.ts  The upload server action
    server/repositories/position.ts   liquid, committed, available, claims
    server/repositories/plan.ts       Phases 6–10 meeting real rows; builds the fact set
    components/{auth-form,household-form,import-form,sign-out-button}.tsx
    app/[locale]/page.tsx     Public landing; redirects a signed-in user onward
    app/[locale]/{sign-in,sign-up,welcome}/page.tsx
    app/[locale]/overview/page.tsx    The position screen — gauge, read-out, claims
    app/[locale]/plan/page.tsx        The allocation plan — safe-to-spend ladder, lines, rules
    app/[locale]/documents/page.tsx   Upload and import history
    app/[locale]/{not-found,error}.tsx
    app/auth/callback/route.ts        Code exchange, same-origin redirect only
    app/api/health/route.ts   App + DB readiness, schema version
    app/fonts.ts              Archivo + Chivo Mono

packages/config/
  tsconfig/{base,library,next}.json
  eslint/base.js              Money guards, process.env guard, no-enum
  eslint/next.js              + JSX literal warning

packages/domain/              NO DEPENDENCIES. Highest test density.
  src/money/currency.ts       USD, PAB, CurrencyMismatchError
  src/money/money.ts          bigint scale-4, allocate(), rounding modes
  src/money/format.ts         formatMoney, describeMoney — the ONLY place money becomes text
  src/time/plain-date.ts      Branded 'YYYY-MM-DD', DST-safe arithmetic
  src/identity/ids.ts         Branded IDs, UUID v7
  src/result.ts               Result<T,E>
  (+ 4 test files, 42 tests)

packages/validation/
  src/env/schema.ts           Server/client split
  src/env/index.ts            THE ONLY place process.env is read
  src/schemas/primitives.ts   money, plainDate, dateRange, locale, pagination

packages/database/
  drizzle.config.ts           out: ../../supabase/migrations, prefix: supabase
  src/client.ts               getDb (RLS) / getAdminDb (bypass) / withUserContext
  src/health.ts               getSchemaVersion
  src/schema/platform.ts      schema_version, currencies, tax_jurisdictions
  src/schema/app.ts           category_templates, category_kind enum
  src/schema/audit.ts         The audit schema handle
  src/schema/identity.ts      profiles, households, members, orgs, invitations, events
  src/schema/financial.ts     accounts, transactions, transfers, budgets, goals, debts…
  src/schema/documents.ts     documents, imports, import_rows
  src/seed-data.ts            Currencies, PA jurisdiction, 38-node bilingual category tree
  src/rls.test.ts             THE MOST IMPORTANT TESTS IN THE REPOSITORY
  scripts/{migrate,seed,reset,local-db,load-env}.ts

packages/category-engine/     Phase 6. Depends on domain + transaction-engine.
  src/merchants.ts            Merchant resolution: alias, containment, similarity
  src/rules.ts                Literal match kinds only — never a customer regex
  src/classify.ts             The four-rung ladder; AI capped and never auto-applied
  src/learning.ts             Two agreeing corrections before a rule is proposed
  (+ 2 test files, 33 tests)

packages/budget-engine/       Phase 7. NO DEPENDENCIES beyond @app/domain.
  src/statistics.ts           Medians and MAD; never a mean, one shock would move it
  src/recurring.ts            Cadence detection; semimonthly kept apart from biweekly
  src/safe-to-spend.ts        The full ladder, with per-claim coverage. Never clamped
  src/budget.ts               spent / committed / remaining / projected, and suggestions
  src/forecast.ts             Deterministic projection. An LLM is not a forecasting engine
  (+ 3 test files, 35 tests)

packages/debt-engine/         Phase 8. NO DEPENDENCIES beyond @app/domain.
  src/interest.ts             Daily compounding as one exact rational, rounded once
  src/strategy.ts             Avalanche, snowball, custom, hybrid; deterministic ties
  src/simulate.ts             Month-by-month payoff; Result, not exceptions
  (+ 1 test file, 22 tests)

packages/rule-engine/         Phase 9. NO DEPENDENCIES beyond @app/domain.
  src/facts.ts                THE SANDBOX — the only references a rule may name
  src/schema.ts               Rule shape and validation; depth and count limits
  src/evaluate.ts             Three-valued: true / false / unknown
  (+ 1 test file, 27 tests)

packages/allocation-engine/   Phase 10. Depends on domain, debt-engine, rule-engine.
  src/types.ts                The ladder, and each tier's splitting policy
  src/allocate.ts             The waterfall, on Money.allocate
  src/rules.ts                Rule actions into claims; raise-only, stop-wins
  (+ 1 test file, 22 tests)

packages/transaction-engine/  NO DEPENDENCIES beyond @app/domain.
  src/normalize.ts            Description normalization, trigram similarity, containment
  src/fingerprint.ts          Deterministic transaction identity + document hash
  src/identity.ts             The duplicate ladder: 5 rungs, 0.95 certain / 0.60 review
  src/transfers.ts            Transfer + credit-card-payment detection
  src/parsers/{csv,ofx,index}.ts    Format detection by content, not extension
  (+ 3 test files, 46 tests)

packages/ui/
  src/styles/tokens.css       The committed world: light-first, gauge gradations, springs
  src/components/gauge.tsx    THE SIGNATURE DEVICE — scale, thresholds, level, hatch
  src/components/{money,button,field,ledger,status,feedback,page}.tsx
  src/utils/cn.ts

supabase/
  local/auth-shim.sql               LOCAL ONLY — recreates auth.users and auth.uid()
  migrations/
    20260806120000_foundation.sql     Extensions, 3 schemas, uuid_v7, set_updated_at
    20260806120100_reference_data.sql currencies, tax_jurisdictions, category_templates
    20260806130000_identity.sql       profiles, households, membership, orgs, audit, RLS
    20260806140000_financial_model.sql accounts, transactions, transfers, budgets, goals…
    20260807040000_documents.sql       documents, imports, import_rows, provenance FKs
    20260807050000_categorization.sql  merchant_rules, classification_log
    20260807060000_recurring.sql       recurring_series, budget rollover
    20260807070000_rules.sql           rules, rule_executions
    20260807080000_allocation.sql      allocation_plans, allocation_lines

DESIGN.md                     The instrument-gauge world. Authoritative.
docs/                         architecture, database, security, decisions, roadmap, context
.github/workflows/ci.yml      verify job + e2e job
```

Engine packages for later phases (`ai`, `tax-engine`, `accounting-engine`,
`billing`, `documents`, `analytics`) are **deliberately not created**. Each is
born in the phase that first needs it, with its first test. An empty package is
deferred work wearing the costume of architecture.

## Test inventory — 270 unit and integration, 38 end-to-end

| Suite                        | Count | Covers                                                                                                                       |
| ---------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| domain/money                 | 20    | Exact decimals, currency mismatch, rounding modes, **allocation reconciliation across every amount 1–1000¢ × 2–7 buckets**   |
| domain/plain-date            | 11    | Invalid dates, DST boundaries, month-end clamping                                                                            |
| domain/format                | 6     | `$1,234.56`, `B/. 1,234.56`, true minus sign, sign display                                                                   |
| domain/ids                   | 5     | UUID v7 version/variant, time ordering, 5000-item collision check                                                            |
| validation                   | 11    | Rejects JSON numbers for money, timestamps for dates, unbounded pages                                                        |
| database/rls                 | 14    | **Tenant isolation.** Cross-household reads, self-insertion, role limits, forced RLS everywhere, pinned definer search paths |
| database/seed-data           | 10    | Unique slugs, no orphans, no cycles, bilingual coverage, kind inheritance                                                    |
| database/connection          | 4     | Schema version, seed idempotency, no floating-point money columns                                                            |
| transaction-engine/identity  | 14    | The three-channel example, settlement lag, what must never merge                                                             |
| transaction-engine/parsers   | 21    | Both thousands conventions, accounting parentheses, the balboa symbol, re-import                                             |
| transaction-engine/transfers | 11    | Card payments, one claim per leg                                                                                             |
| category-engine/classify     | 20    | User beats AI, accountant beats user, rule windows, `mixed` without a percentage                                             |
| category-engine/learning     | 13    | One correction proposes nothing, habit changes, proposals stay low-authority                                                 |
| budget-engine/recurring      | 11    | **Semimonthly is not biweekly**, month-end anchors, scattered dates find nothing                                             |
| budget-engine/safe-to-spend  | 16    | The whole ladder, which claim is unfunded, negative never clamped, pacing suppressed early                                   |
| budget-engine/forecast       | 8     | Refuses two months, median not mean, band widens with disagreement                                                           |
| debt-engine                  | 22    | Daily compounding rounded once, promotional rates, "never clears" instead of a fake date                                     |
| rule-engine                  | 27    | **Unknown facts skip the rule**, catalogue is the sandbox, depth limits, no cross-currency                                   |
| allocation-engine            | 22    | The ladder, exact splits, raise-only rules, `set_priority` cannot jump a tier                                                |
| web/messages                 | 4     | Catalog key + placeholder parity                                                                                             |
| e2e/foundation               | 12    | Locale negotiation ×3, security headers, health, 404, keyboard, focus ring, no horizontal overflow                           |
| e2e/auth                     | 8     | Guards, wrong password, onboarding, sign-in redirect, sign-out re-locks                                                      |
| e2e/import                   | 4     | **Same statement twice creates nothing**, provenance, unreadable file                                                        |

The end-to-end suite runs against **live Supabase and live R2**. There are no
mocks. The mobile Playwright project runs the public shell only — the
authenticated suites share one account and one household, so a second project
would race the first rather than test anything new.

## Commands

```bash
pnpm dev · build · lint · typecheck · test · format
pnpm db:migrate · db:seed · db:generate · db:reset
pnpm --filter @app/database db:local          # rebuild the local test database

E2E_EMAIL=… E2E_PASSWORD=… pnpm test:e2e      # authenticated suites
```

Without those variables the authenticated end-to-end suites skip and say so.
`SKIP_ENV_VALIDATION=true` still works for building without credentials.

## Known issues carried forward

1. `setRequestLocale` deprecation suppressed; `next/root-params` has no types
   until Next generates them (ADR-011).
2. Product name `Norte` is a placeholder (ADR-001). Must be settled before
   Phase 17.
3. Import picks the household's first active account rather than asking. An
   account picker is required before real use — a transaction filed against the
   wrong account is worse than one not filed.
4. Credentials need rotating (see the top of this document).
5. The category, budget and debt engines still build their explanation strings in
   English. Only the allocation engine's were converted to message keys, because
   only its output reaches a screen. The rest must be converted in the phase that
   renders them — the conversion is mechanical (`{ key, values }`, see
   `LineExplanation`), but it is not done.
6. Allocation plans are computed and rendered but never written to
   `app.allocation_plans`. The tables and their constraints exist; the insert
   does not. Acceptance rate cannot be measured until it does.

---

# Part 3 — Invariants that must never break

These are not preferences. Each one, violated, produces wrong money.

**Money is never a `number`.** `Money` from `@app/domain`; `numeric(19,4)` in
Postgres. No `parseFloat`, no `+ - * /` on amounts, no `Math.round` on money.
Serialize as `{ amount: string, currency: string }`, never a JSON number.

**Financial dates are never a `Date`.** `PlainDate` / `date` columns. A
timestamp lets a transaction slide between months and corrupt budgets,
statements and tax periods.

**RLS is enforced by Postgres, not TypeScript.** Filtering by tenant in
application code and calling it security is the failure mode. `getAdminDb()` is
migrations/jobs/seeds only.

**AI is never the source of truth** for a balance, tax figure, permission,
ledger entry, or duplicate decision.

**Never knowingly create a duplicate.** Deterministic matching first,
probabilistic scoring second, AI never alone.

**Every classification is explainable** — source (`SYSTEM | USER | AI |
ACCOUNTANT | IMPORTED | BANK | TAX_RULE`), confidence, and provenance recorded.

**Financial writes are transactional and idempotent.** A failed import leaves no
half-imported state. A replayed webhook does not double-charge.

**No user-visible string outside `messages/{es,en}.json`.**

**No `process.env` outside `@app/validation/env`.**

**Never log** full account numbers, tax IDs, credentials, documents, or
identifying transaction descriptions.

**Never claim compliance** (SOC 2, PCI, GDPR, "bank-level security") that has
not been independently established.

**Automation claims must be literally true.** "1,284 analyzed, 97% categorized,
18 need review" — never "100% automated".

## Copy register

| Never                              | Always                   |
| ---------------------------------- | ------------------------ |
| "AI detected…"                     | "We noticed…"            |
| "Your AI assistant says…"          | "Recommended allocation" |
| "Model confidence 97%"             | "High confidence"        |
| "Your tax bill" (unless finalized) | "Estimated tax reserve"  |

---

# Part 4 — The 21 phases

Each phase ends with: implementation, migration, RLS, server validation, UI
(loading/empty/error states), tests, docs, accessibility, mobile — and lint,
typecheck, build, tests green. Then **stop and report** in the format at the end
of this document.

Phases 1, 2 and 5 are **done**; their sections below are kept because they
record why things are the way they are and what was deliberately left out.
Phases 3 and 4 are **partly done** and their remaining work is called out at the
top of each. Phases 6–10 have their **engines, schema and RLS complete on the
live database**; what each still lacks is its management UI, noted the same way
and gathered in "What remains" at the top of this document. Phases 11–21 are
untouched specifications.

---

## PHASE 1 — Design system ✅ COMPLETE

**Built.** `DESIGN.md` carries the direction contract. The world is the
**instrument gauge**: money is a level, not a number. Type is Archivo and Chivo
Mono (one foundry); monospace carries figures and scale labels only. Color is
reserved for financial meaning — there is no brand accent, the primary action is
solid ink. Light is the default, chosen from the use scene; dark is designed,
not derived.

Components built: `Gauge`, `Amount`, `Readout`, `Button`, `Field`/`Input`/`Select`,
the `Ledger` family, `Status`, `Provenance`, `EmptyState`, `Skeleton`, `Problem`,
`Page`/`PageHeader`/`Section`/`Rule`. Deliberately **not** built: Modal, Drawer,
Sheet, Tabs, Combobox, DataTable, Chart, CommandMenu, DatePicker, RuleBuilder —
each arrives with the screen that needs it.

**Refused on purpose, recorded in DESIGN.md:** cards as page structure, the
hero-metric template, decorative rings and sparklines, eyebrows over every
section, gradient text, color as the sole carrier of state.

The original brief and traps follow, unchanged, because they still govern any
new surface.

### Scope

Run `impeccable new-work`. The brief is already pinned in `PRODUCT.md` —
monochrome-first, editorial, calm, data-dense, expensive, timeless. Explicitly
ruled out: chat-wrapper layouts, AI ornamentation, neon gradients,
glassmorphism, rainbow charts, emoji, template SaaS.

Two modes with one identity: **Operate** for the app, **Persuade** for
marketing.

Write `DESIGN.md` **before the first UI commit**, not after.

Components to build (spec §71): Button, Input, Select, Combobox, Modal, Drawer,
Sheet, Tooltip, Dropdown, Tabs, Table, DataTable, Chart, Stat, Badge, Progress,
EmptyState, Skeleton, Toast, CommandMenu, DatePicker, MoneyInput,
CurrencyInput, TransactionRow, AccountCard, GoalCard, DebtCard, AllocationCard,
RuleBuilder, DocumentUploader, ImportReview, FinancialHealthCard.

### Motion (from `apple-design`)

| Interaction                    | Damping                               | Response |
| ------------------------------ | ------------------------------------- | -------- |
| Default UI                     | 1.0 (critically damped, no overshoot) | 0.3–0.4  |
| Momentum (flick, drag release) | ~0.8                                  | 0.3–0.4  |
| Sheet / drawer                 | 0.8                                   | 0.3      |

Rules: animate from the **presentation** (live) value, never the target, so
motion is interruptible. Hand off gesture velocity at release. Project momentum
with `current + (v/1000)·d/(1−d)`, `d ≈ 0.998`. Enter and exit along the same
path. Respond on pointer-_down_, not release. Rubber-band at boundaries.
`prefers-reduced-motion` gets a gentler equivalent, not the absence of feedback.

Number transitions matter here: net worth and safe-to-spend **change**, they do
not blink. Tabular numerals everywhere figures stack.

### Deliverables

- `DESIGN.md` at the app boundary
- `packages/ui` filled: tokens replaced, components built, Storybook-or-equivalent
- Dark/light both styled (decide which the product _opens_ in from the physical
  usage scene, not by default)
- Delete `apps/web/src/app/[locale]/page.tsx` provisional screen

### Tests

Component rendering, keyboard interaction, focus management, reduced-motion
behavior, contrast ratios.

### Traps

- The measured-rendition reflex: warm cream + high-contrast serif + terracotta
  accent is what every model ships. The brief says monochrome and editorial —
  execute that at full commitment, not as a soft default.
- Do not build components speculatively. Build what Phases 2–4 need; add the
  rest when their screen exists.

---

## PHASE 2 — Auth and multi-tenancy ✅ COMPLETE

**Built.** Every table below exists on the live project with RLS forced, and 14
tests assert the isolation boundaries. Sign-in, sign-up, sign-out, the auth
callback, profile creation on first sign-in, household onboarding and the route
guards all run; 8 end-to-end tests exercise them against real Supabase.

Two structural decisions the tests exist to protect:

- `app.is_household_member` is `SECURITY DEFINER` **with a pinned
  `search_path`**. The definer part breaks the recursion a membership policy
  would otherwise have against its own table; the pinned path stops a caller
  shadowing `app.household_members` with a temp table and handing themselves
  access. A test fails if any definer function in `app` loses that pin.
- Every table uses `FORCE ROW LEVEL SECURITY`, not merely `ENABLE`. Without
  `FORCE` the table owner is exempt — and migrations, jobs and seeds all connect
  as the owner, so that exemption is precisely where a mistake would go
  unnoticed. The test caught `app.category_templates` missing it.

Creating a household is a chicken-and-egg problem against the membership policy:
you cannot be the owner of a household with no members. Rather than loosen the
policy, both rows are written by `app.create_household`, a definer function that
validates the caller.

Sessions are read with `supabase.auth.getUser()`, which validates the token with
the auth server — never `getSession()`, which decodes a cookie the browser
controls. The proxy refreshes the session on every request, because a Server
Component cannot write cookies and without that a user is signed out
mid-session for no reason they can see.

**Deliberately not built:** MFA, magic link, OAuth, invitation sending, the
household switcher. The invitations table exists; nothing sends them.

### Scope

Supabase Auth: email/password, magic link, OAuth-ready, email verification,
MFA-ready architecture, session management.

Entity model:

- **User** — a human account (mirrors `auth.users`)
- **Person** — a financial identity; can belong to multiple contexts
- **Household** — a financial group (one person, two partners, a family)
- **Membership** — user↔household, with role
- **Organization** — accounting firms, white-label partners, the SaaS company

Roles: `owner`, `partner`, `member`, `viewer`, `accountant`, `advisor`.

Hierarchy: `platform → organization → clients → households`.

### Database

```
app.profiles              (extends auth.users)
app.people
app.households
app.household_members     (user_id, household_id, role, joined_at, invited_by)
app.organizations
app.organization_members
app.household_invitations
audit.events              (actor, action, entity, entity_id, metadata, ip, ua, at)
```

RLS policies on all of them. The core helper — every later phase depends on it:

```sql
create function app.is_household_member(household uuid) returns boolean
```

`SECURITY DEFINER`, `STABLE`, and it must not recurse through a policy that
calls it.

### Tests — the most important security tests in the project

- User A cannot read user B's household by any query path
- A `viewer` cannot write
- An `accountant` sees only explicitly granted households
- Revoking access takes effect immediately
- A membership row cannot be self-inserted to grant access

### Traps

- **RLS recursion.** A policy on `household_members` that queries
  `household_members` deadlocks or infinitely recurses. Use a `SECURITY DEFINER`
  function.
- Do not put role checks only in the app layer.
- `auth.uid()` is null in service-role context — policies must not silently
  pass.

---

## PHASE 3 — Core financial data model ⚠ PARTLY DONE

**Done.** Every table in the specification below exists on the live project with
RLS forced, indexes driven by the queries the engines actually make, and a
Drizzle schema mirroring it (`packages/database/src/schema/financial.ts`). Two
constraints are load-bearing: the amount's sign must agree with its direction,
so an inflow recorded as negative cannot quietly reverse a month's cash flow;
and a `mixed` tax classification without a business percentage is rejected,
because that is not a classification.

`apps/web/src/server/repositories/position.ts` reads real rows and computes
liquid, committed and available for the position screen.

**Remaining — the largest single gap in the project.** There is no UI to create
or edit **accounts, transactions, categories, merchants, budgets, goals or
debts**. Nothing can be entered through the product today; the test account was
inserted with SQL. Build this first. Everything from Phase 6 onward assumes
transactions exist.

### Database

**`app.accounts`** — owner, household, institution, name, masked number,
currency, current balance, available balance, credit limit, type, scope,
status, source, last synced. Types: checking, savings, credit_card, loan,
mortgage, investment, cash, digital_wallet, business, tax_reserve, other_asset,
other_liability. **Never store bank credentials.**

**`app.transactions`** — the table everything else hangs off:

```
id, account_id, owner_id, household_id
transaction_date (date), posted_date (date)
amount (numeric 19,4), currency, direction
description_original, description_normalized
merchant_id, category_id, subcategory_id
budget_id, goal_id, tax_classification_id, business_percentage
confidence, source_document_id, source_import_id, external_reference
fingerprint, duplicate_group_id, transaction_status, scope
created_at, updated_at, deleted_at
```

Statuses: `pending`, `posted`, `excluded`, `transfer`, `duplicate`,
`needs_review`, `reconciled`.
Scopes: `PERSONAL`, `PARTNER`, `HOUSEHOLD`, `BUSINESS`.

Also: `app.categories` (household-owned, seeded from `category_templates`),
`app.merchants`, `app.merchant_aliases`, `app.budgets`, `app.budget_lines`,
`app.goals`, `app.debts`, `app.obligations`.

Indexes driven by real access patterns: `(household_id, transaction_date desc)`,
`(account_id, transaction_date)`, `fingerprint`, GIN trigram on
`description_normalized`.

### Traps

- Get the transaction table right now. Migrating it at ten million rows with
  RLS attached is the most expensive migration in this project's future.
- `business_percentage` belongs on the transaction, not derived at report time.
- Soft-delete transactions; accounting retention makes hard deletes wrong.

---

## PHASE 4 — Import engine ⚠ PARTLY DONE

**Done.** CSV and OFX parsing with format detection **by content, not by
extension**. R2 storage with household-scoped keys and five-minute signed URLs.
The `documents` / `imports` / `import_rows` tables. The upload action, the
import service and the history screen.

The pipeline is upload → hash → store → parse → assess → **stop at review**.
Nothing is written to `app.transactions`; an importer that writes first and asks
later has already broken the promise the product is built on. Three guards in
order of cheapness: a content hash that rejects a re-uploaded file before it is
parsed, an idempotency key that makes a retry a no-op, and the identity engine
on every row.

Verified end to end against live Supabase and R2: the same statement uploaded
twice under different filenames produced one document, one import and zero
duplicate transactions. Unreadable lines are reported, never dropped.

The CSV parser handles both thousands conventions, accounting parentheses and
the balboa symbol — `B/.` left a stray decimal point that a test caught.

**Remaining:**

- **Row-level confirmation.** Verdicts sit in `app.import_rows` and nothing
  turns them into transactions. This is the second gap that blocks everything.
- **An account picker.** The import uses the household's first active account
  rather than asking. A transaction filed against the wrong account is worse
  than one not filed.
- **XLSX and PDF.** Both throw an error naming the alternative.
- **Background jobs.** Parsing runs inside the request. Acceptable for CSV and
  OFX; mandatory to move before PDF or OCR.
- Virus scanning, institution detection, ownership prompts.

### Scope

Formats: PDF, CSV, XLSX, OFX, QFX, images, screenshots, invoices, receipts.

Pipeline: upload → security/virus validation → store privately → detect
document type → identify institution → parse → extract → normalize → detect
duplicates → match existing → review screen → import only confirmed.

**Never run PDF/OCR/AI parsing inside a synchronous HTTP request.** Background
jobs with status, retries, and an idempotency key.

The UX: user says "Banco General — Javier — July 2026", drags the PDF. System
detects institution, account, statement period, opening/closing balance, rows.
If ownership is not confident, **ask** — never silently assign:
_Me / My partner / Shared / Business / Other_.

Review screen shows: "1,284 transactions found — 1,241 matched automatically,
27 new, 16 possible duplicates." Provenance always visible: "Imported from
Banco General July 2026 statement."

### Database

```
app.documents          (owner, household, category, tax_year, type, source, date, retention, r2_key)
app.imports            (document_id, status, started_at, completed_at, counts, error)
app.import_rows        (raw extracted row, parse confidence, resolution)
app.institutions       (name, country, parser_hints)
platform.jobs          (status, started_at, completed_at, retries, error, idempotency_key)
```

Storage: **Cloudflare R2**, prefixes `marketing/ documents/ receipts/ reports/
exports/`. Financial documents are private; signed URLs with expiry only. Never
a public bucket.

### Traps

- Panamanian bank PDFs vary by institution and by year. Build a per-institution
  parser registry with a generic fallback, not one universal parser.
- A partially-imported statement is worse than a failed one. Wrap in a
  transaction.
- Re-uploading the same file must be caught by content hash before parsing.

---

## PHASE 5 — Duplicate and transfer engine ✅ COMPLETE

**Built** in `packages/transaction-engine`, 46 tests. The specification's own
example passes: `SUPER 99 CDE`, `SUPER99 #034` and `SUPER 99 COSTA DEL ESTE` at
$72.30 resolve to one transaction across three channels.

The ladder has five rungs — institution reference, fingerprint, exact amount and
date, amount within a window, merchant agreement — stopping at the first that
resolves. Certain at 0.95, review at 0.60.

Two calibration findings came out of testing rather than theory, and both are
worth keeping in mind before anyone "improves" the scoring:

- **Trigram overlap alone underrated abbreviation badly.** `super99` versus
  `super99 cde` fell into review when it is plainly one shop. Token containment
  is now a separate signal: one channel spelling out what another shortens is
  the common case, not the exception.
- **Two unrelated merchants at the same amount on the same day are treated as
  separate**, not flagged for review. That is an ordinary coincidence, and an
  alert that fires on nothing teaches people to dismiss the ones that matter.
  Genuine re-imports are caught upstream by the document hash and the
  fingerprint.

Transfer detection claims each leg at most once, so three same-day movements
produce three transfers rather than nine candidate pairs.

**Not yet wired:** the engine's verdicts are written to `app.import_rows` but
nothing acts on them, and `app.transfers` / `app.duplicate_candidates` are empty
because no transactions exist yet.

### The Transaction Identity Engine

Before creating any transaction, in order:

1. Exact external reference
2. Exact source transaction ID
3. Account + date + amount
4. Normalized description
5. Merchant
6. Nearby dates (configurable window)
7. Transfer detection
8. Document provenance comparison
9. Duplicate confidence score
10. Create **only** if nothing existing sufficiently explains the event

Deterministic matching first, probabilistic scoring second. **AI never alone.**

Must resolve to one logical transaction:

```
Statement:  SUPER 99 CDE            -$72.30
CSV:        SUPER99 #034            -$72.30
Bank API:   SUPER 99 COSTA DEL ESTE -$72.30
```

### Transfer detection

Account A `-$500` and Account B `+$500` within a date window, matching
amount/currency → **one transfer**, not an expense plus an income.

Covers same-household, same-user, external, and **credit card payments**. A card
payment is a transfer; the underlying card purchases are the expenses. Getting
this wrong double-counts spending every single month.

### Database

```
app.transaction_fingerprints
app.duplicate_groups
app.transfers            (from_transaction_id, to_transaction_id, confidence, detected_by)
app.reconciliations
```

### Tests

Import the same statement twice → zero new rows. Import overlapping date ranges
from two sources → correct merge. Card payment → not an expense. Same-amount
same-day _different_ purchases at the same merchant → **two** transactions, not
a false merge.

### Traps

- False positives are as damaging as false negatives. Two identical coffees on
  the same day are two transactions.
- Description normalization must be reversible — always keep
  `description_original`.

---

## PHASE 6 — Category and learning engine ✅ ENGINE COMPLETE

**Built** in `packages/category-engine`, 33 tests. Four rungs: a rule the
household or its accountant wrote, the merchant's established category, a
model's suggestion, then review. The ordering is what makes "user rules override
AI inference, always" structural rather than conventional — a suggestion is
capped below the auto-apply threshold and can never be applied unconfirmed.

Two decisions worth not reopening:

- **Rules are data, never expressions.** Four literal match kinds (`equals`,
  `starts_with`, `contains`, `tokens`) cover what people actually express and
  each runs in linear time. A customer-authored regex is arbitrary computation
  against every row of every import — a catastrophic-backtracking pattern
  written by someone categorizing their groceries is still a denial of service.
- **Two agreeing corrections before a proposal.** One correction is a
  preference; people re-file one-off purchases constantly, and a rule built from
  that is wrong every month afterwards. A proposal is written with `source: 'ai'`
  and the lowest authority until the household confirms it.

`shouldConsultAi` is the cost control: it returns false whenever a deterministic
path already resolves the row, so the model is never paid to re-derive an answer
a rule already gives.

**Not built:** rule-management UI, the review queue screen, and any actual model
call — the engine takes a suggestion as input and never makes one. Nothing to
classify until transactions exist.

**Goal:** the system learns from corrections.
**Depends on:** Phase 5.

### Scope

Merchant normalization, categorization, confidence scoring, review workflow.

**User rules override AI inference, always.** Distinguish:

- AI inference: "probably software"
- User rule: "Adobe is always Business / Software"

Rule provenance: `SYSTEM | AI | USER | ACCOUNTANT | TAX_AUTHORITY`.

Cache classifications. Never call AI for something deterministic.

### Database

```
app.merchant_rules       (pattern, merchant_id, category_id, source, confidence, priority)
app.classification_log   (transaction_id, before, after, source, actor, at)
```

---

## PHASE 7 — Budgets, recurring detection, safe-to-spend ✅ ENGINE COMPLETE

**Built** in `packages/budget-engine`, 35 tests. Safe-to-spend subtracts the
whole ladder and records how much of each claim the household can actually
cover, so "your rent is short $180" is available rather than only "you are $180
short". It is **never clamped at zero** — a negative figure is the most
important thing this system can say, and a floor would hide it.

Three findings from building it, all worth keeping:

- **Semimonthly is not biweekly.** A Panamanian salary paid on the 15th and the
  last day is 24 payments a year on two fixed calendar days, not 26 every
  fourteen. Collapsing them makes the engine predict a paycheck that never
  arrives. Anchor days are carried on the series so projecting it forward needs
  nothing else — and the month-end anchor is compared _after_ clamping to the
  month's real length, or a 30-day month stalls the series on the 30th forever.
- **Projection is suppressed until a fifth of the period has passed.** Pacing
  from day two of a month with rent posted predicts $13,950, and an alert that
  absurd teaches people to dismiss the ones that are real.
- **Medians throughout, never means.** One bonus month or one birthday party
  should not set the year's grocery budget or the next six months of forecast.

Forecasting is deterministic. An LLM is not a forecasting engine; AI explains a
forecast this package produced.

**Not built:** budget CRUD and screens, the financial calendar, notifications,
cron, and the health score. `computeSafeToSpend` is on the plan screen; the
overview still shows its narrower figure and says so.

**Goal:** a realistic budget generated from actual spending.
**Depends on:** Phase 6.

### Budgets

Monthly, annual, weekly, sinking funds, rollover, percentage, zero-based;
household, personal, business. States: `planned`, `committed`, `spent`,
`remaining`, `projected`.

### Safe-to-spend — a first-class financial concept

```
liquid cash
− committed expenses
− upcoming mandatory obligations
− minimum debt payments
− tax reserves
− goal allocations
− minimum cash buffer
= safe to spend
```

**Never** `balance = safe to spend`.

### Recurring detection

Rent, mortgage, subscriptions, utilities, insurance, salary, recurring freelance
income. Store `merchant, expected_amount, frequency, next_expected_date,
confidence, owner, category`.

### Forecasting

Deterministic statistical methods. Income, expense, cash, debt, goal and tax
reserve forecasts. **An LLM is not a forecasting engine.** AI explains the
forecast; it does not produce it.

---

## PHASE 8 — Debt engine ✅ ENGINE COMPLETE

**Built** in `packages/debt-engine`, 22 tests. Interest accrues daily and
compounds daily, computed as one exact rational over the whole window and
rounded once at the end. Thirty-one roundings to the cent, each biased the same
direction, is a systematic error — and it lands on the side that flatters the
plan. This is the specific reason `Money` carries four decimal places.

A promotional rate is a real rate until it expires, including inside the month it
ends, so avalanche does not chase a 0% balance transfer for the whole teaser
window.

Two refusals matter more than the payoff date, and both come back as a `Result`
rather than an exception:

- A monthly payment below the sum of the minimums is not a slower plan, it is
  not a plan. A household asking "what if I pay $300" against $420 of minimums
  gets an answer.
- A debt whose minimum does not cover its own interest never clears. It goes to
  `unresolvedDebtIds` rather than being given a fabricated payoff date.

Avalanche is cheaper and the tests assert it. The engine does not claim it is
therefore right for a given household — `comparePlans` prices the choice instead.

**Not built:** the simulation screen, debt CRUD, utilization display. `orderDebts`
feeds the plan; `simulatePayoff` has no UI yet.

**Goal:** the user knows exactly which debt to attack.
**Depends on:** Phase 7.

Fields: principal, current balance, APR, minimum payment, due date, statement
date, credit limit, utilization, promotional APR, promotional expiry.

Strategies: avalanche, snowball, custom priority, hybrid.

Simulate: interest saved, payoff date, monthly cash-flow impact, utilization
impact.

**Trap:** interest accrual is daily and compounds. This is exactly why `Money`
carries four decimal places — round once at the payment boundary, never between
accrual steps.

---

## PHASE 9 — Rule engine ✅ ENGINE COMPLETE

**Built** in `packages/rule-engine`, 27 tests. `WHEN [condition] THEN [action]`,
stored as JSON and never executed.

**`src/facts.ts` is the sandbox.** A condition can only compare a key from that
catalogue against a literal — there is no property path to traverse and nothing
evaluated as an expression, so there is nothing to escape from. Widening what
customer rules can see requires a code change and a review, not a row. Depth and
count limits exist because a rule arrives as JSON from a customer, and a thousand
nested conditions is a stack overflow with a name.

**Evaluation is three-valued, and that is the correctness argument.** A missing
fact is `unknown`, not false and not zero. A household with no emergency fund
writing `WHEN Emergency Fund < $5,000` would otherwise either have money routed
into an account that does not exist, or silently get nothing with no way to find
out why. The rule is skipped and the missing fact is named. A definite `false`
still settles an `all` group and a definite `true` still settles `any`, because
neither can be changed by whatever the missing fact turns out to be.

Money comparisons refuse to cross currencies. There is no exchange rate in this
system, by design.

Every evaluation is recorded, including the rules that did not fire — "why did
nothing happen?" cannot be answered from a log of matches.

**Not built: the visual builder.** `listFacts()` publishes the field list it
would need. Rules are read from `app.rules` and evaluated on the plan screen;
there is no way to author one through the product yet.

**Goal:** users customize the financial decision logic.
**Depends on:** Phase 8.

Visual builder: `WHEN [condition] THEN [action]`.

```
WHEN Emergency Fund < $5,000        THEN allocate 15% of incoming money
WHEN Credit Card APR > 20%          THEN priority = Critical
WHEN Income Type = Freelance        THEN reserve estimated taxes first
WHEN Travel Fund >= $2,000          THEN stop travel contributions
```

Rules support priority, conditions, actions, expiration, activation, an
explanation, and audit history.

**Trap:** rules must be evaluated in a sandbox with no ability to reach
arbitrary data. Store as structured JSON, not as executable code.

---

## PHASE 10 — Allocation engine ✅ ENGINE COMPLETE

**Built** in `packages/allocation-engine`, 22 tests, and rendered at
`/[locale]/plan`. A waterfall down a configurable ladder, built on
`Money.allocate` — which is what it was made exact for in Phase 0. The tests
assert that the lines sum to `allocated` and that `allocated + unallocated`
equals `incoming`: a plan losing a cent between its lines and its total is a plan
nobody can reconcile.

**How a tier splits money it cannot cover is a property of the tier, not the
algorithm.** Essentials fill one at a time, so the urgent bill is settled rather
than two left half-paid; equal-priority goals share from the start, which is what
ranking them equally meant. Neither policy withholds money — the remainder always
reaches the claim behind, and the gap is reported as that line's shortfall.

Two guards on customer rules:

- A rule may **raise** a claim, never lower one. Lowering is what
  `stop_allocation` is for, explicitly, and a stop stays stopped.
- `set_priority` reorders **inside a tier and never across one**. A rule that
  could move a travel fund ahead of rent is not expressing a preference.

Engines return `{ key, values }`, not sentences. The product ships in two
languages and no user-visible string may live outside `messages/{es,en}.json`, so
an engine returning prose would be either monolingual or a second copy of the
catalogue. `LineExplanation` and `RuleNote` carry the key; the app renders it.

**Not built:** plans are computed and shown but **not persisted** —
`app.allocation_plans` and `app.allocation_lines` are applied to the live
database and empty, so there is no accepted/modified tracking and therefore no
acceptance rate yet. There is also no accept or modify interaction, and the plan
runs against the liquid balance rather than a real arrival of income, because no
transactions exist.

The screen currently renders one obligation against one account balance: with
zero debts, zero goals and zero rules in the live household, the debt-order,
goal and rule sections have nothing to show. That is the engine working
correctly on the data that exists, not a defect.

**Goal:** every incoming dollar gets a recommended job. **The core differentiator.**
**Depends on:** Phase 9.

Default priority order (**user-configurable**):

1. Overdue essentials
2. Upcoming essential expenses
3. Minimum debt payments
4. Tax reserves
5. Emergency fund
6. High-interest debt
7. Investments
8. Travel / goals
9. Discretionary

Built on `Money.allocate()` — already implemented and proven exact.

Every recommendation is explainable:

> "Allocate $228 to Mastercard because it has the highest APR at 24.5% and your
> avalanche strategy is active."

Track: allocation viewed / accepted / modified. **Allocation acceptance rate is
the single most meaningful product metric.**

---

## PHASE 11 — AI copilot ✅ ENGINE COMPLETE

**Goal:** AI explains the system instead of replacing it.
**Depends on:** Phase 10.

**Built.** `@app/ai` — `AIProvider` with Anthropic, OpenAI, scripted and null
implementations; eight versioned prompts in `prompts.ts`; structured output
declared once and used twice (JSON Schema out, validator back); micro-dollar
cost accounting; a budget checked _before_ the call; a household-scoped cache;
and the guardrail that rejects any figure the grounding did not carry.
`@app/scenario-engine` projects a scenario against a position snapshot, never
against live rows. Schema version 10 adds `platform.ai_models` (pricing lives in
the database, not in code), `app.ai_invocations`, `ai_budgets`, `ai_cache` and
`app.scenarios`. The plan screen renders an AI narrative above the lines when a
provider is configured, and is unchanged when one is not.

**Not built.** No provider key exists, so no call has ever been made against a
live model — the whole package is exercised through `ScriptedProvider`. There is
no copilot chat surface, no scenario UI, no anomaly or budget-suggestion caller,
and the seeded model prices in `platform.ai_models` carry a null
`price_checked_at`: nobody has confirmed them against the providers, so every
cost figure is indicative until an administrator does.

### Architecture

`AIProvider` interface → `AnthropicProvider`, `OpenAIProvider`, future. Never
hardcode one provider. **Structured outputs only** — never free-form text for
anything computed.

Prompts live in `packages/ai/prompts/`, versioned
(`transaction-classification-v1`, `allocation-explanation-v1`, …), never buried
in React components. Prompt version recorded in every AI log.

### Cost control

Log provider, model, token usage, estimated cost, user, household, feature,
timestamp. Budget controls. Cache repeatable classifications. **Do not call AI
for deterministic tasks.**

### AI may

Explain recommendations, classify merchants, detect anomalies, summarize,
suggest budgets, answer questions, interpret documents, propose rules, explain
tax classifications, simulate scenarios.

### AI may not

Modify balances, create accounting entries, compute authoritative taxes,
override user rules, bypass permissions, delete records, or mark a duplicate
valid without deterministic checks.

### The copilot is NOT the main UI

Contextual assistant. Answers use real structured data — never a hallucinated
balance.

**Scenario engine** (may split into its own phase): buying a car, marriage, a
child, income loss, a bonus, paying off a card, vacation, moving, rent increase,
job change. Every scenario isolated from real data. Shows cash flow, debt,
savings, goal, net worth and runway impact.

---

## PHASE 12 — Panama tax engine ✅ ENGINE COMPLETE, RULES UNREVIEWED

**Goal:** versioned, sourced tax estimates.
**Depends on:** Phase 11. **Highest legal risk in the project.**

**Built.** `@app/tax-engine` — rule sets carrying jurisdiction, fiscal year,
version, effective window and provenance; progressive bracket arithmetic whose
lines always sum to the total; deductions that count only when a rule backs them;
a reserve proportional to income actually received; and expense classification
that never reaches `BUSINESS` on inference alone. `validateRuleSet` refuses to
publish a rule without a named reviewer and catches a gap between bands, which
would silently exempt a slice of income. Schema version 11 adds
`platform.tax_rule_sets` and `tax_rules` — with a check constraint making
publication impossible without `reviewed_by` and `reviewed_at` — plus
`app.tax_profiles`, `tax_estimates` and `expense_classifications`.

**Deliberately not done: the Panama figures are not verified.** The 2026 set
ships as a `draft`. Its brackets were transcribed from the commonly cited text of
Código Fiscal artículo 700 and **not checked against a primary DGI
publication**; the ITBMS rate and the filing deadline carry the same caveat; and
personal deductions are absent entirely, because a deduction with an unverified
cap lowers a reserve a household is relying on. RLS makes unpublished sets
invisible, `mayPresent()` returns false, `is_supported` for `PA` stays false, and
`estimateTaxReserve` returns null for every household in this build. The plan
screen therefore still uses the household's own configured rate, which is honest
about being their setting rather than a tax calculation.

**Publishing is not a status change.** It is a qualified person reading the
primary source, confirming each figure, and putting their name and the date on
it. A test asserts the shipped set is still a draft, so flipping it to make a
screen work fails the build.

**Also not built.** No tax onboarding UI (status, RUC, activity, accounting
method are asked nowhere yet), no expense-classification review screen, no ITBMS
return support, no admin rule editor — that belongs to Phase 20.

### Architecture

```
tax/jurisdictions/PA/2026/{rules,thresholds,deductions,deadlines,classifications}
```

**Never hardcode tax rules in React.** Every rule carries: jurisdiction, tax
type, fiscal year, `effective_from`, `effective_to`, source, `source_url`,
`source_reference`, `rule_version`, notes, `reviewed_by`, `reviewed_at`.

Admin workflow: Draft → Review → Approve → Publish → Version active. Rules
update **without redeploying the application**. Every calculation stores the rule
version used.

### Independent professional profile

Statuses: salaried, independent professional, freelancer, merchant, mixed
income, personal business. Capture RUC, activity, tax status, accounting method,
fiscal year.

**Ask the user their accounting/tax configuration — never assume.** Cash basis
availability for liberal professions and microenterprises, ITBMS treatment, and
filing deadlines must all be **verified against primary DGI sources** and
recorded with citations, not carried over from any summary (including the build
spec's own paraphrase).

### Expense classification

`PERSONAL | BUSINESS | MIXED | NON_DEDUCTIBLE | POTENTIALLY_DEDUCTIBLE |
REQUIRES_REVIEW`, plus `business_percentage` for mixed.

Always display: _"Estimated business allocation — confirm with your accountant."_

### Tax reserve

Income arrives → engine estimates reserve → amount becomes unavailable for
discretionary spending. **"Estimated tax reserve", never "your tax bill"** unless
computed from a finalized return.

### Disclaimers

Distinguish financial planning from tax preparation from tax advice. Do not
market as a replacement for a licensed accountant without the appropriate legal
framework. `is_supported` on a jurisdiction stays `false` until rules are
implemented **and reviewed**.

---

## PHASE 13 — Reporting ⚠ SUBSTANTIALLY BUILT

**Goal:** deterministic financial statements.
**Depends on:** Phase 12.

**Built.** `@app/reporting` — income statement, net worth, cash flow, an
operating statement for independents on a cash basis, reconciliation, the
monthly-close checklist, the financial health score, and CSV/JSON export. Every
statement starts by discarding transfers, which is the single rule separating a
report a household believes from one they stop opening. Schema version 12 adds
`app.accounting_periods` — with a **trigger that refuses any write into a closed
month**, so a correction has to be a new entry in an open period —
`app.reconciliations` (the difference is recorded, never adjusted away) and
`app.report_exports`. `/[locale]/reports` renders the statements and the health
score with every component's own figure beside it; `/api/reports/export` streams
CSV and JSON without writing a copy to object storage.

**Not built.** PDF and XLSX export — both need a dependency this build does not
carry, and a PDF that "must not look like a database dump" is a design job, not a
serializer. No period picker (the page shows the current month), no close or
reconciliation UI, no accountant-facing statement pack. Two health components
report null for every household: punctuality, because obligations do not yet
record whether they were paid on time, and tax readiness, because no published
tax rule set exists.

Balance Sheet, Income Statement, Cash Flow, Net Worth, Debt, Budget, Goal, Tax
Summary, Household Health.

**Generated from transaction queries, never from AI summaries.** AI may
summarize a statement; the numbers come from SQL.

Exports: CSV, JSON, PDF, XLSX, plus "Export everything". PDFs carry branding,
household name, period, generated date, charts, notes, disclaimers — and must
not look like a database dump.

For independents, an accounting view: Income, COGS, Operating Expenses, Tax, Net
Income. Cash basis working, accrual-ready.

**Reconciliation:** bank statement ending balance vs system balance, difference
shown, candidate causes identified. **Never silently adjust a balance.**

**Monthly close:** review uncategorized → duplicates → transfers →
reconciliation → recurring changes → tax classification → close. Closed months
are protected; corrections create adjustment history.

---

## PHASE 14 — Billing

**Goal:** subscriptions that never double-charge.
**Depends on:** Phase 13.

Plans: FREE, PLUS $9.99, COUPLE $17.99, PRO $29.99, FAMILY $39.99,
ACCOUNTANT/WHITE-LABEL. **Pricing lives in the database/CMS, not in components.**

Stripe behind a `BillingProvider` abstraction — no Stripe-specific logic in
domain models.

Lifecycle: checkout, subscription, upgrade/downgrade, cancellation, trial, grace
period, failed payment, invoice, receipt, coupon, promotion, proration.

**Entitlements, not plan checks.** Never `if (plan === 'pro')`. Instead:
`transactions_per_month`, `household_members`, `document_imports`, `rules`,
`goals`, `reports`, `tax_engine`, `accountant_mode`, `white_label`, `ai_usage`.
Warn before hard limits.

**Webhooks must be idempotent.** Store the event ID; replaying must be a no-op.

---

## PHASE 15 — Internal SaaS accounting

**Goal:** the company's own real double-entry ledger.
**Depends on:** Phase 14.

```
platform.ledger_accounts
platform.journal_entries
platform.journal_lines
```

**Every entry: DEBITS = CREDITS.** Enforced by a database constraint, not by
convention.

```
Customer pays $20:   Dr Cash $20            Cr Subscription Revenue $20
Refund $20:          Dr Contra Revenue $20  Cr Cash $20
Processor fee:       Dr Payment Processing  Cr Cash/Processor Receivable
```

**Do not fake accounting with a `balance` column.**

Track customers, subscriptions, invoices, refunds, credits, discounts, taxes,
revenue, deferred revenue, AR, processor fees, SaaS expenses, vendor expenses,
payroll placeholders, cash, bank accounts.

SaaS metrics that must reconcile against the ledger: MRR, ARR, New/Expansion/
Contraction/Churned MRR, logo churn, NRR, GRR, ARPU, CAC placeholder, LTV,
trial conversion, activation, DAU/WAU/MAU, retention, paid conversion.

---

## PHASE 16 — CMS

**Goal:** marketing content is data, not code.
**Depends on:** Phase 15.

Landing page, pricing, FAQs, blog, articles, authors, categories, SEO metadata,
redirects, legal pages, changelog, testimonials, case studies, feature pages,
comparison pages.

`media_assets` table (`id, r2_key, url, alt, width, height, mime_type, metadata,
created_at`) — never hardcode image URLs. Meaningful alt text on everything.

SEO per page: title, description, canonical, OG title/description/image,
structured data, breadcrumbs. Article schema on blog, SoftwareApplication where
appropriate. **Never fabricate ratings.**

---

## PHASE 17 — Landing page

**Goal:** a marketing site that could raise venture capital.
**Depends on:** Phase 16. **Product name must be decided before this ships.**

Routes: `/ /pricing /features /couples /independents /accountants /security
/about /blog /blog/[slug] /changelog /contact /terms /privacy`

Hero: _"Your life's financial operating system."_
Sub: _"Know what you have. Know what is coming. Know exactly what your money
should do next."_
CTA: _"Build my financial system"_ · Secondary: _"See how it works"_

Then: product visualization, allocation demo, household, debt, independents, tax
reserve, automation, privacy/security, accountant/white-label, pricing, FAQ,
final CTA.

Tone: intelligent, understated, premium, confident, concise. Not _"Revolutionary
AI-powered financial transformation"_ — rather _"Your money is complicated. Your
financial system shouldn't be."_

**No fake testimonials. No fabricated customer logos.** Demonstration data is
authored at full fidelity and labeled synthetic. Commercial claims that cannot
be substantiated ship as clearly marked placeholders on the user's replacement
list.

---

## PHASE 18 — Accountant portal

**Depends on:** Phase 17.

Client list, client health, pending reviews, tax status, documents, reports,
permissions, notes, requests.

**Accountants never automatically gain access to anything.** Access is explicit,
scoped and revocable.

---

## PHASE 19 — White label

**Depends on:** Phase 18.

Custom logo, custom domain, primary color, favicon, email branding, support
email, privacy policy, terms, custom onboarding, custom plan.

Architecture: `platform → organization → clients → households`.

---

## PHASE 20 — Admin platform

**Depends on:** Phase 19.

Separate application. Sections: Overview, Users, Households, Organizations,
Subscriptions, Revenue, Ledger, Transactions, Documents, Rules, CMS, Feature
Flags, Support, Audit Logs, System Health.

Admin roles: `super_admin`, `finance_admin`, `support_admin`, `content_admin`,
`tax_reviewer`.

Product analytics answering: active households, connected accounts, transactions
processed, duplicate detection rate, automatic categorization rate, manual
correction rate, allocation acceptance rate, MRR, tax module adoption, churn.

Support: users report issues with screenshots and transaction references; admins
see customer, household, subscription, logs, ticket history — **without
unnecessary exposure of financial data**.

Feature flags scoped global / organization / household / user:
`bank_connections`, `tax_engine_panama`, `accountant_mode`, `white_label`,
`ai_copilot`, `scenario_engine`, `advanced_reports`.

---

## PHASE 21 — Hardening

**Depends on:** Phase 20.

Security review, RLS audit, dependency audit, performance optimization,
accessibility audit, full E2E, load testing, error handling, observability.

### Final quality bar

- No TypeScript errors, no ESLint errors, production build passes
- Migrations work from an empty database; seed works
- RLS tests pass; unauthorized access blocked
- Duplicate imports prevented; transfers detected; card payments not expenses
- Internal ledger balances; billing webhooks idempotent
- Tax calculations versioned; documents private; exports work
- Mobile works; accessibility passes
- Landing, CMS, admin, accountant permissions, white-label all work

Performance targets: LCP < 2.5s, INP < 200ms, CLS < 0.1.
Accessibility target: WCAG 2.2 AA.

---

# Part 5 — Cross-cutting work (appears in many phases)

**Onboarding** (after Phase 10, revisited later) — under five minutes. Who are
you → what are you trying to accomplish → create household → import data →
review accounts → review categories → set goals → generate first plan. The magic
moment: _"We analyzed your finances and created your first financial operating
plan."_

**Notifications** (from Phase 7) — email, in-app, push-ready. Bill due, unusual
transaction, duplicate detected, tax reserve low, budget exceeded, goal
milestone, debt milestone, subscription issue, import complete, review required.
Preference controls required.

**Cron** (from Phase 7) — daily: upcoming obligations, duplicate checks, health
recalculation. Weekly: summary, budget projection. Monthly: statements, billing
reconciliation, tax reserve review. Annually: tax year close, annual report.

**Financial health score** (Phase 7+) — transparent, clickable ("Why 82?"),
built from emergency fund, debt utilization, payment punctuality, savings rate,
cash flow, goal progress, tax readiness. **Never presented as a credit score.**

**Anomaly detection** (Phase 6+) — neutral language: _"Your electricity bill is
42% higher than your six-month average."_ Do not alarm unnecessarily.

**Data quality indicators** (Phase 4+) — complete / partial / stale /
conflicting / needs_review. _"Your checking account was last imported 34 days
ago."_ This is what stops the system from giving confident advice on stale data.

**Financial calendar** (Phase 7+) — bills, debt payments, salary, expected
freelance income, tax deadlines, subscriptions, goals. Marks "cash pressure"
days where obligations exceed projected inflows.

**Runway** (Phase 7+, independents) — liquid cash + expected income − expected
expenses − tax reserve. _"Estimated runway: 4.7 months."_

**Receipts and invoices** (Phase 4/5) — a receipt matches an existing
transaction and attaches to it. It **never creates a second transaction**. Same
for invoices matching incoming payments. This is a duplicate-prevention case, not
a document feature.

**Email** (Phase 14+) — provider abstraction. Welcome, verify, import complete,
summary, bill reminder, tax deadline, subscription, payment failed, export
ready, accountant invite. Premium and minimal; no spammy gradients.

**Legal/consent** (Phase 17+) — `terms_version`, `privacy_version`,
`accepted_at`, tax disclaimer version, marketing consent.

**Privacy rights** (Phase 20/21) — export data, delete account, delete
household, revoke accountant, remove documents, disconnect accounts. When
deletion cannot happen immediately (audit/accounting retention), **explain why**.

**Empty states teach.** No goals → _"Give your money somewhere to go."_ No
transactions → _"Import your first statement."_ No budget → _"Build a budget
from your actual spending."_

**Test fixtures** (from Phase 3) — deterministic household: Alex + Taylor;
Checking, Savings, Visa, Mastercard; salary, freelance, rent, electricity,
groceries, Netflix, card payments; Visa 18.9% and Mastercard 24.5%; emergency
fund $5,000 and travel $2,000. Use this to validate the allocation engine.

---

# Part 6 — Open decisions

| Decision                                                | Owner        | Needed by |
| ------------------------------------------------------- | ------------ | --------- |
| Product name (`Norte` is a placeholder)                 | User         | Phase 17  |
| Whether the product ever positions as tax _preparation_ | User + legal | Phase 12  |
| Final pricing figures                                   | User         | Phase 14  |
| Stripe account                                          | User         | Phase 14  |
| AI provider keys                                        | User         | Phase 11  |
| GitHub remote (CI is written but has no remote)         | User         | Any time  |

Settled since the original list: Supabase credentials (live), R2 account and
bucket (live, `cifraapp`), and the theme the product opens in (**light**, chosen
from the use scene — a person reviewing a statement at a desk in daylight).

---

# Part 7 — Phase report format

Every phase ends with exactly this, then **stop**:

```
Completed   — exact features
Database    — migrations added
APIs        — endpoints / server actions
UI          — screens / components
Tests       — what ran, what passed, what skipped and why
Validation  — lint, typecheck, build, tests
Known Issues— explicit, no hiding
Next Phase  — recommendation
```

Do not begin the next phase without being asked.

## Working method for each phase

1. Inspect what exists — do not assume files are present
2. Identify gaps
3. Plan
4. Implement
5. Run tests, lint, typecheck, build
6. Fix
7. Update documentation **and this file**
8. Commit logically
9. Report and stop

**Never destroy working code to implement a feature. Never rewrite the project
without justification. Never create empty packages ahead of need.**
