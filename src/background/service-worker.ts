// Extension lifecycle host — manages the long-lived Chrome Port to the side panel and routes UI messages to the Agent singleton.
import { agent } from './agent';
import { loadStore, saveSettings, setAllowlist, getSettings, getAllowlist, deleteHistoryItem } from './store';
import { PORT_NAME, type PanelToBg, type BgToPanel } from '../shared/messages';
import { notifyForce } from './notify';
import { initTabTracking } from './tools';

// Track tab lifecycle (new tabs opened by the agent's active tab, removed tabs) for multi-tab support.
initTabTracking();

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {}
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/index.html') });
  }
});

// Debug hook — from the service-worker DevTools console (chrome://extensions →
// DODO → "service worker"):
//   copy(dodoExport())          copies the full LLM-view JSON to the clipboard
//   dodoExport(false)           same but with image base64 omitted (smaller)
// The returned object has: systemPrompt, tool schemas, `messages` (the cumulative
// conversation store, unpruned), and `requests` — a per-turn record of the exact
// post-prune payload actually sent each turn (turn, model, char count, messages).
(globalThis as unknown as { dodoExport: (includeImages?: boolean) => unknown }).dodoExport =
  (includeImages = true) => agent.exportForLLM(includeImages);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;

  let unsub: (() => void) | null = null;

  const send = async () => {
    await agent.ready;
    const { settings, allowlist, history } = await loadStore();
    const msg: BgToPanel = { kind: 'state', state: agent.state, settings, allowlist, history };
    try { port.postMessage(msg); } catch {}
  };

  unsub = agent.subscribe(() => { void send(); });
  void send();

  port.onMessage.addListener(async (msg: PanelToBg) => {
    switch (msg.kind) {
      case 'send_message':
        void agent.sendMessage(msg.text);
        break;
      case 'approve_execution':
        void agent.approveExecution(msg.messageId);
        break;
      case 'reject_execution':
        void agent.rejectExecution(msg.messageId);
        break;
      case 'approve_plan':
        void agent.approvePlan(msg.messageId, msg.mode);
        break;
      case 'reject_plan':
        await agent.rejectPlan(msg.messageId);
        break;
      case 'stop':
        await agent.stop();
        break;
      case 'allow_host':
        await agent.decidePermission(msg.pattern, msg.scope, msg.duration, msg.access);
        break;
      case 'deny_permission':
        await agent.denyPermission();
        break;
      case 'confirm_critical':
        await agent.confirmCritical(msg.messageId);
        break;
      case 'deny_critical':
        await agent.denyCritical(msg.messageId);
        break;
      case 'retry':
        void agent.retry();
        break;
      case 'reset':
        agent.reset();
        break;
      case 'set_mode':
        await saveSettings({ defaultMode: msg.mode });
        void send();
        break;
      case 'set_settings':
        await saveSettings(msg.patch);
        void send();
        break;
      case 'test_notify':
        void notifyForce('dodo · notifications on', "you'll be pinged when the agent finishes or needs you.");
        break;
      case 'open_history':
        await agent.openHistory(msg.id);
        break;
      case 'delete_history':
        await deleteHistoryItem(msg.id);
        void send();
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    unsub?.();
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only honor messages from this extension's own pages/content scripts. There is no
  // `externally_connectable` entry, so web pages already can't reach here — this is
  // defense-in-depth so a future manifest change can't silently expose settings/the API key.
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.kind === 'open_sidepanel') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.windowId != null) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
      }
      sendResponse({ ok: true });
    });
    return true;
  }
  // Onboarding runs in its own page (no long-lived port), so it reads/writes settings + allowlist
  // through one-shot messages — the background stays the single owner of persisted state.
  if (msg?.kind === 'get_onboarding') {
    // Onboarding's Sites UI deals in plain host strings — flatten the (domain-scoped) entries to
    // their patterns. save_onboarding's setAllowlist() re-wraps them as domain entries on write.
    Promise.all([getSettings(), getAllowlist()]).then(([settings, allowlist]) => {
      sendResponse({ settings, allowlist: allowlist.filter((e) => e.scope === 'domain').map((e) => e.pattern) });
    });
    return true;
  }
  if (msg?.kind === 'save_onboarding') {
    Promise.all([saveSettings(msg.settings), setAllowlist(msg.allowlist)]).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});
