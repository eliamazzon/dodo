// Chat-loop agent. Single LLM orchestrator drives the conversation; it invokes browser tools
// (snapshot/screenshot/navigate/click/type/extract) one at a time, inspecting the page between
// actions. snapshot() returns the page as HTML (interactive elements carry a `data-sel` the model
// passes to click/type); click() returns a diff of what changed. The final assistant text is the
// answer — no forced summary tool.
// (The planner/executor tools — plan_actions/execute_actions — are currently disabled but their
// code is retained below for later reuse.)
import type {
  AgentState, Plan, HistoryItem, HistoryStatus, SavedConversationMessage, SavedConversationPart,
  ScriptStep, SnapshotElement, SnapshotResult, HtmlSnapshotResult, ScriptTarget,
  UIMessage, ToolName, StepResult, ExecutionStatus,
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

const EXEC_SYSTEM = `You are DODO, an open-source browser agent operating inside the user's Chrome browser. You are in a chat conversation with the user — every turn you receive what they said and what tools have returned, and you respond with either tool calls or a final text answer.

You drive the browser with these tools, one action at a time, inspecting the page between actions. This works for everything: tasks with a UI menu/dropdown/modal/dialog, tasks where the user is already on the right page, and tasks where the next click depends on what just appeared (mail labeling, in-app workflows, login, filters, settings):
  • snapshot() — get the page DOM as HTML. Interactive elements carry a short \`data-sel\` ref token (e.g. data-sel="e42"); pass that ref as the selector to click/type. snapshot() gives a full-page overview (3 levels deep); snapshot({element: "e42"}) fully expands one container (dropdown, dialog, table row) — \`element\` is a ref from the latest snapshot; snapshot({element, n}) expands it n levels. Start with snapshot() for an overview, then drill in.
  • screenshot() — capture the viewport as a JPEG (layout context, no refs).
  • navigate({url}) — go to a URL. Triggers a host-allowlist prompt if needed.
  • click({selector}) — click an element. Selector must be a \`data-sel\` ref from snapshot(). Returns a diff of what changed in the DOM (appeared/disappeared/aria changes), with fresh refs for anything that appeared.
  • type({selector, text}) — type into an input/textarea, identified by a \`data-sel\` ref.
  • extract({selector?, mode?}) — survey or read the page. mode="map" (default) returns a COMPACT one-line-per-element list of EVERY interactive element with its \`data-sel\` ref + label, covering the whole page (or a scoped region) — use it to enumerate lists/grids/menus/results and get refs for all of them. mode="text" returns the full readable page text for reading prose/tables/prices.

The first message already includes a fresh snapshot of the current page — read it first; you do NOT need to call snapshot() again as your opening move. click() returns a DOM diff, so you usually don't need to snapshot() again just to see what a click did — read the diff. Only re-snapshot when the diff is insufficient or you need fresh \`data-sel\` refs for elements that just appeared. After a navigate (new page), always snapshot() before acting.

RULES:
- For long lists, tables, grids, or menus (inboxes, search results, settings, file lists), call extract() to enumerate EVERY item with its ref in one compact view. Do NOT drill into rows one-by-one, and do NOT assume a snapshot showed the whole list — a snapshot is depth-limited and may be truncated. A snapshot containing "… children omitted …" or "depth limit" is a PARTIAL view: switch to extract() to see everything. snapshot() is for structure/layout; extract() is for breadth.
- Do NOT invent refs or selectors. Use a \`data-sel\` ref from the LATEST snapshot (refs from a stale snapshot may no longer resolve). If you don't have one, call snapshot() first. The \`element\` arg of snapshot() is also a ref/selector from the latest snapshot — never make one up.
- Don't call done() — there is no done tool. End your turn with a plain text message and that text IS your answer to the user.
- Format your answer to fit the task. If the user asks for a list, output a list. If they ask a yes/no, answer briefly. If they ask for a table, use markdown. Never compress a list into a count or summary unless explicitly asked.
- When the user asks a follow-up that you can answer from prior turns' extracted text, just answer — don't re-browse.
- If a click/type fails with "no element matches", snapshot again — the page may have changed.
- Use the datetime/location context to produce accurate results.
- Never navigate to a host not in the allowlist without going through the navigate() tool's permission flow.`;

const PLAN_SYSTEM = `You are DODO's planner. The orchestrator agent asks you to draft a deterministic action script for a specific multi-step browser sub-task.

Reply with ONLY a JSON object with keys:
- "sites": string[] — hosts (no scheme) the script will touch.
- "steps": string[] — 2-6 human-readable imperative steps, lowercase, no numbering, no trailing periods.
- "script": array of step objects — the exact action sequence.
- "explanation": string — one-sentence summary of what this script will accomplish.

Script step formats:
  {"action":"navigate","url":"https://..."}
  {"action":"snapshot"}
  {"action":"click","target":{...},"description":"why"}
  {"action":"type","target":{...},"text":"value"}
  {"action":"extract"}

Target objects describe the element with visible properties — never invent CSS selectors:
  text: visible button/link label
  aria: aria-label value
  placeholder: input placeholder
  role: ARIA role (button, link, textbox…)
  type: HTML input type (email, text, search…)

Rules:
- After every navigate step, add a snapshot step before any click/type.
- If the task starts on the current page (shown in pageContext), you may omit the first navigate and start with a snapshot.
- Use at least one property per target; more is better.
- Only navigate to hosts listed in "sites".
- When the task requires reading data (prices, results, names, content), add an extract step before the script ends.
- Scripts end naturally when the last step runs — do NOT emit a "done" step.`;

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
    if (elText === tText) {
      score += 10;
    } else if (elText.length >= 3 && tText.length >= 3 && (elText.includes(tText) || tText.includes(elText))) {
      // Both sides must have real content to do substring matching — otherwise every
      // icon-only button (elText="") matches any target ("search".includes("") is true).
      score += 5;
    }
    // Fallback: the model often passes the user-visible label as `text` even when it's
    // actually a placeholder or aria-label (e.g., search boxes). Match weakly against both.
    if (el.placeholder) {
      const ep = el.placeholder.toLowerCase();
      if (ep === tText) score += 6;
      else if (ep.length >= 3 && tText.length >= 3 && (ep.includes(tText) || tText.includes(ep))) score += 3;
    }
    if (el.aria) {
      const ea = el.aria.toLowerCase();
      if (ea === tText) score += 6;
      else if (ea.length >= 3 && tText.length >= 3 && (ea.includes(tText) || tText.includes(ea))) score += 3;
    }
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
  // Soft boost for menu-ish roles when the element is otherwise a positive match. When a
  // dropdown/menu has just opened, its items should beat unrelated sidebar entries with
  // the same label. Only applies when score > 0 so it never resurrects an irrelevant element.
  if (score > 0 && el.role) {
    const r = el.role.toLowerCase();
    if (r === 'menuitem' || r === 'menuitemcheckbox' || r === 'menuitemradio' || r === 'option') {
      score += 2;
    }
  }
  return score;
}

