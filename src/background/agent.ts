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
import { TOOL_SCHEMAS, getActiveTab, hostFromUrl, navigateTab, captureScreenshot, runContentOp, pinActiveTab, getPinnedTabId, consumePendingNewTab, listTabs, setTabWorking, waitForTabComplete } from './tools';
import { getSettings, upsertHistory, getHistoryItem, addAllowedHost } from './store';
import { isHostAllowed } from './permissions';
import { log } from './log';
import { notify } from './notify';

type Listener = (s: AgentState) => void;

const EXEC_SYSTEM = `You are DODO, an open-source browser agent operating inside the user's Chrome browser. You are in a chat conversation with the user — every turn you receive what they said and what tools have returned, and you respond with either tool calls or a final text answer.

You drive the browser with these tools, one action at a time, inspecting the page between actions. This works for everything: tasks with a UI menu/dropdown/modal/dialog, tasks where the user is already on the right page, and tasks where the next click depends on what just appeared (mail labeling, in-app workflows, login, filters, settings):
  • snapshot() — get the page DOM as HTML. Interactive elements carry a short \`data-sel\` ref token (e.g. data-sel="e42"); pass that ref as the selector to click/type. snapshot() gives a full-page overview (3 levels deep). To read a specific container IN FULL — a dropdown, dialog, table, list, menu — snapshot({element: "e42"}) fully expands just that one (\`element\` is a ref from the latest snapshot), and snapshot({element, n}) expands it n levels. This drill-in is your PRIMARY way to read deep or long content: start with snapshot() for the overview, then snapshot({element}) the part you care about.
  • screenshot() — capture the viewport as a JPEG (layout context, no refs).
  • navigate({url}) — go to a URL. Triggers a host-allowlist prompt if needed.
  • click({selector}) — click an element. Selector must be a \`data-sel\` ref from snapshot(). Returns a diff of what changed in the DOM (appeared/disappeared/aria changes), with fresh refs for anything that appeared.
  • type({selector, text}) — type into an input/textarea/rich-text editor (contentEditable), identified by a \`data-sel\` ref. Returns the resulting \`value\`; if the diff is empty but \`value\` shows your text, it worked — do NOT retry. type() does not submit. For an input/textarea it sets the value; for a contentEditable editor it INSERTS at the cursor (it does not erase existing text). A message/document compose BODY is usually a contentEditable editor, often inside an iframe — extract({mode:"map"}) lists it (it descends into same-origin iframes; the editor appears flagged \`contenteditable\` with its id), so map → type() into that ref. Don't hunt for it with repeated snapshots. Write the WHOLE body in a SINGLE type() call (use \\n for line breaks); composing it across several type()/toolbar-click cycles is unreliable and not worth it — toolbar formatting (bold/lists) does not apply cleanly via clicks.
  • press({key, selector?}) — dispatch a real key press (Enter, Tab, Escape, Backspace, Arrow keys). Use it ONLY when an action needs a keystroke: Enter to COMMIT a typed value that becomes a chip/selection (a recipient/email/tag in a To field, or an autocomplete/combobox/search pick), or Escape to dismiss a menu/dialog. Omit \`selector\` to press on the currently focused element (e.g. right after the type() that needs committing). Do NOT press after typing into a plain text field (subject, body, search-as-you-type, normal forms) — that text is already entered. Do NOT use Tab just to "move to the next field"; locate the target element via snapshot/extract and type() into it directly.
  • extract({selector?, mode?}) — the FALLBACK for what snapshot can't show. Use it only when a snapshot — even after snapshot({element}) on the relevant container — comes back truncated / depth-limited, or the page's DOM snapshot is empty/uninformative (some SPAs render nothing useful into the static DOM). mode="map" (default) flattens the whole page (or a scoped region) to a COMPACT one-line-per-element list of EVERY interactive element with its \`data-sel\` ref + label — use it to enumerate a list/grid/menu/results that snapshot couldn't fully show. mode="text" returns the full readable page text for reading prose/tables/prices. Also use extract({mode:"map"}) to locate a contentEditable compose editor (often inside an iframe; it appears flagged \`contenteditable\` with its id). Prefer snapshot drill-in first.
  • list_tabs() / switch_tab({tabId}) — list the open browser tabs and make a different one active (all later tools target the active tab). You work on ONE tab at a time. When an action you take opens a NEW tab, it becomes active AUTOMATICALLY and the tool result tells you — you don't need switch_tab for that. After switching or following a new tab, snapshot() before acting.

The first message already includes a fresh snapshot of the current page — read it first; you do NOT need to call snapshot() again as your opening move. click() returns a DOM diff, so you usually don't need to snapshot() again just to see what a click did — read the diff. Only re-snapshot when the diff is insufficient or you need fresh \`data-sel\` refs for elements that just appeared. After a navigate (new page), always snapshot() before acting.

RULES:
- To read a long list, table, grid, or menu (inboxes, search results, settings, file lists), FIRST snapshot({element}) the list/table CONTAINER to expand it in full — do NOT drill into rows one-by-one. A top-level snapshot() is depth-limited and may not show the whole list. Only if that expanded snapshot is still truncated or shows "… children omitted …" / "depth limit" do you switch to extract() for the full flat enumeration of every item + ref. snapshot (overview + drill-in) is your default; extract() is the fallback when snapshot can't show everything.
- Do NOT invent refs or selectors. Use a \`data-sel\` ref from the LATEST snapshot (refs from a stale snapshot may no longer resolve). If you don't have one, call snapshot() first. The \`element\` arg of snapshot() is also a ref/selector from the latest snapshot — never make one up.
- Don't call done() — there is no done tool. End your turn with a plain text message and that text IS your answer to the user.
- Format your answer to fit the task. If the user asks for a list, output a list. If they ask a yes/no, answer briefly. If they ask for a table, use markdown. Never compress a list into a count or summary unless explicitly asked.
- When the user asks a follow-up that you can answer from prior turns' extracted text, just answer — don't re-browse.
- If a click/type fails with "no element matches", snapshot again — the page may have changed.
- A typed value that must become a chip/selection (recipient/email/tag in a To/CC field, or an autocomplete/combobox pick) is NOT committed until you press({key:"Enter"}). If such a type() returned a non-empty \`value\` but no chip/result appeared, do NOT retype — press({key:"Enter"}) once to commit. Plain text fields (subject, message body, ordinary form inputs) need NO press — once type() returns your \`value\`, that field is done; move on.
- Use the datetime/location context to produce accurate results.
- Never navigate to a host not in the allowlist without going through the navigate() tool's permission flow.
- Google Sheets (and Google Docs/Slides) render ALL grid/document content as canvas — snapshot() and extract() show only the toolbar chrome, never cell values or document body. BEFORE doing anything else on a Google Sheets page, enable accessibility mode with press({key:"z", modifiers:["Meta","Alt"]}) (⌘⌥Z on Mac). Wait for the DOM to update, then snapshot() — cells will now render as real DOM elements you can read. Sheet tab clicks may silently fail; switch sheets via URL instead: navigate({url: "https://docs.google.com/spreadsheets/d/ID/edit?gid=SHEET_GID#gid=SHEET_GID"}) where the gid is visible in the current URL's #gid= hash.`;

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
  readonly ready: Promise<void>;
  private listeners = new Set<Listener>();
  private aborted = false;
  private resolvePermission: ((allowed: boolean) => void) | null = null;
  private resolveExecution: ((approved: boolean) => void) | null = null;
  private conversation: ChatMessage[] = [];
  // Per-turn record of the exact (post-prune) payload sent to the provider, for dodoExport.
  // The live conversation is the cumulative store; this captures what each request actually carried.
  private requestLog: { turn: number; at: string; model: string; chars: number; messages: ChatMessage[] }[] = [];
  private taskId: string | null = null;
  private firstUserText: string | null = null; // used as the history row title

  constructor() {
    this.ready = this.loadSavedState();
    // Keep the side-panel tab card in sync as the active tab's title/url/favicon change.
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (tabId === getPinnedTabId() && (info.title || info.url || info.favIconUrl || info.status === 'complete')) {
        void this.refreshActiveTab();
      }
    });
  }

  private async loadSavedState(): Promise<void> {
    try {
      const raw = await chrome.storage.local.get(['activeState', 'activeTaskId', 'activeFirstUserText']);
      if (!raw.activeState) return;
      const saved = raw.activeState as AgentState;
      // Re-link to the history row so persistSnapshot keeps writing and the user can continue the task.
      this.taskId = (raw.activeTaskId as string | undefined) ?? null;
      this.firstUserText = (raw.activeFirstUserText as string | undefined) ?? null;
      if (this.taskId) {
        const item = await getHistoryItem(this.taskId);
        if (item?.conversation) this.conversation = deserializeConversation(item.conversation);
      }
      if (saved.phase === 'working' || saved.phase === 'awaiting_approval' || saved.phase === 'awaiting_permission') {
        this.state = {
          ...saved,
          phase: 'error',
          errorMsg: 'Session interrupted — the extension was reloaded. You can retry or start a new task.',
          workingLabel: undefined,
          pendingExecution: undefined,
          pendingPermission: undefined,
        };
      } else {
        this.state = saved;
      }
      // activeState was persisted with tool results stripped — re-attach them from the conversation
      // so the restored cards show their responses (same rehydration openHistory does).
      if (Array.isArray(this.state.messages)) {
        this.state = { ...this.state, messages: this.rehydrateToolResults(this.state.messages) };
      }
    } catch {}
  }

  // Re-attach each tool_activity row's `result` (stripped on persist to save space) from the live
  // conversation, matched by LLM tool-call id. Used by both reload-restore and reopen-from-history.
  private rehydrateToolResults(messages: UIMessage[]): UIMessage[] {
    const resultById = new Map<string, unknown>();
    for (const m of this.conversation) {
      if (m.role !== 'tool') continue;
      for (const p of m.parts) {
        if (p.type === 'tool_result') resultById.set(p.id, p.result);
      }
    }
    return messages.map((m) =>
      m.kind === 'tool_activity' && m.callId && resultById.has(m.callId)
        ? ({ ...m, result: resultById.get(m.callId) } as UIMessage)
        : m,
    );
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  private emit() {
    void this.persistActiveState();
    for (const l of this.listeners) l(this.state);
  }

  // Mirror the live state to storage so a service-worker reload can restore the current view.
  // Returns the write promise: terminal handlers (complete/fail/stop) await it so the final state
  // is durable before the worker suspends — a bare fire-and-forget write there can be dropped,
  // leaving storage stuck on a stale mid-loop snapshot.
  private persistActiveState(): Promise<void> {
    const stripped = {
      ...this.state,
      messages: this.state.messages.map((m) =>
        m.kind === 'tool_activity' ? { ...m, result: undefined, thumb: undefined } : m,
      ),
    };
    // The backing ids ride along so the restored session can re-link to its history row
    // (the full conversation is rehydrated from there).
    return chrome.storage.local.set({
      activeState: stripped,
      activeTaskId: this.taskId,
      activeFirstUserText: this.firstUserText,
    });
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
        await setTabWorking(tab.id, true);
        await this.refreshActiveTab();
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
  async stop() {
    log.info('stop');
    this.aborted = true;
    if (this.resolvePermission) { this.resolvePermission(false); this.resolvePermission = null; }
    if (this.resolveExecution) { this.resolveExecution(false); this.resolveExecution = null; }
    const wasRunning = this.taskId
      && this.state.phase !== 'idle' && this.state.phase !== 'complete' && this.state.phase !== 'error';
    await setTabWorking(getPinnedTabId(), false); // await — see complete()
    this.setState({
      phase: 'complete',
      workingLabel: undefined,
      pendingPermission: undefined,
      pendingExecution: undefined,
    });
    await this.persistActiveState();
    if (wasRunning) await this.persistSnapshot('stopped');
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
    this.requestLog = [];
    this.taskId = null;
    this.firstUserText = null;
    if (this.resolvePermission) { this.resolvePermission(false); this.resolvePermission = null; }
    if (this.resolveExecution) { this.resolveExecution(false); this.resolveExecution = null; }
    void setTabWorking(getPinnedTabId(), false);
    pinActiveTab(null);
    this.state = { ...INITIAL_AGENT_STATE };
    void chrome.storage.local.remove(['activeState', 'activeTaskId', 'activeFirstUserText']);
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
    restored.messages = this.rehydrateToolResults(restored.messages);
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
    // Don't treat a denial as an error — halt the run and leave the conversation alive (phase
    // 'complete') so the user can redirect with a follow-up message. stop() resolves the pending
    // permission promise (false), sets `aborted` so the loop exits, and persists.
    await this.stop();
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
    let tokensIn = 0;
    let tokensOut = 0;
    let llmTurns = 0;
    const loopStartedAt = Date.now();
    for (let turn = 0; turn < 200 && !this.aborted; turn++) {
      this.setState({ workingLabel: 'thinking' });
      const sentMessages = pruneStaleToolResults(this.conversation);
      const chars = logChatRequest(turn, settings.model, sentMessages);
      this.requestLog.push({ turn, at: new Date().toISOString(), model: settings.model, chars, messages: sentMessages });
      if (this.requestLog.length > 100) this.requestLog.shift();
      let res;
      try {
        res = await provider.chat({
          apiKey: settings.apiKey,
          model: settings.model,
          systemPrompt: EXEC_SYSTEM,
          messages: sentMessages,
          tools: TOOL_SCHEMAS,
        });
      } catch (e) {
        log.err('chat failed', e);
        return this.fail(e instanceof Error ? e.message : String(e));
      }

      if (this.aborted) return;
      llmTurns++;
      if (res.usage) { tokensIn += res.usage.input; tokensOut += res.usage.output; }

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
        this.pushMessage({
          id: newId('msg'), kind: 'assistant', text,
          tokensIn: tokensIn || undefined,
          tokensOut: tokensOut || undefined,
          turns: llmTurns,
          elapsed: Date.now() - loopStartedAt,
          t: Date.now(),
        });
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

    if (!this.aborted) await this.fail('exceeded max turns');
  }

  private async dispatchToolCall(
    name: ToolName,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<{ result: unknown; isError: boolean; screenshotBase64?: string }> {
    // generate_file creates a file_artifact UIMessage; no tool_activity row.
    if (name === 'generate_file') {
      const filename = String(args.filename ?? 'file.txt');
      const content  = String(args.content  ?? '');
      this.pushMessage({ id: newId('file'), kind: 'file_artifact', filename, content, t: Date.now() });
      return { result: { ok: true, filename }, isError: false };
    }

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
    // Browser-level tab tools — they don't act on a page, so handle them before the active-tab gate.
    if (name === 'list_tabs') {
      return { tabs: await listTabs() };
    }
    if (name === 'switch_tab') {
      const tabId = Number(args.tabId);
      const target = await chrome.tabs.get(tabId).catch(() => null);
      if (!target || target.id == null) throw new Error(`no tab with id ${args.tabId}`);
      const prev = getPinnedTabId();
      if (prev != null && prev !== target.id) await setTabWorking(prev, false);
      pinActiveTab(target.id);
      await chrome.tabs.update(target.id, { active: true }).catch(() => undefined);
      if (target.windowId != null) await chrome.windows.update(target.windowId, { focused: true }).catch(() => undefined);
      await setTabWorking(target.id, true);
      await this.refreshActiveTab();
      return { ok: true, tabId: target.id, title: target.title, url: target.url, note: 'switched — snapshot() before acting' };
    }

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
      // The reload wiped the content script (and the working-title prefix) — re-apply it.
      await setTabWorking(tab.id, true);
      await this.refreshActiveTab();
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
      return this.maybeFollowNewTab(r.data);
    }
    if (name === 'type') {
      const r = await runContentOp(tab.id, { op: 'type', selector: String(args.selector ?? ''), text: String(args.text ?? ''), perChar: Boolean(args.perChar) });
      if (!r.ok) throw new Error(r.error);
      return this.maybeFollowNewTab(r.data);
    }
    if (name === 'press') {
      const r = await runContentOp(tab.id, {
        op: 'press',
        key: String(args.key ?? ''),
        selector: args.selector ? String(args.selector) : undefined,
        modifiers: Array.isArray(args.modifiers) ? args.modifiers : undefined,
      });
      if (!r.ok) throw new Error(r.error);
      return this.maybeFollowNewTab(r.data);
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

  // If the action just opened a new tab, make it the active tab and tell the model about it.
  private async maybeFollowNewTab(data: unknown): Promise<unknown> {
    const newTabId = consumePendingNewTab();
    if (newTabId == null) return data;
    const tab = await this.followNewTab(newTabId);
    const note = tab
      ? `A new tab opened and is now the active tab: ${tab.title || '(untitled)'} (${tab.url || ''}). Subsequent tools target it; snapshot() before acting.`
      : 'A new tab opened and is now the active tab. snapshot() before acting.';
    return (data && typeof data === 'object') ? { ...(data as object), note } : { result: data, note };
  }

  private async followNewTab(tabId: number): Promise<chrome.tabs.Tab | null> {
    await waitForTabComplete(tabId);
    const prev = getPinnedTabId();
    if (prev != null && prev !== tabId) await setTabWorking(prev, false);
    pinActiveTab(tabId);
    await setTabWorking(tabId, true);
    await this.refreshActiveTab();
    return chrome.tabs.get(tabId).catch(() => null);
  }

  // Mirror the active tab's title/url/favicon into AgentState for the side-panel tab card.
  private async refreshActiveTab(): Promise<void> {
    const id = getPinnedTabId();
    if (id == null) { this.setState({ activeTab: undefined }); return; }
    const t = await chrome.tabs.get(id).catch(() => null);
    if (t?.id != null) {
      this.setState({ activeTab: { id: t.id, title: t.title ?? '', url: t.url ?? '', favIconUrl: t.favIconUrl } });
    }
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
    const stripImages = (msgs: ChatMessage[]) =>
      msgs.map((m) => ({
        ...m,
        parts: m.parts.map((p) =>
          p.type === 'image' ? { type: 'image_omitted', mimeType: p.mimeType } : p,
        ),
      }));
    const messages = includeImages ? this.conversation : stripImages(this.conversation);
    // `messages` is the cumulative store (unpruned). `requests` is the per-turn record of what was
    // actually sent each turn — already pruned — so you can verify the real wire payload over time.
    const requests = this.requestLog.map((r) => ({
      turn: r.turn,
      at: r.at,
      model: r.model,
      chars: r.chars,
      msgCount: r.messages.length,
      messages: includeImages ? r.messages : stripImages(r.messages),
    }));
    return {
      exportedAt: new Date().toISOString(),
      taskId: this.taskId,
      title: this.firstUserText,
      phase: this.state.phase,
      systemPrompt: EXEC_SYSTEM,
      tools: TOOL_SCHEMAS,
      messages,
      requests,
    };
  }

  private async complete() {
    log.info('complete');
    // Await so the MV3 service worker stays alive until the content script has cleared the working
    // indicator + faded the on-page cursor overlay; a fire-and-forget `void` here can be dropped if
    // the worker suspends right after the run ends (the overlay would then never hide).
    await setTabWorking(getPinnedTabId(), false);
    this.setState({ phase: 'complete', workingLabel: undefined });
    notify('dodo · done', 'task complete');
    // Await both writes so the completed state (incl. the assistant message) is durable before the
    // worker can suspend — otherwise a reload restores a stale mid-loop snapshot shown as "halted".
    await Promise.all([this.persistActiveState(), this.persistSnapshot('done')]);
  }

  private async fail(msg: string) {
    log.err('fail', msg);
    await setTabWorking(getPinnedTabId(), false); // await — see complete()
    // Render the error solely through the phase:'error' ErrorBanner ("halted" + retry) in Chat.tsx.
    // Don't also pushMessage a kind:'error' entry — that produced a duplicate red box above the banner.
    this.setState({ phase: 'error', errorMsg: msg, workingLabel: undefined });
    notify('dodo · halted', truncate(msg, 140));
    await this.persistActiveState();
    if (this.taskId) await this.persistSnapshot('error');
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
  if (name === 'press') {
    const mods = Array.isArray(args.modifiers) && args.modifiers.length > 0
      ? args.modifiers.map((m: string) => m === 'Meta' ? 'Cmd' : m).join('+') + '+'
      : '';
    return `press ${mods}${args.key ?? ''}`;
  }
  if (name === 'extract') {
    const verb = args.mode === 'text' ? 'read' : 'map';
    return args.selector ? `${verb} ${args.selector}` : `${verb} page`;
  }
  if (name === 'list_tabs') return 'list tabs';
  if (name === 'switch_tab') return `switch to tab ${args.tabId ?? ''}`;
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

// snapshot/extract results pile up in the conversation and get re-sent every turn, but a stale
// one is dead weight — its `data-sel` refs no longer resolve once the page changes (the system
// prompt says as much). Keep the most recent few live and replace older ones with a short stub.
// Pure: returns a shallow copy, never mutates the stored conversation (the UI rehydrates from it).
const LIVE_PAGE_RESULTS = 2;
const SUPERSEDED_STUB =
  '[superseded snapshot — the page has since changed; call snapshot()/extract() again for the current DOM and fresh refs]';

// Log exactly what's being sent to the provider each turn: a collapsed group with one line per
// message (role · part kinds · sizes · previews) plus the raw payload object for expansion in
// the service-worker devtools console. `messages` here is the post-prune payload, not the store.
function logChatRequest(turn: number, model: string, messages: ChatMessage[]): number {
  const preview = (s: string, n = 80) => s.replace(/\s+/g, ' ').trim().slice(0, n);
  const size = (v: unknown) => (typeof v === 'string' ? v.length : JSON.stringify(v ?? '').length);
  let totalChars = 0;
  const lines = messages.map((m, i) => {
    const parts = m.parts.map((p) => {
      switch (p.type) {
        case 'text': totalChars += p.text.length; return `text(${p.text.length}) "${preview(p.text)}"`;
        case 'image': return `image(${p.mimeType})`;
        case 'tool_call': return `call ${p.name}(${preview(JSON.stringify(p.args ?? {}), 60)})`;
        case 'tool_result': { const n = size(p.result); totalChars += n; return `result ${p.name}${p.isError ? '!' : ''}(${n})`; }
      }
    });
    return `#${i} ${m.role}: ${parts.join(', ')}`;
  });
  log.group(`turn ${turn} → chat · ${model} · ${messages.length} msgs · ~${totalChars} chars`);
  for (const l of lines) log.info(l);
  log.info('payload', { systemPrompt: EXEC_SYSTEM, messages });
  log.groupEnd();
  return totalChars;
}

function pruneStaleToolResults(messages: ChatMessage[]): ChatMessage[] {
  let kept = 0;
  // Walk newest→oldest so the most recent snapshot/extract results stay intact.
  const pruned = messages
    .slice()
    .reverse()
    .map((m) => {
      let changed = false;
      const parts = m.parts.map((p) => {
        if (p.type === 'tool_result' && !p.isError && (p.name === 'snapshot' || p.name === 'extract')) {
          if (kept < LIVE_PAGE_RESULTS) {
            kept++;
            return p;
          }
          changed = true;
          return { ...p, result: SUPERSEDED_STUB };
        }
        return p;
      });
      return changed ? { ...m, parts } : m;
    })
    .reverse();
  return pruned;
}

function serializeConversation(messages: ChatMessage[]): SavedConversationMessage[] {
  // Snapshot/extract results are the bulk of conversation size and their refs are stale on restore
  // anyway — collapse all but the most recent few to a stub so saved history stays small. (Without
  // this, full page DOM × every turn × up to HISTORY_MAX rows blows the storage quota.)
  return pruneStaleToolResults(messages).map((m) => ({
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
