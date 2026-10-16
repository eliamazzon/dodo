// Zero-dependency ANSI UI kit shared by the installer (install.mjs) and the updater (update.mjs).
//
// Capability detection drives every visual: no color when piped / NO_COLOR, 16-color when the
// terminal is basic, truecolor (24-bit) gradients when it isn't. Kept dependency-free so the
// `curl | sh` bootstrap in install.sh stays light.

import { execFileSync, spawn } from 'node:child_process';
import { platform } from 'node:os';
import { createInterface } from 'node:readline';

export const OS = platform();

export const isTTY = !!process.stdout.isTTY;
export const useColor = isTTY && !('NO_COLOR' in process.env);
export const truecolor = useColor && /(truecolor|24bit)/i.test(process.env.COLORTERM || '');

const code = (seq) => (useColor ? seq : '');
export const C = {
  reset: code('\x1b[0m'), bold: code('\x1b[1m'), dim: code('\x1b[2m'),
  green: code('\x1b[32m'), yellow: code('\x1b[33m'), mag: code('\x1b[35m'), cyan: code('\x1b[36m'),
};

export const out = (s) => process.stdout.write(s);
export const say = (s = '') => out(s + '\n');
export const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

export const dim = (s) => `${C.dim}${s}${C.reset}`;
export const bold = (s) => `${C.bold}${s}${C.reset}`;
// Brand accent — DODO's violet (#a583da, the theme's dark-mode accent: legible on a
// terminal). Mirrors `accent` in src/shared/tokens.ts.
export const accent = (s) => (truecolor ? `\x1b[38;2;165;131;218m${s}${C.reset}` : `${C.mag}${s}${C.reset}`);
export const ok = `${C.green}✔${C.reset}`;
export const warn = `${C.yellow}!${C.reset}`;
export const step = (s) => say(`${accent('›')} ${s}`);

export const hideCursor = () => { if (isTTY) out('\x1b[?25l'); };
export const showCursor = () => { if (isTTY) out('\x1b[?25h'); };
export const moveUp = (n) => out(`\x1b[${n}A`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Restore the terminal no matter how we leave — a raw-mode TUI that exits without
// undoing setRawMode/hide-cursor leaves the user's shell broken. This is the safety net.
export function restoreTerm() {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch { /* ignore */ }
  if (isTTY) out('\x1b[?25h');
}

// Call once from each entry point, so importing this module doesn't install handlers as a side effect.
export function installTermHandlers() {
  process.on('exit', restoreTerm);
  process.on('SIGINT', () => { restoreTerm(); say(`\n${warn} cancelled.`); process.exit(130); });
}

export const flags = (argv = process.argv.slice(2)) => (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

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
export function gradient(text, phase = 0, stops = PALETTE) {
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
export function box(lines) {
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

export async function showBanner(tagline = 'the fast as f*ck browser agent') {
  const { word, mark } = bannerLines();
  const height = word.length;
  const draw = (phase, clear) => {
    for (let r = 0; r < height; r++) out(`${clear ? '\x1b[K' : ''}  ${bold(word[r])} ${gradient(mark[r], phase)}\n`);
  };

  say('');
  if (!useColor || !truecolor) { // static render — nothing to animate without colour
    draw(0, false);
    say(`  ${dim(tagline)}\n`);
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
  say(`  ${dim(tagline)}\n`);
}

// ── Animated spinner ──────────────────────────────────────────────────────────
export function spinner(label) {
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

export function ask(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); res(a.trim()); });
  });
}

export function copyToClipboard(text) {
  const cmds = OS === 'darwin'
    ? [['pbcopy', []]]
    : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [cmd, cargs] of cmds) {
    try { execFileSync(cmd, cargs, { input: text }); return true; } catch { /* try next */ }
  }
  return false;
}

/**
 * Run a command under the spinner, buffering its output and flushing it only on failure.
 * Streams straight through when there's no TTY to animate. Returns true on success.
 */
export async function runStep(label, cmd, args, { cwd, quiet = false } = {}) {
  if (!isTTY) {
    step(`${label}…`);
    try {
      execFileSync(cmd, args, { cwd, stdio: quiet ? 'ignore' : 'inherit' });
      return true;
    } catch { return false; }
  }

  const start = Date.now();
  const sp = spinner(label);
  const chunks = [];
  try {
    await new Promise((res, rej) => {
      const p = spawn(cmd, args, { cwd });
      p.stdout.on('data', (d) => chunks.push(d));
      p.stderr.on('data', (d) => chunks.push(d));
      p.on('error', rej);
      p.on('close', (c) => (c === 0 ? res() : rej(new Error(`exit ${c}`))));
    });
  } catch {
    sp.stop();
    out(Buffer.concat(chunks).toString()); // surface the real errors
    return false;
  }
  sp.stop();
  say(`${ok} ${bold(label)} ${dim(`in ${((Date.now() - start) / 1000).toFixed(1)}s`)}`);
  return true;
}

/** Build the extension. Exits the process on failure — both entry points treat it as fatal. */
export async function build(root) {
  if (!(await runStep('Building the extension', 'npm', ['run', 'build'], { cwd: root }))) {
    say(`${warn} build failed. Fix the errors above and re-run.`);
    process.exit(1);
  }
}
