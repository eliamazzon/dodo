import { useEffect, useRef, useState } from 'react';
import { INITIAL_AGENT_STATE, DEFAULT_SETTINGS, type AgentState, type Settings, type HistoryItem, type Mode } from '../../shared/types';
import { PORT_NAME, type PanelToBg, type BgToPanel } from '../../shared/messages';

export type AgentSnapshot = {
  state: AgentState;
  settings: Settings;
  allowlist: string[];
  history: HistoryItem[];
};

export function useAgent() {
  const [snap, setSnap] = useState<AgentSnapshot>({
    state: INITIAL_AGENT_STATE,
    settings: DEFAULT_SETTINGS,
    allowlist: [],
    history: [],
  });
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    const onMessage = (msg: BgToPanel) => {
      if (msg.kind === 'state') {
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

    const onStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (area !== 'local') return;
      setSnap((prev) => ({
        ...prev,
        settings: changes.settings ? { ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Settings) } : prev.settings,
        allowlist: changes.allowlist ? (changes.allowlist.newValue as string[]) ?? prev.allowlist : prev.allowlist,
        history: changes.history ? (changes.history.newValue as HistoryItem[]) ?? prev.history : prev.history,
      }));
    };
    chrome.storage.onChanged.addListener(onStorageChange);

    return () => {
      unmountedRef.current = true;
      try { portRef.current?.disconnect(); } catch {}
      portRef.current = null;
      chrome.storage.onChanged.removeListener(onStorageChange);
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
      }
    });
    port.onDisconnect.addListener(() => { portRef.current = null; });
    try { port.postMessage(m); } catch {}
  };

  return {
    snap,
    submit: (task: string) => send({ kind: 'submit_task', task }),
    continueChat: (text: string) => send({ kind: 'continue_chat', text }),
    approve: () => send({ kind: 'approve_plan' }),
    editPlan: () => send({ kind: 'edit_plan' }),
    stop: () => send({ kind: 'stop' }),
    allow: (host: string, remember: boolean) => send({ kind: 'allow_host', host, remember }),
    deny: () => send({ kind: 'deny_permission' }),
    retry: () => send({ kind: 'retry' }),
    reset: () => send({ kind: 'reset' }),
    setMode: (mode: Mode) => send({ kind: 'set_mode', mode }),
    testNotify: () => send({ kind: 'test_notify' }),
    openHistory: (id: string) => send({ kind: 'open_history', id }),
    deleteHistory: (id: string) => send({ kind: 'delete_history', id }),
  };
}

export async function saveSettingsDirect(patch: Partial<Settings>): Promise<void> {
  const raw = await chrome.storage.local.get(['settings']);
  const current = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) } as Settings;
  await chrome.storage.local.set({ settings: { ...current, ...patch } });
}

export async function saveAllowlistDirect(list: string[]): Promise<void> {
  await chrome.storage.local.set({ allowlist: list });
}
