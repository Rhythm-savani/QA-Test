import '../shared/ui.css';
import './popup.css';
import { h, icon, ICONS } from '../shared/dom';
import type { GroupId, Options, RunConfig, RunMode, ViewportName } from '../shared/types';
import { VIEWPORT_ORDER } from '../shared/types';
import {
  CORE_GROUPS,
  GROUP_META,
  allGroups,
  countOn,
  detectPreset,
  modeLabel,
  recommendedGroups,
  validateCustomRules,
} from '../shared/options';
import {
  loadLastRun,
  loadOptions,
  loadPages,
  patchOptions,
  savePages,
  setPendingRun,
  type LastRunInfo,
} from '../shared/storage';
import { buildRunConfig, permissionsNeeded, type ActiveTabInfo } from '../shared/run-config';
import { normalizePageEntry } from '../shared/url';

interface State {
  options: Options;
  tab: ActiveTabInfo;
  pages: string[];
  lastRun?: LastRunInfo;
  customizing: boolean;
  newPage: string;
  pageError: string;
  dialog: null | { kind: 'debugger' | 'newsletter' | 'cart'; cfg: RunConfig };
  error: string;
}

const root = document.getElementById('app')!;
const state: State = {
  options: undefined as unknown as Options,
  tab: { isHttp: false },
  pages: [],
  customizing: false,
  newPage: '',
  pageError: '',
  dialog: null,
  error: '',
};

const MODES: RunMode[] = ['quick', 'pages', 'full', 'live'];
const MODE_HINT: Record<RunMode, string> = {
  quick: 'Checks this URL in a separate window. Your tab stays untouched.',
  pages: 'Checks only the pages in your list, in a separate window.',
  full: 'Samples pages from the sitemap, in a separate window.',
  live: 'Analyses this tab as it is now, without reloading. It may change the page state.',
};

function relTime(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  return hrs < 24 ? `${hrs} h ago` : `${Math.round(hrs / 24)} d ago`;
}

async function save(patch: Partial<Options>) {
  state.options = await patchOptions(patch);
  render();
}

async function setGroup(id: GroupId, on: boolean) {
  const groups = { ...state.options.groups, [id]: on };
  await save({ groups, preset: detectPreset(groups) });
}

async function setViewport(name: ViewportName, on: boolean) {
  const vp = { ...state.options.viewports, [name]: on };
  if (!VIEWPORT_ORDER.some((n) => vp[n])) return; // at least one stays on
  await save({ viewports: vp });
}

function storeCard(): HTMLElement {
  const t = state.tab;
  const host = t.origin ? new URL(t.origin).host : 'No storefront tab';
  const sub = !t.isHttp
    ? 'Open a store page, then reopen this popup'
    : t.isShopify === false
      ? 'Not a Shopify store · generic checks only'
      : [
          t.themeName ?? 'Shopify theme',
          t.themeRole === 'unpublished'
            ? `Preview theme #${t.themeId ?? ''}`
            : t.themeRole
              ? t.themeRole
              : '',
        ]
          .filter(Boolean)
          .join(' · ');
  return h(
    'div',
    { class: 'card store-card' },
    h('div', { class: 'store-ico' }, icon(ICONS.store)),
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'store-host', text: host }),
      h('div', { class: 'muted small', text: sub }),
    ),
    t.isShopify ? h('div', { class: 'tag-ok', text: 'Shopify' }) : null,
  );
}

function modeSelector(): HTMLElement {
  const m = state.options.lastMode;
  return h(
    'div',
    null,
    h('div', { class: 'eyebrow', text: 'Run mode' }),
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Run mode' },
      MODES.map((k) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(m === k),
          text: modeLabel(k),
          on: { click: () => void save({ lastMode: k }) },
        }),
      ),
    ),
    h('div', { class: 'muted small mt4', text: MODE_HINT[m] }),
  );
}

