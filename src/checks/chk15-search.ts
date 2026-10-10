import type { Check, Finding, RunContext } from '../shared/types';
import { isVisible } from '../engine/dom';
import { makeFinding } from './rules';

type Data = {
  uiFound: boolean;
  panelShown: boolean;
  consoleErrors: string[];
  pageStatus: number;
  pageHasResultsOrEmpty: boolean;
  query: string;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const chk15: Check<Data> = {
  id: 'CHK-15',
  title: 'Search',
  category: 'shopify',
  group: 'shopify',
  mutatesState: false,
  defaultEnabled: true,
  needs: ['shopify'],
  viewportScope: 'first',
  passedLabel: 'Search UI and /search render without errors',
  async collect(ctx) {
    const query = String(ctx.options.searchQuery || 'a');
    const errBefore = window.__sqa?.events.length ?? 0;
    let uiFound = false;
    let panelShown = false;
    // The search toggle is a plain disclosure; never touch anything that submits a form.
    const toggle = document.querySelector<HTMLElement>(
      'summary.header__icon--search, details-modal.header__search summary, button[aria-label*="search" i]:not([type=submit])',
    );
    const input = (): HTMLInputElement | null =>
      Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type=search], input[name=q]'),
      ).find((i) => isVisible(i)) ?? null;
    if (toggle) {
      if (!input()) toggle.click();
      await wait(450);
    }
    const inp = input();
    if (inp) {
      uiFound = true;
      const before = inp.value;
      inp.focus();
      inp.value = query;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 25 && !panelShown; i++) {
        await wait(120);
        panelShown =
          !!document.querySelector(
            '[id^="predictive-search-results"], predictive-search [role=listbox], .predictive-search',
          ) &&
          Array.from(
            document.querySelectorAll(
              '[id^="predictive-search-results"], predictive-search .predictive-search, .predictive-search',
            ),
          ).some((e) => isVisible(e) && (e.textContent ?? '').trim().length > 0);
      }
      inp.value = before;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      // close again so later checks start from the same state
      const closeBtn = document.querySelector<HTMLElement>(
        '.modal__close-button, details-modal[open] summary',
      );
      closeBtn?.click();
      await wait(250);
    }
    const errors = (window.__sqa?.events.slice(errBefore) ?? [])
      .filter((e) => e.kind === 'console-error' || e.kind === 'exception' || e.kind === 'rejection')
      .map((e) => e.message.slice(0, 160));
    let status = 0;
    let ok = false;
    try {
      const res = await fetch(`/search?q=${encodeURIComponent(query)}`, {
        credentials: 'same-origin',
      });
      status = res.status;
      const html = await res.text();
      ok =
        /product-grid|search-results|no results|nothing found|result(s)? for|0 results|did not yield/i.test(
          html,
        );
    } catch {
      status = 0;
    }
    return {
      uiFound,
      panelShown,
      consoleErrors: errors,
      pageStatus: status,
      pageHasResultsOrEmpty: ok,
      query,
    };
  },
  analyze(d: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    const f = (severity: 'error' | 'warning', message: string, selector: string) =>
      out.push(
        makeFinding('CHK-15', ctx, { rule: 'shopify/search-failed', severity, message, selector }),
      );
    if (d.pageStatus !== 200)
      f('error', `/search?q=${d.query} returned ${d.pageStatus || 'a network error'}`, '/search');
    else if (!d.pageHasResultsOrEmpty)
      f('warning', `/search?q=${d.query} shows neither results nor an empty state`, '/search');
    if (d.uiFound && !d.panelShown) {
      f(
        'warning',
        `Typing "${d.query}" in the search box did not show a predictive results panel`,
        'details-modal.header__search',
      );
    }
    for (const e of d.consoleErrors)
      f('warning', `Console error during search: ${e}`, 'details-modal.header__search');
    return out;
  },
};
