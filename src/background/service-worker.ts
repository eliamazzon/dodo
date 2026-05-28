// Extension lifecycle host — manages the long-lived Chrome Port to the side panel and routes UI messages to the Agent singleton.
import { agent } from './agent';
import { loadStore, saveSettings, deleteHistoryItem } from './store';
import { PORT_NAME, type PanelToBg, type BgToPanel } from '../shared/messages';
import { notifyForce } from './notify';

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
// The returned object is the exact payload the orchestrator LLM sees: system prompt,
// tool schemas, and the raw conversation (tool calls, tool outputs, images).
(globalThis as unknown as { dodoExport: (includeImages?: boolean) => unknown }).dodoExport =
  (includeImages = true) => agent.exportForLLM(includeImages);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;

  let unsub: (() => void) | null = null;

  const send = async () => {
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
      case 'stop':
        agent.stop();
        break;
      case 'allow_host':
        await agent.allowHost(msg.host, msg.remember);
        break;
      case 'deny_permission':
        await agent.denyPermission();
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
      case 'set_approval_mode':
        await saveSettings({ approvalMode: msg.mode });
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === 'open_sidepanel') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.windowId != null) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
      }
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});