function pagesCard(): HTMLElement {
  const active = state.tab;
  const activePath = (() => {
    try {
      const u = new URL(active.url ?? '');
      return u.pathname + u.search;
    } catch {
      return '';
    }
  })();
  const rows = state.pages.map((p, i) => {
    let path = p;
    try {
      const u = new URL(p);
      path = u.pathname + u.search;
    } catch {
      // keep raw
    }
    const isHome = path === '/' || path.startsWith('/?');
    const isThis = activePath && new URL(p).pathname + new URL(p).search === activePath;
    return h(
      'div',
      { class: 'page-row' },
      h('div', { class: 'mono grow ellipsis', text: path, title: path }),
      isThis
        ? h('span', { class: 'chip', text: 'this tab' })
        : isHome
          ? h('span', { class: 'chip', text: 'home' })
          : null,
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `Remove ${path}`,
          on: {
            click: async () => {
              state.pages.splice(i, 1);
              await savePages(active.origin!, state.pages);
              render();
            },
          },
        },
        icon(ICONS.close, 14),
      ),
    );
  });
  const addEntry = async (raw: string) => {
    if (!active.origin || !active.url) return;
    const r = normalizePageEntry(raw, active.origin, active.url);
    if (!r.ok) {
      state.pageError = r.error;
      return render();
    }
    state.pageError = '';
    if (state.pages.includes(r.url)) return render();
    if (state.pages.length >= 25) {
      state.pageError = 'The list is capped at 25 pages.';
      return render();
    }
    state.pages.push(r.url);
    state.newPage = '';
    await savePages(active.origin, state.pages);
    render();
  };
  const input = h('input', {
    type: 'text',
    class: 'text-input',
    placeholder: 'Paste a URL or /path',
    'aria-label': 'Add a URL or path',
    value: state.newPage,
    on: {
      input: (e) => (state.newPage = (e.target as HTMLInputElement).value),
      keydown: (e) => {
        if ((e as KeyboardEvent).key === 'Enter') void addEntry(state.newPage);
      },
    },
  });
  return h(
    'div',
    { class: 'card pad col', 'data-testid': 'pages-card' },
    h(
      'div',
      { class: 'row-base' },
      h('div', { class: 'card-title grow', text: 'Pages to check' }),
      h(
        'div',
        { class: 'muted small' },
        h('b', { class: 'text', text: String(state.pages.length) }),
        ' pages',
      ),
    ),
    h('div', { class: 'col gap4' }, rows),
    h(
      'div',
      { class: 'row gap6' },
      input,
      h('button', {
        type: 'button',
        class: 'btn',
        text: 'Add',
        on: { click: () => void addEntry(state.newPage) },
      }),
    ),
    state.pageError ? h('div', { class: 'err small', role: 'alert', text: state.pageError }) : null,
    h(
      'button',
      {
        type: 'button',
        class: 'btn wide',
        disabled: !active.isHttp,
        on: { click: () => void addEntry(activePath || '/') },
      },
      icon(ICONS.plus, 14),
      `Add this page (${activePath || '/'})`,
    ),
    h('div', {
      class: 'muted small',
      text: 'Saved for next time. Paths keep this tab’s preview theme.',
    }),
  );
}

function devicesCard(): HTMLElement {
  const o = state.options;
  const choose = o.viewportsMode === 'choose';
  const defs: { n: ViewportName; label: string; w: string; ico: string[] }[] = [
    { n: 'desktop', label: 'Desktop', w: '1440', ico: ICONS.desktop },
    { n: 'tablet', label: 'Tablet', w: '768', ico: ICONS.tablet },
    { n: 'mobile', label: 'Mobile', w: '390', ico: ICONS.mobile },
  ];
  const tiles = defs.map((d) => {
    const on = choose ? o.viewports[d.n] : true;
    const inner = [
      icon(d.ico),
      h(
        'span',
        { class: 'tile-label' },
        h('span', { class: 'tile-name', text: d.label }),
        h('span', { class: 'mono muted tile-w', text: d.w }),
      ),
    ];
    return choose
      ? h(
          'button',
          {
            type: 'button',
            class: 'tile',
            'aria-pressed': String(on),
            on: { click: () => void setViewport(d.n, !on) },
          },
          inner,
        )
      : h('div', { class: 'tile static' }, inner);
  });
  return h(
    'div',
    { class: 'card pad col', 'data-testid': 'devices-card' },
    h(
      'div',
      { class: 'row-base' },
      h('div', { class: 'card-title grow', text: 'Devices' }),
      h(
        'div',
        { class: 'seg small', role: 'group', 'aria-label': 'Devices' },
        h('button', {
          type: 'button',
          'aria-pressed': String(!choose),
          text: 'All devices',
          on: {
            click: () =>
              void save({
                viewportsMode: 'all',
                viewports: { desktop: true, tablet: true, mobile: true },
              }),
          },
        }),
        h('button', {
          type: 'button',
          'aria-pressed': String(choose),
          text: 'Choose',
          on: { click: () => void save({ viewportsMode: 'choose' }) },
        }),
      ),
    ),
    h('div', { class: 'row gap6' }, tiles),
    h('div', {
      class: 'muted small',
      text: choose
        ? 'At least one stays on. Tablet and mobile use the debugging permission, asked on the first run.'
        : 'Each page is checked at every size. Tablet and mobile use the debugging permission.',
    }),
  );
}

