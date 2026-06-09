// Persistence access layer. Settings + allowlist live in chrome.storage.local (small, change-rarely,
// and we want the free cross-context durability). History lives in IndexedDB via historyRepo (db.ts) —
// this module delegates to it so callers keep the same function surface regardless of backend.
import { DEFAULT_SETTINGS, type Settings, type HistoryItem } from '../shared/types';
import { historyRepo } from './db';

type StoreShape = {
  settings: Settings;
  allowlist: string[];
  history: HistoryItem[];
};

const KEYS = ['settings', 'allowlist'] as const;
const DEFAULT_ALLOWLIST = ['*.google.com', '*.github.com', '*.notion.so', '*.wikipedia.org'];

export async function loadStore(): Promise<StoreShape> {
  // historyRepo.list() returns metadata only (conversation/state live in a separate store, loaded
  // on demand) — so the broadcast payload stays small no matter how large history grows.
  const [raw, history] = await Promise.all([
    chrome.storage.local.get(KEYS as unknown as string[]),
    historyRepo.list(),
  ]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    allowlist: (raw.allowlist as string[] | undefined) ?? DEFAULT_ALLOWLIST,
    history,
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

// History is keyed by `id` in IndexedDB; "newest-first, capped" is enforced by the repo at
// query/write time rather than as a stored array invariant.
export async function getHistory(): Promise<HistoryItem[]> {
  return historyRepo.list();
}

export async function upsertHistory(item: HistoryItem): Promise<void> {
  await historyRepo.upsert(item);
}

export async function getHistoryItem(id: string): Promise<HistoryItem | undefined> {
  return historyRepo.get(id);
}

export async function deleteHistoryItem(id: string): Promise<void> {
  await historyRepo.remove(id);
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