function isTypeable(el: SnapshotElement): boolean {
  if (['input', 'textarea'].includes(el.tag)) return true;
  if (el.role === 'textbox' || el.role === 'combobox' || el.role === 'searchbox') return true;
  return false;
}

function resolveTarget(target: ScriptTarget, elements: SnapshotElement[], action: 'click' | 'type' = 'click'): string | null {
  let best: { selector: string; score: number } | null = null;
  // Iterate in reverse so DOM-order ties go to the LATER element. Portaled overlays
  // (dropdowns, dialogs, popovers) are appended near the end of <body>, while sidebar/nav
  // items live high in the DOM — when both equally match a label like "promotions", the
  // freshly opened menu option should win over the always-present sidebar link.
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (action === 'type' && !isTypeable(el)) continue;
    const score = scoreElement(el, target);
    if (score > (best?.score ?? 0)) best = { selector: el.selector, score };
  }
  return best && best.score >= RESOLVE_THRESHOLD ? best.selector : null;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

class Agent {
  state: AgentState = { ...INITIAL_AGENT_STATE };
  private listeners = new Set<Listener>();
  private aborted = false;
  private resolvePermission: ((allowed: boolean) => void) | null = null;
  private resolveExecution: ((approved: boolean) => void) | null = null;
  private conversation: ChatMessage[] = [];
  private taskId: string | null = null;
  private firstUserText: string | null = null; // used as the history row title

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  private emit() {
    for (const l of this.listeners) l(this.state);
  }

