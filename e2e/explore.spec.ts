import { test } from '@playwright/test';
import { launch, runCheck, startFixtures, type Fixtures } from './harness';

let fx: Fixtures;
test.beforeAll(async () => {
  fx = await startFixtures();
});
test.afterAll(async () => {
  await fx.close();
});

const target = process.env.EXPLORE_URL ?? 'broken:/';
const mode = (process.env.EXPLORE_MODE ?? 'quick') as 'quick' | 'full';

test('explore', async () => {
  const [site, path] = target.split(':');
  const { context, extId } = await launch();
  try {
    const { run } = await runCheck(context, extId, {
      url: (fx as unknown as Record<string, string>)[site] + path,
      mode,
      viewports: process.env.EXPLORE_VPS ? process.env.EXPLORE_VPS.split(',') : undefined,
      opts: {
        thresholds: {
          lcp: [9000, 12000],
          cls: [0.1, 0.25],
          ttfb: [5000, 8000],
          fcp: [9000, 12000],
        },
      },
    });
    console.log(run.status, run.notes, JSON.stringify(run.skipped));
    for (const f of run.findings) {
      console.log(
        `${f.severity.padEnd(7)} ${f.viewport.padEnd(8)} ${f.rule.padEnd(40)} ${f.screenshotId ? 'IMG ' : '    '}${f.message.slice(0, 110)}`,
      );
    }
    for (const c of run.completed) {
      console.log(
        c.viewport,
        c.url.slice(-30),
        c.results
          .map(
            (r) =>
              `${r.checkId}:${r.status}${r.note ? '[' + r.note + ']' : ''}${r.errorMessage ? '!' + r.errorMessage : ''}${r.skippedReason ? '~' + r.skippedReason : ''}`,
          )
          .join(' '),
      );
    }
    const perf = run.findings.find((f) => f.rule === 'performance/transfer-size');
    console.log(
      'perf',
      JSON.stringify((perf?.meta as Record<string, unknown>)?.lcpEl),
      (perf?.meta as Record<string, unknown>)?.lcp,
    );
    console.log(
      'hits',
      JSON.stringify(
        fx.hits
          .filter((h) => /checkout|logout|contact|cart\//.test(h.path))
          .map((h) => `${h.method} ${h.path}`),
      ),
    );
  } finally {
    await context.close();
  }
});
