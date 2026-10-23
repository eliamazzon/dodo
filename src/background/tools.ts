import type { ToolSchema, JsonSchemaProp } from '../shared/types';
import type { ContentOp, ContentResult } from '../shared/messages';

// Targets are described by visible properties (text/aria/placeholder/role/type), not CSS selectors —
// selectors are resolved at execution time against a fresh snapshot.
const FLAT_STEP_PROPS: Record<string, JsonSchemaProp> = {
  url: { type: 'string', description: 'For navigate steps only.' },
  target: {
    type: 'object',
    description: 'For click/type/press steps. Use visible properties — never CSS selectors or data-sel refs.',
    properties: {
      text: { type: 'string' },
      aria: { type: 'string' },
      placeholder: { type: 'string' },
      role: { type: 'string' },
      type: { type: 'string' },
    },
    required: [],
  },
  text: { type: 'string', description: 'For type steps: the text to type.' },
  key: { type: 'string', description: 'For press steps: Enter, Tab, Escape, Backspace, ArrowUp/Down/Left/Right.' },
  description: { type: 'string', description: 'Optional human-readable label for this step.' },
};

// Steps allowed inside a foreach — the same shape minus foreach itself (the provider schema can't
// express recursion, and one level of nesting is all bulk work needs).
const FLAT_STEP_SCHEMA: JsonSchemaProp = {
  type: 'object',
  description:
    'A single step. Shape depends on `action`: ' +
    '{action:"navigate",url}; ' +
    '{action:"snapshot"}; ' +
    '{action:"click",target:{text?,aria?,placeholder?,role?,type?},description?}; ' +
    '{action:"type",target:{...},text}; ' +
    '{action:"press",key,target?}; ' +
    '{action:"extract"}. ' +
    'Inside a foreach, `{{item}}` in url/text/target values is replaced with the current item.',
  properties: {
    action: { type: 'string', enum: ['navigate', 'snapshot', 'click', 'type', 'press', 'extract'], description: 'Step kind.' },
    ...FLAT_STEP_PROPS,
  },
  required: ['action'],
};

const SCRIPT_STEP_SCHEMA: JsonSchemaProp = {
  type: 'object',
  description:
    `${FLAT_STEP_SCHEMA.description} ` +
    'Or {action:"foreach",items:[...],steps:[...]} — runs `steps` once per item, substituting `{{item}}`.',
  properties: {
    action: { type: 'string', enum: ['navigate', 'snapshot', 'click', 'type', 'press', 'extract', 'foreach'], description: 'Step kind.' },
    ...FLAT_STEP_PROPS,
    items: { type: 'array', items: { type: 'string' }, description: 'For foreach steps: the values to iterate over.' },
    steps: { type: 'array', items: FLAT_STEP_SCHEMA, description: 'For foreach steps: the steps to repeat per item (no nested foreach).' },
  },
  required: ['action'],
};

