import type {
  AgentState, Plan, ToolCallRecord, ToolName, CompleteSummary, HistoryItem,
} from '../shared/types';
import { INITIAL_AGENT_STATE } from '../shared/types';
import type { ChatMessage, ContentPart } from './providers/types';
import { getProvider } from './providers';
import { TOOL_SCHEMAS, getActiveTab, hostFromUrl, navigateTab, captureScreenshot, runContentOp, pinActiveTab } from './tools';
import { getSettings, appendHistory, addAllowedHost } from './store';
import { isHostAllowed } from './permissions';
import { log } from './log';
import { notify } from './notify';

type Listener = (s: AgentState) => void;

const PLAN_SYSTEM = `You are DODO, an open-source browser agent. The user will give you a task; you produce a short execution plan.
Reply with ONLY a JSON object: {"sites": string[], "steps": string[]}.
- sites: hosts (no scheme) the agent will need to touch, e.g. "docs.google.com".
- steps: 2-6 imperative steps in lowercase, no numbering, no trailing periods.`;

const EXEC_SYSTEM = `You are DODO, an open-source browser agent operating inside the user's Chrome browser.

Tools available: navigate, screenshot, snapshot, click, type, extract, done.

CRITICAL RULES for selectors:
- Do NOT invent CSS selectors. If you do not have a real selector from snapshot() output, you MUST call snapshot() first.
- snapshot() returns a list of interactive elements each with a verified \`selector\` string. Pass that string verbatim to click() or type().
- screenshot() shows you the layout but does NOT give you selectors. Always pair a screenshot with snapshot() before any click/type.
- If a click/type fails with "no element matches", call snapshot() again to get the current selectors — the page may have changed.

General flow:
1. navigate to the target site if needed.
2. screenshot + snapshot to understand the page.
3. Use selectors from the snapshot to click/type.
4. extract content when you need to read text.
5. When the task is fully done, call done() with a summary and prioritized action items.

Never invent URLs; only navigate to hosts that appear in the plan.`;

