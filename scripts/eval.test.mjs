import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { CDP, grade, needsLogin, options, pickInstance, summarize } from './eval.mjs';
import { tasks } from '../evals/tasks.mjs';

class Socket extends EventTarget {
  sent = [];
  send(data) { this.sent.push(JSON.parse(data)); }
  emit(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  close() { this.dispatchEvent(new Event('close')); }
}

test('CDP correlates concurrent out-of-order responses, propagates errors, and scopes detaches', async () => {
  const socket = new Socket(), cdp = new CDP(socket);
  const a = cdp.send('Runtime.evaluate', {}, 'a');
  const b = cdp.send('Runtime.evaluate', {}, 'b');
  socket.emit({ id: 2, result: { value: 'second' } });
  socket.emit({ id: 1, result: { value: 'first' } });
  assert.equal((await a).value, 'first');
  assert.equal((await b).value, 'second');
  const failed = cdp.send('Bad.method');
  socket.emit({ id: 3, error: { message: 'unknown method' } });
  await assert.rejects(failed, /unknown method/);
  const detached = cdp.send('Runtime.evaluate', {}, 'a');
  const stays = cdp.send('Runtime.evaluate', {}, 'b');
  socket.emit({ method: 'Target.detachedFromTarget', params: { sessionId: 'a' } });
  await assert.rejects(detached, /detached/);
  socket.emit({ id: 5, result: {} });
  await stays;
  const closed = cdp.send('Runtime.evaluate');
  cdp.close();
  await assert.rejects(closed, /closed/);
  assert.equal(cdp.pending.size, 0);
});

test('CDP clears timed-out requests and exposes runtime exceptions', async () => {
  const socket = new Socket(), cdp = new CDP(socket);
  await assert.rejects(cdp.send('Never.answers', {}, 'a', 5), /timeout/);
  assert.equal(cdp.pending.size, 0);
  const value = cdp.evaluate('a', 'bad()');
  socket.emit({ id: 2, result: { exceptionDetails: { exception: { description: 'busy' } } } });
  await assert.rejects(value, /busy/);
  cdp.close();
});

const worker = (id) => ({ instanceId: id, url: 'chrome-extension://test/background/service-worker.js' });
test('profile identity never silently selects an ambiguous or changed profile', () => {
  assert.throws(() => pickInstance([]), /dist-eval/);
  assert.throws(() => pickInstance([worker('a'), worker('b')], undefined, 'a'), /Multiple/);
  assert.throws(() => pickInstance([worker('b')], undefined, 'a'), /changed/);
  assert.equal(pickInstance([worker('a'), worker('b')], 'b', 'a').instanceId, 'b');
  assert.throws(() => pickInstance([worker('a')], 'b'), /not uniquely/);
  assert.equal(pickInstance([worker('a')], undefined, 'a').instanceId, 'a');
});

const result = () => ({ taskId: 'a', status: 'complete', answer: 'Fare €42', finalUrl: 'https://example.org/trip', criticals: [{ label: 'pay' }], metrics: { turns: 4, tokensIn: 100, tokensOut: 20, wallMs: 2000 } });
test('all deterministic checks and the enabled judge must pass', async () => {
  const task = { id: 'a', prompt: 'travel', rubric: 'correct fare', expect: { answerMatches: /€42/g, finalUrlMatches: /example.org/, reachedCritical: true, maxTurns: 5 }, check: () => true };
  const judged = await grade(task, result(), async () => ({ pass: false, score: 0.2, reason: 'wrong day' }));
  assert.equal(judged.pass, false);
  assert.equal(judged.checks.at(-1).reason, 'wrong day');
  assert.equal((await grade(task, result(), null)).pass, true);
  assert.equal((await grade(task, result(), null)).pass, true); // stateful /g regex is not reused
  assert.equal((await grade(task, { ...result(), status: 'timeout' }, null)).pass, false);
  assert.equal((await grade(task, { ...result(), deniedHosts: ['other.org'] }, null)).pass, false);
  assert.equal((await grade(task, result(), async () => ({ pass: true, score: 4 }))).pass, false);
  assert.equal((await grade({ ...task, check: () => { throw new Error('bad check'); } }, result())).pass, false);
});

test('login classification and summary preserve unavailable metrics', async () => {
  const task = { id: 'a', requiresLogin: 'linkedin.com' };
  const login = { ...result(), finalUrl: 'https://www.linkedin.com/authwall?x=1', metrics: { wallMs: 1000 } };
  assert.equal(needsLogin(task, login), true);
  assert.equal(needsLogin(task, result()), false);
  assert.equal(needsLogin(task, { answer: 'You need to sign in' }), true);
  login.grade = await grade(task, login);
  assert.equal(login.grade.status, 'needs_login');
  assert.equal(login.grade.pass, false);
  const [summary] = summarize([task], [login]);
  assert.equal(summary.needsLogin, 1);
  assert.equal(summary.avgTurns, null);
  assert.equal(summary.avgTokens, null);
  assert.equal(summary.avgMs, 1000);
});

test('CLI flags and task fixtures are valid without starting Brave', () => {
  assert.equal(options([]).runs, 3);
  assert.equal(options(['--browser']).browser, true);
  assert.throws(() => options(['--runs', '0']), /positive/);
  assert.throws(() => options(['--port', '65536']), /port/);
  assert.throws(() => options(['--chrome']), /Unknown option/);
  assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length);
  for (const task of tasks) {
    assert.match(task.id, /^[a-z0-9-]+$/);
    const host = new URL(task.startUrl).hostname;
    assert.ok(task.allowedHosts.some((p) => host === p || host === p.slice(2) || host.endsWith('.' + p.slice(2))));
    assert.ok(task.prompt.length > 20);
  }
});

