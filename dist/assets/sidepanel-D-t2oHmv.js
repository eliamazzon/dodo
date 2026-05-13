import { r as reactExports, j as jsxRuntimeExports, I as Ic, D as DODO_FONT, P as PanelShell, B as Body, W as Wordmark, a as Disclaimer, U as UserMsg, b as WorkingLine, c as PrimaryBtn, G as GhostBtn, T as Thumb, N as NotifyBanner, d as Toggle3, S as Switch, e as DODO_LIGHT, f as createRoot } from './atoms-hwv2Q3ri.js';
import { D as DEFAULT_SETTINGS, I as INITIAL_AGENT_STATE } from './types-C5_6h52x.js';
import { P as PORT_NAME } from './messages-DSwU0c21.js';

function useAgent() {
  const [snap, setSnap] = reactExports.useState({
    state: INITIAL_AGENT_STATE,
    settings: DEFAULT_SETTINGS,
    allowlist: [],
    history: []
  });
  const portRef = reactExports.useRef(null);
  const unmountedRef = reactExports.useRef(false);
  reactExports.useEffect(() => {
    unmountedRef.current = false;
    const onMessage = (msg) => {
      if (msg.kind === "state") {
        setSnap({ state: msg.state, settings: msg.settings, allowlist: msg.allowlist, history: msg.history });
      }
    };
    const connect = () => {
      if (unmountedRef.current) return;
      const port = chrome.runtime.connect({ name: PORT_NAME });
      portRef.current = port;
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(() => {
        portRef.current = null;
        if (!unmountedRef.current) setTimeout(connect, 200);
      });
    };
    connect();
    const onStorageChange = (changes, area) => {
      if (area !== "local") return;
      setSnap((prev) => ({
        ...prev,
        settings: changes.settings ? { ...DEFAULT_SETTINGS, ...changes.settings.newValue } : prev.settings,
        allowlist: changes.allowlist ? changes.allowlist.newValue ?? prev.allowlist : prev.allowlist,
        history: changes.history ? changes.history.newValue ?? prev.history : prev.history
      }));
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => {
      unmountedRef.current = true;
      try {
        portRef.current?.disconnect();
      } catch {
      }
      portRef.current = null;
      chrome.storage.onChanged.removeListener(onStorageChange);
    };
  }, []);
  const send = (m) => {
    const tryPost = () => {
      try {
        portRef.current?.postMessage(m);
        return true;
      } catch {
        return false;
      }
    };
    if (portRef.current && tryPost()) return;
    const port = chrome.runtime.connect({ name: PORT_NAME });
    portRef.current = port;
    port.onMessage.addListener((msg) => {
      if (msg.kind === "state") {
        setSnap({ state: msg.state, settings: msg.settings, allowlist: msg.allowlist, history: msg.history });
      }
    });
    port.onDisconnect.addListener(() => {
      portRef.current = null;
    });
    try {
      port.postMessage(m);
    } catch {
    }
  };
  return {
    snap,
    submit: (task) => send({ kind: "submit_task", task }),
    continueChat: (text) => send({ kind: "continue_chat", text }),
    approve: () => send({ kind: "approve_plan" }),
    editPlan: () => send({ kind: "edit_plan" }),
    stop: () => send({ kind: "stop" }),
    allow: (host, remember) => send({ kind: "allow_host", host, remember }),
    deny: () => send({ kind: "deny_permission" }),
    retry: () => send({ kind: "retry" }),
    reset: () => send({ kind: "reset" }),
    setMode: (mode) => send({ kind: "set_mode", mode }),
    testNotify: () => send({ kind: "test_notify" })
  };
}
async function saveSettingsDirect(patch) {
  const raw = await chrome.storage.local.get(["settings"]);
  const current = { ...DEFAULT_SETTINGS, ...raw.settings ?? {} };
  await chrome.storage.local.set({ settings: { ...current, ...patch } });
}

function PanelHeader({
  c,
  model = "gemini-3.1-flash-lite",
  provider = "gemini",
  onNewTask,
  onSettings,
  onHistory
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: `1px solid ${c.border}`,
    background: c.bg,
    gap: 8,
    flexShrink: 0
  }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "4px 9px 4px 8px",
      borderRadius: 5,
      border: `1px solid ${c.border}`,
      background: c.surface,
      fontSize: 12,
      minWidth: 0,
      overflow: "hidden"
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { width: 6, height: 6, borderRadius: 1, background: c.accent, flexShrink: 0 } }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { color: c.muted, fontSize: 10.5, flexShrink: 0 }, children: [
        provider,
        "/"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: model }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Chevron, { size: 12, style: { color: c.muted, marginLeft: 2, flexShrink: 0 } })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 4, color: c.muted, flexShrink: 0 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(IcoBtn, { c, onClick: onNewTask, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Plus, { size: 15 }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(IcoBtn, { c, onClick: onHistory, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Clock, { size: 15 }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(IcoBtn, { c, onClick: onSettings, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Cog, { size: 15 }) })
    ] })
  ] });
}
function IcoBtn({ c, children, onClick }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "button",
    {
      type: "button",
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.();
      },
      style: {
        width: 26,
        height: 26,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        borderRadius: 5,
        color: c.muted,
        cursor: "pointer"
      },
      children
    }
  );
}

