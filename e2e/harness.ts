import type { BrowserContext, Page } from '@playwright/test';
import type { RunRecord } from '../src/shared/types';

// @ts-expect-error plain ESM module without types
import { startFixtures as _start } from '../fixtures/server.mjs';

export interface HitRecord {
  site: string;
  method: string;
  path: string;
  search: string;
  body: string;
}
export interface Fixtures {
  clean: string;
  broken: string;
  locked: string;
  hits: HitRecord[];
  reset(): void;
  cart(site: string): { item_count: number; items: { key: string; quantity: number }[] };
  close(): Promise<void>;
}
export const startFixtures = _start as () => Promise<Fixtures>;

export { launch, EXT_PATH } from './launch';

export interface RunParams {
  mode?: 'quick' | 'pages' | 'full' | 'live';
  url: string;
  pages?: string[];
  viewports?: string[];
  opts?: Record<string, unknown>;
  groups?: Record<string, boolean>;
  liveTab?: number;
}

// Timing thresholds depend on the machine; the clean-fixture assertions must not.
const RELAXED = {
  thresholds: { lcp: [9000, 12000], cls: [0.1, 0.25], ttfb: [5000, 8000], fcp: [9000, 12000] },
};

export async function startRun(
  context: BrowserContext,
  extId: string,
  p: RunParams,
): Promise<Page> {
  const page = await context.newPage();
  if (process.env.SQA_DEBUG) {
    page.on('console', (m) => console.log('[report console]', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('[report pageerror]', e.message));
  }
  const q = new URLSearchParams({ auto: '1', mode: p.mode ?? 'quick', url: p.url });
  if (p.pages) q.set('pages', JSON.stringify(p.pages));
  if (p.viewports) q.set('viewports', p.viewports.join(','));
  q.set('opts', JSON.stringify({ ...RELAXED, ...(p.opts ?? {}) }));
  if (p.groups) q.set('groups', JSON.stringify(p.groups));
  if (p.liveTab !== undefined) q.set('liveTab', String(p.liveTab));
  if (process.env.SQA_TRACE) q.set('trace', '1');
  await page.goto(`chrome-extension://${extId}/report.html?${q}`);
  return page;
}

export async function waitDone(page: Page): Promise<RunRecord> {
  await page.waitForFunction(
    () => (window as unknown as { __sqaE2E?: { done: boolean } }).__sqaE2E?.done === true,
    null,
    { timeout: Number(process.env.SQA_WAIT ?? 400_000) },
  );
  return (await page.evaluate(
    () => (window as unknown as { __sqaE2E: { run: unknown } }).__sqaE2E.run,
  )) as RunRecord;
}

export async function runCheck(
  context: BrowserContext,
  extId: string,
  p: RunParams,
): Promise<{ run: RunRecord; page: Page }> {
  const page = await startRun(context, extId, p);
  return { run: await waitDone(page), page };
}

export function summary(
  run: RunRecord,
  pred: (f: RunRecord['findings'][number]) => boolean = () => true,
) {
  return run.findings.filter(pred).map((f) => `${f.severity}:${f.rule}:${f.viewport}`);
}
