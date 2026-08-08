<div align="center">

<img src="public/icons/spark-128.png" width="96" height="96" alt="DODO" />

# DODO

**The fast as fuck browser agent.** Lives in your Chrome side panel, drives the page with the fewest LLM calls and the fewest tokens it can get away with — diffs instead of full-page dumps, short refs instead of verbose selectors, one orchestrator loop instead of a planner-then-executor round-trip. Tell it what to do in plain English; it gets there fast.

Open source · bring your own [Gemini](https://aistudio.google.com/apikey) key · your data stays on your machine.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-6b4ea3)
![React 18](https://img.shields.io/badge/React-18-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![License: MIT](https://img.shields.io/badge/License-MIT-green)
![BYOK Gemini](https://img.shields.io/badge/BYOK-Gemini-1a73e8)

</div>

## ✦ Quickstart

One command — clones, builds, and walks you through loading DODO into your browser:

```sh
curl -fsSL https://raw.githubusercontent.com/eliamazzon/dodo/main/install.sh | sh
```

It copies `chrome://extensions` to your clipboard, then swaps in the build path once you're at the file picker. Then you click **Load unpacked** and paste — the one step Chrome requires you to do by hand for unpacked extensions.

First load opens an onboarding tab: paste your Gemini API key (get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)), set your site allowlist, and you're done. Open DODO any time with **`Alt+L`** or the toolbar icon.

<details>
<summary>Already cloned, or prefer to do it manually?</summary>

```sh
npm install
npm run build
npm run setup        # the same guided walkthrough (build + clipboard)
```

Or fully by hand:

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Onboarding opens automatically; add your Gemini key and allowlist.

</details>

## ✦ Updating

DODO installs unpacked from a git checkout, so Chrome's built-in auto-update doesn't apply — and MV3 forbids an extension from loading new code at runtime. Instead, DODO watches the repo and tells you when there's something to pick up.

Every few hours the background worker asks GitHub whether commits have landed on `main` since the commit your copy was built from. If any have, the side panel shows an **update available** banner listing what changed. Two clicks from there:

1. **copy update command** — puts `cd <your checkout> && npm run update` on your clipboard. Run it: it pulls, reinstalls dependencies if the lockfile moved, and rebuilds `dist/`.
2. **reload DODO** — reloads the extension so Chrome re-reads `dist/` from disk. (Same as hitting Reload on `chrome://extensions`.)

The banner clears itself afterwards: the rebuilt copy carries the new commit, so the next check comes back clean.

You can run the update by hand at any time:

```sh
npm run update
```

It refuses to run on a dirty working tree rather than clobbering local changes, and tells you which files are in the way.

**What's actually sent:** a single unauthenticated GET to `api.github.com` comparing two commit SHAs. No identifiers, no telemetry, and nothing is ever downloaded or executed on its own — the banner only ever *tells you* to run a command. Turn the checks off entirely in **Settings → updates → check for updates**; the same section shows the version and commit your copy was built from.

## Why it's fast

Every design decision trades toward fewer round-trips to the model and fewer tokens per round-trip:

- **Diffs, not page dumps** — `click()` and `type()` return what changed, not the whole DOM. The model doesn't need to re-snapshot after every step just to see the result of its own action.
- **Short refs, not CSS selectors** — `snapshot()` tags interactive elements with a compact ref (`data-sel="e42"`); the model passes that back instead of generating and re-parsing verbose selectors, shrinking both the input and output side of every call.
- **Drill-down, not re-fetch** — `snapshot({element})` expands just the one container you actually need — a dropdown, a table, a dialog — instead of pulling the entire page again.
- **One loop, no ceremony** — a single orchestrator drives the whole task end to end. No separate planning call, no forced summary step between actions — just the next action, as soon as the model knows what it is.

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
- DODO fetches your **approximate location** (city/country) from [`ipapi.co`](https://ipapi.co) at the start of a run so the model has accurate date/place context; this sends your IP to that service.
- DODO asks **`api.github.com`** every few hours whether this repo has new commits, so it can tell you an update is available. Public, unauthenticated, no identifiers — just two commit SHAs. Disable it in **Settings → updates**. See [Updating](#-updating).
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

<a href="https://www.star-history.com/?type=date&repos=eliamazzon%2Fdodo">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=eliamazzon/dodo&type=date&theme=dark&legend=top-left&sealed_token=VWoGvQZc6Hn6413YZ590gubh7Ygy3dRLtkuL-t3m5wMxmwnvF9GHTv3Pr4WqjKE8KtPqxVU6HR5fjWoa73XWBYCD_afTQJ2Gt8gnYQFdHKqrQdNe2uP46AOh_r4VVk483Bd_nYAzjCFRQsF5" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=eliamazzon/dodo&type=date&legend=top-left&sealed_token=VWoGvQZc6Hn6413YZ590gubh7Ygy3dRLtkuL-t3m5wMxmwnvF9GHTv3Pr4WqjKE8KtPqxVU6HR5fjWoa73XWBYCD_afTQJ2Gt8gnYQFdHKqrQdNe2uP46AOh_r4VVk483Bd_nYAzjCFRQsF5" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=eliamazzon/dodo&type=date&legend=top-left&sealed_token=VWoGvQZc6Hn6413YZ590gubh7Ygy3dRLtkuL-t3m5wMxmwnvF9GHTv3Pr4WqjKE8KtPqxVU6HR5fjWoa73XWBYCD_afTQJ2Gt8gnYQFdHKqrQdNe2uP46AOh_r4VVk483Bd_nYAzjCFRQsF5" />
 </picture>
</a>
