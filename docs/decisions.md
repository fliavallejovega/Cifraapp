# Architecture decisions

Each entry records a decision that would be expensive to reverse, why it was
made, and what it costs. Decisions are appended, never rewritten; a superseded
entry gets a note pointing at the one that replaced it.

---

## ADR-001 — Working name is `Norte`, and it is provisional

**Status:** Accepted, provisional · Phase 0

The specification left the product name as TBD. Building without any name blocks
brand tokens, metadata, email templates and marketing copy.

**Decision.** Use `Norte` as a working name. Internal packages are scoped
`@app/*` rather than to the product name, so renaming touches brand tokens and
copy rather than every import in the repository.

**Consequence.** The name must be settled before Phase 17 (landing page), when
it stops being an internal label and becomes a public commitment. Until then,
every appearance of `Norte` is a placeholder.

---

## ADR-002 — Supabase hosted project, not local Docker

**Status:** Accepted · Phase 0

Local Supabase requires a running Docker daemon. The development machine has
Docker installed but not running, and requiring it would put a heavyweight
dependency between a developer and a working checkout.

**Decision.** Develop against a hosted Supabase project. Migrations are applied
with `supabase db push --db-url $DIRECT_URL`, which works without linking a
project or running a local stack.

**Consequence.** Development shares a real database, so destructive commands are
guarded (`db:reset` refuses production and requires `CONFIRM_RESET=yes` against a
hosted URL). A local stack remains available to anyone who starts Docker; nothing
in the setup precludes it.

---

## ADR-003 — Bilingual Spanish and English from day one

**Status:** Accepted · Phase 0

The first market is Panama and the primary user speaks Spanish, but the product
targets accountants, regional white-label partners and the country's large
international population.

**Decision.** Ship `es` and `en` from the first commit, with `next-intl`,
`/[locale]/` routes and Spanish as the default. Every user-visible string lives
in `messages/`. A lint rule flags JSX text literals, and a unit test fails when
the two catalogs diverge in keys or interpolation placeholders.

**Consequence.** Every screen costs a second copy pass. Retrofitting i18n after
a few dozen screens is far more expensive, and a financial product that speaks
the wrong language to its user is not a product.

---

## ADR-004 — Drizzle for queries, Supabase CLI for migrations

**Status:** Accepted · Phase 0

The financial engines need typed, composable queries — aggregations, ledger
balancing, duplicate matching. The Supabase client alone would leave those as
untyped raw SQL. But two migration trackers over one database is a
reconciliation problem nobody wants at deploy time.

**Decision.** Drizzle owns the schema definitions and typed queries.
`drizzle-kit generate` produces candidate SQL into `supabase/migrations/`, which
is reviewed by hand and applied by the Supabase CLI. The CLI's
`supabase_migrations.schema_migrations` table is the single ledger of what has
been applied. `@supabase/ssr` handles Auth and Storage only.

**Consequence.** Generated migrations must be read before they are committed —
an auto-generated diff against a database holding real financial history can
drop a column it believes is unused. The review step is the control.

---

## ADR-005 — Money is an integer at scale 4, never a float

**Status:** Accepted · Phase 0

Binary floating point cannot represent most decimal fractions. `0.1 + 0.2` is
not `0.3`. In a ledger, that error compounds and eventually surfaces as a
balance that does not reconcile.

**Decision.** Money is `numeric(19,4)` in Postgres and a `Money` value object in
TypeScript, backed by a `bigint` counting ten-thousandths of a currency unit
with a mandatory ISO 4217 code. All arithmetic goes through `Money`. Rounding is
explicit, with a stated mode, and happens once at the boundary where an amount
becomes a payment or a displayed figure.

Why four decimal places rather than two: interest accrual, tax rates, business-use
percentages and proportional allocation all produce sub-cent intermediates.
Rounding those to cents at each step accumulates error.

**Consequence.** Money never round-trips through a JSON number; it serializes as
`{ amount: string, currency: string }`. Lint rules reject `parseFloat` and
arithmetic operators applied to monetary identifiers. `Money.allocate()`
distributes remainders deterministically so a split always sums back exactly —
verified across every amount from 1 to 1000 cents and 2 to 7 buckets.

---

## ADR-006 — Financial dates are calendar dates, not timestamps

**Status:** Accepted · Phase 0

A transaction posted on July 31 happened on July 31 everywhere. Stored as a
timestamp, a user in one timezone and a scheduled job in another disagree about
which month it belongs to — and a transaction that slides between months
corrupts budgets, statements and tax periods.

**Decision.** `transaction_date` and `posted_date` are `date` in Postgres and a
branded `PlainDate` string (`'YYYY-MM-DD'`) in TypeScript. Application code never
constructs a JS `Date` for a financial date. Audit and system columns remain
`timestamptz`. The request locale pins `America/Panama` so server and client
render the same day.