const MODE_LABEL = {
  ask: "ask before acting",
  auto: "act on allowlist",
  watch: "watch only"
};
const COMMANDS = [
  ["/extract", "pull structured data from this page"],
  ["/summarize", "TL;DR the current tab"],
  ["/watch", "monitor a page for changes"],
  ["/fill", "autofill a form from your clipboard"]
];
const MODE_OPTIONS = [
  { k: "ask", label: "ask before acting", desc: "confirm each action", kbd: "⌘1" },
  { k: "auto", label: "act on allowlist", desc: "no prompt for allowed hosts", kbd: "⌘2" },
  { k: "watch", label: "watch only", desc: "read-only · no actions", kbd: "⌘3" }
];
function Composer({
  c,
  placeholder = "reply to dodo",
  mode = "ask",
  onChangeMode,
  state = "active",
  onSubmit,
  onStop,
  disabled
}) {
  const [value, setValue] = reactExports.useState("");
  const [modeOpen, setModeOpen] = reactExports.useState(false);
  const inputRef = reactExports.useRef(null);
  const slashOpen = value.startsWith("/");
  const q = slashOpen ? value.slice(1).toLowerCase() : "";
  const shownCommands = slashOpen ? COMMANDS.filter(([k]) => k.slice(1).startsWith(q)) : COMMANDS;
  reactExports.useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const submit = () => {
    const t = value.trim();
    if (!t || disabled) return;
    onSubmit?.(t);
    setValue("");
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { margin: "0 12px 12px" }, children: [
    slashOpen && shownCommands.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      border: `1px solid ${c.border}`,
      background: c.surface2,
      borderRadius: 8,
      padding: 4,
      marginBottom: 6,
      boxShadow: `0 4px 14px rgba(0,0,0,0.04)`
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 8px 6px",
        fontSize: 10,
        color: c.subtle,
        letterSpacing: "0.06em"
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "commands" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "↑↓ · ⏎" })
      ] }),
      shownCommands.map(([cmd, hint], i) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "div",
        {
          onClick: () => setValue(cmd + " "),
          style: {
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            padding: "6px 8px",
            borderRadius: 4,
            cursor: "pointer",
            background: i === 0 ? c.accentBg : "transparent",
            fontSize: 12
          },
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.accent, minWidth: 84, fontWeight: 600 }, children: cmd }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.muted, fontSize: 11.5 }, children: hint })
          ]
        },
        cmd
      ))
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      border: `1px solid ${slashOpen ? c.accent : c.border}`,
      background: c.surface2,
      borderRadius: 8,
      padding: "10px 12px 8px",
      boxShadow: slashOpen ? `0 0 0 3px ${c.accentBg}` : "none",
      transition: "box-shadow .15s"
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "textarea",
        {
          ref: inputRef,
          value,
          placeholder: state === "working" ? "agent is running — press stop to halt" : placeholder,
          disabled: state === "working" || disabled,
          onChange: (e) => setValue(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (state === "working") onStop?.();
              else submit();
            }
          },
          rows: 1,
          style: {
            width: "100%",
            resize: "none",
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: DODO_FONT,
            fontSize: 13,
            color: slashOpen ? c.accent : c.ink,
            padding: 0,
            minHeight: 18,
            lineHeight: 1.5,
            opacity: state === "working" ? 0.55 : 1
          }
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", onClick: () => setModeOpen((v) => !v), style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 6px 2px 4px",
          border: "none",
          background: modeOpen ? c.bg : "transparent",
          color: modeOpen ? c.ink : c.muted,
          fontFamily: DODO_FONT,
          fontSize: 11.5,
          cursor: "pointer",
          borderRadius: 4
        }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Hand, { size: 14 }),
          " ",
          MODE_LABEL[mode],
          /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Chevron, { size: 11, style: { transform: modeOpen ? "rotate(180deg)" : void 0, transition: "transform .15s" } })
        ] }),
        modeOpen && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: -4,
          minWidth: 240,
          background: c.surface2,
          border: `1px solid ${c.border}`,
          borderRadius: 7,
          boxShadow: `0 10px 24px rgba(0,0,0,0.10), 0 0 0 1px ${c.border}33`,
          padding: 4,
          zIndex: 5
        }, children: [
          MODE_OPTIONS.map((o) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "div",
            {
              onClick: () => {
                onChangeMode?.(o.k);
                setModeOpen(false);
              },
              style: {
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                cursor: "pointer",
                padding: "7px 9px",
                borderRadius: 4,
                background: o.k === mode ? c.accentBg : "transparent"
              },
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  border: `1.5px solid ${o.k === mode ? c.accent : c.borderHi}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 1,
                  flexShrink: 0
                }, children: o.k === mode && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { width: 5, height: 5, borderRadius: "50%", background: c.accent } }) }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12, fontWeight: 600, color: o.k === mode ? c.accentInk : c.ink }, children: o.label }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 10.5, color: c.muted, marginTop: 1 }, children: o.desc })
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
                  fontSize: 10,
                  color: c.subtle,
                  padding: "1px 5px",
                  border: `1px solid ${c.border}`,
                  borderRadius: 3,
                  flexShrink: 0
                }, children: o.kbd })
              ]
            },
            o.k
          )),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
            borderTop: `1px solid ${c.border}`,
            marginTop: 4,
            padding: "6px 9px",
            fontSize: 10.5,
            color: c.subtle
          }, children: "changes apply to this task only" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 2, color: c.muted }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
            fontSize: 10,
            color: c.subtle,
            marginRight: 6,
            padding: "1px 5px",
            border: `1px solid ${c.border}`,
            borderRadius: 3
          }, children: "/" }),
          state === "working" ? /* @__PURE__ */ jsxRuntimeExports.jsx(IcoBtn, { c, onClick: onStop, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Stop, { size: 17 }) }) : /* @__PURE__ */ jsxRuntimeExports.jsx(IcoBtn, { c, onClick: submit, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Send, { size: 15 }) })
        ] })
      ] })
    ] })
  ] });
}

const SAMPLES = [
  "extract every job posting on this page",
  "find a flight to lisbon under €200",
  "reply to my unread github mentions",
  "collect all comments on this doc"
];
function Empty({
  c,
  mode,
  model,
  onSubmit,
  onChangeMode,
  onNewTask,
  onOpenSettings,
  onOpenHistory
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(PanelShell, { c, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(PanelHeader, { c, model, onNewTask, onSettings: onOpenSettings, onHistory: onOpenHistory }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Body, { c, pad: "0", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      justifyContent: "center",
      padding: "0 22px"
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Wordmark, { size: 22 }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        fontFamily: DODO_FONT,
        fontSize: 13,
        color: c.muted,
        marginTop: 10,
        lineHeight: 1.55
      }, children: [
        "open-source browser agent.",
        /* @__PURE__ */ jsxRuntimeExports.jsx("br", {}),
        "tell it what to do, watch it work,",
        /* @__PURE__ */ jsxRuntimeExports.jsx("br", {}),
        "stop it anytime."
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 28, width: "100%" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
          fontSize: 10,
          color: c.subtle,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 10
        }, children: "try" }),
        SAMPLES.map((s) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "div",
          {
            onClick: () => onSubmit(s),
            style: {
              padding: "9px 12px",
              marginBottom: 6,
              background: c.surface2,
              border: `1px solid ${c.border}`,
              borderRadius: 6,
              fontSize: 12.5,
              color: c.ink,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10
            },
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.accent }, children: "›" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 }, children: s })
            ]
          },
          s
        ))
      ] })
    ] }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Composer, { c, placeholder: "describe a task…", mode, onChangeMode, onSubmit }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Disclaimer, { c })
  ] });
}

function PlanCreating({
  c,
  task,
  model,
  mode,
  onStop,
  onChangeMode,
  onNewTask,
  onOpenSettings,
  onOpenHistory
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(PanelShell, { c, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(PanelHeader, { c, model, onNewTask, onSettings: onOpenSettings, onHistory: onOpenHistory }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Body, { c, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(UserMsg, { c, children: task }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(WorkingLine, { c, label: "working" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, color: c.subtle, padding: "4px 0" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.List, { size: 16 }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 13 }, children: "drafting plan…" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Composer, { c, state: "working", mode, onChangeMode, onStop }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Disclaimer, { c })
  ] });
}

function PlanCard({
  c,
  sites,
  steps,
  onApprove,
  onEdit
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
    border: `1px solid ${c.border}`,
    background: c.surface2,
    borderRadius: 8,
    padding: "12px 14px 14px"
  }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.List, { size: 16, style: { color: c.muted } }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontWeight: 600, fontSize: 13 }, children: "plan.draft" })
    ] }),
    sites.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { borderTop: `1px solid ${c.border}`, paddingTop: 10, marginBottom: 12 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 11, color: c.muted, marginBottom: 6 }, children: "# allowed hosts" }),
      sites.map((s) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "3px 0" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Globe, { size: 14, style: { color: c.muted } }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 12.5 }, children: s })
      ] }, s))
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginBottom: 14 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 11, color: c.muted, marginBottom: 8 }, children: "# steps" }),
      steps.map((s, i) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: 12, padding: "5px 0" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
          flexShrink: 0,
          width: 20,
          height: 20,
          borderRadius: 10,
          border: `1px solid ${c.borderHi}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: c.muted
        }, children: i + 1 }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 13, lineHeight: 1.4, color: c.ink }, children: s })
      ] }, i))
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(PrimaryBtn, { c, kbd: "⏎", full: true, onClick: onApprove, children: "approve plan" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(GhostBtn, { c, kbd: "⌘ ⏎", full: true, onClick: onEdit, children: "edit plan" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 10.5, color: c.subtle, marginTop: 12, lineHeight: 1.45 }, children: "dodo will only touch the hosts above. you'll be asked again before anything else." })
  ] });
}

