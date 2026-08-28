# Working in this repository

A financial operating system for households and independent professionals.

**Start with [`docs/context.md`](docs/context.md)** — it carries the complete
system context, the current state, and full detail on all 21 remaining phases.
Then `PRODUCT.md` for product truth, `docs/architecture.md` for structure, and
`docs/decisions.md` before proposing anything that contradicts an ADR.

## Commands

```bash
pnpm dev              # Next.js dev server on :3000
pnpm build            # Production build, all packages
pnpm lint             # ESLint, type-aware
pnpm typecheck        # tsc across the workspace
pnpm test             # Unit + integration (vitest)
pnpm test:e2e         # Playwright, Chrome desktop + Safari mobile
pnpm format           # Prettier

pnpm db:migrate       # Apply migrations via Supabase CLI
pnpm db:seed          # Idempotent reference data
pnpm db:generate      # drizzle-kit → candidate SQL (review before committing)
pnpm db:reset         # Development only; refuses production
```

Without database credentials, prefix commands with `SKIP_ENV_VALIDATION=true`.
Integration tests skip and say so.

## Git and deploy (Pime Git — mandatory)

This repository is mapped to the **fliavallejovega** GitHub account (not
`javidavo05` / `pime`). SSH, `origin`, and commit identity are managed by
**Pime Git**. Never use bare `git commit`, `git push`, or `git pull` on this Mac.

| Item | Value |
| ---- | ----- |
| GitHub account | `fliavallejovega` |
| Repository | `https://github.com/fliavallejovega/Cifraapp` |
| SSH remote | `git@github.com-fliavallejovega:fliavallejovega/Cifraapp.git` |
| Vercel project | `cifraapp` |
| Production URL | `https://norte-web-three.vercel.app` |

**Every commit and production deploy** goes through Pime Git → GitHub (SSH).
Vercel is connected to the repo; a push to `main` triggers the production
deploy. Do not bypass this with direct `git` or assume another account.

```bash
pime-git verify
pime-git git -- add -A                    # stage (or selective paths)
pime-git git -- commit -m "type(scope): summary"
pime-git push                             # → GitHub → Vercel production
```

Before the first commit in a session: `pime-git verify`. If it fails:
`pime-git apply` and retry. Mapping: `pime-git map "<repo path>" fliavallejovega`.

**Manual Vercel CLI** (`npx vercel deploy --prod --yes`) is only for when the
user explicitly asks or Git deploy is broken — normal path is `pime-git push`.

Portal: `npm run pime-git:web` · Config: `~/.pime-git/config.json`

See `.cursor/rules/pime-git-pipeline.mdc` for the full funnel rules.

## Non-negotiable rules

**Money is never a `number`.** Use `Money` from `@app/domain`. Columns are
`numeric(19,4)`. No `parseFloat`, no float arithmetic, no `Math.round` on an
amount. Lint enforces this; do not suppress it.

**Financial dates are never a `Date`.** Use `PlainDate`. Columns are `date`.
Timestamps belong to audit and system columns only.

**Never bypass RLS for convenience.** `getAdminDb()` is for migrations, jobs and
seeds. Request paths use `withUserContext`.

**Never let AI be the source of truth** for a balance, tax figure, permission,
ledger entry, or duplicate decision. It classifies and explains deterministic
output.

**Never hardcode user-visible copy.** Every string goes through `messages/es.json`
and `messages/en.json`. A key added to one must be added to both; a test enforces
it.

**Never read `process.env` outside `@app/validation/env`.** Lint enforces this.

**Never commit a `.env` file, a bank statement, or a PII fixture.**

**Never silently destroy financial state.** Automatic changes record provenance.
Destructive operations confirm.

## Conventions

TypeScript strict with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. `any` is a lint error. Prefer a `Result` over an
exception for expected failures in the engines.

Compiled packages (`domain`, `validation`, `database`) use `.js` extensions in
relative imports — they run as Node ESM. The Next app does not; it is bundled.

Migrations are `supabase/migrations/YYYYMMDDHHMMSS_description.sql`. Generated
SQL is read before it is committed.

Commits follow `type(scope): summary`, e.g. `feat(import): add OFX parser`.

## Phase discipline

Work proceeds in phases (`docs/roadmap.md`). Before implementing one: inspect
what exists, identify gaps, plan, implement, run the full gate, fix, document,
commit. Do not start the next phase without being asked.

Do not create empty packages ahead of need. An engine package is created in the
phase that first uses it, with its first test.

Do not rewrite working code to introduce a feature.
