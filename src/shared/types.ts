// Core contracts shared by the page-side collectors, the orchestrator and the UI.

export type Severity = 'error' | 'warning' | 'info';
export type Category =
  | 'health'
  | 'media'
  | 'links'
  | 'content'
  | 'layout'
  | 'interaction'
  | 'a11y'
  | 'performance'
  | 'seo'
  | 'shopify'
  | 'newsletter'
  | 'cart'
  | 'safety';

export type ViewportName = 'desktop' | 'tablet' | 'mobile';

export interface ViewportDef {
  name: ViewportName;
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
}

export const VIEWPORTS: Record<ViewportName, ViewportDef> = {
  desktop: { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  tablet: { name: 'tablet', width: 768, height: 1024, dpr: 2, mobile: true },
  mobile: { name: 'mobile', width: 390, height: 844, dpr: 3, mobile: true },
};
export const VIEWPORT_ORDER: ViewportName[] = ['desktop', 'tablet', 'mobile'];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Finding {
  id: string;
  checkId: string;
  rule: string;
  severity: Severity;
  category: Category;
  title: string;
  message: string;
  url: string;
  viewport: string;
  selector?: string;
  htmlSnippet?: string;
  rect?: Rect;
  screenshotId?: string;
  hint?: string;
  meta?: Record<string, unknown>;
}

export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'errored';

export interface CheckResult {
  checkId: string;
  status: CheckStatus;
  findings: Finding[];
  skippedReason?: string;
  errorMessage?: string;
  /** Free-form detail, e.g. how many interaction triggers were exercised. */
  note?: string;
  durationMs: number;
}

export type CheckNeed = 'debugger' | 'productPage' | 'cartPage' | 'shopify';

export type GroupId =
  | 'health'
  | 'links'
  | 'basics'
  | 'media'
  | 'content'
  | 'layout'
  | 'interactions'
  | 'accessibility'
  | 'performance'
  | 'shopify'
  | 'custom'
  | 'newsletter'
  | 'cart'
  | 'visual';

/** Serializable data passed to page-side `collect`. */
export interface PageContext {
  viewport: ViewportName;
  options: PageOptions;
  /** Free-form per-check parameters (e.g. variant limit, custom rules). */
  params: Record<string, unknown>;
}

export interface PageOptions {
  strictTapTargets: boolean;
  maxLinks: number;
  checkExternalLinks: boolean;
  maxInteractions: number;
  skipSelectors: string[];
  denylistExtra: string[];
  searchQuery: string;
  variantsMax: number;
  showConsoleWarn: boolean;
}

export interface ThemeInfo {
  id?: number;
  name?: string;
  role?: string;
  schemaName?: string;
  schemaVersion?: string;
}

/** Context available to pure `analyze` functions. */
export interface RunContext {
  url: string;
  origin: string;
  viewport: ViewportName;
  options: AnalyzeOptions;
  /** Network failures observed through CDP, when the debugger is attached. */
  cdpNetwork?: NetFailure[];
  isShopify: boolean;
}

export interface AnalyzeOptions {
  ignoreConsole: string[];
  ignoreNetwork: string[];
  showConsoleWarn: boolean;
  strictTapTargets: boolean;
  thresholds: Thresholds;
  newsletterLevel: 1 | 2;
  newsletterEmail: string;
}

export interface Thresholds {
  lcp: [number, number];
  cls: [number, number];
  ttfb: [number, number];
  fcp: [number, number];
}

export interface NetFailure {
  url: string;
  status?: number;
  errorText?: string;
  type?: string;
  initiator?: string;
}

export interface Check<TData = unknown> {
  id: string;
  title: string;
  category: Category;
  group: GroupId;
  mutatesState: boolean;
  defaultEnabled: boolean;
  needs?: CheckNeed[];
  /** 'first' = only the first enabled viewport of a page; 'each' = every viewport. */
  viewportScope: 'first' | 'each';
  /** Runs page-side. Must return JSON-serializable data. */
  collect(ctx: PageContext): Promise<TData>;
  /** Pure: data in, findings out. */
  analyze(data: TData, ctx: RunContext): Finding[];
  /** What was verified when nothing failed (for the "Passed checks" list). */
  passedLabel?: string;
}

export type RunMode = 'quick' | 'pages' | 'full' | 'live';

export interface RunConfig {
  mode: RunMode;
  startUrl: string;
  origin: string;
  /** Pages mode: normalised list of absolute URLs. */
  pages?: string[];
  viewports: ViewportName[];
  groups: Record<GroupId, boolean>;
  options: Options;
}

export interface Options {
  preset: 'recommended' | 'all' | 'custom';
  groups: Record<GroupId, boolean>;
  viewportsMode: 'all' | 'choose';
  viewports: Record<ViewportName, boolean>;
  lastMode: RunMode;
  sample: {
    home: number;
    collections: number;
    products: number;
    pages: number;
    blog: number;
    article: number;
  };
  customPaths: string[];
  maxPages: number;
  concurrency: number;
  pageLoadTimeoutMs: number;
  pageBudgetMs: number;
  ignoreConsole: string[];
  ignoreNetwork: string[];
  skipSelectors: string[];
  denylistExtra: string[];
  thresholds: Thresholds;
  newsletterLevel: 1 | 2;
  newsletterEmail: string;
  customRules: string;
  keepQaWindow: boolean;
  screenshots: boolean;
  showConsoleWarn: boolean;
  strictTapTargets: boolean;
  checkExternalLinks: boolean;
  historySize: number;
  maxInteractions: number;
  maxLinks: number;
  searchQuery: string;
  variantsMax: number;
  confirmedNewsletterL2: boolean;
  confirmedCartActions: boolean;
  /** CHK-19: selectors whose regions are blanked out before diffing. */
  visualMask: string[];
  visualThresholdPct: number;
}

export type RunStatus = 'running' | 'finished' | 'cancelled' | 'interrupted';

export interface PageViewportResult {
  url: string;
  viewport: ViewportName;
  results: CheckResult[];
  theme?: ThemeInfo;
  isShopify: boolean;
  timedOut?: boolean;
  loadError?: string;
  durationMs: number;
}

export interface SkippedItem {
  what: string;
  reason: string;
}

export interface ScreenshotMeta {
  id: string;
  findingId: string;
  viewport: string;
  w: number;
  h: number;
}

export interface RunRecord {
  id: string;
  version: string;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  config: Omit<RunConfig, 'options'> & { optionsSnapshot: Partial<Options> };
  theme?: ThemeInfo;
  pages: string[];
  completed: PageViewportResult[];
  findings: Finding[];
  skipped: SkippedItem[];
  notes: string[];
  screenshotsDropped: number;
  screenshotIds: string[];
  /** Cart/newsletter side-effect reporting. */
  sideEffects: string[];
  progress?: { page: number; pages: number; label: string };
}
