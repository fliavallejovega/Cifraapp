# Full system context

Written for whoever picks this up next — including a future session of me. It
carries everything needed to continue without re-deriving anything: what the
product is, what exists today, what every remaining phase contains, and the
traps waiting in each one.

**Read this first, then `CLAUDE.md` for the working rules.** `PRODUCT.md` holds
product truth, `docs/decisions.md` holds the ADRs, `docs/roadmap.md` is the
status table.

**Status as of the last session:** Phase 0 complete. Phase 1 complete. Phase 2's
database layer complete and validated; its auth flows are not built.
**Phases 1, 2 and 5 complete. Phases 3 and 4 substantially built.**

Supabase (`sdeeoccvwcvgsmgfsuoz`, us-west-2) and Cloudflare R2 (`cifraapp`) are
live and wired. `.env.local` at the repo root holds the credentials and
`apps/web/.env.local` symlinks to it, because Next reads only the app's own.
Tests use `TEST_DATABASE_URL` against local Postgres and never touch the real
project.

## Read this before resuming

1. A local Postgres 17 runs on `127.0.0.1:5432` with the Supabase roles already
   created. `pnpm --filter @app/database db:local` drops and rebuilds `norte_dev`
   from the migrations, applies the `auth` shim, and seeds. This is how the RLS
   suite runs for real — hosted Supabase credentials are still needed for auth
   itself, but no longer for schema work.
2. `.env.local` exists (gitignored) pointing at that database.
3. `DESIGN.md` is committed and authoritative. The world is the instrument
   gauge; do not reopen that decision.
4. What Phase 2 still needs: the Supabase SSR client, sign-in/sign-up/callback
   routes, profile creation on first sign-in, protected route guards, and the
   household switcher. The schema, policies and `app.create_household` bootstrap
   are done and proven.

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

# Part 2 — Current state (end of Phase 0)

## Toolchain, verified

