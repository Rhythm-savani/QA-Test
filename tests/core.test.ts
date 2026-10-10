import { describe, expect, it } from 'vitest';
import { escapeHtml, fingerprint, normalizeForFingerprint, sha1 } from '../src/shared/util';
import { moneyToMinorUnits, pricesMatch } from '../src/shared/money';
import {
  isCheckoutUrl,
  normalizePageEntry,
  previewParamsOf,
  rewriteToOrigin,
  withPreviewParams,
} from '../src/shared/url';
import {
  classify,
  linksFromHtml,
  parseLocs,
  planPages,
  NOT_FOUND_PATH,
} from '../src/shopify/sitemap';
import {
  CORE_GROUPS,
  DEFAULT_OPTIONS,
  allGroups,
  detectPreset,
  exportOptions,
  importOptions,
  recommendedGroups,
  sanitizeOptions,
  validateCustomRules,
} from '../src/shared/options';
import { buildRunConfig, groupsFor, permissionsNeeded } from '../src/shared/run-config';
import { BUILTIN_DENY, isDeniedText } from '../src/engine/safety';

describe('sha1 / fingerprints', () => {
  it('matches known vectors', () => {
    expect(sha1('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1('The quick brown fox jumps over the lazy dog')).toBe(
      '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
    );
  });
  it('is stable across volatile numbers and whitespace', () => {
    const a = fingerprint('CHK-08', 'layout/horizontal-overflow', '.x', 'content 616px  wide');
    const b = fingerprint('CHK-08', 'layout/horizontal-overflow', '.x', 'Content 700px wide');
    expect(a).toBe(b);
    expect(normalizeForFingerprint('  A  1 b22 ')).toBe('a # b#');
  });
  it('differs when the rule or selector differs', () => {
    expect(fingerprint('A', 'r', '.a', 'm')).not.toBe(fingerprint('A', 'r', '.b', 'm'));
    expect(fingerprint('A', 'r', '.a', 'm')).not.toBe(fingerprint('A', 'q', '.a', 'm'));
  });
});

describe('escapeHtml', () => {
  it('neutralises markup', () => {
    expect(escapeHtml('"><img src=x onerror=1>')).toBe('&quot;&gt;&lt;img src=x onerror=1&gt;');
  });
});

describe('money normaliser', () => {
  it.each([
    ['$129.00', '12900'],
    ['$129', '12900'],
    ['129,00 €', '12900'],
    ['€1.299,00', '129900'],
    ['1 299,50 kr', '129950'],
    ['£1,299.00', '129900'],
    ["CHF 1'299.00", '129900'],
    ['¥12,900', '1290000'],
    ['Rs. 1,29,900.00', '12990000'],
  ])('%s -> %s', (text, minor) => {
    expect(moneyToMinorUnits(text)).toBe(minor);
  });
  it('compares against JSON minor units', () => {
    expect(pricesMatch('$139.00', 13900)).toBe(true);
    expect(pricesMatch('$119.00', 13900)).toBe(false);
    expect(moneyToMinorUnits('Sold out')).toBeNull();
  });
});

describe('url helpers', () => {
  const start = 'https://shop.test/products/a?preview_theme_id=123&pb=0&utm=1';
  it('extracts preview params only', () => {
    expect(previewParamsOf(start)).toEqual({ preview_theme_id: '123', pb: '0' });
  });
  it('carries preview params without overriding existing ones', () => {
    expect(withPreviewParams('https://shop.test/cart', { preview_theme_id: '123' })).toBe(
      'https://shop.test/cart?preview_theme_id=123',
    );
    expect(
      withPreviewParams('https://shop.test/cart?preview_theme_id=9', { preview_theme_id: '1' }),
    ).toBe('https://shop.test/cart?preview_theme_id=9');
  });
  it('rewrites a primary-domain URL to the audited origin', () => {
    expect(
      rewriteToOrigin('https://primary.example.com/products/x?y=1', 'http://127.0.0.1:5000'),
    ).toBe('http://127.0.0.1:5000/products/x?y=1');
  });
  it('normalises Pages entries and rejects external origins', () => {
    const ok = normalizePageEntry('/collections/all', 'https://shop.test', start);
    expect(ok).toEqual({
      ok: true,
      url: 'https://shop.test/collections/all?preview_theme_id=123&pb=0',
      path: '/collections/all?preview_theme_id=123&pb=0',
    });
    expect(normalizePageEntry('https://shop.test/cart#x', 'https://shop.test', start).ok).toBe(
      true,
    );
    const bad = normalizePageEntry('https://evil.test/', 'https://shop.test', start);
    expect(bad.ok).toBe(false);
    expect(normalizePageEntry('  ', 'https://shop.test', start).ok).toBe(false);
  });
  it('detects checkout URLs', () => {
    expect(isCheckoutUrl('https://s.test/checkout')).toBe(true);
    expect(isCheckoutUrl('https://s.test/checkouts/abc')).toBe(true);
    expect(isCheckoutUrl('https://s.test/cart/c/123')).toBe(true);
    expect(isCheckoutUrl('https://s.test/cart')).toBe(false);
  });
});

describe('sitemap parsing and sampling', () => {
  const xml = `<sitemapindex><sitemap><loc>https://p.example.com/sitemap_products_1.xml?a=1&amp;b=2</loc></sitemap></sitemapindex>`;
  it('parses index and url sets, decoding entities', () => {
    const r = parseLocs(xml);
    expect(r.isIndex).toBe(true);
    expect(r.locs[0]).toBe('https://p.example.com/sitemap_products_1.xml?a=1&b=2');
    expect(parseLocs('<urlset><url><loc>https://x/products/a</loc></url></urlset>').isIndex).toBe(
      false,
    );
  });
  it('classifies urls', () => {
    expect(classify('https://x/')).toBe('home');
    expect(classify('https://x/products/a')).toBe('product');
    expect(classify('https://x/en/products/a')).toBe('product');
    expect(classify('https://x/collections/all')).toBe('collection');
    expect(classify('https://x/pages/about')).toBe('page');
    expect(classify('https://x/blogs/news')).toBe('blog');
    expect(classify('https://x/blogs/news/post')).toBe('article');
    expect(classify('https://x/collections/a/products/b')).toBe('other');
  });
  it('samples deterministically, rewrites origin and carries preview params', () => {
    const listed = [
      'https://primary.example.com/products/z',
      'https://primary.example.com/products/a',
      'https://primary.example.com/products/m',
      'https://primary.example.com/products/b',
      'https://primary.example.com/collections/x',
      'https://primary.example.com/pages/about',
    ];
    const input = {
      listed,
      origin: 'http://127.0.0.1:9',
      startUrl: 'http://127.0.0.1:9/?preview_theme_id=7',
      counts: { home: 1, collections: 3, products: 2, pages: 2, blog: 1, article: 1 },
      customPaths: ['/pages/extra'],
      maxPages: 25,
    };
    const a = planPages(input);
    const b = planPages({ ...input, listed: [...listed].reverse() });
    expect(a.map((p) => p.url)).toEqual(b.map((p) => p.url));
    expect(a.every((p) => p.url.startsWith('http://127.0.0.1:9/'))).toBe(true);
    expect(a.every((p) => p.url.includes('preview_theme_id=7'))).toBe(true);
    expect(a.filter((p) => p.kind === 'product').map((p) => new URL(p.url).pathname)).toEqual([
      '/products/a',
      '/products/b',
    ]);
    expect(a.some((p) => p.kind === 'cart')).toBe(true);
    expect(a.some((p) => p.kind === 'search')).toBe(true);
    const nf = a.find((p) => p.kind === 'not-found')!;
    expect(new URL(nf.url).pathname).toBe(NOT_FOUND_PATH);
    expect(nf.expect404).toBe(true);
    expect(a.some((p) => p.url.includes('/pages/extra'))).toBe(true);
  });
  it('caps and de-duplicates', () => {
    const listed = Array.from({ length: 40 }, (_, i) => `https://p/products/p${i}`);
    const out = planPages({
      listed: [...listed, ...listed],
      origin: 'https://s.test',
      startUrl: 'https://s.test/',
      counts: { home: 1, collections: 0, products: 40, pages: 0, blog: 0, article: 0 },
      customPaths: [],
      maxPages: 10,
    });
    expect(out).toHaveLength(10);
    expect(new Set(out.map((p) => p.url)).size).toBe(10);
  });
  it('falls back to links from html', () => {
    const urls = linksFromHtml(
      '<a href="/products/a">x</a><a href="/products/a?x=1">y</a><a href="//cdn/x">z</a>',
      'https://s.test',
    );
    expect(urls).toContain('https://s.test/products/a');
    expect(urls.some((u) => u.includes('cdn'))).toBe(false);
  });
});

describe('options', () => {
  it('has all three viewports on and recommended groups by default', () => {
    expect(DEFAULT_OPTIONS.viewports).toEqual({ desktop: true, tablet: true, mobile: true });
    expect(detectPreset(DEFAULT_OPTIONS.groups)).toBe('recommended');
    expect(DEFAULT_OPTIONS.groups.custom).toBe(false);
    expect(DEFAULT_OPTIONS.groups.newsletter).toBe(false);
    expect(DEFAULT_OPTIONS.groups.cart).toBe(false);
  });
  it('switches to custom when a single switch differs', () => {
    const g = recommendedGroups();
    g.layout = false;
    expect(detectPreset(g)).toBe('custom');
    expect(detectPreset(allGroups())).toBe('all');
  });
  it('keeps at least one viewport on and drops malformed values', () => {
    const o = sanitizeOptions({
      viewports: { desktop: false, tablet: false, mobile: false },
      maxPages: 'lots',
      concurrency: 99,
      groups: { health: 'yes', links: false },
    });
    expect(o.viewports.desktop || o.viewports.tablet || o.viewports.mobile).toBe(true);
    expect(o.maxPages).toBe(25);
    expect(o.concurrency).toBe(3);
    expect(o.groups.health).toBe(true);
    expect(o.groups.links).toBe(false);
  });
  it('round-trips through export/import', () => {
    const o = sanitizeOptions({ ...DEFAULT_OPTIONS, ignoreConsole: ['ResizeObserver'] });
    const r = importOptions(exportOptions(o));
    expect(r.options?.ignoreConsole).toEqual(['ResizeObserver']);
    expect(importOptions('{nope').error).toBeTruthy();
  });
  it('counts 11 core groups', () => {
    expect(CORE_GROUPS).toHaveLength(11);
  });
});

describe('custom rules validation', () => {
  const ok = { name: 'n', urlPattern: '^/', trigger: 'button', expectVisible: '#d' };
  it('accepts a valid rule list', () => {
    const r = validateCustomRules(
      JSON.stringify([ok, { ...ok, close: '.x', closeExpectHidden: '#d' }]),
    );
    expect(r.errors).toEqual([]);
    expect(r.rules).toHaveLength(2);
  });
  it('reports clear errors', () => {
    expect(validateCustomRules('{').errors[0]).toMatch(/not valid JSON/i);
    expect(validateCustomRules('{}').errors[0]).toMatch(/array/i);
    const r = validateCustomRules(JSON.stringify([{ name: 'x' }, { ...ok, urlPattern: '(' }, 5]));
    expect(r.errors.join('\n')).toMatch(/Rule 1: "urlPattern" is required/);
    expect(r.errors.join('\n')).toMatch(/Rule 2: "urlPattern" is not a valid regular expression/);
    expect(r.errors.join('\n')).toMatch(/Rule 3: must be an object/);
    expect(r.rules).toHaveLength(0);
  });
  it('validates selectors through the injected validator', () => {
    const r = validateCustomRules(JSON.stringify([ok]), (s) => s !== 'button');
    expect(r.errors[0]).toMatch(/"trigger" is not a valid CSS selector/);
  });
});

describe('run config', () => {
  const tab = {
    isHttp: true,
    url: 'https://s.test/p?preview_theme_id=1',
    origin: 'https://s.test',
  };
  it('blocks non-http tabs and empty Pages lists', () => {
    expect('error' in buildRunConfig(DEFAULT_OPTIONS, { isHttp: false }, 'quick', [])).toBe(true);
    expect('error' in buildRunConfig(DEFAULT_OPTIONS, tab, 'pages', [])).toBe(true);
  });
  it('uses all three viewports by default and never emulates in Live tab mode', () => {
    const q = buildRunConfig(DEFAULT_OPTIONS, tab, 'quick', []);
    expect('error' in q ? [] : q.viewports).toEqual(['desktop', 'tablet', 'mobile']);
    const l = buildRunConfig(DEFAULT_OPTIONS, tab, 'live', []);
    expect('error' in l ? [] : l.viewports).toEqual(['desktop']);
  });
  it('turns custom rules off until rules exist', () => {
    const o = { ...DEFAULT_OPTIONS, groups: { ...DEFAULT_OPTIONS.groups, custom: true } };
    expect(groupsFor(o).custom).toBe(false);
    const withRules = {
      ...o,
      customRules: JSON.stringify([
        { name: 'a', urlPattern: '.', trigger: 'a', expectVisible: 'b' },
      ]),
    };
    expect(groupsFor(withRules).custom).toBe(true);
  });
  it('asks for the debugger only when needed', () => {
    const cfg = buildRunConfig(
      {
        ...DEFAULT_OPTIONS,
        screenshots: false,
        viewports: { desktop: true, tablet: false, mobile: false },
      },
      tab,
      'quick',
      [],
    );
    if ('error' in cfg) throw new Error(cfg.error);
    expect(permissionsNeeded(cfg).permissions).toEqual([]);
    const all = buildRunConfig(DEFAULT_OPTIONS, tab, 'quick', []);
    if ('error' in all) throw new Error(all.error);
    expect(permissionsNeeded(all).permissions).toEqual(['debugger']);
    expect(permissionsNeeded(all).origins).toEqual(['https://s.test/*']);
  });
});

describe('click denylist', () => {
  const base = { text: '', name: '', href: '', action: '', inPayment: false };
  it.each([
    'Log out',
    'Sign out',
    'Delete address',
    'Remove account',
    'Check out',
    'Pay now',
    'Place order',
    'Buy it now',
    'Subscribe',
    'Submit',
    'Send message',
    'Apply',
    'Add to cart',
  ])('refuses "%s"', (text) => {
    expect(isDeniedText({ ...base, text })).not.toBeNull();
  });
  it('refuses protected hrefs, form actions and payment buttons', () => {
    expect(isDeniedText({ ...base, href: 'https://s.test/account/logout' })).not.toBeNull();
    expect(isDeniedText({ ...base, href: 'https://s.test/checkout' })).not.toBeNull();
    expect(isDeniedText({ ...base, action: '/cart/add' })).not.toBeNull();
    expect(isDeniedText({ ...base, text: 'Buy with', inPayment: true })).toBe('payment button');
  });
  it('allows ordinary controls and honours extra entries without shrinking the built-ins', () => {
    expect(isDeniedText({ ...base, text: 'Open menu' })).toBeNull();
    expect(isDeniedText({ ...base, text: 'gift card balance' }, [/gift card/i])).not.toBeNull();
    expect(BUILTIN_DENY.length).toBeGreaterThanOrEqual(12);
  });
});
