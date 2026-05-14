// Singleton agent that owns the state machine and Gemini conversation; one instance lives in the service worker process.
import type {
  AgentState, Plan, ToolCallRecord, ToolName, CompleteSummary, HistoryItem, HistoryStatus,
  SavedConversationMessage, SavedConversationPart, ScriptStep, SnapshotElement, SnapshotResult, ScriptTarget,
} from '../shared/types';
import { INITIAL_AGENT_STATE } from '../shared/types';
import type { ChatMessage, ContentPart } from './providers/types';
import { getProvider } from './providers';
import { TOOL_SCHEMAS, getActiveTab, hostFromUrl, navigateTab, captureScreenshot, runContentOp, pinActiveTab } from './tools';
import { getSettings, upsertHistory, getHistoryItem, addAllowedHost } from './store';
import { isHostAllowed } from './permissions';
import { log } from './log';
import { notify } from './notify';

type Listener = (s: AgentState) => void;

// Two separate system prompts because planning and execution have different output contracts:
// planning must return strict JSON; execution must call tools (not emit free-form JSON).
const PLAN_SYSTEM = `You are DODO, an open-source browser agent. The user will give you a task along with context about their current page, datetime, and location.

Reply with ONLY a JSON object with keys:
- "sites": string[] — hosts (no scheme) the agent will touch, e.g. "docs.google.com".
- "steps": string[] — 2-6 human-readable imperative steps, lowercase, no numbering, no trailing periods.
- "script": array of step objects — the exact action sequence to execute.

Script step formats:
  {"action":"navigate","url":"https://..."}
  {"action":"snapshot"}
  {"action":"click","target":{...},"description":"why"}
  {"action":"type","target":{...},"text":"value"}
  {"action":"extract"}
  {"action":"done","summary":"what was accomplished"}

Target objects describe the element with visible properties — never invent CSS selectors:
  text: visible button/link label
  aria: aria-label value
  placeholder: input placeholder
  role: ARIA role (button, link, textbox…)
  type: HTML input type (email, text, search…)

Rules:
- After every navigate step, add a snapshot step before any click/type.
- If the task starts on the current page shown in context, you may omit the first navigate and start with a snapshot.
- Use at least one property per target; more is better.
- Only navigate to hosts listed in "sites".
- Script must end with a "done" step.
- Use the datetime and location context to produce accurate results (locale-aware searches, correct regional sites, etc.).`;

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

IMPORTANT: You MUST always end every task by calling done() — even if your response is purely informational text. Never stop with a plain text message; always follow it with a done() call.

