// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Finding, RunRecord } from '../src/shared/types';
import { diffRuns, filterGroups, groupFindings, summarize } from '../src/report/grouping';
import { exportHtml, exportJson, exportMarkdown } from '../src/report/export';
import { cssEscape, selectorFor, snippetOf } from '../src/engine/dom';
import { XSS } from '../fixtures/site.mjs';

const f = (o: Partial<Finding>): Finding => ({
  id: 'id1',
  checkId: 'CHK-03',
  rule: 'media/missing-alt',
  severity: 'warning',
  category: 'media',
  title: 'Image without alt attribute',
  message: 'msg',
  url: 'https://s.test/',
  viewport: 'desktop',
  ...o,
});

const run = (findings: Finding[]): RunRecord => ({
  id: 'r',
  version: '0.1.0',
  startedAt: 0,
  finishedAt: 1000,
  status: 'finished',
  config: {
    mode: 'quick',
    startUrl: 'https://s.test/',
    origin: 'https://s.test',
    viewports: ['desktop'],
    groups: {} as RunRecord['config']['groups'],
    optionsSnapshot: {},
  },
  pages: ['https://s.test/'],
  completed: [],
  findings,
  skipped: [{ what: 'Mobile', reason: 'permission not granted' }],
  notes: [],
  screenshotsDropped: 0,
  screenshotIds: [],
  sideEffects: [],
});

describe('grouping (RPT-4)', () => {
  const list = [
    f({ id: 'a', url: 'https://s.test/', viewport: 'desktop' }),
    f({ id: 'a', url: 'https://s.test/x', viewport: 'mobile', severity: 'error' }),
    f({ id: 'b', rule: 'seo/title-missing', category: 'seo', severity: 'info' }),
  ];
  it('collapses by fingerprint and takes the highest severity', () => {
    const g = groupFindings(list);
    expect(g).toHaveLength(2);
    expect(g[0].id).toBe('a');
    expect(g[0].severity).toBe('error');
    expect(g[0].pages).toHaveLength(2);
    expect(g[0].viewports.sort()).toEqual(['desktop', 'mobile']);
    expect(g[0].count).toBe(2);
  });
  it('summarises by severity and category', () => {
    const s = summarize(groupFindings(list));
    expect(s.bySeverity).toEqual({ error: 1, warning: 0, info: 1 });
    expect(s.byCategory).toEqual({ media: 1, seo: 1 });
    expect(s.total).toBe(3);
  });
  it('filters by severity, category, page, viewport and text', () => {
    const g = groupFindings(list);
    expect(filterGroups(g, { severities: ['info'] })).toHaveLength(1);
    expect(filterGroups(g, { categories: ['seo'] })).toHaveLength(1);
    expect(filterGroups(g, { page: 'https://s.test/x' })).toHaveLength(1);
    expect(filterGroups(g, { viewport: 'mobile' })).toHaveLength(1);
    expect(filterGroups(g, { text: 'TITLE-MISSING' })).toHaveLength(1);
    expect(filterGroups(g, {})).toHaveLength(2);
  });
});

describe('run comparison (RPT-8)', () => {
  it('splits new, fixed and unchanged by fingerprint', () => {
    const before = [f({ id: 'a' }), f({ id: 'b' })];
    const after = [f({ id: 'b' }), f({ id: 'c' })];
    const d = diffRuns(before, after);
    expect(d.added.map((g) => g.id)).toEqual(['c']);
    expect(d.fixed.map((g) => g.id)).toEqual(['a']);
    expect(d.unchanged.map((g) => g.id)).toEqual(['b']);
  });
});

describe('exports escape page-derived text (RPT-9, RPT-10)', () => {
  const evil = f({
    id: 'x',
    title: XSS,
    message: XSS,
    selector: `img[title="${XSS}"]`,
    htmlSnippet: `<img title="${XSS}">`,
    url: 'https://s.test/?q=' + XSS,
    hint: XSS,
    screenshotId: 's1',
  });
  it('renders the payload as inert text in the standalone HTML', () => {
    const html = exportHtml(run([evil]), { s1: 'data:image/jpeg;base64,AAAA' });
    document.body.innerHTML = '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(doc.querySelectorAll('img[onerror]')).toHaveLength(0);
    expect(doc.querySelectorAll('img')).toHaveLength(1); // only the evidence screenshot
    expect(doc.body.textContent).toContain('onerror="window.__pwned=1"');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\/[^"'\s<]*\.(js|css)/); // no external requests
  });
  it('refuses to inline non-image data URLs', () => {
    const html = exportHtml(run([evil]), { s1: 'javascript:alert(1)' });
    expect(html).not.toContain('javascript:');
  });
  it('markdown and json keep the payload inert', () => {
    const md = exportMarkdown(run([evil]));
    expect(md.replace(/\\</g, '').includes('<img')).toBe(false);
    expect(JSON.parse(exportJson(run([evil]))).findings[0].title).toBe(XSS);
  });
});

describe('selector generator', () => {
  const html = `<div id="root"><header><ul><li><a class="nav">A</a></li><li><a class="nav">B</a></li></ul></header>
  <main><section id="shopify-section-x__hero"><button class="btn primary">1</button><button class="btn primary">2</button></section>
  <p data-testid="para">t</p><span class="css-1x2y3z">h</span></main></div>`;
  const q = (s: string) => {
    document.body.innerHTML = html;
    return document.querySelector(s)!;
  };
  it('prefers ids and stays unique', () => {
    const el = q('#shopify-section-x__hero');
    expect(selectorFor(el)).toBe('#shopify-section-x__hero');
  });
  it('uses stable data attributes', () => {
    expect(selectorFor(q('p'))).toContain('data-testid="para"');
  });
  it('disambiguates siblings with nth-of-type and resolves back to the element', () => {
    for (const s of ['li:nth-child(2) a', 'button:nth-child(2)', 'span']) {
      const el = q(s);
      const sel = selectorFor(el);
      expect(document.querySelectorAll(sel)).toHaveLength(1);
      expect(document.querySelector(sel)).toBe(el);
    }
  });
  it('skips hashed class names', () => {
    expect(selectorFor(q('span'))).not.toContain('css-1x2y3z');
  });
  it('escapes ids and builds snippets', () => {
    expect(cssEscape('a:b.c')).toBe('a\\:b\\.c');
    expect(snippetOf(q('p'))).toBe('<p data-testid="para">t</p>');
  });
});
