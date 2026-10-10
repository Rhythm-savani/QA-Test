import '../shared/ui.css';
import './report.css';
import { h, icon, ICONS } from '../shared/dom';
import type { Category, Finding, Options, RunConfig, RunRecord, Severity } from '../shared/types';
import { CHECKS } from '../checks/registry';
import { executeRun } from '../orchestrator/run';
import * as db from '../shared/db';
import { loadOptions, setPendingRun, takePendingRun, type PendingRun } from '../shared/storage';
import {
  groupFindings,
  summarize,
  filterGroups,
  diffRuns,
  type FindingGroup,
  type Filters,
} from './grouping';
import { exportHtml, exportJson, exportMarkdown } from './export';
import { GROUP_META, CORE_GROUPS, modeLabel } from '../shared/options';
import { permissionsNeeded } from '../shared/run-config';

declare const __E2E__: boolean;

const root = document.getElementById('app')!;

interface UiState {
  run: RunRecord | null;
  running: boolean;
  cancel: boolean;
  filters: Filters;
  open: Set<string>;
  showAll: boolean;
  history: RunRecord[];
  compareId: string;
  exportOpen: boolean;
  message: string;
  needPerm: null | {
    pending: PendingRun;
    origins: string[];
    permissions: chrome.runtime.ManifestPermission[];
  };
  showPassedAll: boolean;
}
const ui: UiState = {
  run: null,
  running: false,
  cancel: false,
  filters: {},
  open: new Set(),
  showAll: false,
  history: [],
  compareId: '',
  exportOpen: false,
  message: '',
  needPerm: null,
  showPassedAll: false,
};

const SEV_LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };
const CAT_LABEL: Record<Category, string> = {
  health: 'Health',
  media: 'Media',
  links: 'Links',
  content: 'Content',
  layout: 'Layout',
  interaction: 'Interaction',
  a11y: 'Accessibility',
  performance: 'Performance',
  seo: 'Page basics',
  shopify: 'Shopify',
  newsletter: 'Newsletter',
  cart: 'Cart',
  safety: 'Safety',
};
const VP_LABEL: Record<string, string> = {
  desktop: 'Desktop 1440',
  tablet: 'Tablet 768',
  mobile: 'Mobile 390',
};

const shotCache = new Map<string, string | null>();
async function shotUrl(id: string): Promise<string | null> {
  if (shotCache.has(id)) return shotCache.get(id)!;
  const s = await db.getScreenshot(id);
  const v = s?.dataUrl ?? null;
  shotCache.set(id, v);
  return v;
}