Never invent URLs; only navigate to hosts that appear in the plan.`;

async function getApproxLocation(): Promise<string> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch('https://ipapi.co/json/', { signal: ctrl.signal });
    clearTimeout(tid);
    const d = await r.json() as Record<string, string>;
    return [d.city, d.country_name].filter(Boolean).join(', ');
  } catch { return ''; }
}

const RESOLVE_THRESHOLD = 5;

function scoreElement(el: SnapshotElement, t: ScriptTarget): number {
  let score = 0;
  if (t.text) {
    const elText = (el.text ?? '').toLowerCase();
    const tText = t.text.toLowerCase();
    if (elText === tText) score += 10;
    else if (elText.includes(tText) || tText.includes(elText)) score += 5;
  }
  if (t.aria && el.aria) {
    score += el.aria.toLowerCase() === t.aria.toLowerCase() ? 8
           : el.aria.toLowerCase().includes(t.aria.toLowerCase()) ? 4 : 0;
  }
  if (t.placeholder && el.placeholder) {
    score += el.placeholder.toLowerCase() === t.placeholder.toLowerCase() ? 8
           : el.placeholder.toLowerCase().includes(t.placeholder.toLowerCase()) ? 4 : 0;
  }
  if (t.role && el.role && el.role.toLowerCase() === t.role.toLowerCase()) score += 3;
  if (t.type && el.type && el.type.toLowerCase() === t.type.toLowerCase()) score += 3;
  return score;
}

function isTypeable(el: SnapshotElement): boolean {
  if (['input', 'textarea'].includes(el.tag)) return true;
  if (el.role === 'textbox' || el.role === 'combobox' || el.role === 'searchbox') return true;
  return false;
}

function resolveTarget(target: ScriptTarget, elements: SnapshotElement[], action: 'click' | 'type' = 'click'): string | null {
  let best: { selector: string; score: number } | null = null;
  for (const el of elements) {
    if (action === 'type' && !isTypeable(el)) continue;
    const score = scoreElement(el, target);
    if (score > (best?.score ?? 0)) best = { selector: el.selector, score };
  }
  return best && best.score >= RESOLVE_THRESHOLD ? best.selector : null;
}

class Agent {
  state: AgentState = { ...INITIAL_AGENT_STATE };
  private listeners = new Set<Listener>();
  private aborted = false;
  private resolvePermission: ((allowed: boolean) => void) | null = null;
  private conversation: ChatMessage[] = [];
  private taskId: string | null = null;

  private async persistSnapshot(status: HistoryStatus, extras?: Partial<HistoryItem>) {
    if (!this.taskId || !this.state.task) return;
    const startedAt = this.state.startedAt ?? Date.now();
    const item: HistoryItem = {
      id: this.taskId,
      startedAt,
      endedAt: status === 'running' ? undefined : Date.now(),
      title: this.state.task,
      sub: (this.state.plan?.sites ?? []).join(', ') || 'no hosts',
      status,
      steps: this.state.toolCalls.length,
      durationMs: Date.now() - startedAt,
      state: {
        ...this.state,
        toolCalls: this.state.toolCalls.map((t) => ({ ...t, thumb: undefined })),
      },
      conversation: serializeConversation(this.conversation),
      ...extras,
    };
    try {
      await upsertHistory(item);
    } catch (e) {
      log.warn('persist history failed', e);
    }
  }


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
    log.info('submit', { task, reusingId: !!this.taskId });
    this.aborted = false;
    this.conversation = [];
    // Preserve an existing taskId (e.g. retry-from-history on a task that errored
    // before any conversation existed) so we upsert the same history row instead
    // of creating a duplicate. `reset()` clears taskId for true fresh-task flows.
    if (!this.taskId) this.taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.setState({
      ...INITIAL_AGENT_STATE,
      phase: 'planning',
      task,
      workingLabel: 'drafting plan',
      startedAt: Date.now(),
    });
    void this.persistSnapshot('running');

    const settings = await getSettings();
    const provider = getProvider(settings.providerId);
    if (!settings.apiKey) {
      return this.fail('no api key configured — open settings to add your gemini key');
    }

    try {
      pinActiveTab(null); // clear any stale pin before querying the real active tab
      const tab = await getActiveTab();
      if (tab?.id != null) {
        pinActiveTab(tab.id);
        log.info('pinned tab', { tabId: tab.id, url: tab.url });
      } else {
        log.warn('no active tab found at submit');
      }

      let pageContext = '';
      if (tab?.id != null && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        try {
          const snap = await runContentOp(tab.id, { op: 'snapshot' });
          if (snap.ok && snap.data) {
            const data = snap.data as SnapshotResult;
            const lines = (data.elements ?? []).slice(0, 60).map((e: SnapshotElement) =>
              [e.tag, e.text ? `text="${e.text}"` : '', e.aria ? `aria="${e.aria}"` : '',
               e.placeholder ? `ph="${e.placeholder}"` : '', e.role ? `role="${e.role}"` : '',
               e.type ? `type="${e.type}"` : ''].filter(Boolean).join(' ')
            );
            pageContext = `URL: ${data.url ?? tab.url}\nTitle: ${data.title ?? tab.title ?? ''}\nElements:\n${lines.join('\n')}`;
          }
        } catch { /* best-effort */ }
      }
      if (!pageContext) pageContext = `URL: ${tab?.url ?? 'none'}\nTitle: ${tab?.title ?? ''}\nElements:\n(no snapshot available)`;

      const now = new Date();
      const datetime = now.toISOString();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const location = await getApproxLocation();

      const contextBlock = `TASK: ${task}\n\nCURRENT PAGE:\n${pageContext}\n\nCONTEXT:\nDatetime: ${datetime}\nTimezone: ${timezone}\nLocation: ${location || '(unknown)'}`;

      const planMessages: ChatMessage[] = [
        { role: 'user', parts: [{ type: 'text', text: contextBlock }] },
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
      void this.persistSnapshot('running');
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

    const tab = await getActiveTab().catch(() => null);
    const datetime = new Date().toISOString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    let snapshotLines = '(no snapshot available)';
    if (tab?.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      try {
        const snap = await runContentOp(tab.id, { op: 'snapshot' });
        if (snap.ok && snap.data) {
          const data = snap.data as SnapshotResult;
          snapshotLines = (data.elements ?? []).slice(0, 60).map((e: SnapshotElement) =>
            [e.tag, e.text ? `text="${e.text}"` : '', e.aria ? `aria="${e.aria}"` : '',
             e.placeholder ? `ph="${e.placeholder}"` : '', e.role ? `role="${e.role}"` : '',
             e.type ? `type="${e.type}"` : ''].filter(Boolean).join(' ')
          ).join('\n');
        }
      } catch { /* best-effort */ }
    }

    const enriched = `Current page: ${tab?.url ?? 'unknown'} — ${tab?.title ?? ''}\nDatetime: ${datetime} (${timezone})\nElements:\n${snapshotLines}\n\nFollow-up: ${text}`;

    this.conversation.push({ role: 'user', parts: [{ type: 'text', text: enriched }] });
    this.setState({
      phase: 'working',
      task: text,
      workingLabel: 'continuing',
      complete: undefined,
      errorMsg: undefined,
      toolCalls: [],
    });
    await this.runLoop();
  }

  async approvePlan() {
    if (this.state.phase !== 'awaiting_approval' || !this.state.plan || !this.state.task) return;
    log.info('plan approved', { scriptMode: !!this.state.plan.script?.length });
    this.setState({ phase: 'working', workingLabel: 'starting' });

    if (this.state.plan.script?.length) {
      await this.runScript([...this.state.plan.script]);
    } else {
      this.conversation = [
        { role: 'user', parts: [{ type: 'text', text: this.state.task }] },
        { role: 'assistant', parts: [{ type: 'text', text: JSON.stringify(this.state.plan) }] },
        { role: 'user', parts: [{ type: 'text', text: 'plan approved. proceed.' }] },
      ];
      await this.runLoop();
    }
  }

  stop() {
    log.info('stop');
    this.aborted = true;
    pinActiveTab(null);
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    const wasRunning = this.taskId && this.state.task && this.state.phase !== 'idle'
      && this.state.phase !== 'complete' && this.state.phase !== 'error';
    if (wasRunning) {
      void this.persistSnapshot('stopped');
    }
    this.conversation = [];
    this.taskId = null;
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
      // Inject a recovery hint so the model tries a different approach instead of repeating the same failing call.
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
    this.taskId = null;
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    this.state = { ...INITIAL_AGENT_STATE };
    for (const l of this.listeners) l(this.state);
  }

  async openHistory(id: string) {
    const item = await getHistoryItem(id);
    if (!item || !item.state) {
      log.warn('openHistory — no item or no saved state', id);
      return;
    }
    log.info('openHistory', { id, status: item.status });
    this.aborted = true;
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    this.taskId = item.id;
    this.conversation = deserializeConversation(item.conversation ?? []);
    // restore state — but force terminal/pending phases that aren't safely resumable
    // back to a viewable state. running/awaiting_permission saved from a prior session
    // can't actually be resumed (the tab/permission promise is gone), so present them
    // as error so the user can decide.
    let restored: AgentState = { ...item.state };
    if (restored.phase === 'planning' || restored.phase === 'working'
        || restored.phase === 'awaiting_permission' || restored.phase === 'awaiting_approval') {
      restored = {
        ...restored,
        phase: 'error',
        errorMsg: restored.errorMsg ?? `task was ${item.status} — pick up with retry or send a new message`,
        workingLabel: undefined,
        pendingPermission: undefined,
      };
    }
    this.state = restored;
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

  private async doSnapshot(): Promise<SnapshotResult | null> {
    const tab = await getActiveTab();
    if (!tab?.id) return null;
    const startedAt = Date.now();
    const r = await runContentOp(tab.id, { op: 'snapshot' });
    if (!r.ok || !r.data) return null;
    const data = r.data as SnapshotResult;
    this.pushToolCall({
      id: `snapshot_${startedAt}`,
      name: 'snapshot',
      args: {},
      status: 'ok',
      startedAt,
      endedAt: Date.now(),
      label: 'inventory interactive elements',
      detail: `${data.elements?.length ?? 0} elements`,
    });
    return data;
  }

  private async dispatchNavigate(url: string): Promise<void> {
    const host = hostFromUrl(url);
    if (!host) throw new Error('invalid url');
    const allowed = await isHostAllowed(host);
    if (!allowed) {
      const ok = await this.waitForPermission(host, `agent wants to navigate to ${host}`);
      if (!ok) throw new Error('permission_denied');
    }
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('no active tab');
    const startedAt = Date.now();
    const recId = `navigate_${startedAt}`;
    this.pushToolCall({ id: recId, name: 'navigate', args: { url }, status: 'pending', startedAt, label: `navigate to ${host}` });
    await navigateTab(tab.id, url);
    this.updateToolCall(recId, { status: 'ok', endedAt: Date.now() });
  }

  private async runLoop() {
    const settings = await getSettings();
    const provider = getProvider(settings.providerId);

    // 40-turn cap guards against runaway loops; the model should call done() long before this.
    let emptyTurns = 0;
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
        if (!res.text.trim()) {
          if (++emptyTurns >= 3) return this.fail('model returned empty response');
          continue;
        }
        emptyTurns = 0;
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
      void this.persistSnapshot('running');

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

  private async runScript(script: ScriptStep[]) {
    let lastSnapshot: SnapshotResult | null = null;
    let i = 0;
    let recoveryAttempts = 0;

    while (i < script.length && !this.aborted) {
      const step = script[i];

      // Auto-insert snapshot before any interaction when we don't have one
      if ((step.action === 'click' || step.action === 'type') && !lastSnapshot) {
        lastSnapshot = await this.doSnapshot();
        if (!lastSnapshot) return this.fail('snapshot failed before interaction');
        continue; // re-evaluate same step with fresh snapshot
      }

      try {
        if (step.action === 'navigate') {
          await this.dispatchNavigate(step.url);
          lastSnapshot = null;
          recoveryAttempts = 0;
          i++;

        } else if (step.action === 'snapshot') {
          lastSnapshot = await this.doSnapshot();
          if (!lastSnapshot) return this.fail('snapshot failed');
          recoveryAttempts = 0;
          i++;

        } else if (step.action === 'click' || step.action === 'type') {
          const selector = resolveTarget(step.target, lastSnapshot!.elements, step.action);
          if (!selector) {
            if (++recoveryAttempts > 3) return this.fail(`no element matched after ${recoveryAttempts - 1} recovery attempts: ${step.description ?? JSON.stringify(step.target)}`);
            const repaired = await this.recoverScript(step, lastSnapshot!, script.slice(i));
            if (!repaired) return this.fail(`no element matched: ${step.description ?? JSON.stringify(step.target)}`);
            script = [...script.slice(0, i), ...repaired];
            // keep lastSnapshot — the recovery LLM already used this snapshot's data,
            // and nulling it would cause an infinite auto-insert loop if resolution fails again
            continue;
          }

          const tab = await getActiveTab();
          if (!tab?.id) return this.fail('no active tab');
          const startedAt = Date.now();
          const recId = `${step.action}_${startedAt}`;
          this.pushToolCall({
            id: recId, name: step.action, status: 'pending', startedAt,
            args: step.action === 'type' ? { selector, text: step.text } : { selector },
            label: step.action === 'type' ? `type into ${selector}` : `click ${selector}`,
          });
          this.setState({ workingLabel: step.description ?? (step.action === 'type' ? `type into ${selector}` : `click ${selector}`) });

          const op = step.action === 'type'
            ? await runContentOp(tab.id, { op: 'type', selector, text: step.text })
            : await runContentOp(tab.id, { op: 'click', selector });

          if (!op.ok) {
            this.updateToolCall(recId, { status: 'error', endedAt: Date.now(), errorMsg: op.error });
            if (++recoveryAttempts > 3) return this.fail(`action failed after ${recoveryAttempts - 1} recovery attempts: ${op.error}`);
            const fresh = await this.doSnapshot();
            const repaired = fresh ? await this.recoverScript(step, fresh, script.slice(i)) : null;
            if (!repaired) return this.fail(op.error ?? 'action failed');
            script = [...script.slice(0, i), ...repaired];
            lastSnapshot = fresh;
            continue;
          }

          this.updateToolCall(recId, { status: 'ok', endedAt: Date.now() });
          lastSnapshot = null;
          recoveryAttempts = 0;
          i++;

        } else if (step.action === 'extract') {
          const tab = await getActiveTab();
          if (tab?.id) {
            const startedAt = Date.now();
            const r = await runContentOp(tab.id, { op: 'extract' });
            this.pushToolCall({
              id: `extract_${startedAt}`, name: 'extract', args: {}, startedAt, endedAt: Date.now(),
              status: r.ok ? 'ok' : 'error', label: 'read page',
            });
          }
          i++;

        } else if (step.action === 'done') {
          return this.complete({
            summary: step.summary,
            actionItems: [],
            durationMs: Date.now() - (this.state.startedAt ?? Date.now()),
            steps: this.state.toolCalls.length,
          });
        } else {
          i++; // skip unknown step types
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'permission_denied') return this.fail('user denied permission');
        if (++recoveryAttempts > 3) return this.fail(`step threw after ${recoveryAttempts - 1} recovery attempts: ${msg}`);
        const fresh = await this.doSnapshot();
        const repaired = fresh ? await this.recoverScript(step, fresh, script.slice(i)) : null;
        if (!repaired) return this.fail(msg);
        script = [...script.slice(0, i), ...repaired];
        lastSnapshot = fresh;
      }

      void this.persistSnapshot('running');
    }

    if (!this.aborted) this.fail('script ended without done step');
  }

  private async recoverScript(
    failedStep: ScriptStep,
    snapshot: SnapshotResult,
    remainingSteps: ScriptStep[],
  ): Promise<ScriptStep[] | null> {
    const settings = await getSettings();
    const provider = getProvider(settings.providerId);

    const elementSummary = (snapshot.elements ?? []).slice(0, 60).map((e) =>
      [e.tag, e.selector, e.text ? `text="${e.text}"` : '', e.aria ? `aria="${e.aria}"` : '',
       e.placeholder ? `ph="${e.placeholder}"` : '', e.role ? `role="${e.role}"` : '',
       e.type ? `type="${e.type}"` : ''].filter(Boolean).join(' ')
    ).join('\n');

    const prompt = `You are repairing a browser automation script. A step failed because no element matched.

