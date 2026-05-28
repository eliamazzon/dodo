import type { ToolSchema } from '../shared/types';
import type { ContentOp, ContentResult } from '../shared/messages';

// Targets are described by visible properties (text/aria/placeholder/role/type), not CSS selectors —
// selectors are resolved at execution time against a fresh snapshot.
const SCRIPT_STEP_SCHEMA = {
  type: 'object',
  description:
    'A single step. Shape depends on `action`: ' +
    '{action:"navigate",url}; ' +
    '{action:"snapshot"}; ' +
    '{action:"click",target:{text?,aria?,placeholder?,role?,type?},description?}; ' +
    '{action:"type",target:{...},text}; ' +
    '{action:"extract"}.',
  properties: {
    action: {
      type: 'string',
      enum: ['navigate', 'snapshot', 'click', 'type', 'extract'],
      description: 'Step kind.',
    },
    url: { type: 'string', description: 'For navigate steps only.' },
    target: {
      type: 'object',
      description: 'For click/type steps. Use visible properties — never CSS selectors.',
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
    description: { type: 'string', description: 'Optional human-readable label for this step.' },
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
    description: 'Type text into an input or textarea identified by a `data-sel` ref from snapshot().',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'A `data-sel` ref from snapshot() for the input/textarea (e.g. "e42").' },
        text: { type: 'string', description: 'Text to type.' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'extract',
    description:
      'Extract text content from the active page. If `selector` is omitted, returns the entire visible page text. Returns the FULL text — use this when the user asks for a list, table, or anything where completeness matters.',
    parameters: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'Optional CSS selector to scope extraction.' } },
      required: [],
    },
  },
];

// ── planner + executor — DISABLED for now, kept for later reuse ───────────────
// These schemas are intentionally NOT part of TOOL_SCHEMAS, so the model is never
// offered them and cannot call them. The handler/executor code in agent.ts stays
// intact. To re-enable, spread PLANNER_TOOL_SCHEMAS back into TOOL_SCHEMAS.
export const PLANNER_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'plan_actions',
    description:
      'Ask the planner to draft a deterministic action script (navigate/snapshot/click/type/extract steps) for a multi-step browser task. Side-effect free — returns the proposed script for you to inspect, refine, or pass to execute_actions. Provide the current page context (from a recent snapshot()) so the planner uses real visible labels for targets. Use this when you have a clear multi-step plan and want to batch into one approval + many cheap deterministic steps. For exploratory or unfamiliar pages, prefer the granular tools instead.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'What the script should accomplish.' },
        pageContext: {
          type: 'string',
          description: 'Snapshot summary (URL, title, visible elements). Pass the formatted snapshot text from a recent snapshot() call.',
        },
      },
      required: ['goal', 'pageContext'],
    },
  },
  {
    name: 'execute_actions',
    description:
      'Run a script (array of action steps) deterministically. If approvalMode is always_ask the user sees a Approve/Reject card before any side effects. Returns { status, extracted, results } — extracted is the FULL concatenation of every extract step (no truncation), results is per-step status. Use this after plan_actions when ready to act.',
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