function PlanApproval({
  c,
  task,
  model,
  plan,
  onApprove,
  onEdit,
  onNewTask,
  onOpenSettings,
  onOpenHistory
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(PanelShell, { c, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(PanelHeader, { c, model, onNewTask, onSettings: onOpenSettings, onHistory: onOpenHistory }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Body, { c, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(UserMsg, { c, children: task }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(WorkingLine, { c, label: "working", animate: false }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18, color: c.muted }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.List, { size: 16 }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 13 }, children: "drafted plan" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(PlanCard, { c, sites: plan.sites, steps: plan.steps, onApprove, onEdit })
    ] })
  ] });
}

const iconFor = (name) => {
  switch (name) {
    case "navigate":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Pointer, { size: 13 });
    case "screenshot":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Camera, { size: 13 });
    case "snapshot":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.List, { size: 13 });
    case "click":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Pointer, { size: 13 });
    case "type":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Bolt, { size: 13 });
    case "extract":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Eye, { size: 13 });
    default:
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Stack, { size: 13 });
  }
};
function ToolCard({
  c,
  title,
  calls,
  elapsedMs,
  status
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
    border: `1px solid ${c.border}`,
    background: c.surface2,
    borderRadius: 8,
    padding: "12px 14px",
    marginBottom: 12
  }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
      fontSize: 12
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.muted }, children: title }),
      elapsedMs != null && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { color: c.subtle, fontSize: 10.5 }, children: [
        (elapsedMs / 1e3).toFixed(1),
        "s elapsed"
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { position: "relative", paddingLeft: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
        position: "absolute",
        left: 5,
        top: 4,
        bottom: 4,
        width: 1,
        background: c.border
      } }),
      calls.map((a, i) => {
        const last = i === calls.length - 1;
        const dotColor = a.status === "error" ? c.error : last && status === "working" ? c.accent : c.success;
        return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10, position: "relative" }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
            position: "absolute",
            left: -18,
            top: 3,
            width: 11,
            height: 11,
            borderRadius: 2,
            background: dotColor,
            boxShadow: `0 0 0 3px ${c.surface2}`
          } }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.muted, marginTop: 1 }, children: iconFor(a.name) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
              fontSize: 12.5,
              color: a.status === "error" ? c.error : c.ink,
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis"
            }, children: a.label ?? a.name }),
            a.detail && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 10.5, color: c.subtle, marginTop: 2 }, children: a.detail })
          ] }),
          a.name === "screenshot" && a.status === "ok" && a.thumb && /* @__PURE__ */ jsxRuntimeExports.jsx(Thumb, { c, size: 26, base64: a.thumb })
        ] }, a.id);
      })
    ] })
  ] });
}

