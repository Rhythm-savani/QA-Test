import type { GroupId, Options, RunMode, ViewportName } from './types';
import { VIEWPORT_ORDER } from './types';

export const CORE_GROUPS: GroupId[] = [
  'health',
  'links',
  'basics',
  'media',
  'content',
  'layout',
  'interactions',
  'accessibility',
  'performance',
  'shopify',
  'custom',
];

export type GroupHeading = 'Page health' | 'Content and looks' | 'Behaviour' | 'Shopify and custom';

export const GROUP_META: Record<string, { label: string; desc: string; heading: GroupHeading }> = {
  health: { label: 'Health', desc: 'Console errors and failed requests', heading: 'Page health' },
  links: { label: 'Links', desc: 'Dead and malformed links', heading: 'Page health' },
  basics: { label: 'Page basics', desc: 'Title, headings, language, meta', heading: 'Page health' },
  media: {
    label: 'Media',
    desc: 'Broken, stretched and oversized images',
    heading: 'Content and looks',
  },
  content: {
    label: 'Content',
    desc: 'Liquid leftovers, empty sections, fonts',
    heading: 'Content and looks',
  },
  layout: {
    label: 'Layout',
    desc: 'Overflow, overlaps and tap targets',
    heading: 'Content and looks',
  },
  interactions: {
    label: 'Interactions',
    desc: 'Drawers, modals, tabs and carousels',
    heading: 'Behaviour',
  },
  accessibility: {
    label: 'Accessibility',
    desc: 'axe-core WCAG A and AA rules',
    heading: 'Behaviour',
  },
  performance: { label: 'Performance', desc: 'Indicative Core Web Vitals', heading: 'Behaviour' },
  shopify: {
    label: 'Shopify reads',
    desc: 'Variants, cart badge and search (read-only)',
    heading: 'Shopify and custom',
  },
  custom: {
    label: 'Custom rules',
    desc: 'Your own open-and-close rules',
    heading: 'Shopify and custom',
  },
};

export const ALL_GROUP_IDS: GroupId[] = [...CORE_GROUPS, 'newsletter', 'cart', 'visual'];

export function recommendedGroups(): Record<GroupId, boolean> {
  const g = {} as Record<GroupId, boolean>;
  for (const id of ALL_GROUP_IDS) g[id] = CORE_GROUPS.includes(id) && id !== 'custom';
  return g;
}

export function allGroups(): Record<GroupId, boolean> {
  const g = recommendedGroups();
  g.custom = true;
  return g;
}

