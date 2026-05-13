import { getAllowlist, hostMatchesAllowlist } from './store';

export async function isHostAllowed(host: string): Promise<boolean> {
  if (!host) return true;
  const list = await getAllowlist();
  return hostMatchesAllowlist(host, list);
}
