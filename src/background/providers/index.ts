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
