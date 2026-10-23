// Eval harness hook — only installed in the eval build (`npm run build:eval`, see service-worker.ts).
// scripts/eval.mjs drives it over the Chrome DevTools Protocol: it attaches to this service worker and
// calls `dodoEval.runTask(task)`, which runs one task end-to-end in a fresh window and answers every
// human-in-the-loop prompt by a fixed policy (grant listed hosts, never confirm checkout/payment).
import { agent } from './agent';
import { getSettings, saveSettings, matchesAllowlist } from './store';
import { captureScreenshot, getPinnedTabId, waitForTabComplete } from './tools';
import { getProvider } from './providers';
import { domainPatternOf } from '../shared/permissions';
import { log } from './log';
import type { AgentPhase, AgentState, AllowlistEntry, Mode, Settings, UIMessage } from '../shared/types';

export type EvalTask = {
  id: string;
  prompt: string;
  startUrl: string;
  // Domain patterns (`*.trenitalia.com`, `www.omio.com`) the agent may be granted access to. Any
  // permission prompt for a host outside this list is denied — which ends the run.
  allowedHosts: string[];
  mode?: Mode;
  model?: string;
  timeoutMs?: number;
};

export type EvalStatus = 'complete' | 'error' | 'timeout' | 'busy';

export type EvalResult = {
  taskId: string;
  instanceId: string;
  status: EvalStatus;
  errorMsg?: string;
  answer?: string;
  finalUrl?: string;
  metrics: {
    wallMs: number;
    elapsed?: number;
    turns?: number;
    tokensIn?: number;
    tokensOut?: number;
    toolCalls: number;
    toolErrors: number;
    toolsByName: Record<string, number>;
  };
  toolErrors: { name: string; detail?: string }[];
  criticals: { action: string; label: string; reason: string }[];
  permissions: { host: string; access?: string; status: string }[];
  deniedHosts: string[];
  files: { filename: string; content: string }[];
  plans: { goal: string; steps: string[] }[];
  screenshot?: string; // base64 JPEG of the final viewport
  trace?: unknown; // agent.exportForLLM(false)
};

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_FILE_CHARS = 50_000;
const INSTANCE_KEY = 'evalInstanceId';

// One run at a time: the agent is a singleton, so a second runTask (another CLI, or a retry racing
// the first) must not reset it mid-run.
let running = false;

// A per-profile identity, so the CLI can tell apart service workers from different profiles that
// share the same extension id (same unpacked path) behind one debugging port.
let instancePromise: Promise<string> | undefined;
function getInstanceId(): Promise<string> {
  return instancePromise ??= loadInstanceId().catch((error) => {
    instancePromise = undefined;
    throw error;
  });
}

async function loadInstanceId(): Promise<string> {
  const raw = await chrome.storage.local.get(INSTANCE_KEY);
  const existing = raw[INSTANCE_KEY] as string | undefined;
  if (existing) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTANCE_KEY]: id });
  return id;
}

function isIdle(phase: AgentPhase): boolean {
  return phase === 'idle' || phase === 'complete' || phase === 'error';
}

async function ping() {
  await agent.ready;
  return {
    instanceId: await getInstanceId(),
    phase: agent.state.phase,
    running,
    version: chrome.runtime.getManifest().version,
  };
}

