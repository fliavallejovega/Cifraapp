#!/usr/bin/env node
/**
 * Preflight: everything that has to be true before this repository can ship.
 *
 * It exists because each of these checks is one that has already failed here,
 * silently, and cost an afternoon:
 *
 *   - the Vercel CLI logged itself into a different account mid-session, so a
 *     deploy went nowhere and the error said «Not authorized»;
 *   - a migration was applied to the database and the file never committed,
 *     so the next deployment ran code against a schema nobody else had;
 *   - the console connected through the session pooler and exhausted a cap it
 *     shared with the migration path;
 *   - a copy key existed in Spanish and not in English, which renders as the
 *     key itself on a customer's screen.
 *
 * Every check answers one question, states the answer, and — when the answer
 * is no — names the command that fixes it. Nothing here writes anything, and
 * no secret is ever printed: a token is reported as present or absent and by
 * which account it authenticates, never by its value.
 *
 *   pnpm preflight            every check
 *   pnpm preflight --quick    skips the network: git, toolchain and copy only
 */

import { execFile } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Tokens live where Pime Git's own preflight looks for them: the `env` block
 * of `.claude/settings.local.json`, which is ignored globally and never
 * committed. One location, so a rotated token is rotated once — and so the
 * repository's own checks and the funnel's agree about what they are reading.
 */
const CREDENTIALS = join(ROOT, '.claude/settings.local.json');
const QUICK = process.argv.includes('--quick');

const results = [];

/** Records one answer. `fix` is the command that would make it yes. */
function record(area, name, ok, detail, fix) {
  results.push({ area, name, ok, detail, fix });
}

async function attempt(area, name, work, fix) {
  try {
    const outcome = await work();
    if (outcome === undefined) return;
    record(area, name, outcome.ok, outcome.detail, outcome.ok ? undefined : (outcome.fix ?? fix));
  } catch (error) {
    record(
      area,
      name,
      false,
      error instanceof Error ? error.message.split('\n')[0] : 'failed',
      fix,
    );
  }
}

const git = async (...args) => (await run('git', args, { cwd: ROOT })).stdout.trim();

/** Parses `KEY=value` lines. Comments and blanks ignored. */
function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return out;
}

