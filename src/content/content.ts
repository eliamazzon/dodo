import type { ContentOp, ContentResult } from '../shared/messages';

const SENTINEL = '__dodo_content_installed__';

declare global {
  interface Window {
    [SENTINEL]?: boolean;
  }
}

if (!window[SENTINEL]) {
  window[SENTINEL] = true;

  chrome.runtime.onMessage.addListener((msg: ContentOp, _sender, sendResponse) => {
    handle(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) } as ContentResult));
    return true;
  });
}

function isVisible(el: Element): boolean {
  const he = el as HTMLElement;
  if (!he.getClientRects().length) return false;
  const style = getComputedStyle(he);
  if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
  return true;
}

function cssEscape(s: string): string {
  return (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

function bestSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = (el as HTMLElement).id;
  if (id && document.querySelectorAll(`#${cssEscape(id)}`).length === 1) {
    return `#${cssEscape(id)}`;
  }
  const dt = el.getAttribute('data-testid');
  if (dt) return `${tag}[data-testid="${cssEscape(dt)}"]`;
  const name = el.getAttribute('name');
  if (name && document.querySelectorAll(`${tag}[name="${cssEscape(name)}"]`).length === 1) {
    return `${tag}[name="${cssEscape(name)}"]`;
  }
  const aria = el.getAttribute('aria-label');
  if (aria && document.querySelectorAll(`${tag}[aria-label="${cssEscape(aria)}"]`).length === 1) {
    return `${tag}[aria-label="${cssEscape(aria)}"]`;
  }
  const ph = el.getAttribute('placeholder');
  if (ph && document.querySelectorAll(`${tag}[placeholder="${cssEscape(ph)}"]`).length === 1) {
    return `${tag}[placeholder="${cssEscape(ph)}"]`;
  }
  const path: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement && path.length < 6) {
    const parent: Element | null = cur.parentElement;
    if (!parent) break;
    const sameTagSiblings = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
    const idx = sameTagSiblings.indexOf(cur) + 1;
    path.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${idx})`);
    cur = parent;
  }
  return path.join(' > ');
}

function snapshot() {
  const sel = 'input, textarea, select, button, a[href], [role="button"], [role="link"], [role="textbox"], [contenteditable="true"]';
  const elements = Array.from(document.querySelectorAll(sel))
    .filter(isVisible)
    .slice(0, 80)
    .map((el) => {
      const he = el as HTMLElement;
      const tag = he.tagName.toLowerCase();
      const text = (he.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 100);
      const aria = he.getAttribute('aria-label') || undefined;
      const placeholder = he.getAttribute('placeholder') || undefined;
      const role = he.getAttribute('role') || undefined;
      const type = he.getAttribute('type') || undefined;
      const value = (tag === 'input' || tag === 'textarea') ? ((he as HTMLInputElement).value || undefined) : undefined;
      const href = tag === 'a' ? (he as HTMLAnchorElement).href : undefined;
      return {
        tag,
        selector: bestSelector(el),
        text: text || undefined,
        aria, placeholder, role, type, value, href,
      };
    });
  return { title: document.title, url: location.href, elements };
}

async function handle(op: ContentOp): Promise<ContentResult> {
  console.log('%c[dodo:content]', 'color:#6b4ea3;font-weight:600', op);
  try {
    if (op.op === 'click') {
      const el = document.querySelector(op.selector);
      if (!el) return { ok: false, error: `no element matches ${op.selector}` };
      (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' });
      (el as HTMLElement).click();
      return { ok: true, data: { clicked: op.selector } };
    }
    if (op.op === 'type') {
      const el = document.querySelector(op.selector) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return { ok: false, error: `no element matches ${op.selector}` };
      el.focus();
      const desc = Object.getOwnPropertyDescriptor(
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      );
      desc?.set?.call(el, op.text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, data: { typed: op.text.length } };
    }
    if (op.op === 'extract') {
      const target = op.selector
        ? (document.querySelector(op.selector) as HTMLElement | null)
        : document.body;
      if (!target) return { ok: false, error: `no element matches ${op.selector}` };
      const text = (target.innerText ?? '').replace(/\s+\n/g, '\n').trim();
      return { ok: true, data: { text, title: document.title, url: location.href } };
    }
    if (op.op === 'snapshot') {
      return { ok: true, data: snapshot() };
    }
    return { ok: false, error: 'unknown op' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
