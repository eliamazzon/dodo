import { r as reactExports, j as jsxRuntimeExports, D as DODO_FONT, e as DODO_LIGHT, P as PanelShell, W as Wordmark, B as Body, G as GhostBtn, c as PrimaryBtn, g as DodoMark, I as Ic, f as createRoot } from './atoms-CUAwgaxC.js';
import { G as GeminiProvider } from './gemini-n0K2crwM.js';
import { D as DEFAULT_SETTINGS } from './types-C5_6h52x.js';

const DEFAULT_ALLOW = ["*.google.com", "*.github.com", "*.notion.so", "*.wikipedia.org"];
function Onboarding() {
  const c = DODO_LIGHT;
  const [step, setStep] = reactExports.useState(1);
  const [settings, setSettings] = reactExports.useState(DEFAULT_SETTINGS);
  const [allowlist, setAllowlist] = reactExports.useState(DEFAULT_ALLOW);
  reactExports.useEffect(() => {
    chrome.storage.local.get(["settings", "allowlist"]).then((raw) => {
      if (raw.settings) setSettings({ ...DEFAULT_SETTINGS, ...raw.settings });
      if (raw.allowlist) setAllowlist(raw.allowlist);
    });
  }, []);
  const dot = (i) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
    width: 5,
    height: 5,
    borderRadius: 1,
    background: i === step - 1 ? c.accent : c.faint
  } });
  const next = async () => {
    if (step === 4) {
      await chrome.storage.local.set({
        settings: { ...settings, onboarded: true },
        allowlist
      });
      window.close();
      return;
    }
    setStep(step + 1);
  };
  const back = () => setStep((s) => Math.max(1, s - 1));
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: c.bg,
    fontFamily: DODO_FONT
  }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(PanelShell, { c, w: 460, h: 720, style: { borderRadius: 10, border: `1px solid ${c.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.08)" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      padding: "14px 16px",
      display: "flex",
      alignItems: "center",
      gap: 5,
      borderBottom: `1px solid ${c.border}`
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Wordmark, { size: 13 }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 } }),
      [0, 1, 2, 3].map((i) => /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.Fragment, { children: dot(i) }, i)),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1, maxWidth: 8 } }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { fontSize: 10.5, color: c.subtle }, children: [
        step,
        "/4"
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Body, { c, pad: "24px 28px 0", children: [
      step === 1 && /* @__PURE__ */ jsxRuntimeExports.jsx(Welcome, {}),
      step === 2 && /* @__PURE__ */ jsxRuntimeExports.jsx(
        Provider,
        {
          settings,
          onChange: (p) => setSettings({ ...settings, ...p })
        }
      ),
      step === 3 && /* @__PURE__ */ jsxRuntimeExports.jsx(
        Sites,
        {
          list: allowlist,
          onAdd: (s) => setAllowlist([...allowlist, s]),
          onRemove: (s) => setAllowlist(allowlist.filter((x) => x !== s))
        }
      ),
      step === 4 && /* @__PURE__ */ jsxRuntimeExports.jsx(Ready, { settings, allowlist })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      display: "flex",
      gap: 8,
      padding: "12px 16px",
      borderTop: `1px solid ${c.border}`
    }, children: [
      step > 1 && /* @__PURE__ */ jsxRuntimeExports.jsx(GhostBtn, { c, onClick: back, children: "back" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 } }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(PrimaryBtn, { c, kbd: "⏎", onClick: next, children: step === 4 ? "start" : "continue" })
    ] })
  ] }) });
}
function Welcome() {
  const c = DODO_LIGHT;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
      width: 56,
      height: 56,
      borderRadius: 10,
      border: `1.5px solid ${c.accent}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 18,
      color: c.accent
    }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(DodoMark, { size: 34, color: c.accent }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { style: {
      fontFamily: DODO_FONT,
      fontSize: 20,
      fontWeight: 600,
      margin: "0 0 10px",
      lineHeight: 1.3,
      letterSpacing: "-0.01em"
    }, children: "welcome to dodo." }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { fontSize: 13, color: c.muted, lineHeight: 1.6, margin: 0 }, children: "an open-source browser agent powered by gemini. point it at a task, watch it work in your current tab, stop it anytime." }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      marginTop: 22,
      padding: "12px 14px",
      border: `1px dashed ${c.border}`,
      borderRadius: 6,
      background: c.surface,
      fontSize: 12,
      color: c.muted,
      lineHeight: 1.55
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.subtle }, children: "# note" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("br", {}),
      "dodo only sees pages you've explicitly allowed. your api key stays on this machine."
    ] })
  ] });
}
function Provider({
  settings,
  onChange
}) {
  const c = DODO_LIGHT;
  const [verifying, setVerifying] = reactExports.useState(false);
  const [verifyMsg, setVerifyMsg] = reactExports.useState(null);
  const verify = async () => {
    setVerifying(true);
    setVerifyMsg(null);
    const r = await GeminiProvider.verifyKey(settings.apiKey);
    setVerifying(false);
    setVerifyMsg({ ok: r.ok, text: r.ok ? "key verified · models reachable" : r.error ?? "verification failed" });
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 10.5, color: c.subtle, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }, children: "step 1 of 3" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { style: { fontFamily: DODO_FONT, fontSize: 17, fontWeight: 600, margin: "0 0 12px" }, children: "choose your provider" }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        padding: "10px 12px",
        borderRadius: 6,
        border: `1px solid ${c.accent}`,
        background: c.accentBg,
        display: "flex",
        alignItems: "center",
        gap: 10
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
          width: 14,
          height: 14,
          borderRadius: 3,
          border: `1.5px solid ${c.accent}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { width: 6, height: 6, background: c.accent, borderRadius: 1 } }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { flex: 1 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 13, fontWeight: 600 }, children: "google · gemini" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 10.5, color: c.muted, marginTop: 2 }, children: "gemini-3.1-flash-lite · bring your own api key" })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
        padding: "10px 12px",
        borderRadius: 6,
        border: `1px dashed ${c.border}`,
        background: c.surface,
        fontSize: 11.5,
        color: c.subtle
      }, children: "more providers coming soon · anthropic · openai · ollama" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12, color: c.ink, marginBottom: 6 }, children: "your gemini api key" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "input",
      {
        type: "text",
        value: settings.apiKey,
        onChange: (e) => onChange({ apiKey: e.target.value }),
        placeholder: "AIza…",
        style: {
          width: "100%",
          boxSizing: "border-box",
          padding: "9px 11px",
          fontFamily: DODO_FONT,
          fontSize: 12,
          borderRadius: 5,
          border: `1px solid ${c.border}`,
          background: c.surface2,
          color: c.ink,
          outline: "none"
        }
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: verify, disabled: !settings.apiKey || verifying, style: {
        padding: "6px 12px",
        borderRadius: 4,
        border: `1px solid ${c.border}`,
        background: c.surface2,
        color: c.ink,
        fontFamily: DODO_FONT,
        fontSize: 11.5,
        cursor: settings.apiKey && !verifying ? "pointer" : "default",
        opacity: settings.apiKey && !verifying ? 1 : 0.5
      }, children: verifying ? "verifying…" : "verify key" }),
      verifyMsg && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 11, color: verifyMsg.ok ? c.success : c.error }, children: verifyMsg.text })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 14, fontSize: 11, color: c.muted, lineHeight: 1.55 }, children: [
      "get a free key at ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.accent }, children: "aistudio.google.com/apikey" }),
      "."
    ] })
  ] });
}
function Sites({
  list,
  onAdd,
  onRemove
}) {
  const c = DODO_LIGHT;
  const [draft, setDraft] = reactExports.useState("");
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 10.5, color: c.subtle, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }, children: "step 2 of 3" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { style: { fontFamily: DODO_FONT, fontSize: 17, fontWeight: 600, margin: "0 0 8px" }, children: "starting allowlist" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { fontSize: 12, color: c.muted, margin: "0 0 16px", lineHeight: 1.55 }, children: "dodo can only touch sites you've allowed. you can change this at any time." }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      border: `1px solid ${c.border}`,
      borderRadius: 6,
      background: c.surface2,
      padding: 4
    }, children: [
      list.map((s) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 4,
        fontSize: 12.5
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Globe, { size: 13, style: { color: c.muted } }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 }, children: s }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.X, { size: 12, style: { color: c.subtle, cursor: "pointer" }, onClick: () => onRemove(s) })
      ] }, s)),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        fontSize: 12.5,
        color: c.subtle,
        borderTop: list.length ? `1px solid ${c.border}` : "none",
        marginTop: 4
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Plus, { size: 13 }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            value: draft,
            placeholder: "add domain or pattern…",
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter" && draft.trim()) {
                onAdd(draft.trim());
                setDraft("");
              }
            },
            style: {
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: DODO_FONT,
              fontSize: 12.5,
              color: c.ink
            }
          }
        )
      ] })
    ] })
  ] });
}
function Ready({ settings, allowlist }) {
  const c = DODO_LIGHT;
  const mode = settings.defaultMode;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 10.5, color: c.success, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }, children: "$ ready" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { style: { fontFamily: DODO_FONT, fontSize: 20, fontWeight: 600, margin: "0 0 14px" }, children: "you're set." }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      background: c.surface2,
      border: `1px solid ${c.border}`,
      borderRadius: 6,
      padding: "12px 14px",
      fontSize: 12,
      lineHeight: 1.7
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.muted }, children: "provider " }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.accent }, children: "gemini" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.muted }, children: "model    " }),
        settings.model
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.muted }, children: "hosts    " }),
        allowlist.length,
        " allowed"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.muted }, children: "mode     " }),
        mode === "ask" ? "ask before acting" : mode === "auto" ? "act on allowlist" : "watch only"
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { fontSize: 12, color: c.muted, margin: "14px 0 0", lineHeight: 1.55 }, children: [
      "pin dodo to your toolbar to open it from any tab. press",
      " ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("kbd", { style: { background: c.surface, border: `1px solid ${c.border}`, padding: "0 4px", borderRadius: 3, fontFamily: DODO_FONT, fontSize: 10.5 }, children: "⌘⇧D" }),
      " ",
      "to summon it anywhere."
    ] })
  ] });
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Onboarding, {}) })
  );
}
//# sourceMappingURL=onboarding-PBg3avwl.js.map