function groupsCard(): HTMLElement {
  const o = state.options;
  const on = countOn(o.groups);
  const total = CORE_GROUPS.length;
  const off = CORE_GROUPS.filter((g) => !o.groups[g]).map((g) => GROUP_META[g].label);
  const hasRules = validateCustomRules(o.customRules).rules.length > 0;
  const summary =
    o.preset === 'recommended'
      ? `Recommended set${hasRules ? '' : ' · Custom rules off'}`
      : off.length
        ? `Off: ${off.join(', ')}`
        : 'Everything on';
  const meter = h(
    'div',
    { class: 'meter', role: 'img', 'aria-label': `${on} of ${total} check groups on` },
    CORE_GROUPS.map((g) => h('div', { class: 'seg-bar' + (o.groups[g] ? ' on' : '') })),
  );
  const head = h(
    'div',
    { class: 'row-base' },
    h('div', { class: 'card-title grow', text: 'Check groups' }),
    h(
      'div',
      { class: 'muted small' },
      h('b', { class: 'text', text: String(on) }),
      ` of ${total} on`,
    ),
  );
  if (!state.customizing) {
    return h(
      'div',
      { class: 'card pad col', 'data-testid': 'groups-card' },
      head,
      meter,
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'muted small grow', text: summary }),
        h(
          'button',
          {
            type: 'button',
            class: 'btn small',
            'aria-expanded': 'false',
            on: {
              click: () => {
                state.customizing = true;
                render();
              },
            },
          },
          'Customize',
          icon(ICONS.chevron, 12),
        ),
      ),
    );
  }
  const presets: { id: Options['preset']; label: string }[] = [
    { id: 'recommended', label: 'Recommended' },
    { id: 'all', label: 'All' },
    { id: 'custom', label: 'Custom' },
  ];
  const headings = ['Page health', 'Content and looks', 'Behaviour', 'Shopify and custom'] as const;
  return h(
    'div',
    { class: 'card pad col', 'data-testid': 'groups-card' },
    head,
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Preset' },
      presets.map((p) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(o.preset === p.id),
          text: p.label,
          on: {
            click: () => {
              if (p.id === 'custom') return void save({ preset: 'custom' });
              const groups = p.id === 'all' ? allGroups() : recommendedGroups();
              void save({ groups: { ...o.groups, ...groups }, preset: p.id });
            },
          },
        }),
      ),
    ),
    headings.map((hd) => {
      const ids = CORE_GROUPS.filter((g) => GROUP_META[g].heading === hd);
      return h(
        'div',
        null,
        h('div', { class: 'eyebrow mb4', text: hd }),
        h(
          'div',
          { class: 'group-list' },
          ids.map((g) =>
            h(
              'div',
              { class: 'group-row' },
              h(
                'div',
                { class: 'grow' },
                h('div', {
                  class: 'group-name' + (o.groups[g] ? '' : ' off'),
                  text: GROUP_META[g].label,
                }),
                h('div', {
                  class: 'muted tiny',
                  text:
                    g === 'custom' && !hasRules
                      ? 'Your own JSON rules (none yet)'
                      : GROUP_META[g].desc,
                }),
              ),
              h('button', {
                type: 'button',
                class: 'switch',
                role: 'switch',
                'aria-checked': String(!!o.groups[g]),
                'aria-label': GROUP_META[g].label,
                on: { click: () => void setGroup(g, !o.groups[g]) },
              }),
            ),
          ),
        ),
      );
    }),
    h(
      'button',
      {
        type: 'button',
        class: 'btn small',
        'aria-expanded': 'true',
        on: {
          click: () => {
            state.customizing = false;
            render();
          },
        },
      },
      'Done',
      icon(ICONS.chevron, 12, 'flip'),
    ),
  );
}

