import { test, expect } from '@playwright/test';
import { launch, runCheck, startFixtures, type Fixtures } from './harness';

let fx: Fixtures;
test.beforeAll(async () => {
  fx = await startFixtures();
});
test.afterAll(async () => {
  await fx.close();
});

test('clean quick run (desktop only) produces a run', async () => {
  const { context, extId } = await launch();
  try {
    const { run } = await runCheck(context, extId, { url: fx.clean + '/', viewports: ['desktop'] });
    console.log(
      JSON.stringify({ status: run.status, notes: run.notes, skipped: run.skipped }, null, 1),
    );
    console.log(
      run.findings
        .map((f) => `${f.severity} ${f.rule} ${f.viewport} ${f.message.slice(0, 160)}`)
        .join('\n'),
    );
    console.log(
      JSON.stringify(
        run.completed.map((c) =>
          c.results.map(
            (r) => `${r.checkId}:${r.status}${r.errorMessage ? ':' + r.errorMessage : ''}`,
          ),
        ),
      ),
    );
    expect(run.status).toBe('finished');
  } finally {
    await context.close();
  }
});
