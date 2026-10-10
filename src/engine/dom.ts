// DOM helpers used by page-side collectors. Keep them dependency-free: they are bundled into the
// injected script and unit-tested under jsdom.
import type { Rect } from '../shared/types';

export function cssEscape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\u00a0-\uffff-]/g, (c) => '\\' + c).replace(/^(\d)/, '\\3$1 ');
}

const HASHY = /^(css-|sc-|jsx-|_)|[0-9a-f]{6,}|\d{4,}/i;

function stableClasses(el: Element): string[] {
  const out: string[] = [];
  for (const c of Array.from(el.classList)) {
    if (HASHY.test(c) || c.length > 40) continue;
    out.push(c);
    if (out.length >= 2) break;
  }
  return out;
}

const STABLE_ATTRS = ['data-testid', 'data-section-id', 'data-id', 'name', 'aria-label', 'role'];

function isUnique(root: Document | Element, sel: string, el: Element): boolean {
  try {
    const found = root.querySelectorAll(sel);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/** Short, mostly-stable CSS selector: id, then stable attributes, then class + nth-of-type chain. */
export function selectorFor(el: Element): string {
  const doc = el.ownerDocument;
  if (el === doc.documentElement) return 'html';
  if (el === doc.body) return 'body';
  const simpleId = (e: Element) => e.id && !/\s/.test(e.id);
  if (simpleId(el)) {
    const s = '#' + cssEscape(el.id);
    if (isUnique(doc, s, el)) return s;
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== doc.documentElement && cur !== doc.body) {
    let part = cur.tagName.toLowerCase();
    if (simpleId(cur) && cur !== el) {
      const idSel = '#' + cssEscape(cur.id);
      if (isUnique(doc, idSel, cur)) {
        parts.unshift(idSel);
        break;
      }
    }
    let attrDone = false;
    for (const a of STABLE_ATTRS) {
      const v = cur.getAttribute(a);
      if (v && v.length < 40 && a !== 'role') {
        part += `[${a}="${v.replace(/"/g, '\\"')}"]`;
        attrDone = true;
        break;
      }
    }
    if (!attrDone) {
      const cls = stableClasses(cur);
      if (cls.length) part += cls.map((c) => '.' + cssEscape(c)).join('');
    }
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      // only add a position when the tag/attr/class part is still ambiguous among siblings
      if (same.length > 1 && same.filter((c) => c.matches(part)).length > 1) {
        part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(part);
    const sel = parts.join(' > ');
    if (isUnique(doc, sel, el)) return sel;
    cur = parent;
  }
  return parts.join(' > ');
}

export function isVisible(el: Element): boolean {
  const he = el as HTMLElement;
  if (typeof he.checkVisibility === 'function') {
    if (!he.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  } else {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left + window.scrollX),
    y: Math.round(r.top + window.scrollY),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}

export function snippetOf(el: Element, max = 220): string {
  const clone = el.cloneNode(false) as Element;
  let s = clone.outerHTML;
  const inner = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (inner && !/\/>$/.test(s)) {
    s = s.replace(/<\/[a-z0-9-]+>$/i, inner + '$&');
  }
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    const t = lb
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (t) return t;
  }
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
  if (text) return text;
  const title = el.getAttribute('title');
  if (title) return title.trim();
  const img = el.querySelector('img[alt]');
  if (img) return (img.getAttribute('alt') ?? '').trim();
  const v = (el as HTMLInputElement).value;
  if (typeof v === 'string' && el.tagName === 'INPUT') return v;
  return '';
}

export const INTERACTIVE_SELECTOR =
  'a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary, [tabindex]:not([tabindex="-1"])';

export function inAny(el: Element, selectors: string[]): boolean {
  for (const s of selectors) {
    if (!s) continue;
    try {
      if (el.closest(s)) return true;
    } catch {
      // invalid user selector: ignore
    }
  }
  return false;
}

export function deepText(el: Element): string {
  return (el.textContent ?? '').trim().replace(/\s+/g, ' ');
}
