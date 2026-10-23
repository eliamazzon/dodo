// Chat-loop agent. Single LLM orchestrator drives the conversation; it invokes browser tools
// (snapshot/screenshot/navigate/click/type/extract) one at a time, inspecting the page between
// actions. snapshot() returns the page as HTML (interactive elements carry a `data-sel` the model
// passes to click/type); click() returns a diff of what changed. The final assistant text is the
// answer — no forced summary tool.
// Plan mode is the read-only variant: it browses (navigate/follow_link/switch_tab) but never acts,
// and ends with propose_plan. Approving a plan re-runs the loop in an act mode; repetitive work can
// go through execute_actions (a deterministic script with foreach).
import type {
  AgentState, HistoryItem, HistoryStatus, SavedConversationMessage, SavedConversationPart,
  ScriptStep, FlatScriptStep, SnapshotElement, SnapshotResult, HtmlSnapshotResult, ScriptTarget,
  UIMessage, ToolName, StepResult, ExecutionStatus, AllowlistEntry, PermissionScope, PermissionDuration, Mode, Settings,
  AccessLevel, CriticalAction, PlanBulk, PlanStepStatus,
} from '../shared/types';
import { INITIAL_AGENT_STATE } from '../shared/types';
import type { ChatMessage, ContentPart } from './providers/types';
import type { ContentOp } from '../shared/messages';
import { domainPatternOf } from '../shared/permissions';
import { getProvider } from './providers';
import { TOOL_SCHEMAS, getActiveTab, hostFromUrl, navigateTab, captureScreenshot, runContentOp, pinActiveTab, getPinnedTabId, consumePendingNewTab, listTabs, setTabWorking, waitForTabComplete, armPopupWatch } from './tools';
import { getSettings, saveSettings, upsertHistory, getHistoryItem, addAllowEntry, matchesAllowlist, pageKeyFromUrl } from './store';
import { isAllowed, isUserAllowed } from './permissions';
import { log } from './log';
import { notify } from './notify';

type Listener = (s: AgentState) => void;

const EXEC_SYSTEM = `You are DODO, an open-source browser agent operating inside the user's Chrome browser. You are in a chat conversation with the user — every turn you receive what they said and what tools have returned, and you respond with either tool calls or a final text answer.

You drive the browser with these tools, one action at a time, inspecting the page between actions. This works for everything: tasks with a UI menu/dropdown/modal/dialog, tasks where the user is already on the right page, and tasks where the next click depends on what just appeared (mail labeling, in-app workflows, login, filters, settings):
  • snapshot() — get the page DOM as HTML. Interactive elements carry a short \`data-sel\` ref token (e.g. data-sel="e42"); pass that ref as the selector to click/type. snapshot() gives a full-page overview (3 levels deep). To read a specific container IN FULL — a dropdown, dialog, table, list, menu — snapshot({element: "e42"}) fully expands just that one (\`element\` is a ref from the latest snapshot), and snapshot({element, n}) expands it n levels. This drill-in is your PRIMARY way to read deep or long content: start with snapshot() for the overview, then snapshot({element}) the part you care about.
  • screenshot() — capture the viewport as a JPEG (layout context, no refs).
  • navigate({url}) — go to a URL. Triggers a host-allowlist prompt if needed.
  • follow_link({selector, newTab?}) — open a plain link (<a href>) by its URL instead of clicking it. Prefer it over click() for ordinary links; use click() for buttons and JS-driven items.
  • click({selector}) — click an element. Selector must be a \`data-sel\` ref from snapshot(). Returns a diff of what changed in the DOM (appeared/disappeared/aria changes), with fresh refs for anything that appeared.
  • type({selector, text}) — type into an input/textarea/rich-text editor (contentEditable), identified by a \`data-sel\` ref. Returns the resulting \`value\`; if the diff is empty but \`value\` shows your text, it worked — do NOT retry. type() does not submit. For an input/textarea it sets the value; for a contentEditable editor it INSERTS at the cursor (it does not erase existing text). A message/document compose BODY is usually a contentEditable editor, often inside an iframe — extract({mode:"map"}) lists it (it descends into same-origin iframes; the editor appears flagged \`contenteditable\` with its id), so map → type() into that ref. Don't hunt for it with repeated snapshots. Write the WHOLE body in a SINGLE type() call (use \\n for line breaks); composing it across several type()/toolbar-click cycles is unreliable and not worth it — toolbar formatting (bold/lists) does not apply cleanly via clicks.
  • press({key, selector?}) — dispatch a real key press (Enter, Tab, Escape, Backspace, Arrow keys). Use it ONLY when an action needs a keystroke: Enter to COMMIT a typed value that becomes a chip/selection (a recipient/email/tag in a To field, or an autocomplete/combobox/search pick), or Escape to dismiss a menu/dialog. Omit \`selector\` to press on the currently focused element (e.g. right after the type() that needs committing). Do NOT press after typing into a plain text field (subject, body, search-as-you-type, normal forms) — that text is already entered. Do NOT use Tab just to "move to the next field"; locate the target element via snapshot/extract and type() into it directly.
  • extract({selector?, mode?}) — the FALLBACK for what snapshot can't show. Use it only when a snapshot — even after snapshot({element}) on the relevant container — comes back truncated / depth-limited, or the page's DOM snapshot is empty/uninformative (some SPAs render nothing useful into the static DOM). mode="map" (default) flattens the whole page (or a scoped region) to a COMPACT one-line-per-element list of EVERY interactive element with its \`data-sel\` ref + label — use it to enumerate a list/grid/menu/results that snapshot couldn't fully show. mode="text" returns the full readable page text for reading prose/tables/prices. Also use extract({mode:"map"}) to locate a contentEditable compose editor (often inside an iframe; it appears flagged \`contenteditable\` with its id). Prefer snapshot drill-in first.
  • list_tabs() / switch_tab({tabId}) — list the open browser tabs and make a different one active (all later tools target the active tab). You work on ONE tab at a time. When an action you take opens a NEW tab, it becomes active AUTOMATICALLY and the tool result tells you — you don't need switch_tab for that. After switching or following a new tab, snapshot() before acting.
  • execute_actions({script}) — BULK actions: run a deterministic script, with {action:"foreach",items,steps} to repeat a sequence over a known list of items (roughly 5+ items: label/archive/move many emails, fill many rows, open many results). First do the sequence ONCE by hand with the granular tools to learn the exact visible labels, then script the rest. Script targets are visible properties (text/aria/placeholder/role/type) — never data-sel refs. If it fails partway, the result names the failing item; continue from there.
  • update_plan({step, status}) — when executing an APPROVED PLAN (the message says so), mark each plan step done/skipped/failed right after finishing it, so the user sees progress.

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

// The only tools plan mode may run — reading and moving between pages, never acting on them.
const PLAN_MODE_TOOLS = new Set<ToolName>([
  'snapshot', 'screenshot', 'extract', 'list_tabs', 'switch_tab', 'navigate', 'follow_link', 'generate_file', 'propose_plan',
]);

// Tools that change the page — they need 'act' access on it. Everything else that touches a page
// (snapshot/extract/screenshot/navigate/follow_link) needs only 'read'.
const ACT_TOOLS = new Set<ToolName>(['click', 'type', 'press']);

// Human-readable mode names, shown to the model (and user) when the permission mode changes mid-chat.
const MODE_LABEL: Record<Mode, string> = {
  ask: 'ask before acting',
  auto: 'act on allowlist',
  plan: 'read & plan (read-only)',
};

// A URL whose mere GET plausibly changes state (log out, unsubscribe, delete…). Plan mode refuses to
// open one; act modes ask the user to confirm first. Matched against WHOLE path segments (minus a file
// extension) and query keys/values — so /account/logout.php or ?action=delete match, but an article
// slug like /wiki/Logout_(computing) or /how-to-remove-stains doesn't.
const SIDE_EFFECT_WORD = /^(log-?out|log_out|sign-?out|sign_out|unsubscribe|delete|destroy|remove|confirm|approve)$/i;

function sideEffectPath(url: string): boolean {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').map((s) => s.replace(/\.\w{2,5}$/, ''));
    const query = [...u.searchParams].flatMap(([k, v]) => [k, v]);
    return [...segments, ...query].some((t) => SIDE_EFFECT_WORD.test(t));
  } catch {
    return false;
  }
}

// Plan-mode system prompt: the model can read and browse (navigate, follow links, switch tabs) but
// click/type/press/execute_actions are refused at dispatch. Anything that needs acting ends in
// propose_plan, which the user approves before an act-mode run executes it.
const PLAN_MODE_SYSTEM = `You are DODO, an open-source browser agent operating inside the user's Chrome browser. You are currently in READ & PLAN MODE — read-only. You can read pages and move between them, but you must NOT change anything: no clicking, typing, or key presses. Those tools will be rejected.

