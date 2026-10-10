import type { Check, Finding, RunContext } from '../shared/types';
import { runInteractions, type IxRun, type RawIx } from '../engine/interactions';
import { makeFinding } from './rules';

export type IxData = IxRun;

export function rawToFinding(checkId: string, raw: RawIx, ctx: RunContext): Finding {
  return makeFinding(checkId, ctx, {
    rule: raw.rule,
    severity: raw.severity,
    message: raw.message,
    selector: raw.selector,
    htmlSnippet: raw.htmlSnippet,
    rect: raw.rect,
    meta: { ...raw.meta, shotKey: raw.shotKey },
  });
}

/** Provided by the page API (inject/page.ts): trusted input + screenshots over the CDP binding. */
type IoFactory = () => import('../engine/interactions').IO;

export const chk09: Check<IxData> = {
  id: 'CHK-09',
  title: 'Interactions',
  category: 'interaction',
  group: 'interactions',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'each',
  passedLabel: 'Drawers, modals, tabs and carousels open and close correctly',
  async collect(ctx) {
    const makeIO = (window.__sqa as unknown as { makeIO?: IoFactory } | undefined)?.makeIO;
    if (!makeIO) throw new Error('page API not installed');
    const budget = Number(ctx.params.budgetMs ?? 60000);
    return runInteractions(
      {
        startIndex: Number(ctx.params.startIndex ?? 0),
        max: ctx.options.maxInteractions,
        skipSelectors: ctx.options.skipSelectors,
        denylistExtra: ctx.options.denylistExtra,
        deadline: performance.now() + budget,
      },
      makeIO(),
    );
  },
  analyze(d: IxData, ctx: RunContext): Finding[] {
    const out = d.findings.map((r) => rawToFinding('CHK-09', r, ctx));
    if (d.capped && d.total > 0) {
      out.push(
        makeFinding('CHK-09', ctx, {
          rule: 'interaction/trigger-no-effect',
          severity: 'info',
          title: 'Interaction testing capped',
          message: `Tested ${d.tested} of ${d.total} candidate controls (cap or time budget reached).`,
          selector: 'interactions:cap',
        }),
      );
    }
    return out;
  },
};
