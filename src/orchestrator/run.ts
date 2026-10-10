// The run pipeline. It lives in the persistent report page (RUN-9): the MV3 service worker may be
// suspended at any time, an open extension tab may not. State is checkpointed after every page.
import type {
  Check,
  CheckResult,
  Finding,
  NetFailure,
  PageContext,
  PageOptions,
  PageViewportResult,
  RunConfig,
  RunContext,
  RunRecord,
  Severity,
  ThemeInfo,
  ViewportName,
} from '../shared/types';
import { VIEWPORTS } from '../shared/types';
import { CHECKS } from '../checks/registry';
import { isVisualFinding, makeFinding } from '../checks/rules';
import {
  classify,
  linksFromHtml,
  parseLocs,
  planPages,
  type PlannedPage,
} from '../shopify/sitemap';
import { validateCustomRules } from '../shared/options';
import { errMsg, sleep } from '../shared/util';
import { isCheckoutUrl, previewParamsOf, withPreviewParams } from '../shared/url';
import * as db from '../shared/db';
import { saveLastRun, type PendingRun } from '../shared/storage';
import { CdpSession, type RpcRequest } from './cdp';
import { installNetGuard, removeNetGuard } from './safety-net';
import type { IxRun, RawIx } from '../engine/interactions';
import { groupFindings } from '../report/grouping';
import { diffImages } from './visual';
import type { VisualData, VisualResult } from '../checks/chk19-visual-baseline';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0';

export interface RunEnv {
  onUpdate(run: RunRecord): void;
  isCancelled(): boolean;
}

const SCREENSHOT_CAP = 120;
const PER_RULE_CAP = 60;
const TEMP_SHOT_CAP = SCREENSHOT_CAP * 3;
const SEV_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

interface Tab {
  id: number;
  cdp: CdpSession | null;
}

// ---------- chrome helpers ----------

type G = typeof globalThis & { __sqa?: Record<string, (...a: unknown[]) => unknown> };

async function exec<T>(
  tabId: number,
  func: (...a: never[]) => unknown,
  args: unknown[] = [],
): Promise<T> {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: func as (...a: unknown[]) => unknown,
    args,
  });
  return res[0]?.result as T;
}

function navigate(
  tabId: number,
  url: string,
  timeoutMs: number,
): Promise<'ok' | 'error' | 'timeout'> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: 'ok' | 'error' | 'timeout') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.webNavigation.onCompleted.removeListener(onOk);
      chrome.webNavigation.onErrorOccurred.removeListener(onErr);
      resolve(v);
    };
    const onOk = (d: chrome.webNavigation.WebNavigationFramedCallbackDetails) => {
      if (d.tabId === tabId && d.frameId === 0) finish('ok');
    };
    const onErr = (d: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails) => {
      if (d.tabId === tabId && d.frameId === 0) finish('error');
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    chrome.webNavigation.onCompleted.addListener(onOk);
    chrome.webNavigation.onErrorOccurred.addListener(onErr);
    chrome.tabs.update(tabId, { url }).catch(() => finish('error'));
  });
}

async function hasPermission(perm: chrome.runtime.ManifestPermission): Promise<boolean> {
  try {
    return (await chrome.permissions.contains({ permissions: [perm] })) as boolean;
  } catch {
    return false;
  }
}

// ---------- evidence ----------

interface ShotClip {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function captureClip(
  cdp: CdpSession,
  clip: ShotClip,
  dpr: number,
): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const scale = Math.min(1, 800 / Math.max(1, clip.w * dpr));
    const r = await cdp.send<{ data: string }>('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 70,
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale },
    });
    return {
      dataUrl: 'data:image/jpeg;base64,' + r.data,
      w: Math.round(clip.w * scale * dpr),
      h: Math.round(clip.h * scale * dpr),
    };
  } catch {
    return null;
  }
}

// ---------- main entry ----------

