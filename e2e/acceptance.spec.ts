import { expect, test, type BrowserContext } from '@playwright/test';
import type { RunRecord } from '../src/shared/types';
import { launch, runCheck, startFixtures, startRun, waitDone, type Fixtures } from './harness';

test.describe.configure({ mode: 'serial' });

let fx: Fixtures;
let context: BrowserContext;
let extId: string;

test.beforeAll(async () => {
  fx = await startFixtures();
  ({ context, extId } = await launch());
});
test.afterAll(async () => {
  await context?.close();
  await fx?.close();
});

const find = (run: RunRecord, rule: string, o: { severity?: string; viewport?: string } = {}) =>
  run.findings.filter(
    (f) =>
      f.rule === rule &&
      (!o.severity || f.severity === o.severity) &&
      (!o.viewport || f.viewport === o.viewport),
  );
const has = (run: RunRecord, rule: string, o: { severity?: string; viewport?: string } = {}) =>
  find(run, rule, o).length > 0;
const hitsTo = (site: string, pred: (h: Fixtures['hits'][number]) => boolean) =>
  fx.hits.filter((h) => h.site === site && pred(h));
const noProtectedHits = (site: string) => {
  expect(
    hitsTo(site, (h) => h.path === '/checkout' || h.path.startsWith('/checkouts')),
  ).toHaveLength(0);
  expect(hitsTo(site, (h) => h.path === '/account/logout')).toHaveLength(0);
  // click sentinels: the page reports every click on a protected control through /__log
  expect(
    hitsTo(site, (h) => h.path === '/__log' && /clicked=(logout|checkout)/.test(h.search)),
  ).toHaveLength(0);
};
const mutations = (site: string) =>
  hitsTo(
    site,
    (h) => h.method === 'POST' && ['/contact', '/cart/add.js', '/cart/change.js'].includes(h.path),
  );

