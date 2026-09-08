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
 *   pnpm deploy:all        preflight, then both applications
 *   pnpm deploy:admin      the console only
 *   pnpm deploy:web        the product only
 *   pnpm deploy:all --skip-preflight
 *
 * Named `deploy:all` rather than `deploy` because pnpm has a built-in command
 * by that name: `pnpm deploy admin` is pnpm's, not this one's, and it rejects
 * the argument instead of passing it through.
 *
 * The product is linked to GitHub, so its production deploy is a push through
 * the Pime Git funnel and not a CLI upload — using the CLI there would produce
 * a deployment with no commit behind it, which is the kind of thing nobody can
 * explain a week later. The console has no GitHub link, so it uploads.
 */

import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
 * The console: an upload, to the project named on the command line.
 *
 * `--project` rather than a `.vercel/project.json` link file, and the ambient
 * `VERCEL_*` variables stripped from the child's environment, because both of
 * those can silently redirect a deploy and one of them already did: this
 * script's first run uploaded the *product* to production while reporting that
 * it was deploying the console. The link file was written correctly and lost
 * to `VERCEL_PROJECT_ID`, which the editor exports into every command from the
 * same settings file the token lives in.
 *
 * A deploy should be decided by its arguments and nothing else. Anything the
 * environment can override is something that will eventually override it.
 */
async function deployAdmin() {
  const project = credentials['VERCEL_PROJECT_ADMIN'];
  console.log(`\n→ Console — uploading ${String(project)} to Vercel\n`);
  await stream(
    'npx',
    [
      'vercel',
      'deploy',
      '--prod',
      '--yes',
      '--project',
      project,
      '--token',
      token,
      '--scope',
      scope,
    ],
    { env: cleanEnvironment() },
  );
}

/**
 * The environment, minus anything Vercel's CLI reads as a project link.
 *
 * `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` outrank the arguments, so they are
 * removed rather than trusted.
 */
function cleanEnvironment() {
  const environment = { ...process.env };
  for (const key of ['VERCEL_PROJECT_ID', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_NAME']) {
    delete environment[key];
  }
  return environment;
}

if (target === 'web' || target === 'all') await deployWeb();
if (target === 'admin' || target === 'all') await deployAdmin();

console.log('\nDone.\n');