FAILED STEP: ${JSON.stringify(failedStep)}

CURRENT PAGE (${snapshot.url}):
${elementSummary}

REMAINING STEPS (must still be completed):
${JSON.stringify(remainingSteps, null, 2)}

Output ONLY a JSON array of script steps to replace the failed step and complete the remaining work.
Use real text/aria/placeholder values visible in the snapshot above for targets.
If the page changed unexpectedly, add navigate/snapshot steps as needed.`;

    try {
      const res = await provider.chat({
        apiKey: settings.apiKey,
        model: settings.model,
        systemPrompt: 'You are a browser automation repair assistant. Output ONLY valid JSON — an array of script steps.',
        messages: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }],
        tools: [],
        jsonResponse: true,
      });
      if (res.kind !== 'text') return null;
      const parsed = JSON.parse(res.text.trim());
      return Array.isArray(parsed) ? (parsed as ScriptStep[]) : null;
    } catch { return null; }
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
    pinActiveTab(null);
    this.setState({ phase: 'complete', complete: c, workingLabel: undefined });
    notify('dodo · done', truncate(c.summary, 140) || `task complete · ${c.steps} actions`);
    void this.persistSnapshot('done');
  }

  private fail(msg: string) {
    log.err('fail', msg);
    pinActiveTab(null);
    this.setState({ phase: 'error', errorMsg: msg, workingLabel: undefined });
    notify('dodo · halted', truncate(msg, 140));
    if (this.state.task) void this.persistSnapshot('error');
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
        script: Array.isArray(obj.script) && obj.script.length ? (obj.script as ScriptStep[]) : undefined,
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

function serializeConversation(messages: ChatMessage[]): SavedConversationMessage[] {
  return messages.map((m) => ({
    role: m.role,
    parts: m.parts.map((p): SavedConversationPart => {
      if (p.type === 'image') return { type: 'image_omitted', mimeType: p.mimeType };
      if (p.type === 'tool_call') return { type: 'tool_call', id: p.id, name: p.name, args: p.args, thoughtSignature: p.thoughtSignature };
      if (p.type === 'tool_result') return { type: 'tool_result', id: p.id, name: p.name, result: p.result, isError: p.isError };
      return { type: 'text', text: p.text };
    }),
  }));
}

function deserializeConversation(messages: SavedConversationMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    parts: m.parts.flatMap((p): ContentPart[] => {
      if (p.type === 'image_omitted') {
        return [{ type: 'text', text: `[screenshot omitted from saved history · ${p.mimeType}]` }];
      }
      if (p.type === 'tool_call') return [{ type: 'tool_call', id: p.id, name: p.name, args: p.args, thoughtSignature: p.thoughtSignature }];
      if (p.type === 'tool_result') return [{ type: 'tool_result', id: p.id, name: p.name, result: p.result, isError: p.isError }];
      return [{ type: 'text', text: p.text }];
    }),
  }));
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
