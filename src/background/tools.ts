import type { ToolSchema } from '../shared/types';
import type { ContentOp, ContentResult } from '../shared/messages';

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'navigate',
    description: 'Navigate the active tab to a URL. The URL must include scheme (https://).',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Absolute URL to navigate to.' } },
      required: ['url'],
    },
  },
  {
    name: 'screenshot',
    description: 'Capture the visible viewport of the active tab. Returns a JPEG image of what the user can see. Useful for understanding layout; pair with snapshot() to also get real CSS selectors.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'snapshot',
    description: 'Return a list of interactive elements on the page (inputs, buttons, links, selects) with REAL CSS selectors you can pass to click/type. ALWAYS call this before guessing a selector — do not invent attributes like aria-label values you have not verified.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'click',
    description: 'Click an element on the active page. selector must be a CSS selector that uniquely identifies the element.',
    parameters: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector for the element to click.' } },
      required: ['selector'],
    },
  },
  {
    name: 'type',
    description: 'Type text into an input or textarea on the active page.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input/textarea.' },
        text: { type: 'string', description: 'Text to type into the element.' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'extract',
    description: 'Extract text content from the active page. If selector is omitted, returns the entire visible page text.',
    parameters: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'Optional CSS selector to extract from.' } },
      required: [],
    },
  },
  {
    name: 'done',
    description: 'Mark the task complete.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'The actual result or answer — include extracted data, lists, findings, or a description of the action taken. Do NOT write a meta-description of what you did; write the result itself.' },
      },
      required: ['summary'],
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