function Working({
  c,
  task,
  model,
  mode,
  calls,
  workingLabel,
  startedAt,
  notifyEnabled,
  onEnableNotify,
  onDismissNotify,
  onStop,
  onChangeMode,
  onSubmit,
  onNewTask,
  onOpenSettings,
  onOpenHistory
}) {
  const elapsed = startedAt ? Date.now() - startedAt : void 0;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(PanelShell, { c, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(PanelHeader, { c, model, onNewTask, onSettings: onOpenSettings, onHistory: onOpenHistory }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Body, { c, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(UserMsg, { c, children: task }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(WorkingLine, { c, label: workingLabel || "working" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12, color: c.muted }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.List, { size: 16 }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 13 }, children: "plan approved" })
      ] }),
      calls.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(
        ToolCard,
        {
          c,
          title: `step ${calls.length} · ${workingLabel ?? "in progress"}`,
          calls,
          elapsedMs: elapsed,
          status: "working"
        }
      )
    ] }),
    !notifyEnabled && /* @__PURE__ */ jsxRuntimeExports.jsx(NotifyBanner, { c, onEnable: onEnableNotify, onClose: onDismissNotify }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Composer, { c, state: "working", mode, onChangeMode, onSubmit, onStop }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Disclaimer, { c })
  ] });
}