function optIns(): HTMLElement {
  const o = state.options;
  const row = (
    title: string,
    desc: string,
    on: boolean,
    label: string,
    set: (v: boolean) => void,
  ) =>
    h(
      'div',
      { class: 'optin-row' },
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'group-name', text: title }),
        h('div', { class: 'muted tiny', text: desc }),
      ),
      h('button', {
        type: 'button',
        class: 'switch',
        role: 'switch',
        'aria-checked': String(on),
        'aria-label': label,
        on: { click: () => set(!on) },
      }),
    );
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'warn-eyebrow' },
      icon(ICONS.warn, 13),
      'Changes store data · off by default',
    ),
    h(
      'div',
      { class: 'card' },
      row(
        'Newsletter form',
        'Level 1 only checks. Level 2 submits a test address.',
        !!o.groups.newsletter,
        'Newsletter form check',
        (v) => void setGroup('newsletter', v),
      ),
      row(
        'Cart actions',
        'Adds a test item, then restores your cart.',
        !!o.groups.cart,
        'Cart actions check',
        (v) => void setGroup('cart', v),
      ),
    ),
  );
}

function runLabel(): string {
  const m = state.options.lastMode;
  if (m === 'pages')
    return `Run Pages check · ${state.pages.length} page${state.pages.length === 1 ? '' : 's'}`;
  return `Run ${modeLabel(m)} check`;
}

function runBlocker(): string {
  const o = state.options;
  if (!state.tab.isHttp) return 'Open an http(s) page of the storefront first.';
  if (o.lastMode === 'pages' && state.pages.length === 0)
    return 'Add at least one page to the list first.';
  if (!VIEWPORT_ORDER.some((n) => o.viewports[n])) return 'Turn on at least one device.';
  return '';
}

function footer(): HTMLElement {
  const blocker = runBlocker();
  const lr = state.lastRun;
  return h(
    'div',
    { class: 'footer' },
    h(
      'button',
      {
        type: 'button',
        class: 'run-btn',
        id: 'run',
        disabled: !!blocker,
        on: { click: () => void onRun() },
      },
      icon(ICONS.play, 14),
      runLabel(),
    ),
    blocker ? h('div', { class: 'muted small', role: 'status', text: blocker }) : null,
    h(
      'div',
      { class: 'row between small muted' },
      lr
        ? h('a', {
            href: chrome.runtime.getURL(`report.html?view=${lr.runId}`),
            target: '_blank',
            class: 'bold',
            text: `Last run ${relTime(lr.at)} · ${lr.errors} error${lr.errors === 1 ? '' : 's'}`,
          })
        : h('span', { text: 'No runs yet for this store' }),
      h('span', { class: 'kbd', text: 'Alt+Shift+Q' }),
    ),
  );
}

// ---------- dialogs (UI-POPUP-2 and the opt-in confirmations) ----------

