#!/usr/bin/env node
/**
 * What this checkout weighs, and what it may throw away to weigh less.
 *
 * It exists because the repository quietly reached 5.9 GB in a working week.
 * The cause was one glob: turbo cached `.next/**` for the build task, and Next
 * writes the dev server's own scratch into `.next/dev`, so every cached build
 * carried a ~380 MB copy of it. That is fixed. This script is the part that
 * makes the *class* of problem visible instead of waiting for a disk to fill:
 * caches grow, and nothing here was ever measuring them.
 *
 * Two rules hold it together.
 *
 * **It only ever deletes what a command can rebuild.** `.turbo/cache`, `.next`,
 * `dist`, `tsconfig.tsbuildinfo`, Playwright's report. None of it is anybody's
 * data and none of it is tracked by git — the worst a prune costs is a slower
 * next build. It never touches the database, and never touches `node_modules`:
 * that is pnpm's to decide and it is shared with every other project on this
 * machine.
 *
 * **It reports before it removes.** With no arguments it measures and prints.
 * Only `--prune` deletes, and only what the report just showed.
 *
 *   pnpm disk                  measure and report
 *   pnpm disk:prune            remove regenerable caches over the threshold
 *   pnpm disk:prune --all      remove them regardless of size
 *   node scripts/disk.mjs --stale   drop only cache entries no build can hit
 *
 * The last of those is the one that runs on its own, before every build. It is
 * allowed to, because an entry whose input hash stopped existing two weeks ago
 * is not a cache: it is a file nobody will ever open again.
 */

import { rm, stat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Above this, a cache is worth reclaiming. Below it, deleting only buys a
 * slower next build for no meaningful space.
 */
const THRESHOLD_BYTES = 500 * 1024 * 1024;

/** Loud enough to act on well before a disk is actually in trouble. */
const WARN_TOTAL_BYTES = 3 * 1024 * 1024 * 1024;

/**
 * Everything this script is allowed to delete, and why each one is safe.
 *
 * An explicit list rather than a pattern walk, on purpose: a glob that decides
 * at runtime what counts as «excessive» is a glob that will eventually decide
 * a migration is excessive. Adding a path here is a deliberate act.
 */
const RECLAIMABLE = [
  { path: '.turbo/cache', why: 'turbo task cache — rebuilt by the next `pnpm build`' },
  { path: 'apps/web/.next', why: "Next's build and dev output for the product" },
  { path: 'apps/admin/.next', why: "Next's build and dev output for the console" },
  { path: 'apps/web/playwright-report', why: 'the last end-to-end run report' },
  { path: 'apps/web/test-results', why: 'end-to-end artefacts, traces and screenshots' },
];

/**
 * How long a turbo cache entry has to go untouched before it is dead weight.
 *
 * A cache entry is keyed by a hash of its inputs. Once those inputs change and
 * change again, the old entry can never be hit — it is not a cache any more,
 * it is a file nobody will open. Two weeks is comfortably past the point where
 * a branch would still be rebuilding the same hash, which is why this is the
 * one thing here that can be removed without anybody deciding to.
 */
const STALE_DAYS = 14;

/**
 * Turbo cache entries no build can hit any more.
 *
 * Returns the bytes removed. Unlike everything else in this file it deletes
 * without being asked, and it is allowed to precisely because there is nothing
 * to lose: an entry this old will never be read again.
 */
async function pruneStaleTurboEntries() {
  const cache = join(root, '.turbo/cache');
  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  let entries;
  try {
    entries = await readdir(cache, { withFileTypes: true });
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = join(cache, entry.name);
    try {
      const info = await stat(full);
      if (info.mtimeMs >= cutoff) continue;
      await rm(full, { force: true });
      removed += info.size;
    } catch {
      /* Removed by something else, or unreadable. Either way, not ours. */
    }
  }
  return removed;
}

/** Compiled output, discovered rather than listed: one set per workspace package. */
async function packageArtefacts() {
  const found = [];
  for (const group of ['packages', 'apps']) {
    let entries;
    try {
      entries = await readdir(join(root, group), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      for (const artefact of ['dist', 'tsconfig.tsbuildinfo', '.turbo']) {
        found.push({
          path: `${group}/${entry.name}/${artefact}`,
          why: `compiled output for ${entry.name} — rebuilt by \`pnpm build\``,
        });
      }
    }
  }
  return found;
}

async function sizeOf(absolute) {
  let entry;
  try {
    entry = await stat(absolute);
  } catch {
    return null;
  }
  if (!entry.isDirectory()) return entry.size;

  let total = 0;
  const pending = [absolute];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of entries) {
      const full = join(current, child.name);
      if (child.isDirectory()) {
        pending.push(full);
        continue;
      }
      try {
        // The apparent size rather than blocks on disk: it is the figure a
        // file manager shows, and being off by a block per file matters less
        // than reporting a number nobody can reconcile with what they see.
        total += (await stat(full)).size;
      } catch {
        /* Vanished mid-walk — a build running alongside this. Not an error. */
      }
    }
  }
  return total;
}

