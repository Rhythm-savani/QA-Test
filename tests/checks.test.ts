import { describe, expect, it } from 'vitest';
import type { AnalyzeOptions, RunContext } from '../src/shared/types';
import { DEFAULT_OPTIONS } from '../src/shared/options';
import { chk01 } from '../src/checks/chk01-runtime-errors';
import { chk02 } from '../src/checks/chk02-network';
import { chk03 } from '../src/checks/chk03-media';
import { chk04 } from '../src/checks/chk04-links';
import { chk05, classify } from '../src/checks/chk05-template-leftovers';
import { chk06, sectionTypeFromId } from '../src/checks/chk06-empty-content';
import { chk07 } from '../src/checks/chk07-fonts';
import { chk08 } from '../src/checks/chk08-layout';
import { chk10, axeSeverity } from '../src/checks/chk10-a11y';
import { chk11 } from '../src/checks/chk11-performance';
import { chk12 } from '../src/checks/chk12-page-basics';
import { chk13 } from '../src/checks/chk13-variants';
import { chk14 } from '../src/checks/chk14-cart-badge';
import { chk16 } from '../src/checks/chk16-newsletter';
import { chk17 } from '../src/checks/chk17-cart-actions';
import { chk18 } from '../src/checks/chk18-custom-rules';
import { chk09 } from '../src/checks/chk09-interactions';
import { CHECKS } from '../src/checks/registry';
import { RULES, isVisualFinding, ruleInfo } from '../src/checks/rules';

const opts: AnalyzeOptions = {
  ignoreConsole: [],
  ignoreNetwork: [],
  showConsoleWarn: false,
  strictTapTargets: false,
  thresholds: DEFAULT_OPTIONS.thresholds,
  newsletterLevel: 1,
  newsletterEmail: '',
};
const ctx = (over: Partial<RunContext> = {}): RunContext => ({
  url: 'https://s.test/',
  origin: 'https://s.test',
  viewport: 'desktop',
  isShopify: true,
  options: opts,
  ...over,
});
// The analyzers are typed with their own data shapes; tests feed plain JSON.
const run = (
  c: { analyze: (d: never, x: RunContext) => ReturnType<typeof chk01.analyze> },
  d: unknown,
  x = ctx(),
) => c.analyze(d as never, x);
const rules = (fs: { rule: string; severity: string }[]) =>
  fs.map((f) => `${f.severity}:${f.rule}`);

describe('registry', () => {
  it('lists unique ids and only known categories/groups', () => {
    const ids = CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(19);
  });
  it('gives every rule a title and category', () => {
    for (const [k, v] of Object.entries(RULES)) {
      expect(v.title, k).toBeTruthy();
      expect(v.category, k).toBeTruthy();
    }
    expect(ruleInfo('a11y/axe:label').category).toBe('a11y');
  });
});

describe('CHK-01 runtime errors', () => {
  const ev = (kind: string, message: string) => ({ kind, message, t: 1 });
  it('maps kinds to rules and severities', () => {
    const fs = run(chk01, {
      events: [
        ev('exception', 'boom'),
        ev('rejection', 'nope'),
        ev('console-error', 'bad'),
        ev('csp', 'blocked'),
        ev('console-warn', 'careful'),
      ],
    });
    expect(rules(fs)).toEqual([
      'error:health/uncaught-exception',
      'error:health/unhandled-rejection',
      'error:health/console-error',
      'error:health/csp-violation',
    ]);
  });
  it('shows console.warn as info only when enabled and honours ignore regexes', () => {
    const d = {
      events: [ev('console-warn', 'careful'), ev('console-error', 'ResizeObserver loop')],
    };
    const x = ctx({
      options: { ...opts, showConsoleWarn: true, ignoreConsole: ['^ResizeObserver'] },
    });
    expect(rules(run(chk01, d, x))).toEqual(['info:health/console-warn']);
  });
  it('collapses repeats', () => {
    const fs = run(chk01, { events: [ev('console-error', 'x'), ev('console-error', 'x')] });
    expect(fs).toHaveLength(1);
    expect(fs[0].meta?.count).toBe(2);
  });
});