function duration(run: RunRecord): string {
  const ms = (run.finishedAt ?? Date.now()) - run.startedAt;
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function sevChip(s: Severity) {
  return h('span', { class: `sev ${s}`, text: SEV_LABEL[s] });
}

// ---------- sections ----------

function headerBar(run: RunRecord | null): HTMLElement {
  return h(
    'header',
    { class: 'bar no-print' },
    h('div', { class: 'logo' }, icon(ICONS.check, 18)),
    h('div', { class: 'brand', text: 'Storefront QA' }),
    h('span', { class: 'muted', text: '/ Run report' }),
    h('div', { class: 'grow' }),
    run && !ui.running
      ? h(
          'div',
          { class: 'row gap8' },
          h('button', {
            type: 'button',
            class: 'btn',
            id: 'btn-compare',
            text: 'Compare with previous run',
            on: {
              click: () => {
                ui.compareId = ui.compareId ? '' : (previousRun()?.id ?? '');
                render();
              },
            },
          }),
          h(
            'div',
            { class: 'menu-wrap' },
            h('button', {
              type: 'button',
              class: 'btn',
              id: 'btn-export',
              'aria-expanded': String(ui.exportOpen),
              text: 'Export',
              on: {
                click: () => {
                  ui.exportOpen = !ui.exportOpen;
                  render();
                },
              },
            }),
            ui.exportOpen
              ? h(
                  'div',
                  { class: 'menu card' },
                  h('button', {
                    type: 'button',
                    id: 'exp-html',
                    text: 'Standalone HTML',
                    on: { click: () => void doExport('html') },
                  }),
                  h('button', {
                    type: 'button',
                    id: 'exp-json',
                    text: 'JSON',
                    on: { click: () => void doExport('json') },
                  }),
                  h('button', {
                    type: 'button',
                    id: 'exp-md',
                    text: 'Copy Markdown summary',
                    on: { click: () => void doExport('md') },
                  }),
                )
              : null,
          ),
          run.config.groups.visual
            ? h('button', {
                type: 'button',
                class: 'btn',
                id: 'btn-baseline',
                text: 'Save this run as baseline',
                on: { click: () => void saveBaseline() },
              })
            : null,
          h('button', {
            type: 'button',
            class: 'btn primary',
            id: 'btn-again',
            text: 'Run again',
            on: { click: () => void runAgain() },
          }),
        )
      : null,
  );
}

function previousRun(): RunRecord | undefined {
  if (!ui.run) return undefined;
  return ui.history.find(
    (r) => r.id !== ui.run!.id && r.startedAt < ui.run!.startedAt && r.status !== 'running',
  );
}

async function doExport(kind: 'html' | 'json' | 'md') {
  const run = ui.run!;
  ui.exportOpen = false;
  const download = (name: string, text: string, type: string) => {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
  };
  const stamp = new Date(run.startedAt).toISOString().slice(0, 10);
  const host = new URL(run.config.origin).hostname;
  if (kind === 'json')
    download(`storefront-qa-${host}-${stamp}.json`, exportJson(run), 'application/json');
  else if (kind === 'html') {
    const shots: Record<string, string> = {};
    for (const id of run.screenshotIds) {
      const u = await shotUrl(id);
      if (u) shots[id] = u;
    }
    download(`storefront-qa-${host}-${stamp}.html`, exportHtml(run, shots), 'text/html');
  } else {
    await navigator.clipboard.writeText(exportMarkdown(run)).catch(() => undefined);
    ui.message = 'Markdown summary copied to the clipboard.';
    setTimeout(() => {
      ui.message = '';
      render();
    }, 2500);
  }
  render();
}

async function saveBaseline() {
  const n = await db.saveRunAsBaseline(ui.run!.id);
  ui.message = n
    ? `Saved ${n} page view${n === 1 ? '' : 's'} as the visual baseline.`
    : 'This run has no visual captures to save.';
  render();
  setTimeout(() => {
    ui.message = '';
    render();
  }, 3000);
}

async function runAgain() {
  const run = ui.run!;
  const options = await loadOptions();
  const cfg: RunConfig = {
    mode: run.config.mode,
    startUrl: run.config.startUrl,
    origin: run.config.origin,
    pages: run.config.pages,
    viewports: run.config.viewports,
    groups: run.config.groups,
    options,
  };
  const id = crypto.randomUUID();
  await setPendingRun({ id, config: cfg, createdAt: Date.now() });
  location.href = chrome.runtime.getURL(`report.html?run=${id}`);
}

function runningView(run: RunRecord): HTMLElement {
  const total = run.pages.length || 1;
  const done = new Set(run.completed.map((c) => c.url));
  const vpCount = Math.max(1, run.config.viewports.length);
  const doneViews = run.completed.length;
  const pct = Math.min(99, Math.round((doneViews / (total * vpCount)) * 100));
  const groups = groupFindings(run.findings);
  const s = summarize(groups);
  const raw = { error: 0, warning: 0, info: 0 } as Record<Severity, number>;
  for (const f of run.findings) raw[f.severity]++;
  const byPage = new Map<string, Record<Severity, number>>();
  for (const f of run.findings) {
    const m = byPage.get(f.url) ?? { error: 0, warning: 0, info: 0 };
    m[f.severity]++;
    byPage.set(f.url, m);
  }
  const latest = run.findings.slice(-6).reverse();
  void s;
  return h(
    'main',
    { class: 'wrap', 'data-state': 'running' },
    h(
      'section',
      { class: 'card pad', 'aria-labelledby': 'run-title' },
      h(
        'div',
        { class: 'row between' },
        h(
          'div',
          null,
          h('h1', { id: 'run-title', text: `${modeLabel(run.config.mode)} check is running` }),
          h('div', {
            class: 'muted',
            text: `${new URL(run.config.origin).host} · ${run.config.viewports.map((v) => VP_LABEL[v]).join(', ')} · ${run.pages.length} page${run.pages.length === 1 ? '' : 's'}`,
          }),
        ),
        h('button', {
          type: 'button',
          class: 'btn danger',
          id: 'btn-cancel',
          text: 'Cancel run',
          on: {
            click: () => {
              ui.cancel = true;
              ui.message = 'Cancelling after the current step…';
              render();
            },
          },
        }),
      ),
      h(
        'div',
        { class: 'row between mt12' },
        h('div', {
          id: 'progress-text',
          class: 'bold',
          text: `Page ${Math.min(run.progress?.page ?? 1, total)} of ${total}`,
        }),
        h('div', { class: 'muted', text: `${duration(run)} elapsed` }),
      ),
      h(
        'div',
        {
          class: 'progress',
          role: 'progressbar',
          'aria-label': 'Run progress',
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': String(pct),
        },
        h('div', { class: 'bar-fill', style: `width:${pct}%` }),
      ),
      h('div', {
        class: 'muted small',
        id: 'progress-label',
        text: run.progress?.label ?? 'Starting…',
      }),
      h(
        'div',
        { class: 'row gap16 muted small mt8' },
        h('span', { text: 'Your own tab isn’t touched' }),
        h('span', { text: 'Results are kept if you cancel' }),
        run.theme?.id ? h('span', { text: `Theme #${run.theme.id} active` }) : null,
      ),
      ui.message ? h('div', { class: 'notice mt8', role: 'status', text: ui.message }) : null,
    ),
    h(
      'section',
      { class: 'card pad', 'aria-labelledby': 'pages-title' },
      h('h2', { id: 'pages-title', text: 'Pages' }),
      h(
        'div',
        { class: 'page-list' },
        run.pages.map((p, i) => {
          const counts = byPage.get(p);
          const isDone = done.has(p);
          const running = !isDone && run.progress?.page === i + 1;
          return h(
            'div',
            { class: 'prow' },
            h('span', { class: 'mono grow ellipsis', text: pathOf(p), title: p }),
            isDone
              ? counts && (counts.error || counts.warning || counts.info)
                ? h(
                    'span',
                    { class: 'row gap6' },
                    counts.error
                      ? h('span', {
                          class: 'sev error',
                          text: `${counts.error} error${counts.error > 1 ? 's' : ''}`,
                        })
                      : null,
                    counts.warning
                      ? h('span', {
                          class: 'sev warning',
                          text: `${counts.warning} warning${counts.warning > 1 ? 's' : ''}`,
                        })
                      : null,
                    counts.info
                      ? h('span', { class: 'sev info', text: `${counts.info} info` })
                      : null,
                  )
                : h('span', { class: 'sev ok', text: 'Clean' })
              : h('span', { class: 'muted small', text: running ? 'Running' : 'Queued' }),
          );
        }),
      ),
    ),
    h(
      'section',
      { class: 'card pad', 'aria-labelledby': 'sofar-title', 'aria-live': 'polite' },
      h('h2', { id: 'sofar-title', text: 'Found so far' }),
      h(
        'div',
        { class: 'row gap16' },
        (['error', 'warning', 'info'] as Severity[]).map((k) =>
          h(
            'div',
            null,
            h('div', { class: 'big', text: String(raw[k]) }),
            h('div', { class: 'muted small', text: SEV_LABEL[k] + (raw[k] === 1 ? '' : 's') }),
          ),
        ),
      ),
      h('div', {
        class: 'muted small',
        text: 'Counted per page, before similar findings are grouped in the final report.',
      }),
      latest.length
        ? h(
            'div',
            { class: 'mt8' },
            h('h3', { text: 'Latest findings' }),
            latest.map((f) =>
              h(
                'div',
                { class: 'prow' },
                sevChip(f.severity),
                h('span', { class: 'grow ellipsis', text: f.title }),
                h('span', { class: 'mono muted small', text: pathOf(f.url) }),
              ),
            ),
          )
        : null,
    ),
  );
}

function filtersBar(groups: FindingGroup[], run: RunRecord): HTMLElement {
  const sums = summarize(groups);
  const f = ui.filters;
  const sevBtn = (label: string, sev?: Severity) =>
    h('button', {
      type: 'button',
      'aria-pressed': String(
        sev ? f.severities?.length === 1 && f.severities[0] === sev : !f.severities?.length,
      ),
      text: `${label} ${sev ? sums.bySeverity[sev] : sums.groups}`,
      'data-sev': sev ?? 'all',
      on: {
        click: () => {
          ui.filters = { ...ui.filters, severities: sev ? [sev] : undefined };
          render();
        },
      },
    });
  const cats = [...new Set(groups.map((g) => g.category))];
  const pages = run.pages;
  const vps = run.config.viewports;
  const sel = (
    label: string,
    id: string,
    opts: [string, string][],
    val: string,
    set: (v: string) => void,
  ) =>
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'muted small', text: label }),
      h(
        'select',
        {
          id,
          on: {
            change: (e) => {
              set((e.target as HTMLSelectElement).value);
              render();
            },
          },
        },
        opts.map(([v, t]) => h('option', { value: v, text: t, selected: v === val })),
      ),
    );
  return h(
    'div',
    { class: 'filters no-print' },
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Severity filter' },
      sevBtn('All'),
      sevBtn('Errors', 'error'),
      sevBtn('Warnings', 'warning'),
      sevBtn('Info', 'info'),
    ),
    sel(
      'Category',
      'f-cat',
      [['', 'All categories'], ...cats.map((c) => [c, CAT_LABEL[c]] as [string, string])],
      f.categories?.[0] ?? '',
      (v) => (ui.filters = { ...ui.filters, categories: v ? [v as Category] : undefined }),
    ),
    sel(
      'Page',
      'f-page',
      [['', `All ${pages.length} pages`], ...pages.map((p) => [p, pathOf(p)] as [string, string])],
      f.page ?? '',
      (v) => (ui.filters = { ...ui.filters, page: v || undefined }),
    ),
    sel(
      'Viewport',
      'f-vp',
      [
        ['', vps.length > 1 ? 'All' : VP_LABEL[vps[0]]],
        ...vps.map((v) => [v, VP_LABEL[v]] as [string, string]),
      ],
      f.viewport ?? '',
      (v) => (ui.filters = { ...ui.filters, viewport: v || undefined }),
    ),
    h(
      'label',
      { class: 'field grow' },
      h('span', { class: 'muted small', text: 'Search' }),
      h('input', {
        type: 'search',
        id: 'f-text',
        placeholder: 'Rule, selector or text',
        value: f.text ?? '',
        on: {
          input: (e) => {
            ui.filters = { ...ui.filters, text: (e.target as HTMLInputElement).value || undefined };
            renderListOnly();
          },
        },
      }),
    ),
  );
}

