// Interaction engine (CHK-09 / INT-1..5). Runs page-side; all trusted input and screenshots go
// through the injected `io` object so the engine stays testable and the orchestrator stays in
// charge of privileged calls.
import { accessibleName, inAny, isVisible, rectOf, selectorFor, snippetOf } from './dom';
import { compileExtra, denyReason } from './safety';
import type { Rect } from '../shared/types';

export interface IO {
  trusted: boolean;
  click(el: Element): Promise<void>;
  clickPoint(x: number, y: number): Promise<void>;
  key(key: 'Escape'): Promise<void>;
  /** Evidence screenshot; `viewport` captures the whole current viewport (state after failure). */
  shot(tag: string, el: Element | null, opts?: { viewport?: boolean }): Promise<void>;
  /** Fire-and-forget progress for the orchestrator, so partial results survive a navigation. */
  log?(kind: 'finding' | 'index', data: unknown): void;
}

export interface RawIx {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  selector?: string;
  htmlSnippet?: string;
  rect?: Rect;
  shotKey?: string;
  meta?: Record<string, unknown>;
}

export interface IxRun {
  findings: RawIx[];
  needReload: boolean;
  nextIndex: number;
  total: number;
  tested: number;
  capped: boolean;
  /** Human-readable list of what was exercised and passed (for the report). */
  passed: string[];
  skippedDenied: number;
}

