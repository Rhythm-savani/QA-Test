// Exporters (RPT-9). Everything derived from the audited page is untrusted: HTML output is built
// from escaped strings only, and has no scripts and no external requests.
import type { RunRecord } from '../shared/types';
import { escapeHtml } from '../shared/util';
import { groupFindings, summarize, type FindingGroup } from './grouping';

export function exportJson(run: RunRecord): string {
  return JSON.stringify(run, null, 2);
}

export function exportMarkdown(run: RunRecord): string {
  const groups = groupFindings(run.findings);
  const s = summarize(groups);
  const md = (t: string) => t.replace(/([\\`*_{}[\]()#+!|<>])/g, '\\$1').replace(/\n/g, ' ');
  const lines: string[] = [];
  lines.push(`# Storefront QA report`);
  lines.push('');
  lines.push(`- **Store:** ${md(run.config.origin)}`);
  lines.push(`- **Mode:** ${run.config.mode} · **Viewports:** ${run.config.viewports.join(', ')}`);
  if (run.theme?.name)
    lines.push(
      `- **Theme:** ${md(run.theme.name)} (#${run.theme.id ?? '?'}, ${run.theme.role ?? '?'})`,
    );
  lines.push(
    `- **Date:** ${new Date(run.startedAt).toISOString()} · **Extension:** v${run.version}`,
  );
  lines.push(`- **Pages:** ${run.pages.length}`);
  lines.push('');
  lines.push(
    `**${s.bySeverity.error} errors · ${s.bySeverity.warning} warnings · ${s.bySeverity.info} info** (${s.groups} unique findings)`,
  );
  for (const sev of ['error', 'warning', 'info'] as const) {
    const gs = groups.filter((g) => g.severity === sev);
    if (!gs.length) continue;
    lines.push(
      '',
      `## ${sev === 'error' ? 'Errors' : sev === 'warning' ? 'Warnings' : 'Info'}`,
      '',
    );
    for (const g of gs) {
      lines.push(
        `- **${md(g.title)}** \`${g.rule}\` — ${md(g.message)} _(seen on ${g.pages.length} page(s), ${g.viewports.join('/')})_`,
      );
      if (g.selector) lines.push(`  - selector: \`${g.selector.replace(/`/g, "'")}\``);
      if (g.hint) lines.push(`  - hint: ${md(g.hint)}`);
    }
  }
  if (run.skipped.length) {
    lines.push('', '## Skipped', '');
    for (const k of run.skipped) lines.push(`- ${md(k.what)}: ${md(k.reason)}`);
  }
  if (run.sideEffects.length) {
    lines.push('', '## Changes made to the store', '');
    for (const e of run.sideEffects) lines.push(`- ${md(e)}`);
  }
  return lines.join('\n') + '\n';
}

const CSS = `body{font:14px/1.5 system-ui,sans-serif;color:#14171c;background:#f3f5f8;margin:0;padding:24px}
h1{font-size:20px;margin:0 0 4px}.muted{color:#566070}.card{background:#fff;border:1px solid #dde1e8;border-radius:10px;padding:12px 16px;margin:12px 0}
.sev{display:inline-block;font-size:11px;font-weight:700;border-radius:6px;padding:2px 8px;text-transform:uppercase}
.error{background:#fde8e8;color:#9b1c1c}.warning{background:#fdf1d8;color:#7a4a00}.info{background:#e3effa;color:#1b4f8a}
code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}pre{background:#eef0f4;padding:8px;border-radius:6px;white-space:pre-wrap;word-break:break-all}
img{max-width:100%;border:1px solid #dde1e8;border-radius:6px}`;

export function exportHtml(run: RunRecord, screenshots: Record<string, string>): string {
  const groups = groupFindings(run.findings);
  const s = summarize(groups);
  const e = escapeHtml;
  const card = (g: FindingGroup) => {
    const shot = g.screenshotId ? screenshots[g.screenshotId] : undefined;
    const imgOk = shot && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(shot);
    return `<div class="card"><span class="sev ${e(g.severity)}">${e(g.severity)}</span> <strong>${e(g.title)}</strong>
<span class="muted"> · ${e(g.category)} · <code>${e(g.rule)}</code> · seen on ${g.pages.length} page(s) / ${e(g.viewports.join(', '))}</span>
<p>${e(g.message)}</p>
${g.selector ? `<div><span class="muted">Selector</span> <code>${e(g.selector)}</code></div>` : ''}
${g.htmlSnippet ? `<pre>${e(g.htmlSnippet)}</pre>` : ''}
${g.hint ? `<div class="muted">Hint: ${e(g.hint)}</div>` : ''}
${imgOk ? `<p><img alt="Evidence screenshot" src="${shot}"></p>` : ''}
<details><summary>${g.occurrences.length} occurrence(s)</summary><ul>${g.occurrences
      .slice(0, 50)
      .map(
        (o) =>
          `<li><code>${e(o.viewport)}</code> ${e(o.url)}${o.selector ? ' — <code>' + e(o.selector) + '</code>' : ''}</li>`,
      )
      .join('')}</ul></details></div>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Storefront QA report</title><style>${CSS}</style></head><body>
<h1>Storefront QA report</h1>
<div class="muted">${e(run.config.origin)} · ${e(run.config.mode)} mode · ${e(run.config.viewports.join(', '))} · ${e(new Date(run.startedAt).toISOString())} · v${e(run.version)}</div>
<div class="card"><strong>${s.bySeverity.error}</strong> errors · <strong>${s.bySeverity.warning}</strong> warnings · <strong>${s.bySeverity.info}</strong> info · ${s.groups} unique findings across ${run.pages.length} page(s)</div>
${groups.map(card).join('\n')}
${run.skipped.length ? `<h2>Skipped</h2><ul>${run.skipped.map((k) => `<li>${e(k.what)}: ${e(k.reason)}</li>`).join('')}</ul>` : ''}
${run.sideEffects.length ? `<h2>Changes made to the store</h2><ul>${run.sideEffects.map((k) => `<li>${e(k)}</li>`).join('')}</ul>` : ''}
</body></html>`;
}
