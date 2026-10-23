#!/usr/bin/env node
// Raw CDP transport; only extension workers are attached, never website targets.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVALS = join(ROOT, 'evals');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const cached = async (name) => (await readFile(join(EVALS, name), 'utf8').catch(() => '')).trim();

export class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.method === 'Target.detachedFromTarget') {
        this.rejectPending(new Error('service worker detached'), msg.params.sessionId);
      }
      if (!msg.id) return;
      const call = this.pending.get(msg.id);
      if (!call) return;
      clearTimeout(call.timer);
      this.pending.delete(msg.id);
      if (msg.error) call.reject(new Error(msg.error.message));
      else call.resolve(msg.result);
    });
    socket.addEventListener('close', () => this.rejectPending(new Error('CDP connection closed')));
    socket.addEventListener('error', () => this.rejectPending(new Error('CDP connection failed')));
  }
  rejectPending(error, sessionId) {
    for (const [id, call] of this.pending) {
      if (sessionId && call.sessionId !== sessionId) continue;
      clearTimeout(call.timer);
      this.pending.delete(id);
      call.reject(error);
    }
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    const cdp = new CDP(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connect timeout')); }, 10_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Cannot connect to Brave CDP')); }, { once: true });
    });
    return cdp;
  }
  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, sessionId });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(sessionId, expression, timeoutMs = 30_000) {
    const response = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, sessionId, timeoutMs);
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    return response.result?.value;
  }
  close() { this.rejectPending(new Error('CDP connection closed')); this.socket.close(); }
}

export function pickInstance(workers, requested, remembered) {
  if (!workers.length) throw new Error('No eval worker responded. Load dist-eval/ in Brave (not dist/), then finish onboarding.');
  const listing = workers.map((w) => `${w.instanceId}  context=${w.browserContextId ?? '(default)'}  ${w.url}`).join('\n');
  if (requested) {
    const matches = workers.filter((w) => w.instanceId === requested);
    if (matches.length !== 1) throw new Error(`Instance ${requested} is not uniquely available:\n${listing}`);
    return matches[0];
  }
  if (workers.length > 1) throw new Error(`Multiple eval profiles responded. Choose --instance <id>:\n${listing}`);
  if (remembered && workers[0].instanceId !== remembered) {
    throw new Error(`Eval profile changed (expected ${remembered}). Choose --instance <id> to select it:\n${listing}`);
  }
  return workers[0];
}

async function discover(cdp, { requested, remembered, wake = true } = {}) {
  const workers = [];
  const { targetInfos } = await cdp.send('Target.getTargets');
  for (const target of targetInfos) {
    if (target.type !== 'service_worker' || !target.url.endsWith('/background/service-worker.js')) continue;
    let sessionId;
    try {
      ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
      const ping = await cdp.evaluate(sessionId, 'typeof dodoEval !== "undefined" && dodoEval.ping()');
      if (ping?.instanceId) workers.push({ ...target, ...ping, sessionId });
      else await cdp.send('Target.detachFromTarget', { sessionId });
    } catch {
      if (sessionId) await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
  }
  // Wake a sleeping eval worker even when another profile already has a live worker.
  // Wake only once per discovery; retrying creates no website attachments.
  if (wake) {
    const extensionIds = new Set(workers.map((w) => new URL(w.url).host));
    const knownId = process.env.DODO_EXT_ID || await cached('.ext-id');
    if (knownId) extensionIds.add(knownId);
    if (extensionIds.size) {
      for (const w of workers) await cdp.send('Target.detachFromTarget', { sessionId: w.sessionId }).catch(() => {});
      for (const extensionId of extensionIds) {
        if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('DODO_EXT_ID must be a 32-letter extension id.');
        const contexts = [undefined, ...new Set(targetInfos.map((t) => t.browserContextId).filter(Boolean))];
        for (const browserContextId of contexts) {
          let targetId;
          try {
            ({ targetId } = await cdp.send('Target.createTarget', {
              url: `chrome-extension://${extensionId}/src/onboarding/index.html`,
              ...(browserContextId ? { browserContextId } : {}),
            }));
            await pause(500);
          } finally {
            if (targetId) await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
          }
        }
      }
      return discover(cdp, { requested, remembered, wake: false });
    }
  }
  let chosen;
  try { chosen = pickInstance(workers, requested, remembered); }
  finally {
    for (const w of workers) {
      if (w !== chosen) await cdp.send('Target.detachFromTarget', { sessionId: w.sessionId }).catch(() => {});
    }
  }
  return chosen;
}

async function version(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`Debugging endpoint returned HTTP ${response.status}`);
  const data = await response.json();
  if (!data.webSocketDebuggerUrl) throw new Error('No browser websocket at the debugging endpoint');
  return data;
}

