import { D as DEFAULT_SETTINGS, I as INITIAL_AGENT_STATE } from '../assets/types-C5_6h52x.js';
import { G as GeminiProvider } from '../assets/gemini-n0K2crwM.js';
import { P as PORT_NAME } from '../assets/messages-DSwU0c21.js';

const REGISTRY = {
  [GeminiProvider.id]: GeminiProvider
};
function getProvider(id) {
  return REGISTRY[id] ?? GeminiProvider;
}

const TOOL_SCHEMAS = [
  {
    name: "navigate",
    description: "Navigate the active tab to a URL. The URL must include scheme (https://).",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute URL to navigate to." } },
      required: ["url"]
    }
  },
  {
    name: "screenshot",
    description: "Capture the visible viewport of the active tab. Returns a JPEG image of what the user can see. Useful for understanding layout; pair with snapshot() to also get real CSS selectors.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "snapshot",
    description: "Return a list of interactive elements on the page (inputs, buttons, links, selects) with REAL CSS selectors you can pass to click/type. ALWAYS call this before guessing a selector — do not invent attributes like aria-label values you have not verified.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "click",
    description: "Click an element on the active page. selector must be a CSS selector that uniquely identifies the element.",
    parameters: {
      type: "object",
      properties: { selector: { type: "string", description: "CSS selector for the element to click." } },
      required: ["selector"]
    }
  },
  {
    name: "type",
    description: "Type text into an input or textarea on the active page.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the input/textarea." },
        text: { type: "string", description: "Text to type into the element." }
      },
      required: ["selector", "text"]
    }
  },
  {
    name: "extract",
    description: "Extract text content from the active page. If selector is omitted, returns the entire visible page text.",
    parameters: {
      type: "object",
      properties: { selector: { type: "string", description: "Optional CSS selector to extract from." } },
      required: []
    }
  },
  {
    name: "done",
    description: "Mark the task complete.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "The actual result or answer — include extracted data, lists, findings, or a description of the action taken. Do NOT write a meta-description of what you did; write the result itself." }
      },
      required: ["summary"]
    }
  }
];
let pinnedTabId = null;
function pinActiveTab(tabId) {
  pinnedTabId = tabId;
}
async function getActiveTab() {
  if (pinnedTabId != null) {
    try {
      const t = await chrome.tabs.get(pinnedTabId);
      if (t && t.id != null) return t;
    } catch {
    }
  }
  const normalWindows = await chrome.windows.getAll({ populate: false, windowTypes: ["normal"] });
  const focusedNormal = normalWindows.find((w) => w.focused) ?? normalWindows[0];
  if (focusedNormal?.id != null) {
    const tabs = await chrome.tabs.query({ active: true, windowId: focusedNormal.id });
    if (tabs[0]?.id != null) return tabs[0];
  }
  const fallback = await chrome.tabs.query({ active: true, windowType: "normal" });
  return fallback[0] ?? null;
}
function hostFromUrl(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
async function navigateTab(tabId, url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((e) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(e);
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 25e3);
  });
}
async function captureScreenshot(windowId, quality = 70) {
  const dataUrl = windowId != null ? await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality }) : await chrome.tabs.captureVisibleTab({ format: "jpeg", quality });
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}
async function runContentOp(tabId, op) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content.js"]
  }).catch(() => void 0);
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, op, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message ?? "no response" });
        return;
      }
      resolve(response ?? { ok: false, error: "no response from content script" });
    });
  });
}

