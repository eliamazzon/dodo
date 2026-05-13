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
    description: "Mark the task complete. Provide a short summary and a prioritized list of action items.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Plain-text summary of what was learned or done." },
        actionItems: {
          type: "array",
          description: "Prioritized list of follow-up actions.",
          items: {
            type: "object",
            properties: {
              priority: { type: "string", description: "One of p0, p1, p2.", enum: ["p0", "p1", "p2"] },
              text: { type: "string", description: "Action description." }
            },
            required: ["priority", "text"]
          }
        }
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
async function appendHistory(item) {
  const list = await getHistory();
  const next = [item, ...list].slice(0, HISTORY_MAX);
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

const NOTIFY_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgAQMAAABJtOi3AAAABlBMVEVrTqP///+xV9MoAAAAGklEQVQYlWNgGAWjYBSMglEwCkbBKBgFwwUAB+gAAdiqs8gAAAAASUVORK5CYII=";
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
  state = { ...INITIAL_AGENT_STATE };
  listeners = /* @__PURE__ */ new Set();
  aborted = false;
  resolvePermission = null;
  conversation = [];
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
    log.info("submit", { task });
    this.aborted = false;
    this.conversation = [];
    this.setState({
      ...INITIAL_AGENT_STATE,
      phase: "planning",
      task,
      workingLabel: "drafting plan",
      startedAt: Date.now()
    });
    try {
      const tab = await getActiveTab();
      if (tab?.id != null) {
        pinActiveTab(tab.id);
        log.info("pinned tab", { tabId: tab.id, url: tab.url });
      } else {
        log.warn("no active tab found at submit");
      }
    } catch (e) {
      log.warn("pin tab failed", e);
    }
    const settings = await getSettings();
    const provider = getProvider(settings.providerId);
    if (!settings.apiKey) {
      return this.fail("no api key configured — open settings to add your gemini key");
    }
    try {
      const planMessages = [
        { role: "user", parts: [{ type: "text", text: task }] }
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
    this.conversation.push({ role: "user", parts: [{ type: "text", text }] });
    this.setState({
      phase: "working",
      workingLabel: "continuing",
      complete: void 0,
      errorMsg: void 0
    });
    await this.runLoop();
  }
  async approvePlan() {
    if (this.state.phase !== "awaiting_approval" || !this.state.plan || !this.state.task) return;
    log.info("plan approved — starting loop");
    this.setState({ phase: "working", workingLabel: "starting" });
    this.conversation = [
      { role: "user", parts: [{ type: "text", text: this.state.task }] },
      { role: "assistant", parts: [{ type: "text", text: JSON.stringify(this.state.plan) }] },
      { role: "user", parts: [{ type: "text", text: "plan approved. proceed." }] }
    ];
    await this.runLoop();
  }
  stop() {
    log.info("stop");
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
    if (this.resolvePermission) {
      this.resolvePermission(false);
      this.resolvePermission = null;
    }
    this.state = { ...INITIAL_AGENT_STATE };
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
  async runLoop() {
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
          tools: TOOL_SCHEMAS
        });
      } catch (e) {
        log.err("chat failed", e);
        return this.fail(e instanceof Error ? e.message : String(e));
      }
      if (res.kind === "text") {
        log.info(`turn ${turn} ← text`, res.text.slice(0, 200));
        this.conversation.push({ role: "assistant", parts: [{ type: "text", text: res.text }] });
        if (!res.text.trim()) return this.fail("model returned empty response");
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
    this.setState({ phase: "complete", complete: c, workingLabel: void 0 });
    notify("dodo · done", truncate(c.summary, 140) || `task complete · ${c.steps} actions`);
    const item = {
      id: `${Date.now()}`,
      startedAt: this.state.startedAt ?? Date.now(),
      title: this.state.task ?? "task",
      sub: (this.state.plan?.sites ?? []).join(", ") || "no hosts",
      status: "done",
      steps: this.state.toolCalls.length,
      durationMs: c.durationMs
    };
    appendHistory(item).catch(() => void 0);
  }
  fail(msg) {
    log.err("fail", msg);
    this.setState({ phase: "error", errorMsg: msg, workingLabel: void 0 });
    notify("dodo · halted", truncate(msg, 140));
    if (this.state.task) {
      const item = {
        id: `${Date.now()}`,
        startedAt: this.state.startedAt ?? Date.now(),
        title: this.state.task,
        sub: (this.state.plan?.sites ?? []).join(", ") || "no hosts",
        status: "error",
        steps: this.state.toolCalls.length,
        durationMs: Date.now() - (this.state.startedAt ?? Date.now())
      };
      appendHistory(item).catch(() => void 0);
    }
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
        steps: obj.steps.map(String)
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
