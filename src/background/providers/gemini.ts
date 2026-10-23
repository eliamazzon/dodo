// Gemini API provider — translates the internal ChatMessage format to Gemini's generateContent REST API.
import type { ModelProvider, ChatRequest, ChatResponse, ChatMessage } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(url, init);
      if (res.ok || !RETRYABLE_STATUSES.has(res.status) || attempt === MAX_RETRIES) return res;
      lastErr = res.status;
      console.warn('%c[dodo]', 'color:#6b4ea3;font-weight:600', `gemini ${res.status} — retrying (attempt ${attempt + 1}/${MAX_RETRIES})`);
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_RETRIES) throw e;
      console.warn('%c[dodo]', 'color:#6b4ea3;font-weight:600', `gemini fetch error — retrying`, e);
    }
    // A 429's Retry-After tells us exactly how long the quota window needs — honor it over the
    // blind exponential backoff when present (capped so a misbehaving/huge header can't stall us).
    const retryAfterSec = Number(res?.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(15000, retryAfterSec * 1000)
      : Math.min(8000, 600 * 2 ** attempt) + Math.floor(Math.random() * 400);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(`gemini retries exhausted: ${String(lastErr)}`);
}

type GeminiPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
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
    if (!parts.length) continue;
    // Our 'tool' and 'user' roles both map to Gemini 'user'. A run that ends on a tool result
    // (propose_plan, stop mid-batch) is followed by a user message — fold it into the same content
    // so Gemini always sees strictly alternating turns.
    const prev = out[out.length - 1];
    if (role === 'user' && prev?.role === 'user') prev.parts.push(...parts);
    else out.push({ role, parts });
  }
  return out;
}

type GeminiModel = { name?: string; supportedGenerationMethods?: string[] };

// models.list is paginated (default page size 50), so a single request can silently miss models.
// Follow nextPageToken until it runs out.
async function fetchAllModels(apiKey: string): Promise<GeminiModel[]> {
  const all: GeminiModel[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await fetch(`${BASE}/models?${qs}`, { headers: { 'x-goog-api-key': apiKey } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${body.slice(0, 160)}`);
    }
    const data = (await res.json()) as { models?: GeminiModel[]; nextPageToken?: string };
    all.push(...(data.models ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return all;
}

// The agent needs plain text-in/text-out with function calling. These families also answer
// generateContent but can't drive it (speech, image generation, live/audio, embeddings, etc.).
const NON_CHAT = /(tts|image|embedding|live|audio|computer-use|robotics|aqa|learnlm)/;

const modelId = (m: GeminiModel) => (m.name ?? '').replace(/^models\//, '');

// Newest version first, then by name — "gemini-3.5-flash" before "gemini-2.5-pro".
function versionOf(id: string): number {
  const m = /^gemini-(\d+(?:\.\d+)?)/.exec(id);
  return m ? parseFloat(m[1]) : 0;
}

export const GeminiProvider: ModelProvider = {
  id: 'gemini',
  label: 'google · gemini api',
  defaultModel: 'gemini-3.5-flash',
  availableModels: [
    { id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (most capable)' },
    { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash (recommended)' },
    { id: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
    { id: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite (cheaper)' },
  ],

  async verifyKey(apiKey: string) {
    if (!apiKey || !apiKey.trim()) return { ok: false, error: 'empty api key' };
    try {
      const models = await fetchAllModels(apiKey);
      if (models.length === 0) return { ok: false, error: 'no models returned' };
      const reachable = new Set(models.map(modelId));
      const supportedModels = GeminiProvider.availableModels
        .map((m) => m.id)
        .filter((id) => reachable.has(id));
      return { ok: true, supportedModels };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  async listModels(apiKey: string) {
    const models = await fetchAllModels(apiKey);
    const live = models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map(modelId)
      .filter((id) => id.startsWith('gemini-') && !NON_CHAT.test(id));
    const liveIds = new Set(live);
    const catalog = GeminiProvider.availableModels.filter((m) => liveIds.has(m.id));
    const catalogIds = new Set(catalog.map((m) => m.id));
    // Extras are labelled by id, matching how the header shows the current model.
    const rest = live
      .filter((id) => !catalogIds.has(id))
      .sort((a, b) => versionOf(b) - versionOf(a) || a.localeCompare(b))
      .map((id) => ({ id, label: id }));
    return [...catalog, ...rest];
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

    const url = `${BASE}/models/${encodeURIComponent(req.model)}:generateContent`;
    const payload = JSON.stringify(body);
    // Ground-truth log of the exact wire body sent to Gemini (post-transform, post-prune).
    console.log('%c[dodo]', 'color:#6b4ea3;font-weight:600', `gemini ${req.model} → ${payload.length} chars`, body);
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
      body: payload,
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`gemini ${res.status}: ${errBody.slice(0, 240)}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
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
        // Gemini 3.x thinking models return reasoning as parts flagged `thought:true`. These are
        // NOT the answer — including them leaks thinking fragments (e.g. a bare step number) as the
        // final response. Only accumulate real answer text.
        if (p.thought) continue;
        textOut += p.text;
      }
    }
    // If thinking ate the output budget we can get a turn with no answer and no call. Surface it as
    // empty (the agent loop retries) rather than emitting a truncated thought fragment.
    if (!calls.length && !textOut && candidate?.finishReason && candidate.finishReason !== 'STOP') {
      console.warn('%c[dodo]', 'color:#6b4ea3;font-weight:600', `gemini finishReason=${candidate.finishReason} with no answer/call`);
    }
    const usage = data.usageMetadata
      ? { input: data.usageMetadata.promptTokenCount ?? 0, output: data.usageMetadata.candidatesTokenCount ?? 0 }
      : undefined;
    if (calls.length) return { kind: 'tool_call', calls, usage, text: textOut || undefined };
    return { kind: 'text', text: textOut, usage };
  },
};

