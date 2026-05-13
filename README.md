# DODO

Open-source Chrome side-panel browser agent. Bring your own Gemini API key.

## Stack

- Manifest V3 · `chrome.sidePanel` · React 18 · TypeScript · Vite
- Provider abstraction (`src/background/providers/`) — Gemini is the only registered provider today; drop more in there to add them.
- Default model: `gemini-3.1-flash-lite`.

## Develop

```sh
npm install
npm run build      # one-shot
npm run dev        # vite watch mode
npm run typecheck
```

## Load in Chrome

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. First install opens the onboarding tab — paste your Gemini API key (get one at `aistudio.google.com/apikey`), verify, set your allowlist, finish.
4. Click the DODO toolbar icon or press `⌘⇧D` (mac) / `Ctrl+Shift+D` to open the side panel.

## Architecture

- **Side panel** (`src/sidepanel/`) — React UI, talks to the background over a long-lived port.
- **Background service worker** (`src/background/`) — owns the agent loop, Gemini calls, tool dispatch, permission gate, and `chrome.storage.local` persistence.
- **Content script** (`src/content/`) — injected on demand; performs DOM ops (`click`, `type`, `extract`, `snapshot`).

## Tool surface

The agent can call: `navigate`, `screenshot`, `click`, `type`, `extract`, `done`. Each call is gated against the user's allowlist; if a host is not allowed, the side panel surfaces a permission prompt and the agent pauses until the user decides.

## Storage

Everything lives in `chrome.storage.local`:

```ts
{
  settings: { providerId, apiKey, model, defaultMode, confirmNavigation, screenshotRedaction, telemetry, onboarded },
  allowlist: string[],
  history: HistoryItem[],
}
```

The API key never leaves your machine except to call the configured provider's endpoint.