| Tool         | Version                           | Note                                                                     |
| ------------ | --------------------------------- | ------------------------------------------------------------------------ |
| Node         | 22.20.0                           |                                                                          |
| pnpm         | 11.20.0                           | Installed globally via npm (corepack couldn't write to `/usr/local/bin`) |
| Supabase CLI | 2.72.7                            |                                                                          |
| Vercel CLI   | 58.5.1                            |                                                                          |
| gh           | 2.92.0                            |                                                                          |
| Docker       | Installed, **daemon not running** | Local Supabase stack unavailable; ADR-002 uses hosted                    |

## Pinned dependency versions

```
next 16.3.0 · react 19.2.8 · typescript 6.0.3 · tailwindcss 4.3.3
drizzle-orm 0.45.2 · drizzle-kit 0.31.10 · postgres 3.4.9
@supabase/supabase-js 2.112.2 · @supabase/ssr 0.12.4
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
  messages/es.json            ← every user-visible string
  messages/en.json
  e2e/foundation.spec.ts      22 passing, 2 skipped
  src/
    proxy.ts                  Locale negotiation (was middleware.ts; Next 16 renamed it)
    i18n/routing.ts           es default, en, localePrefix 'always'
    i18n/request.ts           Catalog loading, timeZone America/Panama
    i18n/navigation.ts        Locale-aware Link/redirect/useRouter
    i18n/messages.test.ts     Catalog parity: keys + interpolation placeholders
    server/database.ts        `server-only` guarded DB handle
    app/globals.css
    app/[locale]/layout.tsx
    app/[locale]/page.tsx     PROVISIONAL status screen — Phase 1 deletes this
    app/[locale]/not-found.tsx
    app/[locale]/error.tsx    Never renders the underlying error
    app/api/health/route.ts   App + DB readiness, schema version

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
  src/seed-data.ts            Currencies, PA jurisdiction, 40-node bilingual category tree
  scripts/{migrate,seed,reset}.ts
  (+ 2 test files, 10 passing / 4 skipped)

packages/ui/
  src/styles/tokens.css       PROVISIONAL — Phase 1 replaces color/type wholesale.
                              Motion + spacing tokens should survive.
  src/utils/cn.ts

supabase/migrations/
  20260806120000_foundation.sql     Extensions, 3 schemas, uuid_v7, set_updated_at, schema_version
  20260806120100_reference_data.sql currencies, tax_jurisdictions, category_templates

docs/                         architecture, database, security, decisions, roadmap, context (this file)
.github/workflows/ci.yml      verify job + e2e job
```

## Test inventory (74 passing)

| Suite               | Count           | Covers                                                                                                                     |
| ------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| domain/money        | 21              | Exact decimals, currency mismatch, rounding modes, **allocation reconciliation across every amount 1–1000¢ × 2–7 buckets** |
| domain/format       | 6               | `$1,234.56`, `B/. 1,234.56`, true minus sign, sign display                                                                 |
| domain/plain-date   | 12              | Invalid dates, DST boundaries, month-end clamping                                                                          |
| domain/ids          | 5               | UUID v7 version/variant, time ordering, 5000-item collision check                                                          |
| validation          | 11              | Rejects JSON numbers for money, timestamps for dates, unbounded pages                                                      |
| database/seed-data  | 10              | Unique slugs, no orphans, no cycles, bilingual coverage, kind inheritance                                                  |
| database/connection | 4               | **SKIPPED — no credentials**                                                                                               |
| web/messages        | 4               | Catalog key + placeholder parity                                                                                           |
| e2e                 | 22 (+2 skipped) | Locale negotiation ×3, security headers, health, no-store, 404, keyboard, focus ring                                       |

## Commands

```bash
pnpm dev · build · lint · typecheck · test · test:e2e · format
pnpm db:migrate · db:seed · db:generate · db:reset
```

Without credentials, prefix with `SKIP_ENV_VALIDATION=true`.

## BLOCKED — the one thing needed to unblock everything

**Supabase project credentials.** Migrations and seed are written and typechecked
but **have never run against a real Postgres**. Until they do, Phase 2 cannot
start, because Phase 2 is entirely database work.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=      # pooler, port 6543
DIRECT_URL=        # direct, port 5432
```

First action on receiving them: `pnpm db:migrate && pnpm db:seed && pnpm db:seed`
(twice, to prove idempotency) then `pnpm test` and confirm the 4 skipped
integration tests now run and pass.

## Known issues carried forward

1. DB integration tests skipped — see above.
2. `setRequestLocale` deprecation suppressed; `next/root-params` has no types
   until Next generates them (ADR-011). Revisit in Phase 1.
3. Product name `Norte` is a placeholder (ADR-001). Must be settled before
   Phase 17.
4. Visual identity is provisional and replaced wholesale in Phase 1.

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

# Part 4 — The remaining 21 phases

Each phase ends with: implementation, migration, RLS, server validation, UI
(loading/empty/error states), tests, docs, accessibility, mobile — and lint,
typecheck, build, tests green. Then **stop and report** in the format at the end
of this document.

---

## PHASE 1 — Design system

**Goal:** a premium visual foundation the whole product is built on.
**Depends on:** Phase 0.
**Blocked by:** nothing. **Can start immediately.**

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

## PHASE 2 — Auth and multi-tenancy

**Goal:** a secure multi-tenant foundation.
**Depends on:** Phase 0 (+ Phase 1 for UI).
**BLOCKED until Supabase credentials exist.**

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

## PHASE 3 — Core financial data model

**Goal:** the financial domain works with no AI involved at all.
**Depends on:** Phase 2.

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

## PHASE 4 — Import engine

**Goal:** a user uploads a bank statement and gets transactions.
**Depends on:** Phase 3.

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

## PHASE 5 — Duplicate and transfer engine

**Goal:** importing the same statement twice does not duplicate anything.
**Depends on:** Phase 4. **This is the product's credibility.**

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

## PHASE 6 — Category and learning engine

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

## PHASE 7 — Budgets, recurring detection, safe-to-spend

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

## PHASE 8 — Debt engine

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

## PHASE 9 — Rule engine

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

## PHASE 10 — Allocation engine

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

## PHASE 11 — AI copilot

**Goal:** AI explains the system instead of replacing it.
**Depends on:** Phase 10.

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

## PHASE 12 — Panama tax engine

**Goal:** versioned, sourced tax estimates.
**Depends on:** Phase 11. **Highest legal risk in the project.**

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

## PHASE 13 — Reporting

**Goal:** deterministic financial statements.
**Depends on:** Phase 12.

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

| Decision                                                | Owner                     | Needed by              |
| ------------------------------------------------------- | ------------------------- | ---------------------- |
| Product name (`Norte` is a placeholder)                 | User                      | Phase 17               |
| Supabase credentials                                    | User                      | **Phase 2 — blocking** |
| Whether the product ever positions as tax _preparation_ | User + legal              | Phase 12               |
| Final pricing figures                                   | User                      | Phase 14               |
| Which theme the product opens in (light/dark)           | Phase 1, from usage scene | Phase 1                |
| R2 account and buckets                                  | User                      | Phase 4                |
| Stripe account                                          | User                      | Phase 14               |
| AI provider keys                                        | User                      | Phase 11               |
| GitHub remote (CI is written but has no remote)         | User                      | Any time               |

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
