// CHK-19 (stretch): visual baseline comparison. Page side only reports where the masks are and
// the page geometry; the orchestrator captures the viewport and runs the pixel diff, then calls
// analyze() with the outcome (same contract as every other check).
import type { Check, Finding, Rect, RunContext } from '../shared/types';
import { isVisible } from '../engine/dom';
import { makeFinding } from './rules';

export interface VisualResult {
  state: 'no-baseline' | 'same' | 'diff' | 'size-changed' | 'error';
  ratio?: number;
  message?: string;
}

export interface VisualData {
  path: string;
  cssWidth: number;
  cssHeight: number;
  /** Viewport-space rects of regions that legitimately change (carousels, video). */
  masks: Rect[];
  result?: VisualResult;
}

export const chk19: Check<VisualData> = {
  id: 'CHK-19',
  title: 'Visual baseline',
  category: 'layout',
  group: 'visual',
  mutatesState: false,
  defaultEnabled: false,
  needs: ['debugger'],
  viewportScope: 'each',
  passedLabel: 'Page matches its saved visual baseline',
  async collect(ctx) {
    const selectors = (ctx.params.maskSelectors ?? []) as string[];
    window.scrollTo(0, 0);
    const masks: Rect[] = [];
    for (const sel of selectors) {
      let nodes: Element[];
      try {
        nodes = Array.from(document.querySelectorAll(sel));
      } catch {
        continue; // invalid user selector
      }
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const r = el.getBoundingClientRect();
        masks.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
    return {
      path: location.pathname,
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight,
      masks,
    };
  },
  analyze(d: VisualData, ctx: RunContext): Finding[] {
    const r = d.result;
    if (!r || r.state === 'same') return [];
    const base = { selector: `visual:${d.path}`, meta: { ratio: r.ratio } };
    if (r.state === 'no-baseline') {
      return [
        makeFinding('CHK-19', ctx, {
          ...base,
          rule: 'visual/no-baseline',
          severity: 'info',
          message: `No baseline is stored for ${d.path} at ${ctx.viewport}. Use "Save this run as baseline" in the report.`,
        }),
      ];
    }
    if (r.state === 'size-changed') {
      return [
        makeFinding('CHK-19', ctx, {
          ...base,
          rule: 'visual/size-changed',
          severity: 'warning',
          message: r.message ?? 'The screenshot size differs from the baseline.',
        }),
      ];
    }
    if (r.state === 'error') {
      return [
        makeFinding('CHK-19', ctx, {
          ...base,
          rule: 'visual/no-baseline',
          severity: 'info',
          title: 'Visual comparison failed',
          message: r.message ?? 'The comparison could not run.',
        }),
      ];
    }
    return [
      makeFinding('CHK-19', ctx, {
        ...base,
        rule: 'visual/diff',
        severity: 'warning',
        message: `${((r.ratio ?? 0) * 100).toFixed(2)}% of pixels changed compared with the saved baseline for ${d.path}`,
      }),
    ];
  },
};