export const TOOL_SCHEMAS: ToolSchema[] = [
  // ── granular tools — for exploration, login flows, ambiguous pages ──────────
  {
    name: 'snapshot',
    description:
      'Snapshot the page DOM as HTML. Interactive elements carry a short `data-sel` ref token (e.g. data-sel="e42") — pass that ref to click() or type(). snapshot() → full page expanded 3 levels from <body>. snapshot({element}) → that element fully expanded. snapshot({element, n}) → that element expanded n levels. Use snapshot() for an overview, then snapshot({element}) to drill into a container (dropdown, dialog, table). ALWAYS snapshot before guessing a ref.',
    parameters: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'A `data-sel` ref (e.g. "e42") or CSS selector from the latest snapshot to drill into. Omit for a full-page overview. Do not invent a value.' },
        n: { type: 'number', description: 'Levels to expand from `element`. Omit for full expansion.' },
      },
      required: [],
    },
  },
  {
    name: 'screenshot',
    description:
      'Capture the visible viewport as a JPEG. Useful for understanding layout. Pair with snapshot() if you need to act on what you see.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'navigate',
    description:
      'Navigate the active tab to a URL (must include https://). Triggers a host-allowlist permission prompt if the host is not already approved.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Absolute URL to navigate to.' } },
      required: ['url'],
    },
  },
  {
    name: 'follow_link',
    description:
      'Open a link\'s URL without clicking it. Use for plain links (an <a href> element, or an element inside one); use click() for buttons and JS-driven items. Fails if the element is not an http(s) link. newTab:true opens it in a new tab that becomes the active one. After it returns, snapshot() before acting.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'A `data-sel` ref of the link from the latest snapshot()/extract().' },
        newTab: { type: 'boolean', description: 'Open in a new tab instead of the current one. Default false.' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'click',
    description:
      'Click an element on the active page. `selector` must be a `data-sel` ref (e.g. "e42") from a recent snapshot() — do not invent refs. Returns a diff of what changed in the DOM after the click (elements that appeared/disappeared, aria-expanded/selected/disabled changes), so you usually do not need to snapshot() again just to see the result.',
    parameters: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'A `data-sel` ref from snapshot() (e.g. "e42").' } },
      required: ['selector'],
    },
  },
  {
    name: 'type',
    description: 'Type text into an input, textarea, or rich-text editor (contentEditable) identified by a `data-sel` ref. Returns the resulting `value`/text — if the diff is empty but `value` shows your text, the type worked; do NOT retry. Typing does NOT submit. For an input/textarea it sets the value; for a contentEditable editor it INSERTS at the cursor (does not erase existing text). A message/document compose BODY is usually a contentEditable editor, often inside an iframe: use extract({mode:"map"}) to find it (it lists elements inside same-origin iframes; the editor is flagged `contenteditable` with its id), then type() into that ref — do not hunt with repeated snapshots. Write the WHOLE body in ONE type() call (use \\n for line breaks); do not split it across several type()/toolbar-click cycles — toolbar formatting via clicks is unreliable. Only follow type() with press({key:"Enter"}) when the value must become a chip/selection (recipient/tag) or pick an autocomplete option — NOT for plain subject/body text. Set perChar:true for AUTOCOMPLETE / COMBOBOX / type-ahead search fields that open a dropdown of suggestions as you type (e.g. station/airport/city pickers): it types one character at a time with real key events so the per-keystroke search fires and the dropdown appears. The response `diff` then lists the dropdown options — you MUST select one (click its `data-sel` ref, or press({key:"ArrowDown"}) then press({key:"Enter"})); these widgets reject a value that was not picked. Leave perChar off for normal fields — it is slower.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'A `data-sel` ref from snapshot() for the input/textarea/editor (e.g. "e42").' },
        text: { type: 'string', description: 'Text to type.' },
        perChar: { type: 'boolean', description: 'Type one character at a time with real key events. Use for autocomplete/combobox/type-ahead search fields whose dropdown only opens on per-keystroke input. Default false (single-shot, faster).' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'press',
    description: 'Dispatch a real key press, optionally with modifier keys. Use it ONLY when a keystroke is needed: Enter to COMMIT a typed value into a chip/selection (recipient/email/tag in a To field) or to confirm an autocomplete/combobox pick, or Escape to dismiss a menu/dialog. For modifier combos pass `modifiers` — e.g. press({key:"a",modifiers:["Meta"]}) to select all, press({key:"c",modifiers:["Meta"]}) to copy, press({key:"v",modifiers:["Meta"]}) to paste, press({key:"z",modifiers:["Meta"]}) to undo. Do NOT press after typing into a plain text field (subject, body, normal form input) — that text is already entered. Do NOT use Tab just to move between fields; find the next element with snapshot/extract and type() into it. Without a selector it presses on the currently focused element (e.g. right after a type()); pass a selector to focus an element first.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: ['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'c', 'f', 's', 'v', 'x', 'z'], description: 'Key to press. Letter keys (a/c/v/x/z/s/f) are intended for use with modifiers.' },
        modifiers: { type: 'array', items: { type: 'string', enum: ['Meta', 'Control', 'Alt', 'Shift'] }, description: 'Modifier keys to hold. Use "Meta" for Cmd on Mac / Win key on Windows.' },
        selector: { type: 'string', description: 'Optional `data-sel` ref to focus before pressing. Omit to press on the currently focused element.' },
      },
      required: ['key'],
    },
  },
  {
    name: 'generate_file',
    description:
      'Generate a file and make it available for download in the chat. Use for structured outputs: markdown reports (.md), tabular data (.csv), or structured data (.json). The filename must include the extension.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Filename including extension, e.g. "results.csv".' },
        content:  { type: 'string', description: 'Full file content as a string.' },
      },
      required: ['filename', 'content'],
    },
  },
  {
    name: 'extract',
    description:
      'FALLBACK survey/read for what snapshot can\'t show. Use it only when a snapshot — even after snapshot({element}) expands the relevant container — is truncated/depth-limited, or the page renders an empty/uninformative DOM snapshot (some SPAs). mode="map" (default) flattens the whole page (or a scoped region) to a COMPACT list of every interactive element with its `data-sel` ref and label — one line each — to enumerate a list/grid/menu/search-results that snapshot couldn\'t fully show. mode="text" returns the FULL readable page text (no truncation) for reading prose, tables, or prices. Refs from the map are clickable. Prefer snapshot() and snapshot({element}) drill-in first.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional `data-sel` ref or CSS selector to scope to a region. Omit for the whole page.' },
        mode: { type: 'string', enum: ['map', 'text'], description: 'map = compact interactive element list with refs (default); text = full readable prose.' },
      },
      required: [],
    },
  },
  {
    name: 'list_tabs',
    description:
      'List the open browser tabs (id, title, url, and which one is currently active). Use this to find a tab to switch to with switch_tab. You operate on ONE tab at a time — the active one.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'switch_tab',
    description:
      'Make a different tab the active tab — all subsequent tools (snapshot/click/type/…) then target it. Pass a `tabId` from list_tabs. Note: when an action you take opens a NEW tab, it becomes active automatically (the tool result says so) — you do NOT need switch_tab for that. After switching, call snapshot() before acting.',
    parameters: {
      type: 'object',
      properties: { tabId: { type: 'number', description: 'The id of the tab to switch to (from list_tabs).' } },
      required: ['tabId'],
    },
  },
  // ── plans — propose_plan in plan mode, update_plan while executing an approved one ─────────
  {
    name: 'propose_plan',
    description:
      'PLAN MODE ONLY. Present a concrete action plan to the user for approval. This ENDS your turn — the user approves (and it is then executed with acting tools) or replies with changes. Call it once, after you have explored enough that every step names the site/page and the exact visible labels of the elements involved.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'One sentence: what the plan accomplishes.' },
        sites: { type: 'array', items: { type: 'string' }, description: 'Hosts the plan acts on (e.g. "mail.google.com") — no scheme, no paths. Approving grants act access on these for the run.' },
        steps: { type: 'array', items: { type: 'string' }, description: 'Ordered, concrete, imperative steps (lowercase, no numbering).' },
        bulk: {
          type: 'object',
          description: 'Optional: a repetitive part of the plan — what is done per item, and the full list of items.',
          properties: {
            description: { type: 'string', description: 'What is done for each item.' },
            items: { type: 'array', items: { type: 'string' }, description: 'The items (e.g. email subjects, product names, URLs).' },
          },
          required: ['description', 'items'],
        },
      },
      required: ['goal', 'sites', 'steps'],
    },
  },
  {
    name: 'update_plan',
    description:
      'While executing an approved plan: mark a plan step as done/skipped/failed so the user sees progress. Call it right after finishing each step (it can go in the same turn as your next action).',
    parameters: {
      type: 'object',
      properties: {
        step: { type: 'number', description: '1-based step number from the approved plan.' },
        status: { type: 'string', enum: ['done', 'skipped', 'failed'], description: 'New status for the step.' },
        note: { type: 'string', description: 'Optional short note (e.g. why it was skipped).' },
      },
      required: ['step', 'status'],
    },
  },
  {
    name: 'execute_actions',
    description:
      'Run a script of steps deterministically — for REPETITIVE work over a known list of items (bulk actions). Wrap the per-item steps in {action:"foreach",items:[...],steps:[...]} and use `{{item}}` in url/text/target values. Targets are visible properties (text/aria/placeholder/role/type), never data-sel refs — they are re-resolved against the live page at each step. Do the sequence once by hand with the granular tools first, so you know the exact labels. The user may be asked to approve the script first. Returns { status, extracted, results } — results is per expanded step; on failure the error names the failing item so you can continue from there with granular tools.',
    parameters: {
      type: 'object',
      properties: {
        script: {
          type: 'array',
          description: 'Ordered list of action steps to execute.',
          items: SCRIPT_STEP_SCHEMA,
        },
        rationale: {
          type: 'string',
          description: 'Short human-readable rationale shown in the approval card.',
        },
      },
      required: ['script'],
    },
  },
];