describe('CHK-02 network failures', () => {
  it('classifies same-origin, CDN, third-party and blocked requests', () => {
    const fs = run(
      chk02,
      {
        events: [],
        resources: [
          { url: 'https://s.test/a.png', status: 404, type: 'img' },
          { url: 'https://cdn.shopify.com/s/files/x.js', status: 500, type: 'script' },
          { url: 'https://tracker.example.net/t.js', status: 403, type: 'script' },
        ],
      },
      ctx({
        cdpNetwork: [{ url: 'https://ads.example.net/p', errorText: 'net::ERR_BLOCKED_BY_CLIENT' }],
      }),
    );
    expect(Object.fromEntries(fs.map((f) => [f.meta?.url, f.severity]))).toEqual({
      'https://s.test/a.png': 'error',
      'https://cdn.shopify.com/s/files/x.js': 'error',
      'https://tracker.example.net/t.js': 'warning',
      'https://ads.example.net/p': 'info',
    });
  });
  it('merges duplicate sources and collapses repeats', () => {
    const fs = run(
      chk02,
      {
        events: [{ kind: 'resource-error', message: 'x', url: 'https://s.test/a.png', t: 1 }],
        resources: [{ url: 'https://s.test/a.png', status: 404, type: 'img' }],
      },
      ctx({ cdpNetwork: [{ url: 'https://s.test/a.png', status: 404 }] }),
    );
    expect(fs).toHaveLength(1);
  });
  it('honours the ignore list and ignores data URLs', () => {
    const fs = run(
      chk02,
      { events: [], resources: [{ url: 'https://s.test/skip.js', status: 404, type: 'script' }] },
      ctx({ options: { ...opts, ignoreNetwork: ['skip\\.js'] } }),
    );
    expect(fs).toHaveLength(0);
  });
});

describe('CHK-03 media', () => {
  const img = (o: object) => ({
    selector: 'img',
    snippet: '<img>',
    src: '/a.png',
    alt: 'x',
    broken: false,
    nw: 400,
    nh: 200,
    rw: 400,
    rh: 200,
    objectFit: 'fill',
    visible: true,
    decorative: false,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    dpr: 1,
    ...o,
  });
  it('finds broken, missing alt, stretched and oversized images', () => {
    const fs = run(chk03, {
      images: [
        img({ broken: true, nw: 0, nh: 0 }),
        img({ alt: null }),
        img({ rw: 100, rh: 200 }),
        img({ nw: 4000, nh: 2000, rw: 400, rh: 200 }),
        img({ alt: '' }),
        img({ alt: null, decorative: true }),
        img({ rw: 100, rh: 200, objectFit: 'cover' }),
      ],
      videos: [
        { selector: 'video', snippet: '<video>', code: 4, rect: { x: 0, y: 0, w: 1, h: 1 } },
      ],
    });
    expect(rules(fs).sort()).toEqual(
      [
        'error:media/broken-image',
        'warning:media/missing-alt',
        'warning:media/stretched-image',
        'info:media/oversized-image',
        'error:media/video-error',
      ].sort(),
    );
  });
});

describe('CHK-04 links', () => {
  const link = (o: object) => ({
    selector: 'a',
    snippet: '<a>',
    rawHref: '/x',
    href: 'https://s.test/x',
    target: '',
    rel: '',
    buttonish: false,
    sameOrigin: true,
    scheme: 'https:',
    ...o,
  });
  it('flags dead anchors, malformed contact links, noopener and broken targets', () => {
    const fs = run(chk04, {
      capped: 0,
      statuses: { 'https://s.test/gone': 404, 'https://s.test/ok': 200, 'https://ext.test/': 0 },
      links: [
        link({ rawHref: '#', href: 'https://s.test/' }),
        link({ rawHref: '', href: 'https://s.test/' }),
        link({ rawHref: 'javascript:void(0)', scheme: 'javascript:', href: '' }),
        link({ rawHref: '#', buttonish: true }),
        link({ rawHref: 'mailto:nope', scheme: 'mailto:', href: '' }),
        link({ rawHref: 'tel:+1 (555) 123-4567', scheme: 'tel:', href: '' }),
        link({ rawHref: 'tel:abc', scheme: 'tel:', href: '' }),
        link({
          rawHref: 'https://ext.test/',
          href: 'https://ext.test/',
          sameOrigin: false,
          target: '_blank',
        }),
        link({ rawHref: '/gone', href: 'https://s.test/gone' }),
        link({ rawHref: '/ok', href: 'https://s.test/ok' }),
      ],
    });
    expect(rules(fs).sort()).toEqual(
      [
        'warning:links/dead-anchor',
        'warning:links/dead-anchor',
        'warning:links/dead-anchor',
        'warning:links/malformed-contact',
        'warning:links/malformed-contact',
        'info:links/noopener-missing',
        'warning:links/broken-external',
        'error:links/broken-internal',
      ].sort(),
    );
  });
  it('reports truncation', () => {
    const fs = run(chk04, { links: [], statuses: {}, capped: 12 });
    expect(fs[0].message).toMatch(/12 more/);
  });
});

