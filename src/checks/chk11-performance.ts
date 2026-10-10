import type { Check, Finding, Rect, RunContext, Severity } from '../shared/types';
import { rectOf, selectorFor, snippetOf } from '../engine/dom';
import { makeFinding } from './rules';

interface Data {
  ttfb: number | null;
  fcp: number | null;
  lcp: number | null;
  lcpEl: {
    selector: string;
    snippet: string;
    tag: string;
    loading: string | null;
    fetchpriority: string | null;
    url: string;
    rect?: Rect;
  } | null;
  cls: number;
  shiftSources: string[];
  transferBytes: number;
  requests: number;
  thirdPartyHosts: number;
  renderBlocking: string[];
  domNodes: number;
}

function grade(v: number, [warn, bad]: [number, number]): Severity | null {
  if (v > bad) return 'error';
  if (v > warn) return 'warning';
  return null;
}

export const chk11: Check<Data> = {
  id: 'CHK-11',
  title: 'Performance',
  category: 'performance',
  group: 'performance',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'first',
  passedLabel: 'Core Web Vitals within web.dev thresholds (indicative)',
  async collect() {
    const sqa = window.__sqa;
    const nav = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const hosts = new Set<string>();
    let bytes = nav?.transferSize ?? 0;
    for (const r of res) {
      bytes += r.transferSize || r.encodedBodySize || 0;
      try {
        const h = new URL(r.name).host;
        if (h !== location.host) hosts.add(h);
      } catch {
        // ignore malformed
      }
    }
    const lcp = sqa?.perf.lcp;
    let lcpEl: Data['lcpEl'] = null;
    const el = lcp?.el;
    if (el && el.isConnected) {
      lcpEl = {
        selector: selectorFor(el),
        snippet: snippetOf(el),
        tag: el.tagName.toLowerCase(),
        loading: el.getAttribute('loading'),
        fetchpriority: el.getAttribute('fetchpriority'),
        url: lcp?.url ?? '',
        rect: rectOf(el),
      };
    }
    const blocking = Array.from(
      document.head.querySelectorAll<HTMLScriptElement>(
        'script[src]:not([async]):not([defer]):not([type="module"])',
      ),
    ).map((s) => s.getAttribute('src') ?? '');
    const sources = new Map<string, number>();
    for (const s of sqa?.perf.shifts ?? [])
      for (const n of s.sources) sources.set(n, (sources.get(n) ?? 0) + s.value);
    return {
      ttfb: nav ? nav.responseStart - nav.startTime : null,
      fcp: sqa?.perf.fcp ?? null,
      lcp: lcp?.time ?? null,
      lcpEl,
      cls: sqa?.perf.cls ?? 0,
      shiftSources: [...sources.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([n]) => n),
      transferBytes: bytes,
      requests: res.length + 1,
      thirdPartyHosts: hosts.size,
      renderBlocking: blocking,
      domNodes: document.getElementsByTagName('*').length,
    };
  },
  analyze(d: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    const th = ctx.options.thresholds;
    const note = ' (indicative: measured in your browser)';
    const metric = (
      rule: string,
      label: string,
      v: number | null,
      t: [number, number],
      unit: string,
      fmt: (n: number) => string,
    ) => {
      if (v === null) return;
      const sev = grade(v, t);
      if (sev) {
        out.push(
          makeFinding('CHK-11', ctx, {
            rule,
            severity: sev,
            message: `${label} is ${fmt(v)}${unit}; threshold ${fmt(t[0])}${unit} / ${fmt(t[1])}${unit}${note}`,
            selector: rule === 'performance/lcp' ? d.lcpEl?.selector : undefined,
            meta: { value: v },
          }),
        );
      }
    };
    metric('performance/lcp', 'LCP', d.lcp, th.lcp, ' ms', (n) => String(Math.round(n)));
    metric('performance/cls', 'CLS', d.cls, th.cls, '', (n) => n.toFixed(3));
    metric('performance/ttfb', 'TTFB', d.ttfb, th.ttfb, ' ms', (n) => String(Math.round(n)));
    metric('performance/fcp', 'FCP', d.fcp, th.fcp, ' ms', (n) => String(Math.round(n)));
    if (d.cls > th.cls[0] && d.shiftSources.length) {
      out.push(
        makeFinding('CHK-11', ctx, {
          rule: 'performance/cls',
          severity: 'info',
          title: 'Top shifting elements',
          message: `Layout shifts came from: ${d.shiftSources.join(', ')}`,
          selector: 'cls:sources',
        }),
      );
    }
    if (d.lcpEl && d.lcpEl.loading === 'lazy') {
      out.push(
        makeFinding('CHK-11', ctx, {
          rule: 'performance/lcp-lazy',
          severity: 'warning',
          message: 'The LCP element has loading="lazy"; above-the-fold images should load eagerly',
          selector: d.lcpEl.selector,
          htmlSnippet: d.lcpEl.snippet,
          rect: d.lcpEl.rect,
        }),
      );
    } else if (d.lcpEl && d.lcpEl.tag === 'img' && d.lcpEl.fetchpriority !== 'high') {
      out.push(
        makeFinding('CHK-11', ctx, {
          rule: 'performance/lcp-priority',
          severity: 'info',
          message: 'The LCP image has no fetchpriority="high"',
          selector: d.lcpEl.selector,
          htmlSnippet: d.lcpEl.snippet,
        }),
      );
    }
    if (d.renderBlocking.length) {
      out.push(
        makeFinding('CHK-11', ctx, {
          rule: 'performance/render-blocking',
          severity: 'info',
          message: `${d.renderBlocking.length} render-blocking script(s) in <head>: ${d.renderBlocking.slice(0, 3).join(', ')}`,
          selector: 'head script[src]',
        }),
      );
    }
    if (d.domNodes > 1500) {
      out.push(
        makeFinding('CHK-11', ctx, {
          rule: 'performance/dom-size',
          severity: 'warning',
          message: `Page has ${d.domNodes} DOM nodes (over 1500)`,
          selector: 'html',
        }),
      );
    }
    out.push(
      makeFinding('CHK-11', ctx, {
        rule: 'performance/transfer-size',
        severity: 'info',
        message: `${d.requests} requests, ${(d.transferBytes / 1024).toFixed(0)} KB transferred, ${d.thirdPartyHosts} third-party hosts, ${d.domNodes} DOM nodes${note}`,
        selector: 'page:summary',
        meta: { ...d },
      }),
    );
    return out;
  },
};