export async function executeRun(pending: PendingRun, env: RunEnv): Promise<RunRecord> {
  const cfg = pending.config;
  const opts = cfg.options;
  const mode = cfg.mode;
  const live = mode === 'live';

  const run: RunRecord = {
    id: pending.id,
    version: VERSION,
    startedAt: Date.now(),
    status: 'running',
    config: {
      mode,
      startUrl: cfg.startUrl,
      origin: cfg.origin,
      pages: cfg.pages,
      viewports: cfg.viewports,
      groups: cfg.groups,
      optionsSnapshot: {
        sample: opts.sample,
        maxPages: opts.maxPages,
        concurrency: opts.concurrency,
        thresholds: opts.thresholds,
        strictTapTargets: opts.strictTapTargets,
        newsletterLevel: opts.newsletterLevel,
      },
    },
    pages: [],
    completed: [],
    findings: [],
    skipped: [],
    notes: [],
    screenshotsDropped: 0,
    screenshotIds: [],
    sideEffects: [],
  };
  const emit = () => env.onUpdate(run);
  const persist = async () => {
    await db.putRun(run).catch(() => undefined);
    emit();
  };

  const skip = (what: string, reason: string) => {
    if (!run.skipped.some((s) => s.what === what && s.reason === reason))
      run.skipped.push({ what, reason });
  };

  // ----- permissions & capabilities -----
  let debuggerOk = await hasPermission('debugger');
  if (!debuggerOk) {
    skip('Tablet and Mobile viewports', 'debugging permission not granted');
    skip('Evidence screenshots', 'debugging permission not granted');
    skip('Trusted click and keyboard input', 'debugging permission not granted');
  }
  let viewports: ViewportName[] = live ? ['desktop'] : [...cfg.viewports];
  if (!debuggerOk && !live) {
    viewports = viewports.filter((v) => v === 'desktop');
    if (viewports.length === 0) viewports = ['desktop'];
  }
  if (live) {
    run.notes.push(
      'Live tab mode analyses the page as it is now. Console and network events from before the run started cannot be captured, and interaction checks change the page state.',
    );
    const vp = VIEWPORTS.desktop;
    void vp;
  }

  // ----- the tabs we own -----
  const tabs: Tab[] = [];
  let qaWindowId: number | undefined;
  const cleanup: (() => Promise<void> | void)[] = [];
  const checkoutAttempts: string[] = [];
  const shotsForTag = new Map<string, string>(); // shotKey -> screenshot id
  const shotDone = new Set<string>(); // fingerprint|viewport
  let shotCount = 0;
  let pageSource: string | null = null;
  const linkCache: Record<string, number> = {};
  const themeSeen: ThemeInfo[] = [];
  let fatal: string | null = null;
  let planned: PlannedPage[] = [];
  const pendingShots = new Map<string, { dataUrl: string; w: number; h: number }>();
  const ixLog: { findings: RawIx[]; index: number } = { findings: [], index: 0 };

  try {
    // ----- plan pages -----
    const preview = previewParamsOf(cfg.startUrl);
    if (mode === 'quick' || live) planned = [{ url: cfg.startUrl, kind: classify(cfg.startUrl) }];
    else if (mode === 'pages') {
      planned = (cfg.pages ?? []).map((u) => ({ url: u, kind: classify(u) }));
    } else {
      planned = await discoverFull(cfg, preview, run);
    }
    run.pages = planned.map((p) => p.url);
    if (planned.length === 0) throw new Error('No pages to check.');
    await persist();

    // ----- open tabs -----
    const workerCount = live || mode !== 'full' ? 1 : Math.min(3, Math.max(1, opts.concurrency));
    if (live) {
      if (pending.liveTabId === undefined) throw new Error('No active tab to analyse.');
      tabs.push({ id: pending.liveTabId, cdp: null });
    } else {
      const win = await chrome.windows.create({
        url: 'about:blank',
        focused: false,
        type: 'normal',
      });
      if (!win) throw new Error('Could not open the QA window.');
      qaWindowId = win.id;
      const first = win.tabs?.[0]?.id;
      if (first === undefined) throw new Error('Could not open the QA window.');
      tabs.push({ id: first, cdp: null });
      for (let i = 1; i < workerCount; i++) {
        const t = await chrome.tabs.create({ windowId: win.id, url: 'about:blank', active: false });
        tabs.push({ id: t.id!, cdp: null });
      }
      cleanup.push(async () => {
        if (!opts.keepQaWindow && qaWindowId !== undefined) {
          await chrome.windows.remove(qaWindowId).catch(() => undefined);
        }
      });
    }

    // ----- debugger, early injection, safety net -----
    const injectSource = await fetch(chrome.runtime.getURL('inject/page.js')).then((r) => r.text());
    pageSource = injectSource;
    for (const tab of tabs) {
      if (debuggerOk) {
        try {
          const cdp = new CdpSession(tab.id);
          await cdp.attach();
          tab.cdp = cdp;
          if (!live) await cdp.injectEarly(injectSource);
          wireRpc(cdp);
        } catch (e) {
          debuggerOk = false;
          skip('Debugger features', `could not attach: ${errMsg(e)}`);
          tab.cdp = null;
        }
      }
    }
    const tabIds = tabs.map((t) => t.id);
    if (!live) {
      await installNetGuard(tabIds, {
        allowCartMutation: !!cfg.groups.cart && opts.confirmedCartActions,
        allowContactPost:
          !!cfg.groups.newsletter && opts.newsletterLevel === 2 && opts.confirmedNewsletterL2,
      });
      cleanup.push(removeNetGuard);
    }
    // Fallback injection at navigation commit for tabs without a debugger (RUN-4).
    const onCommitted = (d: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
      if (d.frameId !== 0 || !tabIds.includes(d.tabId) || live) return;
      chrome.scripting
        .executeScript({
          target: { tabId: d.tabId, frameIds: [0] },
          files: ['inject/page.js'],
          world: 'MAIN',
          injectImmediately: true,
        })
        .catch(() => undefined);
    };
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    cleanup.push(() => chrome.webNavigation.onCommitted.removeListener(onCommitted));
    // SAF-3: record any attempt to leave the safe zone.
    const onBefore = (d: { tabId: number; frameId: number; url: string }) => {
      if (d.frameId === 0 && tabIds.includes(d.tabId) && isCheckoutUrl(d.url))
        checkoutAttempts.push(d.url);
    };
    chrome.webNavigation.onBeforeNavigate.addListener(onBefore);
    cleanup.push(() => chrome.webNavigation.onBeforeNavigate.removeListener(onBefore));

    if (live) {
      const tab = tabs[0];
      if (!tab.cdp && debuggerOk === false) {
        // Live mode works without the debugger; late injection below.
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['inject/page.js'],
        world: 'MAIN',
      });
    }

    // ----- work queue -----
    let nextIdx = 0;
    const worker = async (tab: Tab) => {
      while (!env.isCancelled()) {
        const i = nextIdx++;
        if (i >= planned.length) return;
        const page = planned[i];
        await visitPage(tab, page, i);
        if (fatal) return;
      }
    };
    await Promise.all(tabs.map((t) => worker(t)));

    if (fatal) throw new Error(fatal);
    run.status = env.isCancelled() ? 'cancelled' : 'finished';
  } catch (e) {
    run.status = env.isCancelled() ? 'cancelled' : 'interrupted';
    run.notes.push(`Run stopped: ${errMsg(e)}`);
  } finally {
    for (const t of tabs) {
      if (t.cdp) {
        if (!live) await t.cdp.clearEmulation();
        await t.cdp.detach();
      }
    }
    for (const c of cleanup.reverse()) {
      try {
        await c();
      } catch {
        // best effort
      }
    }
  }

  // SAF-3 findings
  for (const url of [...new Set(checkoutAttempts)]) {
    run.findings.push(
      makeFinding(
        'SAF-3',
        { url, viewport: 'desktop' },
        {
          rule: 'safety/left-safe-zone',
          severity: 'warning',
          message: `A page tried to navigate to ${new URL(url).pathname}. The request was blocked and checkout was not visited.`,
          url,
        },
      ),
    );
  }
  await enforceScreenshotCap(run);
  run.finishedAt = Date.now();
  await persist();
  const g = groupFindings(run.findings);
  await saveLastRun(run.config.origin, {
    runId: run.id,
    at: run.finishedAt,
    errors: g.filter((x) => x.severity === 'error').length,
    warnings: g.filter((x) => x.severity === 'warning').length,
  }).catch(() => undefined);
  await db.pruneHistory(run.config.origin, opts.historySize).catch(() => undefined);
  emit();
  return run;

  // =====================================================================================
  // inner functions (closures over run state)
  // =====================================================================================

  function wireRpc(cdp: CdpSession) {
    cdp.rpcHandler = async (req: RpcRequest) => {
      switch (req.op) {
        case 'click':
          await cdp.mouseClick(Number(req.x), Number(req.y));
          return true;
        case 'move':
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: Number(req.x),
            y: Number(req.y),
          });
          return true;
        case 'key':
          await cdp.keyPress(req.key === 'Escape' ? 'Escape' : 'Escape');
          return true;
        case 'shot': {
          const tag = String(req.tag ?? '');
          if (shotCount >= TEMP_SHOT_CAP) return false;
          const clip = req.clip as ShotClip | undefined;
          if (!clip) return false;
          const dpr = await cdp.send<{ result: { value: number } }>('Runtime.evaluate', {
            expression: 'window.devicePixelRatio',
            returnByValue: true,
          });
          const img = await captureClip(cdp, clip, dpr.result.value || 1);
          if (!img) return false;
          const id = `${run.id}:s${++shotCount}`;
          shotsForTag.set(tag, id);
          pendingShots.set(id, img);
          return true;
        }
        case 'log': {
          if (req.kind === 'finding') ixLog.findings.push(req.data as RawIx);
          else if (req.kind === 'index') ixLog.index = Number(req.data);
          return null;
        }
        default:
          return null;
      }
    };
  }

  async function discoverFull(
    c: RunConfig,
    preview: Record<string, string>,
    r: RunRecord,
  ): Promise<PlannedPage[]> {
    const listed: string[] = [];
    const seenMaps = new Set<string>();
    const queue = [new URL('/sitemap.xml', c.origin).toString()];
    let fetched = 0;
    while (queue.length && fetched < 25) {
      const u = queue.shift()!;
      if (seenMaps.has(u)) continue;
      seenMaps.add(u);
      fetched++;
      try {
        await sleep(150); // SAF-7
        const res = await fetch(u, { credentials: 'same-origin' });
        if (res.status === 429) {
          r.notes.push(
            'The store answered 429 (rate limited) while reading the sitemap; backing off.',
          );
          await sleep(2000);
          continue;
        }
        if (!res.ok) continue;
        const { locs, isIndex } = parseLocs(await res.text());
        if (isIndex) {
          for (const l of locs) {
            // child sitemaps list the primary domain too: re-point them at the audited origin
            const child = new URL(l);
            queue.push(new URL(child.pathname + child.search, c.origin).toString());
          }
        } else listed.push(...locs);
      } catch {
        // sitemap unavailable: fall back below
      }
    }
    if (listed.length === 0) {
      try {
        const html = await fetch(
          withPreviewParams(new URL('/', c.origin).toString(), preview),
        ).then((x) => x.text());
        listed.push(...linksFromHtml(html, c.origin));
        r.notes.push('No sitemap was readable; pages were sampled from links on the home page.');
      } catch {
        r.notes.push('No sitemap was readable and the home page could not be fetched.');
      }
    }
    return planPages({
      listed,
      origin: c.origin,
      startUrl: c.startUrl,
      counts: c.options.sample,
      customPaths: c.options.customPaths,
      maxPages: c.options.maxPages,
      searchQuery: c.options.searchQuery,
    });
  }

  async function visitPage(tab: Tab, page: PlannedPage, pageIndex: number) {
    const vpList = viewports;
    for (let vi = 0; vi < vpList.length; vi++) {
      if (env.isCancelled()) return;
      const vpName = vpList[vi];
      run.progress = {
        page: pageIndex + 1,
        pages: planned.length,
        label: `${vpName} · ${new URL(page.url).pathname}`,
      };
      emit();
      const started = performance.now();
      let result: PageViewportResult;
      try {
        result = await visit(tab, page, vpName, vi === 0, pageIndex);
      } catch (e) {
        result = {
          url: page.url,
          viewport: vpName,
          results: [],
          isShopify: false,
          loadError: errMsg(e),
          durationMs: performance.now() - started,
        };
        run.findings.push(
          makeFinding(
            'RUN',
            { url: page.url, viewport: vpName },
            {
              rule: 'health/load-error',
              severity: 'error',
              message: `The page could not be checked: ${errMsg(e)}`,
              selector: 'page',
            },
          ),
        );
      }
      run.completed.push(result);
      await persist();
      if (fatal) return;
    }
  }

  async function visit(
    tab: Tab,
    page: PlannedPage,
    vpName: ViewportName,
    first: boolean,
    pageIndex: number,
  ): Promise<PageViewportResult> {
    const t0 = performance.now();
    const vp = VIEWPORTS[vpName];
    const url = page.url;
    const results: CheckResult[] = [];
    const findings: Finding[] = [];
    const budgetEnd = t0 + opts.pageBudgetMs;
    const cdp = tab.cdp;

    if (!live) {
      if (cdp) await cdp.emulate(vp);
      cdp?.resetCollected();
      const nav = await navigate(tab.id, url, opts.pageLoadTimeoutMs);
      if (nav !== 'ok') {
        const kind = nav === 'timeout' ? 'health/page-timeout' : 'health/load-error';
        findings.push(
          makeFinding(
            'RUN',
            { url, viewport: vpName },
            {
              rule: kind,
              severity: 'error',
              message:
                nav === 'timeout'
                  ? `Page did not finish loading within ${opts.pageLoadTimeoutMs / 1000}s`
                  : 'The page failed to load (network error)',
              selector: 'page',
            },
          ),
        );
        run.findings.push(...findings);
        return {
          url,
          viewport: vpName,
          results,
          isShopify: false,
          timedOut: nav === 'timeout',
          durationMs: performance.now() - t0,
        };
      }
    }
    // make sure the page API is present (covers the no-debugger path racing the commit hook)
    await ensureApi(tab.id);
    await exec(tab.id, (() => (window as unknown as G).__sqa!.settle!(1000, 10000)) as never).catch(
      () => undefined,
    );
    if (!live)
      await exec(tab.id, (() => (window as unknown as G).__sqa!.scrollPass!()) as never).catch(
        () => undefined,
      );

    const facts = (await exec<{
      isShopify: boolean;
      theme?: ThemeInfo;
      path: string;
      url: string;
      passwordPage: boolean;
    }>(tab.id, (() => (window as unknown as G).__sqa!.facts!()) as never)) ?? {
      isShopify: false,
      path: '',
      url,
      passwordPage: false,
    };

    if (facts.passwordPage && !/\/password/.test(url)) {
      fatal =
        'The storefront redirected to /password. Unlock it in your browser first, then run again.';
      return {
        url,
        viewport: vpName,
        results,
        isShopify: facts.isShopify,
        loadError: fatal,
        durationMs: performance.now() - t0,
      };
    }

    // ----- theme consistency (RUN-7) -----
    if (facts.theme?.id !== undefined) {
      if (!run.theme) {
        run.theme = facts.theme;
        themeSeen.push(facts.theme);
      }
      const wanted = Number(previewParamsOf(cfg.startUrl).preview_theme_id);
      const mismatch =
        (run.theme.id !== undefined && facts.theme.id !== run.theme.id) ||
        (Number.isFinite(wanted) && wanted > 0 && facts.theme.id !== wanted);
      if (mismatch) {
        findings.push(
          makeFinding(
            'RUN-7',
            { url, viewport: vpName },
            {
              rule: 'shopify/theme-changed',
              severity: 'error',
              message: `This page renders theme ${facts.theme.name ?? ''} (#${facts.theme.id}) but the run started on ${Number.isFinite(wanted) && wanted > 0 ? `preview theme #${wanted}` : `theme #${run.theme.id}`}`,
              selector: 'Shopify.theme',
              meta: { themeId: facts.theme.id },
            },
          ),
        );
      }
    }

    // ----- which checks run -----
    const customRules = validateCustomRules(opts.customRules).rules;
    const pageOpts: PageOptions = {
      strictTapTargets: opts.strictTapTargets,
      maxLinks: opts.maxLinks,
      checkExternalLinks: opts.checkExternalLinks,
      maxInteractions: opts.maxInteractions,
      skipSelectors: opts.skipSelectors,
      denylistExtra: opts.denylistExtra,
      searchQuery: opts.searchQuery,
      variantsMax: opts.variantsMax,
      showConsoleWarn: opts.showConsoleWarn,
    };
    const rctx: RunContext = {
      url,
      origin: cfg.origin,
      viewport: vpName,
      isShopify: facts.isShopify,
      options: {
        ignoreConsole: opts.ignoreConsole,
        ignoreNetwork: opts.ignoreNetwork,
        showConsoleWarn: opts.showConsoleWarn,
        strictTapTargets: opts.strictTapTargets,
        thresholds: opts.thresholds,
        newsletterLevel: opts.newsletterLevel,
        newsletterEmail: opts.newsletterEmail,
      },
    };
    const isProduct = /\/products\/[^/]+/.test(facts.path);
    const ordered = orderChecks(CHECKS);
    const todo: Check[] = [];
    for (const c of ordered) {
      const enabled =
        c.group === 'custom' ? cfg.groups.custom && customRules.length > 0 : !!cfg.groups[c.group];
      if (!enabled) continue;
      if (c.viewportScope === 'first' && !first) continue;
      const missing: string[] = [];
      if (c.needs?.includes('shopify') && !facts.isShopify)
        missing.push('not a Shopify storefront');
      if (c.needs?.includes('productPage') && !isProduct) missing.push('not a product page');
      if (c.needs?.includes('cartPage') && !/^\/cart/.test(facts.path))
        missing.push('not the cart page');
      if (c.needs?.includes('debugger') && !debuggerOk)
        missing.push('debugging permission not granted');
      if (
        c.id === 'CHK-16' &&
        opts.newsletterLevel === 2 &&
        (!opts.confirmedNewsletterL2 || !opts.newsletterEmail)
      ) {
        // Level 1 still runs; Level 2 needs confirmation and an address (handled via params)
      }
      if (missing.length) {
        results.push({
          checkId: c.id,
          status: 'skipped',
          findings: [],
          skippedReason: missing.join(', '),
          durationMs: 0,
        });
        continue;
      }
      if (live && c.id === 'CHK-09') {
        if (!run.notes.includes('interactions-live')) run.notes.push('interactions-live');
      }
      todo.push(c);
    }

    // CDP network failures for CHK-02 (the audited document status is separate)
    const takeNet = (): NetFailure[] => {
      const list = (cdp?.failures ?? []).filter(
        (f) => !(page.expect404 && f.type === 'Document' && f.status === 404),
      );
      return list;
    };

    const ixChecks = todo.filter((c) => c.id === 'CHK-09');
    const normal = todo.filter((c) => c.id !== 'CHK-09');
    const runOne = async (c: Check): Promise<void> => {
      if (env.isCancelled()) return;
      const cs = performance.now();
      if (cs > budgetEnd) {
        results.push({
          checkId: c.id,
          status: 'skipped',
          findings: [],
          skippedReason: 'page time budget exceeded',
          durationMs: 0,
        });
        return;
      }
      run.progress = {
        page: pageIndex + 1,
        pages: planned.length,
        label: `${c.title} · ${vpName} · ${new URL(url).pathname}`,
      };
      emit();
      const params: Record<string, unknown> = {};
      if (c.id === 'CHK-04') params.linkCache = linkCache;
      if (c.id === 'CHK-16') {
        params.newsletterLevel = opts.newsletterLevel;
        params.newsletterEmail = opts.newsletterEmail;
        params.newsletterConfirmed = opts.confirmedNewsletterL2;
      }
      if (c.id === 'CHK-17') params.cartConfirmed = opts.confirmedCartActions;
      if (c.id === 'CHK-18') params.customRules = customRules;
      if (c.id === 'CHK-19') params.maskSelectors = opts.visualMask;
      const pctx: PageContext = { viewport: vpName, options: pageOpts, params };
      // SAF-5: opt-in state-changing checks are bracketed by a cart snapshot and restore
      let cartBefore: CartSnap | null = null;
      if (c.id === 'CHK-17' && opts.confirmedCartActions) {
        await exec(
          tab.id,
          ((f: boolean) => (window as unknown as G).__sqa!.setFlags!({ allowCart: f })) as never,
          [true],
        ).catch(() => undefined);
        cartBefore = await cartSnapshot(tab.id);
      }
      if (c.id === 'CHK-16' && opts.newsletterLevel === 2 && opts.confirmedNewsletterL2) {
        await exec(
          tab.id,
          ((f: boolean) => (window as unknown as G).__sqa!.setFlags!({ allowContact: f })) as never,
          [true],
        ).catch(() => undefined);
      }
      let outcome: { ok: boolean; data?: unknown; error?: string };
      try {
        if (c.id === 'CHK-10') await ensureAxe(tab.id);
        outcome = await withTimeout(
          exec<{ ok: boolean; data?: unknown; error?: string }>(
            tab.id,
            ((id: string, ctx: unknown) =>
              (window as unknown as G).__sqa!.runCollect!(id, ctx)) as never,
            [c.id, pctx],
          ),
          Math.max(15000, Math.min(60000, budgetEnd - cs + 5000)),
        );
      } catch (e) {
        outcome = { ok: false, error: errMsg(e) };
      } finally {
        if (cartBefore) await restoreCart(tab.id, cartBefore);
      }
      if (
        c.id === 'CHK-16' &&
        opts.newsletterLevel === 2 &&
        opts.confirmedNewsletterL2 &&
        opts.newsletterEmail
      ) {
        const msg = `Newsletter test address ${opts.newsletterEmail} was submitted on ${new URL(url).pathname}. Remove it from the store's subscribers manually.`;
        if (!run.sideEffects.includes(msg)) run.sideEffects.push(msg);
      }
      if (!outcome || !outcome.ok) {
        results.push({
          checkId: c.id,
          status: 'errored',
          findings: [],
          errorMessage: outcome?.error ?? 'page navigated away during the check',
          durationMs: performance.now() - cs,
        });
        return;
      }
      if (c.id === 'CHK-17') {
        const d = outcome.data as {
          ran?: boolean;
          restored?: boolean;
          beforeCount?: number;
          finalCount?: number;
        };
        if (d.ran) {
          run.sideEffects.push(
            d.restored
              ? `Cart actions on ${new URL(url).pathname}: the cart ended exactly as it began (${d.beforeCount} item${d.beforeCount === 1 ? '' : 's'}).`
              : `Cart actions on ${new URL(url).pathname}: the cart did NOT return to its original state (expected ${d.beforeCount} items, found ${d.finalCount}). Check it manually.`,
          );
        }
      }
      let visualDiffId: string | undefined;
      if (c.id === 'CHK-19' && cdp) {
        const vd = outcome.data as VisualData;
        const res = await visualCompare(cdp, vd, vp.dpr, vpName);
        vd.result = res.result;
        visualDiffId = res.diffId;
      }
      if (c.id === 'CHK-04') {
        Object.assign(
          linkCache,
          (outcome.data as { statuses?: Record<string, number> }).statuses ?? {},
        );
      }
      try {
        const ctxForCheck: RunContext = {
          ...rctx,
          cdpNetwork: c.id === 'CHK-02' ? takeNet() : undefined,
        };
        const fs = c.analyze(outcome.data as never, ctxForCheck);
        if (visualDiffId)
          for (const f of fs) if (f.rule === 'visual/diff') f.screenshotId = visualDiffId;
        const status = fs.some((f) => f.severity !== 'info') ? 'failed' : 'passed';
        results.push({
          checkId: c.id,
          status: fs.length === 0 ? 'passed' : status,
          findings: fs,
          durationMs: performance.now() - cs,
        });
        findings.push(...fs);
      } catch (e) {
        results.push({
          checkId: c.id,
          status: 'errored',
          findings: [],
          errorMessage: `analyze failed: ${errMsg(e)}`,
          durationMs: performance.now() - cs,
        });
      }
    };

    for (const c of normal) {
      await runOne(c);
      if (c.mutatesState && !live && !env.isCancelled()) {
        // drawers or notices opened by the check must not leak into later checks
        await navigate(tab.id, url, opts.pageLoadTimeoutMs);
        await ensureApi(tab.id);
        await exec(tab.id, (() =>
          (window as unknown as G).__sqa!.settle!(800, 6000)) as never).catch(() => undefined);
      }
    }

    // document-level failure (e.g. a real 404/500 page that was not expected)
    if (
      cdp &&
      cdp.docStatus !== undefined &&
      cdp.docStatus >= 400 &&
      !(page.expect404 && cdp.docStatus === 404)
    ) {
      findings.push(
        makeFinding('CHK-02', rctx, {
          rule: 'health/network-failure',
          severity: 'error',
          message: `The page itself returned HTTP ${cdp.docStatus}`,
          selector: 'document',
        }),
      );
    }

    // ----- evidence for passive findings (before interactions change the page) -----
    if (cdp && debuggerOk) await captureEvidence(tab, cdp, findings, vpName, vp.dpr);

    // ----- interactions -----
    for (const c of ixChecks) {
      if (env.isCancelled()) break;
      const cs = performance.now();
      if (cs > budgetEnd) {
        results.push({
          checkId: c.id,
          status: 'skipped',
          findings: [],
          skippedReason: 'page time budget exceeded',
          durationMs: 0,
        });
        continue;
      }
      run.progress = {
        page: pageIndex + 1,
        pages: planned.length,
        label: `Interactions · ${vpName} · ${new URL(url).pathname}`,
      };
      emit();
      const merged: IxRun = {
        findings: [],
        needReload: false,
        nextIndex: 0,
        total: 0,
        tested: 0,
        capped: false,
        passed: [],
        skippedDenied: 0,
      };
      let start = 0;
      let errored: string | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        ixLog.findings = [];
        ixLog.index = start;
        const pctx: PageContext = {
          viewport: vpName,
          options: pageOpts,
          params: { startIndex: start, budgetMs: Math.max(5000, budgetEnd - performance.now()) },
        };
        let out: { ok: boolean; data?: IxRun; error?: string };
        try {
          out = await withTimeout(
            exec<{ ok: boolean; data?: IxRun; error?: string }>(
              tab.id,
              ((id: string, ctx: unknown) =>
                (window as unknown as G).__sqa!.runCollect!(id, ctx)) as never,
              [c.id, pctx],
            ),
            Math.max(20000, budgetEnd - performance.now() + 10000),
          );
        } catch (e) {
          out = { ok: false, error: errMsg(e) };
        }
        if (out && out.ok && out.data) {
          merged.findings.push(...out.data.findings);
          merged.total = Math.max(merged.total, out.data.total);
          merged.tested += out.data.tested;
          merged.capped = merged.capped || out.data.capped;
          merged.passed.push(...out.data.passed);
          merged.skippedDenied += out.data.skippedDenied;
          if (!out.data.needReload) break;
          start = out.data.nextIndex;
        } else {
          // navigation or crash mid-run: keep what the page logged, resume after the failing index
          merged.findings.push(...ixLog.findings);
          merged.tested += Math.max(0, ixLog.index - start + 1);
          start = ixLog.index + 1;
          errored = out?.error ?? 'page navigated away';
          if (start >= opts.maxInteractions) break;
        }
        // reload and continue with the next candidate
        const nav = await navigate(tab.id, url, opts.pageLoadTimeoutMs);
        if (nav !== 'ok') break;
        await ensureApi(tab.id);
        await exec(tab.id, (() =>
          (window as unknown as G).__sqa!.settle!(800, 6000)) as never).catch(() => undefined);
      }
      try {
        const fs = c.analyze(merged as never, rctx);
        for (const f of fs) {
          const key = (f.meta as { shotKey?: string } | undefined)?.shotKey;
          if (key && shotsForTag.has(key)) f.screenshotId = shotsForTag.get(key);
        }
        results.push({
          checkId: c.id,
          status: fs.some((f) => f.severity !== 'info') ? 'failed' : 'passed',
          findings: fs,
          durationMs: performance.now() - cs,
          errorMessage: errored && merged.tested === 0 ? errored : undefined,
          note: `Exercised ${merged.tested} of ${merged.total} triggers (${merged.skippedDenied} refused by the click denylist)`,
        });
        findings.push(...fs);
      } catch (e) {
        results.push({
          checkId: c.id,
          status: 'errored',
          findings: [],
          errorMessage: errMsg(e),
          durationMs: performance.now() - cs,
        });
      }
    }
    // persist interaction screenshots
    await flushPendingShots(findings, vpName);

    if (performance.now() > budgetEnd) {
      findings.push(
        makeFinding('RUN', rctx, {
          rule: 'health/page-timeout',
          severity: 'warning',
          message: `The page time budget of ${Math.round(opts.pageBudgetMs / 1000)}s was exceeded; remaining checks were skipped.`,
          selector: 'page',
        }),
      );
    }

    run.findings.push(...capPerRule(findings, rctx));
    const unlinked = new Set(findings.map((f) => f.id));
    void unlinked;
    return {
      url,
      viewport: vpName,
      results,
      theme: facts.theme,
      isShopify: facts.isShopify,
      durationMs: performance.now() - t0,
    };
  }

  /** CHK-19: capture the viewport, store it for "Save as baseline", and diff against the baseline. */
  async function visualCompare(
    cdp: CdpSession,
    data: VisualData,
    dpr: number,
    vpName: ViewportName,
  ): Promise<{ result: VisualResult; diffId?: string }> {
    try {
      const img = await captureClip(cdp, { x: 0, y: 0, w: data.cssWidth, h: data.cssHeight }, dpr);
      if (!img) return { result: { state: 'error', message: 'Could not capture the viewport.' } };
      const f = img.w / data.cssWidth;
      const origin = cfg.origin;
      await db.putBaseline({
        key: db.currentKey(run.id, origin, data.path, vpName),
        kind: 'cur',
        runId: run.id,
        origin,
        path: data.path,
        viewport: vpName,
        dataUrl: img.dataUrl,
        w: img.w,
        h: img.h,
        cssWidth: data.cssWidth,
        cssHeight: data.cssHeight,
        masks: data.masks,
        at: Date.now(),
      });
      const base = await db.getBaseline(db.baselineKey(origin, data.path, vpName));
      if (!base) return { result: { state: 'no-baseline' } };
      const out = await diffImages(base.dataUrl, img.dataUrl, [...base.masks, ...data.masks], f);
      if (out.sizeChanged) {
        return {
          result: {
            state: 'size-changed',
            message: `Baseline is ${base.w}x${base.h}px, this capture is ${img.w}x${img.h}px.`,
          },
        };
      }
      if (out.ratio * 100 <= opts.visualThresholdPct)
        return { result: { state: 'same', ratio: out.ratio } };
      let diffId: string | undefined;
      if (out.diffDataUrl) {
        diffId = `${run.id}:v${++shotCount}`;
        await db.putScreenshot({
          id: diffId,
          runId: run.id,
          findingId: 'visual',
          viewport: vpName,
          severity: 1,
          dataUrl: out.diffDataUrl,
          w: out.w,
          h: out.h,
        });
        run.screenshotIds.push(diffId);
      }
      return { result: { state: 'diff', ratio: out.ratio }, diffId };
    } catch (e) {
      return { result: { state: 'error', message: errMsg(e) } };
    }
  }

  async function ensureApi(tabId: number) {
    const has = await exec<boolean>(
      tabId,
      (() => !!(window as unknown as G).__sqa?.runCollect) as never,
    ).catch(() => false);
    if (has) return;
    await chrome.scripting
      .executeScript({ target: { tabId }, files: ['inject/page.js'], world: 'MAIN' })
      .catch(() => undefined);
    void pageSource;
  }

  async function ensureAxe(tabId: number) {
    const has = await exec<boolean>(
      tabId,
      (() => !!(window as unknown as { axe?: unknown }).axe) as never,
    ).catch(() => false);
    if (!has) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['inject/axe.js'],
        world: 'MAIN',
      });
    }
  }

  /** Screenshot every visual finding once per fingerprint and viewport (RPT-7). */
  async function captureEvidence(
    tab: Tab,
    cdp: CdpSession,
    findings: Finding[],
    vpName: ViewportName,
    dpr: number,
  ) {
    const seen = new Set<string>();
    const targets = findings
      .filter((f) => isVisualFinding(f) && !f.screenshotId)
      .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
    for (const f of targets) {
      const key = `${f.id}|${vpName}`;
      if (seen.has(key) || shotDone.has(key)) continue;
      if (shotCount >= TEMP_SHOT_CAP) break;
      if (!f.selector && !f.rect) continue;
      seen.add(key);
      try {
        const clip = await exec<ShotClip | null>(
          tab.id,
          ((sel: string | null, rect: unknown) =>
            (window as unknown as G).__sqa!.prepareShot!(sel, rect, false)) as never,
          [
            f.selector && !f.selector.includes('@') && !f.selector.includes(':truncated')
              ? f.selector
              : null,
            f.rect ?? null,
          ],
        );
        if (clip) {
          await sleep(60);
          const img = await captureClip(cdp, clip, dpr);
          if (img) {
            const id = `${run.id}:s${++shotCount}`;
            await db.putScreenshot({
              id,
              runId: run.id,
              findingId: f.id,
              viewport: vpName,
              severity: SEV_RANK[f.severity],
              dataUrl: img.dataUrl,
              w: img.w,
              h: img.h,
            });
            run.screenshotIds.push(id);
            shotDone.add(key);
            for (const g of findings) if (g.id === f.id) g.screenshotId = id;
          }
        }
      } catch {
        // evidence is best effort
      } finally {
        await exec(tab.id, (() => (window as unknown as G).__sqa!.clearShot!()) as never).catch(
          () => undefined,
        );
      }
    }
    await exec(tab.id, (() => window.scrollTo(0, 0)) as never).catch(() => undefined);
  }

  async function flushPendingShots(findings: Finding[], vpName: ViewportName) {
    for (const [id, img] of pendingShots) {
      const f = findings.find((x) => x.screenshotId === id);
      if (!f) continue;
      const key = `${f.id}|${vpName}`;
      if (shotDone.has(key)) continue;
      shotDone.add(key);
      await db.putScreenshot({
        id,
        runId: run.id,
        findingId: f.id,
        viewport: vpName,
        severity: SEV_RANK[f.severity],
        dataUrl: img.dataUrl,
        w: img.w,
        h: img.h,
      });
      run.screenshotIds.push(id);
    }
    pendingShots.clear();
    // findings whose screenshot was a duplicate (fingerprint already shot in this viewport) lose the link
    for (const f of findings) {
      if (f.screenshotId && !run.screenshotIds.includes(f.screenshotId)) f.screenshotId = undefined;
    }
  }
}

