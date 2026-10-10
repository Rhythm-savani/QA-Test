// MAIN-world hooks. Installed at navigation commit, before any page script runs (RUN-4).
// Everything is buffered on window.__sqa and read back by the collectors.

export type EventKind =
  | 'exception'
  | 'rejection'
  | 'console-error'
  | 'console-warn'
  | 'csp'
  | 'resource-error'
  | 'fetch-fail'
  | 'xhr-fail';

export interface SqaEvent {
  kind: EventKind;
  message: string;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
  url?: string;
  status?: number;
  tag?: string;
  t: number;
}

export interface Sqa {
  events: SqaEvent[];
  perf: {
    lcp?: PerfLcp;
    cls: number;
    shifts: { value: number; sources: string[] }[];
    fcp?: number;
  };
  installedAt: number;
  [k: string]: unknown;
}

export interface PerfLcp {
  time: number;
  url: string;
  size: number;
  el?: Element | null;
}

declare global {
  interface Window {
    __sqa?: Sqa;
  }
}

const MAX_EVENTS = 500;

export function installInstrumentation(): Sqa {
  if (window.__sqa) return window.__sqa;
  const sqa: Sqa = {
    events: [],
    perf: { cls: 0, shifts: [] },
    installedAt: performance.now(),
  };
  window.__sqa = sqa;
  const push = (e: Omit<SqaEvent, 't'>) => {
    if (sqa.events.length < MAX_EVENTS) sqa.events.push({ ...e, t: performance.now() });
  };
  const fmt = (a: unknown): string => {
    if (a instanceof Error) return a.stack?.split('\n')[0] ?? a.message;
    if (typeof a === 'string') return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  };

  window.addEventListener(
    'error',
    (ev: Event) => {
      const t = ev.target as Element | null;
      if (t && t !== (window as unknown as Element) && (t as Element).tagName) {
        const el = t as HTMLElement & { src?: string; href?: string; currentSrc?: string };
        const tag = el.tagName.toLowerCase();
        if (['img', 'script', 'link', 'video', 'audio', 'source', 'iframe'].includes(tag)) {
          push({
            kind: 'resource-error',
            message: `Failed to load <${tag}>`,
            url: el.currentSrc || el.src || el.href || '',
            tag,
          });
        }
        return;
      }
      const e = ev as ErrorEvent;
      push({
        kind: 'exception',
        message: e.message || fmt(e.error),
        source: e.filename,
        line: e.lineno,
        col: e.colno,
        stack: e.error instanceof Error ? e.error.stack : undefined,
      });
    },
    true,
  );

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    push({
      kind: 'rejection',
      message: fmt(r),
      stack: r instanceof Error ? r.stack : undefined,
    });
  });

  document.addEventListener('securitypolicyviolation', (e) => {
    push({
      kind: 'csp',
      message: `Blocked ${e.violatedDirective}: ${e.blockedURI}`,
      source: e.sourceFile,
      line: e.lineNumber,
      url: e.blockedURI,
    });
  });

  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      let stack: string | undefined;
      try {
        stack = new Error().stack?.split('\n').slice(2, 4).join('\n');
      } catch {
        stack = undefined;
      }
      push({
        kind: level === 'error' ? 'console-error' : 'console-warn',
        message: args.map(fmt).join(' '),
        stack,
      });
      orig(...args);
    };
  }

  // fetch/XHR wrappers: record failing page requests, keep behaviour untouched.
  const origFetch = window.fetch;
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    const input = args[0];
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return origFetch.apply(this, args).then(
      (res) => {
        if (res.status >= 400)
          push({ kind: 'fetch-fail', message: 'fetch failed', url, status: res.status });
        return res;
      },
      (err) => {
        push({ kind: 'fetch-fail', message: 'fetch failed: ' + fmt(err), url, status: 0 });
        throw err;
      },
    );
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
  ) {
    const u = String(url);
    this.addEventListener('loadend', () => {
      if (this.status >= 400 || this.status === 0) {
        push({ kind: 'xhr-fail', message: 'XHR failed', url: u, status: this.status });
      }
    });
    // eslint-disable-next-line prefer-rest-params
    return xhrOpen.apply(this, arguments as unknown as Parameters<typeof xhrOpen>);
  };

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const x = e as PerformanceEntry & {
          element?: Element | null;
          url?: string;
          size?: number;
          renderTime?: number;
          loadTime?: number;
        };
        sqa.perf.lcp = {
          time: x.renderTime || x.loadTime || e.startTime,
          url: x.url ?? '',
          size: x.size ?? 0,
          el: x.element,
        };
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // unsupported entry type
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const x = e as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: { node?: Node | null }[];
        };
        if (x.hadRecentInput) continue;
        sqa.perf.cls += x.value;
        const names = (x.sources ?? [])
          .map((s) =>
            s.node && s.node.nodeType === 1 ? (s.node as Element).tagName.toLowerCase() : '',
          )
          .filter(Boolean);
        sqa.perf.shifts.push({ value: x.value, sources: names });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    // unsupported entry type
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (e.name === 'first-contentful-paint') sqa.perf.fcp = e.startTime;
    }).observe({ type: 'paint', buffered: true });
  } catch {
    // unsupported entry type
  }
  return sqa;
}