describe('CHK-05 template leftovers', () => {
  it('classifies text', () => {
    expect(classify('Liquid error (line 3): x')).toBe('liquid');
    expect(classify('Liquid syntax error: Unknown tag')).toBe('liquid');
    expect(classify('translation missing: en.foo')).toBe('translation');
    expect(classify('{{ product.title }}')).toBe('raw');
    expect(classify('{% if x %}')).toBe('raw');
    expect(classify('[object Object]')).toBe('raw');
    expect(classify('undefined')).toBe('raw');
    expect(classify('NaN')).toBe('raw');
    expect(classify('Lorem ipsum dolor')).toBe('placeholder');
    expect(classify('Not undefined behaviour')).toBeNull();
    expect(classify('Hello')).toBeNull();
  });
  it('maps kinds to rules and severities', () => {
    const hit = (kind: string) => ({
      kind,
      where: 'text',
      text: 't',
      selector: 's',
      snippet: '<p>',
    });
    const fs = run(chk05, { hits: ['liquid', 'translation', 'raw', 'placeholder'].map(hit) });
    expect(rules(fs)).toEqual([
      'error:content/liquid-error',
      'error:content/translation-missing',
      'error:content/raw-template-syntax',
      'warning:content/placeholder-text',
    ]);
  });
});

describe('CHK-06 empty content', () => {
  it('parses section types from ids', () => {
    expect(sectionTypeFromId('shopify-section-template--15234__featured_collection')).toBe(
      'featured_collection',
    );
    expect(sectionTypeFromId('shopify-section-header')).toBe('header');
    expect(sectionTypeFromId('shopify-section-template--1__empty')).toBe('empty');
  });
  it('flags empty sections with lower severity for header/footer and empty headings', () => {
    const sec = (id: string, type: string, o: object = {}) => ({
      id,
      type,
      selector: '#' + id,
      snippet: '<div>',
      height: 0,
      textLen: 0,
      media: 0,
      controls: 0,
      rect: { x: 0, y: 0, w: 0, h: 0 },
      ...o,
    });
    const fs = run(chk06, {
      sections: [
        sec('a', 'empty'),
        sec('b', 'footer'),
        sec('c', 'full', { height: 200, textLen: 20 }),
        sec('d', 'announcement-bar', { height: 40 }),
      ],
      headings: [{ selector: 'h2', snippet: '<h2>', rect: { x: 0, y: 0, w: 1, h: 1 } }],
    });
    expect(rules(fs)).toEqual([
      'warning:content/empty-section',
      'info:content/empty-section',
      'info:content/empty-section',
      'warning:content/empty-heading',
    ]);
  });
});

describe('CHK-07 fonts', () => {
  it('reports failed font faces', () => {
    const fs = run(chk07, { failed: [{ family: 'QAFont', weight: '400', style: 'normal' }] });
    expect(rules(fs)).toEqual(['warning:content/font-failed']);
  });
});

