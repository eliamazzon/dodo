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

export type ChatResponse =
  | {
      kind: 'tool_call';
      calls: { name: string; args: Record<string, unknown>; id: string; thoughtSignature?: string }[];
    }
  | { kind: 'text'; text: string };

export interface ModelProvider {
  id: string;
  label: string;
  defaultModel: string;
  availableModels: { id: string; label: string }[];
  verifyKey(apiKey: string): Promise<{ ok: boolean; error?: string }>;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
