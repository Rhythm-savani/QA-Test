import type { Check, Finding, NetFailure, RunContext } from '../shared/types';
import { compileRegexes, matchesAny, truncate } from '../shared/util';
import { makeFinding } from './rules';
import type { SqaEvent } from '../inject/instrument';

interface ResEntry {
  url: string;
  status: number;
  type: string;
}
type Data = { events: SqaEvent[]; resources: ResEntry[]; docStatus?: number };

const SHOPIFY_CDN =
  /(^|\.)(cdn\.shopify\.com|shopifycdn\.com|shopify\.com|shopifysvc\.com|myshopify\.com)$/i;

export const chk02: Check<Data> = {
  id: 'CHK-02',
  title: 'Network failures',
  category: 'health',
  group: 'health',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'each',
  passedLabel: 'No failed requests',
  async collect() {
    const events = (window.__sqa?.events ?? []).filter((e) =>
      ['resource-error', 'fetch-fail', 'xhr-fail'].includes(e.kind),
    );
    const resources: ResEntry[] = [];
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      const status =
        (e as PerformanceResourceTiming & { responseStatus?: number }).responseStatus ?? 0;
      if (status >= 400) resources.push({ url: e.name, status, type: e.initiatorType });
    }
    const nav = performance.getEntriesByType('navigation')[0] as
      (PerformanceNavigationTiming & { responseStatus?: number }) | undefined;
    return { events, resources, docStatus: nav?.responseStatus };
  },
  analyze(data: Data, ctx: RunContext): Finding[] {
    const ignore = compileRegexes(ctx.options.ignoreNetwork);
    const seen = new Map<string, NetFailure & { count: number }>();
    const add = (f: NetFailure) => {
      if (!f.url || f.url.startsWith('data:') || f.url.startsWith('blob:')) return;
      if (/\/favicon\.ico(\?|$)/.test(f.url) && f.type === 'Other') return;
      if (matchesAny(f.url, ignore)) return;
      // The audited document itself: only meaningful when it is not the expected response.
      const key = `${f.url}|${f.status ?? ''}|${f.errorText ?? ''}`;
      const prev = seen.get(key);
      if (prev) prev.count++;
      else seen.set(key, { ...f, count: 1 });
    };
    for (const e of data.events) {
      add({
        url: e.url ?? '',
        status: e.status,
        initiator: e.tag ?? e.kind,
        errorText: e.status === 0 ? e.message : undefined,
      });
    }
    for (const r of data.resources) add({ url: r.url, status: r.status, initiator: r.type });
    for (const f of ctx.cdpNetwork ?? []) add(f);
    // resource-error events carry no status; drop them when a status-bearing entry exists for the URL.
    for (const [k, v] of [...seen]) {
      if (v.status === undefined) {
        const hasStatus = [...seen.values()].some((o) => o.url === v.url && o.status !== undefined);
        if (hasStatus) seen.delete(k);
      }
    }
    const out: Finding[] = [];
    for (const f of seen.values()) {
      let host = '';
      try {
        host = new URL(f.url).host;
      } catch {
        // relative or malformed: treated as same-origin below
      }
      const sameOrigin = !host || f.url.startsWith(ctx.origin);
      const blocked = /ERR_BLOCKED_BY_CLIENT/.test(f.errorText ?? '');
      const severity = blocked
        ? 'info'
        : sameOrigin || SHOPIFY_CDN.test(host)
          ? 'error'
          : 'warning';
      const what = f.status ? `HTTP ${f.status}` : f.errorText || 'request failed';
      out.push(
        makeFinding('CHK-02', ctx, {
          rule: 'health/network-failure',
          severity,
          message: `${what} for ${truncate(f.url, 220)}${f.initiator ? ` (${f.initiator})` : ''}`,
          meta: {
            url: f.url,
            status: f.status,
            initiator: f.initiator,
            count: f.count > 1 ? f.count : undefined,
          },
        }),
      );
    }
    return out;
  },
};