function groupCard(g: FindingGroup): HTMLElement {
  const open = ui.open.has(g.id);
  const det = h(
    'details',
    {
      class: `finding ${g.severity}`,
      'data-rule': g.rule,
      open,
      'data-gid': g.id,
      on: {
        toggle: (e) => {
          const d = e.target as HTMLDetailsElement;
          if (d.open) ui.open.add(g.id);
          else ui.open.delete(g.id);
        },
      },
    },
    h(
      'summary',
      null,
      sevChip(g.severity),
      h('span', { class: 'ftitle', text: g.title }),
      h('span', { class: 'mono muted small', text: g.rule }),
      h('span', {
        class: 'muted small grow-right',
        text: `${g.pages.length} page${g.pages.length === 1 ? '' : 's'} · ${g.viewports.map((v) => VP_LABEL[v] ?? v).join(', ')}`,
      }),
      g.screenshotId
        ? h('span', { class: 'badge', text: 'Screenshot' })
        : h('span', { class: 'badge off', text: 'No visual' }),
    ),
    h(
      'div',
      { class: 'fbody' },
      h('p', { class: 'fmsg', text: g.message }),
      g.hint ? h('p', { class: 'muted' }, h('b', { text: 'Hint: ' }), g.hint) : null,
      g.selector
        ? h(
            'div',
            null,
            h('span', { class: 'muted small', text: 'Element ' }),
            h('code', { class: 'sel', text: g.selector }),
          )
        : null,
      g.htmlSnippet ? h('pre', { class: 'snippet', text: g.htmlSnippet }) : null,
      h(
        'div',
        { class: 'occ' },
        h('div', {
          class: 'muted small',
          text:
            g.count > g.occurrences.length
              ? `Seen on (${g.occurrences.length} of ${g.count})`
              : `Seen on ${g.occurrences.length} occurrence${g.occurrences.length === 1 ? '' : 's'}`,
        }),
        g.occurrences
          .slice(0, 30)
          .map((o) =>
            h(
              'div',
              { class: 'row gap8 small' },
              h('span', { class: 'mono ellipsis grow', text: pathOf(o.url) }),
              h('span', { class: 'muted', text: VP_LABEL[o.viewport] ?? o.viewport }),
            ),
          ),
      ),
      g.screenshotId ? screenshotBlock(g.screenshotId) : null,
    ),
  );
  return det;
}