test.describe('clean fixture', () => {
  let run: RunRecord;
  test('quick run covers all three viewports by default and finds nothing', async () => {
    fx.reset();
    // a user tab that must never be touched
    const user = await context.newPage();
    await user.goto(fx.clean + '/collections/all');
    await user.evaluate(() => {
      (window as unknown as Record<string, unknown>).__mark = 'untouched';
    });
    const size = await user.evaluate(() => [window.innerWidth, window.innerHeight]);

    ({ run } = await runCheck(context, extId, { url: fx.clean + '/' }));

    expect(run.status).toBe('finished');
    expect([...new Set(run.completed.map((c) => c.viewport))].sort()).toEqual([
      'desktop',
      'mobile',
      'tablet',
    ]);
    const bad = run.findings.filter((f) => f.severity !== 'info');
    expect(bad.map((f) => `${f.severity} ${f.rule} ${f.viewport} ${f.message}`)).toEqual([]);
    // the user's own tab: same document, same size
    expect(await user.evaluate(() => (window as unknown as Record<string, unknown>).__mark)).toBe(
      'untouched',
    );
    expect(await user.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual(size);
    expect(user.url()).toBe(fx.clean + '/collections/all');
    await user.close();
    noProtectedHits('clean');
    expect(mutations('clean')).toHaveLength(0);
    // with the opt-ins off nothing was POSTed anywhere
    expect(hitsTo('clean', (h) => h.method === 'POST')).toHaveLength(0);
    // interactions really ran on every viewport
    for (const pv of run.completed) {
      const ix = pv.results.find((r) => r.checkId === 'CHK-09');
      expect(ix?.status, pv.viewport).toBe('passed');
      expect(ix?.note, pv.viewport).toMatch(/Exercised [1-9]/);
    }
  });

  test('narrowing to one viewport works', async () => {
    const r = (await runCheck(context, extId, { url: fx.clean + '/', viewports: ['mobile'] })).run;
    expect([...new Set(r.completed.map((c) => c.viewport))]).toEqual(['mobile']);
  });

  test('product page: variants, cart badge and search are verified and consistent', async () => {
    const r = (
      await runCheck(context, extId, {
        url: fx.clean + '/products/aurora-ring',
        viewports: ['desktop'],
      })
    ).run;
    expect(r.findings.filter((f) => f.severity !== 'info')).toEqual([]);
    const res = r.completed[0].results;
    expect(res.find((x) => x.checkId === 'CHK-13')?.status).toBe('passed');
    expect(res.find((x) => x.checkId === 'CHK-14')?.status).toBe('passed');
    expect(res.find((x) => x.checkId === 'CHK-15')?.status).toBe('passed');
    // read-only: variant testing must not have mutated the cart
    expect(mutations('clean')).toHaveLength(0);
  });
});

test.describe('broken fixture: home page', () => {
  let run: RunRecord;
  test.beforeAll(async () => {
    fx.reset();
    ({ run } = await runCheck(context, extId, { url: fx.broken + '/' }));
  });

  test('console, network and media defects (rows 1-6, 27)', async () => {
    expect(has(run, 'health/uncaught-exception', { severity: 'error' })).toBe(true);
    expect(has(run, 'health/console-error', { severity: 'error' })).toBe(true);
    expect(has(run, 'health/unhandled-rejection', { severity: 'error' })).toBe(true);
    expect(has(run, 'media/broken-image', { severity: 'error' })).toBe(true);
    expect(
      run.findings.some(
        (f) => f.rule === 'health/network-failure' && /missing-hero\.jpg/.test(f.message),
      ),
    ).toBe(true);
    expect(has(run, 'media/missing-alt', { severity: 'warning' })).toBe(true);
    expect(has(run, 'media/stretched-image', { severity: 'warning' })).toBe(true);
    expect(has(run, 'content/font-failed', { severity: 'warning' })).toBe(true);
  });

  test('content and link defects (rows 7-10)', async () => {
    expect(has(run, 'content/liquid-error', { severity: 'error' })).toBe(true);
    expect(has(run, 'content/translation-missing', { severity: 'error' })).toBe(true);
    const empty = find(run, 'content/empty-section', { severity: 'warning' });
    expect(
      empty.some(
        (f) => /empty/.test(f.message) && (f.selector ?? '').includes('template--1__empty'),
      ),
    ).toBe(true);
    expect(has(run, 'links/broken-internal', { severity: 'error' })).toBe(true);
    expect(has(run, 'links/dead-anchor', { severity: 'warning' })).toBe(true);
  });

  test('layout defects: overflow is mobile-only, covered and tiny controls (rows 11, 12, 25)', async () => {
    expect(has(run, 'layout/horizontal-overflow', { severity: 'error', viewport: 'mobile' })).toBe(
      true,
    );
    expect(has(run, 'layout/horizontal-overflow', { viewport: 'desktop' })).toBe(false);
    expect(has(run, 'layout/obscured-interactive', { severity: 'error' })).toBe(true);
    expect(has(run, 'layout/tap-target-small', { severity: 'warning', viewport: 'mobile' })).toBe(
      true,
    );
    expect(has(run, 'layout/tap-target-small', { viewport: 'desktop' })).toBe(false);
  });

  test('interaction defects (rows 13-18)', async () => {
    expect(has(run, 'interaction/close-obscured', { severity: 'error' })).toBe(true);
    expect(has(run, 'interaction/close-no-effect', { severity: 'error' })).toBe(true);
    expect(has(run, 'interaction/scroll-lock-stuck', { severity: 'error' })).toBe(true);
    expect(has(run, 'interaction/escape-not-closing', { severity: 'warning' })).toBe(true);
    expect(has(run, 'interaction/trigger-no-effect', { severity: 'warning' })).toBe(true);
    expect(has(run, 'interaction/carousel-no-effect', { severity: 'warning' })).toBe(true);
    // INT-6: the seeded "Sale" menu never opens on hover (desktop only)
    expect(
      has(run, 'interaction/hover-menu-no-effect', { severity: 'warning', viewport: 'desktop' }),
    ).toBe(true);
    expect(has(run, 'interaction/hover-menu-no-effect', { viewport: 'mobile' })).toBe(false);
  });

  test('accessibility, performance, cart badge (rows 19, 20, 23)', async () => {
    const contrast = find(run, 'a11y/axe:color-contrast');
    expect(contrast.length).toBeGreaterThan(0);
    expect(contrast[0].severity).toBe('error'); // axe "serious"
    expect(find(run, 'a11y/axe:label').length).toBeGreaterThan(0);
    expect(has(run, 'performance/lcp-lazy', { severity: 'warning' })).toBe(true);
    expect(has(run, 'shopify/cart-badge-mismatch', { severity: 'error' })).toBe(true);
  });

  test('evidence: visible findings have screenshots, console and network findings do not', async () => {
    const withShot = (rule: string) => find(run, rule).some((f) => !!f.screenshotId);
    for (const rule of [
      'layout/horizontal-overflow',
      'layout/obscured-interactive',
      'media/broken-image',
      'media/missing-alt',
      'content/liquid-error',
      'content/empty-section',
      'interaction/close-no-effect',
      'interaction/scroll-lock-stuck',
    ]) {
      expect(withShot(rule), rule).toBe(true);
    }
    for (const rule of [
      'health/console-error',
      'health/uncaught-exception',
      'health/network-failure',
      'links/broken-internal',
      'performance/transfer-size',
    ]) {
      expect(
        find(run, rule).every((f) => !f.screenshotId),
        rule,
      ).toBe(true);
    }
    // a mobile-only problem is shown on mobile
    const overflow = find(run, 'layout/horizontal-overflow', { viewport: 'mobile' })[0];
    expect(overflow.screenshotId).toBeTruthy();
    const ids = new Set(run.screenshotIds);
    expect(run.findings.filter((f) => f.screenshotId).every((f) => ids.has(f.screenshotId!))).toBe(
      true,
    );
    expect(run.screenshotIds.length).toBeLessThanOrEqual(120);
  });

  test('safety sentinels: protected controls were never clicked or requested', async () => {
    noProtectedHits('broken');
    expect(mutations('broken')).toHaveLength(0);
    // a JS-driven navigation to checkout was blocked and recorded
    expect(has(run, 'safety/left-safe-zone')).toBe(true);
  });

  test('the run is persisted and findings are grouped by fingerprint', async () => {
    const ids = run.findings.map((f) => f.id);
    expect(new Set(ids).size).toBeLessThan(ids.length); // repeated across viewports
    const mobileOnly = find(run, 'media/missing-alt');
    expect(mobileOnly.length).toBeGreaterThanOrEqual(3);
    expect(new Set(mobileOnly.map((f) => f.id)).size).toBe(1);
  });
});

test.describe('broken fixture: product, about, notes', () => {
  test('variant price and availability mismatches (rows 21, 22)', async () => {
    fx.reset();
    const { run } = await runCheck(context, extId, {
      url: fx.broken + '/products/broken-ring',
      viewports: ['desktop'],
    });
    expect(has(run, 'shopify/variant-price-mismatch', { severity: 'error' })).toBe(true);
    expect(has(run, 'shopify/variant-availability-mismatch', { severity: 'error' })).toBe(true);
    expect(mutations('broken')).toHaveLength(0);
  });

  test('missing title and two h1 (row 24)', async () => {
    const { run } = await runCheck(context, extId, {
      url: fx.broken + '/pages/about',
      viewports: ['desktop'],
    });
    expect(has(run, 'seo/title-missing', { severity: 'warning' })).toBe(true);
    expect(has(run, 'seo/h1-count', { severity: 'warning' })).toBe(true);
    expect(has(run, 'interaction/tab-panel-mismatch')).toBe(false); // tabs on the page work
  });

  test('XSS payload in the page stays inert in the report and the HTML export (row 29)', async () => {
    const { run, page } = await runCheck(context, extId, {
      url: fx.broken + '/pages/notes',
      viewports: ['desktop'],
    });
    const payload = 'window.__pwned=1';
    // no finding is produced by the payload itself
    // the payload text is not a template leftover, a CSP violation or a runtime error
    const carrying = run.findings.filter((f) => JSON.stringify(f).includes(payload));
    expect(carrying.length).toBeGreaterThan(0);
    expect(carrying.some((f) => f.rule === 'media/missing-alt')).toBe(true);
    expect(carrying.some((f) => /^(content|health|links)\//.test(f.rule))).toBe(false);
    expect(run.findings.some((f) => JSON.stringify(f).includes(payload))).toBe(true);
    // open every finding group so all payload-bearing nodes are rendered
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__pwned),
    ).toBeUndefined();
    expect(await page.locator('body').innerText()).toContain(payload);
    expect(await page.locator('main img[onerror]').count()).toBe(0);
    await page.close();
  });
});

test.describe('custom rules (CHK-18)', () => {
  const rules = JSON.stringify([
    {
      name: 'Search modal',
      urlPattern: '^/$',
      trigger: 'summary.header__icon--search',
      expectVisible: '#search-modal',
      close: '#search-modal .modal__close-button',
      closeExpectHidden: '#search-modal',
    },
    {
      name: 'Size guide modal',
      urlPattern: '^/$',
      trigger: '[data-qa-modal-open="qa-modal-dead"]',
      expectVisible: '#qa-modal-dead',
      close: '#qa-modal-dead .modal__close-button',
      closeExpectHidden: '#qa-modal-dead',
    },
  ]);
  const only = {
    custom: true,
    interactions: false,
    accessibility: false,
    links: false,
    performance: false,
  };

  test('a working rule passes on the clean store', async () => {
    fx.reset();
    const { run } = await runCheck(context, extId, {
      url: fx.clean + '/',
      viewports: ['desktop'],
      groups: only,
      opts: { customRules: JSON.stringify(JSON.parse(rules).slice(0, 1)) },
    });
    const r = run.completed[0].results.find((x) => x.checkId === 'CHK-18');
    expect(r?.status).toBe('passed');
    expect(find(run, 'custom/rule-failed')).toHaveLength(0);
  });

  test('a rule whose close control does nothing is reported on the broken store', async () => {
    fx.reset();
    const { run } = await runCheck(context, extId, {
      url: fx.broken + '/',
      viewports: ['desktop'],
      groups: only,
      opts: { customRules: rules },
    });
    const failed = find(run, 'custom/rule-failed', { severity: 'error' });
    expect(failed.some((f) => /Size guide modal/.test(f.message))).toBe(true);
    expect(failed.some((f) => /Search modal/.test(f.message))).toBe(false);
    noProtectedHits('broken');
  });
});

test.describe('opt-in checks', () => {
  test('newsletter Level 1 finds form problems and never submits (row 26)', async () => {
    fx.reset();
    const { run } = await runCheck(context, extId, {
      url: fx.broken + '/',
      viewports: ['desktop'],
      groups: { newsletter: true, interactions: false, accessibility: false, links: false },
      opts: { newsletterLevel: 1 },
    });
    expect(has(run, 'newsletter/form-invalid', { severity: 'warning' })).toBe(true);
    expect(mutations('broken')).toHaveLength(0);
  });

  test('newsletter Level 2 reports a missing success state and names the test address', async () => {
    fx.reset();
    const { run } = await runCheck(context, extId, {
      url: fx.broken + '/',
      viewports: ['desktop'],
      groups: { newsletter: true, interactions: false, accessibility: false, links: false },
      opts: {
        newsletterLevel: 2,
        newsletterEmail: 'qa+fixture@example.test',
        confirmedNewsletterL2: true,
      },
    });
    expect(has(run, 'newsletter/no-success-state', { severity: 'error' })).toBe(true);
    expect(hitsTo('broken', (h) => h.method === 'POST' && h.path === '/contact')).toHaveLength(1);
    expect(run.sideEffects.join(' ')).toContain('qa+fixture@example.test');
  });

  test('newsletter Level 2 on the clean store sees the success state', async () => {
    fx.reset();
    const { run } = await runCheck(context, extId, {
      url: fx.clean + '/',
      viewports: ['desktop'],
      groups: { newsletter: true, interactions: false, accessibility: false, links: false },
      opts: {
        newsletterLevel: 2,
        newsletterEmail: 'qa+clean@example.test',
        confirmedNewsletterL2: true,
      },
    });
    expect(run.findings.filter((f) => f.severity !== 'info')).toEqual([]);
    expect(run.findings.some((f) => /Success state shown/.test(f.message))).toBe(true);
  });

  test('Level 2 needs confirmation: unconfirmed runs never POST', async () => {
    fx.reset();
    await runCheck(context, extId, {
      url: fx.clean + '/',
      viewports: ['desktop'],
      groups: { newsletter: true, interactions: false, accessibility: false, links: false },
      opts: {
        newsletterLevel: 2,
        newsletterEmail: 'qa+clean@example.test',
        confirmedNewsletterL2: false,
      },
    });
    expect(mutations('clean')).toHaveLength(0);
  });

  test('cart actions leave the cart exactly as it was', async () => {
    fx.reset();
    const before = JSON.stringify(fx.cart('clean'));
    const { run } = await runCheck(context, extId, {
      url: fx.clean + '/products/aurora-ring',
      viewports: ['desktop'],
      groups: { cart: true, interactions: false, accessibility: false, links: false },
      opts: { confirmedCartActions: true },
    });
    expect(run.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(
      hitsTo('clean', (h) => h.path === '/cart/add.js' && h.method === 'POST').length,
    ).toBeGreaterThan(0);
    expect(JSON.stringify(fx.cart('clean'))).toBe(before);
    noProtectedHits('clean');
  });

  test('cancelling mid-run still restores the cart', async () => {
    fx.reset();
    const before = JSON.stringify(fx.cart('clean'));
    const page = await startRun(context, extId, {
      url: fx.clean + '/products/aurora-ring',
      viewports: ['desktop'],
      groups: { cart: true, accessibility: false, links: false },
      opts: { confirmedCartActions: true },
    });
    await page.waitForSelector('#btn-cancel');
    await page.click('#btn-cancel');
    const run = await waitDone(page);
    expect(['cancelled', 'finished']).toContain(run.status);
    expect(JSON.stringify(fx.cart('clean'))).toBe(before);
  });
});

test.describe('run modes', () => {
  test('Pages mode checks only the saved list and carries preview parameters', async () => {
    fx.reset();
    const pages = [
      fx.clean + '/pages/about?preview_theme_id=148302771',
      fx.clean + '/pages/care?preview_theme_id=148302771',
    ];
    const { run } = await runCheck(context, extId, {
      mode: 'pages',
      url: fx.clean + '/?preview_theme_id=148302771',
      pages,
      viewports: ['desktop', 'mobile'],
    });
    expect(run.pages).toEqual(pages);
    expect([...new Set(run.completed.map((c) => c.url))].sort()).toEqual([...pages].sort());
    expect(run.completed).toHaveLength(4); // 2 pages x 2 viewports
    const docHits = hitsTo(
      'clean',
      (h) => /^\/(pages|collections|products|blogs)\//.test(h.path) || h.path === '/',
    );
    expect(docHits.length).toBeGreaterThan(0);
    for (const h of docHits) {
      if (h.method === 'GET' && ['/pages/about', '/pages/care'].includes(h.path)) {
        // page navigations carry the preview parameter
        expect(h.search).toContain('preview_theme_id=148302771');
      }
    }
    expect(
      hitsTo('clean', (h) => h.path === '/' && h.method === 'GET' && !h.search.includes('q=')),
    ).toHaveLength(0);
    expect(run.findings.filter((f) => f.severity !== 'info')).toEqual([]);
  });

  test('Full mode samples the sitemap, rewrites origins and flags a theme change (row 28)', async () => {
    fx.reset();
    const { run } = await runCheck(context, extId, {
      mode: 'full',
      url: fx.broken + '/?preview_theme_id=148302771',
      viewports: ['desktop'],
      groups: { interactions: false, accessibility: false },
      opts: {
        sample: { home: 1, collections: 1, products: 1, pages: 2, blog: 0, article: 0 },
        maxPages: 8,
      },
    });
    expect(run.status).toBe('finished');
    const paths = run.pages.map((p) => new URL(p).pathname).sort();
    expect(paths).toContain('/cart');
    expect(paths).toContain('/search');
    expect(paths).toContain('/pages/storefront-qa-404-check');
    expect(paths).toContain('/pages/about');
    expect(run.pages.every((p) => p.startsWith(fx.broken))).toBe(true); // primary domain rewritten
    expect(run.pages.every((p) => p.includes('preview_theme_id=148302771'))).toBe(true);
    expect(has(run, 'shopify/theme-changed', { severity: 'error' })).toBe(true);
    const tc = find(run, 'shopify/theme-changed');
    expect(tc.every((f) => f.url.includes('/pages/about'))).toBe(true);
    // the guaranteed-404 document is expected and not reported as a failure
    expect(
      run.findings.some(
        (f) =>
          f.rule === 'health/network-failure' &&
          f.url.includes('storefront-qa-404-check') &&
          /itself/.test(f.message),
      ),
    ).toBe(false);
    noProtectedHits('broken');
  });

  test('Live tab mode analyses the open tab without reloading or emulating it', async () => {
    fx.reset();
    const tab = await context.newPage();
    await tab.goto(fx.clean + '/');
    await tab.evaluate(() => {
      (window as unknown as Record<string, unknown>).__live = 1;
    });
    const nav0 = await tab.evaluate(() => performance.timeOrigin);
    const probe = await context.newPage();
    await probe.goto(`chrome-extension://${extId}/options.html`);
    const tabId = await probe.evaluate(async (u) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url === u)?.id;
    }, fx.clean + '/');
    await probe.close();
    const { run } = await runCheck(context, extId, {
      mode: 'live',
      url: fx.clean + '/',
      liveTab: tabId,
      groups: { interactions: false },
    });
    expect(run.status).toBe('finished');
    expect(run.completed.map((c) => c.viewport)).toEqual(['desktop']);
    expect(run.notes.join(' ')).toMatch(/events from before the run started cannot be captured/i);
    expect(await tab.evaluate(() => (window as unknown as Record<string, unknown>).__live)).toBe(1);
    expect(await tab.evaluate(() => performance.timeOrigin)).toBe(nav0);
    await tab.close();
  });

  test('a password-protected storefront stops with a clear message', async () => {
    const { run } = await runCheck(context, extId, {
      url: fx.locked + '/',
      viewports: ['desktop'],
    });
    expect(run.status).not.toBe('finished');
    expect(run.notes.join(' ')).toMatch(/password/i);
  });
});

