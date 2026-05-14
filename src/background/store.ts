// Chrome storage access layer — all persisted state (settings, allowlist, history) lives in chrome.storage.local.
import { DEFAULT_SETTINGS, type Settings, type HistoryItem } from '../shared/types';

type StoreShape = {
  settings: Settings;
  allowlist: string[];
  history: HistoryItem[];
};

const KEYS = ['settings', 'allowlist', 'history'] as const;
const HISTORY_MAX = 200; // oldest items are evicted once this cap is reached
const DEFAULT_ALLOWLIST = ['*.google.com', '*.github.com', '*.notion.so', '*.wikipedia.org'];

export async function loadStore(): Promise<StoreShape> {
  const raw = await chrome.storage.local.get(KEYS as unknown as string[]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    allowlist: (raw.allowlist as string[] | undefined) ?? DEFAULT_ALLOWLIST,
    history: (raw.history as HistoryItem[] | undefined) ?? [],
  };
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await loadStore();
  return settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getAllowlist(): Promise<string[]> {
  const { allowlist } = await loadStore();
  return allowlist;
}

export async function addAllowedHost(host: string): Promise<string[]> {
  const list = await getAllowlist();
  if (list.includes(host)) return list;
  const next = [...list, host];
  await chrome.storage.local.set({ allowlist: next });
  return next;
}

export async function setAllowlist(list: string[]): Promise<void> {
  await chrome.storage.local.set({ allowlist: list });
}

export async function getHistory(): Promise<HistoryItem[]> {
  const { history } = await loadStore();
  return history;
}

export async function appendHistory(item: HistoryItem): Promise<HistoryItem[]> {
  const list = await getHistory();
  const next = [item, ...list].slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ history: next });
  return next;
}

export async function upsertHistory(item: HistoryItem): Promise<HistoryItem[]> {
  const list = await getHistory();
  const idx = list.findIndex((it) => it.id === item.id);
  let next: HistoryItem[];
  if (idx >= 0) {
    next = list.slice();
    next[idx] = { ...list[idx], ...item };
    // move freshly-updated row to the top
    const [moved] = next.splice(idx, 1);
    next.unshift(moved);
  } else {
    next = [item, ...list];
  }
  next = next.slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ history: next });
  return next;
}

export async function getHistoryItem(id: string): Promise<HistoryItem | undefined> {
  const list = await getHistory();
  return list.find((it) => it.id === id);
}

export async function deleteHistoryItem(id: string): Promise<HistoryItem[]> {
  const list = await getHistory();
  const next = list.filter((it) => it.id !== id);
  await chrome.storage.local.set({ history: next });
  return next;
}

export function hostMatchesAllowlist(host: string, allowlist: string[]): boolean {
  return allowlist.some((pattern) => matchHost(host, pattern));
}

function matchHost(host: string, pattern: string): boolean {
  if (pattern === host) return true;
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return host === base || host.endsWith('.' + base);
  }
  return false;
}