async function portOccupied(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
  });
}

async function launch(port) {
  const profile = resolve(process.env.DODO_EVAL_PROFILE || join(homedir(), '.dodo-eval-profile'));
  const binary = process.env.DODO_BRAVE_BINARY || (platform() === 'darwin'
    ? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    : platform() === 'win32'
      ? join(process.env.PROGRAMFILES || 'C:\\Program Files', 'BraveSoftware/Brave-Browser/Application/brave.exe')
      : '/usr/bin/brave-browser');
  if (!existsSync(binary)) throw new Error(`Brave not found at ${binary}. Set DODO_BRAVE_BINARY to its executable.`);
  console.log(`Opening Brave eval profile: ${profile}`);
  const child = spawn(binary, [
    `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    'brave://extensions/',
  ], { detached: true, stdio: 'ignore' });
  let launchError;
  child.on('error', (error) => { launchError = error; });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (launchError) throw launchError;
    const info = await version(port).catch(() => null);
    if (info) return info;
    await pause(500);
  }
  throw new Error('Brave did not expose its debugging port. Close this eval profile and retry.');
}

function matches(pattern, text) {
  const regex = pattern instanceof RegExp ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')) : new RegExp(pattern, 'i');
  return regex.test(text ?? '');
}

export function needsLogin(task, result) {
  if (!task.requiresLogin) return false;
  const url = result.finalUrl ?? '';
  // No screenshot heuristics: only explicit URL or agent-reported login evidence.
  return /\/(?:login|signin|sign-in|authwall|checkpoint)(?:[/?#]|$)/i.test(url)
    || /(?:please|must|need to|required to)\s+(?:log in|sign in)|(?:login|sign-in)\s+(?:required|wall)/i.test(result.answer ?? '');
}

export async function grade(task, result, judge) {
  const checks = [];
  const add = (name, pass, reason = name) => checks.push({ name, pass: Boolean(pass), reason });
  add('completed', result.status === 'complete', result.errorMsg || `status: ${result.status}`);
  add('allowed hosts', !(result.deniedHosts?.length), `denied hosts: ${(result.deniedHosts ?? []).join(', ')}`);
  const expect = task.expect ?? {};
  if (expect.answerMatches) add('answerMatches', matches(expect.answerMatches, result.answer), 'answer did not match expected content');
  if (expect.finalUrlMatches) add('finalUrlMatches', matches(expect.finalUrlMatches, result.finalUrl), 'unexpected final URL');
  if (expect.reachedCritical !== undefined) add('reachedCritical', Boolean(result.criticals?.length) === expect.reachedCritical, 'critical action expectation not met');
  if (expect.maxTurns !== undefined) add('maxTurns', Number.isFinite(result.metrics?.turns) && result.metrics.turns <= expect.maxTurns, 'turn budget exceeded or missing');
  if (task.check) {
    try { add('custom', await task.check(result), 'custom check failed'); }
    catch (e) { add('custom', false, `custom check: ${e.message}`); }
  }
  let judgment;
  if (task.rubric && judge && checks.every((c) => c.pass)) {
    try {
      judgment = await judge({ rubric: task.rubric, prompt: task.prompt, answer: result.answer, finalUrl: result.finalUrl, criticals: result.criticals });
      if (typeof judgment?.pass !== 'boolean' || !Number.isFinite(judgment.score) || judgment.score < 0 || judgment.score > 1) throw new Error('invalid judge response');
      add('judge', judgment.pass, judgment.reason);
    } catch (e) { add('judge', false, `judge error: ${e.message}`); }
  }
  const status = needsLogin(task, result) ? 'needs_login' : checks.every((c) => c.pass) ? 'pass' : 'fail';
  return { status, pass: status === 'pass', checks, ...(judgment ? { judge: judgment } : {}) };
}

export function summarize(tasks, runs) {
  return tasks.map((task) => {
    const results = runs.filter((r) => r.taskId === task.id);
    const measured = (key) => results.map((r) => r.metrics?.[key]).filter(Number.isFinite);
    const average = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const reasons = {};
    for (const r of results) {
      const failures = r.grade.status === 'needs_login' ? [`needs login: ${task.requiresLogin}`]
        : r.grade.checks.filter((c) => !c.pass).map((c) => c.reason);
      for (const reason of failures) reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    const passes = results.filter((r) => r.grade.pass).length;
    return {
      id: task.id, runs: results.length, passes, passRate: results.length ? passes / results.length : 0,
      needsLogin: results.filter((r) => r.grade.status === 'needs_login').length,
      avgTurns: average(measured('turns')),
      avgTokens: average(results.filter((r) => Number.isFinite(r.metrics?.tokensIn) && Number.isFinite(r.metrics?.tokensOut)).map((r) => r.metrics.tokensIn + r.metrics.tokensOut)),
      avgMs: average(measured('wallMs')),
      failures: Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
    };
  });
}

function markdown(rows, metadata) {
  const fmt = (n) => n == null ? '—' : n.toFixed(1);
  return [
    '# DODO eval results', '', `Instance: ${metadata.instanceId} · Commit: ${metadata.gitsha} · Judge: ${metadata.judge ? 'on' : 'off'}`, '',
    '| Task | Pass rate | Needs login | Avg turns | Avg tokens | Avg seconds |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((r) => `| ${r.id} | ${r.passes}/${r.runs} (${(r.passRate * 100).toFixed(0)}%) | ${r.needsLogin} | ${fmt(r.avgTurns)} | ${fmt(r.avgTokens)} | ${fmt(r.avgMs == null ? null : r.avgMs / 1000)} |`), '',
    ...rows.flatMap((r) => r.failures.length ? [`## ${r.id}`, '', ...r.failures.slice(0, 5).map((f) => `- ${f.count}× ${f.reason.replace(/\n/g, ' ')}`), ''] : []),
    ...(rows.some((r) => r.needsLogin) ? ['Log into the affected sites again with `npm run eval:browser`.', ''] : []),
  ].join('\n');
}

export function options(args) {
  const { values } = parseArgs({ args, options: {
    only: { type: 'string' }, runs: { type: 'string', default: '3' }, port: { type: 'string', default: '9222' },
    instance: { type: 'string' }, 'no-judge': { type: 'boolean' }, launch: { type: 'boolean' },
    browser: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  const runs = Number(values.runs), port = Number(values.port);
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('--port must be between 1 and 65535');
  return { ...values, runs, port };
}

export async function main(args = process.argv.slice(2)) {
  const opts = options(args);
  if (opts.help) {
    console.log('DODO Brave evals (Node 22+ with global WebSocket)\n\n  npm run build:eval\n  npm run eval:browser     Open persistent Brave profile; runs no tasks\n  npm run eval -- [--launch] [--only id,...] [--runs 3] [--port 9222]\n                 [--instance UUID] [--no-judge]\n\nEnvironment: DODO_BRAVE_BINARY, DODO_EVAL_PROFILE, DODO_EXT_ID');
    return;
  }
  // Validate task selection before opening or attaching to a browser.
  const { tasks: allTasks } = await import('../evals/tasks.mjs');
  const selected = opts.only ? opts.only.split(',') : allTasks.map((t) => t.id);
  const tasks = allTasks.filter((t) => selected.includes(t.id));
  const unknown = selected.filter((id) => !allTasks.some((t) => t.id === id));
  if (unknown.length || !tasks.length) throw new Error(`Unknown task(s): ${unknown.join(', ') || '(empty selection)'}`);
  await mkdir(EVALS, { recursive: true });
  const remembered = await cached('.instance');
  let info = await version(opts.port).catch(() => null);
  let launched = false;
  if (!info) {
    if (!(opts.launch || opts.browser)) throw new Error('No Brave debugging endpoint. Run npm run eval:browser first (or use --launch).');
    if (await portOccupied(opts.port)) throw new Error(`Port ${opts.port} is occupied by another service; refusing to launch Brave.`);
    info = await launch(opts.port);
    launched = true;
  }
  if (opts.browser && launched) {
    console.log(`Load unpacked: ${join(ROOT, 'dist-eval')}\nOpen brave://extensions, finish DODO onboarding, and log into task sites.\nThis Brave profile persists across restarts. No tasks were run.`);
    return;
  }
  const cdp = await CDP.connect(info.webSocketDebuggerUrl);
  try {
    // Reuse an occupied port for --launch/--browser only if its profile was previously selected.
    if (!launched && (opts.launch || opts.browser) && !remembered) {
      throw new Error('Debugging port is already in use and no eval instance is remembered. Run npm run eval with --instance <id> to select a profile first.');
    }
    let worker = await discover(cdp, { requested: opts.instance, remembered });
    if (!launched && (opts.launch || opts.browser) && worker.instanceId !== remembered) {
      throw new Error('Existing debugging port does not match evals/.instance; refusing to reuse it.');
    }
    const instanceId = worker.instanceId;
    await writeFile(join(EVALS, '.instance'), instanceId + '\n');
    await writeFile(join(EVALS, '.ext-id'), new URL(worker.url).host + '\n');
    if (opts.browser) { console.log(`Brave eval profile is ready (instance ${instanceId}). No tasks were run.`); return; }
    if (worker.running || !['idle', 'complete', 'error'].includes(worker.phase)) throw new Error(`Agent is busy (phase: ${worker.phase}); wait for its current task to finish.`);
    let gitsha = 'unknown';
    try { gitsha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}
    const dir = join(EVALS, 'runs', `${new Date().toISOString().replace(/:/g, '-')}-${gitsha}`);
    await mkdir(dir, { recursive: true });
    const metadata = { instanceId, gitsha, judge: !opts['no-judge'], startedAt: new Date().toISOString() };
    const runs = [];
    let needsReconnect = false;
    for (const task of tasks) {
      for (let n = 1; n <= opts.runs; n++) {
        console.log(`${task.id} ${n}/${opts.runs}…`);
        let result;
        const started = Date.now();
        try {
          if (needsReconnect) {
            worker = await discover(cdp, { requested: instanceId });
            needsReconnect = false;
          }
          const { expect: _expect, rubric: _rubric, check: _check, ...wireTask } = task;
          result = await cdp.evaluate(worker.sessionId, `dodoEval.runTask(${JSON.stringify(wireTask)})`, (task.timeoutMs ?? 600_000) + 90_000);
          if (!result || result.instanceId !== instanceId) throw new Error('Eval returned no result or the wrong instance identity');
        } catch (e) {
          // The in-flight run cannot be resumed after a worker restart. Rediscover only by identity.
          needsReconnect = true;
          result = { taskId: task.id, instanceId, status: /detach|session|target.*closed|context.*destroy/i.test(e.message) ? 'sw_restarted' : 'error', errorMsg: e.message, metrics: { wallMs: Date.now() - started } };
        }
        result.grade = await grade(task, result, opts['no-judge'] ? null : async (input) => {
          try { return await cdp.evaluate(worker.sessionId, `dodoEval.judge(${JSON.stringify(input)})`, 120_000); }
          catch (error) { needsReconnect = true; throw error; }
        });
        const runDir = join(dir, task.id, String(n));
        await mkdir(runDir, { recursive: true });
        const { screenshot, trace, ...saved } = result;
        await writeFile(join(runDir, 'result.json'), JSON.stringify(saved, null, 2) + '\n');
        await writeFile(join(runDir, 'trace.json'), JSON.stringify(trace ?? null, null, 2) + '\n');
        if (screenshot) await writeFile(join(runDir, 'final.jpg'), Buffer.from(screenshot, 'base64'));
        runs.push(saved);
        const rows = summarize(tasks, runs);
        await writeFile(join(dir, 'summary.json'), JSON.stringify({ ...metadata, tasks: rows, runs }, null, 2) + '\n');
        await writeFile(join(dir, 'summary.md'), markdown(rows, metadata));
        console.log(`  ${result.grade.status}${result.errorMsg ? `: ${result.errorMsg}` : ''}`);
      }
    }
    console.log('\n' + markdown(summarize(tasks, runs), metadata));
    console.log(`Saved: ${dir}`);
    if (runs.some((r) => !r.grade.pass)) process.exitCode = 1;
  } finally { cdp.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`Eval: ${e.message}`); process.exitCode = 1; });
}
