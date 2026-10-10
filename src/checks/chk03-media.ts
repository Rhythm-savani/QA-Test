import type { Check, Finding, Rect, RunContext } from '../shared/types';
import { isVisible, rectOf, selectorFor, snippetOf, inAny } from '../engine/dom';
import { makeFinding } from './rules';

interface Img {
  selector: string;
  snippet: string;
  src: string;
  alt: string | null;
  broken: boolean;
  nw: number;
  nh: number;
  rw: number;
  rh: number;
  objectFit: string;
  visible: boolean;
  decorative: boolean;
  rect: Rect;
  dpr: number;
}
interface Vid {
  selector: string;
  snippet: string;
  code: number;
  rect: Rect;
}
type Data = { images: Img[]; videos: Vid[] };

export const chk03: Check<Data> = {
  id: 'CHK-03',
  title: 'Media',
  category: 'media',
  group: 'media',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'each',
  passedLabel: 'Images load, have alt text and keep their aspect ratio',
  async collect(ctx) {
    const images: Img[] = [];
    const nodes = Array.from(document.querySelectorAll('img')).slice(0, 400);
    for (const img of nodes) {
      if (inAny(img, ctx.options.skipSelectors)) continue;
      const src = img.currentSrc || img.getAttribute('src') || '';
      if (!src) continue;
      const r = img.getBoundingClientRect();
      images.push({
        selector: selectorFor(img),
        snippet: snippetOf(img),
        src,
        alt: img.getAttribute('alt'),
        broken: img.complete && img.naturalWidth === 0,
        nw: img.naturalWidth,
        nh: img.naturalHeight,
        rw: r.width,
        rh: r.height,
        objectFit: getComputedStyle(img).objectFit,
        visible: isVisible(img),
        decorative:
          img.getAttribute('role') === 'presentation' ||
          img.getAttribute('aria-hidden') === 'true' ||
          img.getAttribute('role') === 'none',
        rect: rectOf(img),
        dpr: window.devicePixelRatio || 1,
      });
    }
    const videos: Vid[] = [];
    for (const v of Array.from(document.querySelectorAll('video')).slice(0, 50)) {
      if (v.error) {
        videos.push({
          selector: selectorFor(v),
          snippet: snippetOf(v),
          code: v.error.code,
          rect: rectOf(v),
        });
      }
    }
    return { images, videos };
  },
  analyze(data: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    const short = (s: string) => (s.length > 90 ? s.slice(0, 89) + '…' : s);
    for (const i of data.images) {
      const base = { selector: i.selector, htmlSnippet: i.snippet, rect: i.rect };
      if (i.broken) {
        out.push(
          makeFinding('CHK-03', ctx, {
            ...base,
            rule: 'media/broken-image',
            severity: 'error',
            message: `Image failed to load: ${short(i.src)}`,
          }),
        );
        continue;
      }
      if (i.alt === null && !i.decorative) {
        out.push(
          makeFinding('CHK-03', ctx, {
            ...base,
            rule: 'media/missing-alt',
            severity: 'warning',
            message: `Image has no alt attribute: ${short(i.src)}`,
          }),
        );
      }
      if (!i.visible || i.nw === 0 || i.nh === 0 || i.rw === 0 || i.rh === 0) continue;
      const natural = i.nw / i.nh;
      const rendered = i.rw / i.rh;
      if (i.objectFit === 'fill' && Math.abs(rendered / natural - 1) > 0.05) {
        out.push(
          makeFinding('CHK-03', ctx, {
            ...base,
            rule: 'media/stretched-image',
            severity: 'warning',
            message: `Rendered ${Math.round(i.rw)}x${Math.round(i.rh)} but file is ${i.nw}x${i.nh} (aspect ratio differs by ${Math.round(Math.abs(rendered / natural - 1) * 100)}%)`,
          }),
        );
      }
      if (i.nw > 2 * i.rw * i.dpr && i.nw > 600) {
        out.push(
          makeFinding('CHK-03', ctx, {
            ...base,
            rule: 'media/oversized-image',
            severity: 'info',
            message: `File is ${i.nw}px wide but shown at ${Math.round(i.rw)}px (DPR ${i.dpr})`,
          }),
        );
      }
    }
    for (const v of data.videos) {
      out.push(
        makeFinding('CHK-03', ctx, {
          selector: v.selector,
          htmlSnippet: v.snippet,
          rect: v.rect,
          rule: 'media/video-error',
          severity: 'error',
          message: `Video is in an error state (code ${v.code})`,
        }),
      );
    }
    return out;
  },
};
