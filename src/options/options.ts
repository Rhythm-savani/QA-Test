import '../shared/ui.css';
import './options.css';
import { h } from '../shared/dom';
import type { GroupId, Options, ViewportName } from '../shared/types';
import { VIEWPORT_ORDER, VIEWPORTS } from '../shared/types';
import {
  CORE_GROUPS,
  CUSTOM_RULE_EXAMPLE,
  DEFAULT_OPTIONS,
  GROUP_META,
  detectPreset,
  exportOptions,
  importOptions,
  sanitizeOptions,
  validateCustomRules,
} from '../shared/options';
import { loadOptions, saveOptions } from '../shared/storage';
import * as db from '../shared/db';

const root = document.getElementById('app')!;
let opts: Options;
let savedLabel = 'All changes saved';
let saveTimer: number | undefined;
let importMsg = '';
let debuggerGranted = false;

function commit() {
  savedLabel = 'Saving…';
  const el = document.getElementById('save-state');
  if (el) el.textContent = savedLabel;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    await saveOptions(opts);
    savedLabel = 'All changes saved';
    const e = document.getElementById('save-state');
    if (e) e.textContent = savedLabel;
  }, 250);
}

function toggle(label: string, desc: string, on: boolean, set: (v: boolean) => void, tag?: string) {
  const btn = h('button', {
    type: 'button',
    class: 'switch',
    role: 'switch',
    'aria-checked': String(on),
    'aria-label': label,
    on: {
      click: () => {
        const v = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(v));
        set(v);
        commit();
      },
    },
  });
  return h(
    'div',
    { class: 'opt-row' },
    h(
      'div',
      { class: 'grow' },
      h(
        'div',
        { class: 'opt-title' },
        label,
        tag ? h('span', { class: 'sev warning', text: tag }) : null,
      ),
      h('div', { class: 'muted small', text: desc }),
    ),
    btn,
  );
}

function numberField(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  set: (v: number) => void,
  aria?: string,
) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'muted small', text: label }),
    h('input', {
      type: 'number',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      'aria-label': aria ?? label,
      on: {
        change: (e) => {
          const n = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(n)) {
            set(Math.min(max, Math.max(min, n)));
            commit();
          }
        },
      },
    }),
  );
}

function listField(
  label: string,
  value: string[],
  set: (v: string[]) => void,
  validateRegex = false,
  hint = '',
) {
  const err = h('div', { class: 'err small', role: 'alert' });
  const ta = h('textarea', {
    rows: '3',
    class: 'mono-input',
    value: value.join('\n'),
    on: {
      input: (e) => {
        const lines = (e.target as HTMLTextAreaElement).value
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const bad: string[] = [];
        if (validateRegex) {
          for (const l of lines) {
            try {
              new RegExp(l);
            } catch {
              bad.push(l);
            }
          }
        }
        err.textContent = bad.length ? `Not a valid regular expression: ${bad.join(', ')}` : '';
        set(lines.filter((l) => !bad.includes(l)));
        commit();
      },
    },
  });
  return h(
    'label',
    { class: 'field wide' },
    h('span', { class: 'muted small', text: label }),
    ta,
    hint ? h('span', { class: 'muted small', text: hint }) : null,
    err,
  );
}

function section(id: string, title: string, intro: string | null, ...children: (Node | null)[]) {
  return h(
    'section',
    { class: 'card pad', id, 'aria-labelledby': `${id}-t` },
    h('h2', { id: `${id}-t`, text: title }),
    intro ? h('p', { class: 'muted', text: intro }) : null,
    ...children,
  );
}

