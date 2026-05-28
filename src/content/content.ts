// Content script injected on demand into the active tab; provides DOM query and interaction primitives for the agent.
import type { ContentOp, ContentResult } from '../shared/messages';

// Guard against double-registration: executeScript re-runs this file on each injection but event listeners accumulate without this check.
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

// Selector priority: ID > data-testid > name attr > aria-label > placeholder > structural nth-of-type path.
// Earlier attributes are stable semantic identifiers; the structural fallback is fragile but always produces a unique path.
function bestSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = (el as HTMLElement).id;
  if (id && document.querySelectorAll(`#${cssEscape(id)}`).length === 1) {
    return `#${cssEscape(id)}`;
  }
  const dt = el.getAttribute('data-testid');
  if (dt && document.querySelectorAll(`${tag}[data-testid="${cssEscape(dt)}"]`).length === 1) {
    return `${tag}[data-testid="${cssEscape(dt)}"]`;
  }
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
  // Walk up until we hit an ancestor with a unique anchor (id or unique data-testid),
  // then build a fully anchored descendant path. An un-anchored nth-of-type chain is
  // evaluated as a document-wide query and rarely picks out the intended element.
  const path: string[] = [];
  let cur: Element | null = el;
  let anchor: string | null = null;
  while (cur && cur !== document.documentElement && path.length < 10) {
    const parent: Element | null = cur.parentElement;
    if (!parent) break;
    const curId = (cur as HTMLElement).id;
    if (curId && document.querySelectorAll(`#${cssEscape(curId)}`).length === 1) {
      anchor = `#${cssEscape(curId)}`;
      break;
    }
    const curDt = cur.getAttribute('data-testid');
    const curTag = cur.tagName.toLowerCase();
    if (curDt && document.querySelectorAll(`${curTag}[data-testid="${cssEscape(curDt)}"]`).length === 1) {
      anchor = `${curTag}[data-testid="${cssEscape(curDt)}"]`;
      break;
    }
    const sameTagSiblings = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
    const idx = sameTagSiblings.indexOf(cur) + 1;
    path.unshift(`${curTag}:nth-of-type(${idx})`);
    cur = parent;
  }
  if (anchor) {
    return path.length ? `${anchor} > ${path.join(' > ')}` : anchor;
  }
  // No anchor found — last resort. Prefix with body to at least scope the query.
  return path.length ? `body > ${path.join(' > ')}` : el.tagName.toLowerCase();
}

// Text contributed by `el` itself, EXCLUDING text from any descendant that is also interactive
// (i.e., another snapshot match). This stops wrapper rows from absorbing every inner button's label
// into one giant blob — each entry in the snapshot describes only its own visible text.
function ownText(el: Element, interactiveSet: Set<Element>): string {
  const parts: string[] = [];
  function walk(n: Node) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.nodeValue ?? '';
      if (t.trim()) parts.push(t);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    if (n !== el && interactiveSet.has(n as Element)) return; // skip nested interactive subtrees
    for (const child of Array.from(n.childNodes)) walk(child);
  }
  walk(el);
  return parts.join(' ').trim().replace(/\s+/g, ' ');
}

function snapshot() {
  // Broad enough to catch app-specific interactive divs (email rows, list items, custom checkboxes)
  // that aren't <button>/<a>. SPAs like Gmail/Proton render rows as <div tabindex="0"> with role=row/listitem.
  const sel = [
    'input', 'textarea', 'select', 'button', 'a[href]',
    // <label> is the visible click target in custom-styled checkbox/radio rows where the
    // real <input> is hidden via opacity:0 — common in Proton, Notion, Linear, etc.
    'label',
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="searchbox"]', '[role="combobox"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
    '[role="row"]', '[role="listitem"]', '[role="option"]', '[role="menuitem"]', '[role="tab"]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');
  const visible = Array.from(document.querySelectorAll(sel))
    .filter(isVisible)
    .filter((el) => {
      // <label> elements are only useful when they wrap a hidden input (custom checkbox/radio).
      // Plain `<label for="field">` text labels just add noise to the snapshot.
      if (el.tagName.toLowerCase() === 'label') {
        return el.querySelector('input') !== null;
      }
      return true;
    });

  // Stable, high-signal elements first so they survive the cap. Row/listitem/tabindex
  // containers are useful but should yield to real form controls and buttons.
  const TIER: Record<string, number> = {
    input: 0, textarea: 0, select: 0, button: 0, a: 0, label: 1,
  };
  const tier = (el: Element) => TIER[el.tagName.toLowerCase()] ??
    (el.getAttribute('role')?.match(/^(textbox|searchbox|combobox|button|link|checkbox|radio|switch|option|menuitem|tab)$/) ? 1 : 2);
  visible.sort((a, b) => tier(a) - tier(b));

  const interactiveSet = new Set<Element>(visible);
  const elements = visible
    .slice(0, 100)
    .map((el) => {
      const he = el as HTMLElement;
      const tag = he.tagName.toLowerCase();
      const text = ownText(el, interactiveSet).slice(0, 60);
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
