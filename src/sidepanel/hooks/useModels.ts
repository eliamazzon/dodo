import { useCallback, useEffect, useState } from 'react';
import { getProvider } from '../../background/providers';
import type { ModelOption } from '../components/PanelHeader';

// Live model list for the current provider + key, cached in chrome.storage.local so the menu opens
// instantly and we hit the models endpoint about once a day. Falls back to the provider's built-in
// catalog until the first fetch lands, or if it fails (offline, bad key).
const STORAGE_KEY = 'models';
const STALE_AFTER = 24 * 60 * 60 * 1000;

type Cache = { providerId: string; keyHash: string; fetchedAt: number; models: ModelOption[] };

// Identify which key the cache belongs to without storing the key a second time.
async function hashKey(apiKey: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function useModels(providerId: string, apiKey: string) {
  const provider = getProvider(providerId);
  const [models, setModels] = useState<ModelOption[]>(provider.availableModels);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    if (!apiKey.trim()) {
      setModels(provider.availableModels);
      return;
    }
    const keyHash = await hashKey(apiKey);
    const raw = await chrome.storage.local.get(STORAGE_KEY);
    const cache = raw[STORAGE_KEY] as Cache | undefined;
    const matches = cache && cache.providerId === provider.id && cache.keyHash === keyHash;
    if (matches) setModels(cache.models);
    if (matches && !force && Date.now() - cache.fetchedAt < STALE_AFTER) return;

    setLoading(true);
    setError(null);
    try {
      const fresh = await provider.listModels(apiKey);
      if (fresh.length) {
        setModels(fresh);
        const next: Cache = { providerId: provider.id, keyHash, fetchedAt: Date.now(), models: fresh };
        await chrome.storage.local.set({ [STORAGE_KEY]: next });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (!matches) setModels(provider.availableModels);
    } finally {
      setLoading(false);
    }
  }, [provider, apiKey]);

  useEffect(() => { void load(false); }, [load]);

  return { models, loading, error, refresh: () => load(true) };
}

// Keep the selected model visible even when the live list doesn't include it (e.g. it was retired),
// so the menu never shows nothing as active.
export function withCurrent(models: ModelOption[], current: string): ModelOption[] {
  if (!current || models.some((m) => m.id === current)) return models;
  return [{ id: current, label: current }, ...models];
}
