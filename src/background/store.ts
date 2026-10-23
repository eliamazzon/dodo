// Persistence access layer. Settings + allowlist live in chrome.storage.local (small, change-rarely,
// and we want the free cross-context durability). History lives in IndexedDB via historyRepo (db.ts) —
// this module delegates to it so callers keep the same function surface regardless of backend.
import { DEFAULT_SETTINGS, type Settings, type HistoryItem, type AllowlistEntry, type PermissionScope, type AccessLevel } from '../shared/types';
import { historyRepo } from './db';

type StoreShape = {
  settings: Settings;
  allowlist: AllowlistEntry[];
  history: HistoryItem[];
};

const KEYS = ['settings', 'allowlist'] as const;
const DEFAULT_ALLOWLIST: AllowlistEntry[] = [
  { pattern: '*.google.com', scope: 'domain' },
  { pattern: '*.github.com', scope: 'domain' },
  { pattern: '*.notion.so', scope: 'domain' },
  { pattern: '*.wikipedia.org', scope: 'domain' },
];

// Tolerate the legacy `string[]` shape (and any hand-edited storage): a bare string is an
// always-allowed domain pattern. New writes always store AllowlistEntry objects.
function normalizeAllowlist(raw: unknown): AllowlistEntry[] {
  if (!Array.isArray(raw)) return DEFAULT_ALLOWLIST;
  const out: AllowlistEntry[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push({ pattern: item, scope: 'domain' });
    } else if (item && typeof item === 'object' && typeof (item as AllowlistEntry).pattern === 'string') {
      const e = item as AllowlistEntry;
      out.push({
        pattern: e.pattern,
        scope: e.scope === 'page' ? 'page' : 'domain',
        // Entries written before the read/act split were act grants — keep them that way.
        access: e.access === 'read' ? 'read' : 'act',
        ...(e.user ? { user: true } : {}),
      });
    }
  }
  return out;
}

// Settings + allowlist only — no IndexedDB touch. getSettings()/getAllowlist() use this directly;
// loadStore() (the broadcast path, which also needs history) composes it with historyRepo.list().
// Splitting this out matters because getSettings() is called on the hot path (once per tool
// dispatch for showCursorOverlay, once per runLoop) — routing every one of those through a Dexie
// query over the history table was pure overhead with no relationship to what was being read.
async function loadLocalStore(): Promise<{ settings: Settings; allowlist: AllowlistEntry[] }> {
  const raw = await chrome.storage.local.get(KEYS as unknown as string[]);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
  // 'watch' was renamed to 'plan' (read-only, now able to browse) — migrate on read.
  if ((settings.defaultMode as string) === 'watch') settings.defaultMode = 'plan';
  return {
    settings,
    allowlist: raw.allowlist === undefined ? DEFAULT_ALLOWLIST : normalizeAllowlist(raw.allowlist),
  };
}

export async function loadStore(): Promise<StoreShape> {
  // historyRepo.list() returns metadata only (conversation/state live in a separate store, loaded
  // on demand) — so the broadcast payload stays small no matter how large history grows.
  const [local, history] = await Promise.all([loadLocalStore(), historyRepo.list()]);
  return { ...local, history };
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await loadLocalStore();
  return settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getAllowlist(): Promise<AllowlistEntry[]> {
  const { allowlist } = await loadLocalStore();
  return allowlist;
}

// Called from the in-chat "always allow" flow, so entries are marked `user: true` — this is what
// lets them bypass the prompt even in 'ask' mode (see isUserAllowed). If the user already granted
// this pattern+scope, widen its access (read → act) in place. Seeded/onboarding entries are never
// touched — a separate user entry is appended instead — so a "read always" grant can't promote a
// seeded act entry into an explicit act grant.
export async function addAllowEntry(pattern: string, scope: PermissionScope, access: AccessLevel): Promise<AllowlistEntry[]> {
  const list = await getAllowlist();
  const existing = list.find((e) => e.pattern === pattern && e.scope === scope && e.user);
  if (existing) {
    if (existing.access === 'act' || access === 'read') return list;
    const next = list.map((e) => (e === existing ? { ...e, access: 'act' as const } : e));
    await chrome.storage.local.set({ allowlist: next });
    return next;
  }
  const next = [...list, { pattern, scope, access, user: true }];
  await chrome.storage.local.set({ allowlist: next });
  return next;
}

// Onboarding deals only in plain domain hosts — wrap them as domain-scoped entries on write.
// Replaces only the domain entries; page-scoped grants (added later, from the in-chat permission
// flow) are preserved rather than wiped by an onboarding-settings save.
export async function setAllowlist(hosts: string[]): Promise<void> {
  const current = await getAllowlist();
  const pageEntries = current.filter((e) => e.scope === 'page');
  const domainEntries: AllowlistEntry[] = hosts.map((pattern) => ({ pattern, scope: 'domain', access: 'act' }));
  await chrome.storage.local.set({ allowlist: [...domainEntries, ...pageEntries] });
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

// A page's stable identity for page-scoped grants: origin + pathname, query/hash stripped (so
// ?utm=… or #section variants of the same page all match a single grant). Returns '' for
// unparseable / non-http URLs (chrome://, about:blank, etc.) — those never match a page entry.
export function pageKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin + u.pathname;
  } catch {
    return '';
  }
}

// True if the given URL is covered by any allowlist entry granting at least `need`: domain entries
// match the host (with the *.example.com wildcard), page entries match the exact page key. An entry
// without `access` is an act grant (pre-split), and act covers read.
export function matchesAllowlist(url: string, host: string, allowlist: AllowlistEntry[], need: AccessLevel = 'act'): boolean {
  const pageKey = pageKeyFromUrl(url);
  return allowlist.some((e) =>
    (need === 'read' || e.access !== 'read')
    && (e.scope === 'domain' ? matchHost(host, e.pattern) : (!!pageKey && e.pattern === pageKey)),
  );
}

function matchHost(host: string, pattern: string): boolean {
  if (pattern === host) return true;
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return host === base || host.endsWith('.' + base);
  }
  return false;
}