function PermissionCard({
  c,
  host,
  reason,
  onAllow,
  onAllowOnce,
  onDeny
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
    border: `1.5px solid ${c.accent}`,
    background: c.surface2,
    borderRadius: 8,
    padding: "14px 16px",
    boxShadow: `0 6px 24px ${c.accentBg}`
  }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
      fontSize: 10,
      color: c.accent,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      marginBottom: 8
    }, children: "permission required" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 14, color: c.ink, lineHeight: 1.4, marginBottom: 4 }, children: "allow dodo to act on" }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 12,
      padding: "5px 10px",
      borderRadius: 5,
      background: c.accentBg,
      color: c.accentInk,
      fontSize: 13,
      fontWeight: 600
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Globe, { size: 13 }),
      " ",
      host
    ] }),
    reason && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      fontSize: 11.5,
      color: c.muted,
      lineHeight: 1.5,
      padding: "8px 10px",
      borderRadius: 5,
      background: c.bg,
      border: `1px dashed ${c.border}`,
      marginBottom: 12
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.subtle }, children: "# why" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("br", {}),
      reason
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(PrimaryBtn, { c, kbd: "⏎", full: true, onClick: onAllow, children: "allow this site" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(GhostBtn, { c, full: true, onClick: onAllowOnce, children: "allow once" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: onDeny, style: {
        background: "transparent",
        border: "none",
        color: c.muted,
        padding: "7px",
        fontFamily: DODO_FONT,
        fontSize: 12,
        cursor: "pointer"
      }, children: "deny" })
    ] })
  ] });
}