export interface IxOptions {
  startIndex: number;
  max: number;
  skipSelectors: string[];
  denylistExtra: string[];
  deadline: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function until(fn: () => boolean, timeout = 1500, step = 50): Promise<boolean> {
  const t0 = performance.now();
  for (;;) {
    if (fn()) return true;
    if (performance.now() - t0 >= timeout) return false;
    await wait(step);
  }
}

const OPENISH =
  /\b(open|menu|search|cart|bag|filter|quick.?view|size.?guide|account|toggle|drawer|modal|navigation|nav|more|details|login|share|wishlist|gift|cookie|language|country|currency|sort)\b/i;
const CLOSE_NAME = /^(close|dismiss|cancel|×|✕|✖|x)\b|close|dismiss/i;
const LOCK_CLASSES =
  /(^|\s)(overflow-hidden|no-scroll|noscroll|scroll-lock|modal-open|js-drawer-open|lock-all|is-locked|body-locked|menu-open)(\s|$)/i;
const CAROUSEL_BTN =
  '.slider-button, [data-slider-next], [data-slider-prev], button[name=next], button[name=previous], [aria-label*="next" i], [aria-label*="previous" i], [aria-label*="prev" i]';
const CAROUSEL_ROOT =
  'slider-component, [class*=slider], [class*=carousel], [aria-roledescription=carousel]';
const BROAD =
  'dialog, [role=dialog], [role=alertdialog], [aria-modal], details, cart-drawer, [popover], [class*=drawer], [class*=modal], [class*=popup], [class*=overlay], [class*=menu], [class*=dropdown], [class*=panel], [class*=flyout], [class*=popover], [class*=search], [class*=accordion]';

function vpRect(el: Element) {
  return el.getBoundingClientRect();
}

function onScreen(el: Element): boolean {
  if (!isVisible(el)) return false;
  const r = vpRect(el);
  return r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
}

function broadSet(): Set<Element> {
  const out = new Set<Element>();
  const add = (el: Element | null) => {
    if (!el || out.has(el)) return;
    const r = vpRect(el);
    if (r.width >= 24 && r.height >= 24 && onScreen(el)) out.add(el);
  };
  for (const el of Array.from(document.querySelectorAll(BROAD))) add(el);
  for (const el of Array.from(document.querySelectorAll('[aria-controls]'))) {
    for (const id of (el.getAttribute('aria-controls') ?? '').split(/\s+/)) {
      if (id) add(document.getElementById(id));
    }
  }
  return out;
}

function lockState(): boolean {
  const h = getComputedStyle(document.documentElement);
  const b = getComputedStyle(document.body);
  const bad = (v: string) => v === 'hidden' || v === 'clip';
  return (
    bad(h.overflow) ||
    bad(h.overflowY) ||
    bad(b.overflow) ||
    bad(b.overflowY) ||
    b.position === 'fixed' ||
    LOCK_CLASSES.test(document.body.className) ||
    LOCK_CLASSES.test(document.documentElement.className)
  );
}

function expandedMap(): Map<Element, string> {
  const m = new Map<Element, string>();
  for (const el of Array.from(document.querySelectorAll('[aria-expanded]'))) {
    m.set(el, el.getAttribute('aria-expanded') ?? '');
  }
  return m;
}
function detailsOpen(): Set<Element> {
  return new Set(Array.from(document.querySelectorAll('details[open]')));
}

interface Snap {
  url: string;
  visible: Set<Element>;
  expanded: Map<Element, string>;
  details: Set<Element>;
  lock: boolean;
  classSig: string;
}

function snap(trigger: Element): Snap {
  const ctl = trigger.getAttribute('aria-controls');
  const target = ctl ? document.getElementById(ctl) : null;
  return {
    url: location.href,
    visible: broadSet(),
    expanded: expandedMap(),
    details: detailsOpen(),
    lock: lockState(),
    classSig: [
      trigger.className,
      trigger.parentElement?.className,
      document.body.className,
      document.documentElement.className,
      target?.className,
      trigger.closest('details')?.hasAttribute('open'),
    ].join('|'),
  };
}

function differs(a: Snap, b: Snap): boolean {
  if (a.classSig !== b.classSig || a.lock !== b.lock) return true;
  if (a.visible.size !== b.visible.size) return true;
  for (const e of b.visible) if (!a.visible.has(e)) return true;
  for (const e of a.visible) if (!b.visible.has(e)) return true;
  if (a.details.size !== b.details.size) return true;
  for (const [el, v] of b.expanded) if (a.expanded.get(el) !== v) return true;
  return false;
}

function looksRestored(base: Snap, now: Snap): boolean {
  if (now.lock !== base.lock) return false;
  for (const e of now.visible) if (!base.visible.has(e)) return false;
  for (const [el, v] of base.expanded) if (now.expanded.get(el) !== v) return false;
  return now.details.size === base.details.size;
}

function outermost(list: Element[]): Element[] {
  return list.filter((e) => !list.some((o) => o !== e && o.contains(e)));
}

function isOverlay(el: Element): boolean {
  if (el.tagName === 'DIALOG') return true;
  const role = el.getAttribute('role');
  if (role === 'dialog' || role === 'alertdialog' || el.getAttribute('aria-modal') === 'true')
    return true;
  const cs = getComputedStyle(el);
  const r = vpRect(el);
  if (cs.position === 'fixed' && r.width * r.height > window.innerWidth * window.innerHeight * 0.2)
    return true;
  for (let p: Element | null = el, i = 0; p && i < 3; p = p.parentElement, i++) {
    if (/drawer|modal|popup|dialog|overlay/i.test(p.className?.toString() ?? '')) return true;
    if (/cart-drawer|details-modal|header-drawer/i.test(p.tagName)) return true;
  }
  return false;
}

function closeControls(container: Element, trigger: Element): Element[] {
  const found: Element[] = [];
  const sel = 'button, [role=button], a, summary, [data-close], [class*=close]';
  for (const el of Array.from(container.querySelectorAll(sel))) {
    if (el === trigger) continue;
    if (!isVisible(el)) continue;
    const name = accessibleName(el).trim();
    const cls = el.className?.toString() ?? '';
    const explicit =
      /modal__close|drawer__close|close-button|[_-]close\b|\bclose\b/i.test(cls) ||
      el.hasAttribute('data-close');
    if (explicit || CLOSE_NAME.test(name)) found.push(el);
  }
  const result = outermost(found);
  if (result.length === 0) {
    // disclosure patterns toggle themselves: <details><summary>, or the aria-expanded trigger
    if (container.tagName === 'DETAILS') {
      const s = container.querySelector(':scope > summary');
      if (s) result.push(s);
    } else if (trigger.hasAttribute('aria-expanded') || trigger.tagName === 'SUMMARY') {
      result.push(trigger);
    }
  }
  return result.slice(0, 3);
}

export function discoverCandidates(opts: Pick<IxOptions, 'skipSelectors' | 'denylistExtra'>) {
  const extra = compileExtra(opts.denylistExtra);
  const out: { el: Element; kind: 'disclosure' | 'tab' | 'carousel'; classified: boolean }[] = [];
  let denied = 0;
  const seen = new Set<Element>();
  const consider = (el: Element, kind: 'disclosure' | 'tab' | 'carousel', classified: boolean) => {
    if (seen.has(el)) return;
    seen.add(el);
    if (!isVisible(el) || (el as HTMLButtonElement).disabled) return;
    if (el.getAttribute('aria-disabled') === 'true') return;
    if (inAny(el, opts.skipSelectors)) return;
    if (el.closest('[inert]')) return;
    // submit buttons navigate or post; only explicit disclosure widgets inside forms are fair game
    if (
      el.matches('button, input') &&
      (el as HTMLButtonElement).type === 'submit' &&
      el.closest('form') &&
      !el.hasAttribute('aria-expanded') &&
      !el.hasAttribute('aria-controls') &&
      !el.hasAttribute('aria-haspopup')
    ) {
      return;
    }
    const name = accessibleName(el);
    if (kind === 'disclosure' && CLOSE_NAME.test(name) && !el.hasAttribute('aria-expanded')) return;
    if (denyReason(el, extra)) {
      denied++;
      return;
    }
    // real links navigate; only JS-intercepted ones (cart icon with a cart drawer) are fair game
    if (
      el.tagName === 'A' &&
      el.getAttribute('href') &&
      !/^#/.test(el.getAttribute('href') ?? '')
    ) {
      const isCartIcon =
        el.matches('#cart-icon-bubble, [data-cart-icon]') &&
        !!document.querySelector('cart-drawer');
      if (!isCartIcon) return;
    }
    out.push({ el, kind, classified });
  };
  for (const el of Array.from(document.querySelectorAll(CAROUSEL_BTN))) {
    if (el.parentElement?.closest(CAROUSEL_ROOT)) consider(el, 'carousel', true);
  }
  for (const el of Array.from(document.querySelectorAll('[role=tab]'))) consider(el, 'tab', true);
  const strong =
    'summary, [aria-expanded], [aria-controls], [aria-haspopup], [data-modal], [data-drawer], [data-open], [data-toggle], #cart-icon-bubble';
  for (const el of Array.from(document.querySelectorAll(strong))) {
    if (el.matches('[role=tab]') || el.matches(CAROUSEL_BTN)) continue;
    consider(el, 'disclosure', true);
  }
  for (const el of Array.from(document.querySelectorAll('button, [role=button]'))) {
    if (el.matches('[role=tab]') || el.matches(CAROUSEL_BTN)) continue;
    const label = accessibleName(el) + ' ' + (el.className?.toString() ?? '');
    if (OPENISH.test(label)) consider(el, 'disclosure', false);
  }
  // drop elements nested inside another candidate (e.g. icon inside the button)
  const els = out.map((o) => o.el);
  const filtered = out.filter((o) => !els.some((e) => e !== o.el && e.contains(o.el)));
  return { candidates: filtered, denied };
}

export async function runInteractions(opts: IxOptions, io: IO): Promise<IxRun> {
  const run: IxRun = {
    findings: [],
    needReload: false,
    nextIndex: opts.startIndex,
    total: 0,
    tested: 0,
    capped: false,
    passed: [],
    skippedDenied: 0,
  };
  const { candidates, denied } = discoverCandidates(opts);
  run.skippedDenied = denied;
  const list = candidates.slice(0, opts.max);
  run.total = list.length;
  run.capped = candidates.length > opts.max;
  const startUrl = location.href;
  let n = 0;

  const rep = async (
    rule: string,
    severity: RawIx['severity'],
    message: string,
    el: Element | null,
    visualShot: boolean,
    meta?: Record<string, unknown>,
    viewport = true,
  ) => {
    const f: RawIx = {
      rule,
      severity,
      message,
      selector: el ? selectorFor(el) : undefined,
      htmlSnippet: el ? snippetOf(el) : undefined,
      rect: el && isVisible(el) ? rectOf(el) : undefined,
      meta,
    };
    if (visualShot) {
      f.shotKey = `${rule}|${f.selector ?? ''}|${++n}`;
      await io.shot(f.shotKey, el, { viewport });
    }
    run.findings.push(f);
    io.log?.('finding', f);
  };

  for (let i = opts.startIndex; i < list.length; i++) {
    run.nextIndex = i + 1;
    io.log?.('index', i);
    if (performance.now() > opts.deadline) {
      run.capped = true;
      break;
    }
    const cand = list[i];
    const el = cand.el;
    if (!el.isConnected || !isVisible(el)) continue;
    try {
      const ok =
        cand.kind === 'carousel'
          ? await testCarousel(el, io, rep)
          : cand.kind === 'tab'
            ? await testTab(el, io, rep)
            : await testDisclosure(el, cand.classified, io, rep);
      run.tested++;
      if (ok === 'reload') {
        run.needReload = true;
        break;
      }
      if (ok === 'passed')
        run.passed.push(`${cand.kind}: ${accessibleName(el).slice(0, 40) || selectorFor(el)}`);
    } catch (e) {
      run.findings.push({
        rule: 'interaction/trigger-no-effect',
        severity: 'info',
        message: `Interaction test crashed: ${(e as Error).message}`,
        selector: selectorFor(el),
        meta: { crashed: true },
      });
    }
    // SAF-4: unexpected navigation (pushState/hash). Full navigations destroy this context.
    if (location.href !== startUrl) {
      await rep(
        'interaction/unexpected-navigation',
        'warning',
        `Interaction changed the URL to ${location.href}`,
        el,
        false,
      );
      history.replaceState(history.state, '', startUrl);
    }
  }
  return run;
}

type Rep = (
  rule: string,
  severity: RawIx['severity'],
  message: string,
  el: Element | null,
  visualShot: boolean,
  meta?: Record<string, unknown>,
  viewport?: boolean,
) => Promise<void>;

type Outcome = 'passed' | 'issues' | 'reload' | 'nothing';

async function restore(trigger: Element, base: Snap, io: IO): Promise<boolean> {
  if (looksRestored(base, snap(trigger))) return true;
  await io.key('Escape');
  await wait(250);
  if (looksRestored(base, snap(trigger))) return true;
  // toggle the trigger once more
  if (trigger.isConnected && isVisible(trigger)) {
    await io.click(trigger);
    await wait(350);
  }
  return looksRestored(base, snap(trigger));
}

async function testDisclosure(
  trigger: Element,
  classified: boolean,
  io: IO,
  rep: Rep,
): Promise<Outcome> {
  trigger.scrollIntoView({ block: 'center', inline: 'nearest' });
  await wait(30);
  const base = snap(trigger);
  const focusBefore = document.activeElement;
  await io.click(trigger);
  const changed = await until(() => differs(base, snap(trigger)), 1500);
  if (!changed) {
    await rep(
      'interaction/trigger-no-effect',
      classified ? 'warning' : 'info',
      `Clicking "${accessibleName(trigger).slice(0, 50) || selectorFor(trigger)}" produced no observable change`,
      trigger,
      true,
    );
    return 'issues';
  }
  await wait(350); // let transitions finish
  const after = snap(trigger);
  const ctl = trigger.getAttribute('aria-controls');
  const ctlEl = ctl ? document.getElementById(ctl) : null;
  let container: Element | null = null;
  if (ctlEl && onScreen(ctlEl) && !base.visible.has(ctlEl)) container = ctlEl;
  const det = trigger.closest('details');
  if (!container && det && det.hasAttribute('open') && !base.details.has(det)) container = det;
  if (!container) {
    const fresh = outermost([...after.visible].filter((e) => !base.visible.has(e)));
    container =
      fresh.sort(
        (a, b) => vpRect(b).width * vpRect(b).height - vpRect(a).width * vpRect(a).height,
      )[0] ?? null;
  }
  if (!container) {
    // state changed but nothing we can classify: put it back and move on
    return (await restore(trigger, base, io)) ? 'nothing' : 'reload';
  }
  const overlay = isOverlay(container);
  const tName = accessibleName(trigger).slice(0, 40) || selectorFor(trigger);
  let issues = 0;
  const box = container;
  const isClosed = () => (box.tagName === 'DETAILS' ? !box.hasAttribute('open') : !onScreen(box));
  const reopen = async (): Promise<boolean> => {
    if (!isClosed()) return true;
    await io.click(trigger);
    const ok = await until(() => !isClosed(), 1500);
    if (ok) await wait(300);
    return ok;
  };

  // focus moved into the dialog (Info)
  if (overlay && io.trusted) {
    const active = document.activeElement;
    if (
      active === document.body ||
      (active && !container.contains(active) && active === focusBefore)
    ) {
      await rep(
        'interaction/focus-not-moved',
        'info',
        `Focus did not move into the dialog opened by "${tName}"`,
        container,
        false,
      );
    }
  }

  // --- close controls ---
  const closers = closeControls(container, trigger);
  let closedOnce = false;
  for (let c = 0; c < closers.length; c++) {
    if (c > 0 && !(await reopen())) break;
    const ctrl = closers[c];
    if (!ctrl.isConnected || !isVisible(ctrl)) continue;
    const r = vpRect(ctrl);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const covered = !!top && top !== ctrl && !ctrl.contains(top) && !top.contains(ctrl);
    if (covered) {
      issues++;
      await rep(
        'interaction/close-obscured',
        'error',
        `The close control "${accessibleName(ctrl).slice(0, 40) || selectorFor(ctrl)}" of "${tName}" is covered by ${selectorFor(top!)}`,
        ctrl,
        true,
        { coveredBy: snippetOf(top!, 140) },
      );
      // close it programmatically so the rest of the run starts from a clean page
      (ctrl as HTMLElement).click();
      await until(isClosed, 1000);
      continue;
    }
    await io.click(ctrl);
    const closed = await until(isClosed, 1500);
    if (!closed) {
      issues++;
      await rep(
        'interaction/close-no-effect',
        'error',
        `Clicking "${accessibleName(ctrl).slice(0, 40) || selectorFor(ctrl)}" did not close what "${tName}" opened`,
        ctrl,
        true,
      );
      await io.key('Escape');
      await until(isClosed, 800);
      continue;
    }
    closedOnce = true;
    await wait(300);
    if (overlay && lockState() && !base.lock) {
      issues++;
      await rep(
        'interaction/scroll-lock-stuck',
        'error',
        `Page scroll stays locked after closing "${tName}"`,
        document.body,
        true,
        {
          bodyClass: document.body.className,
        },
      );
    }
    if (
      c === 0 &&
      overlay &&
      io.trusted &&
      document.activeElement !== trigger &&
      trigger.isConnected
    ) {
      await rep(
        'interaction/focus-not-returned',
        'info',
        `Focus did not return to "${tName}" after closing`,
        trigger,
        false,
      );
    }
  }

  // --- Escape (overlay patterns only) ---
  if (overlay && (io.trusted || container.tagName !== 'DIALOG') && (await reopen())) {
    await io.key('Escape');
    const closed = await until(isClosed, 1500);
    if (!closed) {
      issues++;
      await rep(
        'interaction/escape-not-closing',
        'warning',
        `Pressing Escape does not close what "${tName}" opened`,
        container,
        true,
      );
      const cc = closeControls(container, trigger)[0];
      if (cc) await io.click(cc);
      await until(isClosed, 1000);
    } else if (lockState() && !base.lock && closedOnce) {
      // already reported above for the explicit close path
    }
  }

  // --- backdrop (modal/drawer overlay) ---
  if (overlay && (await reopen())) {
    const panel =
      container.querySelector(
        '[role=dialog], [aria-modal=true], dialog, [class*=drawer__inner], [class*=modal__content], [class*=panel]',
      ) ?? container;
    const r = vpRect(panel);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const candidates: [number, number][] = [
      [r.left / 2, vh / 2],
      [(r.right + vw) / 2, vh / 2],
      [vw / 2, r.top / 2],
      [vw / 2, (r.bottom + vh) / 2],
    ];
    // A backdrop is the container itself or a non-panel descendant, or an overlay-looking sibling.
    const pt = candidates.find(([x, y]) => {
      if (x < 2 || y < 2 || x > vw - 2 || y > vh - 2) return false;
      const t = document.elementFromPoint(x, y);
      if (!t || t === document.body || t === document.documentElement || panel.contains(t))
        return false;
      if (t === container || container.contains(t)) return true;
      return /overlay|backdrop|mask/i.test(t.className?.toString() ?? '');
    });
    if (pt) {
      await io.clickPoint(pt[0], pt[1]);
      const closed = await until(isClosed, 1200);
      if (!closed) {
        await rep(
          'interaction/backdrop-not-closing',
          'info',
          `Clicking the backdrop does not close what "${tName}" opened`,
          container,
          false,
        );
        await io.key('Escape');
        await until(isClosed, 800);
      }
    }
  }

  const ok = await restore(trigger, base, io);
  if (!ok) {
    // last resort for stuck states: fall through to a reload by the driver
    return 'reload';
  }
  return issues === 0 ? 'passed' : 'issues';
}

function carouselSig(root: Element): string {
  const parts: string[] = [];
  const els = [root, ...Array.from(root.querySelectorAll('*')).slice(0, 120)];
  for (const el of els) {
    const h = el as HTMLElement;
    if (h.scrollLeft) parts.push(`s${Math.round(h.scrollLeft)}`);
    const tr = getComputedStyle(el).transform;
    if (tr && tr !== 'none') parts.push(tr);
    const cur = el.getAttribute('aria-current');
    if (cur) parts.push(`c${cur}`);
    if (/active|current|selected/i.test(el.className?.toString() ?? ''))
      parts.push('a:' + el.className);
  }
  return parts.join('|');
}

async function testCarousel(btn: Element, io: IO, rep: Rep): Promise<Outcome> {
  const root =
    btn.parentElement?.closest('slider-component, [aria-roledescription=carousel]') ??
    btn.parentElement?.closest(CAROUSEL_ROOT) ??
    btn.parentElement ??
    document.body;
  btn.scrollIntoView({ block: 'center' });
  const name = accessibleName(btn).slice(0, 30) || selectorFor(btn);
  const before = carouselSig(root);
  const disabled = () =>
    (btn as HTMLButtonElement).disabled || btn.getAttribute('aria-disabled') === 'true';
  if (disabled()) return 'nothing';
  await io.click(btn);
  const moved = await until(() => carouselSig(root) !== before, 1000);
  if (!moved) {
    if (disabled()) return 'nothing'; // reached the end
    await rep(
      'interaction/carousel-no-effect',
      'warning',
      `Carousel control "${name}" does not move the slider`,
      btn,
      true,
    );
    return 'issues';
  }
  // restore with the opposite control when there is one
  const opposite = Array.from(root.querySelectorAll(CAROUSEL_BTN)).find((b) => b !== btn);
  if (opposite && isVisible(opposite) && !(opposite as HTMLButtonElement).disabled) {
    await wait(350);
    await io.click(opposite);
    await wait(500);
  }
  return 'passed';
}

async function testTab(tab: Element, io: IO, rep: Rep): Promise<Outcome> {
  const list = tab.closest('[role=tablist]');
  const tabs = list ? Array.from(list.querySelectorAll('[role=tab]')) : [tab];
  const original = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
  if (original === tab) return 'nothing';
  tab.scrollIntoView({ block: 'center' });
  await io.click(tab);
  await wait(350);
  const panelOf = (t: Element) => {
    const id = t.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  };
  const panel = panelOf(tab);
  const selected = tab.getAttribute('aria-selected') === 'true';
  const panelShown = !panel || (isVisible(panel) && !panel.hasAttribute('hidden'));
  const othersHidden = tabs
    .filter((t) => t !== tab)
    .every((t) => {
      const p = panelOf(t);
      return !p || !isVisible(p);
    });
  let ok: Outcome = 'passed';
  if (!selected || !panelShown || !othersHidden) {
    await rep(
      'interaction/tab-panel-mismatch',
      'warning',
      `Activating tab "${accessibleName(tab).slice(0, 30)}" ${!selected ? 'did not select it' : !panelShown ? 'did not show its panel' : 'left other panels visible'}`,
      tab,
      true,
    );
    ok = 'issues';
  }
  if (original && original.isConnected) {
    await io.click(original);
    await wait(250);
  }
  return ok;
}