function dialog(): HTMLElement | null {
  const d = state.dialog;
  if (!d) return null;
  const bullets = (items: string[]) =>
    h(
      'ul',
      { class: 'bullets' },
      items.map((i) => h('li', { text: i })),
    );
  const close = () => {
    state.dialog = null;
    render();
  };
  let body: HTMLElement;
  if (d.kind === 'debugger') {
    body = h(
      'section',
      {
        class: 'dialog card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dlg-title',
      },
      h('h2', { id: 'dlg-title', text: 'Allow debugging for mobile view and screenshots?' }),
      h(
        'div',
        { class: 'mock-banner' },
        icon(ICONS.info, 14),
        h('span', { class: 'grow', text: '“Storefront QA” started debugging this browser' }),
        h('span', { class: 'muted', text: 'Cancel' }),
      ),
      h('p', {
        class: 'muted',
        text: 'Chrome shows this banner while the QA window runs. It is how mobile and tablet sizes and outlined evidence screenshots work.',
      }),
      bullets([
        'Only the separate QA window is debugged. Your own tabs are not.',
        'If you skip it, those parts are listed as skipped in the report.',
      ]),
      h(
        'div',
        { class: 'row end gap6' },
        h('button', {
          type: 'button',
          class: 'btn',
          text: 'Skip these checks',
          on: { click: () => void proceed(d.cfg, 'skip') },
        }),
        h('button', {
          type: 'button',
          class: 'btn primary',
          id: 'allow',
          text: 'Allow',
          on: { click: () => void proceed(d.cfg, 'allow') },
        }),
      ),
    );
  } else if (d.kind === 'newsletter') {
    const email = d.cfg.options.newsletterEmail || '(set a test address in Options)';
    body = h(
      'section',
      {
        class: 'dialog card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dlg-title',
      },
      h('h2', { id: 'dlg-title', text: 'Submit a real test subscriber?' }),
      h(
        'p',
        null,
        'Level 2 sends ',
        h('code', { text: email }),
        ' through this store’s own newsletter form, then checks that the success message appears.',
      ),
      bullets([
        'Creates a real customer record and may trigger a welcome email.',
        'Can’t be undone from here. Remove it later in Shopify admin under Customers.',
        'The report will name the address that was submitted.',
      ]),
      h(
        'div',
        { class: 'row end gap6' },
        h('button', {
          type: 'button',
          class: 'btn',
          text: 'Keep Level 1',
          on: {
            click: async () => {
              await save({ newsletterLevel: 1 });
              close();
            },
          },
        }),
        h('button', {
          type: 'button',
          class: 'btn primary',
          text: 'Submit test address',
          on: {
            click: async () => {
              state.options = await patchOptions({ confirmedNewsletterL2: true });
              state.dialog = null;
              void onRun();
            },
          },
        }),
      ),
    );
  } else {
    body = h(
      'section',
      {
        class: 'dialog card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dlg-title',
      },
      h('h2', { id: 'dlg-title', text: 'Run cart actions on this store?' }),
      h('p', {
        text: 'The checker adds a test item to your cart, changes its quantity, then removes it, and confirms the cart and header badge stay in step.',
      }),
      bullets([
        'Your current cart is saved first.',
        'Only lines the test added are removed, even if you cancel mid-run.',
        'The report states whether your cart ended exactly as it began.',
        'Checkout is never opened.',
      ]),
      h(
        'div',
        { class: 'row end gap6' },
        h('button', {
          type: 'button',
          class: 'btn',
          text: 'Not now',
          on: {
            click: async () => {
              await setGroup('cart', false);
              close();
            },
          },
        }),
        h('button', {
          type: 'button',
          class: 'btn primary',
          text: 'Run cart actions',
          on: {
            click: async () => {
              state.options = await patchOptions({ confirmedCartActions: true });
              state.dialog = null;
              void onRun();
            },
          },
        }),
      ),
    );
  }
  return h('div', { class: 'scrim' }, body);
}

// ---------- run flow ----------

async function onRun() {
  state.error = '';
  const o = state.options;
  const cfgOrErr = buildRunConfig(o, state.tab, o.lastMode, state.pages);
  if ('error' in cfgOrErr) {
    state.error = cfgOrErr.error;
    return render();
  }
  const cfg = cfgOrErr;
  // one-time confirmations for state-changing opt-ins
  if (cfg.groups.newsletter && o.newsletterLevel === 2 && !o.confirmedNewsletterL2) {
    state.dialog = { kind: 'newsletter', cfg };
    return render();
  }
  if (cfg.groups.cart && !o.confirmedCartActions) {
    state.dialog = { kind: 'cart', cfg };
    return render();
  }
  const need = permissionsNeeded(cfg);
  const has = await chrome.permissions.contains({
    permissions: need.permissions,
    origins: need.origins,
  });
  if (!has) {
    state.dialog = { kind: 'debugger', cfg };
    return render();
  }
  await launch(cfg);
}

