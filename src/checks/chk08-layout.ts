import type { Check, Finding, Rect, RunContext } from '../shared/types';
import {
  INTERACTIVE_SELECTOR,
  accessibleName,
  inAny,
  isVisible,
  rectOf,
  selectorFor,
  snippetOf,
} from '../engine/dom';
import { makeFinding } from './rules';

interface Item {
  selector: string;
  snippet: string;
  rect: Rect;
}
interface Data {
  viewport: { w: number; h: number };
  overflow: {
    scrollWidth: number;
    clientWidth: number;
    offenders: (Item & { overshoot: number })[];
  } | null;
  obscured: (Item & { by: string; bySelector: string })[];
  clipped: (Item & { sw: number; cw: number; sh: number; ch: number })[];
  tapSmall: (Item & { w: number; h: number; name: string })[];
  tapStrict: (Item & { w: number; h: number; name: string })[];
  fixedBig: (Item & { ratio: number; position: string })[];
  truncated: number;
}

const MAX_HIT_TESTS = 150;

function isInline(el: Element): boolean {
  if (el.tagName !== 'A') return false;
  const cs = getComputedStyle(el);
  if (cs.display !== 'inline') return false;
  // inline link inside running text: WCAG 2.5.8 exempts it
  const p = el.parentElement;
  if (!p) return false;
  const own = Array.from(p.childNodes).some(
    (n) => n.nodeType === 3 && (n.nodeValue ?? '').trim().length > 0,
  );
  return own;
}