function screenshotBlock(id: string): HTMLElement {
  const img = h('img', { class: 'shot', alt: 'Evidence screenshot', loading: 'lazy' });
  void shotUrl(id).then((u) => {
    if (u) img.src = u;
    else
      img.replaceWith(h('div', { class: 'muted small', text: 'Screenshot no longer available.' }));
  });
  return h('div', { class: 'evidence' }, h('div', { class: 'muted small', text: 'Evidence' }), img);
}

function passedList(run: RunRecord): { label: string; ran: number; ok: number }[] {
  const m = new Map<string, { label: string; ran: number; ok: number }>();
  for (const pv of run.completed) {
    for (const r of pv.results) {
      if (r.status === 'skipped') continue;
      const c = CHECKS.find((x) => x.id === r.checkId);
      const e = m.get(r.checkId) ?? {
        label: c?.passedLabel ?? c?.title ?? r.checkId,
        ran: 0,
        ok: 0,
      };
      e.ran++;
      if (r.status === 'passed' && r.findings.length === 0) e.ok++;
      m.set(r.checkId, e);
    }
  }
  return [...m.values()].filter((e) => e.ok > 0);
}

function finishedView(run: RunRecord): HTMLElement {
  const groups = groupFindings(run.findings);
  const sums = summarize(groups);
  const shown = filterGroups(groups, ui.filters);
  const limit = ui.showAll ? shown.length : 7;
  const passed = passedList(run);
  const passedCount = passed.reduce((n, p) => n + p.ok, 0);
  const skipped = [
    ...run.skipped,
    ...run.completed.flatMap((pv) =>
      pv.results
        .filter((r) => r.status === 'skipped')
        .map((r) => ({
          what: `${CHECKS.find((c) => c.id === r.checkId)?.title ?? r.checkId} · ${pathOf(pv.url)}`,
          reason: r.skippedReason ?? '',
        })),
    ),
  ];
  const errored = run.completed.flatMap((pv) =>
    pv.results
      .filter((r) => r.status === 'errored')
      .map((r) => ({
        what: `${r.checkId} · ${pathOf(pv.url)}`,
        reason: r.errorMessage ?? 'check crashed',
      })),
  );
  const enabled = CORE_GROUPS.filter((g) => run.config.groups[g]).map((g) => GROUP_META[g].label);
  const disabled = CORE_GROUPS.filter((g) => !run.config.groups[g]).map((g) => GROUP_META[g].label);
  const extras = (['newsletter', 'cart'] as const)
    .filter((g) => run.config.groups[g])
    .map((g) => (g === 'newsletter' ? 'Newsletter form' : 'Cart actions'));
  const cats = Object.entries(sums.byCategory).sort((a, b) => b[1]! - a[1]!);
  const prev = ui.compareId ? ui.history.find((r) => r.id === ui.compareId) : undefined;
  const diff = prev ? diffRuns(prev.findings, run.findings) : null;
  const th = run.theme;
  return h(
    'main',
    { class: 'wrap', 'data-state': run.status },
    h(
      'section',
      { class: 'card pad', 'aria-labelledby': 'rep-title' },
      h('h1', { id: 'rep-title', text: new URL(run.config.origin).host }),
      th?.id
        ? h('div', {
            class: 'muted',
            text: `Theme ${th.name ?? ''} #${th.id}${th.role ? ' · ' + th.role : ''}`,
          })
        : null,
      h(
        'dl',
        { class: 'meta' },
        meta(
          'Mode',
          `${modeLabel(run.config.mode)} · ${run.pages.length} page${run.pages.length === 1 ? '' : 's'}`,
        ),
        meta('Viewports', run.config.viewports.map((v) => VP_LABEL[v]).join(' · ')),
        meta(
          'Finished',
          `${new Date(run.finishedAt ?? run.startedAt).toLocaleString()} · ${duration(run)}`,
        ),
        meta(
          'Status',
          run.status === 'finished'
            ? 'Finished'
            : run.status === 'cancelled'
              ? 'Cancelled (partial results)'
              : 'Interrupted (partial results)',
        ),
        meta('Extension', `Storefront QA ${run.version}`),
      ),
      h(
        'div',
        { class: 'muted small' },
        `Checks on: ${[...enabled, ...extras].join(', ')}.${disabled.length ? ' Off: ' + disabled.join(', ') + '.' : ''}`,
      ),
      run.notes
        .filter((n) => n !== 'interactions-live')
        .map((n) => h('div', { class: 'notice mt8', text: n })),
      run.sideEffects.map((n) => h('div', { class: 'notice mt8', role: 'status', text: n })),
      run.screenshotsDropped
        ? h('div', {
            class: 'notice mt8',
            text: `${run.screenshotsDropped} screenshots were dropped (cap 120 per run); the findings are still listed.`,
          })
        : null,
    ),
    h(
      'section',
      { class: 'card pad', 'aria-labelledby': 'sum-title' },
      h('h2', { id: 'sum-title', text: 'Summary' }),
      h('div', {
        class: 'muted',
        id: 'sum-line',
        text: `${sums.groups} issue group${sums.groups === 1 ? '' : 's'} from ${sums.total} occurrence${sums.total === 1 ? '' : 's'} across ${run.pages.length} page${run.pages.length === 1 ? '' : 's'} and ${run.config.viewports.length} viewport${run.config.viewports.length === 1 ? '' : 's'}`,
      }),
      h(
        'div',
        { class: 'row gap16 mt8' },
        stat('error', sums.bySeverity.error, 'Errors'),
        stat('warning', sums.bySeverity.warning, 'Warnings'),
        stat('info', sums.bySeverity.info, 'Info'),
        h(
          'div',
          null,
          h('div', { class: 'big', text: String(passedCount) }),
          h('div', { class: 'muted small', text: 'Checks passed' }),
        ),
        h(
          'div',
          null,
          h('div', { class: 'big', text: String(skipped.length + errored.length) }),
          h('div', { class: 'muted small', text: 'Skipped' }),
        ),
      ),
    ),
    cats.length
      ? h(
          'section',
          { class: 'card pad' },
          h('h2', { text: 'Issue groups by category' }),
          h(
            'div',
            { class: 'row gap8 wrap-row' },
            cats.map(([c, n]) =>
              h('span', { class: 'chip', text: `${CAT_LABEL[c as Category]} ${n}` }),
            ),
          ),
        )
      : null,
    h(
      'section',
      { class: 'card pad', 'aria-labelledby': 'find-title' },
      h('h2', { id: 'find-title', text: 'Findings' }),
      groups.length === 0
        ? h('div', { class: 'sev ok', text: 'No issues found.' })
        : filtersBar(groups, run),
      h('div', { id: 'findings-list' }, findingsList(shown, limit)),
    ),
    diff && prev
      ? h(
          'section',
          { class: 'card pad', 'aria-labelledby': 'cmp-title', id: 'compare' },
          h('h2', { id: 'cmp-title', text: 'Compared with previous run' }),
          h('div', {
            class: 'muted',
            text: `${new Date(prev.startedAt).toLocaleString()} · ${summarize(groupFindings(prev.findings)).bySeverity.error} errors`,
          }),
          h(
            'div',
            { class: 'row gap16 mt8' },
            h(
              'div',
              null,
              h('div', { class: 'big', id: 'cmp-new', text: String(diff.added.length) }),
              h('div', { class: 'muted small', text: 'New' }),
            ),
            h(
              'div',
              null,
              h('div', { class: 'big', id: 'cmp-fixed', text: String(diff.fixed.length) }),
              h('div', { class: 'muted small', text: 'Fixed' }),
            ),
            h(
              'div',
              null,
              h('div', { class: 'big', id: 'cmp-same', text: String(diff.unchanged.length) }),
              h('div', { class: 'muted small', text: 'Unchanged' }),
            ),
          ),
          h(
            'ul',
            null,
            diff.added.slice(0, 10).map((g) => h('li', null, h('b', { text: 'New: ' }), g.title)),
            diff.fixed.slice(0, 10).map((g) => h('li', null, h('b', { text: 'Fixed: ' }), g.title)),
          ),
        )
      : ui.compareId
        ? h(
            'section',
            { class: 'card pad' },
            h('h2', { text: 'Compared with previous run' }),
            h('div', { class: 'muted', text: 'No earlier run of this store is stored.' }),
          )
        : null,
    ui.history.length > 1
      ? h(
          'section',
          { class: 'card pad', 'aria-labelledby': 'hist-title', id: 'history' },
          h('h2', { id: 'hist-title', text: `Run history (last ${ui.history.length})` }),
          ui.history.map((r) => {
            const sm = summarize(groupFindings(r.findings));
            return h(
              'div',
              { class: 'prow' },
              h('a', {
                class: 'grow',
                href: chrome.runtime.getURL(`report.html?view=${r.id}`),
                text: `${new Date(r.startedAt).toLocaleString()} · ${modeLabel(r.config.mode)}${r.id === run.id ? ' (this report)' : ''}`,
              }),
              h('span', {
                class: 'muted small',
                text: `${sm.bySeverity.error} errors · ${sm.bySeverity.warning} warnings · ${sm.bySeverity.info} info`,
              }),
            );
          }),
        )
      : null,
    h(
      'section',
      { class: 'card pad', 'aria-labelledby': 'pass-title' },
      h(
        'details',
        {
          class: 'plain',
          open: ui.showPassedAll,
          on: { toggle: (e) => (ui.showPassedAll = (e.target as HTMLDetailsElement).open) },
        },
        h(
          'summary',
          null,
          h('h2', { id: 'pass-title', class: 'inline', text: `Passed checks (${passedCount})` }),
        ),
        passed.length
          ? passed.map((p) =>
              h(
                'div',
                { class: 'prow' },
                h('span', { class: 'grow', text: p.label }),
                h('span', { class: 'muted small', text: `${p.ok} of ${p.ran}` }),
              ),
            )
          : h('div', { class: 'muted', text: 'Nothing passed cleanly.' }),
      ),
    ),
    h(
      'section',
      { class: 'card pad', 'aria-labelledby': 'skip-title' },
      h('h2', { id: 'skip-title', text: 'Skipped' }),
      skipped.length + errored.length === 0
        ? h('div', { class: 'muted', text: 'Nothing was skipped.' })
        : null,
      [...skipped, ...errored]
        .slice(0, 60)
        .map((s) =>
          h(
            'div',
            { class: 'prow' },
            h('span', { class: 'grow', text: s.what }),
            h('span', { class: 'muted small', text: s.reason }),
          ),
        ),
    ),
  );
}