function Permissions({
  c,
  task,
  model,
  pending,
  onAllow,
  onAllowOnce,
  onDeny,
  onNewTask,
  onOpenSettings,
  onOpenHistory
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(PanelShell, { c, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(PanelHeader, { c, model, onNewTask, onSettings: onOpenSettings, onHistory: onOpenHistory }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Body, { c, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(UserMsg, { c, children: task }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(WorkingLine, { c, label: "waiting for permission", animate: false }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 16,
        color: c.muted
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Pointer, { size: 16 }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { fontSize: 13 }, children: [
          "navigate to ",
          pending.host
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        PermissionCard,
        {
          c,
          host: pending.host,
          reason: pending.reason,
          onAllow,
          onAllowOnce,
          onDeny
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Disclaimer, { c })
  ] });
}

function ErrorState({
  c,
  task,
  model,
  mode,
  calls,
  errorMsg,
  onRetry,
  onReset,
  onChangeMode,
  onSubmit,
  onNewTask,
  onOpenSettings,
  onOpenHistory
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(PanelShell, { c, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(PanelHeader, { c, model, onNewTask, onSettings: onOpenSettings, onHistory: onOpenHistory }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Body, { c, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(UserMsg, { c, children: task }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(WorkingLine, { c, label: "halted", animate: false }),
      calls.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(ToolCard, { c, title: `${calls.length} actions`, calls, status: "error" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        marginTop: 14,
        padding: "10px 12px",
        background: c.errorBg,
        border: `1px solid ${c.error}33`,
        borderRadius: 6,
        fontSize: 11.5,
        color: c.error,
        lineHeight: 1.5
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.XCircle, { size: 13 }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontWeight: 600 }, children: "execution halted" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { color: c.ink, opacity: 0.85 }, children: errorMsg }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: 6, marginTop: 10 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: onRetry, style: {
            padding: "5px 10px",
            borderRadius: 4,
            border: `1px solid ${c.error}55`,
            background: c.surface2,
            color: c.error,
            fontFamily: DODO_FONT,
            fontSize: 11,
            cursor: "pointer"
          }, children: "↻ retry" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: onReset, style: {
            padding: "5px 10px",
            borderRadius: 4,
            border: `1px solid ${c.border}`,
            background: "transparent",
            color: c.muted,
            fontFamily: DODO_FONT,
            fontSize: 11,
            cursor: "pointer"
          }, children: "new task" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Composer, { c, mode, onChangeMode, onSubmit }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Disclaimer, { c })
  ] });
}

function Complete({
  c,
  task,
  model,
  mode,
  complete,
  steps,
  onChangeMode,
  onSubmit,
  onNewTask,
  onOpenSettings,
  onOpenHistory
}) {
  const dur = formatDuration(complete.durationMs);
  const priColor = { p0: c.error, p1: c.warn, p2: c.muted };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(PanelShell, { c, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(PanelHeader, { c, model, onNewTask, onSettings: onOpenSettings, onHistory: onOpenHistory }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Body, { c, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(UserMsg, { c, children: task }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12, color: c.success }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.CheckCircle, { size: 18 }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 13, fontWeight: 600 }, children: "done" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 } }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { fontSize: 10.5, color: c.muted }, children: [
          dur,
          " · ",
          steps,
          " actions"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        padding: "12px 14px",
        border: `1px solid ${c.border}`,
        background: c.surface2,
        borderRadius: 8,
        marginBottom: 10
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 11, color: c.muted, marginBottom: 8 }, children: "# summary" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 13, lineHeight: 1.55, color: c.ink, whiteSpace: "pre-wrap" }, children: complete.summary })
      ] }),
      complete.actionItems.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        padding: "12px 14px",
        border: `1px solid ${c.border}`,
        background: c.surface2,
        borderRadius: 8
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 11, color: c.muted, marginBottom: 8 }, children: "# action items" }),
        complete.actionItems.map((it, i) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "flex-start", gap: 10, padding: "4px 0", fontSize: 12.5 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 2,
            background: c.bg,
            border: `1px solid ${c.border}`,
            color: priColor[it.priority],
            flexShrink: 0,
            marginTop: 2
          }, children: it.priority }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.ink, lineHeight: 1.45 }, children: it.text })
        ] }, i))
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Composer, { c, placeholder: "ask a follow-up…", mode, onChangeMode, onSubmit }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Disclaimer, { c })
  ] });
}
function formatDuration(ms) {
  const s = Math.round(ms / 1e3);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function SettingRow({
  c,
  label,
  value,
  hint,
  action
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { padding: "12px 16px", borderBottom: `1px solid ${c.border}` }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 12.5, color: c.ink }, children: label }),
      action
    ] }),
    value && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 11.5, color: c.muted, marginTop: 4, fontFamily: DODO_FONT, wordBreak: "break-all" }, children: value }),
    hint && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 10.5, color: c.subtle, marginTop: 4, lineHeight: 1.5 }, children: hint })
  ] });
}