export const DEFAULT_OPTIONS: Options = {
  preset: 'recommended',
  groups: recommendedGroups(),
  viewportsMode: 'all',
  viewports: { desktop: true, tablet: true, mobile: true },
  lastMode: 'quick',
  sample: { home: 1, collections: 3, products: 3, pages: 2, blog: 1, article: 1 },
  customPaths: [],
  maxPages: 25,
  concurrency: 1,
  pageLoadTimeoutMs: 30000,
  pageBudgetMs: 90000,
  ignoreConsole: [],
  ignoreNetwork: [],
  skipSelectors: [],
  denylistExtra: [],
  thresholds: { lcp: [2500, 4000], cls: [0.1, 0.25], ttfb: [800, 1800], fcp: [1800, 3000] },
  newsletterLevel: 1,
  newsletterEmail: '',
  customRules: '[]',
  keepQaWindow: false,
  screenshots: true,
  showConsoleWarn: false,
  strictTapTargets: false,
  checkExternalLinks: false,
  historySize: 20,
  maxInteractions: 40,
  maxLinks: 100,
  searchQuery: 'a',
  variantsMax: 8,
  confirmedNewsletterL2: false,
  confirmedCartActions: false,
  visualMask: ['video', 'iframe', 'slider-component', '[aria-roledescription=carousel]'],
  visualThresholdPct: 0.5,
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const num = (v: unknown, d: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const strList = (v: unknown, d: string[]) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : d;
const pair = (v: unknown, d: [number, number]): [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')
    ? [v[0] as number, v[1] as number]
    : d;

/** Merge arbitrary stored/imported data over the defaults, dropping anything malformed. */
export function sanitizeOptions(input: unknown): Options {
  const d = DEFAULT_OPTIONS;
  if (!isObj(input)) return structuredClone(d);
  const groups = recommendedGroups();
  if (isObj(input.groups)) {
    for (const id of ALL_GROUP_IDS) {
      const v = (input.groups as Record<string, unknown>)[id];
      if (typeof v === 'boolean') groups[id] = v;
    }
  }
  const vp = { ...d.viewports };
  if (isObj(input.viewports)) {
    for (const n of VIEWPORT_ORDER) {
      const v = (input.viewports as Record<string, unknown>)[n];
      if (typeof v === 'boolean') vp[n] = v;
    }
  }
  if (!VIEWPORT_ORDER.some((n) => vp[n])) Object.assign(vp, d.viewports); // at least one stays on
  const s = isObj(input.sample) ? input.sample : {};
  const th = isObj(input.thresholds) ? input.thresholds : {};
  const mode = input.lastMode;
  const preset = input.preset;
  return {
    preset:
      preset === 'all' || preset === 'custom' || preset === 'recommended' ? preset : 'recommended',
    groups,
    viewportsMode: input.viewportsMode === 'choose' ? 'choose' : 'all',
    viewports: vp,
    lastMode:
      mode === 'pages' || mode === 'full' || mode === 'live' || mode === 'quick' ? mode : 'quick',
    sample: {
      home: num(s.home, d.sample.home, 0, 5),
      collections: num(s.collections, d.sample.collections, 0, 20),
      products: num(s.products, d.sample.products, 0, 20),
      pages: num(s.pages, d.sample.pages, 0, 20),
      blog: num(s.blog, d.sample.blog, 0, 5),
      article: num(s.article, d.sample.article, 0, 10),
    },
    customPaths: strList(input.customPaths, []),
    maxPages: num(input.maxPages, d.maxPages, 1, 100),
    concurrency: num(input.concurrency, d.concurrency, 1, 3),
    pageLoadTimeoutMs: num(input.pageLoadTimeoutMs, d.pageLoadTimeoutMs, 5000, 120000),
    pageBudgetMs: num(input.pageBudgetMs, d.pageBudgetMs, 10000, 600000),
    ignoreConsole: strList(input.ignoreConsole, []),
    ignoreNetwork: strList(input.ignoreNetwork, []),
    skipSelectors: strList(input.skipSelectors, []),
    denylistExtra: strList(input.denylistExtra, []),
    thresholds: {
      lcp: pair(th.lcp, d.thresholds.lcp),
      cls: pair(th.cls, d.thresholds.cls),
      ttfb: pair(th.ttfb, d.thresholds.ttfb),
      fcp: pair(th.fcp, d.thresholds.fcp),
    },
    newsletterLevel: input.newsletterLevel === 2 ? 2 : 1,
    newsletterEmail: typeof input.newsletterEmail === 'string' ? input.newsletterEmail : '',
    customRules: typeof input.customRules === 'string' ? input.customRules : '[]',
    keepQaWindow: bool(input.keepQaWindow, d.keepQaWindow),
    screenshots: bool(input.screenshots, d.screenshots),
    showConsoleWarn: bool(input.showConsoleWarn, d.showConsoleWarn),
    strictTapTargets: bool(input.strictTapTargets, d.strictTapTargets),
    checkExternalLinks: bool(input.checkExternalLinks, d.checkExternalLinks),
    historySize: num(input.historySize, d.historySize, 1, 100),
    maxInteractions: num(input.maxInteractions, d.maxInteractions, 1, 200),
    maxLinks: num(input.maxLinks, d.maxLinks, 1, 500),
    searchQuery:
      typeof input.searchQuery === 'string' && input.searchQuery ? input.searchQuery : 'a',
    variantsMax: num(input.variantsMax, d.variantsMax, 1, 50),
    confirmedNewsletterL2: bool(input.confirmedNewsletterL2, false),
    confirmedCartActions: bool(input.confirmedCartActions, false),
    visualMask: strList(input.visualMask, d.visualMask),
    visualThresholdPct: num(input.visualThresholdPct, d.visualThresholdPct, 0, 100),
  };
}

export function enabledViewports(o: Options): ViewportName[] {
  const list = VIEWPORT_ORDER.filter((n) => o.viewports[n]);
  return list.length ? list : ['desktop'];
}

/** Presets: Custom is selected automatically whenever a single switch differs. */
export function detectPreset(groups: Record<GroupId, boolean>): Options['preset'] {
  const same = (a: Record<GroupId, boolean>) => CORE_GROUPS.every((id) => a[id] === groups[id]);
  if (same(recommendedGroups())) return 'recommended';
  if (same(allGroups())) return 'all';
  return 'custom';
}

export function countOn(groups: Record<GroupId, boolean>): number {
  return CORE_GROUPS.filter((g) => groups[g]).length;
}

export function modeLabel(m: RunMode): string {
  return { quick: 'Quick', pages: 'Pages', full: 'Full', live: 'Live tab' }[m];
}

// ---- custom rules (CHK-18) ----

export interface CustomRule {
  name: string;
  urlPattern: string;
  trigger: string;
  expectVisible: string;
  close?: string;
  closeExpectHidden?: string;
}

/** `selectorOk` lets callers inject DOM-based selector validation (unavailable in workers). */
export function validateCustomRules(
  text: string,
  selectorOk: (sel: string) => boolean = defaultSelectorOk,
): { rules: CustomRule[]; errors: string[] } {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text || '[]');
  } catch (e) {
    return { rules: [], errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  if (!Array.isArray(data))
    return { rules: [], errors: ['Top level must be a JSON array of rules.'] };
  const rules: CustomRule[] = [];
  data.forEach((r, i) => {
    const at = `Rule ${i + 1}`;
    const before = errors.length;
    if (!isObj(r)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    for (const k of ['name', 'urlPattern', 'trigger', 'expectVisible'] as const) {
      if (typeof r[k] !== 'string' || !(r[k] as string).trim())
        errors.push(`${at}: "${k}" is required (string).`);
    }
    for (const k of ['close', 'closeExpectHidden'] as const) {
      if (r[k] !== undefined && typeof r[k] !== 'string')
        errors.push(`${at}: "${k}" must be a string.`);
    }
    if (typeof r.urlPattern === 'string') {
      try {
        new RegExp(r.urlPattern);
      } catch {
        errors.push(`${at}: "urlPattern" is not a valid regular expression.`);
      }
    }
    for (const k of ['trigger', 'expectVisible', 'close', 'closeExpectHidden'] as const) {
      const v = r[k];
      if (typeof v === 'string' && v.trim() && !selectorOk(v))
        errors.push(`${at}: "${k}" is not a valid CSS selector.`);
    }
    if (errors.length === before) {
      rules.push({
        name: String(r.name),
        urlPattern: String(r.urlPattern),
        trigger: String(r.trigger),
        expectVisible: String(r.expectVisible),
        close: typeof r.close === 'string' && r.close ? r.close : undefined,
        closeExpectHidden:
          typeof r.closeExpectHidden === 'string' && r.closeExpectHidden
            ? r.closeExpectHidden
            : undefined,
      });
    }
  });
  return { rules, errors };
}

function defaultSelectorOk(sel: string): boolean {
  if (typeof document === 'undefined') return true;
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
}

export const CUSTOM_RULE_EXAMPLE = JSON.stringify(
  [
    {
      name: 'Wishlist drawer',
      urlPattern: '.*',
      trigger: '[data-wishlist-open]',
      expectVisible: '#wishlist-drawer',
      close: '#wishlist-drawer .drawer__close',
      closeExpectHidden: '#wishlist-drawer',
    },
    {
      name: 'Quote form modal',
      urlPattern: '^/products/',
      trigger: 'button.request-quote',
      expectVisible: 'dialog[open].quote-modal',
      close: 'dialog[open].quote-modal button[aria-label="Close"]',
    },
  ],
  null,
  2,
);

export function exportOptions(o: Options): string {
  return JSON.stringify({ storefrontQaOptions: 1, options: o }, null, 2);
}

export function importOptions(text: string): { options?: Options; error?: string } {
  try {
    const data = JSON.parse(text);
    const raw = isObj(data) && isObj(data.options) ? data.options : data;
    if (!isObj(raw)) return { error: 'File does not contain an options object.' };
    return { options: sanitizeOptions(raw) };
  } catch (e) {
    return { error: `Could not read file: ${(e as Error).message}` };
  }
}
