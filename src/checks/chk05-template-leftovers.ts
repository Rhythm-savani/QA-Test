import type { Check, Finding, Rect, RunContext } from '../shared/types';
import { inAny, isVisible, rectOf, selectorFor, snippetOf } from '../engine/dom';
import { makeFinding } from './rules';

type Kind = 'liquid' | 'translation' | 'raw' | 'placeholder';
interface Hit {
  kind: Kind;
  where: string;
  text: string;
  selector: string;
  snippet: string;
  rect?: Rect;
}
type Data = { hits: Hit[] };

const ATTRS = ['alt', 'aria-label', 'placeholder', 'title'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE', 'TEXTAREA']);

export function classify(text: string): Kind | null {
  if (/Liquid (syntax )?error/i.test(text)) return 'liquid';
  if (/translation missing/i.test(text)) return 'translation';
  if (/\{\{|\{%|\[object Object\]/.test(text)) return 'raw';
  if (/^(undefined|null|NaN)$/.test(text.trim())) return 'raw';
  if (/lorem ipsum/i.test(text)) return 'placeholder';
  return null;
}

export const chk05: Check<Data> = {
  id: 'CHK-05',
  title: 'Template leftovers',
  category: 'content',
  group: 'content',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'first',
  passedLabel: 'No Liquid errors, missing translations or raw template syntax',
  async collect(ctx) {
    const hits: Hit[] = [];
    const push = (kind: Kind, where: string, text: string, el: Element, visible: boolean) => {
      if (hits.length >= 200) return;
      hits.push({
        kind,
        where,
        text: text.trim().slice(0, 160),
        selector: selectorFor(el),
        snippet: snippetOf(el),
        rect: visible ? rectOf(el) : undefined,
      });
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = n.nodeValue ?? '';
      if (!text.trim()) continue;
      const parent = n.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName) || inAny(parent, ctx.options.skipSelectors))
        continue;
      const kind = classify(text);
      if (!kind) continue;
      if (!isVisible(parent)) continue;
      push(kind, 'text', text, parent, true);
    }
    for (const el of Array.from(document.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')))) {
      if (SKIP_TAGS.has(el.tagName) || inAny(el, ctx.options.skipSelectors)) continue;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const kind = classify(v);
        if (kind) push(kind, `attribute ${a}`, v, el, isVisible(el));
      }
    }
    return { hits };
  },
  analyze(data: Data, ctx: RunContext): Finding[] {
    const rule: Record<Kind, string> = {
      liquid: 'content/liquid-error',
      translation: 'content/translation-missing',
      raw: 'content/raw-template-syntax',
      placeholder: 'content/placeholder-text',
    };
    return data.hits.map((h) =>
      makeFinding('CHK-05', ctx, {
        rule: rule[h.kind],
        severity: h.kind === 'placeholder' ? 'warning' : 'error',
        message: `${h.where === 'text' ? 'Visible text' : h.where}: "${h.text}"`,
        selector: h.selector,
        htmlSnippet: h.snippet,
        rect: h.rect,
      }),
    );
  },
};
