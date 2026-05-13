import { agent } from './agent';
import { loadStore, saveSettings } from './store';
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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;

  let unsub: (() => void) | null = null;

  const send = async () => {
    const { settings, allowlist, history } = await loadStore();
    const msg: BgToPanel = { kind: 'state', state: agent.state, settings, allowlist, history };
    try { port.postMessage(msg); } catch {}
  };

  unsub = agent.subscribe(() => { void send(); });

  port.onMessage.addListener(async (msg: PanelToBg) => {
    switch (msg.kind) {
      case 'submit_task':
        void agent.submit(msg.task);
        break;
      case 'continue_chat':
        void agent.continueChat(msg.text);
        break;
      case 'approve_plan':
        void agent.approvePlan();
        break;
      case 'edit_plan':
        agent.reset();
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
      case 'test_notify':
        void notifyForce('dodo · notifications on', "you'll be pinged when the agent finishes or needs you.");
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