describe('CHK-08 layout', () => {
  const base = {
    viewport: { w: 390, h: 844 },
    overflow: null,
    obscured: [],
    clipped: [],
    tapSmall: [],
    tapStrict: [],
    fixedBig: [],
    truncated: 0,
  };
  const item = { selector: '.x', snippet: '<x>', rect: { x: 0, y: 0, w: 1, h: 1 } };
  it('overflow is an error on mobile/tablet and a warning on desktop', () => {
    const d = {
      ...base,
      overflow: { scrollWidth: 616, clientWidth: 390, offenders: [{ ...item, overshoot: 226 }] },
    };
    expect(rules(run(chk08, d, ctx({ viewport: 'mobile' })))).toEqual([
      'error:layout/horizontal-overflow',
    ]);
    expect(rules(run(chk08, d, ctx({ viewport: 'tablet' })))).toEqual([
      'error:layout/horizontal-overflow',
    ]);
    expect(rules(run(chk08, d, ctx({ viewport: 'desktop' })))).toEqual([
      'warning:layout/horizontal-overflow',
    ]);
  });
  it('maps the other layout findings', () => {
    const fs = run(chk08, {
      ...base,
      obscured: [{ ...item, by: '<div>', bySelector: '.cover' }],
      clipped: [{ ...item, sw: 10, cw: 5, sh: 1, ch: 1 }],
      tapSmall: [{ ...item, w: 16, h: 16, name: 'x' }],
      tapStrict: [{ ...item, w: 30, h: 30, name: 'y' }],
      fixedBig: [{ ...item, ratio: 0.5, position: 'fixed' }],
    });
    expect(rules(fs)).toEqual([
      'error:layout/obscured-interactive',
      'info:layout/clipped-text',
      'warning:layout/tap-target-small',
      'info:layout/tap-target-strict',
      'warning:layout/fixed-covers-viewport',
    ]);
  });
});

describe('CHK-10 accessibility', () => {
  it('maps axe impact to severity', () => {
    expect(axeSeverity('critical')).toBe('error');
    expect(axeSeverity('serious')).toBe('error');
    expect(axeSeverity('moderate')).toBe('warning');
    expect(axeSeverity('minor')).toBe('info');
    expect(axeSeverity(null)).toBe('info');
  });
  it('names rules a11y/axe:<id> and notes truncation', () => {
    const node = { target: ['#a'], html: '<a>', failureSummary: 'Fix it' };
    const fs = run(chk10, {
      violations: [
        {
          id: 'color-contrast',
          impact: 'serious',
          help: 'Contrast',
          helpUrl: 'https://x',
          nodes: [node],
          totalNodes: 25,
        },
      ],
    });
    expect(fs[0].rule).toBe('a11y/axe:color-contrast');
    expect(fs[0].severity).toBe('error');
    expect(fs[0].selector).toBe('#a');
    expect(fs[1].message).toMatch(/1 of 25|20 of 25/);
  });
});

describe('CHK-11 performance', () => {
  const base = {
    ttfb: 100,
    fcp: 500,
    lcp: 800,
    lcpEl: null,
    cls: 0,
    shiftSources: [],
    transferBytes: 1000,
    requests: 3,
    thirdPartyHosts: 0,
    renderBlocking: [],
    domNodes: 100,
  };
  it('grades against thresholds', () => {
    const fs = run(chk11, { ...base, lcp: 3000, cls: 0.3, ttfb: 1000 });
    expect(rules(fs.filter((f) => f.severity !== 'info')).sort()).toEqual(
      ['error:performance/cls', 'warning:performance/lcp', 'warning:performance/ttfb'].sort(),
    );
    expect(fs.at(-1)?.message).toMatch(/indicative/);
  });
  it('flags a lazy LCP image and a missing fetchpriority', () => {
    const el = {
      selector: 'img',
      snippet: '<img>',
      tag: 'img',
      url: '/a',
      loading: 'lazy',
      fetchpriority: null,
    };
    expect(rules(run(chk11, { ...base, lcpEl: el }))).toContain('warning:performance/lcp-lazy');
    const eager = { ...el, loading: null };
    expect(rules(run(chk11, { ...base, lcpEl: eager }))).toContain('info:performance/lcp-priority');
    expect(
      rules(run(chk11, { ...base, lcpEl: { ...eager, fetchpriority: 'high' } })),
    ).not.toContain('info:performance/lcp-priority');
  });
});

describe('CHK-12 page basics', () => {
  const ok = {
    title: 'T',
    description: 'd',
    h1Count: 1,
    lang: 'en',
    viewport: 'w',
    canonical: 'c',
    robots: null,
  };
  it('passes a complete page', () => {
    expect(run(chk12, ok)).toHaveLength(0);
  });
  it('flags title, h1 count and others; noindex is info only', () => {
    const fs = run(chk12, {
      ...ok,
      title: null,
      h1Count: 2,
      description: null,
      lang: null,
      robots: 'noindex',
    });
    expect(rules(fs).sort()).toEqual(
      [
        'warning:seo/title-missing',
        'warning:seo/h1-count',
        'warning:seo/description-missing',
        'warning:seo/lang-missing',
        'info:seo/noindex',
      ].sort(),
    );
    expect(rules(run(chk12, { ...ok, title: 'undefined' }))).toEqual(['warning:seo/title-missing']);
  });
});

