#!/usr/bin/env node
// DODO guided installer — builds the extension, then walks you through loading it
// as an unpacked extension, with a fully interactive terminal UI.
//
// Loading an *unpacked* extension can't be done silently (Chrome/Brave block it for
// security), so this script automates everything up to the final click: it builds
// dist/, copies chrome://extensions and the dist/ path to your clipboard in turn so
// you can paste each where it's needed. You then click "Load unpacked" and paste.
//
// The terminal UI lives in scripts/lib/term.mjs (shared with the updater). It degrades
// gracefully: truecolor → 16-color → no color, animated → static, depending on the terminal.
//
// Run standalone with `npm run setup`, or via the curl|sh bootstrap in install.sh.
// Flags: --no-build

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OS, C, say, dim, bold, accent, ok, warn, step,
  restoreTerm, installTermHandlers, flags, box, showBanner,
  ask, copyToClipboard, build,
} from './lib/term.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const flag = flags();
installTermHandlers();

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  await showBanner();

  if (flag('no-build')) {
    if (!existsSync(join(DIST, 'manifest.json'))) {
      say(`${warn} --no-build set but dist/ is empty. Run \`npm run build\` first.`);
      process.exit(1);
    }
    step('skipping build (--no-build)');
  } else {
    await build(ROOT);
  }

  const interactive = process.stdin.isTTY;

  // Whether a chrome:// URL on the command line is honored depends on whether the browser
  // was already running, its single-instance settings, etc. — too unreliable to build a
  // launch sequence around, so we don't try: print the link and let the user paste it.
  const copiedUrl = copyToClipboard('chrome://extensions');

  const card = [`${C.green}${bold('Here\'s what to do next')}`, ''];
  card.push(`${accent('1.')} Open your Chromium-based browser (Chrome, Brave, Edge…) and paste`);
  card.push(`   ${bold('chrome://extensions')}${copiedUrl ? ` ${dim('(already on your clipboard)')}` : ''} into the address bar`);
  card.push(`   and press ${bold('Enter')}, then turn on ${bold('Developer mode')} (top-right).`);
  card.push(`${accent('2.')} Click ${bold('Load unpacked')}.`);
  card.push(`${accent('3.')} Paste this folder path and choose it:`);
  card.push(`   ${accent(DIST)}`);

  say('');
  box(card);
  say('');

  // Phase two: once they're heading for the "Load unpacked" file dialog, swap the folder
  // path onto the clipboard. Gated on a keypress so we don't overwrite chrome://extensions
  // before they've pasted it.
  if (interactive) await ask(`  ${accent('▸')} Pasted the address? Press ${bold('Enter')} to copy the folder path `);
  const copiedPath = copyToClipboard(DIST);
  if (copiedPath) say(`${ok} Folder path copied — paste it into ${bold('Load unpacked')} ${dim('(⌘⇧G on macOS, then paste)')}.`);

  say('');
  say(dim('  Onboarding opens automatically — paste your Gemini API key'));
  say(dim(`  (aistudio.google.com/apikey). Open DODO any time with ${OS === 'darwin' ? 'Opt+L' : 'Alt+L'}.`));
  say(dim('  DODO checks GitHub for updates and tells you in the panel when there are any.'));
  say('');
})().catch((e) => { restoreTerm(); say(`\n${warn} installer error: ${e?.message || e}`); process.exit(1); });