let pinnedTabId: number | null = null;

export function pinActiveTab(tabId: number | null) {
  pinnedTabId = tabId;
}

export function getPinnedTabId(): number | null {
  return pinnedTabId;
}

// A tab opened by the agent's active tab (target="_blank"/window.open), awaiting auto-follow.
let pendingNewTabId: number | null = null;
let tabTrackingStarted = false;

// Chrome stamps openerTabId on any new tab created while a given tab is active — including a
// plain user-initiated Cmd/Ctrl+T, not just window.open()/target="_blank". So an openerTabId
// match alone can't tell an agent-triggered popup from the user just opening a new tab. Only
// treat it as agent-triggered if it lands inside a short window right after we dispatch a
// click/type/press tool call.
let popupWatchUntil = 0;

export function armPopupWatch(windowMs = 1500) {
  popupWatchUntil = Date.now() + windowMs;
}

// Register tab-lifecycle listeners once. onCreated flags tabs spawned by the active tab so the
// agent can auto-follow them; onRemoved keeps our ids from pointing at dead tabs.
export function initTabTracking() {
  if (tabTrackingStarted) return;
  tabTrackingStarted = true;
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id != null && tab.openerTabId != null && tab.openerTabId === pinnedTabId && Date.now() <= popupWatchUntil) {
      pendingNewTabId = tab.id;
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === pinnedTabId) pinnedTabId = null;
    if (tabId === pendingNewTabId) pendingNewTabId = null;
  });
}