export const chk08: Check<Data> = {
  id: 'CHK-08',
  title: 'Layout',
  category: 'layout',
  group: 'layout',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'each',
  passedLabel: 'No overflow, covered controls, clipped text or tiny tap targets',
  async collect(ctx) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const skip = ctx.options.skipSelectors;
    const de = document.documentElement;
    const data: Data = {
      viewport: { w: vw, h: vh },
      overflow: null,
      obscured: [],
      clipped: [],
      tapSmall: [],
      tapStrict: [],
      fixedBig: [],
      truncated: 0,
    };
    window.scrollTo(0, 0);

    // ---- horizontal overflow ----
    if (de.scrollWidth > de.clientWidth + 1) {
      const offenders: (Item & { overshoot: number })[] = [];
      const cand: Element[] = [];
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed')
          continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // only right-hand overflow creates a horizontal scrollbar (skip links sit at a negative left)
        if (r.right <= vw + 1) continue;
        // ignore content clipped by an overflow container or translated off-canvas on purpose
        let clipped = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ps = getComputedStyle(p);
          if (/(hidden|auto|scroll|clip)/.test(ps.overflowX) || ps.position === 'fixed') {
            clipped = true;
            break;
          }
        }
        if (!clipped) cand.push(el);
      }
      // keep outermost offenders only
      const outer = cand.filter((e) => !cand.some((o) => o !== e && o.contains(e)));
      outer.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
      for (const el of outer.slice(0, 5)) {
        const r = el.getBoundingClientRect();
        offenders.push({
          selector: selectorFor(el),
          snippet: snippetOf(el),
          rect: rectOf(el),
          overshoot: Math.round(r.right - vw),
        });
      }
      data.overflow = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, offenders };
    }

    // ---- gather interactive elements ----
    const interactive: HTMLElement[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR))) {
      if (inAny(el, skip)) continue;
      if (el.closest('[inert]')) continue;
      if (el.matches('input[type=checkbox], input[type=radio]') && !isVisible(el)) continue;
      if (!isVisible(el)) continue;
      interactive.push(el);
    }

    // ---- tap targets (mobile + tablet) ----
    if (ctx.viewport !== 'desktop') {
      for (const el of interactive) {
        if (isInline(el)) continue;
        const r = el.getBoundingClientRect();
        const it = {
          selector: selectorFor(el),
          snippet: snippetOf(el),
          rect: rectOf(el),
          w: Math.round(r.width),
          h: Math.round(r.height),
          name: accessibleName(el).slice(0, 40),
        };
        if (r.width < 24 || r.height < 24) data.tapSmall.push(it);
        else if ((r.width < 44 || r.height < 44) && ctx.options.strictTapTargets)
          data.tapStrict.push(it);
      }
      data.tapSmall = data.tapSmall.slice(0, 40);
      data.tapStrict = data.tapStrict.slice(0, 40);
    }

    // ---- fixed / sticky coverage (mobile) ----
    if (ctx.viewport === 'mobile') {
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        if (!isVisible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.5) continue;
        const ratio = r.height / vh;
        if (ratio > 0.35 && r.height < vh * 0.99) {
          data.fixedBig.push({
            selector: selectorFor(el),
            snippet: snippetOf(el),
            rect: rectOf(el),
            ratio: Math.round(ratio * 100) / 100,
            position: cs.position,
          });
        }
      }
    }

    // ---- clipped text ----
    let n = 0;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      if (n >= 20) break;
      if (el.clientWidth <= 1 || el.clientHeight <= 1) continue;
      const cs = getComputedStyle(el);
      const hiddenX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const hiddenY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (!hiddenX && !hiddenY) continue;
      if (cs.textOverflow === 'ellipsis') continue;
      if (/-webkit-box/.test(cs.display) || cs.getPropertyValue('-webkit-line-clamp') !== 'none')
        continue;
      const overW = hiddenX && el.scrollWidth > el.clientWidth + 2;
      const overH = hiddenY && el.scrollHeight > el.clientHeight + 2;
      if (!overW && !overH) continue;
      if (!isVisible(el) || inAny(el, skip)) continue;
      if (!(el.innerText ?? '').trim()) continue;
      // carousels intentionally clip their track
      if (el.matches('slider-component, .slider, [role=region][aria-roledescription], ul.slider'))
        continue;
      if (el.querySelector('[aria-roledescription=slide], .slider__slide')) continue;
      data.clipped.push({
        selector: selectorFor(el),
        snippet: snippetOf(el),
        rect: rectOf(el),
        sw: el.scrollWidth,
        cw: el.clientWidth,
        sh: el.scrollHeight,
        ch: el.clientHeight,
      });
      n++;
    }

    // ---- obscured interactive elements (hit testing) ----
    const toTest = interactive.slice(0, MAX_HIT_TESTS);
    data.truncated = Math.max(0, interactive.length - toTest.length);
    for (const el of toTest) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const pts: [number, number][] = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + Math.min(r.width * 0.25, 12), r.top + Math.min(r.height * 0.25, 12)],
      ];
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (!top) continue;
        if (top === el || el.contains(top) || top.contains(el)) continue;
        const label = el.closest('label');
        if (label && (label === top || label.contains(top))) continue;
        data.obscured.push({
          selector: selectorFor(el),
          snippet: snippetOf(el),
          rect: rectOf(el),
          by: snippetOf(top, 140),
          bySelector: selectorFor(top),
        });
        break;
      }
    }
    window.scrollTo(0, 0);
    return data;
  },
  analyze(d: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    if (d.overflow) {
      const names = d.overflow.offenders.map((o) => o.selector).join(', ');
      const severity = ctx.viewport === 'desktop' ? 'warning' : 'error';
      const first = d.overflow.offenders[0];
      out.push(
        makeFinding('CHK-08', ctx, {
          rule: 'layout/horizontal-overflow',
          severity,
          message: `Page scrolls horizontally (content ${d.overflow.scrollWidth}px wide in a ${d.overflow.clientWidth}px viewport)${names ? '; widest: ' + names : ''}`,
          selector: first?.selector ?? 'html',
          htmlSnippet: first?.snippet,
          rect: first?.rect,
          meta: { offenders: d.overflow.offenders },
        }),
      );
    }
    for (const o of d.obscured) {
      out.push(
        makeFinding('CHK-08', ctx, {
          rule: 'layout/obscured-interactive',
          severity: 'error',
          message: `Element is covered by ${o.bySelector}`,
          selector: o.selector,
          htmlSnippet: o.snippet,
          rect: o.rect,
          meta: { coveredBy: o.by },
        }),
      );
    }
    for (const c of d.clipped) {
      out.push(
        makeFinding('CHK-08', ctx, {
          rule: 'layout/clipped-text',
          severity: 'info',
          message: `Text is clipped (content ${c.sw}x${c.sh}, box ${c.cw}x${c.ch})`,
          selector: c.selector,
          htmlSnippet: c.snippet,
          rect: c.rect,
        }),
      );
    }
    for (const t of d.tapSmall) {
      out.push(
        makeFinding('CHK-08', ctx, {
          rule: 'layout/tap-target-small',
          severity: 'warning',
          message: `Tap target is ${t.w}x${t.h}px (minimum 24x24)${t.name ? ` — "${t.name}"` : ''}`,
          selector: t.selector,
          htmlSnippet: t.snippet,
          rect: t.rect,
        }),
      );
    }
    for (const t of d.tapStrict) {
      out.push(
        makeFinding('CHK-08', ctx, {
          rule: 'layout/tap-target-strict',
          severity: 'info',
          message: `Tap target is ${t.w}x${t.h}px (recommended 44x44)`,
          selector: t.selector,
          htmlSnippet: t.snippet,
          rect: t.rect,
        }),
      );
    }
    for (const f of d.fixedBig) {
      out.push(
        makeFinding('CHK-08', ctx, {
          rule: 'layout/fixed-covers-viewport',
          severity: 'warning',
          message: `A ${f.position} element covers ${Math.round(f.ratio * 100)}% of the mobile viewport height`,
          selector: f.selector,
          htmlSnippet: f.snippet,
          rect: f.rect,
        }),
      );
    }
    if (d.truncated > 0) {
      out.push(
        makeFinding('CHK-08', ctx, {
          rule: 'layout/clipped-text',
          severity: 'info',
          title: 'Hit-testing capped',
          message: `Hit-tested the first ${MAX_HIT_TESTS} interactive elements; ${d.truncated} were not tested.`,
          selector: 'layout:cap',
        }),
      );
    }
    return out;
  },
};