async function readEnvFile(path) {
  try {
    return parseEnv(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** The tokens, from the `env` block of the local Claude settings. */
async function readCredentials() {
  try {
    const parsed = JSON.parse(await readFile(CREDENTIALS, 'utf8'));
    const env = parsed.env;
    return typeof env === 'object' && env !== null ? env : null;
  } catch {
    return null;
  }
}

const api = async (token, path) => {
  const response = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: response.ok ? await response.json() : null };
};

// ---------------------------------------------------------------------------
// Identity and git — the Pime Git funnel
// ---------------------------------------------------------------------------

async function checkGit() {
  await attempt(
    'Git',
    'Pime Git accepts this repository',
    async () => {
      await run('pime-git', ['verify', ROOT]);
      return { ok: true, detail: 'account, SSH, email and origin all match' };
    },
    'pime-git apply   (or: pime-git map "<repo path>" fliavallejovega)',
  );

  await attempt('Git', 'origin points at the right account', async () => {
    const origin = await git('remote', 'get-url', 'origin');
    const expected = 'git@github.com-fliavallejovega:fliavallejovega/Cifraapp.git';
    return {
      ok: origin === expected,
      detail: origin === expected ? origin : `${origin} — expected ${expected}`,
      fix: 'pime-git apply',
    };
  });

  await attempt('Git', 'working tree is clean', async () => {
    const status = await git('status', '--porcelain');
    const count = status ? status.split('\n').length : 0;
    return {
      ok: count === 0,
      detail: count === 0 ? 'nothing uncommitted' : `${String(count)} file(s) uncommitted`,
      fix: 'pime-git git -- add -A && pime-git git -- commit -m "…"',
    };
  });

  await attempt('Git', 'branch is main and level with origin', async () => {
    const branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
    if (branch !== 'main') {
      return { ok: false, detail: `on ${branch}`, fix: 'git switch main' };
    }
    let ahead = '0';
    let behind = '0';
    try {
      const counts = await git('rev-list', '--left-right', '--count', 'origin/main...HEAD');
      [behind = '0', ahead = '0'] = counts.split(/\s+/);
    } catch {
      return { ok: false, detail: 'no origin/main to compare against', fix: 'pime-git pull' };
    }
    const ok = ahead === '0' && behind === '0';
    return {
      ok,
      detail: ok ? 'main, in sync' : `main, ${ahead} ahead / ${behind} behind`,
      fix: behind === '0' ? 'pime-git push' : 'pime-git pull',
    };
  });
}

// ---------------------------------------------------------------------------
// Toolchain
// ---------------------------------------------------------------------------

async function checkToolchain() {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

  await attempt('Toolchain', 'Node satisfies engines', () => {
    const required = Number((pkg.engines?.node ?? '>=22').replace(/[^\d.]/g, '').split('.')[0]);
    const actual = Number(process.versions.node.split('.')[0]);
    return {
      ok: actual >= required,
      detail: `node ${process.versions.node} (needs >= ${String(required)})`,
      fix: `install Node ${String(required)} or later`,
    };
  });

  await attempt('Toolchain', 'pnpm matches packageManager', async () => {
    const wanted = (pkg.packageManager ?? '').split('@')[1] ?? '';
    const actual = (await run('pnpm', ['--version'])).stdout.trim();
    return {
      ok: !wanted || actual === wanted,
      detail: `pnpm ${actual}${wanted ? ` (pinned ${wanted})` : ''}`,
      fix: `corepack prepare pnpm@${wanted} --activate`,
    };
  });
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** Every leaf key, flattened, so two catalogues can be compared as sets. */
function leafKeys(value, prefix = '') {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

async function checkCopy() {
  await attempt('Copy', 'Spanish and English carry the same keys', async () => {
    const dir = join(ROOT, 'apps/web/messages');
    const [es, en] = await Promise.all([
      readFile(join(dir, 'es.json'), 'utf8').then(JSON.parse),
      readFile(join(dir, 'en.json'), 'utf8').then(JSON.parse),
    ]);
    const spanish = new Set(leafKeys(es));
    const english = new Set(leafKeys(en));
    const missingEnglish = [...spanish].filter((key) => !english.has(key));
    const missingSpanish = [...english].filter((key) => !spanish.has(key));
    const ok = missingEnglish.length === 0 && missingSpanish.length === 0;
    return {
      ok,
      detail: ok
        ? `${String(spanish.size)} keys, both languages`
        : `missing in en: ${missingEnglish.slice(0, 3).join(', ') || 'none'} · missing in es: ${missingSpanish.slice(0, 3).join(', ') || 'none'}`,
      fix: 'add the key to both messages/es.json and messages/en.json',
    };
  });
}

// ---------------------------------------------------------------------------
// Vercel
// ---------------------------------------------------------------------------

async function checkVercel(credentials) {
  if (!credentials?.['VERCEL_TOKEN']) {
    record(
      'Vercel',
      'deployment credentials',
      false,
      `no VERCEL_TOKEN in ${CREDENTIALS}`,
      `create ${CREDENTIALS} with VERCEL_TOKEN=… (chmod 600)`,
    );
    return;
  }

  const token = credentials['VERCEL_TOKEN'];
  // The team, by slug. Its id used to be read from `VERCEL_ORG_ID`, which had
  // to go: the editor exports this settings block into every command, and
  // Vercel's CLI treats that variable as a project link that outranks its own
  // arguments. One deploy went to the wrong project before that was noticed.
  const team = credentials['VERCEL_TEAM'] ?? '';

  await attempt('Vercel', 'token authenticates', async () => {
    const { status, body } = await api(token, '/v2/user');
    const username = body?.user?.username ?? body?.username;
    const expected = 'fliavallejovega-5937';
    return {
      ok: status === 200 && username === expected,
      // The account, never the token. Which identity holds it is the fact
      // worth reporting; the token itself is not.
      detail:
        status === 200
          ? `${String(username)}${username === expected ? '' : ` — expected ${expected}`}`
          : `HTTP ${String(status)}`,
      fix: `replace VERCEL_TOKEN in ${CREDENTIALS} with one for ${expected}`,
    };
  });

  for (const [label, key] of [
    ['product', 'VERCEL_PROJECT_WEB'],
    ['console', 'VERCEL_PROJECT_ADMIN'],
  ]) {
    const name = credentials[key];
    if (!name) continue;

    await attempt('Vercel', `${label} project reachable`, async () => {
      const { status, body } = await api(token, `/v9/projects/${name}?teamId=${team}`);
      if (status !== 200) {
        return {
          ok: false,
          detail: `HTTP ${String(status)} for ${name}`,
          fix: 'check the token scope',
        };
      }
      const linked = body.link ? 'linked to GitHub' : 'not linked — deploys by CLI only';
      return { ok: true, detail: `${name} · root ${String(body.rootDirectory)} · ${linked}` };
    });

    await attempt('Vercel', `${label} last production deploy`, async () => {
      const { status, body } = await api(
        token,
        `/v6/deployments?app=${name}&target=production&limit=1&teamId=${team}`,
      );
      const deployment = body?.deployments?.[0];
      if (status !== 200 || !deployment) {
        return { ok: false, detail: 'no production deployment found', fix: 'pnpm deploy' };
      }
      const age = Math.round((Date.now() - deployment.created) / 60000);
      const state = String(deployment.state);
      // A build still in flight is not a failure. Reporting it as one turns
      // «you just pushed» into a red mark, and a preflight that cries wolf on
      // its own success is a preflight people learn to skip.
      const inFlight = state === 'BUILDING' || state === 'QUEUED' || state === 'INITIALIZING';
      return {
        ok: state === 'READY' || inFlight,
        detail: `${state.toLowerCase()}, ${String(age)} min ago${inFlight ? ' — still in flight' : ''}`,
        fix: 'pnpm deploy — the last one did not finish',
      };
    });
  }

  // Names only. A preflight that printed a value would be a preflight that
  // leaked one into a terminal transcript.
  await attempt('Vercel', 'product carries the environment it needs', async () => {
    const name = credentials['VERCEL_PROJECT_WEB'];
    const { status, body } = await api(token, `/v10/projects/${name}/env?teamId=${team}`);
    if (status !== 200) return { ok: false, detail: `HTTP ${String(status)}` };
    const present = new Set((body.envs ?? []).map((entry) => entry.key));
    const required = [
      'DATABASE_URL',
      'DIRECT_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_APP_URL',
    ];
    const missing = required.filter((key) => !present.has(key));
    return {
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `${String(required.length)} required keys present`
          : `missing ${missing.join(', ')}`,
      fix: 'vercel env add <KEY> production',
    };
  });
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

async function checkDatabase() {
  const env = await readEnvFile(join(ROOT, 'apps/web/.env.local'));
  if (!env?.['DIRECT_URL']) {
    record(
      'Database',
      'credentials',
      false,
      'no DIRECT_URL in apps/web/.env.local',
      'vercel env pull',
    );
    return;
  }

  let postgres;
  try {
    const require = createRequire(join(ROOT, 'packages/database/package.json'));
    postgres = (await import(require.resolve('postgres'))).default;
  } catch {
    record('Database', 'driver', false, 'postgres not installed', 'pnpm install');
    return;
  }

  const sql = postgres(env['DIRECT_URL'], {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    onnotice: () => undefined,
  });

  try {
    await attempt('Database', 'schema matches the migrations on disk', async () => {
      const [row] = await sql`select version, description from platform.schema_version limit 1`;
      const files = (await run('ls', [join(ROOT, 'supabase/migrations')])).stdout
        .trim()
        .split('\n')
        .filter((name) => name.endsWith('.sql'));
      const [applied] = await sql`
        select count(*)::int as n from supabase_migrations.schema_migrations`;
      const ok = applied.n >= files.length;
      return {
        ok,
        // The version the database reports and the number of files that exist
        // are two different facts, and a deployment fails in confusing ways
        // when they disagree.
        detail: `version ${String(row?.version)} · ${String(applied.n)} of ${String(files.length)} migration files recorded — ${String(row?.description).slice(0, 46)}`,
        fix: 'apply the missing migration, then record it in supabase_migrations.schema_migrations',
      };
    });

    await attempt('Database', 'every table in app and audit forces RLS', async () => {
      const rows = await sql`
        select c.relname
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('app', 'audit') and c.relkind = 'r'
           and not (c.relrowsecurity and c.relforcerowsecurity)`;
      return {
        ok: rows.length === 0,
        detail:
          rows.length === 0
            ? 'all forced'
            : `unprotected: ${rows.map((r) => r.relname).join(', ')}`,
        fix: 'alter table … enable row level security; alter table … force row level security;',
      };
    });

    await attempt('Database', 'no job has been stuck for over fifteen minutes', async () => {
      const [row] = await sql`
        select count(*)::int as n from app.jobs
         where status = 'running' and started_at < now() - interval '15 minutes'`;
      return {
        ok: row.n === 0,
        detail: row.n === 0 ? 'queue healthy' : `${String(row.n)} stuck`,
        fix: 'release the stale claims, then find out which worker died',
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------

const credentials = await readCredentials();

await checkGit();
await checkToolchain();
await checkCopy();
if (!QUICK) {
  await checkVercel(credentials);
  await checkDatabase();
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const bold = (text) => `[1m${text}[0m`;
const dim = (text) => `[2m${text}[0m`;
const green = (text) => `[32m${text}[0m`;
const red = (text) => `[31m${text}[0m`;

let area = '';
console.log('');
for (const result of results) {
  if (result.area !== area) {
    area = result.area;
    console.log(bold(area));
  }
  const mark = result.ok ? green('✓') : red('✗');
  console.log(`  ${mark} ${result.name.padEnd(44)} ${dim(result.detail ?? '')}`);
  if (!result.ok && result.fix) console.log(`      ${dim('fix:')} ${result.fix}`);
}

const failed = results.filter((result) => !result.ok);
console.log('');
console.log(
  failed.length === 0
    ? green(
        `All ${String(results.length)} checks pass.${QUICK ? ' (quick: network checks skipped)' : ''}`,
      )
    : red(`${String(failed.length)} of ${String(results.length)} checks failed.`),
);
console.log('');

process.exit(failed.length === 0 ? 0 : 1);