async function runTask(task: EvalTask): Promise<EvalResult> {
  await agent.ready;
  const instanceId = await getInstanceId();
  const startedAt = Date.now();
  const empty = (status: EvalStatus, errorMsg?: string): EvalResult => ({
    taskId: task.id, instanceId, status, errorMsg,
    metrics: { wallMs: Date.now() - startedAt, toolCalls: 0, toolErrors: 0, toolsByName: {} },
    toolErrors: [], criticals: [], permissions: [], deniedHosts: [], files: [], plans: [],
  });
  if (running || !isIdle(agent.state.phase)) {
    return empty('busy', `agent is busy (phase: ${agent.state.phase}${running ? ', eval in progress' : ''})`);
  }
  if (!task.prompt?.trim() || !Array.isArray(task.allowedHosts)
    || !URL.canParse(task.startUrl) || !/^https?:$/.test(new URL(task.startUrl).protocol)
    || (task.timeoutMs != null && (!Number.isFinite(task.timeoutMs) || task.timeoutMs <= 0))) {
    return empty('error', 'invalid eval task');
  }
  running = true;
  log.info('eval: start', task.id);

  // Override only what the eval needs, and restore exactly those keys afterwards — so a settings
  // change the user makes meanwhile (e.g. the API key) isn't clobbered by a stale full snapshot.
  const overrides: Partial<Settings> = {
    defaultMode: task.mode ?? 'auto',
    approvalMode: 'auto_accept',
    notifyEnabled: false,
    ...(task.model ? { model: task.model } : {}),
  };
  let restore: Partial<Settings> | undefined;
  const allowed: AllowlistEntry[] = task.allowedHosts.map((pattern) => ({ pattern, scope: 'domain', access: 'act' }));
  const deniedHosts: string[] = [];
  const handled = new Set<string>();
  let windowId: number | undefined;
  let unsub: (() => void) | null = null;
  let active = true;
  let runPromise: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (fn: () => Promise<void>) => setTimeout(() => {
    if (active) void fn().catch((error) => log.err('eval policy failed', error));
  }, 0);

  try {
    const before = await getSettings();
    restore = Object.fromEntries(
      Object.keys(overrides).map((k) => [k, before[k as keyof Settings]]),
    ) as Partial<Settings>;
    await saveSettings(overrides);
    agent.reset();

    const win = await chrome.windows.create({ url: task.startUrl, focused: true, type: 'normal' });
    windowId = win?.id;
    const tabId = win?.tabs?.[0]?.id;
    if (tabId == null) return empty('error', 'could not open the eval window');
    await waitForTabComplete(tabId);

    // Eval policy for the human-in-the-loop prompts. Listeners fire synchronously inside setState —
    // before the agent has stored the prompt's resolver — so act on the next tick, once per prompt.
    const policy = (s: AgentState) => {
      if (s.phase === 'awaiting_permission' && s.pendingPermission) {
        const pending = [...s.messages].reverse().find((m) => m.kind === 'permission_request' && m.status === 'pending');
        const key = `perm:${pending?.id ?? s.pendingPermission.url}`;
        if (handled.has(key)) return;
        handled.add(key);
        const { host, url, access } = s.pendingPermission;
        later(async () => {
          if (matchesAllowlist(url, host, allowed, access)) {
            await agent.decidePermission(domainPatternOf(host), 'domain', 'session', access);
          } else {
            deniedHosts.push(host);
            await agent.denyPermission();
          }
        });
      } else if (s.phase === 'awaiting_critical' && s.pendingCritical) {
        // Never confirm checkout/payment/state-changing links. Reaching this point is recorded in
        // `criticals` (from the critical_confirm messages) and is the success signal for "book X" tasks.
        const id = s.pendingCritical.messageId;
        if (handled.has(id)) return;
        handled.add(id);
        later(() => agent.denyCritical(id));
      } else if (s.phase === 'awaiting_approval' && s.pendingExecution) {
        const id = s.pendingExecution.messageId;
        if (handled.has(id)) return;
        handled.add(id);
        later(() => agent.approveExecution(id));
      }
    };
    unsub = agent.subscribe(policy);

    const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    runPromise = agent.sendMessage(task.prompt, { tabId });
    await Promise.race([
      runPromise,
      new Promise<void>((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs); }),
    ]);
    clearTimeout(timer);
    if (timedOut) await agent.stop();

    const result = await collect(task, instanceId, startedAt, timedOut, deniedHosts, windowId);
    log.info('eval: done', task.id, result.status);
    return result;
  } catch (e) {
    log.err('eval: failed', task.id, e);
    const errorMsg = e instanceof Error ? e.message : String(e);
    if (runPromise) {
      await agent.stop().catch(() => undefined);
      const partial = await collect(task, instanceId, startedAt, false, deniedHosts, windowId).catch(() => null);
      if (partial) return { ...partial, status: 'error', errorMsg };
    }
    return empty('error', errorMsg);
  } finally {
    active = false;
    clearTimeout(timer);
    unsub?.();
    if (restore) await saveSettings(restore).catch((error) => log.err('eval: settings restore failed', error));
    if (windowId != null) await chrome.windows.remove(windowId).catch(() => undefined);
    // stop() signals cancellation but an outstanding provider/tool promise may still be draining.
    // Keep the eval lock until it settles so the next task cannot reset that live loop.
    if (runPromise) void runPromise.then(() => { running = false; }, () => { running = false; });
    else running = false;
  }
}