const KEYS = ["settings", "allowlist", "history"];
const HISTORY_MAX = 200;
const DEFAULT_ALLOWLIST = ["*.google.com", "*.github.com", "*.notion.so", "*.wikipedia.org"];
async function loadStore() {
  const raw = await chrome.storage.local.get(KEYS);
  return {
    settings: { ...DEFAULT_SETTINGS, ...raw.settings ?? {} },
    allowlist: raw.allowlist ?? DEFAULT_ALLOWLIST,
    history: raw.history ?? []
  };
}
async function getSettings() {
  const { settings } = await loadStore();
  return settings;
}
async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
async function getAllowlist() {
  const { allowlist } = await loadStore();
  return allowlist;
}
async function addAllowedHost(host) {
  const list = await getAllowlist();
  if (list.includes(host)) return list;
  const next = [...list, host];
  await chrome.storage.local.set({ allowlist: next });
  return next;
}
async function getHistory() {
  const { history } = await loadStore();
  return history;
}
async function upsertHistory(item) {
  const list = await getHistory();
  const idx = list.findIndex((it) => it.id === item.id);
  let next;
  if (idx >= 0) {
    next = list.slice();
    next[idx] = { ...list[idx], ...item };
    const [moved] = next.splice(idx, 1);
    next.unshift(moved);
  } else {
    next = [item, ...list];
  }
  next = next.slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ history: next });
  return next;
}
async function getHistoryItem(id) {
  const list = await getHistory();
  return list.find((it) => it.id === id);
}
async function deleteHistoryItem(id) {
  const list = await getHistory();
  const next = list.filter((it) => it.id !== id);
  await chrome.storage.local.set({ history: next });
  return next;
}
function hostMatchesAllowlist(host, allowlist) {
  return allowlist.some((pattern) => matchHost(host, pattern));
}
function matchHost(host, pattern) {
  if (pattern === host) return true;
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return host === base || host.endsWith("." + base);
  }
  return false;
}

async function isHostAllowed(host) {
  if (!host) return true;
  const list = await getAllowlist();
  return hostMatchesAllowlist(host, list);
}

const PREFIX = "%c[dodo]";
const STYLE = "color:#6b4ea3;font-weight:600";
const log = {
  info: (...args) => console.log(PREFIX, STYLE, ...args),
  warn: (...args) => console.warn(PREFIX, STYLE, ...args),
  err: (...args) => console.error(PREFIX, STYLE, ...args),
  group: (label) => console.groupCollapsed(PREFIX + " " + label, STYLE),
  groupEnd: () => console.groupEnd()
};

