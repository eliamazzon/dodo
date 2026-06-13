<div align="center">

<img src="public/icons/spark-128.png" width="96" height="96" alt="DODO" />

# DODO

**A browser agent that lives in your Chrome side panel — tell it what to do in plain English, and it clicks, types, and reads pages for you.**

Open source · bring your own [Gemini](https://aistudio.google.com/apikey) key · your data stays on your machine.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-6b4ea3)
![React 18](https://img.shields.io/badge/React-18-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![License: MIT](https://img.shields.io/badge/License-MIT-green)
![BYOK Gemini](https://img.shields.io/badge/BYOK-Gemini-1a73e8)

</div>

## ✦ Quickstart

One command — clones, builds, and walks you through loading DODO into the browser and profile you choose:

```sh
curl -fsSL https://raw.githubusercontent.com/eliamazzon/dodo/main/install.sh | sh
```

It detects your installed Chromium browsers (Chrome, Brave, Edge, Chromium), lets you pick a browser and profile, opens that exact profile at `chrome://extensions`, and copies the build path to your clipboard. Then you click **Load unpacked** and paste — the one step Chrome requires you to do by hand for unpacked extensions.

First load opens an onboarding tab: paste your Gemini API key (get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)), set your site allowlist, and you're done. Open DODO any time with **`Alt+L`** or the toolbar icon.

<details>
<summary>Already cloned, or prefer to do it manually?</summary>

```sh
npm install
npm run build
npm run setup        # the same guided picker (build + open + clipboard)
```

Or fully by hand:

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Onboarding opens automatically; add your Gemini key and allowlist.

</details>

## What it does

- **Natural-language automation** — describe a task; DODO drives the page one action at a time with `snapshot` / `click` / `type` / `navigate` / `press` / `extract`.
- **Permission gating** — every host is checked against your allowlist. Hit a new site and the panel surfaces an inline approve/deny prompt; the agent pauses until you decide.
- **Modes** — `ask` (confirm each navigation), `auto` (autonomous), `watch` (observe only). Plus per-script approval (`always ask` / `auto accept`).
- **See it work** — an on-page cursor glides to each target with a "thinking" pill, so you can follow along.
- **History** — past runs are kept locally (IndexedDB) and reopenable from the panel.

## Architecture

```
Side panel (React)  ──port──▶  Service worker  ──inject──▶  Content script
 chat · settings ·             agent loop · Gemini          DOM ops on the
 history · approvals           calls · tool dispatch ·      active tab: snapshot,
                               permission gate              click, type, extract
```

- **Side panel** (`src/sidepanel/`) — React UI, talks to the background over a long-lived port.
- **Background service worker** (`src/background/`) — owns the agent loop, Gemini calls, tool dispatch, the permission gate, and persistence.
- **Content script** (`src/content/`) — injected on demand; performs DOM operations and draws the cursor overlay.
- **Providers** (`src/background/providers/`) — Gemini is the only registered provider today; drop another in here to add it. Default model: `gemini-3.5-flash`.

## Tool surface

The agent can call: `snapshot`, `screenshot`, `navigate`, `click`, `type`, `press`, `extract`, `list_tabs`, `switch_tab`. Each navigation is gated against your allowlist.

## Storage

- **`chrome.storage.local`** — settings + host allowlist.
- **IndexedDB (via Dexie)** — run history.

## Privacy

- Your **API key is stored locally** and is sent only to Google's Gemini endpoint when the agent runs.
- Page content the agent reads (snapshots, extracted text, screenshots) is sent to Gemini as context for your task — same as any LLM call.
- DODO fetches your **approximate location** (city/country) from [`ipapi.co`](https://ipapi.co) at the start of a run so the model has accurate date/place context; this sends your IP to that service. It's the only third-party call besides Gemini.
- **No telemetry.** Nothing is reported to the project's authors.

## Develop

```sh
npm install
npm run build       # one-shot build to dist/
npm run dev         # vite watch mode
npm run typecheck
```

**Stack:** Manifest V3 · `chrome.sidePanel` · React 18 · TypeScript · Vite · Dexie.

## License

[MIT](LICENSE) © Elia Mazzon

## Star History

<div align="center">
<a href="https://star-history.com/#eliamazzon/dodo&Date">
  <img src="https://api.star-history.com/svg?repos=eliamazzon/dodo&type=Date" alt="DODO Star History Chart" width="600" />
</a>
</div>
