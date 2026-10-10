import type { Check, Finding, RunContext } from '../shared/types';
import { makeFinding } from './rules';

type Data = { failed: { family: string; weight: string; style: string }[] };

export const chk07: Check<Data> = {
  id: 'CHK-07',
  title: 'Fonts',
  category: 'content',
  group: 'content',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'first',
  passedLabel: 'All web fonts loaded',
  async collect() {
    const failed: Data['failed'] = [];
    try {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]);
      document.fonts.forEach((f) => {
        if (f.status === 'error') {
          failed.push({
            family: f.family.replace(/^["']|["']$/g, ''),
            weight: f.weight,
            style: f.style,
          });
        }
      });
    } catch {
      // document.fonts unavailable: nothing to report
    }
    return { failed };
  },
  analyze(data: Data, ctx: RunContext): Finding[] {
    return data.failed.map((f) =>
      makeFinding('CHK-07', ctx, {
        rule: 'content/font-failed',
        severity: 'warning',
        message: `Font "${f.family}" (${f.weight} ${f.style}) failed to load`,
        selector: `@font-face ${f.family}`,
      }),
    );
  },
};