function meta(k: string, v: string) {
  return h(
    'div',
    { class: 'meta-row' },
    h('dt', { class: 'muted', text: k }),
    h('dd', { text: v }),
  );
}
function stat(sev: Severity, n: number, label: string) {
  return h(
    'div',
    null,
    h('div', { class: `big c-${sev}`, 'data-sev': sev, text: String(n) }),
    h('div', { class: 'muted small', text: label }),
  );
}

function findingsList(shown: FindingGroup[], limit: number): Node[] {
  const out: Node[] = shown.slice(0, limit).map(groupCard);
  out.push(
    h(
      'div',
      { class: 'row between mt8' },
      h('div', {
        class: 'muted small',
        text: `Showing ${Math.min(limit, shown.length)} of ${shown.length} issue groups, most severe first`,
      }),
      shown.length > limit
        ? h('button', {
            type: 'button',
            class: 'btn',
            id: 'show-more',
            text: `Show ${shown.length - limit} more`,
            on: {
              click: () => {
                ui.showAll = true;
                render();
              },
            },
          })
        : null,
    ),
  );
  return out;
}

function renderListOnly() {
  const run = ui.run;
  const list = document.getElementById('findings-list');
  if (!run || !list) return render();
  const shown = filterGroups(groupFindings(run.findings), ui.filters);
  list.replaceChildren(...findingsList(shown, ui.showAll ? shown.length : 7));
}

