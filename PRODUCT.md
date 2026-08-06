# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: individuals, couples and families in Panama managing shared and personal
money across several accounts and institutions, plus independent professionals
and freelancers whose personal and business finances overlap and who must set
aside their own taxes.

Secondary: accountants managing multiple client households, and white-label
partners reselling the product under their own brand.

The situation is recurring rather than occasional: money arrives, obligations
are pending, and the user has to decide what to do next — usually in a few
minutes, often on a phone, frequently without a clear picture of what is already
committed.

## Product Purpose

Most personal finance software reports the past. This system is built to answer
what should happen next: it ingests financial information, normalizes it,
refuses to duplicate it, categorizes it, learns from corrections, and produces a
concrete allocation plan for incoming money.

Success is a user who can answer five questions in seconds: how much do I
actually have, what is already committed, what should the next dollar do, am I
on track, and what risk should I know about.

## Positioning

The differentiator is a deterministic Financial Decision Engine. Transaction
identity, deduplication, transfer detection, budgets, debt strategy, tax
reserves and allocation are all computed by explicit rules the user can inspect
and override.

AI sits on top as an explanation and classification layer. It is never the
authority on a balance, a tax figure, a permission, or a ledger entry. Every
recommendation is traceable to the rule and the data that produced it.

The second differentiator is the duplicate-prevention guarantee: the same
statement imported twice, a receipt photographed after the bank feed already
recorded it, and the same purchase appearing in a PDF, a CSV and an API export
must all resolve to one logical transaction.

## Operating Context

Panama-first. Users hold accounts at local institutions (Banco General and
peers), receive statements as PDFs rather than through an aggregator API, and
transact in US dollars alongside balboas, which are pegged 1:1 but reported
separately.

Independent professionals file with the DGI, may use cash-basis accounting under
its rules, and need to reserve for taxes out of irregular income.

Households mix personal, partner, joint and business accounts, and do not
necessarily want full mutual visibility. Financial privacy inside a household is
a feature, not an omission.

Data enters by upload — PDF statements, CSV and XLSX exports, OFX and QFX files,
receipt photos, invoices — not by bank connection. A bank-connection provider
interface exists so that can change without rewriting the ingestion path.

## Capabilities and Constraints

Multi-tenant from day one: platform, organization, household and accountant-client
relationships, enforced by Postgres row-level security rather than application
filtering.

Bilingual Spanish and English from the first commit (ADR-003). Spanish is the
default.

Money is exact decimal arithmetic, never floating point (ADR-005). Financial
dates are calendar dates without timezones (ADR-006).

Deterministic engines and AI are strictly separated. AI may classify, explain,
summarize and propose; it may not modify balances, create accounting entries,
compute authoritative taxes, override user rules, or bypass permissions.

The tax engine is jurisdiction-aware and version-stamped. Every calculation
records which rule version produced it, with a source reference. Panama is the
first jurisdiction; none is claimed as supported until its rules are implemented
and reviewed.

The SaaS company's own double-entry accounting is a separate domain from
customer financial data and never shares rows with it.

**Undecided.** The product name (`Norte` is a working placeholder, ADR-001).
Pricing figures are drafted but not committed. Whether the product ever
positions itself as tax preparation rather than tax planning is an open legal
question, and until it is settled the product does not market itself as a
substitute for a licensed accountant.

## Brand Commitments

The brief pins the register: calm, precise, editorial, trustworthy, spacious,
data-centric, timeless. Monochrome-first with restrained semantic color.

Explicitly ruled out: anything that reads as a chat interface wrapped around a
model, AI ornamentation (sparkles, robot iconography, "Ask AI anything" as the
primary surface), neon gradients, heavy glassmorphism, oversized type as
decoration, rainbow charts, emoji-driven interfaces, generic template SaaS
layout.

AI should feel like infrastructure, not decoration.

The interface language avoids machine framing. "We noticed" rather than "AI
detected". "High confidence" rather than "97% model confidence". "Recommended
allocation" rather than "your AI assistant suggests".

Automation claims must be literally true. "1,284 transactions analyzed, 97%
categorized automatically, 18 need review" — never "100% automated".

## Evidence on Hand

None yet. There are no customers, no testimonials, no case studies, no
benchmarks and no press. No fabricated substitute for any of these may appear in
the product or its marketing.

Demonstration data for design and testing is authored synthetically and labeled
as such: the fixture household (two partners, four accounts, two debts, two
goals) exists to validate the allocation engine, not to imply a real user.

## Product Principles

1. **Correctness before automation, automation before speed, speed before
   visuals, visuals before AI.** Financial data that is wrong is worse than
   financial data that requires review.
2. **Never knowingly create a duplicate.** Deterministic matching first,
   probabilistic scoring second, AI never alone.
3. **Every classification is explainable.** Source, confidence and provenance
   are recorded for each one — system, rule, user, accountant, import, or AI.
4. **When uncertain, ask or flag. Never invent.** An item routed to review is a
   correct outcome.
5. **Privacy is a product feature.** Users choose what is shared inside a
   household; accountants get explicit, revocable access, never blanket access.

## Accessibility & Inclusion

WCAG 2.2 AA is the target. Color is never the only carrier of meaning — status
is stated in words as well as hue. Focus states are visible, because a keystroke
in this product eventually moves money. Layout scales with the user's text size
rather than breaking. Motion respects `prefers-reduced-motion` with a gentler
equivalent rather than the removal of feedback.