describe('CHK-13 variants', () => {
  const v = (o: object) => ({
    id: 1,
    title: '7',
    jsonPrice: 13900,
    available: true,
    hasFeaturedImage: false,
    featuredSrc: '',
    controlFound: true,
    urlVariant: '1',
    priceText: '$139.00',
    soldOutUi: false,
    media: 'a',
    consoleErrors: [],
    ...o,
  });
  it('passes consistent variants', () => {
    expect(run(chk13, { handle: 'p', variants: [v({})], total: 1 })).toHaveLength(0);
  });
  it('flags price, availability, url and console errors', () => {
    const fs = run(chk13, {
      handle: 'p',
      total: 4,
      variants: [
        v({ priceText: '$119.00' }),
        v({ id: 2, urlVariant: '2', available: false, soldOutUi: false }),
        v({ id: 3, urlVariant: null }),
        v({ id: 4, urlVariant: '4', consoleErrors: ['TypeError'] }),
      ],
    });
    expect(rules(fs).sort()).toEqual(
      [
        'error:shopify/variant-price-mismatch',
        'error:shopify/variant-availability-mismatch',
        'info:shopify/variant-url-missing',
        'warning:shopify/variant-console-error',
      ].sort(),
    );
  });
});

describe('CHK-14 cart badge', () => {
  it('compares the badge with /cart.js', () => {
    expect(run(chk14, { badge: 3, itemCount: 1 })).toHaveLength(1);
    expect(run(chk14, { badge: 1, itemCount: 1 })).toHaveLength(0);
    expect(run(chk14, { badge: null, itemCount: 1 })).toHaveLength(0);
  });
});

describe('CHK-16 newsletter', () => {
  const l1 = {
    selector: 'form',
    snippet: '<input>',
    inputType: 'email',
    required: true,
    hasName: true,
    hasSubmit: true,
    submitEnabled: true,
    action: '/contact',
    method: 'post',
    hasMessageRegion: true,
    emptyInvalid: true,
    badInvalid: true,
  };
  it('level 1 passes a well-formed form and flags a sloppy one', () => {
    expect(run(chk16, { found: true, l1 })).toHaveLength(0);
    const fs = run(chk16, {
      found: true,
      l1: { ...l1, inputType: 'text', required: false, emptyInvalid: false, badInvalid: false },
    });
    expect(fs.every((f) => f.rule === 'newsletter/form-invalid' && f.severity === 'warning')).toBe(
      true,
    );
    expect(fs.length).toBeGreaterThanOrEqual(2);
  });
  it('reports third-party forms as not testable', () => {
    expect(rules(run(chk16, { found: false, thirdParty: '.klaviyo' }))).toEqual([
      'info:newsletter/not-testable',
    ]);
    expect(run(chk16, { found: false })).toHaveLength(0);
  });
  it('level 2: success, missing success state and captcha', () => {
    const at = (l2: object) =>
      run(chk16, { found: true, l1, l2: { attempted: true, email: 'a+qa@x.test', ...l2 } });
    expect(rules(at({ success: true, status: 200 }))).toEqual(['info:newsletter/not-testable']);
    const bad = at({ success: false, status: 200 });
    expect(rules(bad)).toEqual(['error:newsletter/no-success-state']);
    expect(bad[0].message).toMatch(/a\+qa@x\.test/);
    expect(bad[0].message).toMatch(/removed from the store manually/);
    expect(rules(at({ captcha: true }))).toEqual(['info:newsletter/not-testable']);
  });
});

