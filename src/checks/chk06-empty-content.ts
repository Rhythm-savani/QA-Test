import type { Check, Finding, Rect, RunContext } from '../shared/types';
import { isVisible, rectOf, selectorFor, snippetOf } from '../engine/dom';
import { makeFinding } from './rules';

interface Sec {
  id: string;
  type: string;
  selector: string;
  snippet: string;
  height: number;
  textLen: number;
  media: number;
  controls: number;
  rect: Rect;
}
interface Head {
  selector: string;
  snippet: string;
  rect: Rect;
}
type Data = { sections: Sec[]; headings: Head[] };

/** `shopify-section-template--123__hero` -> `hero`; `shopify-section-header` -> `header`. */
export function sectionTypeFromId(id: string): string {
  const rest = id.replace(/^shopify-section-/, '');
  const i = rest.lastIndexOf('__');
  return i >= 0 ? rest.slice(i + 2) : rest;
}

const LOW_PRIORITY = /^(header|footer|announcement)/i;

export const chk06: Check<Data> = {
  id: 'CHK-06',
  title: 'Empty content',
  category: 'content',
  group: 'content',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'first',
  passedLabel: 'Sections and headings have content',
  async collect() {
    const sections: Sec[] = [];
    for (const el of Array.from(document.querySelectorAll('[id^="shopify-section-"]'))) {
      const h = el as HTMLElement;
      const rect = el.getBoundingClientRect();
      sections.push({
        id: el.id,
        type: sectionTypeFromId(el.id),
        selector: selectorFor(el),
        snippet: snippetOf(el, 160),
        height: rect.height,
        textLen: (h.innerText ?? '').trim().length,
        media: el.querySelectorAll('img, svg, video, iframe, canvas, picture').length,
        controls: el.querySelectorAll('a[href], button, input, select, textarea').length,
        rect: rectOf(el),
      });
    }
    const headings: Head[] = [];
    for (const h of Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
      if (!isVisible(h) && (h as HTMLElement).offsetParent === null) continue;
      const txt = (h.textContent ?? '').trim();
      const hasMedia = !!h.querySelector('img[alt]:not([alt=""]), svg[aria-label], [aria-label]');
      if (!txt && !hasMedia && !h.getAttribute('aria-label')) {
        headings.push({ selector: selectorFor(h), snippet: snippetOf(h), rect: rectOf(h) });
      }
    }
    return { sections, headings };
  },
  analyze(data: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    for (const s of data.sections) {
      // A section wrapper that is display:none is intentionally hidden, not "rendering empty".
      const empty = s.height < 1 || (s.textLen === 0 && s.media === 0 && s.controls === 0);
      if (!empty) continue;
      out.push(
        makeFinding('CHK-06', ctx, {
          rule: 'content/empty-section',
          severity: LOW_PRIORITY.test(s.type) ? 'info' : 'warning',
          message: `Section "${s.type}" renders no visible content (height ${Math.round(s.height)}px)`,
          selector: s.selector,
          htmlSnippet: s.snippet,
          rect: s.rect,
          meta: { sectionType: s.type, sectionId: s.id },
        }),
      );
    }
    for (const h of data.headings) {
      out.push(
        makeFinding('CHK-06', ctx, {
          rule: 'content/empty-heading',
          severity: 'warning',
          message: 'Heading has no text',
          selector: h.selector,
          htmlSnippet: h.snippet,
          rect: h.rect.h > 0 ? h.rect : undefined,
        }),
      );
    }
    return out;
  },
};