  private setState(patch: Partial<AgentState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private pushMessage(m: UIMessage) {
    this.state = { ...this.state, messages: [...this.state.messages, m] };
    this.emit();
  }

  private updateMessage(id: string, patch: Partial<UIMessage>) {
    this.state = {
      ...this.state,
      messages: this.state.messages.map((m) => (m.id === id ? ({ ...m, ...patch } as UIMessage) : m)),
    };
    this.emit();
  }

  private async persistSnapshot(status: HistoryStatus) {
    if (!this.taskId || !this.firstUserText) return;
    const startedAt = this.state.startedAt ?? Date.now();
    const stepCount = this.state.messages.filter(
      (m) => m.kind === 'tool_activity' || m.kind === 'execution',
    ).length;
    const item: HistoryItem = {
      id: this.taskId,
      startedAt,
      endedAt: status === 'running' ? undefined : Date.now(),
      title: this.firstUserText,
      sub: 'chat',
      status,
      steps: stepCount,
      durationMs: Date.now() - startedAt,
      state: {
        ...this.state,
        messages: this.state.messages.map((m) =>
          // `result` lives canonically in the saved conversation — drop the (heavy) copy here and
          // rehydrate it on reopen via `callId`. `thumb` is dropped for the same size reason.
          m.kind === 'tool_activity' ? { ...m, thumb: undefined, result: undefined } : m,
        ),
      },
      conversation: serializeConversation(this.conversation),
    };
    try {
      await upsertHistory(item);
    } catch (e) {
      log.warn('persist history failed', e);
    }
  }

  async sendMessage(text: string) {
    if (!text.trim()) return;
    const acceptablePhase =
      this.state.phase === 'idle'
      || this.state.phase === 'complete'
      || this.state.phase === 'error';
    if (!acceptablePhase) {
      log.warn('sendMessage ignored — agent busy', this.state.phase);
      return;
    }
    log.info('user message', { text, hasConversation: this.conversation.length > 0 });
    this.aborted = false;

    if (!this.taskId) {
      this.taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      this.firstUserText = text;
      this.setState({ startedAt: Date.now() });
    }

    // Build context block — page snapshot, datetime, location. Reused on first turn and follow-ups.
    const enriched = await this.buildUserContext(text);
    this.conversation.push({ role: 'user', parts: [{ type: 'text', text: enriched }] });
    this.pushMessage({ id: newId('msg'), kind: 'user', text, t: Date.now() });

    // Pin active tab once at conversation start.
    if (this.conversation.length === 1) {
      pinActiveTab(null);
      const tab = await getActiveTab().catch(() => null);
      if (tab?.id != null) {
        pinActiveTab(tab.id);
        log.info('pinned tab', { tabId: tab.id, url: tab.url });
      }
    }

    this.setState({ phase: 'working', workingLabel: 'thinking', errorMsg: undefined });
    void this.persistSnapshot('running');
    await this.runLoop();
  }

  private async buildUserContext(text: string): Promise<string> {
    const tab = await getActiveTab().catch(() => null);
    const datetime = new Date().toISOString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const location = this.conversation.length === 0 ? await getApproxLocation() : '';

    let pageContext = '(no snapshot available)';
    if (tab?.id != null && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      try {
        const snap = await runContentOp(tab.id, { op: 'snapshot' });
        if (snap.ok && snap.data) {
          const data = snap.data as HtmlSnapshotResult;
          pageContext = `URL: ${data.url}\nTitle: ${data.title}\n\n${data.html}`;
        }
      } catch { /* best-effort */ }
    }

    const header = this.conversation.length === 0 ? 'TASK' : 'FOLLOW-UP';
    return `${header}: ${text}\n\nCURRENT PAGE:\n${pageContext}\n\nCONTEXT:\nDatetime: ${datetime}\nTimezone: ${timezone}${location ? `\nLocation: ${location}` : ''}`;
  }

  async approveExecution(messageId: string) {
    if (this.state.phase !== 'awaiting_approval' || this.state.pendingExecution?.messageId !== messageId) {
      log.warn('approveExecution ignored — no matching pending execution');
      return;
    }
    this.updateMessage(messageId, { status: 'running' } as Partial<UIMessage>);
    this.setState({ phase: 'working', pendingExecution: undefined, workingLabel: 'executing script' });
    this.resolveExecution?.(true);
    this.resolveExecution = null;
  }

  async rejectExecution(messageId: string) {
    if (this.state.phase !== 'awaiting_approval' || this.state.pendingExecution?.messageId !== messageId) {
      log.warn('rejectExecution ignored — no matching pending execution');
      return;
    }
    this.updateMessage(messageId, { status: 'rejected' } as Partial<UIMessage>);
    this.setState({ phase: 'working', pendingExecution: undefined, workingLabel: 'thinking' });
    this.resolveExecution?.(false);
    this.resolveExecution = null;
  }

  // Halt the current step but keep the conversation alive so the user can follow up.
  // For a full wipe (new chat), call reset() — bound to the panel's "new task" button.
  stop() {
    log.info('stop');
    this.aborted = true;
    if (this.resolvePermission) { this.resolvePermission(false); this.resolvePermission = null; }
    if (this.resolveExecution) { this.resolveExecution(false); this.resolveExecution = null; }
    const wasRunning = this.taskId
      && this.state.phase !== 'idle' && this.state.phase !== 'complete' && this.state.phase !== 'error';
    this.setState({
      phase: 'complete',
      workingLabel: undefined,
      pendingPermission: undefined,
      pendingExecution: undefined,
    });
    if (wasRunning) void this.persistSnapshot('stopped');
  }

  async retry() {
    if (this.state.phase !== 'error') return;
    log.info('retry');
    this.aborted = false;
    if (!this.conversation.length) return;
    // Inject a nudge so the model tries a different approach instead of repeating the same failing call.
    const last = this.conversation[this.conversation.length - 1];
    if (last.role !== 'user') {
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
    this.firstUserText = null;
    if (this.resolvePermission) { this.resolvePermission(false); this.resolvePermission = null; }
    if (this.resolveExecution) { this.resolveExecution(false); this.resolveExecution = null; }
    pinActiveTab(null);
    this.state = { ...INITIAL_AGENT_STATE };
    this.emit();
  }

  async openHistory(id: string) {
    const item = await getHistoryItem(id);
    if (!item || !item.state) {
      log.warn('openHistory — no item or no saved state', id);
      return;
    }
    log.info('openHistory', { id, status: item.status });
    this.aborted = true;
    if (this.resolvePermission) { this.resolvePermission(false); this.resolvePermission = null; }
    if (this.resolveExecution) { this.resolveExecution(false); this.resolveExecution = null; }
    this.taskId = item.id;
    this.firstUserText = item.title || null;
    this.conversation = deserializeConversation(item.conversation ?? []);
    let restored: AgentState = { ...item.state };
    // Phases that can't actually be resumed (the tab/permission promise is gone) — force to error.
    if (restored.phase === 'working' || restored.phase === 'awaiting_permission' || restored.phase === 'awaiting_approval') {
      restored = {
        ...restored,
        phase: 'error',
        errorMsg: restored.errorMsg ?? `task was ${item.status} — pick up with retry or send a new message`,
        workingLabel: undefined,
        pendingPermission: undefined,
        pendingExecution: undefined,
      };
    }
    // Tolerate old-schema entries that lack `messages`.
    if (!Array.isArray(restored.messages)) restored.messages = [];
    // `result` was stripped on persist (it lives in the conversation) — rehydrate each tool row's
    // response from the deserialized conversation by matching its LLM tool-call id.
    const resultById = new Map<string, unknown>();
    for (const m of this.conversation) {
      if (m.role !== 'tool') continue;
      for (const p of m.parts) {
        if (p.type === 'tool_result') resultById.set(p.id, p.result);
      }
    }
    restored.messages = restored.messages.map((m) =>
      m.kind === 'tool_activity' && m.callId && resultById.has(m.callId)
        ? { ...m, result: resultById.get(m.callId) }
        : m,
    );
    this.state = restored;
    this.emit();
  }

  async allowHost(host: string, remember: boolean) {
    if (remember && host) await addAllowedHost(host);
    // mark pending permission UIMessage allowed
    const pending = this.state.messages.find((m) => m.kind === 'permission_request' && m.status === 'pending');
    if (pending) this.updateMessage(pending.id, { status: 'allowed' } as Partial<UIMessage>);
    if (this.resolvePermission) {
      this.resolvePermission(true);
      this.resolvePermission = null;
      this.setState({ phase: 'working', pendingPermission: undefined });
    }
  }

  async denyPermission() {
    const pending = this.state.messages.find((m) => m.kind === 'permission_request' && m.status === 'pending');
    if (pending) this.updateMessage(pending.id, { status: 'denied' } as Partial<UIMessage>);
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    this.setState({ pendingPermission: undefined });
    this.fail('user denied permission');
  }

  private waitForPermission(host: string, reason: string): Promise<boolean> {
    this.pushMessage({ id: newId('perm'), kind: 'permission_request', host, reason, status: 'pending', t: Date.now() });
    this.setState({ phase: 'awaiting_permission', pendingPermission: { host, reason } });
    notify('dodo · needs you', `permission required for ${host}`);
    return new Promise<boolean>((resolve) => { this.resolvePermission = resolve; });
  }

  private waitForExecutionApproval(messageId: string): Promise<boolean> {
    this.setState({ phase: 'awaiting_approval', pendingExecution: { messageId }, workingLabel: 'awaiting approval' });
    notify('dodo · needs you', 'execution approval required');
    return new Promise<boolean>((resolve) => { this.resolveExecution = resolve; });
  }

  private async runLoop() {
    const settings = await getSettings();
    const provider = getProvider(settings.providerId);
    if (!settings.apiKey) return this.fail('no api key configured — open settings to add your api key');

    let emptyTurns = 0;
    for (let turn = 0; turn < 200 && !this.aborted; turn++) {
      log.info(`turn ${turn} → chat`, { messages: this.conversation.length });
      this.setState({ workingLabel: 'thinking' });
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
        const text = res.text.trim();
        log.info(`turn ${turn} ← text`, text.slice(0, 200));
        if (!text) {
          // Don't push empty assistant turns into history — Gemini errors with
          // "function call turn comes immediately after a user turn or after a function response turn"
          // if the next turn is a tool_call (two model turns in a row).
          if (++emptyTurns >= 3) return this.fail('model returned empty response');
          continue;
        }
        emptyTurns = 0;
        this.conversation.push({ role: 'assistant', parts: [{ type: 'text', text: res.text }] });
        this.pushMessage({ id: newId('msg'), kind: 'assistant', text, t: Date.now() });
        return this.complete();
      }

      log.info(`turn ${turn} ← tool_calls`, res.calls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 80)})`));

      // Add the model's tool_call message to the conversation first.
      const assistantParts: ContentPart[] = res.calls.map((c) => ({
        type: 'tool_call', id: c.id, name: c.name, args: c.args, thoughtSignature: c.thoughtSignature,
      }));
      this.conversation.push({ role: 'assistant', parts: assistantParts });

      const toolReplies: ContentPart[] = [];
      let abortedMidBatch = false;
      for (const call of res.calls) {
        if (this.aborted) {
          // Fill remaining calls with synthetic error replies so the conversation
          // stays well-formed (every function_call must be paired with a function_response).
          toolReplies.push({
            type: 'tool_result', id: call.id, name: call.name,
            result: 'aborted', isError: true,
          });
          abortedMidBatch = true;
          continue;
        }
        const name = call.name as ToolName;
        const { result, isError, screenshotBase64 } = await this.dispatchToolCall(name, call.id, call.args);

        if (screenshotBase64) {
          toolReplies.push({
            type: 'tool_result',
            id: call.id,
            name,
            result: { ok: true, note: 'screenshot attached as next message' },
          });
          toolReplies.push({ type: 'image', mimeType: 'image/jpeg', base64: screenshotBase64 } as ContentPart);
        } else {
          toolReplies.push({
            type: 'tool_result',
            id: call.id,
            name,
            result: isError ? String(result) : result,
            isError,
          });
        }
      }

      this.conversation.push({ role: 'tool', parts: toolReplies });
      void this.persistSnapshot('running');

      if (abortedMidBatch) return;
    }

    if (!this.aborted) this.fail('exceeded max turns');
  }

  private async dispatchToolCall(
    name: ToolName,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<{ result: unknown; isError: boolean; screenshotBase64?: string }> {
    // plan_actions and execute_actions create their own rich UIMessage; granular tools push tool_activity.
    if (name === 'plan_actions') {
      return this.handlePlanActions(args);
    }
    if (name === 'execute_actions') {
      return this.handleExecuteActions(args);
    }

    // Granular tools — push a tool_activity message and dispatch.
    const activityId = newId('act');
    this.pushMessage({
      id: activityId, kind: 'tool_activity', name, args, callId,
      status: 'pending', t: Date.now(),
      detail: labelFor(name, args),
    });
    this.setState({ workingLabel: labelFor(name, args) });

    try {
      const result = await this.dispatchGranular(name, args);
      const detail = detailFor(name, result) ?? labelFor(name, args);
      const thumb = name === 'screenshot' ? (result as { thumb?: string }).thumb : undefined;
      this.updateMessage(activityId, { status: 'ok', detail, thumb, result } as Partial<UIMessage>);
      log.info(`  ✓ ${name}`, detail);

      if (name === 'screenshot') {
        const r = result as { base64?: string };
        if (r.base64) return { result: { ok: true }, isError: false, screenshotBase64: r.base64 };
      }
      return { result, isError: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`  ✗ ${name}`, msg);
      this.updateMessage(activityId, { status: 'error', detail: msg, result: msg } as Partial<UIMessage>);
      if (msg === 'permission_denied') {
        // already failed via denyPermission path; return early
        return { result: msg, isError: true };
      }
      return { result: msg, isError: true };
    } finally {
      void this.persistSnapshot('running');
    }
  }

  private async dispatchGranular(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
    const tab = await getActiveTab();
    if (!tab || tab.id == null) throw new Error('no active tab');

    if (name === 'navigate') {
      const url = String(args.url ?? '');
      const host = hostFromUrl(url);
      if (!host) throw new Error('invalid url');
      if (!await isHostAllowed(host)) {
        const ok = await this.waitForPermission(host, `agent wants to navigate to ${host}`);
        if (!ok) throw new Error('permission_denied');
      }
      await navigateTab(tab.id, url);
      // SPAs fire status:complete on HTML load, not after JS renders content
      await new Promise<void>((r) => setTimeout(r, 1500));
      return { ok: true, url };
    }

    const currentHost = tab.url ? hostFromUrl(tab.url) : '';
    if (currentHost && !await isHostAllowed(currentHost)) {
      const ok = await this.waitForPermission(currentHost, `agent wants to act on ${currentHost}`);
      if (!ok) throw new Error('permission_denied');
    }

    if (name === 'screenshot') {
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('devtools://') || tab.url.startsWith('chrome-extension://'))) {
        throw new Error(`cannot capture ${tab.url} — restricted URL`);
      }
      const base64 = await captureScreenshot(tab.windowId);
      return { ok: true, base64, thumb: base64.slice(0, 200) };
    }
    if (name === 'snapshot') {
      const r = await runContentOp(tab.id, {
        op: 'snapshot',
        selector: args.element ? String(args.element) : undefined,
        depth: typeof args.n === 'number' ? args.n : undefined,
      });
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
      const r = await runContentOp(tab.id, {
        op: 'extract',
        selector: args.selector ? String(args.selector) : undefined,
        mode: args.mode === 'text' ? 'text' : 'map',
      });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
    throw new Error(`unknown granular tool: ${name}`);
  }

  private async handlePlanActions(args: Record<string, unknown>): Promise<{ result: unknown; isError: boolean }> {
    const goal = String(args.goal ?? '');
    const pageContext = String(args.pageContext ?? '');
    if (!goal) return { result: 'plan_actions requires `goal`', isError: true };

    this.setState({ workingLabel: 'planning' });
    const settings = await getSettings();
    const provider = getProvider(settings.providerId);
    try {
      const res = await provider.chat({
        apiKey: settings.apiKey,
        model: settings.model,
        systemPrompt: PLAN_SYSTEM,
        messages: [{ role: 'user', parts: [{ type: 'text', text: `GOAL: ${goal}\n\nPAGE CONTEXT:\n${pageContext}` }] }],
        tools: [],
        jsonResponse: true,
      });
      if (res.kind !== 'text') return { result: 'planner did not return JSON', isError: true };
      const plan = parsePlan(res.text);
      if (!plan) {
        log.warn('plan parse failed', res.text);
        return { result: 'could not parse plan JSON', isError: true };
      }
      this.pushMessage({
        id: newId('plan'),
        kind: 'plan_proposal',
        goal, sites: plan.sites, steps: plan.steps, script: plan.script,
        explanation: plan.explanation,
        t: Date.now(),
      });
      return { result: { sites: plan.sites, steps: plan.steps, script: plan.script, explanation: plan.explanation }, isError: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: `plan_actions failed: ${msg}`, isError: true };
    }
  }

  private async handleExecuteActions(args: Record<string, unknown>): Promise<{ result: unknown; isError: boolean }> {
    const rawScript = args.script;
    if (!Array.isArray(rawScript) || rawScript.length === 0) {
      return { result: 'execute_actions requires a non-empty `script` array', isError: true };
    }
    const script = rawScript as ScriptStep[];
    // A script that contains nothing but snapshots is a no-op — it leaves the page unchanged and returns no
    // extracted text, so the model loops back with the same blind spot. Force it to either act or use the
    // granular snapshot() tool to inspect the page.
    const hasMutatingStep = script.some(
      (s) => s.action === 'click' || s.action === 'type' || s.action === 'navigate' || s.action === 'extract',
    );
    if (!hasMutatingStep) {
      return {
        result: 'execute_actions script must contain at least one click/type/navigate/extract step. To just inspect the page, call snapshot() directly instead.',
        isError: true,
      };
    }
    const rationale = typeof args.rationale === 'string' ? args.rationale : undefined;

    const settings = await getSettings();
    const initStatus: ExecutionStatus = settings.approvalMode === 'auto_accept' ? 'running' : 'pending_approval';
    const execId = newId('exec');
    this.pushMessage({
      id: execId, kind: 'execution', script, status: initStatus,
      rationale, t: Date.now(),
    });

    if (settings.approvalMode === 'always_ask') {
      const approved = await this.waitForExecutionApproval(execId);
      if (!approved) {
        return { result: { status: 'rejected', extracted: '', results: [] }, isError: false };
      }
    } else {
      this.setState({ workingLabel: 'executing script' });
    }

    const { results, extracted, ok } = await this.executeScript(execId, script);
    const finalStatus: ExecutionStatus = !ok ? 'error' : 'done';
    this.updateMessage(execId, {
      status: finalStatus,
      results,
      extractedPreview: extracted.length > 280 ? extracted.slice(0, 280) + '…' : extracted,
      workingLabel: undefined,
    } as Partial<UIMessage>);

    return {
      result: { status: finalStatus, extracted, results },
      isError: false,
    };
  }

  private async executeScript(execId: string, initialScript: ScriptStep[]): Promise<{ results: StepResult[]; extracted: string; ok: boolean }> {
    let script = [...initialScript];
    let lastSnapshot: SnapshotResult | null = null;
    const extractParts: string[] = [];
    const results: StepResult[] = [];
    let i = 0;
    let recoveryAttempts = 0;

    while (i < script.length && !this.aborted) {
      const step = script[i];
      this.updateMessage(execId, { workingLabel: step.action } as Partial<UIMessage>);

      if ((step.action === 'click' || step.action === 'type') && !lastSnapshot) {
        lastSnapshot = await this.doSnapshotForScript();
        if (!lastSnapshot) {
          results.push({ action: step.action, status: 'error', error: 'snapshot failed before interaction' });
          return { results, extracted: extractParts.join('\n\n'), ok: false };
        }
        continue;
      }

      try {
        if (step.action === 'navigate') {
          const host = hostFromUrl(step.url);
          if (!host) throw new Error('invalid url');
          if (!await isHostAllowed(host)) {
            const ok = await this.waitForPermission(host, `agent wants to navigate to ${host}`);
            if (!ok) throw new Error('permission_denied');
          }
          const tab = await getActiveTab();
          if (!tab?.id) throw new Error('no active tab');
          await navigateTab(tab.id, step.url);
          await new Promise<void>((r) => setTimeout(r, 2000));
          lastSnapshot = null;
          recoveryAttempts = 0;
          results.push({ action: 'navigate', status: 'ok' });
          i++;

        } else if (step.action === 'snapshot') {
          lastSnapshot = await this.doSnapshotForScript();
          if (!lastSnapshot) {
            results.push({ action: 'snapshot', status: 'error', error: 'snapshot failed' });
            return { results, extracted: extractParts.join('\n\n'), ok: false };
          }
          recoveryAttempts = 0;
          results.push({ action: 'snapshot', status: 'ok' });
          i++;

        } else if (step.action === 'click' || step.action === 'type') {
          const selector = resolveTarget(step.target, lastSnapshot!.elements, step.action);
          if (!selector) {
            if (++recoveryAttempts > 3) {
              results.push({ action: step.action, status: 'error', error: `no element matched after recovery: ${step.description ?? JSON.stringify(step.target)}` });
              return { results, extracted: extractParts.join('\n\n'), ok: false };
            }
            const repaired = await this.recoverScript(step, lastSnapshot!, script.slice(i));
            if (!repaired) {
              results.push({ action: step.action, status: 'error', error: `no element matched: ${step.description ?? JSON.stringify(step.target)}` });
              return { results, extracted: extractParts.join('\n\n'), ok: false };
            }
            script = [...script.slice(0, i), ...repaired];
            continue;
          }

          const tab = await getActiveTab();
          if (!tab?.id) throw new Error('no active tab');
          const op = step.action === 'type'
            ? await runContentOp(tab.id, { op: 'type', selector, text: step.text })
            : await runContentOp(tab.id, { op: 'click', selector });

          if (!op.ok) {
            if (++recoveryAttempts > 3) {
              results.push({ action: step.action, status: 'error', error: op.error ?? 'action failed' });
              return { results, extracted: extractParts.join('\n\n'), ok: false };
            }
            const fresh = await this.doSnapshotForScript();
            const repaired = fresh ? await this.recoverScript(step, fresh, script.slice(i)) : null;
            if (!repaired) {
              results.push({ action: step.action, status: 'error', error: op.error ?? 'action failed' });
              return { results, extracted: extractParts.join('\n\n'), ok: false };
            }
            script = [...script.slice(0, i), ...repaired];
            lastSnapshot = fresh;
            continue;
          }

          // Let the page settle — clicks that open dropdowns, menus, or dialogs need a beat
          // before the next snapshot, otherwise the new overlay items aren't in the DOM yet.
          if (step.action === 'click') {
            await new Promise<void>((r) => setTimeout(r, 350));
          }
          results.push({ action: step.action, status: 'ok' });
          lastSnapshot = null;
          recoveryAttempts = 0;
          i++;

        } else if (step.action === 'extract') {
          const tab = await getActiveTab();
          if (tab?.id) {
            const r = await runContentOp(tab.id, { op: 'extract' });
            const data = r.ok && r.data ? (r.data as { text?: string }) : null;
            if (data?.text) extractParts.push(data.text);
            results.push({ action: 'extract', status: r.ok ? 'ok' : 'error', error: !r.ok ? r.error : undefined });
          } else {
            results.push({ action: 'extract', status: 'error', error: 'no active tab' });
          }
          i++;

        } else {
          i++; // skip unknown step types
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'permission_denied') {
          results.push({ action: step.action, status: 'error', error: 'permission denied' });
          return { results, extracted: extractParts.join('\n\n'), ok: false };
        }
        if (++recoveryAttempts > 3) {
          results.push({ action: step.action, status: 'error', error: `threw: ${msg}` });
          return { results, extracted: extractParts.join('\n\n'), ok: false };
        }
        const fresh = await this.doSnapshotForScript();
        const repaired = fresh ? await this.recoverScript(step, fresh, script.slice(i)) : null;
        if (!repaired) {
          results.push({ action: step.action, status: 'error', error: msg });
          return { results, extracted: extractParts.join('\n\n'), ok: false };
        }
        script = [...script.slice(0, i), ...repaired];
        lastSnapshot = fresh;
      }
    }

    return { results, extracted: extractParts.join('\n\n'), ok: true };
  }

  private async doSnapshotForScript(): Promise<SnapshotResult | null> {
    const tab = await getActiveTab();
    if (!tab?.id) return null;
    const r = await runContentOp(tab.id, { op: 'snapshot_structured' });
    if (!r.ok || !r.data) return null;
    return r.data as SnapshotResult;
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

  // Debug: dump the exact payload the orchestrator LLM sees — system prompt, tool schemas,
  // and the raw conversation (text, tool_call args, tool_result outputs, image parts). This is
  // the live in-memory ChatMessage[], not the prettified UI messages. Used by the service-worker
  // console hook (globalThis.dodoExport) to inspect/export a session as JSON.
  exportForLLM(includeImages = true) {
    const messages = includeImages
      ? this.conversation
      : this.conversation.map((m) => ({
          ...m,
          parts: m.parts.map((p) =>
            p.type === 'image' ? { type: 'image_omitted', mimeType: p.mimeType } : p,
          ),
        }));
    return {
      exportedAt: new Date().toISOString(),
      taskId: this.taskId,
      title: this.firstUserText,
      phase: this.state.phase,
      systemPrompt: EXEC_SYSTEM,
      tools: TOOL_SCHEMAS,
      messages,
    };
  }

  private complete() {
    log.info('complete');
    this.setState({ phase: 'complete', workingLabel: undefined });
    notify('dodo · done', 'task complete');
    void this.persistSnapshot('done');
  }

  private fail(msg: string) {
    log.err('fail', msg);
    this.setState({ phase: 'error', errorMsg: msg, workingLabel: undefined });
    this.pushMessage({ id: newId('err'), kind: 'error', text: msg, t: Date.now() });
    notify('dodo · halted', truncate(msg, 140));
    if (this.taskId) void this.persistSnapshot('error');
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
    const obj = JSON.parse(s) as Record<string, unknown>;
    if (Array.isArray(obj.steps) && Array.isArray(obj.script)) {
      return {
        sites: Array.isArray(obj.sites) ? (obj.sites as unknown[]).map(String) : [],
        steps: (obj.steps as unknown[]).map(String),
        script: obj.script as ScriptStep[],
        explanation: typeof obj.explanation === 'string' ? obj.explanation : undefined,
      };
    }
  } catch {}
  return null;
}

function labelFor(name: ToolName, args: Record<string, unknown>): string {
  if (name === 'navigate') return `navigate to ${hostFromUrl(String(args.url ?? '')) || args.url}`;
  if (name === 'screenshot') return 'capture viewport';
  if (name === 'snapshot') return args.element ? `expand ${args.element}` : 'read page DOM';
  if (name === 'click') return `click ${args.selector ?? ''}`;
  if (name === 'type') return `type into ${args.selector ?? ''}`;
  if (name === 'extract') {
    const verb = args.mode === 'text' ? 'read' : 'map';
    return args.selector ? `${verb} ${args.selector}` : `${verb} page`;
  }
  if (name === 'plan_actions') return 'plan actions';
  if (name === 'execute_actions') return 'execute actions';
  return name;
}

function detailFor(name: ToolName, result: unknown): string | undefined {
  if (name === 'extract') {
    const r = result as { text?: string };
    if (r?.text) return `${r.text.length} chars`;
  }
  if (name === 'snapshot') {
    const r = result as { html?: string };
    if (typeof r?.html === 'string') return `${r.html.length} chars`;
  }
  if (name === 'screenshot') return 'jpeg · q70';
  return undefined;
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

export const agent = new Agent();
