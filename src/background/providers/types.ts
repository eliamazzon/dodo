import type { ToolSchema } from '../../shared/types';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; base64: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown; thoughtSignature?: string }
  | { type: 'tool_result'; id: string; name: string; result: unknown; isError?: boolean };

export type ChatMessage = {
  role: 'user' | 'assistant' | 'tool';
  parts: ContentPart[];
};

export type ChatRequest = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  jsonResponse?: boolean;
};

export type TokenUsage = { input: number; output: number };

export type ChatResponse =
  | {
      kind: 'tool_call';
      calls: { name: string; args: Record<string, unknown>; id: string; thoughtSignature?: string }[];
      usage?: TokenUsage;
      // Narration text the model returned alongside the tool calls in the same turn (e.g. Gemini
      // often emits a short "I'll check the search results" before calling a tool). Optional —
      // absent when the provider/turn produced no accompanying text.
      text?: string;
    }
  | { kind: 'text'; text: string; usage?: TokenUsage };

export interface ModelProvider {
  id: string;
  label: string;
  defaultModel: string;
  availableModels: { id: string; label: string }[];
  // `supportedModels` (subset of `availableModels[].id`) is populated on success — it's the
  // catalog models this specific key can actually reach, used to steer the default model choice.
  verifyKey(apiKey: string): Promise<{ ok: boolean; error?: string; supportedModels?: string[] }>;
  // Every chat-capable model this key can reach, live from the provider's API. Catalog models come
  // first (in `availableModels` order, with their curated labels), then the rest. Throws on failure.
  listModels(apiKey: string): Promise<{ id: string; label: string }[]>;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
