# Security

Everything in this system is financial data. It is treated as sensitive by
default, and exceptions are argued for rather than assumed.

## What is in place after Phase 0

**Secrets.** Read in one module, validated with Zod, memoized. A lint rule makes
`process.env` an error everywhere else. `.gitignore` excludes every `.env` file
except the example. No secret has a `NEXT_PUBLIC_` prefix.

**Server/client boundary.** `@app/database` throws at module load if it is ever
evaluated in a browser. `apps/web/src/server/database.ts` adds `server-only`, so
importing it from a Client Component is a build error rather than a shipped
connection string.

**Two database roles.** The request path connects as `authenticated` with RLS
enforced. The service-role connection bypasses RLS and is reserved for
migrations, jobs and seeds. They are separate functions with separate
connections so the choice is always deliberate.

**Transaction-local identity.** `withUserContext` sets JWT claims with
`set_config(..., true)`. The setting is discarded when the transaction ends, so
a pooled connection cannot carry one user's identity into another user's
request.

**Deny by default in Postgres.** `revoke all` on every schema, then explicit
grants per table.

**Security headers.** `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy`, HSTS. `X-Powered-By` removed. Asserted
by an end-to-end test, because a header that is configured but not delivered is
not a header.

**Error surfaces.** The user-facing error boundary never renders the underlying
error. A stack trace or database message can carry account numbers, statement
descriptions or connection strings. The digest correlates the screen with the
server log that does hold the detail.

**Health endpoint.** Publicly reachable, so it reports connection failures
generically rather than echoing hostnames or credentials.

**Install scripts.** Blocked by default in `pnpm-workspace.yaml`. A postinstall
script is arbitrary code execution inside a repository that will hold financial
data; the four allowed entries are native build toolchains that genuinely need
one.

## Rules that hold everywhere

Never store bank credentials. The system ingests statements and files; it does
not hold the keys to an account.

Never log a full account number, a tax identifier, a credential, a document, or
a transaction description that could identify a person's activity. Mask on the
way in, not on the way out.

Never rely on the frontend for authorization. A hidden button is not a
permission.

Never let AI be the authority on a balance, a tax figure, a permission, or a
ledger entry. It explains deterministic output.

Never bypass RLS to make a query convenient.

## What is deliberately not in place yet

Rate limiting, CSP with nonces, malware scanning on uploads, signed URLs for
private documents, the audit log's write path, MFA, and session revocation.
Each belongs to the phase that introduces the surface it protects; Phase 21 is
the systematic review across all of them.

No compliance claim is made. The product does not assert SOC 2, PCI, GDPR
conformance or bank-level security, and must not until each is independently
established.