function permissionView(): HTMLElement {
  const p = ui.needPerm!;
  return h(
    'main',
    { class: 'wrap' },
    h(
      'section',
      { class: 'card pad dialog-inline', role: 'dialog', 'aria-labelledby': 'perm-title' },
      h('h1', { id: 'perm-title', text: 'Allow access to run this check?' }),
      h(
        'p',
        null,
        'Storefront QA needs permission to open pages on ',
        h('b', { text: p.origins.join(', ') }),
        p.permissions.includes('debugger')
          ? ' and to use the debugger for tablet and mobile sizes and evidence screenshots. Chrome shows a "started debugging this browser" banner while the QA window runs.'
          : '.',
      ),
      h(
        'div',
        { class: 'row gap8' },
        h('button', {
          type: 'button',
          class: 'btn primary',
          id: 'perm-allow',
          text: 'Allow',
          on: {
            click: async () => {
              const ok = await chrome.permissions.request({
                permissions: p.permissions,
                origins: p.origins,
              });
              if (ok) {
                ui.needPerm = null;
                void start(p.pending);
              } else {
                ui.message = 'Permission was not granted.';
                render();
              }
            },
          },
        }),
        h('button', {
          type: 'button',
          class: 'btn',
          text: 'Skip debugger features',
          on: {
            click: async () => {
              const ok = await chrome.permissions.request({ origins: p.origins });
              if (ok) {
                ui.needPerm = null;
                void start(p.pending);
              }
            },
          },
        }),
      ),
      ui.message ? h('div', { class: 'notice mt8', text: ui.message }) : null,
    ),
  );
}

