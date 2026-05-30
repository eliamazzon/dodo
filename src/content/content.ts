// Content script injected on demand into the active tab; provides DOM query and interaction primitives for the agent.
import type { ContentOp, ContentResult } from '../shared/messages';

// Guard against double-registration: executeScript re-runs this file on each injection but event listeners accumulate without this check.
const SENTINEL = '__dodo_content_installed__';

declare global {
  interface Window {
    [SENTINEL]?: boolean;
    // Ref registry — maps the short `data-sel` tokens (e.g. "e42") the LLM sees back to the real
    // element/selector. Lives on `window` (not module scope) so it survives content-script
    // re-injection between the snapshot op and the later click/type op. `doc` is the element's
    // owner document (the top document or a same-origin iframe's) so the selector fallback re-queries
    // in the right scope — `document.querySelector` can't reach into iframe documents.
    __dodo_refs__?: Map<string, { ref: WeakRef<Element>; selector: string; doc: WeakRef<Document> }>;
    __dodo_refSeq__?: number;
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

// ── Ref registry ──────────────────────────────────────────────────────────────────────────────
// The LLM never sees raw CSS selectors. Interactive elements carry a short opaque `data-sel` token
// (e.g. "e42"); click/type/snapshot resolve it back to a real element via this registry. This keeps
// the HTML small and avoids the LLM having to transcribe long/escaped selectors verbatim.
const REF_CAP = 4000;

function refRegistry(): Map<string, { ref: WeakRef<Element>; selector: string; doc: WeakRef<Document> }> {
  if (!window.__dodo_refs__) window.__dodo_refs__ = new Map();
  return window.__dodo_refs__;
}

function assignRef(el: Element): string {
  const reg = refRegistry();
  const seq = (window.__dodo_refSeq__ = (window.__dodo_refSeq__ ?? 0) + 1);
  const ref = `e${seq}`;
  reg.set(ref, { ref: new WeakRef(el), selector: bestSelector(el), doc: new WeakRef(el.ownerDocument) });
  // Bound memory — Map preserves insertion order, so the first keys are the oldest.
  while (reg.size > REF_CAP) {
    const oldest = reg.keys().next().value;
    if (oldest === undefined) break;
    reg.delete(oldest);
  }
  return ref;
}

// Accepts a `data-sel` ref ("e42") or a raw CSS selector (back-compat / resilience). Returns the
// live element when the ref's target is still attached, else re-queries the stored selector.
function resolveRef(token: string): Element | null {
  if (/^e\d+$/.test(token)) {
    const entry = refRegistry().get(token);
    if (entry) {
      const live = entry.ref.deref();
      if (live && live.isConnected) return live;
      // Fallback: re-query the stored selector in the element's owning document (may be a
      // same-origin iframe doc that the top `document` can't reach).
      const doc = entry.doc.deref();
      try {
        return (doc ?? document).querySelector(entry.selector);
      } catch {
        return null;
      }
    }
  }
  try {
    return document.querySelector(token);
  } catch {
    return null;
  }
}

// querySelectorAll that also descends into same-origin iframe documents — `querySelectorAll` alone
// stops at iframe boundaries, so rich-text editors (Proton/Gmail Rooster, etc.) rendered inside an
// iframe would be invisible to snapshot/extract/click/type. Cross-origin frames throw on
// `contentDocument` access and are skipped. Depth-bounded to avoid pathological ad-iframe trees.
function queryAllDeep(root: ParentNode, selector: string, depth = 3): Element[] {
  const out = Array.from(root.querySelectorAll(selector));
  if (depth <= 0) return out;
  const frames = root.querySelectorAll('iframe');
  for (const frame of Array.from(frames)) {
    let childDoc: Document | null = null;
    try {
      childDoc = (frame as HTMLIFrameElement).contentDocument;
    } catch {
      childDoc = null; // cross-origin — inaccessible
    }
    if (childDoc) out.push(...queryAllDeep(childDoc, selector, depth - 1));
  }
  return out;
}

// Visible elements carrying an identifying hook the model's selector might have aimed at. Used only
// on the error path, so the full-document scan is acceptable.
function identifiableElements(): Element[] {
  return queryAllDeep(document, '[id], [class], [data-testid], [role]').filter(isVisible);
}

// When a selector/ref fails to resolve, suggest the closest live elements — with FRESH refs — so the
// model can retry with a real ref instead of guessing another string (the recurring failure mode:
// inventing CSS classes like `.jobs-search__job-details`). Fuzzy-matches the selector's identifier
// fragments (classes/ids/testids/role/text) against `pool`. A stale `e\d+` ref yields no hint — the
// only fix there is a fresh snapshot, which the caller already advises.
function nearMisses(token: string, pool: Element[]): string {
  if (/^e\d+$/.test(token)) return '';
  const needles = (token.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) ?? [])
    .filter((n) => !['div', 'span'].includes(n));
  if (!needles.length) return '';

  const set = new Set<Element>(pool);
  const scored = pool
    .map((el) => {
      const hay = [
        el.id,
        el.getAttribute('class') ?? '',
        el.getAttribute('data-testid') ?? '',
        el.getAttribute('role') ?? '',
        ownText(el, set).slice(0, 40),
      ].join(' ').toLowerCase();
      let score = 0;
      for (const n of needles) if (hay.includes(n)) score += n.length;
      return { el, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (!scored.length) return '';

  const lines = scored.map(({ el }) => {
    const label = (ownText(el, set).slice(0, 50) || el.getAttribute('aria-label') || '').trim();
    return `  [${assignRef(el)}] ${el.tagName.toLowerCase()}${label ? ` "${label}"` : ''}`;
  });
  return `\nClosest matches (retry with one of these refs):\n${lines.join('\n')}`;
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

// Broad enough to catch app-specific interactive divs (email rows, list items, custom checkboxes)
// that aren't <button>/<a>. SPAs like Gmail/Proton render rows as <div tabindex="0"> with role=row/listitem.
const INTERACTIVE_SEL = [
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

// Visible interactive elements — the set that carries a `data-sel` in the HTML serialization
// and that the click diff compares before/after. `root` scopes the search (defaults to the
// whole document) so the extract map can survey a single region.
function interactiveCandidates(root: ParentNode = document): Element[] {
  return queryAllDeep(root, INTERACTIVE_SEL)
    .filter(isVisible)
    .filter((el) => {
      // <label> elements are only useful when they wrap a hidden input (custom checkbox/radio).
      // Plain `<label for="field">` text labels just add noise.
      if (el.tagName.toLowerCase() === 'label') return el.querySelector('input') !== null;
      return true;
    });
}

// ── Structured snapshot — kept for the (disabled) planner path via the snapshot_structured op ──
function snapshot() {
  const visible = interactiveCandidates();

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

// ── HTML snapshot — the granular-tool path the orchestrator LLM consumes ──────────────────────
const SKIP_TAGS = new Set(['script', 'noscript', 'svg', 'style', 'template', 'link', 'meta', 'head']);

// Attributes worth surfacing (id/class/value handled separately). Order here is the emit order.
const ATTR_ALLOW = [
  'role', 'aria-label', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-disabled',
  'aria-haspopup', 'data-testid', 'type', 'placeholder', 'href', 'name', 'disabled',
  'tabindex', 'contenteditable',
];

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Direct text-node children only (descendant text is emitted by recursing into children).
function directText(el: Element): string {
  let t = '';
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) t += n.nodeValue ?? '';
  }
  return t.trim().replace(/\s+/g, ' ');
}

function serializeHTML(root: Element, maxDepth: number, interactiveSet: Set<Element>, cap: number): string {
  let out = '';
  const emit = (s: string) => { out += s; };

  const attrsFor = (el: Element): string => {
    const parts: string[] = [];
    const id = (el as HTMLElement).id;
    if (id) parts.push(`id="${escapeAttr(id)}"`);
    const cls = el.getAttribute('class');
    if (cls) parts.push(`class="${escapeAttr(cls.length > 80 ? cls.slice(0, 80) : cls)}"`);
    for (const name of ATTR_ALLOW) {
      if (!el.hasAttribute(name)) continue;
      const v = el.getAttribute(name) ?? '';
      parts.push(v === '' ? name : `${name}="${escapeAttr(v.slice(0, 120))}"`);
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      const v = (el as HTMLInputElement | HTMLTextAreaElement).value;
      if (v) parts.push(`value="${escapeAttr(v.slice(0, 100))}"`);
    }
    if (interactiveSet.has(el)) parts.push(`data-sel="${assignRef(el)}"`);
    return parts.length ? ' ' + parts.join(' ') : '';
  };

  const walk = (el: Element, depth: number) => {
    if (el.hasAttribute(OVERLAY_ATTR)) return; // never serialize our own on-page cursor overlay
    if (out.length >= cap) return; // budget blown — stop descending; the sibling loop notes the omission
    const tag = el.tagName.toLowerCase();
    const open = `<${tag}${attrsFor(el)}>`;
    const close = `</${tag}>`;

    // For a same-origin iframe, descend into its document body so embedded rich-text editors
    // (Proton/Gmail Rooster) are part of the snapshot. Cross-origin frames have no reachable body.
    let childEls: Element[];
    if (tag === 'iframe') {
      let body: HTMLElement | null = null;
      try { body = (el as HTMLIFrameElement).contentDocument?.body ?? null; } catch { body = null; }
      childEls = body ? [body] : [];
    } else {
      childEls = Array.from(el.children).filter(
        (c) => !SKIP_TAGS.has(c.tagName.toLowerCase()) && isVisible(c),
      );
    }

    if (depth <= 0) {
      const text = ((el as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ');
      if (childEls.length === 0) {
        emit(open + escapeText(text.slice(0, 100)) + close);
      } else if (text && text.length <= 80) {
        emit(open + escapeText(text) + close);
      } else {
        emit(open + `<!-- ${childEls.length} children, depth limit — snapshot({element}) to expand or extract for a flat list -->` + close);
      }
      return;
    }

    emit(open);
    const txt = directText(el);
    if (txt) emit(escapeText(txt));
    for (let i = 0; i < childEls.length; i++) {
      if (out.length >= cap) {
        emit(`<!-- ${childEls.length - i} of ${childEls.length} children omitted (output cap; use extract for the full list) -->`);
        break;
      }
      walk(childEls[i], depth - 1);
    }
    emit(close);
  };

  walk(root, maxDepth);
  return out;
}

// Soft ceiling on serialized HTML (~30k tokens). Generous given Gemini's ~1M-token window, so a
// full page/list usually fits; when it doesn't, truncation now reports the omitted-child count so
// the model knows the view is partial. Note: this is per-snapshot and the conversation accumulates,
// so it's still bounded rather than unlimited.
const MAX_HTML = 30000;

function snapshotHtml(selector?: string, depth?: number) {
  const interactiveSet = new Set<Element>(interactiveCandidates());
  let root: Element;
  let maxDepth: number;

  if (!selector) {
    root = document.body;
    maxDepth = depth ?? 3;
  } else {
    const el = resolveRef(selector); // accepts a `data-sel` ref or a raw CSS selector
    if (!el) throw new Error(`no element matches ${selector}` + nearMisses(selector, identifiableElements()));
    root = el;
    maxDepth = depth ?? Infinity; // full expansion of the drilled-in element when `n` is omitted
  }
  const html = serializeHTML(root, maxDepth, interactiveSet, MAX_HTML);
  return { title: document.title, url: location.href, html };
}

// ── Click diff — what appeared / disappeared / changed after a click ──────────────────────────
type ElInfo = {
  ref: string; // `data-sel` token, empty for the pre-click pass (those elements may be gone)
  tag: string;
  text: string;
  aria: string;
  role: string;
  ariaExpanded: string;
  ariaSelected: string;
  disabled: string;
};

// Keyed by bestSelector (a STABLE key across the before/after passes — keying by ref would make
// every element look added/removed since refs are reassigned each call). `assignRefs` registers
// fresh refs so the post-click ("after") elements are resolvable for the model's next click.
function interactiveElements(assignRefs: boolean): Map<string, ElInfo> {
  const cands = interactiveCandidates();
  const set = new Set<Element>(cands);
  const map = new Map<string, ElInfo>();
  for (const el of cands) {
    const sel = bestSelector(el);
    map.set(sel, {
      ref: assignRefs ? assignRef(el) : '',
      tag: el.tagName.toLowerCase(),
      text: ownText(el, set).slice(0, 60),
      aria: el.getAttribute('aria-label') || '',
      role: el.getAttribute('role') || '',
      ariaExpanded: el.getAttribute('aria-expanded') || '',
      ariaSelected: el.getAttribute('aria-selected') || '',
      disabled: (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') ? '1' : '',
    });
  }
  return map;
}

function renderEl(e: ElInfo): string {
  const attrs: string[] = [];
  if (e.ref) attrs.push(`data-sel="${e.ref}"`); // omitted for removed elements (no live ref)
  if (e.role) attrs.push(`role="${e.role}"`);
  if (e.aria) attrs.push(`aria-label="${escapeAttr(e.aria)}"`);
  const head = attrs.length ? `${e.tag} ${attrs.join(' ')}` : e.tag;
  return `<${head}>${escapeText(e.text)}</${e.tag}>`;
}

function formatDiff(before: Map<string, ElInfo>, after: Map<string, ElInfo>): string {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [sel, a] of after) {
    const b = before.get(sel);
    if (!b) {
      added.push(`+ ${renderEl(a)}`);
      continue;
    }
    const deltas: string[] = [];
    if (b.ariaExpanded !== a.ariaExpanded) deltas.push(`aria-expanded: ${b.ariaExpanded || '∅'} → ${a.ariaExpanded || '∅'}`);
    if (b.ariaSelected !== a.ariaSelected) deltas.push(`aria-selected: ${b.ariaSelected || '∅'} → ${a.ariaSelected || '∅'}`);
    if (b.disabled !== a.disabled) deltas.push(`disabled: ${b.disabled ? 'true' : 'false'} → ${a.disabled ? 'true' : 'false'}`);
    if (deltas.length) changed.push(`~ ${a.ref || sel} ${deltas.join(', ')}`);
  }
  for (const [sel, b] of before) {
    if (!after.has(sel)) removed.push(`- ${renderEl(b)}`);
  }

  const lines = [...added, ...removed, ...changed];
  if (!lines.length) return '(no visible DOM changes)';
  const MAX = 60;
  if (lines.length > MAX) {
    return lines.slice(0, MAX).join('\n') + `\n… and ${lines.length - MAX} more changes`;
  }
  return lines.join('\n');
}

// ── Extract map — a compact, ref-bearing survey of every interactive element under `root` ─────
// One line per element so a long list/grid/menu fits in a few KB (vs. the deep HTML snapshot,
// which truncates). Each ref is registered (assignRef) so the model can click/type it afterward.
const MAP_MAX_LINES = 400;

function extractMap(root: Element): string {
  const cands = interactiveCandidates(root);
  const set = new Set<Element>(cands);
  const lines: string[] = [];
  for (const el of cands) {
    if (lines.length >= MAP_MAX_LINES) break;
    const tag = el.tagName.toLowerCase();
    const text = ownText(el, set).slice(0, 80);
    const parts = [`[${assignRef(el)}]`, tag];
    if (text) parts.push(`"${text}"`);
    const role = el.getAttribute('role');
    if (role && !['button', 'a', 'input', 'textarea', 'select'].includes(tag)) parts.push(`role=${role}`);
    const aria = el.getAttribute('aria-label');
    if (aria && !text) parts.push(`aria="${aria.slice(0, 80)}"`);
    const ph = el.getAttribute('placeholder');
    if (ph) parts.push(`placeholder="${ph.slice(0, 60)}"`);
    const type = el.getAttribute('type');
    if (type) parts.push(`type=${type}`);
    if (tag === 'input' || tag === 'textarea') {
      const v = (el as HTMLInputElement | HTMLTextAreaElement).value;
      if (v) parts.push(`value="${v.slice(0, 60)}"`);
    }
    // Rich-text editors (email/doc compose bodies, often inside an iframe) are bare contentEditable
    // <div>s with no label — flag them + their id so the model can find "the editor" and type() into it.
    if ((el as HTMLElement).isContentEditable) {
      parts.push('contenteditable');
      const id = (el as HTMLElement).id;
      if (id) parts.push(`id=${id}`);
    }
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href) parts.push(`href=${href.slice(0, 80)}`);
    }
    lines.push(parts.join(' '));
  }
  let out = lines.join('\n');
  if (cands.length > lines.length) {
    out += `\n… and ${cands.length - lines.length} more interactive elements (scope with a selector to see them)`;
  }
  return out || '(no interactive elements found)';
}

// Named keys the press() tool can dispatch, with the standard key/code/keyCode each carries. Covers
// the common commit/submit/dismiss/navigate keys and letters used in modifier combos (Cmd+A/C/V/etc.).
// Arbitrary character typing goes through type().
const KEY_META: Record<string, { key: string; code: string; keyCode: number }> = {
  Enter:      { key: 'Enter',      code: 'Enter',       keyCode: 13 },
  Tab:        { key: 'Tab',        code: 'Tab',         keyCode: 9 },
  Escape:     { key: 'Escape',     code: 'Escape',      keyCode: 27 },
  Backspace:  { key: 'Backspace',  code: 'Backspace',   keyCode: 8 },
  ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',     keyCode: 38 },
  ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',   keyCode: 40 },
  ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',   keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight',  keyCode: 39 },
  // Letters — only meaningful when paired with a modifier (e.g. Meta+a = select-all)
  a: { key: 'a', code: 'KeyA', keyCode: 65 },
  c: { key: 'c', code: 'KeyC', keyCode: 67 },
  f: { key: 'f', code: 'KeyF', keyCode: 70 },
  s: { key: 's', code: 'KeyS', keyCode: 83 },
  v: { key: 'v', code: 'KeyV', keyCode: 86 },
  x: { key: 'x', code: 'KeyX', keyCode: 88 },
  z: { key: 'z', code: 'KeyZ', keyCode: 90 },
};

// Working indicator: prefix document.title so the agent's active tab is recognisable in the tab
// strip. Re-applied on an interval because SPAs rewrite document.title as they navigate/update.
const WORK_PREFIX = '🟢 ';
let workTitleTimer: ReturnType<typeof setInterval> | null = null;

function setWorking(working: boolean): ContentResult {
  if (working) {
    if (!document.title.startsWith(WORK_PREFIX)) document.title = WORK_PREFIX + document.title;
    if (workTitleTimer == null) {
      workTitleTimer = setInterval(() => {
        if (!document.title.startsWith(WORK_PREFIX)) document.title = WORK_PREFIX + document.title;
      }, 1000);
    }
    showThinking(true); // run begun — show "Thinking…" and reset the cursor for a clean first action
  } else {
    if (workTitleTimer != null) { clearInterval(workTitleTimer); workTitleTimer = null; }
    if (document.title.startsWith(WORK_PREFIX)) document.title = document.title.slice(WORK_PREFIX.length);
    hideOverlay(); // agent stopped/finished/errored — fade cursor + pill out
  }
  return { ok: true, data: { working } };
}

// ─────────────────────────────────────────────────────────────────────────────
// On-page interaction cursor — a single circle that glides to each click/type/press
// target so a human watching the tab can follow what the agent is doing. Ported from
// the "DODO Ripple Pulse" design (single gliding cursor; no motion trail). It lives in
// a CLOSED shadow root mounted on the top document: style-isolated from the page, and
// invisible to the agent's own snapshot/extract (which walk light DOM only).
// ─────────────────────────────────────────────────────────────────────────────

const OVERLAY_ATTR = 'data-dodo-overlay';
const ACCENT = '#6b4ea3';
const GLIDE_MS = 300; // fast glide; the handler waits this out (distance-scaled) before acting

const OVERLAY_CSS = `
  .layer{position:fixed;inset:0;overflow:hidden;pointer-events:none}
  .cur-pos{position:absolute;left:0;top:0;
    transform:translate(var(--x,-100px),var(--y,-100px));
    transition:transform ${GLIDE_MS}ms cubic-bezier(.45,.02,.2,1)}
  .cur-dot{position:absolute;left:0;top:0;transform:translate(-50%,-50%);
    width:21px;height:21px;border-radius:50%;box-sizing:border-box;
    border:2px solid ${ACCENT};background:rgba(107,78,163,.14);
    display:flex;align-items:center;justify-content:center}
  .cur-dot.tap{animation:cur-tap .44s cubic-bezier(.3,.7,.3,1)}
  @keyframes cur-tap{
    0%{transform:translate(-50%,-50%) scale(1)}
    42%{transform:translate(-50%,-50%) scale(.58);background:rgba(107,78,163,.34)}
    100%{transform:translate(-50%,-50%) scale(1)}
  }
  /* per-action glyph — click shows nothing (clean ring), type/press show their mark */
  .glyph{display:none}
  .cur-dot[data-action="type"] .g-type{display:block}
  .cur-dot[data-action="press"] .g-press{display:block}
  .flash{position:absolute;box-sizing:border-box;border:2px solid ${ACCENT};
    background:rgba(107,78,163,.07);animation:flash 620ms ease-out forwards}
  @keyframes flash{0%{opacity:0}14%{opacity:1}100%{opacity:0}}
  .pill{position:fixed;left:16px;bottom:16px;display:none;align-items:center;gap:9px;
    padding:8px 14px 8px 11px;border-radius:999px;background:rgba(26,24,19,.9);color:#f3efe9;
    font:600 12.5px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.01em;
    -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
    box-shadow:0 8px 24px rgba(0,0,0,.28);max-width:60vw}
  .pill.show{display:flex}
  .tag{flex:none;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
    padding:2px 7px;border-radius:5px;background:rgba(165,131,218,.22);color:#c7aef0}
  .cap{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .spark{flex:none}
  .dots{display:none}
  /* thinking mode — hide the action tag, show "Thinking" + animated dots, pulse the spark */
  .pill.thinking .tag{display:none}
  .pill.thinking .dots{display:inline-flex;gap:2px}
  .pill.thinking .spark{animation:spark-pulse 1.2s ease-in-out infinite}
  .dots i{width:3px;height:3px;border-radius:50%;background:#c7aef0;display:inline-block;
    animation:dot-blink 1.4s infinite}
  .dots i:nth-child(2){animation-delay:.2s}
  .dots i:nth-child(3){animation-delay:.4s}
  @keyframes dot-blink{0%,60%,100%{opacity:.25}30%{opacity:1}}
  @keyframes spark-pulse{0%,100%{opacity:.55;transform:scale(.9)}50%{opacity:1;transform:scale(1.1)}}
`;

interface Overlay {
  host: HTMLElement;     // shadow host — opacity fades the whole overlay on stop
  pos: HTMLElement;      // .cur-pos — owns the glide
  dot: HTMLElement;      // .cur-dot — the circle (taps), carries data-action glyph
  flashBox: HTMLElement; // container the outline boxes spawn into
  pill: HTMLElement;     // caption pill
  tag: HTMLElement;      // action chip
  cap: HTMLElement;      // caption text
  thinkTimer: ReturnType<typeof setTimeout> | null; // flips the pill to "Thinking…" between actions
}

// Get-or-create the overlay. Module state resets on each content-script re-injection, so the
// element refs are stashed on the host DOM node (which persists) and retrieved on later ops.
function getOverlay(): Overlay | null {
  if (!document.body) return null;
  const existing = document.querySelector(`[${OVERLAY_ATTR}]`) as (HTMLElement & { __dodo?: Overlay }) | null;
  if (existing?.__dodo) return existing.__dodo;

  const host = document.createElement('div');
  host.setAttribute(OVERLAY_ATTR, '');
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .28s ease';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>${OVERLAY_CSS}</style>
    <div class="layer">
      <div class="flashes"></div>
      <div class="cur-pos"><div class="cur-dot">
        <svg class="glyph g-type" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${ACCENT}"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19"/><path d="M8.5 5h7M8.5 19h7"/>
        </svg>
        <svg class="glyph g-press" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${ACCENT}"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="8.5 9 4.5 13 8.5 17"/><path d="M4.5 13h11a3.5 3.5 0 0 0 3.5-3.5V6"/>
        </svg>
      </div></div>
    </div>
    <div class="pill">
      <svg class="spark" width="15" height="15" viewBox="0 0 24 24" fill="#a583da" aria-hidden="true">
        <path d="M12 2l1.8 5.6L19.5 9l-4.6 3.4L16.6 18 12 14.7 7.4 18l1.7-5.6L4.5 9l5.7-1.4z"/>
      </svg>
      <span class="tag"></span>
      <span class="cap"></span>
      <span class="dots"><i></i><i></i><i></i></span>
    </div>`;
  const o: Overlay = {
    host,
    pos: root.querySelector('.cur-pos') as HTMLElement,
    dot: root.querySelector('.cur-dot') as HTMLElement,
    flashBox: root.querySelector('.flashes') as HTMLElement,
    pill: root.querySelector('.pill') as HTMLElement,
    tag: root.querySelector('.tag') as HTMLElement,
    cap: root.querySelector('.cap') as HTMLElement,
    thinkTimer: null,
  };
  document.body.appendChild(host);
  (host as HTMLElement & { __dodo?: Overlay }).__dodo = o;
  return o;
}

// An element's rect in the TOP document's viewport. The content script runs in the top frame but a
// target may live in a same-origin iframe, where getBoundingClientRect() is iframe-local — walk the
// frame chain adding each frame's offset so the cursor lands in the right place.
function viewportRectInTop(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  let x = r.left, y = r.top;
  let win: Window | null = el.ownerDocument.defaultView;
  while (win && win !== window.top) {
    let frame: Element | null = null;
    try { frame = win.frameElement; } catch { frame = null; } // cross-origin — stop walking
    if (!frame) break;
    const fr = frame.getBoundingClientRect();
    x += fr.left; y += fr.top;
    win = frame.ownerDocument.defaultView;
  }
  return { x, y, w: r.width, h: r.height };
}

// Short accessible name for the caption pill.
function elementLabel(el: Element): string {
  const he = el as HTMLElement;
  const aria = he.getAttribute('aria-label');
  const text = (he.innerText || he.textContent || '').trim().replace(/\s+/g, ' ');
  const raw = aria?.trim() || text || he.getAttribute('placeholder')?.trim()
    || (he as HTMLInputElement).value?.trim() || he.tagName.toLowerCase();
  return raw.slice(0, 40);
}

const MOD_SYM: Record<string, string> = { Meta: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' };
function pressLabel(key: string, mods: string[]): string {
  return mods.map((m) => MOD_SYM[m] ?? m).join('') + (key.length === 1 ? key.toUpperCase() : key);
}

// Glide the cursor to `el`, then resolve once it has (roughly) arrived so the caller acts in sync.
// Fire-and-forget for visuals: it never throws and never changes the handler's result.
function showCursor(action: 'click' | 'type' | 'press', el: Element, label: string): Promise<void> {
  let o: Overlay | null;
  try { o = getOverlay(); } catch { o = null; }
  if (!o) return Promise.resolve();
  const { x, y, w, h } = viewportRectInTop(el);
  const cx = x + w / 2, cy = y + h / 2;

  const prevX = parseFloat(o.pos.style.getPropertyValue('--x')) || cx;
  const prevY = parseFloat(o.pos.style.getPropertyValue('--y')) || cy;
  const dist = Math.hypot(cx - prevX, cy - prevY);
  const diag = Math.hypot(window.innerWidth, window.innerHeight) || 1000;
  const lead = Math.round(GLIDE_MS * Math.min(1, dist / diag));

  o.host.style.opacity = '1'; // ensure visible (a prior stop may have faded it out)
  const hadPos = o.pos.style.getPropertyValue('--x') !== '';
  if (!hadPos) o.pos.style.transition = 'none'; // first placement: snap, don't glide in from the corner
  o.pos.style.setProperty('--x', cx + 'px');
  o.pos.style.setProperty('--y', cy + 'px');
  if (!hadPos) { void o.pos.offsetWidth; o.pos.style.transition = ''; }

  o.dot.dataset.action = action;       // swap the in-cursor glyph (type/press; click = empty ring)
  o.pill.classList.remove('thinking'); // show the action label, not "Thinking…"
  o.tag.textContent = action.toUpperCase();
  o.cap.textContent = label;
  o.pill.classList.add('show');
  if (o.thinkTimer) clearTimeout(o.thinkTimer);

  return new Promise<void>((resolve) => {
    setTimeout(() => {
      if (action !== 'type') { // click/press tap; type rests
        o!.dot.classList.remove('tap');
        void o!.dot.offsetWidth; // restart the keyframe animation
        o!.dot.classList.add('tap');
      }
      const fl = document.createElement('div');
      fl.className = 'flash';
      const pad = 3;
      fl.style.cssText = `left:${x - pad}px;top:${y - pad}px;width:${w + 2 * pad}px;height:${h + 2 * pad}px;border-radius:10px`;
      o!.flashBox.appendChild(fl);
      setTimeout(() => fl.remove(), 700);
      // After the action's label has shown a beat, drift into "Thinking…" — the real gap before the
      // next action is the agent reasoning. The next action (or a stop) clears this.
      o!.thinkTimer = setTimeout(() => showThinking(), 900);
      resolve();
    }, lead);
  });
}

// Put the pill into its animated "Thinking…" state. `resetPos` (run start) snaps the cursor back
// off-screen — with the transition disabled so it doesn't glide in from last run's position — so the
// first action snaps onto its target instead of flying across the page. The mid-action thinkTimer
// calls this WITHOUT resetPos, leaving the cursor resting where it is.
function showThinking(resetPos = false): void {
  let o: Overlay | null;
  try { o = getOverlay(); } catch { o = null; }
  if (!o) return;
  if (resetPos) {
    o.pos.style.transition = 'none';
    o.pos.style.removeProperty('--x');
    o.pos.style.removeProperty('--y');
    void o.pos.offsetWidth;
    o.pos.style.transition = '';
  }
  o.host.style.opacity = '1';
  if (o.thinkTimer) { clearTimeout(o.thinkTimer); o.thinkTimer = null; }
  o.cap.textContent = 'Thinking';
  o.pill.classList.add('thinking', 'show');
}

// Fade the whole overlay out when the agent stops/finishes — cursor and pill together, in place, via
// the host's opacity transition. The host stays in the DOM (opacity 0) so a quick restart just fades
// it back in; the next run's `showThinking(true)` resets the cursor position.
function hideOverlay(): void {
  const host = document.querySelector(`[${OVERLAY_ATTR}]`) as (HTMLElement & { __dodo?: Overlay }) | null;
  if (!host?.__dodo) return;
  const o = host.__dodo;
  if (o.thinkTimer) { clearTimeout(o.thinkTimer); o.thinkTimer = null; }
  host.style.opacity = '0';
}

async function handle(op: ContentOp): Promise<ContentResult> {
  console.log('%c[dodo:content]', 'color:#6b4ea3;font-weight:600', op);
  try {
    if (op.op === 'set_working') {
      return setWorking(op.working);
    }
    if (op.op === 'click') {
      const el = resolveRef(op.selector);
      if (!el) return { ok: false, error: `no element matches ${op.selector} — the ref may be stale, call snapshot() again` + nearMisses(op.selector, interactiveCandidates()) };
      const before = interactiveElements(false);
      (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' });
      await showCursor('click', el, elementLabel(el)); // glide the on-page cursor over, then click
      (el as HTMLElement).click();
      // Let the page settle — clicks that open dropdowns/menus/dialogs need a beat before
      // the post-click snapshot, otherwise the new overlay items aren't in the DOM yet.
      await new Promise<void>((r) => setTimeout(r, 350));
      const after = interactiveElements(true);
      return { ok: true, data: { clicked: op.selector, diff: formatDiff(before, after) } };
    }
    if (op.op === 'type') {
      const el = resolveRef(op.selector) as HTMLElement | null;
      if (!el) return { ok: false, error: `no element matches ${op.selector} — the ref may be stale, call snapshot() again` + nearMisses(op.selector, interactiveCandidates()) };
      const before = interactiveElements(false);
      el.focus();
      await showCursor('type', el, op.text ? `"${op.text.slice(0, 38)}"` : 'type');
      const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (isField) {
        // Native value setter so React/controlled inputs pick up the change.
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, op.text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.isContentEditable) {
        // Rich-text editor (e.g. Proton/Gmail Rooster, possibly inside a same-origin iframe).
        // execCommand runs against the element's OWN document and emits the input/beforeinput the
        // editor listens for. ownerDocument may be the iframe's document, not the top one.
        // INSERT at the caret — do NOT select-all-then-insert (that REPLACES the whole body, so
        // successive type()s each wipe the previous text). When the caret isn't already inside this
        // editor, collapse to the START so inserted text lands above any signature block.
        const doc = el.ownerDocument;
        const sel = doc.getSelection();
        const caretInEditor = !!sel && sel.rangeCount > 0 && el.contains(sel.anchorNode);
        if (sel && !caretInEditor) {
          const range = doc.createRange();
          range.selectNodeContents(el);
          range.collapse(true); // collapse to start: insert, don't replace
          sel.removeAllRanges();
          sel.addRange(range);
        }
        const inserted = doc.execCommand?.('insertText', false, op.text);
        if (!inserted) {
          el.textContent = (el.textContent ?? '') + op.text;
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
      } else {
        return { ok: false, error: `element ${op.selector} is not typeable (not an input, textarea, or contentEditable)` };
      }
      await new Promise<void>((r) => setTimeout(r, 350));
      const after = interactiveElements(true);
      // Read the value AFTER the settle so async/controlled resets are reflected: typing usually
      // produces no element add/remove (the diff stays empty), so `value` is the signal that the
      // text landed and the model needn't retry.
      const value = isField ? (el as HTMLInputElement | HTMLTextAreaElement).value : (el.textContent ?? '');
      // A non-empty type that left the field empty means it rejected the programmatic write — almost
      // always a controlled search/combobox that must be opened/activated first. Tell the model so it
      // tries a different move instead of re-typing identically (the observed failure loop).
      const rejected = op.text.trim().length > 0 && value.length === 0;
      return {
        ok: true,
        data: {
          typed: op.text.length,
          value: value.slice(0, 200),
          diff: formatDiff(before, after),
          ...(rejected ? { note: "the field is empty after typing — it rejected the text. This is usually an inert/collapsed search or combobox: clicking or re-typing into THIS input does nothing. Instead click the adjacent TRIGGER — a nearby \"Search\" button/icon or the surrounding control, NOT this input — to open the real search panel, then type into the NEW input that appears there. Do not re-type into this same field." } : {}),
        },
      };
    }
    if (op.op === 'press') {
      const target = (op.selector ? resolveRef(op.selector) : document.activeElement) as HTMLElement | null;
      if (!target) return { ok: false, error: op.selector
        ? `no element matches ${op.selector} — the ref may be stale, call snapshot() again` + nearMisses(op.selector, interactiveCandidates())
        : 'no element is focused — pass a selector to press a key on a specific element' };
      const before = interactiveElements(false);
      if (op.selector) target.focus();
      const meta = KEY_META[op.key];
      if (!meta) return { ok: false, error: `unsupported key "${op.key}" — use one of: ${Object.keys(KEY_META).join(', ')}` };
      await showCursor('press', target, pressLabel(op.key, op.modifiers ?? []));
      const mods = op.modifiers ?? [];
      const modInit = {
        metaKey:  mods.includes('Meta'),
        ctrlKey:  mods.includes('Control'),
        altKey:   mods.includes('Alt'),
        shiftKey: mods.includes('Shift'),
      };
      const focused = (target.ownerDocument.activeElement as HTMLElement | null) ?? target;
      const doc = focused.ownerDocument;

      // Synthetic keyboard events don't trigger native browser behaviors (select-all, copy, etc.).
      // For primary-modifier combos (Meta/Ctrl), invoke the real browser API first, then dispatch
      // the keyboard event so app-level listeners also fire.
      if (mods.includes('Meta') || mods.includes('Control')) {
        if (op.key === 'a') {
          if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
            focused.select();
          } else {
            doc.execCommand('selectAll');
          }
        } else if (op.key === 'c') {
          doc.execCommand('copy');
        } else if (op.key === 'x') {
          doc.execCommand('cut');
        } else if (op.key === 'z') {
          doc.execCommand(mods.includes('Shift') ? 'redo' : 'undo');
        } else if (op.key === 'v') {
          doc.execCommand('paste');
        }
      }

      for (const type of ['keydown', 'keyup'] as const) {
        focused.dispatchEvent(new KeyboardEvent(type, {
          key: meta.key, code: meta.code, keyCode: meta.keyCode, which: meta.keyCode,
          bubbles: true, cancelable: true, ...modInit,
        }));
      }
      await new Promise<void>((r) => setTimeout(r, 350));
      const after = interactiveElements(true);
      return { ok: true, data: { pressed: op.key, diff: formatDiff(before, after) } };
    }
    if (op.op === 'extract') {
      const target = op.selector
        ? (resolveRef(op.selector) as HTMLElement | null)
        : document.body;
      if (!target) return { ok: false, error: `no element matches ${op.selector}` + nearMisses(op.selector!, identifiableElements()) };
      // Default 'map' = compact interactive survey (every element + its ref); 'text' = raw prose.
      const text = op.mode === 'text'
        ? (target.innerText ?? '').replace(/\s+\n/g, '\n').trim()
        : extractMap(target);
      return { ok: true, data: { text, title: document.title, url: location.href } };
    }
    if (op.op === 'snapshot') {
      return { ok: true, data: snapshotHtml(op.selector, op.depth) };
    }
    if (op.op === 'snapshot_structured') {
      return { ok: true, data: snapshot() };
    }
    return { ok: false, error: 'unknown op' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
