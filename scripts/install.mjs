#!/usr/bin/env node
// DODO guided installer — builds the extension, then helps you load it into the
// Chromium browser + profile of your choice, with a fully interactive terminal UI.
//
// Loading an *unpacked* extension into an existing profile can't be done silently
// (Chrome/Brave block it for security), so this script automates everything up to
// the final click: it builds dist/, opens the right browser at the right profile on
// chrome://extensions, and copies the dist/ path to your clipboard. You then click
// "Load unpacked" and paste.
//
// The interface is hand-built with raw ANSI escapes + Node's readline keypress mode
// (zero dependencies, so the `curl | sh` bootstrap stays light). It degrades
// gracefully: truecolor → 16-color → no color, animated → static, arrow-key menus →
// numbered prompts, depending on the terminal.
//
// Run standalone with `npm run setup`, or via the curl|sh bootstrap in install.sh.
// Flags: --browser=<chrome|brave|edge|chromium|canary>  --profile=<dir>  --no-build

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface, emitKeypressEvents } from 'node:readline';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const HOME = homedir();
const OS = platform();

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

// ── Zero-dependency ANSI UI kit ───────────────────────────────────────────────
// Capability detection drives every visual: no color when piped / NO_COLOR, 16-color
// when the terminal is basic, truecolor (24-bit) gradients when it isn't.
const isTTY = !!process.stdout.isTTY;
const useColor = isTTY && !('NO_COLOR' in process.env);
const truecolor = useColor && /(truecolor|24bit)/i.test(process.env.COLORTERM || '');

const code = (seq) => (useColor ? seq : '');
const C = {
  reset: code('\x1b[0m'), bold: code('\x1b[1m'), dim: code('\x1b[2m'),
  green: code('\x1b[32m'), yellow: code('\x1b[33m'), mag: code('\x1b[35m'), cyan: code('\x1b[36m'),
};

