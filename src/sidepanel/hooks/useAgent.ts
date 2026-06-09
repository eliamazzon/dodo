import { useEffect, useRef, useState } from 'react';
import { INITIAL_AGENT_STATE, DEFAULT_SETTINGS, type AgentState, type Settings, type HistoryItem, type Mode } from '../../shared/types';
import { PORT_NAME, type PanelToBg, type BgToPanel } from '../../shared/messages';

export type AgentSnapshot = {
  state: AgentState;
  settings: Settings;
  allowlist: string[];
  history: HistoryItem[];
};

// The panel never touches chrome.storage directly — the background service worker is the single
// owner of all persisted state. Every read arrives via the port `state` broadcast (sent on connect
// and on every change); every write goes back as a PanelToBg message. This keeps the panel agnostic
// to where data actually lives (chrome.storage today, IndexedDB/cloud later).
export function useAgent() {
  const [snap, setSnap] = useState<AgentSnapshot>({
    state: INITIAL_AGENT_STATE,
    settings: DEFAULT_SETTINGS,
    allowlist: [],
    history: [],
  });
  // Flipped on the first `state` message from the background — the worker calls send() immediately
  // on connect, so this is one round-trip away. App shows a skeleton until then.
  const [hydrated, setHydrated] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    const onMessage = (msg: BgToPanel) => {
      if (msg.kind === 'state') {
        setSnap({ state: msg.state, settings: msg.settings, allowlist: msg.allowlist, history: msg.history });
        setHydrated(true);
      }
    };
    const connect = () => {
      if (unmountedRef.current) return;
      // During an extension reload the page's runtime context is invalidated and connect() throws.
      // Catch it and back off rather than letting it bubble or spin tightly — the page will be
      // reloaded by Chrome once the new background is live.
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connect({ name: PORT_NAME });
      } catch {
        if (!unmountedRef.current) setTimeout(connect, 500);
        return;
      }
      portRef.current = port;
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(() => {
        portRef.current = null;
        if (!unmountedRef.current) setTimeout(connect, 500);
      });
    };
    connect();

    return () => {
      unmountedRef.current = true;
      try { portRef.current?.disconnect(); } catch {}
      portRef.current = null;
    };
  }, []);

  const send = (m: PanelToBg) => {
    const tryPost = () => {
      try {
        portRef.current?.postMessage(m);
        return true;
      } catch { return false; }
    };
    if (portRef.current && tryPost()) return;
    const port = chrome.runtime.connect({ name: PORT_NAME });
    portRef.current = port;
    port.onMessage.addListener((msg: BgToPanel) => {
      if (msg.kind === 'state') {
        setSnap({ state: msg.state, settings: msg.settings, allowlist: msg.allowlist, history: msg.history });
        setHydrated(true);
      }
    });
    port.onDisconnect.addListener(() => { portRef.current = null; });
    try { port.postMessage(m); } catch {}
  };

  return {
    snap,
    hydrated,
    sendMessage: (text: string) => send({ kind: 'send_message', text }),
    approveExecution: (messageId: string) => send({ kind: 'approve_execution', messageId }),
    rejectExecution: (messageId: string) => send({ kind: 'reject_execution', messageId }),
    stop: () => send({ kind: 'stop' }),
    allow: (host: string, remember: boolean) => send({ kind: 'allow_host', host, remember }),
    deny: () => send({ kind: 'deny_permission' }),
    retry: () => send({ kind: 'retry' }),
    reset: () => send({ kind: 'reset' }),
    setMode: (mode: Mode) => send({ kind: 'set_mode', mode }),
    setSettings: (patch: Partial<Settings>) => send({ kind: 'set_settings', patch }),
    testNotify: () => send({ kind: 'test_notify' }),
    openHistory: (id: string) => send({ kind: 'open_history', id }),
    deleteHistory: (id: string) => send({ kind: 'delete_history', id }),
  };
}
