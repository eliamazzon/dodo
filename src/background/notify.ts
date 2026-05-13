import { getSettings } from './store';
import { log } from './log';

// 32x32 purple #6b4ea3 PNG, base64-encoded — used as the notification icon.
export const NOTIFY_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgAQMAAABJtOi3AAAABlBMVEVrTqP///+xV9MoAAAAGklEQVQYlWNgGAWjYBSMglEwCkbBKBgFwwUAB+gAAdiqs8gAAAAASUVORK5CYII=';

export async function notify(title: string, message: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.notifyEnabled) return;
  return notifyForce(title, message);
}

export async function notifyForce(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: NOTIFY_ICON,
      title,
      message,
      priority: 1,
    });
  } catch (e) {
    log.warn('notify failed', e);
  }
}

if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener(async (id) => {
    try {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      const w = windows.find((win) => win.focused) ?? windows[0];
      if (w?.id != null) await chrome.sidePanel.open({ windowId: w.id });
    } catch {}
    try { chrome.notifications.clear(id); } catch {}
  });
}