const readable = (bytes) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

const ESC = '[';
const bold = (text) => `${ESC}1m${text}${ESC}0m`;
const dim = (text) => `${ESC}2m${text}${ESC}0m`;
const green = (text) => `${ESC}32m${text}${ESC}0m`;
const yellow = (text) => `${ESC}33m${text}${ESC}0m`;

async function main() {
  const prune = process.argv.includes('--prune');
  const all = process.argv.includes('--all');
  const staleOnly = process.argv.includes('--stale');

  if (staleOnly) {
    const removed = await pruneStaleTurboEntries();
    if (removed > 0) {
      console.log(
        `${green('disk')} dropped ${bold(readable(removed))} of turbo cache older than ${STALE_DAYS} days`,
      );
    }
    return;
  }

  const targets = [...RECLAIMABLE, ...(await packageArtefacts())];
  const measured = [];
  for (const target of targets) {
    const bytes = await sizeOf(join(root, target.path));
    if (bytes !== null && bytes > 0) measured.push({ ...target, bytes });
  }
  measured.sort((a, b) => b.bytes - a.bytes);

  const total = measured.reduce((sum, one) => sum + one.bytes, 0);
  const chosen = all ? measured : measured.filter((one) => one.bytes >= THRESHOLD_BYTES);

  // A machine-readable answer for preflight, so that check reads a number
  // rather than scraping a report meant for a person.
  if (process.argv.includes('--json')) {
    console.log(
      JSON.stringify({
        totalBytes: total,
        readable: readable(total),
        overLimit: total >= WARN_TOTAL_BYTES,
      }),
    );
    if (total >= WARN_TOTAL_BYTES) process.exitCode = 1;
    return;
  }

  console.log(bold('\nRegenerable caches in this checkout\n'));

  if (measured.length === 0) {
    console.log(`  ${green('OK')} nothing to reclaim — this checkout is already clean\n`);
    return;
  }

  // Only what is worth a person's attention gets a line. Forty rows of
  // six-hundred-byte `.turbo` stubs is a data dump, not a report — and it
  // buries the two directories that actually hold the gigabytes.
  const NOTABLE_BYTES = 1024 * 1024;
  const notable = measured.filter((one) => one.bytes >= NOTABLE_BYTES);
  const rest = measured.filter((one) => one.bytes < NOTABLE_BYTES);

  for (const one of notable) {
    const mark = one.bytes >= THRESHOLD_BYTES ? yellow('!') : dim('·');
    console.log(`  ${mark} ${readable(one.bytes).padStart(8)}  ${one.path}`);
    console.log(`    ${dim(one.why)}`);
  }

  if (rest.length > 0) {
    const small = rest.reduce((sum, one) => sum + one.bytes, 0);
    console.log(
      `  ${dim('·')} ${readable(small).padStart(8)}  ${dim(`across ${rest.length} smaller build outputs`)}`,
    );
  }

  console.log(`\n  ${bold(readable(total).padStart(8))}  reclaimable in total`);

  if (!prune) {
    if (total >= WARN_TOTAL_BYTES) {
      console.log(
        `\n  ${yellow('!')} over ${readable(WARN_TOTAL_BYTES)} of rebuildable cache. ` +
          `Run ${bold('pnpm disk:prune')} to reclaim it.\n`,
      );
      // Nonzero so a hook or a CI step can notice, while a healthy checkout
      // stays quiet and green.
      process.exitCode = 1;
      return;
    }
    console.log(
      `\n  ${green('OK')} under ${readable(WARN_TOTAL_BYTES)}; nothing needs removing.\n`,
    );
    return;
  }

  if (chosen.length === 0) {
    console.log(
      `\n  ${green('OK')} nothing over ${readable(THRESHOLD_BYTES)}. ` +
        `Add ${bold('--all')} to clear the small ones too.\n`,
    );
    return;
  }

  let reclaimed = 0;
  for (const one of chosen) {
    await rm(join(root, one.path), { recursive: true, force: true });
    reclaimed += one.bytes;
    console.log(`  ${green('removed')} ${one.path}`);
  }
  console.log(`\n  ${green('OK')} reclaimed ${bold(readable(reclaimed))}\n`);
}

await main();