// ---------- helpers ----------

interface CartSnap {
  items: { key: string; quantity: number }[];
  count: number;
}

async function cartSnapshot(tabId: number): Promise<CartSnap | null> {
  try {
    return await exec<CartSnap | null>(tabId, (async () => {
      const r = await fetch('/cart.js', { credentials: 'same-origin' });
      if (!r.ok) return null;
      const c = await r.json();
      return {
        count: c.item_count as number,
        items: (c.items as { key: string; quantity: number }[]).map((i) => ({
          key: i.key,
          quantity: i.quantity,
        })),
      };
    }) as never);
  } catch {
    return null;
  }
}

/** SAF-5: put the cart back exactly as it was, whatever happened in between. */
async function restoreCart(tabId: number, before: CartSnap): Promise<void> {
  try {
    await exec(
      tabId,
      (async (snap: CartSnap) => {
        const r = await fetch('/cart.js', { credentials: 'same-origin' });
        if (!r.ok) return;
        const cart = (await r.json()) as { items: { key: string; quantity: number }[] };
        const was = new Map(snap.items.map((i) => [i.key, i.quantity]));
        for (const line of cart.items) {
          const target = was.get(line.key) ?? 0;
          if (line.quantity !== target) {
            await fetch('/cart/change.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: line.key, quantity: target }),
              credentials: 'same-origin',
            });
          }
        }
      }) as never,
      [before],
    );
  } catch {
    // best effort; the verification below reports whether it worked
  }
}

