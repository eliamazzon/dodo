#!/usr/bin/env node
// DODO updater — pulls the latest commits and rebuilds dist/ in place.
//
// This is the other half of the in-panel "update available" banner: the extension can spot
// that origin has moved, but MV3 gives it no way to run git or npm, so it hands you this
// command and you run it. Afterwards, click "reload DODO" in the side panel (or Reload on
// chrome://extensions) — Chrome re-reads dist/ from disk and the banner clears itself.
//
// Run with `npm run update`. Flags: --no-build

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  say, dim, bold, accent, ok, warn, step,
  restoreTerm, installTermHandlers, flags, box, showBanner, runStep, build,
} from './lib/term.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const flag = flags();
installTermHandlers();

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

function fail(msg, hint) {
  say('');
  say(`${warn} ${msg}`);
  if (hint) say(dim(`  ${hint}`));
  say('');
  process.exit(1);
}

(async () => {
  await showBanner('updating your local checkout');

  if (!existsSync(join(ROOT, '.git'))) {
    fail(
      'this checkout has no .git directory, so there\'s nothing to pull.',
      'Reinstall with: curl -fsSL https://raw.githubusercontent.com/eliamazzon/dodo/main/install.sh | sh',
    );
  }

  // Check for local modifications up front. `git pull --ff-only` would fail on its own here,
  // but with a message about overwriting files that doesn't say what to do about it.
  let dirty = '';
  try {
    dirty = git(['status', '--porcelain', '--untracked-files=no']);
  } catch (e) {
    fail(`couldn't read git status: ${e?.message || e}`);
  }
  if (dirty) {
    const files = dirty.split('\n').slice(0, 5).map((l) => `    ${l.trim()}`).join('\n');
    const more = dirty.split('\n').length > 5 ? `\n    …and ${dirty.split('\n').length - 5} more` : '';
    fail(
      'you have local changes, so the update would overwrite your work.',
      `Commit or stash them first, then re-run \`npm run update\`.\n${files}${more}`,
    );
  }

  const before = git(['rev-parse', 'HEAD']);
  const lockBefore = readLock();

  if (!(await runStep('Pulling the latest changes', 'git', ['pull', '--ff-only'], { cwd: ROOT }))) {
    fail(
      'couldn\'t fast-forward — your branch has diverged from origin.',
      'Sort it out with `git status` / `git log --oneline origin/main..HEAD`, then re-run.',
    );
  }

  const after = git(['rev-parse', 'HEAD']);
  if (before === after) {
    say('');
    say(`${ok} ${bold('Already up to date')} ${dim(`(${after.slice(0, 7)})`)}`);
    say('');
    return;
  }

  // Only reinstall when the lockfile actually moved — the common case is a code-only change,
  // and skipping npm install there takes the update from ~30s to a couple of seconds.
  if (readLock() !== lockBefore) {
    step('dependencies changed since your last update');
    if (!(await runStep('Installing dependencies', 'npm', ['install'], { cwd: ROOT }))) {
      fail('npm install failed. See the output above.');
    }
  }

  if (flag('no-build')) {
    step('skipping build (--no-build)');
  } else {
    await build(ROOT);
  }

  const subjects = git(['log', '--oneline', '--no-decorate', `${before}..${after}`])
    .split('\n')
    .filter(Boolean);

  say('');
  const card = [`${bold('Updated')} ${dim(`${before.slice(0, 7)} → ${after.slice(0, 7)}`)}`, ''];
  for (const s of subjects.slice(0, 8)) card.push(`  ${accent('·')} ${s}`);
  if (subjects.length > 8) card.push(`  ${dim(`…and ${subjects.length - 8} more`)}`);
  card.push('');
  card.push(`${accent('▸')} Click ${bold('reload DODO')} in the side panel to pick this up`);
  card.push(`  ${dim('(or hit Reload on chrome://extensions)')}`);
  box(card);
  say('');
})().catch((e) => { restoreTerm(); say(`\n${warn} updater error: ${e?.message || e}`); process.exit(1); });

// Hash-free staleness check: the lockfile's own content is the comparison key.
function readLock() {
  const p = join(ROOT, 'package-lock.json');
  if (!existsSync(p)) return null;
  try {
    return execFileSync('git', ['hash-object', p], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
