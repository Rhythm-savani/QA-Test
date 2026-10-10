// Single MAIN-world bundle injected into QA tabs at navigation commit. It installs the early
// instrumentation first, then exposes the page API the orchestrator calls via executeScript.
import { installInstrumentation } from './instrument';
import { CHECKS } from '../checks/registry';
import type { PageContext, Rect } from '../shared/types';
import type { IO } from '../engine/interactions';
import { DENY_ACTION, DENY_HREF } from '../engine/safety';
import { rectOf, selectorFor } from '../engine/dom';

interface RpcMsg {
  id: number;
  op: string;
  [k: string]: unknown;
}

const BINDING = '__sqaBinding';

function install() {
  const sqa = installInstrumentation();
  if ((sqa as { api?: boolean }).api) return;
  (sqa as { api?: boolean }).api = true;

  // ---- safety net inside the page (the orchestrator also blocks at network level) ----
  const flags = { allowCart: false, allowContact: false };
  (sqa as Record<string, unknown>).flags = flags;
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      let href = a.href;
      try {
        href = new URL(a.getAttribute('href') ?? '', location.href).href;
      } catch {
        // keep raw
      }
      if (/\/(checkouts?)(\/|\?|$)|\/account\/logout|\/cart\/c\//i.test(href)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        sqa.events.push({
          kind: 'console-warn',
          message: `[sqa] blocked click to ${href}`,
          t: performance.now(),
        });
      }
    },
    true,
  );
  document.addEventListener(
    'submit',
    (e) => {
      const f = e.target as HTMLFormElement;
      const action = f.getAttribute('action') ?? '';
      if (/\/(checkouts?)(\/|\?|$)|\/account\/logout/i.test(action)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (DENY_ACTION.test(action) || DENY_HREF.test(action)) {
        const cart = /\/cart\//.test(action);
        if ((cart && !flags.allowCart) || (!cart && !flags.allowContact)) e.preventDefault();
      }
    },
    true,
  );

  // ---- rpc over the CDP binding ----
  const pending = new Map<number, (v: unknown) => void>();
  let seq = 0;
  const rpc = (
    op: string,
    payload: Record<string, unknown> = {},
    timeout = 4000,
  ): Promise<unknown> => {
    const b = (window as unknown as Record<string, unknown>)[BINDING];
    if (typeof b !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      (b as (s: string) => void)(JSON.stringify({ id, op, ...payload } satisfies RpcMsg));
      setTimeout(() => {
        if (pending.delete(id)) resolve(null);
      }, timeout);
    });
  };
  sqa.rpcResolve = (id: number, value: unknown) => {
    const r = pending.get(id);
    if (r) {
      pending.delete(id);
      r(value);
    }
  };

  // ---- evidence overlay ----
  let overlay: HTMLElement | null = null;
  const mark = (rect: Rect | null, label = ''): Rect | null => {
    unmark();
    if (!rect) return null;
    const o = document.createElement('div');
    o.setAttribute('data-sqa-overlay', '');
    o.style.cssText = `position:absolute;left:${rect.x - 3}px;top:${rect.y - 3}px;width:${rect.w + 6}px;height:${rect.h + 6}px;border:3px solid #e5484d;box-shadow:0 0 0 2px #fff;border-radius:3px;pointer-events:none;z-index:2147483647;box-sizing:border-box;`;
    if (label) o.title = label;
    document.documentElement.appendChild(o);
    overlay = o;
    return rect;
  };
  const unmark = () => {
    overlay?.remove();
    overlay = null;
  };
  /** Scrolls the target into view, outlines it and returns the page-space clip to capture. */
  const prepareShot = (selector: string | null, rect: Rect | null, wholeViewport = false) => {
    unmark();
    if (wholeViewport) {
      let r: Rect | null = null;
      if (selector) {
        try {
          const el = document.querySelector(selector);
          if (el) {
            const rr = el.getBoundingClientRect();
            if (rr.width > 0 && rr.height > 0) r = rectOf(el);
          }
        } catch {
          r = null;
        }
      }
      if (r) mark(r);
      return {
        x: window.scrollX,
        y: window.scrollY,
        w: window.innerWidth,
        h: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      };
    }
    let target: Element | null = null;
    if (selector) {
      try {
        target = document.querySelector(selector);
      } catch {
        target = null;
      }
    }
    if (target) target.scrollIntoView({ block: 'center', inline: 'center' });
    let r: Rect | null = target ? rectOf(target) : rect;
    if (!r || r.w <= 0 || r.h <= 0) return null;
    if (!target) window.scrollTo(Math.max(0, r.x - 40), Math.max(0, r.y - 200));
    const pad = 100;
    mark(r);
    r = target ? rectOf(target) : r;
    const x = Math.max(0, r.x - pad);
    const y = Math.max(0, r.y - pad);
    return {
      x,
      y,
      w: Math.min(Math.max(r.w + pad * 2, 240), 1400),
      h: Math.min(Math.max(r.h + pad * 2, 160), 1000),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  };
  sqa.prepareShot = prepareShot;
  sqa.clearShot = unmark;

  // Input.dispatchMouseEvent works in visual-viewport space; when a mobile page is zoomed out to
  // fit overflowing content, layout coordinates must be mapped through the visual viewport.
  const toVisual = (x: number, y: number) => {
    const vv = window.visualViewport;
    if (!vv || (vv.scale === 1 && vv.offsetLeft === 0 && vv.offsetTop === 0)) return { x, y };
    return { x: (x - vv.offsetLeft) * vv.scale, y: (y - vv.offsetTop) * vv.scale };
  };

  // ---- IO for the interaction engine ----
  sqa.makeIO = (): IO => {
    const hasBinding =
      typeof (window as unknown as Record<string, unknown>)[BINDING] === 'function';
    const synthetic = (el: Element) => {
      const r = el.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        view: window,
      };
      el.dispatchEvent(new PointerEvent('pointerdown', init));
      el.dispatchEvent(new MouseEvent('mousedown', init));
      el.dispatchEvent(new PointerEvent('pointerup', init));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      (el as HTMLElement).click();
    };
    return {
      trusted: hasBinding,
      async click(el) {
        const r = el.getBoundingClientRect();
        if (hasBinding) {
          const ok = await rpc('click', toVisual(r.left + r.width / 2, r.top + r.height / 2));
          if (ok) return;
        }
        synthetic(el);
      },
      async clickPoint(x, y) {
        if (hasBinding && (await rpc('click', toVisual(x, y)))) return;
        document
          .elementFromPoint(x, y)
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      },
      async key(key) {
        if (hasBinding && (await rpc('key', { key }))) return;
        const t = document.activeElement ?? document.body;
        for (const type of ['keydown', 'keyup']) {
          t.dispatchEvent(
            new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }),
          );
        }
      },
      log(kind, data) {
        const b = (window as unknown as Record<string, unknown>)[BINDING];
        if (typeof b === 'function')
          (b as (s: string) => void)(JSON.stringify({ id: 0, op: 'log', kind, data }));
      },
      async shot(tag, el, opts) {
        if (!hasBinding) return;
        const sel = el && el.isConnected ? selectorFor(el) : null;
        const clip = prepareShot(sel, null, !!opts?.viewport);
        if (!clip) return;
        await rpc('shot', { tag, clip });
        unmark();
      },
    };
  };

  // ---- collectors ----
  sqa.runCollect = async (checkId: string, ctx: PageContext) => {
    const check = CHECKS.find((c) => c.id === checkId);
    if (!check) return { ok: false, error: `unknown check ${checkId}` };
    try {
      return { ok: true, data: await check.collect(ctx) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? `${e.message}` : String(e) };
    }
  };

  sqa.facts = () => {
    const w = window as unknown as { Shopify?: { theme?: Record<string, unknown> } };
    const t = w.Shopify?.theme;
    return {
      isShopify: !!w.Shopify,
      theme: t
        ? {
            id: typeof t.id === 'number' ? t.id : Number(t.id) || undefined,
            name: t.name as string | undefined,
            role: t.role as string | undefined,
            schemaName: t.schema_name as string | undefined,
            schemaVersion: t.schema_version as string | undefined,
          }
        : undefined,
      path: location.pathname,
      url: location.href,
      title: document.title,
      passwordPage:
        /^\/password\/?$/.test(location.pathname) ||
        !!document.querySelector('form[action$="/password"]'),
      readyState: document.readyState,
      hasProductForm: !!document.querySelector('product-form, form[action*="/cart/add"]'),
    };
  };

  sqa.settle = async (idleMs = 1000, capMs = 10000) => {
    const start = performance.now();
    let last = performance.getEntriesByType('resource').length;
    let lastChange = performance.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 100));
      const n = performance.getEntriesByType('resource').length;
      const now = performance.now();
      if (n !== last) {
        last = n;
        lastChange = now;
      }
      if (document.readyState === 'complete' && now - lastChange >= idleMs) return 'idle';
      if (now - start > capMs) return 'cap';
    }
  };

  sqa.scrollPass = async () => {
    const step = Math.max(200, Math.round(window.innerHeight * 0.8));
    let y = 0;
    for (let i = 0; i < 60; i++) {
      y += step;
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
      if (y >= document.documentElement.scrollHeight - window.innerHeight) break;
    }
    await new Promise((r) => setTimeout(r, 250));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 150));
  };

  sqa.setFlags = (f: { allowCart?: boolean; allowContact?: boolean }) => Object.assign(flags, f);
}

install();