async function collect(
  task: EvalTask,
  instanceId: string,
  startedAt: number,
  timedOut: boolean,
  deniedHosts: string[],
  windowId: number | undefined,
): Promise<EvalResult> {
  const { phase, errorMsg, messages } = agent.state;
  const of = <K extends UIMessage['kind']>(kind: K) =>
    messages.filter((m): m is Extract<UIMessage, { kind: K }> => m.kind === kind);

  const assistant = of('assistant').at(-1);
  const tools = of('tool_activity');
  const toolsByName: Record<string, number> = {};
  for (const t of tools) toolsByName[t.name] = (toolsByName[t.name] ?? 0) + 1;
  const toolErrors = tools.filter((t) => t.status === 'error').map((t) => ({ name: t.name, detail: t.detail }));

  // The agent may have followed a new tab — read the tab it ended on, not the one we opened.
  const pinned = getPinnedTabId();
  const finalTab = pinned != null ? await chrome.tabs.get(pinned).catch(() => null) : null;
  let screenshot: string | undefined;
  try {
    if (finalTab?.id != null) await chrome.tabs.update(finalTab.id, { active: true });
    screenshot = await captureScreenshot(finalTab?.windowId ?? windowId);
  } catch (e) {
    log.warn('eval: screenshot failed', e);
  }

  return {
    taskId: task.id,
    instanceId,
    status: timedOut ? 'timeout' : phase === 'error' ? 'error' : 'complete',
    errorMsg,
    answer: assistant?.text,
    finalUrl: finalTab?.url,
    metrics: {
      wallMs: Date.now() - startedAt,
      elapsed: assistant?.elapsed,
      turns: assistant?.turns,
      tokensIn: assistant?.tokensIn,
      tokensOut: assistant?.tokensOut,
      toolCalls: tools.length,
      toolErrors: toolErrors.length,
      toolsByName,
    },
    toolErrors,
    criticals: of('critical_confirm').map((m) => ({ action: m.action, label: m.label, reason: m.reason })),
    permissions: of('permission_request').map((m) => ({ host: m.host, access: m.access, status: m.status })),
    deniedHosts: [...new Set(deniedHosts)],
    files: of('file_artifact').map((m) => ({ filename: m.filename, content: m.content.slice(0, MAX_FILE_CHARS) })),
    plans: of('plan_proposal').map((m) => ({ goal: m.goal, steps: m.steps })),
    screenshot,
    trace: agent.exportForLLM(false),
  };
}

const JUDGE_SYSTEM = `You grade the output of a browser agent against a rubric. You are strict: the answer must actually
satisfy the rubric, not merely sound plausible. Output ONLY a JSON object:
{"pass": boolean, "score": number between 0 and 1, "reason": "one or two sentences"}`;

async function judge(input: { rubric: string; prompt: string; answer?: string; finalUrl?: string; criticals?: unknown[] }) {
  const settings = await getSettings();
  const provider = getProvider(settings.providerId);
  const text = [
    `TASK GIVEN TO THE AGENT:\n${input.prompt}`,
    `RUBRIC:\n${input.rubric}`,
    `AGENT'S FINAL ANSWER:\n${input.answer ?? '(no answer)'}`,
    `FINAL PAGE URL: ${input.finalUrl ?? '(unknown)'}`,
    `CHECKOUT/PAYMENT STEPS REACHED (and declined by the harness): ${JSON.stringify(input.criticals ?? [])}`,
  ].join('\n\n');
  const res = await provider.chat({
    apiKey: settings.apiKey,
    model: settings.model,
    systemPrompt: JUDGE_SYSTEM,
    messages: [{ role: 'user', parts: [{ type: 'text', text }] }],
    tools: [],
    jsonResponse: true,
  });
  if (res.kind !== 'text') throw new Error('judge returned a tool call');
  const parsed = JSON.parse(res.text.trim()) as { pass?: unknown; score?: unknown; reason?: unknown };
  if (typeof parsed.pass !== 'boolean' || typeof parsed.score !== 'number'
    || !Number.isFinite(parsed.score) || parsed.score < 0 || parsed.score > 1
    || typeof parsed.reason !== 'string') throw new Error('invalid judge response');
  return { pass: parsed.pass, score: parsed.score, reason: parsed.reason };
}

export function installEvalHook() {
  (globalThis as unknown as { dodoEval: unknown }).dodoEval = { ping, runTask, judge };
  log.info('eval hook installed');
}
