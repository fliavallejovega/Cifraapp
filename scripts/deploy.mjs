#!/usr/bin/env node
/**
 * Deploying, without depending on which account the Vercel CLI happens to be
 * logged into.
 *
 * That dependency is the reason this exists. The CLI keeps one global session,
 * and signing into another account anywhere on the machine silently takes this
 * project's deployments with it — the failure reads «Not authorized», which
 * sounds like a permissions problem with the project rather than with the
 * terminal. Every command here passes the project's own token and scope
 * explicitly, so nothing about the machine's state can change where a deploy
 * lands.
 *
 *   pnpm deploy            preflight, then both applications
 *   pnpm deploy admin      the console only
 *   pnpm deploy web        the product only
 *   pnpm deploy --skip-preflight
 *
 * The product is linked to GitHub, so its production deploy is a push through
 * the Pime Git funnel and not a CLI upload — using the CLI there would produce
 * a deployment with no commit behind it, which is the kind of thing nobody can
 * explain a week later. The console has no GitHub link, so it uploads.
 */

import { execFile, spawn } from 'node:child_process';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
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

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith('-')) ?? 'all';
const skipPreflight = args.includes('--skip-preflight');

/** The tokens, from the `env` block of the local Claude settings. */
async function readCredentials() {
  const parsed = JSON.parse(await readFile(CREDENTIALS, 'utf8'));
  const env = parsed.env;
  if (typeof env !== 'object' || env === null) throw new Error('no env block');
  return env;
}

/** Streams a command so a five-minute build is not five minutes of silence. */
function stream(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit', cwd: ROOT, ...options });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${String(code)}`)),
    );
  });
}

let credentials;
try {
  credentials = await readCredentials();
} catch {
  console.error(`\nNo deployment credentials in ${CREDENTIALS}.`);
  console.error('Add an "env" block with VERCEL_TOKEN, VERCEL_TEAM and the project ids.\n');
  process.exit(1);
}

const token = credentials['VERCEL_TOKEN'];
const scope = credentials['VERCEL_TEAM'];
if (!token || !scope) {
  console.error(`\n${CREDENTIALS} is missing VERCEL_TOKEN or VERCEL_TEAM.\n`);
  process.exit(1);
}

if (!skipPreflight) {
  console.log('\n→ Preflight\n');
  try {
    await stream(process.execPath, [join(ROOT, 'scripts/preflight.mjs')]);
  } catch {
    console.error(
      'Preflight failed. Fix the checks above, or pass --skip-preflight if you know why.\n',
    );
    process.exit(1);
  }
}

/** The product: a push through the funnel. Vercel builds from the commit. */
async function deployWeb() {
  console.log('\n→ Product — pushing through Pime Git; Vercel builds from the commit\n');
  const status = (await run('git', ['status', '--porcelain'], { cwd: ROOT })).stdout.trim();
  if (status) {
    console.error('Uncommitted changes. Commit them through the funnel first:');
    console.error('  pime-git git -- add -A && pime-git git -- commit -m "type(scope): …"\n');
    process.exit(1);
  }
  await stream('pime-git', ['push']);
}

/**
 * The console: an upload, with the project named explicitly.
 *
 * The CLI reads its project link from `.vercel/project.json` in the working
 * directory, so the link is written, used, and removed again in a `finally`.
 * Leaving it behind would point every later CLI call in this repository at
 * whichever project was deployed last — including calls meant for the product.
 */
async function deployAdmin() {
  console.log('\n→ Console — uploading to Vercel\n');
  const link = join(ROOT, '.vercel');
  try {
    await mkdir(link, { recursive: true });
    await writeFile(
      join(link, 'project.json'),
      JSON.stringify({
        projectId: credentials['VERCEL_PROJECT_ADMIN_ID'],
        orgId: credentials['VERCEL_ORG_ID'],
        projectName: credentials['VERCEL_PROJECT_ADMIN'],
      }),
    );
    await stream('npx', [
      'vercel',
      'deploy',
      '--prod',
      '--yes',
      '--token',
      token,
      '--scope',
      scope,
    ]);
  } finally {
    await rm(link, { recursive: true, force: true });
  }
}

if (target === 'web' || target === 'all') await deployWeb();
if (target === 'admin' || target === 'all') await deployAdmin();

console.log('\nDone.\n');