test.describe('report UI', () => {
  test('groups, badges, filters, passed list and compare', async () => {
    fx.reset();
    const a = await runCheck(context, extId, {
      url: fx.broken + '/',
      viewports: ['desktop'],
      groups: { interactions: false },
    });
    const first = a.run;
    await a.page.close();
    const { run, page } = await runCheck(context, extId, {
      url: fx.broken + '/',
      viewports: ['desktop', 'mobile'],
      groups: { interactions: false },
    });
    void run;
    const body = page.locator('body');
    await expect(page.locator('#sum-line')).toContainText('issue group');
    await expect(page.locator('details.finding').first()).toBeVisible();
    expect(await page.locator('.badge:not(.off)').count()).toBeGreaterThan(0);
    expect(await page.locator('.badge.off').count()).toBeGreaterThan(0);
    // severity filter
    await page.click('button[data-sev="error"]');
    await expect(page.locator('details.finding.warning')).toHaveCount(0);
    expect(await page.locator('details.finding.error').count()).toBeGreaterThan(0);
    // text filter
    await page.fill('#f-text', 'missing-alt');
    await expect(page.locator('details.finding')).toHaveCount(0);
    await page.click('button[data-sev="all"]');
    await expect(page.locator('details.finding')).toHaveCount(1);
    // seen-on summary
    await expect(body).toContainText('Passed checks');
    // compare with previous run
    await page.click('#btn-compare');
    await expect(page.locator('#compare')).toBeVisible();
    const newCount = Number(await page.locator('#cmp-new').innerText());
    const fixed = Number(await page.locator('#cmp-fixed').innerText());
    expect(newCount).toBeGreaterThan(0); // mobile-only findings
    expect(fixed).toBe(0);
    expect(first.findings.length).toBeGreaterThan(0);
    await page.close();
  });
});

