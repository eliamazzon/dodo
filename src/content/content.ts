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
  } else {
    if (workTitleTimer != null) { clearInterval(workTitleTimer); workTitleTimer = null; }
    if (document.title.startsWith(WORK_PREFIX)) document.title = document.title.slice(WORK_PREFIX.length);
  }
  return { ok: true, data: { working } };
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
