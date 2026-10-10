import type { Check, Finding, RunContext, Severity } from '../shared/types';
import { makeFinding } from './rules';

interface AxeNode {
  target: string[];
  html: string;
  failureSummary: string;
}
interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
  totalNodes: number;
}
type Data = { violations: AxeViolation[]; unavailable?: boolean };

const NODE_CAP = 20;

export function axeSeverity(impact: string | null): Severity {
  if (impact === 'critical' || impact === 'serious') return 'error';
  if (impact === 'moderate') return 'warning';
  return 'info';
}

interface AxeApi {
  run(
    ctx: Document,
    opts: { runOnly: { type: string; values: string[] }; resultTypes: string[] },
  ): Promise<{
    violations: {
      id: string;
      impact: string | null;
      help: string;
      helpUrl: string;
      tags: string[];
      nodes: { target: unknown[]; html: string; failureSummary?: string }[];
    }[];
  }>;
}

export const chk10: Check<Data> = {
  id: 'CHK-10',
  title: 'Accessibility',
  category: 'a11y',
  group: 'accessibility',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'first',
  passedLabel: 'axe-core found no WCAG 2.0/2.1 A/AA or best-practice violations',
  async collect() {
    // axe-core is injected separately by the orchestrator right before this check runs.
    const axe = (window as unknown as { axe?: AxeApi }).axe;
    if (!axe) return { violations: [], unavailable: true };
    const res = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
      },
      resultTypes: ['violations'],
    });
    return {
      violations: res.violations
        .filter((v) => !v.tags.includes('experimental'))
        .map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          helpUrl: v.helpUrl,
          totalNodes: v.nodes.length,
          nodes: v.nodes.slice(0, NODE_CAP).map((n) => ({
            target: n.target.filter((t): t is string => typeof t === 'string'),
            html: n.html.slice(0, 300),
            failureSummary: (n.failureSummary ?? '').slice(0, 400),
          })),
        })),
    };
  },
  analyze(d: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    for (const v of d.violations) {
      const severity = axeSeverity(v.impact);
      for (const n of v.nodes) {
        out.push(
          makeFinding('CHK-10', ctx, {
            rule: `a11y/axe:${v.id}`,
            severity,
            title: v.help,
            message: `${v.help}${n.failureSummary ? ' — ' + n.failureSummary.replace(/\s+/g, ' ') : ''}`,
            selector: n.target[0],
            htmlSnippet: n.html,
            hint: `See ${v.helpUrl}`,
            meta: { helpUrl: v.helpUrl, impact: v.impact, totalNodes: v.totalNodes },
          }),
        );
      }
      if (v.totalNodes > NODE_CAP) {
        out.push(
          makeFinding('CHK-10', ctx, {
            rule: `a11y/axe:${v.id}`,
            severity: 'info',
            title: v.help,
            message: `Showing ${NODE_CAP} of ${v.totalNodes} elements for "${v.id}"`,
            selector: `axe:${v.id}:truncated`,
          }),
        );
      }
    }
    return out;
  },
};
