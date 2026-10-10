import type { Check, Finding, RunContext } from '../shared/types';
import { compileRegexes, matchesAny, truncate } from '../shared/util';
import { makeFinding } from './rules';
import type { SqaEvent } from '../inject/instrument';

type Data = { events: SqaEvent[] };
const KINDS = new Set(['exception', 'rejection', 'console-error', 'console-warn', 'csp']);

export const chk01: Check<Data> = {
  id: 'CHK-01',
  title: 'Runtime errors',
  category: 'health',
  group: 'health',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'each',
  passedLabel: 'No JavaScript errors, rejections or CSP violations',
  async collect() {
    return { events: (window.__sqa?.events ?? []).filter((e) => KINDS.has(e.kind)) };
  },
  analyze(data: Data, ctx: RunContext): Finding[] {
    const ignore = compileRegexes(ctx.options.ignoreConsole);
    const out = new Map<string, Finding & { count: number }>();
    for (const e of data.events) {
      if (matchesAny(e.message, ignore)) continue;
      if (e.kind === 'console-warn' && !ctx.options.showConsoleWarn) continue;
      const rule =
        e.kind === 'exception'
          ? 'health/uncaught-exception'
          : e.kind === 'rejection'
            ? 'health/unhandled-rejection'
            : e.kind === 'csp'
              ? 'health/csp-violation'
              : e.kind === 'console-warn'
                ? 'health/console-warn'
                : 'health/console-error';
      const where = e.source
        ? ` (${e.source.split('/').slice(-2).join('/')}${e.line ? ':' + e.line : ''})`
        : '';
      const f = makeFinding('CHK-01', ctx, {
        rule,
        severity: e.kind === 'console-warn' ? 'info' : 'error',
        message: truncate(e.message, 300) + where,
        meta: {
          source: e.source,
          line: e.line,
          col: e.col,
          topFrame: e.stack?.split('\n')[1]?.trim(),
        },
      });
      const prev = out.get(f.id);
      if (prev) prev.count++;
      else out.set(f.id, { ...f, count: 1 });
    }
    return [...out.values()].map(({ count, ...f }) =>
      count > 1 ? { ...f, meta: { ...f.meta, count } } : f,
    );
  },
};