const out = (s) => process.stdout.write(s);
const say = (s = '') => out(s + '\n');
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const dim = (s) => `${C.dim}${s}${C.reset}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;
// Brand accent — DODO's violet (#a583da, the theme's dark-mode accent: legible on a
// terminal). Mirrors `accent` in src/shared/tokens.ts.
const accent = (s) => (truecolor ? `\x1b[38;2;165;131;218m${s}${C.reset}` : `${C.mag}${s}${C.reset}`);
const ok = `${C.green}✔${C.reset}`;
const warn = `${C.yellow}!${C.reset}`;
const step = (s) => say(`${accent('›')} ${s}`);

const hideCursor = () => { if (isTTY) out('\x1b[?25l'); };
const showCursor = () => { if (isTTY) out('\x1b[?25h'); };
const moveUp = (n) => out(`\x1b[${n}A`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Restore the terminal no matter how we leave — a raw-mode TUI that exits without
// undoing setRawMode/hide-cursor leaves the user's shell broken. This is the safety net.
function restoreTerm() {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch { /* ignore */ }
  if (isTTY) out('\x1b[?25h');
}
process.on('exit', restoreTerm);
process.on('SIGINT', () => { restoreTerm(); say(`\n${warn} cancelled.`); process.exit(130); });

// Multi-stop gradient: interpolate a colour per character along the text. With a phase
// offset the band slides across, which powers the banner shimmer. Falls back to a flat
// magenta on 16-colour terminals and to plain text with no colour at all.
// DODO's purple theme (src/shared/tokens.ts): deep accent → violet → lavender highlight,
// then back toward violet so the sliding shimmer wraps without a seam.
//   #6b4ea3 accent · #a583da accent(dark) · #cdb6f0 accentInk(dark) lavender
const PALETTE = [[107, 78, 163], [165, 131, 218], [205, 182, 240], [165, 131, 218]];
function sampleStops(stops, t) {
  if (t <= 0) return stops[0];
  if (t >= 1) return stops[stops.length - 1];
  const seg = t * (stops.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const [r1, g1, b1] = stops[i];
  const [r2, g2, b2] = stops[i + 1];
  const lerp = (a, b) => Math.round(a + (b - a) * f);
  return [lerp(r1, r2), lerp(g1, g2), lerp(b1, b2)];
}
function gradient(text, phase = 0, stops = PALETTE) {
  if (!useColor) return text;
  if (!truecolor) return `${C.bold}${C.mag}${text}${C.reset}`;
  const chars = [...text];
  const n = Math.max(chars.length - 1, 1);
  let s = '';
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === ' ') { s += ' '; continue; }
    const [r, g, b] = sampleStops(stops, (i / n + phase) % 1);
    s += `\x1b[38;2;${r};${g};${b}m${chars[i]}`;
  }
  return s + C.reset;
}

// Rounded box around pre-styled lines (ANSI-aware width via strip()).
function box(lines) {
  const w = Math.max(...lines.map((l) => strip(l).length));
  say(accent(`╭${'─'.repeat(w + 2)}╮`));
  for (const l of lines) {
    const pad = ' '.repeat(w - strip(l).length);
    say(`${accent('│')} ${l}${pad} ${accent('│')}`);
  }
  say(accent(`╰${'─'.repeat(w + 2)}╯`));
}

// ── Animated logo banner ──────────────────────────────────────────────────────
function bannerLines() {
  const D = ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '];
  const O = [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '];
  const rows = [];
  for (let r = 0; r < 6; r++) rows.push([D[r], O[r], D[r], O[r]].join(' '));
  return rows;
}
async function showBanner() {
  const lines = bannerLines();
  const draw = (phase, clear) => { for (const l of lines) out(`${clear ? '\x1b[K' : ''}  ${gradient(l, phase)}\n`); };

  say('');
  if (!useColor || !truecolor) { // static render — nothing to animate without colour
    draw(0, false);
    say(`  ${dim('the open-source browser agent')}\n`);
    return;
  }
  hideCursor();
  draw(0, true);
  const frames = 14;
  for (let f = 1; f <= frames; f++) {
    moveUp(lines.length);
    draw(f / frames, true);
    await sleep(34);
  }
  showCursor();
  say(`  ${dim('the open-source browser agent')}\n`);
}

// ── Animated build spinner ────────────────────────────────────────────────────
function spinner(label) {
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const start = Date.now();
  let i = 0;
  hideCursor();
  const id = setInterval(() => {
    const el = ((Date.now() - start) / 1000).toFixed(1);
    out(`\r\x1b[K  ${accent(frames[i % frames.length])} ${label}… ${dim(el + 's')}`);
    i++;
  }, 80);
  return { stop() { clearInterval(id); out('\r\x1b[K'); showCursor(); } };
}

// ── Browser registry ────────────────────────────────────────────────────────
// dataDir → where profiles live (used to enumerate profiles + detect "installed").
// bins    → candidate executables to launch with --profile-directory.
function registry() {
  const app = (...p) => join('/Applications', ...p);
  const userApp = (...p) => join(HOME, 'Applications', ...p);
  const sup = (...p) => join(HOME, 'Library', 'Application Support', ...p);
  const cfg = (...p) => join(HOME, '.config', ...p);

  if (OS === 'darwin') {
    return [
      { key: 'chrome', name: 'Google Chrome', dataDir: sup('Google', 'Chrome'),
        bins: [app('Google Chrome.app/Contents/MacOS/Google Chrome'), userApp('Google Chrome.app/Contents/MacOS/Google Chrome')] },
      { key: 'brave', name: 'Brave', dataDir: sup('BraveSoftware', 'Brave-Browser'),
        bins: [app('Brave Browser.app/Contents/MacOS/Brave Browser'), userApp('Brave Browser.app/Contents/MacOS/Brave Browser')] },
      { key: 'edge', name: 'Microsoft Edge', dataDir: sup('Microsoft Edge'),
        bins: [app('Microsoft Edge.app/Contents/MacOS/Microsoft Edge')] },
      { key: 'chromium', name: 'Chromium', dataDir: sup('Chromium'),
        bins: [app('Chromium.app/Contents/MacOS/Chromium')] },
      { key: 'canary', name: 'Chrome Canary', dataDir: sup('Google', 'Chrome Canary'),
        bins: [app('Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary')] },
    ];
  }
  // linux + other unix
  return [
    { key: 'chrome', name: 'Google Chrome', dataDir: cfg('google-chrome'),
      bins: ['google-chrome', 'google-chrome-stable'] },
    { key: 'brave', name: 'Brave', dataDir: cfg('BraveSoftware', 'Brave-Browser'),
      bins: ['brave-browser', 'brave'] },
    { key: 'edge', name: 'Microsoft Edge', dataDir: cfg('microsoft-edge'),
      bins: ['microsoft-edge', 'microsoft-edge-stable'] },
    { key: 'chromium', name: 'Chromium', dataDir: cfg('chromium'),
      bins: ['chromium', 'chromium-browser'] },
  ];
}

// The real "is it installed?" signal is a working executable — a browser's data dir
// can linger as an empty folder after uninstall (or be created by an unrelated tool),
// so detecting on the dir alone surfaces phantom browsers. Resolve the binary instead.
function resolveBin(bins) {
  for (const b of bins) {
    if (b.includes('/')) { if (existsSync(b)) return b; continue; }
    try {
      const found = execFileSync('/bin/sh', ['-c', `command -v ${b}`], { encoding: 'utf8' }).trim();
      if (found) return found;
    } catch { /* not on PATH */ }
  }
  return null;
}

// Profiles live as subdirs of dataDir ("Default", "Profile 1"); Local State maps
// each dir to a human display name in profile.info_cache.
function profilesFor(dataDir) {
  let names = {};
  try {
    const ls = JSON.parse(readFileSync(join(dataDir, 'Local State'), 'utf8'));
    names = ls?.profile?.info_cache ?? {};
  } catch { /* fall back to dir scan */ }

  const dirs = new Set(Object.keys(names));
  try {
    for (const d of readdirSync(dataDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      if (d.name === 'Default' || /^Profile \d+$/.test(d.name)) dirs.add(d.name);
    }
  } catch { /* ignore */ }

  return [...dirs]
    .sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b)))
    .map((dir) => ({ dir, label: names[dir]?.name || dir }));
}

// ── Selection: arrow-key menu (TTY) with numbered-prompt fallback ─────────────
function ask(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); res(a.trim()); });
  });
}

async function numberedMenu(label, items, render) {
  say(`\n  ${bold(`Pick a ${label}:`)}`);
  items.forEach((it, i) => say(`    ${accent(String(i + 1))}) ${render(it)}`));
  while (true) {
    const a = await ask(`  ${label} [1-${items.length}, default 1]: `);
    if (a === '') return items[0];
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1];
    say(`  ${warn} enter a number 1-${items.length}`);
  }
}

function arrowMenu(label, items, render) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    try { stdin.setRawMode(true); } catch { reject(new Error('noraw')); return; }
    emitKeypressEvents(stdin);
    stdin.resume();
    hideCursor();

    let idx = 0;
    say(`  ${bold(`Pick a ${label}`)} ${dim('· ↑/↓ move · enter select · esc cancel')}`);
    const draw = (first) => {
      if (!first) moveUp(items.length);
      items.forEach((it, i) => {
        const focused = i === idx;
        const caret = focused ? accent('❯') : ' ';
        const text = focused ? bold(render(it)) : dim(render(it));
        out(`\x1b[K  ${caret} ${text}\n`);
      });
    };
    draw(true);

    const cleanup = () => {
      stdin.removeListener('keypress', onKey);
      try { if (stdin.isTTY) stdin.setRawMode(false); } catch { /* ignore */ }
      stdin.pause();
      showCursor();
    };
    const onKey = (_str, key) => {
      if (!key) return;
      if (key.name === 'up' || key.name === 'k') { idx = (idx - 1 + items.length) % items.length; draw(false); }
      else if (key.name === 'down' || key.name === 'j') { idx = (idx + 1) % items.length; draw(false); }
      else if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(items[idx]); }
      else if ((key.ctrl && key.name === 'c') || key.name === 'escape' || key.name === 'q') {
        cleanup(); say(`\n${warn} cancelled.`); process.exit(130);
      }
    };
    stdin.on('keypress', onKey);
  });
}

async function select(label, items, render, preselect) {
  if (preselect != null) {
    const i = items.findIndex(preselect);
    if (i >= 0) return items[i];
    say(`${warn} requested ${label} not found; falling back to a prompt.`);
  }
  if (items.length === 1) { say(dim(`  using the only ${label}: ${strip(render(items[0]))}`)); return items[0]; }
  if (!process.stdin.isTTY) { say(dim(`  non-interactive; using first ${label}: ${strip(render(items[0]))}`)); return items[0]; }
  try { return await arrowMenu(label, items, render); }
  catch { return numberedMenu(label, items, render); } // terminal without raw-mode support
}

function copyToClipboard(text) {
  const cmds = OS === 'darwin'
    ? [['pbcopy', []]]
    : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [cmd, cargs] of cmds) {
    try { execFileSync(cmd, cargs, { input: text }); return true; } catch { /* try next */ }
  }
  return false;
}

// Chromium silently ignores a chrome:// URL passed on the command line when an instance
// is already running (a deliberate guard against programs forcing internal pages). So we
// can auto-open chrome://extensions only on a cold start; if the browser is already up we
// switch to telling the user how to reach it.
function isRunning(bin) {
  try { execFileSync('pgrep', ['-f', bin], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ── Build (animated spinner with elapsed timer; raw output flushed on failure) ─
async function build() {
  if (flag('no-build')) {
    if (!existsSync(join(DIST, 'manifest.json'))) {
      say(`${warn} --no-build set but dist/ is empty. Run \`npm run build\` first.`);
      process.exit(1);
    }
    step('skipping build (--no-build)');
    return;
  }
  if (!isTTY) { // stream output straight through when there's nothing to animate
    step('building the extension (npm run build)…');
    try { execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' }); }
    catch { say(`${warn} build failed. Fix the errors above and re-run.`); process.exit(1); }
    return;
  }

  const start = Date.now();
  const sp = spinner('Building the extension');
  const chunks = [];
  try {
    await new Promise((res, rej) => {
      const p = spawn('npm', ['run', 'build'], { cwd: ROOT });
      p.stdout.on('data', (d) => chunks.push(d));
      p.stderr.on('data', (d) => chunks.push(d));
      p.on('error', rej);
      p.on('close', (c) => (c === 0 ? res() : rej(new Error(`exit ${c}`))));
    });
  } catch {
    sp.stop();
    out(Buffer.concat(chunks).toString()); // surface the real build errors
    say(`${warn} build failed. Fix the errors above and re-run.`);
    process.exit(1);
  }
  sp.stop();
  say(`${ok} ${bold('Built')} ${dim(`in ${((Date.now() - start) / 1000).toFixed(1)}s`)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  await showBanner();
  await build();

  // Installed = its executable resolves. The data dir is only used afterwards to list
  // profiles (it may not exist yet if the browser has never been launched).
  const installed = registry()
    .map((b) => ({ ...b, bin: resolveBin(b.bins) }))
    .filter((b) => b.bin);
  if (installed.length === 0) {
    say(`\n${warn} No Chrome/Brave/Edge/Chromium install found.`);
    say(`  Open chrome://extensions, enable Developer mode, click "Load unpacked", and choose:`);
    say(`  ${bold(DIST)}\n`);
    process.exit(0);
  }

  const browser = await select('browser', installed, (b) => `${accent('●')} ${b.name}`, flag('browser') ? (b) => b.key === flag('browser') : undefined);
  const profiles = profilesFor(browser.dataDir);
  const profile = profiles.length
    ? await select('profile', profiles, (p) => (p.label === p.dir ? p.dir : `${p.label} ${dim(`(${p.dir})`)}`), flag('profile') ? (p) => p.dir === flag('profile') : undefined)
    : { dir: 'Default', label: 'Default' };

  const wasRunning = isRunning(browser.bin);
  const interactive = process.stdin.isTTY;

  // Two-phase clipboard handoff — there's only one clipboard and two things to paste, so
  // we stage them just-in-time. First the address (chrome://extensions) for the address bar;
  // copying the dist/ path now would clobber it before the user pastes it.
  const copiedUrl = copyToClipboard('chrome://extensions');

  // Show the instructions FIRST so the user knows what to do, then open the browser on
  // their go — otherwise the window pops up before they've read the steps.
  const card = [`${C.green}${bold('Here\'s what to do next')}`, ''];
  if (wasRunning) {
    // A running browser ignores a chrome:// URL on the command line, so we don't pass one —
    // it'd just be dropped. The user navigates there themselves by pasting the address.
    card.push(`${accent('1.')} In ${bold(browser.name)}, paste ${bold('chrome://extensions')} into the`);
    card.push(`   address bar${copiedUrl ? ` ${dim('(already on your clipboard)')}` : ''} and press ${bold('Enter')}, then turn on`);
    card.push(`   ${bold('Developer mode')} (top-right).`);
  } else {
    card.push(`${accent('1.')} The ${bold('Extensions')} page will open —`);
    card.push(`   turn on ${bold('Developer mode')} (top-right).`);
  }
  card.push(`${accent('2.')} Click ${bold('Load unpacked')}.`);
  card.push(`${accent('3.')} Paste this folder path and choose it:`);
  card.push(`   ${accent(DIST)}`);

  say('');
  box(card);
  say('');

  // Wait for the user's go-ahead before launching (skip the prompt when non-interactive).
  const target = `${bold(browser.name)} ${dim('·')} profile ${bold(profile.label)}`;
  if (interactive) await ask(`  ${accent('▸')} Press ${bold('Enter')} to open ${target} `);

  step(`opening ${bold(browser.name)} · profile ${bold(profile.label)}`);
  try {
    const url = wasRunning ? [] : ['chrome://extensions/'];
    spawn(browser.bin, [`--profile-directory=${profile.dir}`, ...url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    say(`${warn} couldn't launch ${browser.name} automatically — open it yourself.`);
  }

  // Phase two: once they're heading for the "Load unpacked" file dialog, swap the folder
  // path onto the clipboard. Gated on a keypress so we don't overwrite chrome://extensions
  // before they've pasted it.
  if (interactive) await ask(`\n  ${accent('▸')} On the Extensions page? Press ${bold('Enter')} to copy the folder path `);
  const copiedPath = copyToClipboard(DIST);
  if (copiedPath) say(`${ok} Folder path copied — paste it into ${bold('Load unpacked')} ${dim('(⌘⇧G on macOS, then paste)')}.`);

  say('');
  say(dim('  Onboarding opens automatically — paste your Gemini API key'));
  say(dim('  (aistudio.google.com/apikey). Open DODO any time with Alt+L.'));
  say('');
})().catch((e) => { restoreTerm(); say(`\n${warn} installer error: ${e?.message || e}`); process.exit(1); });