function Settings({
  c,
  settings,
  onClose
}) {
  const [editingKey, setEditingKey] = reactExports.useState(false);
  const [keyDraft, setKeyDraft] = reactExports.useState(settings.apiKey);
  const update = (patch) => {
    void saveSettingsDirect(patch);
  };
  const maskedKey = settings.apiKey ? `${settings.apiKey.slice(0, 4)}${"•".repeat(Math.max(8, settings.apiKey.length - 8))}${settings.apiKey.slice(-4)}` : "not set";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(PanelShell, { c, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 14px",
      borderBottom: `1px solid ${c.border}`
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        Ic.ChevronRight,
        {
          size: 14,
          style: { color: c.muted, transform: "rotate(180deg)", cursor: "pointer" },
          onClick: onClose
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 13, fontWeight: 600 }, children: "settings" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 } }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.X, { size: 14, style: { color: c.muted, cursor: "pointer" }, onClick: onClose })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Body, { c, pad: "0", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Section, { c, children: "model" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        SettingRow,
        {
          c,
          label: "provider",
          value: "google · gemini api",
          action: /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Chevron, { size: 13, style: { color: c.muted, transform: "rotate(-90deg)" } })
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        SettingRow,
        {
          c,
          label: "default model",
          value: settings.model,
          action: /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Chevron, { size: 13, style: { color: c.muted, transform: "rotate(-90deg)" } })
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Section, { c, children: "byok" }),
      editingKey ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { padding: "12px 16px", borderBottom: `1px solid ${c.border}` }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12.5, color: c.ink, marginBottom: 8 }, children: "gemini api key" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            type: "text",
            value: keyDraft,
            onChange: (e) => setKeyDraft(e.target.value),
            placeholder: "AIza…",
            style: {
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 10px",
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
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: 6, marginTop: 8 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: () => {
            update({ apiKey: keyDraft });
            setEditingKey(false);
          }, style: {
            padding: "5px 10px",
            borderRadius: 4,
            border: "none",
            background: c.ink,
            color: c.bg,
            fontFamily: DODO_FONT,
            fontSize: 11,
            cursor: "pointer",
            fontWeight: 600
          }, children: "save" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: () => {
            setKeyDraft(settings.apiKey);
            setEditingKey(false);
          }, style: {
            padding: "5px 10px",
            borderRadius: 4,
            border: `1px solid ${c.border}`,
            background: "transparent",
            color: c.muted,
            fontFamily: DODO_FONT,
            fontSize: 11,
            cursor: "pointer"
          }, children: "cancel" })
        ] })
      ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx(
        SettingRow,
        {
          c,
          label: "api key",
          value: maskedKey,
          hint: "stored locally · never sent anywhere but google",
          action: /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: () => {
            setKeyDraft(settings.apiKey);
            setEditingKey(true);
          }, style: {
            padding: "4px 8px",
            fontSize: 11,
            fontFamily: DODO_FONT,
            cursor: "pointer",
            background: c.surface,
            border: `1px solid ${c.border}`,
            color: c.muted,
            borderRadius: 4
          }, children: "edit" })
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Section, { c, children: "behavior" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        SettingRow,
        {
          c,
          label: "default mode",
          action: /* @__PURE__ */ jsxRuntimeExports.jsx(
            Toggle3,
            {
              c,
              value: settings.defaultMode,
              options: ["ask", "auto", "watch"],
              onChange: (v) => update({ defaultMode: v })
            }
          )
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        SettingRow,
        {
          c,
          label: "confirm before navigation",
          action: /* @__PURE__ */ jsxRuntimeExports.jsx(Switch, { c, on: settings.confirmNavigation, onClick: () => update({ confirmNavigation: !settings.confirmNavigation }) })
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        SettingRow,
        {
          c,
          label: "screenshot redaction",
          action: /* @__PURE__ */ jsxRuntimeExports.jsx(Switch, { c, on: settings.screenshotRedaction, onClick: () => update({ screenshotRedaction: !settings.screenshotRedaction }) })
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        SettingRow,
        {
          c,
          label: "telemetry",
          hint: "off by default. dodo never phones home.",
          action: /* @__PURE__ */ jsxRuntimeExports.jsx(Switch, { c, on: settings.telemetry, onClick: () => update({ telemetry: !settings.telemetry }) })
        }
      )
    ] })
  ] });
}
function Section({ c, children }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
    fontSize: 10,
    color: c.subtle,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    padding: "14px 16px 6px"
  }, children });
}