let raf = 0;
function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const scrollY = window.scrollY;
    const run = ui.run;
    const body = ui.needPerm
      ? permissionView()
      : !run
        ? h('main', { class: 'wrap' }, h('div', { class: 'muted', text: 'Loading…' }))
        : ui.running
          ? runningView(run)
          : finishedView(run);
    root.replaceChildren(
      headerBar(ui.needPerm ? null : run),
      body,
      ...(ui.message && !ui.running
        ? [
            h(
              'div',
              { class: 'toast-region', role: 'status' },
              h('div', { class: 'toast', text: ui.message }),
            ),
          ]
        : []),
    );
    window.scrollTo(0, scrollY);
  });
}

// ---------- run lifecycle ----------

async function start(pending: PendingRun) {
  ui.running = true;
  ui.cancel = false;
  ui.run = null;
  render();
  const run = await executeRun(pending, {
    isCancelled: () => ui.cancel,
    onUpdate: (r) => {
      ui.run = structuredClone(r);
      render();
    },
  });
  ui.running = false;
  ui.run = run;
  ui.history = await db.listRuns(run.config.origin);
  history.replaceState(null, '', `report.html?view=${run.id}`);
  if (__E2E__) {
    // SQA_E2E_HOOK: exposes the finished run to Playwright. Compiled out of production builds.
    (window as unknown as Record<string, unknown>).__sqaE2E = { done: true, run };
  }
  render();
}