export function consumePendingNewTab(): number | null {
  const id = pendingNewTabId;
  pendingNewTabId = null;
  return id;
}

export async function listTabs(): Promise<{ id: number; title: string; url: string; active: boolean }[]> {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  return tabs
    .filter((t) => t.id != null)
    .map((t) => ({ id: t.id!, title: t.title ?? '', url: t.url ?? '', active: t.id === pinnedTabId }));
}

// Best-effort: toggle the working-title indicator on a tab. No-ops on restricted/chrome:// tabs.
export async function setTabWorking(tabId: number | null, working: boolean): Promise<void> {
  if (tabId == null) return;
  await runContentOp(tabId, { op: 'set_working', working }).catch(() => undefined);
}

// Resolve once a (typically just-opened) tab finishes loading, or after a timeout.
export function waitForTabComplete(tabId: number, timeoutMs = 25000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') finish(); }).catch(() => {});
    setTimeout(finish, timeoutMs);
  });
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  if (pinnedTabId != null) {
    try {
      const t = await chrome.tabs.get(pinnedTabId);
      if (t && t.id != null) return t;
    } catch {}
  }
  const normalWindows = await chrome.windows.getAll({ populate: false, windowTypes: ['normal'] });
  const focusedNormal = normalWindows.find((w) => w.focused) ?? normalWindows[0];
  if (focusedNormal?.id != null) {
    const tabs = await chrome.tabs.query({ active: true, windowId: focusedNormal.id });
    if (tabs[0]?.id != null) return tabs[0];
  }
  const fallback = await chrome.tabs.query({ active: true, windowType: 'normal' });
  return fallback[0] ?? null;
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export async function navigateTab(tabId: number, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') {
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
    }, 25000);
  });
}

export async function captureScreenshot(windowId: number | undefined, quality = 70): Promise<string> {
  const dataUrl = windowId != null
    ? await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality })
    : await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality });
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

export async function runContentOp(tabId: number, op: ContentOp): Promise<ContentResult> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/content.js'],
  }).catch(() => undefined);
  return new Promise<ContentResult>((resolve) => {
    chrome.tabs.sendMessage(tabId, op, (response: ContentResult | undefined) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message ?? 'no response' });
        return;
      }
      resolve(response ?? { ok: false, error: 'no response from content script' });
    });
  });
}
