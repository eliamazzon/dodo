import type { AccessLevel } from '../shared/types';
import { getAllowlist, matchesAllowlist } from './store';
import { hostFromUrl } from './tools';

// True if a stored allowlist entry grants at least `need` on the given URL, so no prompt is needed.
// An empty/unparseable host (chrome://, about:blank) is treated as allowed — there's nothing to gate.
export async function isAllowed(url: string, need: AccessLevel): Promise<boolean> {
  const host = hostFromUrl(url);
  if (!host) return true;
  const list = await getAllowlist();
  return matchesAllowlist(url, host, list, need);
}

// Like isAllowed, but only honors entries the user explicitly granted via the in-chat "always allow"
// prompt (entry.user === true), NOT the seeded defaults or onboarding-selected domains. Used so an
// explicit "always allow" persists across runs even in 'ask' mode, where seeded entries still prompt.
export async function isUserAllowed(url: string, need: AccessLevel): Promise<boolean> {
  const host = hostFromUrl(url);
  if (!host) return true;
  const list = (await getAllowlist()).filter((e) => e.user === true);
  return matchesAllowlist(url, host, list, need);
}