async function init() {
  const params = new URLSearchParams(location.search);
  if (__E2E__ && params.get('auto') === '1') {
    // SQA_E2E_HOOK: start a run from the URL so tests need no popup interaction.
    const options = await loadOptions();
    const override = JSON.parse(params.get('opts') ?? '{}') as Partial<Options>;
    const merged = { ...options, ...override } as Options;
    const mode = (params.get('mode') ?? 'quick') as RunConfig['mode'];
    const url = params.get('url')!;
    const pages = JSON.parse(params.get('pages') ?? '[]') as string[];
    const vps = (params.get('viewports') ?? '')
      .split(',')
      .filter(Boolean) as RunConfig['viewports'];
    const groups = {
      ...merged.groups,
      ...(JSON.parse(params.get('groups') ?? '{}') as Record<string, boolean>),
    } as RunConfig['groups'];
    const cfg: RunConfig = {
      mode,
      startUrl: url,
      origin: new URL(url).origin,
      pages: mode === 'pages' ? pages : undefined,
      viewports: vps.length ? vps : ['desktop', 'tablet', 'mobile'],
      groups,
      options: merged,
    };
    (window as unknown as Record<string, unknown>).__sqaE2E = { done: false };
    const tabId = params.get('liveTab');
    await start({
      id: crypto.randomUUID(),
      config: cfg,
      liveTabId: tabId ? Number(tabId) : undefined,
      createdAt: Date.now(),
    });
    return;
  }
  const runId = params.get('run');
  if (runId) {
    const pending = await takePendingRun(runId);
    if (pending) {
      const need = permissionsNeeded(pending.config);
      const has = await chrome.permissions
        .contains({ permissions: need.permissions, origins: need.origins })
        .catch(() => false);
      if (!has && (need.permissions.length || need.origins.length)) {
        ui.needPerm = { pending, ...need };
        return render();
      }
      return void start(pending);
    }
  }
  const viewId = params.get('view') ?? runId;
  if (viewId) {
    const r = await db.getRun(viewId);
    if (r) {
      ui.run = r;
      ui.history = await db.listRuns(r.config.origin);
      return render();
    }
  }
  const all = await db.listRuns();
  if (all[0]) {
    ui.run = all[0];
    ui.history = await db.listRuns(all[0].config.origin);
  }
  render();
}

void init();

export type { Finding };
