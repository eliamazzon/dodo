import type { ModelProvider } from './types';
import { GeminiProvider } from './gemini';

const REGISTRY: Record<string, ModelProvider> = {
  [GeminiProvider.id]: GeminiProvider,
};

export function getProvider(id: string): ModelProvider {
  return REGISTRY[id] ?? GeminiProvider;
}

export function listProviders(): ModelProvider[] {
  return Object.values(REGISTRY);
}

// `availableModels` is ordered most-capable → cheapest. Auto-selection prefers the best flash
// model over "pro" tier ones — pro is powerful but slow/expensive, so it should only be used if
// the user explicitly picks it in Settings, never landed on automatically. Pro is still used as a
// last resort if it's the only thing the key supports.
export function pickBestModel(provider: ModelProvider, supportedModels?: string[]): string {
  if (!supportedModels || !supportedModels.length) return provider.defaultModel;
  const flashModels = provider.availableModels.filter((m) => !m.id.includes('pro'));
  const best = flashModels.find((m) => supportedModels.includes(m.id))
    ?? provider.availableModels.find((m) => supportedModels.includes(m.id));
  return best?.id ?? provider.defaultModel;
}
