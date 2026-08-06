# Norte

A financial operating system for households, couples, families and independent
professionals.

Most personal finance software reports what happened to your money. This one is
built to answer what should happen next.

> `Norte` is a working name (ADR-001).

## Status

**Phase 0 — repository foundation. Complete.**

The application boots, both language routes render, and the health endpoint
reports database readiness. No product features exist yet; see
[docs/roadmap.md](docs/roadmap.md).

## Getting started

Requires Node 22+ and pnpm 11+.

```bash
pnpm install
cp .env.example .env.local     # fill in Supabase credentials
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Then open <http://localhost:3000> — it redirects to `/es` or `/en` depending on
your browser's language.

Without credentials, the app still runs:

```bash
SKIP_ENV_VALIDATION=true pnpm dev
```

The status screen will report the database as not connected, which is the
honest answer.

## Verifying

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e
```

## Layout

```
apps/web           Next.js 16 application
packages/domain    Money, dates, identifiers — pure, no dependencies
packages/database  Drizzle schema, clients, migrations, seed
packages/validation Zod primitives and validated environment access
packages/ui        Design system
packages/config    Shared tsconfig and ESLint
supabase/migrations Versioned SQL
docs/              Architecture, database, security, decisions, roadmap
```

## Documentation

|                                              |                                                      |
| -------------------------------------------- | ---------------------------------------------------- |
| [docs/context.md](docs/context.md)           | **Full context, state, and all 21 remaining phases** |
| [PRODUCT.md](PRODUCT.md)                     | What the product is and who it is for                |
| [docs/architecture.md](docs/architecture.md) | Structure, dependency direction, request path        |
| [docs/database.md](docs/database.md)         | Schemas, conventions, migrations, seed               |
| [docs/security.md](docs/security.md)         | What is protected, and what is not yet               |
| [docs/decisions.md](docs/decisions.md)       | Architecture decision records                        |
| [docs/roadmap.md](docs/roadmap.md)           | Phases and status                                    |
| [CLAUDE.md](CLAUDE.md)                       | Conventions and non-negotiable rules                 |

## License

Private and unlicensed.