test.describe('visual baseline (CHK-19)', () => {
  const only = {
    visual: true,
    interactions: false,
    accessibility: false,
    links: false,
    performance: false,
    shopify: false,
  };

  test('save a baseline, match it, then catch a seeded visual change', async () => {
    fx.reset();
    const first = await runCheck(context, extId, {
      url: fx.clean + '/',
      viewports: ['desktop'],
      groups: only,
    });
    expect(has(first.run, 'visual/no-baseline', { severity: 'info' })).toBe(true);
    await first.page.click('#btn-baseline');
    await expect(first.page.locator('.toast')).toContainText('visual baseline');
    await first.page.close();

    const same = await runCheck(context, extId, {
      url: fx.clean + '/',
      viewports: ['desktop'],
      groups: only,
    });
    expect(same.run.findings.filter((f) => f.rule.startsWith('visual/'))).toEqual([]);
    expect(same.run.completed[0].results.find((r) => r.checkId === 'CHK-19')?.status).toBe(
      'passed',
    );
    await same.page.close();

    const changed = await runCheck(context, extId, {
      url: fx.clean + '/?qa_variant=banner',
      viewports: ['desktop'],
      groups: only,
    });
    const diff = find(changed.run, 'visual/diff', { severity: 'warning' });
    expect(diff).toHaveLength(1);
    expect(diff[0].screenshotId).toBeTruthy();
    await changed.page.close();
  });
});