function render() {
  const groupRows: Node[] = CORE_GROUPS.filter((g) => g !== 'custom').map((g) =>
    toggle(GROUP_META[g].label, GROUP_META[g].desc, !!opts.groups[g], (v) => {
      opts.groups[g as GroupId] = v;
      opts.preset = detectPreset(opts.groups);
    }),
  );
  groupRows.push(
    toggle(
      'Newsletter form',
      'Level 1 checks the form. Level 2 submits a test address.',
      !!opts.groups.newsletter,
      (v) => (opts.groups.newsletter = v),
      'Changes store data',
    ),
    toggle(
      'Cart actions',
      'Adds a test item, changes quantity, removes it, restores your cart.',
      !!opts.groups.cart,
      (v) => (opts.groups.cart = v),
      'Changes store data',
    ),
    toggle(
      'Visual baseline',
      'Compares each page with a saved baseline screenshot and shows a diff. Needs the debugging permission.',
      !!opts.groups.visual,
      (v) => (opts.groups.visual = v),
    ),
    toggle(
      'Custom rules',
      'Runs only when you have defined rules below.',
      !!opts.groups.custom,
      (v) => {
        opts.groups.custom = v;
        opts.preset = detectPreset(opts.groups);
      },
    ),
  );

  const vpCards = VIEWPORT_ORDER.map((n: ViewportName) => {
    const d = VIEWPORTS[n];
    const on = opts.viewports[n];
    return h(
      'button',
      {
        type: 'button',
        class: 'vp-card',
        'aria-pressed': String(on),
        'data-vp': n,
        on: {
          click: () => {
            const next = { ...opts.viewports, [n]: !on };
            if (!VIEWPORT_ORDER.some((k) => next[k])) return;
            opts.viewports = next;
            opts.viewportsMode = VIEWPORT_ORDER.every((k) => next[k]) ? 'all' : 'choose';
            commit();
            render();
          },
        },
      },
      h('b', { text: n[0].toUpperCase() + n.slice(1) }),
      h('span', {
        class: 'mono small',
        text: `${d.width} × ${d.height}${d.dpr > 1 ? ' · DPR ' + d.dpr : ''}`,
      }),
      h('span', { class: 'muted small', text: on ? 'On' : 'Off' }),
    );
  });

  const rulesState = validateCustomRules(opts.customRules);
  const rulesErr = h(
    'div',
    {
      class: rulesState.errors.length ? 'err small' : 'ok small',
      id: 'rules-status',
      role: 'status',
    },
    rulesState.errors.length
      ? rulesState.errors.map((e) => h('div', { text: e }))
      : `${rulesState.rules.length} valid rule${rulesState.rules.length === 1 ? '' : 's'}`,
  );
  const rulesTa = h('textarea', {
    rows: '12',
    class: 'mono-input',
    id: 'rules-json',
    'aria-label': 'Custom rules JSON',
    value: opts.customRules,
    on: {
      input: (e) => {
        opts.customRules = (e.target as HTMLTextAreaElement).value;
        const r = validateCustomRules(opts.customRules);
        rulesErr.replaceChildren(
          ...(r.errors.length
            ? r.errors.map((m) => h('div', { text: m }))
            : [
                document.createTextNode(
                  `${r.rules.length} valid rule${r.rules.length === 1 ? '' : 's'}`,
                ),
              ]),
        );
        rulesErr.className = r.errors.length ? 'err small' : 'ok small';
        commit();
      },
    },
  });

  const th = opts.thresholds;
  const thRow = (label: string, key: 'lcp' | 'ttfb' | 'fcp' | 'cls', seconds: boolean) => {
    const f = seconds ? 1000 : 1;
    return h(
      'div',
      { class: 'th-row' },
      h('div', { class: 'grow', text: label }),
      numberField(
        'Warn above',
        th[key][0] / f,
        0,
        100,
        seconds ? 0.1 : 0.01,
        (v) => (th[key] = [v * f, th[key][1]]),
        `${label} warning above`,
      ),
      numberField(
        'Error above',
        th[key][1] / f,
        0,
        100,
        seconds ? 0.1 : 0.01,
        (v) => (th[key] = [th[key][0], v * f]),
        `${label} error above`,
      ),
    );
  };

  root.replaceChildren(
    h(
      'header',
      { class: 'bar' },
      h('div', { class: 'brand', text: 'Storefront QA' }),
      h('span', { class: 'muted', text: '/ Options' }),
      h('div', { class: 'grow' }),
      h('span', { class: 'muted small', id: 'save-state', role: 'status', text: savedLabel }),
    ),
    h(
      'div',
      { class: 'layout' },
      h(
        'nav',
        { 'aria-label': 'Options sections', class: 'toc' },
        [
          'groups:Check groups',
          'viewports:Viewports and run',
          'pages:Full-mode pages',
          'perf:Performance thresholds',
          'ignore:Ignore lists',
          'nl:Newsletter and cart',
          'rules:Custom rules',
          'data:History and data',
        ].map((s) => {
          const [id, t] = s.split(':');
          return h('a', { href: `#${id}`, text: t });
        }),
      ),
      h(
        'main',
        { class: 'col' },
        section(
          'groups',
          'Check groups',
          'These are the defaults the popup starts from. Anything that changes store data stays off until you turn it on.',
          ...groupRows,
        ),
        section(
          'viewports',
          'Viewports and run behaviour',
          'All three viewports are on by default and each page is checked at every viewport that is on. At least one must stay on. Tablet and mobile need the debugging permission.',
          h('div', { class: 'vp-row' }, vpCards),
          toggle(
            'Evidence screenshots',
            'Outlines the element and attaches an image to each finding.',
            opts.screenshots,
            (v) => (opts.screenshots = v),
          ),
          toggle(
            'Keep the QA window open after a run',
            'Useful when you want to inspect a page the checker visited.',
            opts.keepQaWindow,
            (v) => (opts.keepQaWindow = v),
          ),
          toggle(
            'Report console warnings',
            'Adds console.warn messages as Info findings.',
            opts.showConsoleWarn,
            (v) => (opts.showConsoleWarn = v),
          ),
          toggle(
            'Strict tap targets',
            'Also flags targets under 44 px on mobile and tablet, as Info.',
            opts.strictTapTargets,
            (v) => (opts.strictTapTargets = v),
          ),
          toggle(
            'Check external links',
            'Fetches external link targets (no-cors). Off by default.',
            opts.checkExternalLinks,
            (v) => (opts.checkExternalLinks = v),
          ),
          h(
            'div',
            { class: 'grid3' },
            numberField(
              'Interaction candidates per page',
              opts.maxInteractions,
              1,
              200,
              1,
              (v) => (opts.maxInteractions = v),
            ),
            numberField(
              'Links fetched per page',
              opts.maxLinks,
              1,
              500,
              1,
              (v) => (opts.maxLinks = v),
            ),
            numberField(
              'Product variants to test',
              opts.variantsMax,
              1,
              50,
              1,
              (v) => (opts.variantsMax = v),
            ),
          ),
          h(
            'label',
            { class: 'field' },
            h('span', { class: 'muted small', text: 'Search query for the search check' }),
            h('input', {
              type: 'text',
              value: opts.searchQuery,
              'aria-label': 'Search query',
              on: {
                change: (e) => {
                  opts.searchQuery = (e.target as HTMLInputElement).value || 'a';
                  commit();
                },
              },
            }),
          ),
          h(
            'div',
            { class: 'opt-row' },
            h(
              'div',
              { class: 'grow' },
              h('div', { class: 'opt-title', text: 'Debugging permission' }),
              h('div', {
                class: 'muted small',
                text: 'Needed for mobile and tablet sizes and for screenshots.',
              }),
            ),
            h('span', {
              class: debuggerGranted ? 'sev ok' : 'sev info',
              id: 'dbg-state',
              text: debuggerGranted ? 'Granted' : 'Not granted',
            }),
            debuggerGranted
              ? h('button', {
                  type: 'button',
                  class: 'btn',
                  text: 'Revoke',
                  on: {
                    click: async () => {
                      await chrome.permissions.remove({ permissions: ['debugger'] });
                      await refreshPerm();
                      render();
                    },
                  },
                })
              : null,
          ),
        ),
        section(
          'pages',
          'Full-mode pages',
          'How many pages of each type a Full run samples from the sitemap. The first pages found are used, so runs stay comparable. The cart, search and a 404 page are always added.',
          h(
            'div',
            { class: 'grid3' },
            (['home', 'collections', 'products', 'pages', 'blog', 'article'] as const).map((k) =>
              numberField(
                k[0].toUpperCase() + k.slice(1),
                opts.sample[k],
                0,
                20,
                1,
                (v) => (opts.sample[k] = v),
              ),
            ),
            numberField('Max pages per run', opts.maxPages, 1, 100, 1, (v) => (opts.maxPages = v)),
            numberField(
              'Pages at once (1 to 3)',
              opts.concurrency,
              1,
              3,
              1,
              (v) => (opts.concurrency = v),
            ),
            numberField(
              'Page load timeout (seconds)',
              opts.pageLoadTimeoutMs / 1000,
              5,
              120,
              1,
              (v) => (opts.pageLoadTimeoutMs = v * 1000),
            ),
            numberField(
              'Per-page budget (seconds)',
              opts.pageBudgetMs / 1000,
              10,
              600,
              5,
              (v) => (opts.pageBudgetMs = v * 1000),
            ),
          ),
          listField(
            'Extra paths to include, one per line',
            opts.customPaths,
            (v) => (opts.customPaths = v),
          ),
        ),
        section(
          'perf',
          'Performance thresholds',
          'Above the first value is a Warning. Above the second is an Error. Numbers are measured in your own browser, so treat them as indicative.',
          thRow('Largest contentful paint (s)', 'lcp', true),
          thRow('Cumulative layout shift', 'cls', false),
          thRow('Time to first byte (s)', 'ttfb', true),
          thRow('First contentful paint (s)', 'fcp', true),
        ),
        section(
          'ignore',
          'Ignore lists',
          'Known noise you don’t want in reports. One entry per line.',
          listField(
            'Console messages (regex)',
            opts.ignoreConsole,
            (v) => (opts.ignoreConsole = v),
            true,
          ),
          listField(
            'Network URLs (regex)',
            opts.ignoreNetwork,
            (v) => (opts.ignoreNetwork = v),
            true,
          ),
          listField('Selectors to skip', opts.skipSelectors, (v) => (opts.skipSelectors = v)),
          listField(
            'Extra words the checker must never click',
            opts.denylistExtra,
            (v) => (opts.denylistExtra = v),
          ),
          h('div', {
            class: 'muted small',
            text: 'Built-in safety rules (log out, checkout, pay, place order, delete and similar) always apply and cannot be removed.',
          }),
        ),
        section(
          'nl',
          'Newsletter and cart',
          'Both change store data and stay off until you enable them above. You are asked to confirm before the first run that uses them.',
          h(
            'div',
            { class: 'seg', role: 'group', 'aria-label': 'Newsletter level' },
            [1, 2].map((l) =>
              h('button', {
                type: 'button',
                'aria-pressed': String(opts.newsletterLevel === l),
                text: l === 1 ? 'Level 1 · check only' : 'Level 2 · submit test address',
                on: {
                  click: () => {
                    opts.newsletterLevel = l as 1 | 2;
                    if (l === 1) opts.confirmedNewsletterL2 = false;
                    commit();
                    render();
                  },
                },
              }),
            ),
          ),
          h(
            'label',
            { class: 'field wide' },
            h('span', {
              class: 'muted small',
              text: 'Test address for Level 2 (for example name+qa@yourdomain.com)',
            }),
            h('input', {
              type: 'email',
              value: opts.newsletterEmail,
              'aria-label': 'Newsletter test address',
              on: {
                change: (e) => {
                  opts.newsletterEmail = (e.target as HTMLInputElement).value.trim();
                  commit();
                },
              },
            }),
          ),
        ),
        section(
          'rules',
          'Custom rules',
          'A JSON list that runs through the same open-and-close engine, for features like a wishlist drawer or quote form. Fields: name, urlPattern (regex on the path), trigger, expectVisible, close, closeExpectHidden.',
          rulesTa,
          rulesErr,
          h('button', {
            type: 'button',
            class: 'btn',
            text: 'Insert example rules',
            on: {
              click: () => {
                opts.customRules = CUSTOM_RULE_EXAMPLE;
                commit();
                render();
              },
            },
          }),
        ),
        section(
          'data',
          'History and data',
          null,
          h(
            'div',
            { class: 'grid3' },
            numberField(
              'Runs to keep per store',
              opts.historySize,
              1,
              100,
              1,
              (v) => (opts.historySize = v),
            ),
          ),
          h(
            'div',
            { class: 'row gap8' },
            h('button', {
              type: 'button',
              class: 'btn',
              id: 'opt-export',
              text: 'Export options',
              on: {
                click: () => {
                  const a = h('a', {
                    href: URL.createObjectURL(
                      new Blob([exportOptions(opts)], { type: 'application/json' }),
                    ),
                    download: 'storefront-qa-options.json',
                  });
                  document.body.append(a);
                  a.click();
                  a.remove();
                },
              },
            }),
            h(
              'label',
              { class: 'btn' },
              'Import options',
              h('input', {
                type: 'file',
                accept: 'application/json',
                class: 'sr-only',
                id: 'opt-import',
                on: {
                  change: async (e) => {
                    const f = (e.target as HTMLInputElement).files?.[0];
                    if (!f) return;
                    const r = importOptions(await f.text());
                    if (r.options) {
                      opts = r.options;
                      await saveOptions(opts);
                      importMsg = 'Options imported.';
                    } else importMsg = r.error ?? 'Import failed.';
                    render();
                  },
                },
              }),
            ),
            h('button', {
              type: 'button',
              class: 'btn',
              text: 'Reset to defaults',
              on: {
                click: () => {
                  opts = structuredClone(DEFAULT_OPTIONS);
                  commit();
                  render();
                },
              },
            }),
            h('button', {
              type: 'button',
              class: 'btn danger',
              text: 'Clear run history',
              on: {
                click: async () => {
                  for (const r of await db.listRuns()) await db.deleteRun(r.id);
                  importMsg = 'Run history cleared.';
                  render();
                },
              },
            }),
          ),
          importMsg ? h('div', { class: 'notice', role: 'status', text: importMsg }) : null,
        ),
      ),
    ),
  );
}

async function refreshPerm() {
  debuggerGranted = await chrome.permissions
    .contains({ permissions: ['debugger'] })
    .catch(() => false);
}

async function init() {
  opts = sanitizeOptions(await loadOptions());
  await refreshPerm();
  render();
}
void init();