// Execute the actual TypeScript hook with mocked extension boundaries, not a live account.
const hookSource = ts.transpileModule(readFileSync(new URL('../src/background/eval.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function hookFixture() {
  const initial = { defaultMode: 'ask', approvalMode: 'always_ask', notifyEnabled: true, model: 'original', apiKey: 'private' };
  let settings = { ...initial }, data = {}, listener, closed = 0, decision, sent;
  const agent = {
    ready: Promise.resolve(), state: { phase: 'idle', messages: [] },
    reset() { this.state = { phase: 'idle', messages: [] }; },
    subscribe(fn) { listener = fn; fn(this.state); return () => { listener = undefined; }; },
    async sendMessage(prompt, opts) { sent = { prompt, opts }; this.state = { phase: 'complete', messages: [{ kind: 'assistant', text: 'done', turns: 1, tokensIn: 5, tokensOut: 3, elapsed: 10 }] }; },
    async stop() { this.state.phase = 'complete'; },
    async decidePermission(...args) { decision = args; this.state.phase = 'working'; },
    async denyPermission() { decision = 'denied'; this.state.phase = 'complete'; },
    async denyCritical(id) { decision = id; this.state.phase = 'working'; },
    async approveExecution(id) { decision = id; },
    exportForLLM() { return { messages: this.state.messages }; },
  };
  const imports = {
    './agent': { agent },
    './store': {
      getSettings: async () => settings,
      saveSettings: async (patch) => { settings = { ...settings, ...patch }; },
      matchesAllowlist: (_url, host, entries) => entries.some((e) => e.pattern === host),
    },
    './tools': { captureScreenshot: async () => 'anBlZw==', getPinnedTabId: () => 9, waitForTabComplete: async () => {} },
    './providers': { getProvider: () => ({ chat: async () => ({ kind: 'text', text: '{"pass":true,"score":1,"reason":"correct"}' }) }) },
    '../shared/permissions': { domainPatternOf: (host) => `*.${host}` },
    './log': { log: { info() {}, warn() {}, err() {} } },
  };
  const context = {
    exports: {}, require: (name) => { assert.ok(imports[name], name); return imports[name]; },
    crypto: { randomUUID: () => 'profile-uuid' }, setTimeout, clearTimeout, URL, Error,
    chrome: {
      storage: { local: { get: async () => data, set: async (patch) => { data = { ...data, ...patch }; } } },
      runtime: { getManifest: () => ({ version: '1' }) },
      windows: { create: async () => ({ id: 4, tabs: [{ id: 9 }] }), remove: async () => { closed++; } },
      tabs: { get: async () => ({ id: 9, windowId: 4, url: 'https://example.org/end' }), update: async () => {} },
    },
  };
  vm.runInNewContext(hookSource, context);
  context.exports.installEvalHook();
  return { hook: context.dodoEval, agent, initial, get settings() { return settings; }, get closed() { return closed; }, get sent() { return sent; }, get decision() { return decision; }, emit(state) { agent.state = state; listener?.(state); } };
}
const task = { id: 'test', prompt: 'read page', startUrl: 'https://example.org', allowedHosts: ['example.org'], timeoutMs: 1000 };

test('eval hook persists identity, pins requested tab, captures artifacts, and restores settings', async () => {
  const f = hookFixture();
  assert.equal((await f.hook.ping()).instanceId, 'profile-uuid');
  const r = await f.hook.runTask(task);
  assert.equal(r.status, 'complete');
  assert.equal(r.answer, 'done');
  assert.equal(r.metrics.elapsed, 10);
  assert.equal(r.screenshot, 'anBlZw==');
  assert.equal(f.sent.opts.tabId, 9);
  assert.deepEqual(f.settings, f.initial);
  assert.equal(f.closed, 1);
  assert.equal((await f.hook.ping()).running, false);
});

test('eval hook handles permission and critical prompts once, always denying critical actions', async () => {
  for (const host of ['example.org', 'denied.org']) {
    const f = hookFixture();
    f.agent.sendMessage = async () => {
      f.emit({ phase: 'awaiting_permission', pendingPermission: { host, url: `https://${host}`, access: 'act' }, messages: [{ id: 'p', kind: 'permission_request', host, status: 'pending' }] });
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(host === 'example.org' ? f.decision[0] : f.decision, host === 'example.org' ? '*.example.org' : 'denied');
      f.emit({ phase: 'awaiting_critical', pendingCritical: { messageId: 'c' }, messages: [{ id: 'c', kind: 'critical_confirm', action: 'pay', label: 'Buy', reason: 'payment' }] });
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(f.decision, 'c');
      f.agent.state.phase = 'complete';
    };
    const r = await f.hook.runTask(task);
    assert.equal(r.criticals.length, 1);
    assert.equal(r.deniedHosts.length, host === 'example.org' ? 0 : 1);
    assert.deepEqual(f.settings, f.initial);
  }
});

test('timeout stops the agent but keeps the busy lock until its outstanding work drains', async () => {
  const f = hookFixture();
  let finish;
  f.agent.sendMessage = () => new Promise((resolve) => { finish = resolve; f.agent.state.phase = 'working'; });
  const r = await f.hook.runTask({ ...task, timeoutMs: 5 });
  assert.equal(r.status, 'timeout');
  assert.deepEqual(f.settings, f.initial);
  assert.equal(f.closed, 1);
  assert.equal((await f.hook.runTask(task)).status, 'busy');
  finish();
  await Promise.resolve();
  assert.equal((await f.hook.ping()).running, false);
});

test('an active side-panel task is rejected before settings or browser state change', async () => {
  const f = hookFixture();
  f.agent.state.phase = 'working';
  assert.equal((await f.hook.runTask(task)).status, 'busy');
  assert.equal(f.closed, 0);
  assert.deepEqual(f.settings, f.initial);
});

test('malformed tasks fail before taking the lock, and a later valid run succeeds', async () => {
  const f = hookFixture();
  assert.equal((await f.hook.runTask({ ...task, startUrl: 'not a URL' })).status, 'error');
  assert.equal((await f.hook.runTask({ ...task, timeoutMs: -1 })).status, 'error');
  assert.equal(f.closed, 0);
  assert.equal((await f.hook.runTask(task)).status, 'complete');
});

test('unexpected run failures preserve partial evidence and still restore settings', async () => {
  const f = hookFixture();
  f.agent.sendMessage = async () => {
    f.agent.state = { phase: 'working', messages: [{ kind: 'tool_activity', name: 'navigate', status: 'error', detail: 'connection reset' }] };
    throw new Error('transport failed');
  };
  const r = await f.hook.runTask(task);
  assert.equal(r.status, 'error');
  assert.equal(r.errorMsg, 'transport failed');
  assert.equal(r.metrics.toolErrors, 1);
  assert.ok(r.trace);
  assert.deepEqual(f.settings, f.initial);
  assert.equal(f.closed, 1);
  assert.equal((await f.hook.ping()).running, false);
});