const FILTERS = ["all", "done", "error", "watching"];
function History({
  c,
  items,
  onClose
}) {
  const [filter, setFilter] = reactExports.useState("all");
  const statusColor = {
    done: c.success,
    paused: c.warn,
    error: c.error,
    watch: c.accent
  };
  const filtered = items.filter((it) => {
    if (filter === "all") return true;
    if (filter === "watching") return it.status === "watch";
    return it.status === filter;
  });
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(PanelShell, { c, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
      padding: "10px 14px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      borderBottom: `1px solid ${c.border}`
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        Ic.ChevronRight,
        {
          size: 14,
          style: { color: c.muted, transform: "rotate(180deg)", cursor: "pointer" },
          onClick: onClose
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Clock, { size: 14, style: { color: c.muted } }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 13, fontWeight: 600 }, children: "history" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 } }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { fontSize: 10.5, color: c.muted }, children: [
        items.length,
        " tasks"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(IcoBtn, { c, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Ic.Search, { size: 14 }) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
      padding: "6px 14px",
      borderBottom: `1px solid ${c.border}`,
      display: "flex",
      gap: 4,
      fontSize: 11
    }, children: FILTERS.map((l) => {
      const sel = l === filter;
      return /* @__PURE__ */ jsxRuntimeExports.jsx(
        "span",
        {
          onClick: () => setFilter(l),
          style: {
            padding: "3px 9px",
            borderRadius: 3,
            cursor: "pointer",
            background: sel ? c.bg : "transparent",
            border: `1px solid ${sel ? c.borderHi : "transparent"}`,
            color: sel ? c.ink : c.muted
          },
          children: l
        },
        l
      );
    }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Body, { c, pad: "0", children: [
      filtered.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { padding: 24, fontSize: 12, color: c.subtle, textAlign: "center" }, children: "no tasks yet." }),
      filtered.map((it) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        padding: "12px 16px",
        borderBottom: `1px solid ${c.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 4
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
            width: 6,
            height: 6,
            borderRadius: 1,
            background: statusColor[it.status],
            flexShrink: 0
          } }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 12.5, color: c.ink, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: it.title }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 10.5, color: c.subtle, flexShrink: 0 }, children: relTime(it.startedAt) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
          display: "flex",
          gap: 8,
          paddingLeft: 14,
          fontSize: 10.5,
          color: c.muted
        }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: it.sub }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: c.subtle }, children: "·" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
            it.steps,
            " steps"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 } }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: statusColor[it.status] }, children: it.status })
        ] })
      ] }, it.id))
    ] })
  ] });
}
function relTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1e3);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function App() {
  const c = DODO_LIGHT;
  const [view, setView] = reactExports.useState("agent");
  const a = useAgent();
  const { snap } = a;
  if (view === "settings") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Settings, { c, settings: snap.settings, onClose: () => setView("agent") });
  }
  if (view === "history") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(History, { c, items: snap.history, onClose: () => setView("agent") });
  }
  const common = {
    model: snap.settings.model,
    mode: snap.settings.defaultMode,
    onChangeMode: a.setMode,
    onNewTask: a.reset,
    onOpenSettings: () => setView("settings"),
    onOpenHistory: () => setView("history")
  };
  const phase = snap.state.phase;
  const task = snap.state.task ?? "";
  if (phase === "idle") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Empty, { c, ...common, onSubmit: a.submit });
  }
  if (phase === "planning") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(PlanCreating, { c, task, ...common, onStop: a.stop });
  }
  if (phase === "awaiting_approval" && snap.state.plan) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      PlanApproval,
      {
        c,
        task,
        model: common.model,
        plan: snap.state.plan,
        onApprove: a.approve,
        onEdit: a.editPlan,
        onNewTask: common.onNewTask,
        onOpenSettings: common.onOpenSettings,
        onOpenHistory: common.onOpenHistory
      }
    );
  }
  if (phase === "awaiting_permission" && snap.state.pendingPermission) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      Permissions,
      {
        c,
        task,
        model: common.model,
        pending: snap.state.pendingPermission,
        onAllow: () => a.allow(snap.state.pendingPermission.host, true),
        onAllowOnce: () => a.allow(snap.state.pendingPermission.host, false),
        onDeny: a.deny,
        onNewTask: common.onNewTask,
        onOpenSettings: common.onOpenSettings,
        onOpenHistory: common.onOpenHistory
      }
    );
  }
  if (phase === "working") {
    const showBanner = !snap.settings.notifyEnabled && !snap.settings.notifyDismissed;
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      Working,
      {
        c,
        task,
        ...common,
        calls: snap.state.toolCalls,
        workingLabel: snap.state.workingLabel,
        startedAt: snap.state.startedAt,
        notifyEnabled: !showBanner,
        onEnableNotify: () => {
          void saveSettingsDirect({ notifyEnabled: true });
          a.testNotify();
        },
        onDismissNotify: () => {
          void saveSettingsDirect({ notifyDismissed: true });
        },
        onStop: a.stop,
        onSubmit: a.submit
      }
    );
  }
  if (phase === "error") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      ErrorState,
      {
        c,
        task,
        ...common,
        calls: snap.state.toolCalls,
        errorMsg: snap.state.errorMsg ?? "unknown error",
        onRetry: a.retry,
        onReset: a.reset,
        onSubmit: a.submit
      }
    );
  }
  if (phase === "complete" && snap.state.complete) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      Complete,
      {
        c,
        task,
        ...common,
        complete: snap.state.complete,
        steps: snap.state.toolCalls.length,
        onSubmit: a.continueChat
      }
    );
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx(Empty, { c, ...common, onSubmit: a.submit });
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(App, {}) })
  );
}
//# sourceMappingURL=sidepanel-D-t2oHmv.js.map