Your tools:
  • snapshot() — get the page DOM as HTML. Interactive elements carry a short \`data-sel\` ref token. snapshot() gives a full-page overview (3 levels deep); snapshot({element}) fully expands one container (dropdown, dialog, table, list) — your PRIMARY way to read deep/long content. snapshot({element, n}) expands n levels.
  • screenshot() — capture the viewport as a JPEG (layout context).
  • extract({selector?, mode?}) — the FALLBACK when snapshot is truncated or the DOM is empty/uninformative. mode="map" (default) flattens the page (or a scoped region) to a compact one-line-per-element list; mode="text" returns the full readable page text for prose/tables/prices.
  • navigate({url}) — go to a URL. The user is asked for read access to sites you haven't been allowed to read.
  • follow_link({selector, newTab?}) — open a link (<a href>) by its URL, without clicking. This is how you browse: use refs of links from the latest snapshot. Buttons and JS-driven items can't be followed — note them in your plan instead.
  • list_tabs() / switch_tab({tabId}) — list open tabs and make another one the active tab.
  • generate_file({filename, content}) — package extracted data into a downloadable .csv/.json/.md file.
  • propose_plan({goal, sites, steps, bulk?}) — present an action plan for the user to approve. This ENDS your turn.

The first message already includes a fresh snapshot of the current page — read it first. After navigate/follow_link/switch_tab, snapshot() before reading.

RULES:
- If the user asks a QUESTION (about this page or something you can find by browsing), answer it directly in text. Format your answer to fit the task (list → list, yes/no → brief, table → markdown). Never compress a list into a count unless asked.
- If the task needs ACTIONS (clicking, filling forms, sending, buying, labeling, deleting…), do not attempt them. Explore just enough to make a concrete plan: find the right pages/URLs, the exact visible labels of the buttons, menus and fields involved, and — for repetitive work — the full list of items. Then call propose_plan ONCE and stop.
- Plan steps are concrete and imperative: each names the site/page and the exact element labels ("in gmail, open the 'Promotions' tab", "click 'Label as' and pick 'news'"). Don't pad with snapshot/read steps.
- \`sites\` = every host the plan will act on (e.g. "mail.google.com"). Approving the plan grants act access on exactly these for the run.
- For repetitive work over many items, put the per-item action in \`bulk\` with the complete item list (it may be executed as a script).
- If the user replies with changes to a plan, explore further if needed and call propose_plan again with the revised plan.
- Never follow links that log out, unsubscribe, delete, or confirm something — they are refused.
- Use the datetime/location context to produce accurate results.`;

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
  private resolveCritical: ((confirmed: boolean) => void) | null = null;
  // In-memory permission grants that last only for the CURRENT run (cleared when control returns to
  // the user — see complete/fail/stop/reset). Same match semantics as the persisted allowlist.
  private sessionGrants: AllowlistEntry[] = [];
  // An "allow once" grant: covers the host it was given for until the agent next moves (navigate,
  // follow_link, tab switch/follow) or the run ends — so a once-approved navigation isn't followed by
  // a second prompt for the snapshot of the very page it just opened.
  private onceGrant: { host: string; access: AccessLevel } | null = null;
  private conversation: ChatMessage[] = [];
  // Per-turn record of the exact (post-prune) payload sent to the provider, for dodoExport.
  // The live conversation is the cumulative store; this captures what each request actually carried.
  private requestLog: { turn: number; at: string; model: string; chars: number; messages: ChatMessage[] }[] = [];
  private taskId: string | null = null;
  private firstUserText: string | null = null; // used as the history row title
  private lastSystemPrompt: string = EXEC_SYSTEM; // the prompt the most recent run used (EXEC or PLAN_MODE) — for dodoExport
  private lastMode: Mode | null = null; // the mode the previous message ran under — to flag mid-chat mode switches
  private runSettings: Settings | null = null; // settings snapshot for the current run — avoids a getSettings() round-trip per tool dispatch
  private planning = false; // true for the duration of a plan-mode run — enforced at dispatch, not just via the system prompt

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
      if (saved.phase === 'working' || saved.phase === 'awaiting_approval' || saved.phase === 'awaiting_permission' || saved.phase === 'awaiting_critical') {
        this.state = {
          ...saved,
          phase: 'error',
          errorMsg: 'Session interrupted — the extension was reloaded. You can retry or start a new task.',
          workingLabel: undefined,
          pendingExecution: undefined,
          pendingPermission: undefined,
          pendingCritical: undefined,
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

  // A mid-loop 'running' write racing behind a stop()/fail() write (e.g. dispatchToolCall's
  // `finally` firing after denyPermission()'s stop() already marked the row 'stopped') would
  // otherwise clobber the terminal status back to 'running' with no endedAt — the row then shows
  // as running forever in History. Once the run has actually ended, 'running' writes are no-ops.
  //
  // Every 'running' call site is fire-and-forget (`void this.persistSnapshot('running')`), so it's
  // safe to coalesce a burst of them (one per tool call/turn) into a single write ~400ms later
  // instead of hitting IndexedDB on every action. Terminal statuses cancel any pending debounced
  // write and persist immediately — completion is never lost behind a pending timer.
  private persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private async persistSnapshot(status: HistoryStatus): Promise<void> {
    if (!this.taskId || !this.firstUserText) return;
    if (status === 'running' && (this.aborted || this.state.phase === 'complete' || this.state.phase === 'error')) return;
    if (status === 'running') {
      if (this.persistDebounceTimer) clearTimeout(this.persistDebounceTimer);
      this.persistDebounceTimer = setTimeout(() => {
        this.persistDebounceTimer = null;
        void this.writeSnapshot('running');
      }, 400);
      return;
    }
    if (this.persistDebounceTimer) { clearTimeout(this.persistDebounceTimer); this.persistDebounceTimer = null; }
    await this.writeSnapshot(status);
  }

  private async writeSnapshot(status: HistoryStatus): Promise<void> {
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

  private isIdle(): boolean {
    return this.state.phase === 'idle' || this.state.phase === 'complete' || this.state.phase === 'error';
  }

  async sendMessage(text: string) {
    if (!text.trim()) return;
    if (!this.isIdle()) {
      log.warn('sendMessage ignored — agent busy', this.state.phase);
      return;
    }
    log.info('user message', { text, hasConversation: this.conversation.length > 0 });

    // Flag a mid-chat permission-mode switch to the MODEL ONLY (invisible to the user): if the user
    // changed the mode since the previous message, the LLM context for this message gets a banner so
    // the model knows the rules just changed. Skipped on the first message — no prior mode to compare.
    const mode = (await getSettings()).defaultMode;
    const modeChanged = this.lastMode !== null && this.lastMode !== mode;
    this.lastMode = mode;
    const banner = modeChanged
      ? `[MODE CHANGED] The user just switched to "${MODE_LABEL[mode]}" mode${mode === 'plan' ? ' — you are now read-only: you may browse, but must not click/type/press; propose a plan for anything that needs acting' : ''}. This applies to this and following messages.`
      : '';
    await this.startRun(text, text, banner);
  }

  // Shared start of a run (a user message, or an approved plan): records the user turn — `uiText` in
  // the chat, `taskText` + page context for the model — pins the tab on the first turn, and runs the loop.
  private async startRun(uiText: string, taskText: string, banner: string) {
    this.aborted = false;

    if (!this.taskId) {
      this.taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      this.firstUserText = uiText;
      this.setState({ startedAt: Date.now() });
    }

    // Build context block — page snapshot, datetime, location. Reused on first turn and follow-ups.
    const enriched = await this.buildUserContext(taskText, banner);
    this.conversation.push({ role: 'user', parts: [{ type: 'text', text: enriched }] });
    this.pushMessage({ id: newId('msg'), kind: 'user', text: uiText, t: Date.now() });

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

  private async buildUserContext(text: string, banner: string): Promise<string> {
    const tab = await getActiveTab().catch(() => null);
    const datetime = new Date().toISOString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const location = this.conversation.length === 0 ? await getApproxLocation() : '';

    let pageContext = '(no snapshot available)';
    if (tab?.id != null && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      // This context snapshot runs before any tool call, so it would otherwise bypass the
      // allowlist/permission gate entirely — every subsequent read (snapshot/extract) IS gated
      // (see the currentHost check in dispatchGranular), but the very first page view wasn't. Skip
      // it for a non-allowlisted host rather than shipping its DOM to the LLM before permission has
      // been granted; the agent will prompt for permission as soon as it needs to act on the page.
      const host = hostFromUrl(tab.url);
      const allowed = !host || this.hasRunGrant(tab.url, host, 'read') || await isAllowed(tab.url, 'read');
      if (!allowed) {
        pageContext = `(page not snapshotted — ${host} is not in the allowlist yet; permission will be requested before the agent reads or acts on it)`;
      } else {
        try {
          const snap = await runContentOp(tab.id, { op: 'snapshot' });
          if (snap.ok && snap.data) {
            const data = snap.data as HtmlSnapshotResult;
            pageContext = `URL: ${data.url}\nTitle: ${data.title}\n\n${data.html}`;
          }
        } catch { /* best-effort */ }
      }
    }

    const header = this.conversation.length === 0 ? 'TASK' : 'FOLLOW-UP';
    const modeBanner = banner ? `${banner}\n\n` : '';
    return `${modeBanner}${header}: ${text}\n\nCURRENT PAGE:\n${pageContext}\n\nCONTEXT:\nDatetime: ${datetime}\nTimezone: ${timezone}${location ? `\nLocation: ${location}` : ''}`;
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

  // Run an approved plan: switch to the chosen act mode, grant act access on the plan's sites for this
  // run (session grants are cleared when it ends), and hand the plan to the model as the next turn.
  async approvePlan(messageId: string, mode: Exclude<Mode, 'plan'>) {
    const plan = this.state.messages.find((m) => m.id === messageId);
    if (!this.isIdle() || plan?.kind !== 'plan_proposal' || plan.status !== 'pending') {
      log.warn('approvePlan ignored — no matching pending plan', this.state.phase);
      return;
    }
    log.info('approvePlan', { messageId, mode, sites: plan.sites });
    await saveSettings({ defaultMode: mode });
    this.updateMessage(messageId, {
      status: 'approved',
      stepStatus: plan.steps.map((): PlanStepStatus => 'todo'),
    } as Partial<UIMessage>);
    for (const site of plan.sites ?? []) {
      const pattern = domainPatternOf(site);
      if (!this.sessionGrants.some((e) => e.pattern === pattern && e.scope === 'domain' && e.access === 'act')) {
        this.sessionGrants.push({ pattern, scope: 'domain', access: 'act' });
      }
    }
    this.lastMode = mode;
    const sites = plan.sites?.length ? plan.sites.join(', ') : '(none listed)';
    const banner = `[PLAN APPROVED — mode "${MODE_LABEL[mode]}"] The user approved your plan. You are no longer in plan mode: you may now act (click/type/press/execute_actions). You have act access on: ${sites}. Other sites will prompt the user.`;
    await this.startRun('▶ run approved plan', `Execute the approved plan now.\n${formatPlan(plan.goal, plan.steps, plan.bulk)}\nCall update_plan({step, status}) right after finishing each step.`, banner);
  }

  async rejectPlan(messageId: string) {
    const plan = this.state.messages.find((m) => m.id === messageId);
    if (plan?.kind !== 'plan_proposal' || plan.status !== 'pending') return;
    this.updateMessage(messageId, { status: 'rejected' } as Partial<UIMessage>);
    // Model-only note so the next turn knows the plan was turned down (Gemini folds it into the next
    // user message — see toGeminiContents).
    this.conversation.push({ role: 'user', parts: [{ type: 'text', text: '[the user rejected the proposed plan — do not execute it]' }] });
    void this.persistSnapshot(this.state.phase === 'error' ? 'error' : 'done');
  }

  // Grants that live only for the current run: session grants, plus the narrower "allow once" grant.
  private hasRunGrant(url: string, host: string, need: AccessLevel): boolean {
    if (matchesAllowlist(url, host, this.sessionGrants, need)) return true;
    const once = this.onceGrant;
    return !!once && once.host === host && (need === 'read' || once.access === 'act');
  }

  private clearRunGrants() {
    this.sessionGrants = [];
    this.onceGrant = null;
  }

  // Halt the current step but keep the conversation alive so the user can follow up.
  // For a full wipe (new chat), call reset() — bound to the panel's "new task" button.
  async stop() {
    log.info('stop');
    this.aborted = true;
    if (this.resolvePermission) { this.resolvePermission(false); this.resolvePermission = null; }
    if (this.resolveExecution) { this.resolveExecution(false); this.resolveExecution = null; }
    if (this.resolveCritical) { this.resolveCritical(false); this.resolveCritical = null; }
    this.clearRunGrants(); // run is ending — session grants don't outlive it
    const wasRunning = this.taskId
      && this.state.phase !== 'idle' && this.state.phase !== 'complete' && this.state.phase !== 'error';
    await setTabWorking(getPinnedTabId(), false); // await — see complete()
    this.setState({
      phase: 'complete',
      workingLabel: undefined,
      pendingPermission: undefined,
      pendingExecution: undefined,
      pendingCritical: undefined,
    });
    await this.persistActiveState();
    if (wasRunning) await this.persistSnapshot('stopped');
  }

  async retry() {
    if (this.state.phase !== 'error') return;
    log.info('retry');
    this.aborted = false;
    if (!this.conversation.length) return;
    // sendMessage is the only place that raises the [MODE CHANGED] banner, but retry() can also run
    // a turn under a mode the user switched to after the last real message. Without this, `lastMode`
    // stays stale until the NEXT sendMessage, which then wrongly claims the mode "just changed" even
    // though several turns already ran under it.
    this.lastMode = (await getSettings()).defaultMode;
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
    this.clearRunGrants();
    this.lastMode = null;
    if (this.resolvePermission) { this.resolvePermission(false); this.resolvePermission = null; }
    if (this.resolveExecution) { this.resolveExecution(false); this.resolveExecution = null; }
    if (this.resolveCritical) { this.resolveCritical(false); this.resolveCritical = null; }
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
    if (this.resolveCritical) { this.resolveCritical(false); this.resolveCritical = null; }
    this.clearRunGrants();
    this.lastMode = null;
    this.taskId = item.id;
    this.firstUserText = item.title || null;
    this.conversation = deserializeConversation(item.conversation ?? []);
    let restored: AgentState = { ...item.state };
    // Phases that can't actually be resumed (the tab/permission promise is gone) — force to error.
    if (restored.phase === 'working' || restored.phase === 'awaiting_permission' || restored.phase === 'awaiting_approval' || restored.phase === 'awaiting_critical') {
      restored = {
        ...restored,
        phase: 'error',
        errorMsg: restored.errorMsg ?? `task was ${item.status} — pick up with retry or send a new message`,
        workingLabel: undefined,
        pendingPermission: undefined,
        pendingExecution: undefined,
        pendingCritical: undefined,
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

  // Resolve a pending permission prompt with the user's chosen scope (page/domain) + duration
  // (once/session/always), at the access level the prompt asked for (read in plan mode, act otherwise).
  // `once` covers the prompted host until the agent next moves; `session` lives for this run only;
  // `always` is written to the allowlist. `pattern` is the host (domain scope) or page key (page scope).
  async decidePermission(pattern: string, scope: PermissionScope, duration: PermissionDuration, requested: AccessLevel) {
    // The level is fixed by the prompt the background raised, not by what the panel sends back.
    const access = this.state.pendingPermission?.access ?? requested;
    if (duration === 'once') {
      const host = this.state.pendingPermission?.host;
      if (host) this.onceGrant = { host, access };
    } else {
      // Seed sessionGrants for BOTH 'session' and 'always' so the grant takes effect for the rest of
      // this run regardless of mode. In the default 'ask' mode, ensureAllowed consults only
      // sessionGrants (the persisted allowlist is skipped) — so an 'always' grant that lived solely
      // in the persisted allowlist would re-prompt on the very next action.
      if (!this.sessionGrants.some((e) => e.pattern === pattern && e.scope === scope && e.access === access)) {
        this.sessionGrants.push({ pattern, scope, access });
      }
      if (duration === 'always') await addAllowEntry(pattern, scope, access);
    }
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

  // Gate access to `url` at level `need` (read: view/navigate; act: click/type/press): allowed if a
  // run grant or the persisted allowlist covers it, otherwise prompt the user and wait for their
  // decision. Returns whether the agent may proceed.
  private async ensureAllowed(url: string, reason: string, need: AccessLevel): Promise<boolean> {
    const host = hostFromUrl(url);
    if (!host) return true; // chrome://, about:blank, etc. — nothing to gate
    if (this.hasRunGrant(url, host, need)) return true;
    // 'ask' mode ("ask before acting" — see the Mode doc comment in shared/types.ts) does NOT consult
    // the seeded defaults (google.com, github.com, ...) or onboarding domains — those get a fresh
    // prompt each run. It DOES honor entries the user explicitly granted via the "always allow" prompt
    // (isUserAllowed) — "always allow" has to mean don't-ask-again even in ask mode, or the button is
    // meaningless. 'auto' and 'plan' honor the whole persisted allowlist (plan only ever needs read).
    const mode = this.runSettings?.defaultMode ?? (await getSettings()).defaultMode;
    const allowed = mode === 'ask' ? await isUserAllowed(url, need) : await isAllowed(url, need);
    if (allowed) return true;
    // Plan mode asks only for what it can use (read). Act modes ask straight for act — it covers
    // reading too, so a new site costs one prompt rather than a read prompt then an act prompt.
    return this.waitForPermission(url, reason, mode === 'plan' ? 'read' : 'act');
  }

  private waitForPermission(url: string, reason: string, access: AccessLevel): Promise<boolean> {
    const host = hostFromUrl(url);
    const pageKey = pageKeyFromUrl(url);
    this.pushMessage({ id: newId('perm'), kind: 'permission_request', host, url, pageKey, reason, access, status: 'pending', t: Date.now() });
    this.setState({ phase: 'awaiting_permission', pendingPermission: { host, url, pageKey, reason, access } });
    notify('dodo · needs you', `${access} permission required for ${host}`);
    return new Promise<boolean>((resolve) => { this.resolvePermission = resolve; });
  }

  // Critical-action guardrail (checkout/payment): pause and ask the user to confirm before the
  // content script performs a flagged click/type. Mirrors the execution-approval flow.
  async confirmCritical(messageId: string) {
    const pending = this.state.messages.find((m) => m.kind === 'critical_confirm' && m.id === messageId && m.status === 'pending');
    if (this.state.phase !== 'awaiting_critical' || this.state.pendingCritical?.messageId !== messageId || !pending) {
      log.warn('confirmCritical ignored — no matching pending critical action');
      return;
    }
    this.updateMessage(messageId, { status: 'confirmed' } as Partial<UIMessage>);
    this.setState({ phase: 'working', pendingCritical: undefined, workingLabel: 'thinking' });
    this.resolveCritical?.(true);
    this.resolveCritical = null;
  }

  async denyCritical(messageId: string) {
    const pending = this.state.messages.find((m) => m.kind === 'critical_confirm' && m.id === messageId && m.status === 'pending');
    if (this.state.phase !== 'awaiting_critical' || this.state.pendingCritical?.messageId !== messageId || !pending) {
      log.warn('denyCritical ignored — no matching pending critical action');
      return;
    }
    this.updateMessage(messageId, { status: 'denied' } as Partial<UIMessage>);
    this.setState({ phase: 'working', pendingCritical: undefined, workingLabel: 'thinking' });
    this.resolveCritical?.(false);
    this.resolveCritical = null;
  }

  private waitForCriticalConfirmation(action: CriticalAction, label: string, reason: string): Promise<boolean> {
    const messageId = newId('crit');
    this.pushMessage({ id: messageId, kind: 'critical_confirm', action, label, reason, status: 'pending', t: Date.now() });
    this.setState({ phase: 'awaiting_critical', pendingCritical: { messageId }, workingLabel: 'awaiting confirmation' });
    notify('dodo · needs you', `confirm before ${action} — ${reason}`);
    return new Promise<boolean>((resolve) => { this.resolveCritical = resolve; });
  }

  private waitForExecutionApproval(messageId: string): Promise<boolean> {
    this.setState({ phase: 'awaiting_approval', pendingExecution: { messageId }, workingLabel: 'awaiting approval' });
    notify('dodo · needs you', 'execution approval required');
    return new Promise<boolean>((resolve) => { this.resolveExecution = resolve; });
  }

  private async runLoop() {
    const settings = await getSettings();
    this.runSettings = settings; // cached for the duration of this run — see dispatchGranular
    const provider = getProvider(settings.providerId);
    if (!settings.apiKey) return this.fail('no api key configured — open settings to add your api key');

    // Plan mode: a read-only system prompt tells the model it can only browse/answer/propose, and
    // dispatchToolCall refuses anything outside PLAN_MODE_TOOLS at the dispatch boundary (see
    // `this.planning`). The tool SCHEMA itself is always the full set, regardless of mode — a
    // conversation that switches modes mid-chat would otherwise carry history containing function
    // calls for tools no longer declared in the current request, which providers may reject or mishandle.
    this.planning = settings.defaultMode === 'plan';
    const systemPrompt = this.planning ? PLAN_MODE_SYSTEM : EXEC_SYSTEM;
    this.lastSystemPrompt = systemPrompt;

    let emptyTurns = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let llmTurns = 0;
    const loopStartedAt = Date.now();
    for (let turn = 0; turn < 200 && !this.aborted; turn++) {
      this.setState({ workingLabel: 'thinking' });
      const sentMessages = pruneStaleToolResults(this.conversation);
      const chars = logChatRequest(turn, settings.model, sentMessages, systemPrompt);
      this.requestLog.push({ turn, at: new Date().toISOString(), model: settings.model, chars, messages: sentMessages });
      if (this.requestLog.length > 100) this.requestLog.shift();
      let res;
      try {
        res = await provider.chat({
          apiKey: settings.apiKey,
          model: settings.model,
          systemPrompt,
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

      // A model can return narration alongside its tool calls in the same turn (Gemini often does —
      // "I'll check the search results…" before calling a tool). Previously this text was silently
      // dropped: neither shown to the user nor kept in the conversation the model sees on later turns.
      const narration = res.text?.trim();
      const assistantParts: ContentPart[] = narration ? [{ type: 'text', text: res.text! }] : [];
      if (narration) this.pushMessage({ id: newId('msg'), kind: 'assistant', text: narration, t: Date.now() });
      // Add the model's tool_call message to the conversation first.
      assistantParts.push(...res.calls.map((c): ContentPart => (
        { type: 'tool_call', id: c.id, name: c.name, args: c.args, thoughtSignature: c.thoughtSignature }
      )));
      this.conversation.push({ role: 'assistant', parts: assistantParts });

      const toolReplies: ContentPart[] = [];
      let abortedMidBatch = false;
      let endRun = false;
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
        const { result, isError, screenshotBase64, ends } = await this.dispatchToolCall(name, call.id, call.args);
        if (ends) endRun = true;

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
      // propose_plan hands control back to the user — no closing LLM turn needed.
      if (endRun) return this.complete('plan ready for your approval');
    }

    if (!this.aborted) await this.fail('exceeded max turns');
  }

  private async dispatchToolCall(
    name: ToolName,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<{ result: unknown; isError: boolean; screenshotBase64?: string; ends?: boolean }> {
    // Enforced here rather than only via schema filtering: the request always declares the FULL tool
    // schema now (see runLoop), so a plan-mode model can still technically attempt a mutating call —
    // this is the hard boundary that actually stops it from touching the page.
    if (this.planning && !PLAN_MODE_TOOLS.has(name)) {
      this.pushMessage({
        id: newId('act'), kind: 'tool_activity', name, args, callId,
        status: 'error', t: Date.now(), detail: 'blocked — plan mode is read-only',
      });
      return {
        result: 'blocked: you are in read & plan mode (read-only) — you cannot click, type, press or run scripts. If the task needs actions, finish exploring and call propose_plan; the user approves it before anything is executed.',
        isError: true,
      };
    }
    if (!this.planning && name === 'propose_plan') {
      return {
        result: 'propose_plan is only for read & plan mode. You are in an acting mode — carry out the task directly.',
        isError: true,
      };
    }
    // generate_file creates a file_artifact UIMessage; no tool_activity row.
    if (name === 'generate_file') {
      const filename = String(args.filename ?? 'file.txt');
      const content  = String(args.content  ?? '');
      this.pushMessage({ id: newId('file'), kind: 'file_artifact', filename, content, t: Date.now() });
      return { result: { ok: true, filename }, isError: false };
    }

    // Plans and scripts render as their own rich UIMessage; granular tools push tool_activity.
    if (name === 'propose_plan') {
      return this.handleProposePlan(args);
    }
    if (name === 'update_plan') {
      return this.handleUpdatePlan(args);
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
      if (msg === 'critical_action_denied') {
        // User declined the critical-action confirmation. The run is NOT aborted — tell the model so
        // it can stop and report back rather than retrying the same blocked action.
        return { result: 'The user declined to confirm this action (it was flagged as sensitive — a checkout/payment step, or a link that logs out/unsubscribes/deletes). Do not retry it — stop and let the user know you held off.', isError: true };
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
      this.onceGrant = null; // moving to another page — an "allow once" doesn't follow
      pinActiveTab(target.id);
      await chrome.tabs.update(target.id, { active: true }).catch(() => undefined);
      if (target.windowId != null) await chrome.windows.update(target.windowId, { focused: true }).catch(() => undefined);
      await setTabWorking(target.id, true);
      await this.refreshActiveTab();
      return { ok: true, tabId: target.id, title: target.title, url: target.url, note: 'switched — snapshot() before acting' };
    }

    const tab = await getActiveTab();
    if (!tab || tab.id == null) throw new Error('no active tab');
    // Keep the pin and the side-panel indicator in sync with the tab we actually resolved.
    // getActiveTab falls back to the focused active tab when the pinned tab was closed/discarded (or
    // onRemoved cleared the pin); without re-pinning here the indicator (driven by pinnedTabId) would
    // stay stuck on the dead tab while the agent keeps acting on the real one. This only fires in that
    // genuine fallback case — a live pin is always preferred — so it doesn't chase user tab switches.
    if (tab.id !== getPinnedTabId()) {
      pinActiveTab(tab.id);
      await setTabWorking(tab.id, true);
      await this.refreshActiveTab();
    }

    if (name === 'navigate') {
      const url = String(args.url ?? '');
      if (!hostFromUrl(url)) throw new Error('invalid url');
      return this.navigateActiveTab(tab.id, url, url);
    }

    // Reading the current page needs read access; changing it needs act.
    const need: AccessLevel = ACT_TOOLS.has(name) ? 'act' : 'read';
    const currentHost = tab.url ? hostFromUrl(tab.url) : '';
    if (currentHost && !await this.ensureAllowed(tab.url ?? '', `agent wants to ${need === 'act' ? 'act on' : 'read'} ${currentHost}`, need)) {
      throw new Error('permission_denied');
    }

    if (name === 'follow_link') {
      const r = await runContentOp(tab.id, { op: 'resolve_link', selector: String(args.selector ?? '') });
      if (!r.ok) throw new Error(r.error);
      const { href, label } = r.data as { href: string; label: string };
      if (!args.newTab) return this.navigateActiveTab(tab.id, href, label || href);
      if (!await this.guardNavigation(href, label || href)) throw new Error('critical_action_denied');
      this.onceGrant = null;
      if (!await this.ensureAllowed(href, `agent wants to open ${hostFromUrl(href)} in a new tab`, 'read')) throw new Error('permission_denied');
      const created = await chrome.tabs.create({ url: href, openerTabId: tab.id, active: true });
      if (created.id == null) throw new Error('could not open a new tab');
      const opened = await this.followNewTab(created.id);
      return { ok: true, url: href, tabId: created.id, note: `opened in a new tab, now the active tab: ${opened?.title || '(untitled)'} — snapshot() before reading` };
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
      armPopupWatch();
      const showOverlay = this.runSettings?.showCursorOverlay ?? (await getSettings()).showCursorOverlay;
      const r = await this.runGuardedOp(tab.id, 'click', { op: 'click', selector: String(args.selector ?? ''), showOverlay });
      return this.maybeFollowNewTab(r);
    }
    if (name === 'type') {
      armPopupWatch();
      const showOverlay = this.runSettings?.showCursorOverlay ?? (await getSettings()).showCursorOverlay;
      const r = await this.runGuardedOp(tab.id, 'type', { op: 'type', selector: String(args.selector ?? ''), text: String(args.text ?? ''), perChar: Boolean(args.perChar), showOverlay });
      return this.maybeFollowNewTab(r);
    }
    if (name === 'press') {
      armPopupWatch();
      const showOverlay = this.runSettings?.showCursorOverlay ?? (await getSettings()).showCursorOverlay;
      const r = await this.runGuardedOp(tab.id, 'press', {
        op: 'press',
        key: String(args.key ?? ''),
        selector: args.selector ? String(args.selector) : undefined,
        modifiers: Array.isArray(args.modifiers) ? args.modifiers : undefined,
        showOverlay,
      });
      return this.maybeFollowNewTab(r);
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

  // Run a click/type/press content op behind the critical-action guardrail: if the content script
  // flags it (checkout/payment-shaped — including press("Enter") on such a target/field), pause for
  // the user to confirm, then re-issue the op with confirmed:true.
  // Throws 'critical_action_denied' if the user cancels, or the op's error on any other failure.
  private async runGuardedOp(
    tabId: number,
    action: 'click' | 'type' | 'press',
    op: Extract<ContentOp, { op: 'click' | 'type' | 'press' }>,
  ): Promise<unknown> {
    let r = await runContentOp(tabId, op);
    if (!r.ok && r.critical) {
      const approved = await this.waitForCriticalConfirmation(action, r.critical.label, r.critical.reason);
      if (!approved) throw new Error('critical_action_denied');
      if (this.aborted) throw new Error('aborted');
      armPopupWatch();
      r = await runContentOp(tabId, { ...op, confirmed: true });
    }
    if (!r.ok) throw new Error(r.error);
    return r.data;
  }

  // Shared by navigate and follow_link: side-effect-URL guard, read gate on the destination, then load.
  private async navigateActiveTab(tabId: number, url: string, label: string): Promise<unknown> {
    if (!await this.guardNavigation(url, label)) throw new Error('critical_action_denied');
    if (this.aborted) throw new Error('aborted');
    this.onceGrant = null; // a new page — an "allow once" for the previous one doesn't carry over
    if (!await this.ensureAllowed(url, `agent wants to navigate to ${hostFromUrl(url)}`, 'read')) throw new Error('permission_denied');
    await navigateTab(tabId, url);
    // SPAs fire status:complete on HTML load, not after JS renders content
    await new Promise<void>((r) => setTimeout(r, 1500));
    // The reload wiped the content script (and the working-title prefix) — re-apply it.
    await setTabWorking(tabId, true);
    await this.refreshActiveTab();
    return { ok: true, url };
  }

  // A GET to a logout/unsubscribe/delete-shaped URL can change state on its own. Plan mode refuses it
  // outright (throws, with an explanation for the model); act modes ask the user to confirm first.
  private async guardNavigation(url: string, label: string): Promise<boolean> {
    if (!sideEffectPath(url)) return true;
    if (this.planning) {
      throw new Error(`refused: ${url} looks like it changes state just by opening it (log out / unsubscribe / delete / confirm…) — plan mode never opens such URLs. If it's part of the task, make it a step in your plan.`);
    }
    return this.waitForCriticalConfirmation('navigate', label, 'this link looks like it changes something just by opening it (log out, unsubscribe, delete, confirm…)');
  }

  // If the action just opened a new tab, make it the active tab and tell the model about it.
  private async maybeFollowNewTab(data: unknown): Promise<unknown> {
    const newTabId = consumePendingNewTab();
    if (newTabId == null) return data;
    this.onceGrant = null;
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

  // Show a plan card for the user to approve. Ends the run (see runLoop) — approval starts a new one.
  private async handleProposePlan(args: Record<string, unknown>): Promise<{ result: unknown; isError: boolean; ends?: boolean }> {
    const goal = String(args.goal ?? '').trim();
    const steps = Array.isArray(args.steps) ? args.steps.map((s) => String(s).trim()).filter(Boolean) : [];
    if (!goal || steps.length === 0) return { result: 'propose_plan requires a `goal` and at least one step', isError: true };

    // Normalize sites to bare hosts; a wildcard-only or junk entry would turn into an over-broad grant.
    const sites = [...new Set(
      (Array.isArray(args.sites) ? args.sites : [])
        .map((s) => String(s).trim().replace(/^\*\./, ''))
        .map((s) => hostFromUrl(/^https?:\/\//i.test(s) ? s : `https://${s}`).toLowerCase())
        .filter((h) => h.includes('.') && !h.includes('*')),
    )];
    // No sites given → the plan acts on the page it was made from.
    if (sites.length === 0) {
      const tab = await getActiveTab().catch(() => null);
      const host = tab?.url ? hostFromUrl(tab.url) : '';
      if (host) sites.push(host);
    }

    let bulk: PlanBulk | undefined;
    const rawBulk = args.bulk as { description?: unknown; items?: unknown } | undefined;
    if (rawBulk && Array.isArray(rawBulk.items) && rawBulk.items.length > 0) {
      bulk = { description: String(rawBulk.description ?? ''), items: rawBulk.items.map(String) };
    }

    // A new proposal replaces any still-pending one.
    for (const m of this.state.messages) {
      if (m.kind === 'plan_proposal' && m.status === 'pending') {
        this.updateMessage(m.id, { status: 'superseded' } as Partial<UIMessage>);
      }
    }
    this.pushMessage({ id: newId('plan'), kind: 'plan_proposal', goal, sites, steps, bulk, status: 'pending', t: Date.now() });
    return {
      result: { ok: true, note: 'plan shown to the user — waiting for their approval or changes. Your turn is over.' },
      isError: false,
      ends: true,
    };
  }

  // Tick a step of the approved plan. Reads the plan from state.messages (not a separate field), so
  // it keeps working after a service-worker restart.
  private handleUpdatePlan(args: Record<string, unknown>): { result: unknown; isError: boolean } {
    const plan = [...this.state.messages].reverse().find((m) => m.kind === 'plan_proposal' && m.status === 'approved');
    if (plan?.kind !== 'plan_proposal') return { result: 'there is no approved plan to update', isError: true };
    const step = Number(args.step);
    if (!Number.isInteger(step) || step < 1 || step > plan.steps.length) {
      return { result: `step must be 1..${plan.steps.length}`, isError: true };
    }
    const status: PlanStepStatus = args.status === 'skipped' || args.status === 'failed' ? args.status : 'done';
    const stepStatus = [...(plan.stepStatus ?? plan.steps.map((): PlanStepStatus => 'todo'))];
    stepStatus[step - 1] = status;
    this.updateMessage(plan.id, { stepStatus } as Partial<UIMessage>);
    return { result: { ok: true }, isError: false };
  }

  private async handleExecuteActions(args: Record<string, unknown>): Promise<{ result: unknown; isError: boolean }> {
    const rawScript = args.script;
    if (!Array.isArray(rawScript) || rawScript.length === 0) {
      return { result: 'execute_actions requires a non-empty `script` array', isError: true };
    }
    const script = rawScript as ScriptStep[];
    const expanded = expandScript(script);
    if ('error' in expanded) return { result: expanded.error, isError: true };
    // A script that contains nothing but snapshots is a no-op — it leaves the page unchanged and returns no
    // extracted text, so the model loops back with the same blind spot. Force it to either act or use the
    // granular snapshot() tool to inspect the page.
    if (!expanded.steps.some((s) => s.action !== 'snapshot')) {
      return {
        result: 'execute_actions script must contain at least one click/type/press/navigate/extract step. To just inspect the page, call snapshot() directly instead.',
        isError: true,
      };
    }
    const rationale = typeof args.rationale === 'string' ? args.rationale : undefined;

    const settings = this.runSettings ?? await getSettings();
    const initStatus: ExecutionStatus = settings.approvalMode === 'auto_accept' ? 'running' : 'pending_approval';
    const execId = newId('exec');
    this.pushMessage({
      id: execId, kind: 'execution', script, expandedCount: expanded.steps.length, status: initStatus,
      rationale, t: Date.now(),
    });

    if (settings.approvalMode === 'always_ask') {
      const approved = await this.waitForExecutionApproval(execId);
      if (!approved) {
        return { result: { status: 'rejected', note: 'the user rejected this script — nothing was run' }, isError: false };
      }
    } else {
      this.setState({ workingLabel: 'executing script' });
    }

    const { results, extracted, ok, failedItem } = await this.executeScript(execId, expanded.steps, expanded.items);
    const finalStatus: ExecutionStatus = !ok ? 'error' : 'done';
    this.updateMessage(execId, {
      status: finalStatus,
      results,
      extractedPreview: extracted.length > 280 ? extracted.slice(0, 280) + '…' : extracted,
      workingLabel: undefined,
    } as Partial<UIMessage>);

    // Per-step results stay in the card; the model gets a compact summary (a bulk run can be hundreds
    // of steps) plus where it stopped, so it can resume from the failing item with granular tools.
    const failed = results.find((r) => r.status === 'error');
    return {
      result: {
        status: finalStatus,
        completedSteps: results.filter((r) => r.status === 'ok').length,
        totalSteps: expanded.steps.length,
        ...(failed ? { error: failed.error } : {}),
        ...(failedItem !== undefined ? { failedItem, note: 'items before failedItem are done; continue from failedItem' } : {}),
        extracted,
      },
      isError: false,
    };
  }

  private async executeScript(
    execId: string,
    initialSteps: FlatScriptStep[],
    initialItems: (string | undefined)[],
  ): Promise<{ results: StepResult[]; extracted: string; ok: boolean; failedItem?: string }> {
    let script = [...initialSteps];
    let items = [...initialItems]; // the foreach item each step came from (parallel to `script`)
    let lastSnapshot: SnapshotResult | null = null;
    const extractParts: string[] = [];
    const results: StepResult[] = [];
    const showOverlay = this.runSettings?.showCursorOverlay ?? true;
    // Pages already cleared for act during this script — ensureAllowed is consulted once per page.
    const actCleared = new Set<string>();
    let i = 0;
    let recoveryAttempts = 0; // for the current step
    let totalRepairs = 0;     // across the whole script

    const done = (ok: boolean, failedItem?: string) => ({ results, extracted: extractParts.join('\n\n'), ok, failedItem });
    const failAt = (action: StepResult['action'], error: string) => {
      const item = items[i];
      results.push({ action, status: 'error', error: item !== undefined ? `${error} (item: ${item})` : error });
      return done(false, item);
    };
    // Act gate for the page the step will run on. Throws 'permission_denied' if the user refuses.
    const actTab = async (): Promise<number> => {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error('no active tab');
      const url = tab.url ?? '';
      const key = pageKeyFromUrl(url) || url;
      if (!actCleared.has(key)) {
        if (!await this.ensureAllowed(url, `script wants to act on ${hostFromUrl(url)}`, 'act')) throw new Error('permission_denied');
        actCleared.add(key);
      }
      return tab.id;
    };
    // Replace the failing step with LLM-repaired steps (the rest of the script is kept).
    const repair = async (step: FlatScriptStep, snap: SnapshotResult | null): Promise<boolean> => {
      if (!snap || ++recoveryAttempts > 3 || ++totalRepairs > 10) return false;
      const repaired = await this.recoverStep(step, snap, script.slice(i + 1, i + 6));
      if (!repaired) return false;
      script = [...script.slice(0, i), ...repaired, ...script.slice(i + 1)];
      items = [...items.slice(0, i), ...repaired.map(() => items[i]), ...items.slice(i + 1)];
      lastSnapshot = snap;
      return true;
    };

    while (i < script.length && !this.aborted) {
      const step = script[i];
      this.updateMessage(execId, { workingLabel: items[i] !== undefined ? `${step.action} · ${items[i]}` : step.action } as Partial<UIMessage>);

      const needsTarget = step.action === 'click' || step.action === 'type' || (step.action === 'press' && !!step.target);
      if (needsTarget && !lastSnapshot) {
        lastSnapshot = await this.doSnapshotForScript();
        if (!lastSnapshot) return failAt(step.action, 'snapshot failed before interaction');
        continue;
      }

      try {
        if (step.action === 'navigate') {
          const tab = await getActiveTab();
          if (!tab?.id) throw new Error('no active tab');
          if (!hostFromUrl(step.url)) throw new Error(`invalid url: ${step.url}`);
          await this.navigateActiveTab(tab.id, step.url, step.url);
          lastSnapshot = null;
          recoveryAttempts = 0;
          results.push({ action: 'navigate', status: 'ok' });
          i++;

        } else if (step.action === 'snapshot') {
          lastSnapshot = await this.doSnapshotForScript();
          if (!lastSnapshot) return failAt('snapshot', 'snapshot failed');
          recoveryAttempts = 0;
          results.push({ action: 'snapshot', status: 'ok' });
          i++;

        } else if (step.action === 'click' || step.action === 'type' || step.action === 'press') {
          let selector: string | undefined;
          if (step.action !== 'press' || step.target) {
            const target = step.target;
            if (!target || typeof target !== 'object') return failAt(step.action, `${step.action} step needs a \`target\``);
            selector = resolveTarget(target, lastSnapshot!.elements, step.action === 'type' ? 'type' : 'click') ?? undefined;
            if (!selector) {
              if (await repair(step, lastSnapshot)) continue;
              return failAt(step.action, `no element matched: ${step.description ?? JSON.stringify(target)}`);
            }
          }
          if (step.action === 'press' && !step.key) return failAt('press', 'press step needs a `key`');

          const tabId = await actTab();
          const op = step.action === 'type'
            ? await runContentOp(tabId, { op: 'type', selector: selector!, text: step.text, showOverlay })
            : step.action === 'press'
              ? await runContentOp(tabId, { op: 'press', key: step.key, selector, showOverlay })
              : await runContentOp(tabId, { op: 'click', selector: selector!, showOverlay });

          if (!op.ok) {
            // A checkout/payment-shaped step the guardrail flagged. Scripts don't pause for
            // confirmation mid-batch — hard stop, and let the model redo it with the granular tools
            // (which do run the confirmation flow).
            if (op.critical) {
              return failAt(step.action, `blocked: ${op.critical.reason} — sensitive actions require the granular tools' confirmation flow, not a script`);
            }
            if (await repair(step, await this.doSnapshotForScript())) continue;
            return failAt(step.action, op.error ?? 'action failed');
          }

          // Let the page settle — clicks that open dropdowns, menus, or dialogs need a beat
          // before the next snapshot, otherwise the new overlay items aren't in the DOM yet.
          if (step.action !== 'type') {
            await new Promise<void>((r) => setTimeout(r, 350));
          }
          results.push({ action: step.action, status: 'ok' });
          lastSnapshot = null;
          recoveryAttempts = 0;
          i++;

        } else if (step.action === 'extract') {
          const tab = await getActiveTab();
          if (!tab?.id) return failAt('extract', 'no active tab');
          const r = await runContentOp(tab.id, { op: 'extract', mode: 'text' });
          const data = r.ok && r.data ? (r.data as { text?: string }) : null;
          if (data?.text) extractParts.push(items[i] !== undefined ? `## ${items[i]}\n${data.text}` : data.text);
          results.push({ action: 'extract', status: r.ok ? 'ok' : 'error', error: !r.ok ? r.error : undefined });
          i++;

        } else {
          i++; // skip unknown step types
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'permission_denied') return failAt(step.action, 'permission denied');
        if (msg === 'critical_action_denied') return failAt(step.action, 'the user declined to open a state-changing link');
        if (msg === 'aborted') break;
        if (await repair(step, await this.doSnapshotForScript())) continue;
        return failAt(step.action, `threw: ${msg}`);
      }
    }

    return done(!this.aborted);
  }

  private async doSnapshotForScript(): Promise<SnapshotResult | null> {
    const tab = await getActiveTab();
    if (!tab?.id) return null;
    const r = await runContentOp(tab.id, { op: 'snapshot_structured' });
    if (!r.ok || !r.data) return null;
    return r.data as SnapshotResult;
  }

  // Ask the model for steps that replace ONE failed step (the rest of the script stays as is — for a
  // bulk run the remainder can be hundreds of steps). Returns null if it can't produce valid steps.
  private async recoverStep(
    failedStep: FlatScriptStep,
    snapshot: SnapshotResult,
    nextSteps: FlatScriptStep[],
  ): Promise<FlatScriptStep[] | null> {
    const settings = this.runSettings ?? await getSettings();
    const provider = getProvider(settings.providerId);

    const elementSummary = (snapshot.elements ?? []).slice(0, 80).map((e) =>
      [e.tag, e.selector, e.text ? `text="${e.text}"` : '', e.aria ? `aria="${e.aria}"` : '',
       e.placeholder ? `ph="${e.placeholder}"` : '', e.role ? `role="${e.role}"` : '',
       e.type ? `type="${e.type}"` : ''].filter(Boolean).join(' ')
    ).join('\n');

    const prompt = `You are repairing a browser automation script. One step failed — no element matched, or the action errored.

FAILED STEP: ${JSON.stringify(failedStep)}

CURRENT PAGE (${snapshot.url}):
${elementSummary}

THE NEXT STEPS (they will run after your replacement, unchanged):
${JSON.stringify(nextSteps, null, 2)}

Output ONLY a JSON array of 1-5 steps that accomplish what the failed step intended, so the next steps can run.
Step formats: {"action":"navigate","url"}, {"action":"snapshot"}, {"action":"click","target":{...}}, {"action":"type","target":{...},"text"}, {"action":"press","key","target"?}, {"action":"extract"}.
Use real text/aria/placeholder values visible in the page above for targets. If the intended element genuinely isn't there, output [].`;

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
      const parsed = JSON.parse(res.text.trim()) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 5) return null;
      const valid = parsed.filter((s): s is FlatScriptStep =>
        !!s && typeof s === 'object' && FLAT_ACTIONS.has((s as { action?: string }).action ?? ''));
      return valid.length === parsed.length ? valid : null;
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
      systemPrompt: this.lastSystemPrompt,
      tools: TOOL_SCHEMAS,
      messages,
      requests,
    };
  }

  private async complete(notice = 'task complete') {
    log.info('complete');
    this.clearRunGrants(); // run ended — session grants don't carry into the next message
    // Await so the MV3 service worker stays alive until the content script has cleared the working
    // indicator + faded the on-page cursor overlay; a fire-and-forget `void` here can be dropped if
    // the worker suspends right after the run ends (the overlay would then never hide).
    await setTabWorking(getPinnedTabId(), false);
    this.setState({ phase: 'complete', workingLabel: undefined });
    notify('dodo · done', notice);
    // Await both writes so the completed state (incl. the assistant message) is durable before the
    // worker can suspend — otherwise a reload restores a stale mid-loop snapshot shown as "halted".
    await Promise.all([this.persistActiveState(), this.persistSnapshot('done')]);
  }

  private async fail(msg: string) {
    log.err('fail', msg);
    this.clearRunGrants(); // run ended — session grants don't carry into the next message
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

// The approved plan as the model sees it when asked to execute it.
function formatPlan(goal: string, steps: string[], bulk?: PlanBulk): string {
  const lines = [`Goal: ${goal}`, 'Steps:', ...steps.map((s, i) => `${i + 1}. ${s}`)];
  if (bulk) lines.push(`Bulk (${bulk.items.length} items): ${bulk.description}`, ...bulk.items.map((it) => `  - ${it}`));
  return lines.join('\n');
}

// Bulk limits for execute_actions — past these, the model is told to split into batches.
const MAX_FOREACH_ITEMS = 100;
const MAX_EXPANDED_STEPS = 400;
const FLAT_ACTIONS = new Set<string>(['navigate', 'snapshot', 'click', 'type', 'press', 'extract']);

// Flatten foreach steps into a plain step list, substituting `{{item}}`. `items[i]` is the foreach
// item step i came from (undefined for top-level steps) — used to report where a bulk run stopped.
function expandScript(script: ScriptStep[]): { steps: FlatScriptStep[]; items: (string | undefined)[] } | { error: string } {
  const steps: FlatScriptStep[] = [];
  const items: (string | undefined)[] = [];
  for (const s of script) {
    if (s?.action === 'foreach') {
      const list = Array.isArray(s.items) ? s.items.map(String) : [];
      const body = Array.isArray(s.steps) ? s.steps : [];
      if (!list.length || !body.length) return { error: 'a foreach step needs non-empty `items` and `steps`' };
      if (body.some((b) => !FLAT_ACTIONS.has(b?.action))) return { error: 'foreach `steps` may only contain navigate/snapshot/click/type/press/extract steps (no nested foreach)' };
      if (list.length > MAX_FOREACH_ITEMS) {
        return { error: `foreach has ${list.length} items — the limit is ${MAX_FOREACH_ITEMS}. Split the work into batches of up to ${MAX_FOREACH_ITEMS} items, one execute_actions call each.` };
      }
      for (const item of list) {
        for (const b of body) { steps.push(substituteItem(b, item)); items.push(item); }
      }
    } else if (s && FLAT_ACTIONS.has(s.action)) {
      steps.push(s);
      items.push(undefined);
    } else {
      return { error: `unknown step action: ${JSON.stringify((s as { action?: unknown })?.action)}` };
    }
    if (steps.length > MAX_EXPANDED_STEPS) {
      return { error: `the script expands to more than ${MAX_EXPANDED_STEPS} steps — split it into smaller batches, one execute_actions call each.` };
    }
  }
  return { steps, items };
}

function substituteItem(step: FlatScriptStep, item: string): FlatScriptStep {
  const sub = (v: unknown) => (typeof v === 'string' ? v.split('{{item}}').join(item) : v);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(step)) {
    out[k] = k === 'target' && v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as ScriptTarget).map(([tk, tv]) => [tk, sub(tv)]))
      : sub(v);
  }
  return out as FlatScriptStep;
}

function labelFor(name: ToolName, args: Record<string, unknown>): string {
  if (name === 'navigate') return String(hostFromUrl(String(args.url ?? '')) || args.url || '');
  if (name === 'screenshot') return 'capture viewport';
  if (name === 'snapshot') return args.element ? `expand ${args.element}` : 'read page DOM';
  if (name === 'click') return String(args.selector ?? '');
  if (name === 'type') return String(args.selector ?? '');
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
  if (name === 'follow_link') return `open link ${args.selector ?? ''}${args.newTab ? ' in new tab' : ''}`;
  if (name === 'propose_plan') return 'propose plan';
  if (name === 'update_plan') return 'update plan';
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
  if (name === 'click') {
    const r = result as { label?: string };
    if (r?.label) return `"${r.label}"`;
  }
  if (name === 'type') {
    const r = result as { label?: string; value?: string };
    if (r?.label) return r.value ? `"${truncate(r.value, 40)}" into "${r.label}"` : `into "${r.label}"`;
  }
  if (name === 'navigate' || name === 'follow_link') {
    const r = result as { url?: string };
    if (r?.url) return hostFromUrl(r.url) + (() => { try { return new URL(r.url).pathname; } catch { return ''; } })();
  }
  return undefined;
}

// snapshot/extract results pile up in the conversation and get re-sent every turn, but a stale
// one is dead weight — its `data-sel` refs no longer resolve once the page changes (the system
// prompt says as much). Keep the most recent few live and replace older ones with a short stub.
// Pure: returns a shallow copy, never mutates the stored conversation (the UI rehydrates from it).
const LIVE_PAGE_RESULTS = 2;
const SUPERSEDED_STUB =
  '[superseded snapshot — the page has since changed; call snapshot()/extract() again for the current DOM and fresh refs]';

// Screenshots are the same story but worse: each is ~100-300KB of base64 JPEG, and unlike
// snapshot/extract they were never being pruned at all — a screenshot-heavy task re-sends every
// prior screenshot on every subsequent turn, forever. Keep only the most recent one live.
const LIVE_IMAGES = 1;
const STALE_IMAGE_STUB = '[stale screenshot omitted — call screenshot() again if you need the current view]';

// Log exactly what's being sent to the provider each turn: a collapsed group with one line per
// message (role · part kinds · sizes · previews) plus the raw payload object for expansion in
// the service-worker devtools console. `messages` here is the post-prune payload, not the store.
function logChatRequest(turn: number, model: string, messages: ChatMessage[], systemPrompt: string): number {
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
  log.info('payload', { systemPrompt, messages });
  log.groupEnd();
  return totalChars;
}

function pruneStaleToolResults(messages: ChatMessage[]): ChatMessage[] {
  let keptResults = 0;
  let keptImages = 0;
  // Walk newest→oldest so the most recent snapshot/extract results and screenshots stay intact.
  const pruned = messages
    .slice()
    .reverse()
    .map((m) => {
      let changed = false;
      const parts = m.parts.map((p) => {
        if (p.type === 'tool_result' && !p.isError && (p.name === 'snapshot' || p.name === 'extract')) {
          if (keptResults < LIVE_PAGE_RESULTS) {
            keptResults++;
            return p;
          }
          changed = true;
          return { ...p, result: SUPERSEDED_STUB };
        }
        if (p.type === 'image') {
          if (keptImages < LIVE_IMAGES) {
            keptImages++;
            return p;
          }
          changed = true;
          return { type: 'text', text: STALE_IMAGE_STUB } satisfies ContentPart;
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