async function proceed(cfg: RunConfig, choice: 'allow' | 'skip') {
  const need = permissionsNeeded(cfg);
  try {
    const granted =
      choice === 'allow'
        ? await chrome.permissions.request({ permissions: need.permissions, origins: need.origins })
        : need.origins.length
          ? await chrome.permissions.request({ origins: need.origins })
          : true;
    if (!granted) {
      state.dialog = null;
      state.error = 'Permission was not granted, so the run did not start.';
      return render();
    }
  } catch (e) {
    state.error = `Permission request failed: ${(e as Error).message}`;
    state.dialog = null;
    return render();
  }
  state.dialog = null;
  await launch(cfg);
}

async function launch(cfg: RunConfig) {
  const id = crypto.randomUUID();
  await setPendingRun({
    id,
    config: cfg,
    liveTabId: cfg.mode === 'live' ? state.tab.tabId : undefined,
    createdAt: Date.now(),
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?run=${id}`) });
  window.close();
}

// ---------- render ----------

function render() {
  const scroll = root.querySelector('.content')?.scrollTop ?? 0;
  const o = state.options;
  const content = h(
    'div',
    { class: 'content' },
    storeCard(),
    modeSelector(),
    o.lastMode === 'pages' ? pagesCard() : null,
    o.lastMode === 'live' ? null : devicesCard(),
    groupsCard(),
    optIns(),
    state.error ? h('div', { class: 'err', role: 'alert', text: state.error }) : null,
    state.tab.isShopify === false && state.tab.isHttp
      ? h('div', {
          class: 'notice',
          role: 'status',
          text: 'This does not look like a Shopify store. Generic checks run; Shopify-specific groups are skipped.',
        })
      : null,
  );
  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('div', { class: 'logo' }, icon(ICONS.check, 18)),
      h('div', { class: 'grow brand', text: 'Storefront QA' }),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Open options',
          on: { click: () => void chrome.runtime.openOptionsPage() },
        },
        icon(ICONS.sliders, 18),
      ),
    ),
    content,
    footer(),
    ...(dialog() ? [dialog()!] : []),
  );
  const c = root.querySelector('.content');
  if (c) c.scrollTop = scroll;
  (document.getElementById('allow') as HTMLElement | null)?.focus();
}

async function probeTab(): Promise<ActiveTabInfo> {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (__E2E__) {
    // SQA_E2E_HOOK: tests open popup.html in a normal tab, so let them name the storefront tab.
    const id = new URLSearchParams(location.search).get('tabId');
    if (id) tab = await chrome.tabs.get(Number(id));
  }
  const info: ActiveTabInfo = {
    tabId: tab?.id,
    url: tab?.url,
    isHttp: !!tab?.url && /^https?:\/\//i.test(tab.url),
  };
  if (info.isHttp && tab?.id !== undefined) {
    info.origin = new URL(tab.url!).origin;
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          const s = (
            window as unknown as {
              Shopify?: { theme?: { id?: number; name?: string; role?: string } };
            }
          ).Shopify;
          return {
            shopify: !!s,
            theme: s?.theme ? { id: s.theme.id, name: s.theme.name, role: s.theme.role } : null,
          };
        },
      });
      const r = res[0]?.result as
        | { shopify: boolean; theme: { id?: number; name?: string; role?: string } | null }
        | undefined;
      if (r) {
        info.isShopify = r.shopify;
        info.themeId = r.theme?.id;
        info.themeName = r.theme?.name;
        info.themeRole = r.theme?.role;
      }
    } catch {
      // no access to this tab (e.g. before permission): leave Shopify detection undecided
    }
  }
  return info;
}

async function init() {
  state.options = await loadOptions();
  state.tab = await probeTab();
  if (state.tab.origin) {
    state.pages = await loadPages(state.tab.origin);
    state.lastRun = await loadLastRun(state.tab.origin);
  }
  render();
}

void init();
