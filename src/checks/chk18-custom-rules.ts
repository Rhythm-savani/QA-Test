import type { Check, Finding, RunContext } from '../shared/types';
import { isVisible, selectorFor } from '../engine/dom';
import { compileExtra, denyReason } from '../engine/safety';
import type { CustomRule } from '../shared/options';
import { makeFinding } from './rules';

interface Outcome {
  name: string;
  matched: boolean;
  triggerFound: boolean;
  denied?: string;
  opened?: boolean;
  closeFound?: boolean;
  closed?: boolean;
}
type Data = { outcomes: Outcome[] };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, t = 1500) {
  const t0 = performance.now();
  while (performance.now() - t0 < t) {
    if (fn()) return true;
    await wait(50);
  }
  return fn();
}
const vis = (sel: string) => {
  try {
    return Array.from(document.querySelectorAll(sel)).some((e) => isVisible(e));
  } catch {
    return false;
  }
};

export const chk18: Check<Data> = {
  id: 'CHK-18',
  title: 'Custom rules',
  category: 'interaction',
  group: 'custom',
  mutatesState: false,
  defaultEnabled: false,
  viewportScope: 'first',
  passedLabel: 'Custom rules passed',
  async collect(ctx) {
    const rules = (ctx.params.customRules ?? []) as CustomRule[];
    const extra = compileExtra(ctx.options.denylistExtra);
    const outcomes: Outcome[] = [];
    for (const r of rules) {
      const o: Outcome = { name: r.name, matched: false, triggerFound: false };
      outcomes.push(o);
      try {
        o.matched = new RegExp(r.urlPattern).test(location.pathname + location.search);
      } catch {
        o.matched = false;
      }
      if (!o.matched) continue;
      const trig = Array.from(document.querySelectorAll<HTMLElement>(r.trigger)).find((e) =>
        isVisible(e),
      );
      if (!trig) continue;
      o.triggerFound = true;
      const denied = denyReason(trig, extra);
      if (denied) {
        o.denied = denied;
        continue;
      }
      trig.scrollIntoView({ block: 'center' });
      trig.click();
      o.opened = await until(() => vis(r.expectVisible));
      if (o.opened && r.close) {
        const c = Array.from(document.querySelectorAll<HTMLElement>(r.close)).find((e) =>
          isVisible(e),
        );
        o.closeFound = !!c;
        if (c && !denyReason(c, extra)) {
          c.click();
          const hideSel = r.closeExpectHidden || r.expectVisible;
          o.closed = await until(() => !vis(hideSel));
        }
      }
      // leave the page as found
      if (vis(r.expectVisible)) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await wait(300);
        if (vis(r.expectVisible) && trig.isConnected) trig.click();
        await wait(300);
      }
    }
    void selectorFor;
    return { outcomes };
  },
  analyze(d: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    for (const o of d.outcomes) {
      if (!o.matched) continue;
      const mk = (severity: 'error' | 'warning', message: string) =>
        out.push(
          makeFinding('CHK-18', ctx, {
            rule: 'custom/rule-failed',
            severity,
            title: `Custom rule "${o.name}" failed`,
            message,
            selector: `custom-rule:${o.name}`,
          }),
        );
      if (!o.triggerFound)
        mk('warning', `Rule "${o.name}": trigger not found or not visible on this page`);
      else if (o.denied)
        mk('warning', `Rule "${o.name}": trigger refused by the click denylist (${o.denied})`);
      else if (!o.opened)
        mk(
          'error',
          `Rule "${o.name}": clicking the trigger did not make the expected element visible`,
        );
      else if (o.closeFound === false)
        mk('error', `Rule "${o.name}": close control not found or not visible`);
      else if (o.closed === false)
        mk('error', `Rule "${o.name}": close control did not hide the element`);
    }
    return out;
  },
};
