// Update checker. DODO is installed unpacked from a git checkout — there's no Chrome Web Store
// listing and no update_url, so Chrome's native auto-update doesn't apply, and MV3's CSP rules out
// pulling new code at runtime. What we can do is notice that origin has moved and say so.
//
// The loop: poll GitHub's compare API for commits on `branch` since the SHA stamped into this build →
// panel shows a banner → user runs `npm run update` (git pull + rebuild) → user clicks reload →
// chrome.runtime.reload() re-reads dist/ from disk. The new build carries the new SHA, so the very
// next check reports "identical" and the banner disappears on its own.
import { BUILD } from '../shared/build';
import type { UpdateInfo } from '../shared/types';
import { getSettings } from './store';

const STORAGE_KEY = 'update';
export const UPDATE_ALARM = 'dodo-update-check';
const CHECK_PERIOD_MIN = 360; // 6h — one request per check, far under the 60/hr unauthenticated cap
const MAX_NOTES = 5;

type CompareResponse = {
  status?: 'ahead' | 'behind' | 'identical' | 'diverged';
  ahead_by?: number;
  commits?: { sha: string; commit: { message: string } }[];
};

export async function getUpdateInfo(): Promise<UpdateInfo | null> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  return (raw[STORAGE_KEY] as UpdateInfo | undefined) ?? null;
}

async function setUpdateInfo(info: UpdateInfo | null): Promise<void> {
  if (info === null) await chrome.storage.local.remove(STORAGE_KEY);
  else await chrome.storage.local.set({ [STORAGE_KEY]: info });
}

// Listeners fire on every stored change so the panel can redraw without polling.
type Listener = (info: UpdateInfo | null) => void;
const listeners = new Set<Listener>();

export function subscribeUpdates(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function publish(info: UpdateInfo | null): Promise<void> {
  await setUpdateInfo(info);
  for (const fn of listeners) {
    try { fn(info); } catch {}
  }
}

/**
 * Ask GitHub what's landed on `branch` since this build's commit.
 *
 * One request to /compare gives status, ahead_by and the commit list in a single round-trip.
 * Everything that isn't an unambiguous "origin is ahead of us" is treated as up to date — see the
 * status handling below, which is what keeps the banner quiet during normal local development.
 */
export async function checkForUpdate(opts: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  // No SHA means this wasn't built from a git checkout, so there's nothing to compare against.
  if (!BUILD.sha || !BUILD.slug) return null;

  const settings = await getSettings();
  if (!settings.checkForUpdates && !opts.force) return await getUpdateInfo();

  const prev = await getUpdateInfo();
  if (!opts.force && prev?.rateLimitedUntil && Date.now() < prev.rateLimitedUntil) return prev;

  const url = `https://api.github.com/repos/${BUILD.slug}/compare/${BUILD.sha}...${BUILD.branch}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  } catch {
    // Offline or DNS-blocked. Leave whatever we knew last time in place.
    return prev;
  }

  // 403/429 are the rate-limit responses. Back off for an hour rather than retrying on every alarm.
  if (res.status === 403 || res.status === 429) {
    const info: UpdateInfo = {
      ...(prev ?? { latestSha: '', aheadBy: 0, notes: [] }),
      checkedAt: Date.now(),
      rateLimitedUntil: Date.now() + 60 * 60 * 1000,
    };
    await publish(info);
    return info;
  }

  // 404: origin has never seen this commit — local work that hasn't been pushed. Not an update.
  if (res.status === 404) {
    await publish(clearPending(prev));
    return await getUpdateInfo();
  }

  if (!res.ok) return prev;

  let data: CompareResponse;
  try {
    data = (await res.json()) as CompareResponse;
  } catch {
    return prev;
  }

  // 'identical' — up to date. 'behind'/'diverged' — the local build is *ahead* of origin, which is
  // the everyday state while developing; never nag about that. Only 'ahead' means origin has moved.
  const aheadBy = data.status === 'ahead' ? (data.ahead_by ?? 0) : 0;
  if (aheadBy <= 0) {
    await publish(clearPending(prev));
    return await getUpdateInfo();
  }

  // compare returns commits oldest-first, so the last entry is the branch head.
  const commits = data.commits ?? [];
  const latestSha = commits.at(-1)?.sha ?? '';
  const notes = commits
    .slice()
    .reverse()
    .slice(0, MAX_NOTES)
    .map((c) => c.commit.message.split('\n')[0].trim())
    .filter(Boolean);

  const info: UpdateInfo = {
    latestSha,
    aheadBy,
    notes,
    checkedAt: Date.now(),
    // Carry the dismissal forward only while it still refers to the head we're reporting — a newer
    // push should resurface the banner even if the previous one was dismissed.
    ...(prev?.dismissedSha === latestSha ? { dismissedSha: latestSha } : {}),
  };
  await publish(info);
  return info;
}

// Keep the dismissal record but zero out the pending update, so a dismissed-then-reverted state
// doesn't resurrect the banner.
function clearPending(prev: UpdateInfo | null): UpdateInfo {
  return {
    latestSha: '',
    aheadBy: 0,
    notes: [],
    checkedAt: Date.now(),
    ...(prev?.dismissedSha ? { dismissedSha: prev.dismissedSha } : {}),
  };
}

export async function dismissUpdate(sha: string): Promise<UpdateInfo | null> {
  const prev = await getUpdateInfo();
  if (!prev) return null;
  const info: UpdateInfo = { ...prev, dismissedSha: sha };
  await publish(info);
  return info;
}

/** True when there's something to show the user: origin is ahead and this head wasn't dismissed. */
export function hasPendingUpdate(info: UpdateInfo | null): boolean {
  return !!info && info.aheadBy > 0 && info.dismissedSha !== info.latestSha;
}

/** Idempotent — safe to call from both onInstalled and onStartup. */
export async function ensureUpdateAlarm(): Promise<void> {
  if (!BUILD.sha) return;
  const existing = await chrome.alarms.get(UPDATE_ALARM);
  if (existing) return;
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: CHECK_PERIOD_MIN, delayInMinutes: 1 });
}

/**
 * Opportunistic check when the panel connects, so someone opening DODO after a long gap sees
 * current info instead of waiting for the next alarm. Cheap: at most one request per period.
 */
export async function maybeCheckOnConnect(): Promise<void> {
  if (!BUILD.sha) return;
  const info = await getUpdateInfo();
  const staleAfter = CHECK_PERIOD_MIN * 60 * 1000;
  if (info && Date.now() - info.checkedAt < staleAfter) return;
  await checkForUpdate();
}