describe('CHK-17 cart actions', () => {
  const ok = {
    ran: true,
    beforeCount: 1,
    addedOk: true,
    countAfterAdd: 2,
    badgeAfterAdd: 2,
    uiShowsItem: true,
    qtyPlusOk: true,
    qtyMinusOk: true,
    subtotalOk: true,
    removeOk: true,
    finalCount: 1,
    restored: true,
  };
  it('passes a healthy cart flow and ignores skipped runs', () => {
    expect(run(chk17, ok)).toHaveLength(0);
    expect(run(chk17, { ...ok, ran: false })).toHaveLength(0);
  });
  it('flags each failure', () => {
    expect(rules(run(chk17, { ...ok, addedOk: false, removeOk: false, restored: false }))).toEqual([
      'error:cart/add-failed',
      'error:cart/not-restored',
    ]);
    expect(rules(run(chk17, { ...ok, badgeAfterAdd: 5 }))).toEqual(['error:cart/count-mismatch']);
    expect(rules(run(chk17, { ...ok, qtyPlusOk: false }))).toEqual([
      'error:cart/quantity-mismatch',
    ]);
  });
});

describe('CHK-18 custom rules', () => {
  it('reports failures per stage', () => {
    const fs = run(chk18, {
      outcomes: [
        { name: 'a', matched: true, triggerFound: false },
        { name: 'b', matched: true, triggerFound: true, opened: false },
        {
          name: 'c',
          matched: true,
          triggerFound: true,
          opened: true,
          closeFound: true,
          closed: false,
        },
        {
          name: 'd',
          matched: true,
          triggerFound: true,
          opened: true,
          closeFound: true,
          closed: true,
        },
        { name: 'e', matched: false, triggerFound: false },
      ],
    });
    expect(rules(fs)).toEqual([
      'warning:custom/rule-failed',
      'error:custom/rule-failed',
      'error:custom/rule-failed',
    ]);
  });
});

describe('CHK-09 interactions', () => {
  it('turns raw engine output into findings with shot keys and notes the cap', () => {
    const fs = run(chk09, {
      findings: [
        {
          rule: 'interaction/close-no-effect',
          severity: 'error',
          message: 'm',
          selector: 'b',
          shotKey: 'k1',
        },
      ],
      needReload: false,
      nextIndex: 5,
      total: 40,
      tested: 5,
      capped: true,
      passed: [],
      timings: [],
      skippedDenied: 0,
    });
    expect(fs[0].meta?.shotKey).toBe('k1');
    expect(fs[1].message).toMatch(/Tested 5 of 40/);
  });
});

describe('visual findings (RPT-7)', () => {
  it('screenshots element findings but not console/network/seo findings', () => {
    const f = (rule: string, selector?: string) =>
      ({ rule, selector, id: 'x' }) as Parameters<typeof isVisualFinding>[0];
    expect(isVisualFinding(f('layout/horizontal-overflow', 'html'))).toBe(true);
    expect(isVisualFinding(f('media/broken-image', 'img'))).toBe(true);
    expect(isVisualFinding(f('a11y/axe:color-contrast', '#x'))).toBe(true);
    expect(isVisualFinding(f('health/console-error'))).toBe(false);
    expect(isVisualFinding(f('health/network-failure'))).toBe(false);
    expect(isVisualFinding(f('seo/title-missing', 'head > title'))).toBe(false);
    expect(isVisualFinding(f('links/broken-internal', 'a'))).toBe(false);
  });
});

import type { VisualResult } from '../src/checks/chk19-visual-baseline';

describe('CHK-19 visual baseline', () => {
  const data = (result: VisualResult) => ({
    path: '/',
    cssWidth: 1440,
    cssHeight: 900,
    masks: [],
    result,
  });
  it('is quiet when the page matches and info-only without a baseline', async () => {
    const { chk19 } = await import('../src/checks/chk19-visual-baseline');
    expect(chk19.analyze(data({ state: 'same', ratio: 0 }), ctx())).toHaveLength(0);
    expect(rules(chk19.analyze(data({ state: 'no-baseline' }), ctx()))).toEqual([
      'info:visual/no-baseline',
    ]);
  });
  it('warns on a diff and on a size change', async () => {
    const { chk19 } = await import('../src/checks/chk19-visual-baseline');
    const d = chk19.analyze(data({ state: 'diff', ratio: 0.0123 }), ctx());
    expect(rules(d)).toEqual(['warning:visual/diff']);
    expect(d[0].message).toMatch(/1\.23%/);
    expect(rules(chk19.analyze(data({ state: 'size-changed', message: 'x' }), ctx()))).toEqual([
      'warning:visual/size-changed',
    ]);
  });
});
