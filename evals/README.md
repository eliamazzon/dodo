# DODO evals in Brave

The CLI uses raw Chrome DevTools Protocol (CDP) with Node's built-in `fetch` and `WebSocket`; it has no Playwright dependency and attaches only to DODO's service worker. API keys remain inside the extension. Use Node 22+ with global WebSocket (developed with Node 25).

## One-time setup

1. Run `npm run build:eval`.
2. Run `npm run eval:browser`. This opens **Brave**, runs no tasks, and keeps a separate persistent profile at `~/.dodo-eval-profile`.
3. In that Brave window open `brave://extensions`, enable Developer mode, choose **Load unpacked**, and select this repo's `dist-eval/` directory. Finish onboarding and enter your API key.
4. Log into LinkedIn and any other task sites in this profile. Keep it open.
5. Run `npm run eval -- --only wikipedia-sanity --runs 1` for the first discovery and smoke test. It remembers the profile's unique instance ID and extension ID in ignored files.

Quit and reopen with `npm run eval:browser` to reuse the same profile, extension and site logins. With Brave open, subsequent eval commands attach to it. `npm run eval -- --launch` launches it when needed. Rebuild with `npm run build:eval` and click Reload in `brave://extensions` after extension source changes. The daily build uses `dist/`, which has a separate extension ID and no eval hook.

## Running tasks

```sh
npm run eval -- --only wikipedia-sanity --runs 1
npm run eval -- --only trenitalia-milano-roma,omio-milano-paris --runs 3
npm run eval -- --no-judge
npm run eval -- --port 9223 --instance <profile-instance-uuid>
npm run test:eval
```

Tasks run serially, three times each by default. Each run uses a fresh window, pins its tab, temporarily sets auto approval and disables notifications, then restores those settings and closes that window. Critical checkout/payment actions are always declined. **Amazon adds a real item to the cart**, so review or clear that cart afterward. Existing persistent site grants still apply; `allowedHosts` controls new permission prompts, and any denied host fails grading. Use a dedicated eval profile without broad saved grants for reproducible permission tests.

The rubric judge uses the configured model and API key inside the extension and incurs model usage. `--no-judge` skips it and records that choice in the report. A run passes only if its completion status and every configured deterministic/custom check and enabled judge pass. Login walls detected from the URL or explicit agent text become `needs_login`; log into those sites again with `npm run eval:browser`. Screenshot-only login walls require reviewing the saved screenshot.

Results go to ignored `evals/runs/<timestamp>-<gitsha>/`: each task/run has `result.json`, `trace.json`, and `final.jpg` when capture succeeds. `summary.json` and `summary.md` include pass rates, available token/turn metrics, time and top failure reasons. Summaries are saved after every run. A failing or login-blocked set exits nonzero. Restarted service workers produce `sw_restarted`; the next run reattaches by the same instance identity. After a timeout, an outstanding provider call may keep the worker busy until it settles; the harness rejects new work during that interval.

## Browser and identity options

- `DODO_BRAVE_BINARY`: Brave executable path; defaults to `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser` on macOS, `/usr/bin/brave-browser` on Linux, or the standard Program Files path on Windows.
- `DODO_EVAL_PROFILE`: absolute path to a different persistent Brave user-data directory.
- `DODO_EXT_ID`: extension ID for waking an idle worker before its first successful discovery. Copy it from `brave://extensions`; otherwise `evals/.ext-id` is used after first discovery.
- `--port`: debugging port, default 9222. Bindings stay on loopback. No automation flag is passed.
- `--instance`: select a profile explicitly when more than one responds or when intentionally changing profiles. Ambiguous discovery lists UUID, browser context and worker URL. With `--launch` or `--browser`, an already occupied port must match the remembered profile; first use plain `npm run eval -- --instance <uuid>` to select a new one.

Brave may report no browser context for ordinary profiles, and CDP cannot reliably enumerate or wake every sleeping ordinary-profile worker. Keep the eval profile in its own Brave process and wake DODO in any other profile before testing collisions. Discovery refuses every visible ambiguity, even if a remembered instance exists.

The profile contains live cookies and credentials. Keep it outside the repo; do not copy or commit it. Traces, answers and screenshots can contain site/account data and are ignored by Git. No live browser test is needed for `npm run test:eval`; full verification requires the configured Brave profile and site logins.