class Agent {
  state: AgentState = { ...INITIAL_AGENT_STATE };
  private listeners = new Set<Listener>();
  private aborted = false;
  private resolvePermission: ((allowed: boolean) => void) | null = null;
  private conversation: ChatMessage[] = [];

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  private setState(patch: Partial<AgentState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private pushToolCall(r: ToolCallRecord) {
    this.state = { ...this.state, toolCalls: [...this.state.toolCalls, r] };
    for (const l of this.listeners) l(this.state);
  }

  private updateToolCall(id: string, patch: Partial<ToolCallRecord>) {
    this.state = {
      ...this.state,
      toolCalls: this.state.toolCalls.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    };
    for (const l of this.listeners) l(this.state);
  }

  async submit(task: string) {
    log.info('submit', { task });
    this.aborted = false;
    this.conversation = [];
    this.setState({
      ...INITIAL_AGENT_STATE,
      phase: 'planning',
      task,
      workingLabel: 'drafting plan',
      startedAt: Date.now(),
    });

    try {
      const tab = await getActiveTab();
      if (tab?.id != null) {
        pinActiveTab(tab.id);
        log.info('pinned tab', { tabId: tab.id, url: tab.url });
      } else {
        log.warn('no active tab found at submit');
      }
    } catch (e) {
      log.warn('pin tab failed', e);
    }

    const settings = await getSettings();
    const provider = getProvider(settings.providerId);
    if (!settings.apiKey) {
      return this.fail('no api key configured — open settings to add your gemini key');
    }

    try {
      const planMessages: ChatMessage[] = [
        { role: 'user', parts: [{ type: 'text', text: task }] },
      ];
      log.info('plan request', { provider: provider.id, model: settings.model });
      const planRes = await provider.chat({
        apiKey: settings.apiKey,
        model: settings.model,
        systemPrompt: PLAN_SYSTEM,
        messages: planMessages,
        tools: [],
        jsonResponse: true,
      });
      if (planRes.kind !== 'text') return this.fail('planner did not return JSON');
      const plan = parsePlan(planRes.text);
      if (!plan) {
        log.err('plan parse failed', planRes.text);
        return this.fail('could not parse plan JSON');
      }
      log.info('plan ready', plan);
      this.setState({ phase: 'awaiting_approval', plan, workingLabel: 'drafted plan' });
    } catch (e) {
      log.err('submit failed', e);
      return this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  async continueChat(text: string) {
    if (!text.trim()) return;
    if (this.state.phase !== 'complete' && this.state.phase !== 'error') {
      log.warn('continueChat ignored — not in terminal state', this.state.phase);
      return;
    }
    log.info('continue', { text });
    this.aborted = false;
    this.conversation.push({ role: 'user', parts: [{ type: 'text', text }] });
    this.setState({
      phase: 'working',
      workingLabel: 'continuing',
      complete: undefined,
      errorMsg: undefined,
    });
    await this.runLoop();
  }

  async approvePlan() {
    if (this.state.phase !== 'awaiting_approval' || !this.state.plan || !this.state.task) return;
    log.info('plan approved — starting loop');
    this.setState({ phase: 'working', workingLabel: 'starting' });
    this.conversation = [
      { role: 'user', parts: [{ type: 'text', text: this.state.task }] },
      { role: 'assistant', parts: [{ type: 'text', text: JSON.stringify(this.state.plan) }] },
      { role: 'user', parts: [{ type: 'text', text: 'plan approved. proceed.' }] },
    ];
    await this.runLoop();
  }

  stop() {
    log.info('stop');
    this.aborted = true;
    this.conversation = [];
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    this.state = { ...INITIAL_AGENT_STATE };
    for (const l of this.listeners) l(this.state);
  }

  async retry() {
    if (this.state.phase !== 'error') return;
    if (!this.conversation.length) {
      if (this.state.task) return this.submit(this.state.task);
      return;
    }
    log.info('retry — resuming conversation', { messages: this.conversation.length });
    this.aborted = false;
    const last = this.conversation[this.conversation.length - 1];
    if (last.role !== 'user' && last.role !== 'tool') {
      this.conversation.push({
        role: 'user',
        parts: [{ type: 'text', text: 'continue from where you left off. if a tool call failed, try a different approach (e.g., call snapshot() to get fresh selectors).' }],
      });
    }
    this.setState({ phase: 'working', workingLabel: 'retrying', errorMsg: undefined });
    await this.runLoop();
  }

  reset() {
    this.aborted = true;
    this.conversation = [];
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    this.state = { ...INITIAL_AGENT_STATE };
    for (const l of this.listeners) l(this.state);
  }

  async allowHost(host: string, remember: boolean) {
    if (remember && host) await addAllowedHost(host);
    if (this.resolvePermission) {
      this.resolvePermission(true);
      this.resolvePermission = null;
      this.setState({ phase: 'working', pendingPermission: undefined });
    }
  }

  async denyPermission() {
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    this.setState({ pendingPermission: undefined });
    this.fail('user denied permission');
  }

  private waitForPermission(host: string, reason: string): Promise<boolean> {
    this.setState({ phase: 'awaiting_permission', pendingPermission: { host, reason } });
    notify('dodo · needs you', `permission required for ${host}`);
    return new Promise<boolean>((resolve) => {
      this.resolvePermission = resolve;
    });
  }

  private async runLoop() {
    const settings = await getSettings();
    const provider = getProvider(settings.providerId);

    for (let turn = 0; turn < 40 && !this.aborted; turn++) {
      log.info(`turn ${turn} → chat`, { messages: this.conversation.length });
      let res;
      try {
        res = await provider.chat({
          apiKey: settings.apiKey,
          model: settings.model,
          systemPrompt: EXEC_SYSTEM,
          messages: this.conversation,
          tools: TOOL_SCHEMAS,
        });
      } catch (e) {
        log.err('chat failed', e);
        return this.fail(e instanceof Error ? e.message : String(e));
      }

      if (res.kind === 'text') {
        log.info(`turn ${turn} ← text`, res.text.slice(0, 200));
        this.conversation.push({ role: 'assistant', parts: [{ type: 'text', text: res.text }] });
        if (!res.text.trim()) return this.fail('model returned empty response');
        continue;
      }

      log.info(`turn ${turn} ← tool_calls`, res.calls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 80)})`));

      const assistantParts: ContentPart[] = res.calls.map((c) => ({
        type: 'tool_call', id: c.id, name: c.name, args: c.args, thoughtSignature: c.thoughtSignature,
      }));
      this.conversation.push({ role: 'assistant', parts: assistantParts });

      const toolReplies: ContentPart[] = [];
      let doneCall: { summary: string; actionItems: CompleteSummary['actionItems'] } | null = null;
      for (const call of res.calls) {
        if (this.aborted) return;
        const name = call.name as ToolName;
        if (name === 'done') {
          const summary = (call.args.summary as string) ?? 'task complete';
          const actionItems = sanitizeActionItems(call.args.actionItems);
          doneCall = { summary, actionItems };
          toolReplies.push({ type: 'tool_result', id: call.id, name: 'done', result: { ok: true } });
          continue;
        }

        const rec: ToolCallRecord = {
          id: call.id,
          name,
          args: call.args,
          status: 'pending',
          startedAt: Date.now(),
          label: labelFor(name, call.args),
        };
        this.pushToolCall(rec);
        this.setState({ workingLabel: rec.label });

        let result: unknown = null;
        let isError = false;
        try {
          result = await this.dispatch(name, call.args);
          log.info(`  ✓ ${name}`, detailFor(name, call.args, result) ?? '');
          this.updateToolCall(call.id, {
            status: 'ok',
            endedAt: Date.now(),
            detail: detailFor(name, call.args, result),
            thumb: name === 'screenshot' ? (result as { thumb?: string }).thumb : undefined,
          });
        } catch (e) {
          isError = true;
          const msg = e instanceof Error ? e.message : String(e);
          log.warn(`  ✗ ${name}`, msg);
          this.updateToolCall(call.id, { status: 'error', endedAt: Date.now(), errorMsg: msg, detail: msg });
          if (msg === 'permission_denied') {
            return this.fail('user denied permission');
          }
          result = msg;
        }

        if (name === 'screenshot' && !isError) {
          const r = result as { base64?: string };
          if (r.base64) {
            toolReplies.push({
              type: 'tool_result',
              id: call.id,
              name,
              result: { ok: true, note: 'screenshot attached as next user message' },
            });
            toolReplies.push({
              type: 'image',
              mimeType: 'image/jpeg',
              base64: r.base64,
            } as ContentPart);
            continue;
          }
        }
        toolReplies.push({
          type: 'tool_result',
          id: call.id,
          name,
          result: isError ? String(result) : (sanitizeResult(name, result) as unknown),
          isError,
        });
      }

      this.conversation.push({ role: 'tool', parts: toolReplies });

      if (doneCall) {
        return this.complete({
          summary: doneCall.summary,
          actionItems: doneCall.actionItems,
          durationMs: Date.now() - (this.state.startedAt ?? Date.now()),
          steps: this.state.toolCalls.length,
        });
      }
    }

    if (!this.aborted) this.fail('exceeded max turns');
  }

  private async dispatch(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
    const tab = await getActiveTab();
    if (!tab || tab.id == null) throw new Error('no active tab');

    if (name === 'navigate') {
      const url = String(args.url ?? '');
      const host = hostFromUrl(url);
      if (!host) throw new Error('invalid url');
      const allowed = await isHostAllowed(host);
      if (!allowed) {
        const ok = await this.waitForPermission(host, `agent wants to navigate to ${host}, which is not in your allowlist.`);
        if (!ok) throw new Error('permission_denied');
      }
      await navigateTab(tab.id, url);
      return { ok: true, url };
    }

    const currentHost = tab.url ? hostFromUrl(tab.url) : '';
    if (currentHost) {
      const allowed = await isHostAllowed(currentHost);
      if (!allowed) {
        const ok = await this.waitForPermission(currentHost, `agent wants to act on ${currentHost}, which is not in your allowlist.`);
        if (!ok) throw new Error('permission_denied');
      }
    }

    if (name === 'screenshot') {
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('devtools://') || tab.url.startsWith('chrome-extension://'))) {
        throw new Error(`cannot capture ${tab.url} — restricted URL. navigate to a normal page first.`);
      }
      const base64 = await captureScreenshot(tab.windowId);
      return { ok: true, base64, thumb: base64.slice(0, 200) };
    }
    if (name === 'snapshot') {
      const r = await runContentOp(tab.id, { op: 'snapshot' });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
    if (name === 'click') {
      const r = await runContentOp(tab.id, { op: 'click', selector: String(args.selector ?? '') });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
    if (name === 'type') {
      const r = await runContentOp(tab.id, { op: 'type', selector: String(args.selector ?? ''), text: String(args.text ?? '') });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
    if (name === 'extract') {
      const r = await runContentOp(tab.id, { op: 'extract', selector: args.selector ? String(args.selector) : undefined });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
    throw new Error(`unknown tool: ${name}`);
  }

  private complete(c: CompleteSummary) {
    log.info('complete', { steps: c.steps, durationMs: c.durationMs, summary: c.summary.slice(0, 200) });
    this.setState({ phase: 'complete', complete: c, workingLabel: undefined });
    notify('dodo · done', truncate(c.summary, 140) || `task complete · ${c.steps} actions`);
    const item: HistoryItem = {
      id: `${Date.now()}`,
      startedAt: this.state.startedAt ?? Date.now(),
      title: this.state.task ?? 'task',
      sub: (this.state.plan?.sites ?? []).join(', ') || 'no hosts',
      status: 'done',
      steps: this.state.toolCalls.length,
      durationMs: c.durationMs,
    };
    appendHistory(item).catch(() => undefined);
  }

  private fail(msg: string) {
    log.err('fail', msg);
    this.setState({ phase: 'error', errorMsg: msg, workingLabel: undefined });
    notify('dodo · halted', truncate(msg, 140));
    if (this.state.task) {
      const item: HistoryItem = {
        id: `${Date.now()}`,
        startedAt: this.state.startedAt ?? Date.now(),
        title: this.state.task,
        sub: (this.state.plan?.sites ?? []).join(', ') || 'no hosts',
        status: 'error',
        steps: this.state.toolCalls.length,
        durationMs: Date.now() - (this.state.startedAt ?? Date.now()),
      };
      appendHistory(item).catch(() => undefined);
    }
  }
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function parsePlan(text: string): Plan | null {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) s = fence[1].trim();
  try {
    const obj = JSON.parse(s);
    if (Array.isArray(obj.steps)) {
      return {
        sites: Array.isArray(obj.sites) ? obj.sites.map(String) : [],
        steps: obj.steps.map(String),
      };
    }
  } catch {}
  return null;
}

function labelFor(name: ToolName, args: Record<string, unknown>): string {
  if (name === 'navigate') return `navigate to ${hostFromUrl(String(args.url ?? '')) || args.url}`;
  if (name === 'screenshot') return 'capture viewport';
  if (name === 'snapshot') return 'inventory interactive elements';
  if (name === 'click') return `click ${args.selector ?? ''}`;
  if (name === 'type') return `type into ${args.selector ?? ''}`;
  if (name === 'extract') return args.selector ? `extract ${args.selector}` : 'read page';
  return name;
}

function detailFor(name: ToolName, _args: Record<string, unknown>, result: unknown): string | undefined {
  if (name === 'extract') {
    const r = result as { text?: string };
    if (r?.text) return `${Math.min(r.text.length, 99999)} chars`;
  }
  if (name === 'snapshot') {
    const r = result as { elements?: unknown[] };
    if (Array.isArray(r?.elements)) return `${r.elements.length} elements`;
  }
  if (name === 'screenshot') return 'jpeg · q70';
  return undefined;
}

function sanitizeResult(name: ToolName, result: unknown): unknown {
  if (name === 'extract') {
    const r = result as { text?: string };
    if (r?.text && r.text.length > 6000) return { text: r.text.slice(0, 6000) + '\n…[truncated]' };
  }
  return result;
}

function sanitizeActionItems(raw: unknown): CompleteSummary['actionItems'] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const item = x as { priority?: string; text?: string };
    const text = item.text ?? '';
    if (!text) return [];
    const p = item.priority === 'p0' || item.priority === 'p1' || item.priority === 'p2' ? item.priority : 'p1';
    return [{ priority: p, text }];
  });
}

export const agent = new Agent();