function orderChecks(list: Check[]): Check[] {
  const rank = (c: Check) =>
    c.id === 'CHK-08'
      ? 90
      : c.id === 'CHK-10'
        ? 80
        : c.mutatesState
          ? 95
          : c.id === 'CHK-09'
            ? 99
            : 10;
  return [...list].sort((a, b) => rank(a) - rank(b));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** RPT-7 cap: keep the most severe shots, report how many were dropped. */
async function enforceScreenshotCap(run: RunRecord): Promise<void> {
  const shots = await db.screenshotsForRun(run.id);
  if (shots.length <= SCREENSHOT_CAP) return;
  shots.sort((a, b) => a.severity - b.severity);
  const drop = shots.slice(SCREENSHOT_CAP);
  const dropIds = new Set(drop.map((s) => s.id));
  for (const s of drop) await db.deleteScreenshot(s.id);
  run.screenshotIds = run.screenshotIds.filter((id) => !dropIds.has(id));
  run.screenshotsDropped = drop.length;
  for (const f of run.findings)
    if (f.screenshotId && dropIds.has(f.screenshotId)) f.screenshotId = undefined;
}

/** NFR-2: no rule may flood a page; the report says how many were left out. */
function capPerRule(findings: Finding[], ctx: RunContext): Finding[] {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRule.get(f.rule) ?? [];
    list.push(f);
    byRule.set(f.rule, list);
  }
  const out: Finding[] = [];
  for (const [rule, list] of byRule) {
    if (list.length <= PER_RULE_CAP) {
      out.push(...list);
      continue;
    }
    out.push(...list.slice(0, PER_RULE_CAP));
    out.push(
      makeFinding('RUN', ctx, {
        rule,
        severity: 'info',
        title: 'Findings truncated',
        message: `Showing ${PER_RULE_CAP} of ${list.length} findings for ${rule} on this page`,
        selector: `cap:${rule}`,
      }),
    );
  }
  return out;
}
