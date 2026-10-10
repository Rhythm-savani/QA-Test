import type { Category, Finding, Severity } from '../shared/types';

export interface Occurrence {
  url: string;
  viewport: string;
  selector?: string;
  message: string;
  htmlSnippet?: string;
  screenshotId?: string;
  rect?: Finding['rect'];
}

export interface FindingGroup {
  id: string;
  rule: string;
  checkId: string;
  severity: Severity;
  category: Category;
  title: string;
  message: string;
  hint?: string;
  selector?: string;
  htmlSnippet?: string;
  screenshotId?: string;
  count: number;
  pages: string[];
  viewports: string[];
  occurrences: Occurrence[];
}

const SEV_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
export const severityRank = (s: Severity) => SEV_RANK[s];

/** RPT-4: findings sharing a fingerprint collapse into one group "seen on N pages / viewports". */
export function groupFindings(findings: Finding[]): FindingGroup[] {
  const map = new Map<string, FindingGroup>();
  for (const f of findings) {
    let g = map.get(f.id);
    if (!g) {
      g = {
        id: f.id,
        rule: f.rule,
        checkId: f.checkId,
        severity: f.severity,
        category: f.category,
        title: f.title,
        message: f.message,
        hint: f.hint,
        selector: f.selector,
        htmlSnippet: f.htmlSnippet,
        screenshotId: f.screenshotId,
        count: 0,
        pages: [],
        viewports: [],
        occurrences: [],
      };
      map.set(f.id, g);
    }
    if (SEV_RANK[f.severity] < SEV_RANK[g.severity]) g.severity = f.severity;
    if (!g.screenshotId && f.screenshotId) g.screenshotId = f.screenshotId;
    g.count++;
    if (!g.pages.includes(f.url)) g.pages.push(f.url);
    if (!g.viewports.includes(f.viewport)) g.viewports.push(f.viewport);
    g.occurrences.push({
      url: f.url,
      viewport: f.viewport,
      selector: f.selector,
      message: f.message,
      htmlSnippet: f.htmlSnippet,
      screenshotId: f.screenshotId,
      rect: f.rect,
    });
  }
  return [...map.values()].sort(
    (a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
      b.pages.length * b.viewports.length - a.pages.length * a.viewports.length ||
      a.rule.localeCompare(b.rule),
  );
}

export interface Summary {
  bySeverity: Record<Severity, number>;
  byCategory: Partial<Record<Category, number>>;
  groups: number;
  total: number;
}

export function summarize(groups: FindingGroup[]): Summary {
  const s: Summary = {
    bySeverity: { error: 0, warning: 0, info: 0 },
    byCategory: {},
    groups: groups.length,
    total: groups.reduce((n, g) => n + g.count, 0),
  };
  for (const g of groups) {
    s.bySeverity[g.severity]++;
    s.byCategory[g.category] = (s.byCategory[g.category] ?? 0) + 1;
  }
  return s;
}

export interface Filters {
  severities?: Severity[];
  categories?: Category[];
  page?: string;
  viewport?: string;
  text?: string;
}

export function filterGroups(groups: FindingGroup[], f: Filters): FindingGroup[] {
  const t = f.text?.trim().toLowerCase();
  return groups.filter((g) => {
    if (f.severities?.length && !f.severities.includes(g.severity)) return false;
    if (f.categories?.length && !f.categories.includes(g.category)) return false;
    if (f.page && !g.pages.includes(f.page)) return false;
    if (f.viewport && !g.viewports.includes(f.viewport)) return false;
    if (t) {
      const hay = [g.title, g.message, g.rule, g.selector, g.htmlSnippet, ...g.pages]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  });
}

export interface RunDiff {
  added: FindingGroup[];
  fixed: FindingGroup[];
  unchanged: FindingGroup[];
}

/** RPT-8: compare two runs by fingerprint. */
export function diffRuns(before: Finding[], after: Finding[]): RunDiff {
  const a = groupFindings(before);
  const b = groupFindings(after);
  const aIds = new Set(a.map((g) => g.id));
  const bIds = new Set(b.map((g) => g.id));
  return {
    added: b.filter((g) => !aIds.has(g.id)),
    fixed: a.filter((g) => !bIds.has(g.id)),
    unchanged: b.filter((g) => aIds.has(g.id)),
  };
}