**Consequence.** Date arithmetic goes through the `PlainDate` helpers, which are
tested across DST boundaries and month-length rollovers (a statement due on the
31st has to land somewhere real in February).

---

## ADR-007 — UUID v7 primary keys

**Status:** Accepted · Phase 0

Transaction tables reach millions of rows. Random v4 keys scatter inserts across
the whole B-tree and fragment the index; recent-range scans then touch pages all
over the disk.

**Decision.** Primary keys are UUID v7 — a 48-bit millisecond timestamp followed
by randomness, so keys sort by creation time. Generated in the application for
round-trip-free inserts, with `public.uuid_generate_v7()` as the column default
for rows created by SQL, jobs and seeds.

**Consequence.** Creation time is inferable from an identifier. That is
acceptable for the entities involved and is not treated as secret.

---

## ADR-008 — TypeScript 6, not 7

**Status:** Accepted, revisit · Phase 0

TypeScript 7.0 (the native Go compiler) is the current `latest` tag. But
`typescript-eslint@8.66` declares a peer range of `>=4.8.4 <6.1.0`, so adopting
TS 7 today means giving up type-aware linting — which is where most of this
repository's domain guards live.

**Decision.** Pin TypeScript 6.0.3, the newest release the lint toolchain
supports. Fall back to 5.9.3 if any ecosystem package proves incompatible.

**Consequence.** Revisit once `typescript-eslint` supports TS 7. The compiler
speedup is real and worth taking when the guards can come along.

---

## ADR-009 — Strict TypeScript with no per-package exceptions

**Status:** Accepted · Phase 0

**Decision.** `strict`, plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns` and
`noPropertyAccessFromIndexSignature`, everywhere. `any` is a lint error.

**Consequence.** Third-party types occasionally need explicit annotation — the
Playwright config already needed a conditional spread rather than an `undefined`
assignment. That friction is the point: the same strictness will catch a
possibly-undefined balance in Phase 10.

---

## ADR-010 — Three financial worlds, three schemas

**Status:** Accepted · Phase 0

The system holds a customer's personal finances, a customer's business finances,
and the SaaS company's own books. Mixing them is the most expensive mistake
available: it would put the company's revenue in a household's net worth, or a
household's transactions in the company's ledger.

**Decision.** Separate Postgres schemas from the first migration: `app`
(customer financial data), `platform` (SaaS company accounting and operations),
`audit` (append-only trail). Access is revoked by default and granted per table.

**Consequence.** A customer subscription payment is two records in two domains —
a customer financial transaction and a platform revenue event — linked
explicitly rather than shared.

---

## ADR-011 — `next/root-params` migration deferred

**Status:** Accepted, temporary · Phase 0

`next-intl` deprecates `setRequestLocale` in favor of `next/root-params`. But in
Next 16.3 that module's types are generated during a build; before generation it
resolves to `any`, which defeats the strict-type rules the repository runs on.

**Decision.** Keep `setRequestLocale` with a narrow, documented lint suppression.

**Consequence.** Revisit in Phase 1, when the app's routing settles. The
deprecated call is functional and correctly opts pages into static rendering.

---

## ADR-012 — AI output is structured, grounded, and checked against the facts

**Status:** Accepted · Phase 11

A model asked to explain a plan will eventually write "that leaves you about
$1,400" when the figure is $1,340. It reads fluently, it is wrong, and nothing
downstream catches it — the number is prose, not a field.

**Decision.** Three mechanisms, all in `@app/ai`, none optional. Output shapes
are declared once and used twice: as the JSON Schema sent to the provider and as
the validator run over what comes back. Every call carries the grounding it may
reason from. Every generated string is checked, and an answer citing a figure the
grounding did not contain is rejected rather than shown.

**Consequence.** The copilot fails closed. A screen that would have shown an AI
paragraph shows the deterministic explanation it always had, and the failure is
logged with its prompt version. Prompt revisions are new versions, never edits,
so two of them can be compared on real logs.

---

## ADR-013 — Tax rules live in the database, versioned, sourced and reviewed

**Status:** Accepted · Phase 12

A tax rule is a fact about the world on a date, published by an authority, and it
changes. Encoding one in TypeScript makes it a fact about a deployment instead:
undated, unsourced, and wrong the moment the law moves.

**Decision.** Rules are rows in `platform.tax_rule_sets` and
`platform.tax_rules`, each carrying jurisdiction, fiscal year, version, effective
window, source, source URL and source reference. A set reaches `published` only
with a named reviewer and a review date — enforced by a check constraint, not by
process. Row-level security makes unpublished sets invisible to households, and
every stored calculation records the rule set version that produced it.

**Consequence.** Rules update without a deployment. The Panama 2026 set ships as
a **draft**, because its figures were transcribed rather than verified against a
primary DGI publication; `is_supported` for `PA` stays false and no household
sees a tax figure until someone qualified publishes a set. Making a tax screen
work is never a reason to change a status.
