#!/usr/bin/env node
// DODO guided installer — builds the extension, then walks you through loading it
// as an unpacked extension, with a fully interactive terminal UI.
//
// Loading an *unpacked* extension can't be done silently (Chrome/Brave block it for
// security), so this script automates everything up to the final click: it builds
// dist/, copies chrome://extensions and the dist/ path to your clipboard in turn so
// you can paste each where it's needed. You then click "Load unpacked" and paste.
//
// The interface is hand-built with raw ANSI escapes (zero dependencies, so the
// `curl | sh` bootstrap stays light). It degrades gracefully: truecolor → 16-color →
// no color, animated → static, depending on the terminal.
//
// Run standalone with `npm run setup`, or via the curl|sh bootstrap in install.sh.
// Flags: --no-build

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
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
// Mirrors the "dodo://" wordmark: lowercase d/o glyphs (the d's stem gives it an
// ascender, the o's stay x-height) in the terminal's default foreground, plus a
// ":// " mark that gets the purple shimmer — split into two row-sets so the word
// and the mark can be colored independently.
function bannerLines() {
  const D = ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '];
  const oBody = [' ██████╗ ', '██║   ██║', '██║   ██║', '╚██████╔╝'];
  const oBlank = ' '.repeat(oBody[0].length);
  const O = [oBlank, oBlank, ...oBody]; // pad to x-height, baseline-aligned with D

  const colonBlank = '  ';
  const COLON = [colonBlank, colonBlank, colonBlank, '██', '██', colonBlank];

  // A slash as a 2-wide diagonal staircase, bottom-left to top-right, full cap height.
  const slashRow = (r) => ' '.repeat(5 - r) + '██' + ' '.repeat(r);
  const SLASH = [0, 1, 2, 3, 4, 5].map(slashRow);

  const word = [], mark = [];
  for (let r = 0; r < 6; r++) {
    word.push([D[r], O[r], D[r], O[r]].join(' '));
    mark.push([COLON[r], SLASH[r], SLASH[r]].join(' '));
  }
  return { word, mark };
}
async function showBanner() {
  const { word, mark } = bannerLines();
  const height = word.length;
  const draw = (phase, clear) => {
    for (let r = 0; r < height; r++) out(`${clear ? '\x1b[K' : ''}  ${bold(word[r])} ${gradient(mark[r], phase)}\n`);
  };

  say('');
  if (!useColor || !truecolor) { // static render — nothing to animate without colour
    draw(0, false);
    say(`  ${dim('the fast as f*ck browser agent')}\n`);
    return;
  }
  hideCursor();
  draw(0, true);
  const frames = 14;
  for (let f = 1; f <= frames; f++) {
    moveUp(height);
    draw(f / frames, true);
    await sleep(34);
  }
  showCursor();
  say(`  ${dim('the fast as f*ck browser agent')}\n`);
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

function ask(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); res(a.trim()); });
  });
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
  say('');
})().catch((e) => { restoreTerm(); say(`\n${warn} installer error: ${e?.message || e}`); process.exit(1); });