const NOTIFY_ICON = chrome.runtime.getURL("icons/spark-128.png");
async function notify(title, message) {
  const settings = await getSettings();
  if (!settings.notifyEnabled) return;
  return notifyForce(title, message);
}
async function notifyForce(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: NOTIFY_ICON,
      title,
      message,
      priority: 1
    });
  } catch (e) {
    log.warn("notify failed", e);
  }
}
if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener(async (id) => {
    try {
      const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
      const w = windows.find((win) => win.focused) ?? windows[0];
      if (w?.id != null) await chrome.sidePanel.open({ windowId: w.id });
    } catch {
    }
    try {
      chrome.notifications.clear(id);
    } catch {
    }
  });
}

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
async function getApproxLocation() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3e3);
    const r = await fetch("https://ipapi.co/json/", { signal: ctrl.signal });
    clearTimeout(tid);
    const d = await r.json();
    return [d.city, d.country_name].filter(Boolean).join(", ");
  } catch {
    return "";
  }
}
const RESOLVE_THRESHOLD = 5;
function scoreElement(el, t) {
  let score = 0;
  if (t.text) {
    const elText = (el.text ?? "").toLowerCase();
    const tText = t.text.toLowerCase();
    if (elText === tText) score += 10;
    else if (elText.includes(tText) || tText.includes(elText)) score += 5;
  }
  if (t.aria && el.aria) {
    score += el.aria.toLowerCase() === t.aria.toLowerCase() ? 8 : el.aria.toLowerCase().includes(t.aria.toLowerCase()) ? 4 : 0;
  }
  if (t.placeholder && el.placeholder) {
    score += el.placeholder.toLowerCase() === t.placeholder.toLowerCase() ? 8 : el.placeholder.toLowerCase().includes(t.placeholder.toLowerCase()) ? 4 : 0;
  }
  if (t.role && el.role && el.role.toLowerCase() === t.role.toLowerCase()) score += 3;
  if (t.type && el.type && el.type.toLowerCase() === t.type.toLowerCase()) score += 3;
  return score;
}
function isTypeable(el) {
  if (["input", "textarea"].includes(el.tag)) return true;
  if (el.role === "textbox" || el.role === "combobox" || el.role === "searchbox") return true;
  return false;
}
function resolveTarget(target, elements, action = "click") {
  let best = null;
  for (const el of elements) {
    if (action === "type" && !isTypeable(el)) continue;
    const score = scoreElement(el, target);
    if (score > (best?.score ?? 0)) best = { selector: el.selector, score };
  }
  return best && best.score >= RESOLVE_THRESHOLD ? best.selector : null;
}
class Agent {
  state = { ...INITIAL_AGENT_STATE };
  listeners = /* @__PURE__ */ new Set();
  aborted = false;
  resolvePermission = null;
  conversation = [];
  taskId = null;
  async persistSnapshot(status, extras) {
    if (!this.taskId || !this.state.task) return;
    const startedAt = this.state.startedAt ?? Date.now();
    const item = {
      id: this.taskId,
      startedAt,
      endedAt: status === "running" ? void 0 : Date.now(),
      title: this.state.task,
      sub: (this.state.plan?.sites ?? []).join(", ") || "no hosts",
      status,
      steps: this.state.toolCalls.length,
      durationMs: Date.now() - startedAt,
      state: {
        ...this.state,
        toolCalls: this.state.toolCalls.map((t) => ({ ...t, thumb: void 0 }))
      },
      conversation: serializeConversation(this.conversation),
      ...extras
    };
    try {
      await upsertHistory(item);
    } catch (e) {
      log.warn("persist history failed", e);
    }
  }
  subscribe(l) {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }
  setState(patch) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
  pushToolCall(r) {
    this.state = { ...this.state, toolCalls: [...this.state.toolCalls, r] };
    for (const l of this.listeners) l(this.state);
  }
  updateToolCall(id, patch) {
    this.state = {
      ...this.state,
      toolCalls: this.state.toolCalls.map((t) => t.id === id ? { ...t, ...patch } : t)
    };
    for (const l of this.listeners) l(this.state);
  }
  async submit(task) {
    log.info("submit", { task, reusingId: !!this.taskId });
    this.aborted = false;
    this.conversation = [];
    if (!this.taskId) this.taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.setState({
      ...INITIAL_AGENT_STATE,
      phase: "planning",
      task,
      workingLabel: "drafting plan",
      startedAt: Date.now()
    });
    void this.persistSnapshot("running");
    const settings = await getSettings();
    const provider = getProvider(settings.providerId);
    if (!settings.apiKey) {
      return this.fail("no api key configured — open settings to add your gemini key");
    }
    try {
      pinActiveTab(null);
      const tab = await getActiveTab();
      if (tab?.id != null) {
        pinActiveTab(tab.id);
        log.info("pinned tab", { tabId: tab.id, url: tab.url });
      } else {
        log.warn("no active tab found at submit");
      }
      let pageContext = "";
      if (tab?.id != null && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("chrome-extension://")) {
        try {
          const snap = await runContentOp(tab.id, { op: "snapshot" });
          if (snap.ok && snap.data) {
            const data = snap.data;
            const lines = (data.elements ?? []).slice(0, 60).map(
              (e) => [
                e.tag,
                e.text ? `text="${e.text}"` : "",
                e.aria ? `aria="${e.aria}"` : "",
                e.placeholder ? `ph="${e.placeholder}"` : "",
                e.role ? `role="${e.role}"` : "",
                e.type ? `type="${e.type}"` : ""
              ].filter(Boolean).join(" ")
            );
            pageContext = `URL: ${data.url ?? tab.url}
Title: ${data.title ?? tab.title ?? ""}
Elements:
${lines.join("\n")}`;
          }
        } catch {
        }
      }
      if (!pageContext) pageContext = `URL: ${tab?.url ?? "none"}
Title: ${tab?.title ?? ""}
Elements:
(no snapshot available)`;
      const now = /* @__PURE__ */ new Date();
      const datetime = now.toISOString();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const location = await getApproxLocation();
      const contextBlock = `TASK: ${task}

CURRENT PAGE:
${pageContext}

CONTEXT:
Datetime: ${datetime}
Timezone: ${timezone}
Location: ${location || "(unknown)"}`;
      const planMessages = [
        { role: "user", parts: [{ type: "text", text: contextBlock }] }
      ];
      log.info("plan request", { provider: provider.id, model: settings.model });
      const planRes = await provider.chat({
        apiKey: settings.apiKey,
        model: settings.model,
        systemPrompt: PLAN_SYSTEM,
        messages: planMessages,
        tools: [],
        jsonResponse: true
      });
      if (planRes.kind !== "text") return this.fail("planner did not return JSON");
      const plan = parsePlan(planRes.text);
      if (!plan) {
        log.err("plan parse failed", planRes.text);
        return this.fail("could not parse plan JSON");
      }
      log.info("plan ready", plan);
      this.setState({ phase: "awaiting_approval", plan, workingLabel: "drafted plan" });
      void this.persistSnapshot("running");
    } catch (e) {
      log.err("submit failed", e);
      return this.fail(e instanceof Error ? e.message : String(e));
    }
  }
  async continueChat(text) {
    if (!text.trim()) return;
    if (this.state.phase !== "complete" && this.state.phase !== "error") {
      log.warn("continueChat ignored — not in terminal state", this.state.phase);
      return;
    }
    log.info("continue", { text });
    this.aborted = false;
    const tab = await getActiveTab().catch(() => null);
    const datetime = (/* @__PURE__ */ new Date()).toISOString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let snapshotLines = "(no snapshot available)";
    if (tab?.id && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("chrome-extension://")) {
      try {
        const snap = await runContentOp(tab.id, { op: "snapshot" });
        if (snap.ok && snap.data) {
          const data = snap.data;
          snapshotLines = (data.elements ?? []).slice(0, 60).map(
            (e) => [
              e.tag,
              e.text ? `text="${e.text}"` : "",
              e.aria ? `aria="${e.aria}"` : "",
              e.placeholder ? `ph="${e.placeholder}"` : "",
              e.role ? `role="${e.role}"` : "",
              e.type ? `type="${e.type}"` : ""
            ].filter(Boolean).join(" ")
          ).join("\n");
        }
      } catch {
      }
    }
    const enriched = `Current page: ${tab?.url ?? "unknown"} — ${tab?.title ?? ""}
Datetime: ${datetime} (${timezone})
Elements:
${snapshotLines}

Follow-up: ${text}`;
    this.conversation.push({ role: "user", parts: [{ type: "text", text: enriched }] });
    this.setState({
      phase: "working",
      task: text,
      workingLabel: "continuing",
      complete: void 0,
      errorMsg: void 0,
      toolCalls: []
    });
    await this.runLoop();
  }
  async approvePlan() {
    if (this.state.phase !== "awaiting_approval" || !this.state.plan || !this.state.task) return;
    log.info("plan approved", { scriptMode: !!this.state.plan.script?.length });
    this.setState({ phase: "working", workingLabel: "starting" });
    if (this.state.plan.script?.length) {
      await this.runScript([...this.state.plan.script]);
    } else {
      this.conversation = [
        { role: "user", parts: [{ type: "text", text: this.state.task }] },
        { role: "assistant", parts: [{ type: "text", text: JSON.stringify(this.state.plan) }] },
        { role: "user", parts: [{ type: "text", text: "plan approved. proceed." }] }
      ];
      await this.runLoop();
    }
  }
  stop() {
    log.info("stop");
    this.aborted = true;
    pinActiveTab(null);
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    const wasRunning = this.taskId && this.state.task && this.state.phase !== "idle" && this.state.phase !== "complete" && this.state.phase !== "error";
    if (wasRunning) {
      void this.persistSnapshot("stopped");
    }
    this.conversation = [];
    this.taskId = null;
    this.state = { ...INITIAL_AGENT_STATE };
    for (const l of this.listeners) l(this.state);
  }
  async retry() {
    if (this.state.phase !== "error") return;
    if (!this.conversation.length) {
      if (this.state.task) return this.submit(this.state.task);
      return;
    }
    log.info("retry — resuming conversation", { messages: this.conversation.length });
    this.aborted = false;
    const last = this.conversation[this.conversation.length - 1];
    if (last.role !== "user" && last.role !== "tool") {
      this.conversation.push({
        role: "user",
        parts: [{ type: "text", text: "continue from where you left off. if a tool call failed, try a different approach (e.g., call snapshot() to get fresh selectors)." }]
      });
    }
    this.setState({ phase: "working", workingLabel: "retrying", errorMsg: void 0 });
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
  async openHistory(id) {
    const item = await getHistoryItem(id);
    if (!item || !item.state) {
      log.warn("openHistory — no item or no saved state", id);
      return;
    }
    log.info("openHistory", { id, status: item.status });
    this.aborted = true;
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    this.taskId = item.id;
    this.conversation = deserializeConversation(item.conversation ?? []);
    let restored = { ...item.state };
    if (restored.phase === "planning" || restored.phase === "working" || restored.phase === "awaiting_permission" || restored.phase === "awaiting_approval") {
      restored = {
        ...restored,
        phase: "error",
        errorMsg: restored.errorMsg ?? `task was ${item.status} — pick up with retry or send a new message`,
        workingLabel: void 0,
        pendingPermission: void 0
      };
    }
    this.state = restored;
    for (const l of this.listeners) l(this.state);
  }
  async allowHost(host, remember) {
    if (remember && host) await addAllowedHost(host);
    if (this.resolvePermission) {
      this.resolvePermission(true);
      this.resolvePermission = null;
      this.setState({ phase: "working", pendingPermission: void 0 });
    }
  }
  async denyPermission() {
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    this.setState({ pendingPermission: void 0 });
    this.fail("user denied permission");
  }
  waitForPermission(host, reason) {
    this.setState({ phase: "awaiting_permission", pendingPermission: { host, reason } });
    notify("dodo · needs you", `permission required for ${host}`);
    return new Promise((resolve) => {
      this.resolvePermission = resolve;
    });
  }
  async doSnapshot() {
    const tab = await getActiveTab();
    if (!tab?.id) return null;
    const startedAt = Date.now();
    const r = await runContentOp(tab.id, { op: "snapshot" });
    if (!r.ok || !r.data) return null;
    const data = r.data;
    this.pushToolCall({
      id: `snapshot_${startedAt}`,
      name: "snapshot",
      args: {},
      status: "ok",
      startedAt,
      endedAt: Date.now(),
      label: "inventory interactive elements",
      detail: `${data.elements?.length ?? 0} elements`
    });
    return data;
  }
  async dispatchNavigate(url) {
    const host = hostFromUrl(url);
    if (!host) throw new Error("invalid url");
    const allowed = await isHostAllowed(host);
    if (!allowed) {
      const ok = await this.waitForPermission(host, `agent wants to navigate to ${host}`);
      if (!ok) throw new Error("permission_denied");
    }
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("no active tab");
    const startedAt = Date.now();
    const recId = `navigate_${startedAt}`;
    this.pushToolCall({ id: recId, name: "navigate", args: { url }, status: "pending", startedAt, label: `navigate to ${host}` });
    await navigateTab(tab.id, url);
    this.updateToolCall(recId, { status: "ok", endedAt: Date.now() });
  }
  async runLoop() {
    const settings = await getSettings();
    const provider = getProvider(settings.providerId);
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
          tools: TOOL_SCHEMAS
        });
      } catch (e) {
        log.err("chat failed", e);
        return this.fail(e instanceof Error ? e.message : String(e));
      }
      if (res.kind === "text") {
        log.info(`turn ${turn} ← text`, res.text.slice(0, 200));
        this.conversation.push({ role: "assistant", parts: [{ type: "text", text: res.text }] });
        if (!res.text.trim()) {
          if (++emptyTurns >= 3) return this.fail("model returned empty response");
          continue;
        }
        emptyTurns = 0;
        continue;
      }
      log.info(`turn ${turn} ← tool_calls`, res.calls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 80)})`));
      const assistantParts = res.calls.map((c) => ({
        type: "tool_call",
        id: c.id,
        name: c.name,
        args: c.args,
        thoughtSignature: c.thoughtSignature
      }));
      this.conversation.push({ role: "assistant", parts: assistantParts });
      const toolReplies = [];
      let doneCall = null;
      for (const call of res.calls) {
        if (this.aborted) return;
        const name = call.name;
        if (name === "done") {
          const summary = call.args.summary ?? "task complete";
          const actionItems = sanitizeActionItems(call.args.actionItems);
          doneCall = { summary, actionItems };
          toolReplies.push({ type: "tool_result", id: call.id, name: "done", result: { ok: true } });
          continue;
        }
        const rec = {
          id: call.id,
          name,
          args: call.args,
          status: "pending",
          startedAt: Date.now(),
          label: labelFor(name, call.args)
        };
        this.pushToolCall(rec);
        this.setState({ workingLabel: rec.label });
        let result = null;
        let isError = false;
        try {
          result = await this.dispatch(name, call.args);
          log.info(`  ✓ ${name}`, detailFor(name, call.args, result) ?? "");
          this.updateToolCall(call.id, {
            status: "ok",
            endedAt: Date.now(),
            detail: detailFor(name, call.args, result),
            thumb: name === "screenshot" ? result.thumb : void 0
          });
        } catch (e) {
          isError = true;
          const msg = e instanceof Error ? e.message : String(e);
          log.warn(`  ✗ ${name}`, msg);
          this.updateToolCall(call.id, { status: "error", endedAt: Date.now(), errorMsg: msg, detail: msg });
          if (msg === "permission_denied") {
            return this.fail("user denied permission");
          }
          result = msg;
        }
        if (name === "screenshot" && !isError) {
          const r = result;
          if (r.base64) {
            toolReplies.push({
              type: "tool_result",
              id: call.id,
              name,
              result: { ok: true, note: "screenshot attached as next user message" }
            });
            toolReplies.push({
              type: "image",
              mimeType: "image/jpeg",
              base64: r.base64
            });
            continue;
          }
        }
        toolReplies.push({
          type: "tool_result",
          id: call.id,
          name,
          result: isError ? String(result) : sanitizeResult(name, result),
          isError
        });
      }
      this.conversation.push({ role: "tool", parts: toolReplies });
      void this.persistSnapshot("running");
      if (doneCall) {
        return this.complete({
          summary: doneCall.summary,
          actionItems: doneCall.actionItems,
          durationMs: Date.now() - (this.state.startedAt ?? Date.now()),
          steps: this.state.toolCalls.length
        });
      }
    }
    if (!this.aborted) this.fail("exceeded max turns");
  }
  async runScript(script) {
    let lastSnapshot = null;
    let i = 0;
    let recoveryAttempts = 0;
    while (i < script.length && !this.aborted) {
      const step = script[i];
      if ((step.action === "click" || step.action === "type") && !lastSnapshot) {
        lastSnapshot = await this.doSnapshot();
        if (!lastSnapshot) return this.fail("snapshot failed before interaction");
        continue;
      }
      try {
        if (step.action === "navigate") {
          await this.dispatchNavigate(step.url);
          lastSnapshot = null;
          recoveryAttempts = 0;
          i++;
        } else if (step.action === "snapshot") {
          lastSnapshot = await this.doSnapshot();
          if (!lastSnapshot) return this.fail("snapshot failed");
          recoveryAttempts = 0;
          i++;
        } else if (step.action === "click" || step.action === "type") {
          const selector = resolveTarget(step.target, lastSnapshot.elements, step.action);
          if (!selector) {
            if (++recoveryAttempts > 3) return this.fail(`no element matched after ${recoveryAttempts - 1} recovery attempts: ${step.description ?? JSON.stringify(step.target)}`);
            const repaired = await this.recoverScript(step, lastSnapshot, script.slice(i));
            if (!repaired) return this.fail(`no element matched: ${step.description ?? JSON.stringify(step.target)}`);
            script = [...script.slice(0, i), ...repaired];
            continue;
          }
          const tab = await getActiveTab();
          if (!tab?.id) return this.fail("no active tab");
          const startedAt = Date.now();
          const recId = `${step.action}_${startedAt}`;
          this.pushToolCall({
            id: recId,
            name: step.action,
            status: "pending",
            startedAt,
            args: step.action === "type" ? { selector, text: step.text } : { selector },
            label: step.action === "type" ? `type into ${selector}` : `click ${selector}`
          });
          this.setState({ workingLabel: step.description ?? (step.action === "type" ? `type into ${selector}` : `click ${selector}`) });
          const op = step.action === "type" ? await runContentOp(tab.id, { op: "type", selector, text: step.text }) : await runContentOp(tab.id, { op: "click", selector });
          if (!op.ok) {
            this.updateToolCall(recId, { status: "error", endedAt: Date.now(), errorMsg: op.error });
            if (++recoveryAttempts > 3) return this.fail(`action failed after ${recoveryAttempts - 1} recovery attempts: ${op.error}`);
            const fresh = await this.doSnapshot();
            const repaired = fresh ? await this.recoverScript(step, fresh, script.slice(i)) : null;
            if (!repaired) return this.fail(op.error ?? "action failed");
            script = [...script.slice(0, i), ...repaired];
            lastSnapshot = fresh;
            continue;
          }
          this.updateToolCall(recId, { status: "ok", endedAt: Date.now() });
          lastSnapshot = null;
          recoveryAttempts = 0;
          i++;
        } else if (step.action === "extract") {
          const tab = await getActiveTab();
          if (tab?.id) {
            const startedAt = Date.now();
            const r = await runContentOp(tab.id, { op: "extract" });
            this.pushToolCall({
              id: `extract_${startedAt}`,
              name: "extract",
              args: {},
              startedAt,
              endedAt: Date.now(),
              status: r.ok ? "ok" : "error",
              label: "read page"
            });
          }
          i++;
        } else if (step.action === "done") {
          return this.complete({
            summary: step.summary,
            actionItems: [],
            durationMs: Date.now() - (this.state.startedAt ?? Date.now()),
            steps: this.state.toolCalls.length
          });
        } else {
          i++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "permission_denied") return this.fail("user denied permission");
        if (++recoveryAttempts > 3) return this.fail(`step threw after ${recoveryAttempts - 1} recovery attempts: ${msg}`);
        const fresh = await this.doSnapshot();
        const repaired = fresh ? await this.recoverScript(step, fresh, script.slice(i)) : null;
        if (!repaired) return this.fail(msg);
        script = [...script.slice(0, i), ...repaired];
        lastSnapshot = fresh;
      }
      void this.persistSnapshot("running");
    }
    if (!this.aborted) this.fail("script ended without done step");
  }
  async recoverScript(failedStep, snapshot, remainingSteps) {
    const settings = await getSettings();
    const provider = getProvider(settings.providerId);
    const elementSummary = (snapshot.elements ?? []).slice(0, 60).map(
      (e) => [
        e.tag,
        e.selector,
        e.text ? `text="${e.text}"` : "",
        e.aria ? `aria="${e.aria}"` : "",
        e.placeholder ? `ph="${e.placeholder}"` : "",
        e.role ? `role="${e.role}"` : "",
        e.type ? `type="${e.type}"` : ""
      ].filter(Boolean).join(" ")
    ).join("\n");
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
        systemPrompt: "You are a browser automation repair assistant. Output ONLY valid JSON — an array of script steps.",
        messages: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
        tools: [],
        jsonResponse: true
      });
      if (res.kind !== "text") return null;
      const parsed = JSON.parse(res.text.trim());
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  async dispatch(name, args) {
    const tab = await getActiveTab();
    if (!tab || tab.id == null) throw new Error("no active tab");
    if (name === "navigate") {
      const url = String(args.url ?? "");
      const host = hostFromUrl(url);
      if (!host) throw new Error("invalid url");
      const allowed = await isHostAllowed(host);
      if (!allowed) {
        const ok = await this.waitForPermission(host, `agent wants to navigate to ${host}, which is not in your allowlist.`);
        if (!ok) throw new Error("permission_denied");
      }
      await navigateTab(tab.id, url);
      return { ok: true, url };
    }
    const currentHost = tab.url ? hostFromUrl(tab.url) : "";
    if (currentHost) {
      const allowed = await isHostAllowed(currentHost);
      if (!allowed) {
        const ok = await this.waitForPermission(currentHost, `agent wants to act on ${currentHost}, which is not in your allowlist.`);
        if (!ok) throw new Error("permission_denied");
      }
    }
    if (name === "screenshot") {
      if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("devtools://") || tab.url.startsWith("chrome-extension://"))) {
        throw new Error(`cannot capture ${tab.url} — restricted URL. navigate to a normal page first.`);
      }
      const base64 = await captureScreenshot(tab.windowId);
      return { ok: true, base64, thumb: base64.slice(0, 200) };
    }
    if (name === "snapshot") {
      const r = await runContentOp(tab.id, { op: "snapshot" });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
    if (name === "click") {
      const r = await runContentOp(tab.id, { op: "click", selector: String(args.selector ?? "") });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
    if (name === "type") {
      const r = await runContentOp(tab.id, { op: "type", selector: String(args.selector ?? ""), text: String(args.text ?? "") });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
    if (name === "extract") {
      const r = await runContentOp(tab.id, { op: "extract", selector: args.selector ? String(args.selector) : void 0 });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
    throw new Error(`unknown tool: ${name}`);
  }
  complete(c) {
    log.info("complete", { steps: c.steps, durationMs: c.durationMs, summary: c.summary.slice(0, 200) });
    pinActiveTab(null);
    this.setState({ phase: "complete", complete: c, workingLabel: void 0 });
    notify("dodo · done", truncate(c.summary, 140) || `task complete · ${c.steps} actions`);
    void this.persistSnapshot("done");
  }
  fail(msg) {
    log.err("fail", msg);
    pinActiveTab(null);
    this.setState({ phase: "error", errorMsg: msg, workingLabel: void 0 });
    notify("dodo · halted", truncate(msg, 140));
    if (this.state.task) void this.persistSnapshot("error");
  }
}
function truncate(s, max) {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
function parsePlan(text) {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) s = fence[1].trim();
  try {
    const obj = JSON.parse(s);
    if (Array.isArray(obj.steps)) {
      return {
        sites: Array.isArray(obj.sites) ? obj.sites.map(String) : [],
        steps: obj.steps.map(String),
        script: Array.isArray(obj.script) && obj.script.length ? obj.script : void 0
      };
    }
  } catch {
  }
  return null;
}
function labelFor(name, args) {
  if (name === "navigate") return `navigate to ${hostFromUrl(String(args.url ?? "")) || args.url}`;
  if (name === "screenshot") return "capture viewport";
  if (name === "snapshot") return "inventory interactive elements";
  if (name === "click") return `click ${args.selector ?? ""}`;
  if (name === "type") return `type into ${args.selector ?? ""}`;
  if (name === "extract") return args.selector ? `extract ${args.selector}` : "read page";
  return name;
}
function detailFor(name, _args, result) {
  if (name === "extract") {
    const r = result;
    if (r?.text) return `${Math.min(r.text.length, 99999)} chars`;
  }
  if (name === "snapshot") {
    const r = result;
    if (Array.isArray(r?.elements)) return `${r.elements.length} elements`;
  }
  if (name === "screenshot") return "jpeg · q70";
  return void 0;
}
function sanitizeResult(name, result) {
  if (name === "extract") {
    const r = result;
    if (r?.text && r.text.length > 6e3) return { text: r.text.slice(0, 6e3) + "\n…[truncated]" };
  }
  return result;
}
function serializeConversation(messages) {
  return messages.map((m) => ({
    role: m.role,
    parts: m.parts.map((p) => {
      if (p.type === "image") return { type: "image_omitted", mimeType: p.mimeType };
      if (p.type === "tool_call") return { type: "tool_call", id: p.id, name: p.name, args: p.args, thoughtSignature: p.thoughtSignature };
      if (p.type === "tool_result") return { type: "tool_result", id: p.id, name: p.name, result: p.result, isError: p.isError };
      return { type: "text", text: p.text };
    })
  }));
}
function deserializeConversation(messages) {
  return messages.map((m) => ({
    role: m.role,
    parts: m.parts.flatMap((p) => {
      if (p.type === "image_omitted") {
        return [{ type: "text", text: `[screenshot omitted from saved history · ${p.mimeType}]` }];
      }
      if (p.type === "tool_call") return [{ type: "tool_call", id: p.id, name: p.name, args: p.args, thoughtSignature: p.thoughtSignature }];
      if (p.type === "tool_result") return [{ type: "tool_result", id: p.id, name: p.name, result: p.result, isError: p.isError }];
      return [{ type: "text", text: p.text }];
    })
  }));
}
function sanitizeActionItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const item = x;
    const text = item.text ?? "";
    if (!text) return [];
    const p = item.priority === "p0" || item.priority === "p1" || item.priority === "p2" ? item.priority : "p1";
    return [{ priority: p, text }];
  });
}
const agent = new Agent();

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
  }
  if (details.reason === "install") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/onboarding/index.html") });
  }
});
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  let unsub = null;
  const send = async () => {
    const { settings, allowlist, history } = await loadStore();
    const msg = { kind: "state", state: agent.state, settings, allowlist, history };
    try {
      port.postMessage(msg);
    } catch {
    }
  };
  unsub = agent.subscribe(() => {
    void send();
  });
  void send();
  port.onMessage.addListener(async (msg) => {
    switch (msg.kind) {
      case "submit_task":
        void agent.submit(msg.task);
        break;
      case "continue_chat":
        void agent.continueChat(msg.text);
        break;
      case "approve_plan":
        void agent.approvePlan();
        break;
      case "edit_plan":
        agent.reset();
        break;
      case "stop":
        agent.stop();
        break;
      case "allow_host":
        await agent.allowHost(msg.host, msg.remember);
        break;
      case "deny_permission":
        await agent.denyPermission();
        break;
      case "retry":
        void agent.retry();
        break;
      case "reset":
        agent.reset();
        break;
      case "set_mode":
        await saveSettings({ defaultMode: msg.mode });
        void send();
        break;
      case "test_notify":
        void notifyForce("dodo · notifications on", "you'll be pinged when the agent finishes or needs you.");
        break;
      case "open_history":
        await agent.openHistory(msg.id);
        break;
      case "delete_history":
        await deleteHistoryItem(msg.id);
        void send();
        break;
    }
  });
  port.onDisconnect.addListener(() => {
    unsub?.();
  });
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === "open_sidepanel") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.windowId != null) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => void 0);
      }
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});
//# sourceMappingURL=service-worker.js.map
