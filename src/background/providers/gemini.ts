// Gemini API provider — translates the internal ChatMessage format to Gemini's generateContent REST API.
import type { ModelProvider, ChatRequest, ChatResponse, ChatMessage } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || !RETRYABLE_STATUSES.has(res.status) || attempt === MAX_RETRIES) return res;
      lastErr = res.status;
      console.warn('%c[dodo]', 'color:#6b4ea3;font-weight:600', `gemini ${res.status} — retrying (attempt ${attempt + 1}/${MAX_RETRIES})`);
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_RETRIES) throw e;
      console.warn('%c[dodo]', 'color:#6b4ea3;font-weight:600', `gemini fetch error — retrying`, e);
    }
    const wait = Math.min(8000, 600 * 2 ** attempt) + Math.floor(Math.random() * 400);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(`gemini retries exhausted: ${String(lastErr)}`);
}

type GeminiPart =
  | { text: string; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: { result?: unknown; error?: string } } };

type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [];
    for (const p of m.parts) {
      if (p.type === 'text') parts.push({ text: p.text });
      else if (p.type === 'image') parts.push({ inlineData: { mimeType: p.mimeType, data: p.base64 } });
      else if (p.type === 'tool_call') {
        const fc: GeminiPart = { functionCall: { name: p.name, args: (p.args as Record<string, unknown>) ?? {} } };
        if (p.thoughtSignature) fc.thoughtSignature = p.thoughtSignature;
        parts.push(fc);
      }
      else if (p.type === 'tool_result') {
        const response = p.isError
          ? { error: typeof p.result === 'string' ? p.result : JSON.stringify(p.result) }
          : { result: p.result };
        parts.push({ functionResponse: { name: p.name, response } });
      }
    }
    if (parts.length) out.push({ role, parts });
  }
  return out;
}

export const GeminiProvider: ModelProvider = {
  id: 'gemini',
  label: 'google · gemini api',
  defaultModel: 'gemini-3.1-flash-lite',
  availableModels: [
    { id: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
  ],

  async verifyKey(apiKey: string) {
    if (!apiKey || !apiKey.trim()) return { ok: false, error: 'empty api key' };
    try {
      const res = await fetch(`${BASE}/models?key=${encodeURIComponent(apiKey)}`);
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `${res.status} ${body.slice(0, 160)}` };
      }
      const data = (await res.json()) as { models?: unknown[] };
      if (!data.models || data.models.length === 0) return { ok: false, error: 'no models returned' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      systemInstruction: { role: 'system', parts: [{ text: req.systemPrompt }] },
      contents: toGeminiContents(req.messages),
    };

    if (req.tools.length) {
      body.tools = [{
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }

    if (req.jsonResponse) {
      body.generationConfig = { responseMimeType: 'application/json' };
    }

    const url = `${BASE}/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`gemini ${res.status}: ${errBody.slice(0, 240)}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] } }[];
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const calls: { name: string; args: Record<string, unknown>; id: string; thoughtSignature?: string }[] = [];
    let textOut = '';
    for (const p of parts) {
      if ('functionCall' in p && p.functionCall) {
        calls.push({
          name: p.functionCall.name,
          args: (p.functionCall.args as Record<string, unknown>) ?? {},
          id: `${p.functionCall.name}_${Date.now()}_${calls.length}`,
          thoughtSignature: p.thoughtSignature,
        });
      } else if ('text' in p && typeof p.text === 'string') {
        textOut += p.text;
      }
    }
    if (calls.length) return { kind: 'tool_call', calls };
    return { kind: 'text', text: textOut };
  },
};
