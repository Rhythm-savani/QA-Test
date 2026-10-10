import type { Check, Finding, RunContext } from '../shared/types';
import { inAny, selectorFor, snippetOf } from '../engine/dom';
import { makeFinding } from './rules';

interface Link {
  selector: string;
  snippet: string;
  rawHref: string;
  href: string;
  target: string;
  rel: string;
  buttonish: boolean;
  sameOrigin: boolean;
  scheme: string;
}
type Data = {
  links: Link[];
  /** href -> status (0 = network error), only the targets fetched or cached. */
  statuses: Record<string, number>;
  capped: number;
};

const MAILTO = /^mailto:[^@\s?]+@[^@\s?]+\.[^@\s?]+/i;
const TEL = /^tel:\+?[\d\s\-().]{3,}$/i;
const SPACING_MS = 150;

export const chk04: Check<Data> = {
  id: 'CHK-04',
  title: 'Links',
  category: 'links',
  group: 'links',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'first',
  passedLabel: 'Internal links resolve and hrefs are well-formed',
  async collect(ctx) {
    const cache = (ctx.params.linkCache ?? {}) as Record<string, number>;
    const max = ctx.options.maxLinks;
    const links: Link[] = [];
    for (const a of Array.from(document.querySelectorAll('a'))) {
      if (inAny(a, ctx.options.skipSelectors)) continue;
      const rawHref = a.getAttribute('href');
      if (rawHref === null) continue;
      let href = '';
      let sameOrigin = false;
      let scheme = '';
      try {
        const u = new URL(rawHref, location.href);
        scheme = u.protocol;
        href = u.href.split('#')[0];
        sameOrigin = u.origin === location.origin;
      } catch {
        scheme = 'invalid';
      }
      links.push({
        selector: selectorFor(a),
        snippet: snippetOf(a),
        rawHref,
        href,
        target: a.getAttribute('target') ?? '',
        rel: a.getAttribute('rel') ?? '',
        buttonish:
          a.getAttribute('role') === 'button' ||
          a.hasAttribute('aria-controls') ||
          a.hasAttribute('aria-expanded'),
        sameOrigin,
        scheme,
      });
      if (links.length >= 3000) break;
    }
    // Fetch unique http(s) targets with a rate limit (SAF-7).
    const statuses: Record<string, number> = {};
    const targets: string[] = [];
    const seen = new Set<string>();
    for (const l of links) {
      if (!/^https?:$/.test(l.scheme) || !l.href || seen.has(l.href)) continue;
      if (!l.sameOrigin && !ctx.options.checkExternalLinks) continue;
      // never touch protected URLs (SAF-1/SAF-3), even with a HEAD request
      if (/\/(checkouts?|account\/logout)(\/|\?|$)/i.test(new URL(l.href).pathname)) continue;
      seen.add(l.href);
      targets.push(l.href);
    }
    const capped = Math.max(0, targets.length - max);
    for (const href of targets.slice(0, max)) {
      if (href in cache) {
        statuses[href] = cache[href];
        continue;
      }
      let status = 0;
      try {
        const external = new URL(href).origin !== location.origin;
        if (external) {
          await fetch(href, { mode: 'no-cors', method: 'GET' });
          status = 200;
        } else {
          let res = await fetch(href, { method: 'HEAD' });
          if (res.status === 405 || res.status === 501) res = await fetch(href, { method: 'GET' });
          status = res.status;
        }
      } catch {
        status = 0;
      }
      statuses[href] = status;
      await new Promise((r) => setTimeout(r, SPACING_MS));
    }
    return { links, statuses, capped };
  },
  analyze(data: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    const reported = new Set<string>();
    for (const l of data.links) {
      const base = { selector: l.selector, htmlSnippet: l.snippet };
      const raw = l.rawHref.trim();
      if (!l.buttonish && (raw === '' || raw === '#' || /^javascript:/i.test(raw))) {
        out.push(
          makeFinding('CHK-04', ctx, {
            ...base,
            rule: 'links/dead-anchor',
            severity: 'warning',
            message: `Link has ${raw === '' ? 'an empty' : `a "${raw}"`} href`,
          }),
        );
        continue;
      }
      if (/^mailto:/i.test(raw) && !MAILTO.test(raw)) {
        out.push(
          makeFinding('CHK-04', ctx, {
            ...base,
            rule: 'links/malformed-contact',
            severity: 'warning',
            message: `Malformed mailto link: ${raw}`,
          }),
        );
      } else if (/^tel:/i.test(raw) && !TEL.test(raw)) {
        out.push(
          makeFinding('CHK-04', ctx, {
            ...base,
            rule: 'links/malformed-contact',
            severity: 'warning',
            message: `Malformed tel link: ${raw}`,
          }),
        );
      }
      if (l.target === '_blank' && !/noopener|noreferrer/i.test(l.rel)) {
        out.push(
          makeFinding('CHK-04', ctx, {
            ...base,
            rule: 'links/noopener-missing',
            severity: 'info',
            message: `target="_blank" without rel="noopener": ${raw}`,
          }),
        );
      }
      const status = data.statuses[l.href];
      if (status !== undefined && !reported.has(l.href)) {
        if (l.sameOrigin && (status === 0 || status >= 400)) {
          reported.add(l.href);
          out.push(
            makeFinding('CHK-04', ctx, {
              ...base,
              rule: 'links/broken-internal',
              severity: 'error',
              message: `Link target returns ${status || 'a network error'}: ${pathOf(l.href)}`,
              meta: { href: l.href, status },
            }),
          );
        } else if (!l.sameOrigin && status === 0) {
          reported.add(l.href);
          out.push(
            makeFinding('CHK-04', ctx, {
              ...base,
              rule: 'links/broken-external',
              severity: 'warning',
              message: `External link could not be reached: ${l.href}`,
              meta: { href: l.href },
            }),
          );
        }
      }
    }
    if (data.capped > 0) {
      out.push(
        makeFinding('CHK-04', ctx, {
          rule: 'links/capped',
          severity: 'info',
          message: `Only the first ${Object.keys(data.statuses).length} links were fetched; ${data.capped} more were not checked.`,
        }),
      );
    }
    return out;
  },
};

function pathOf(href: string): string {
  try {
    const u = new URL(href);
    return u.pathname + u.search;
  } catch {
    return href;
  }
}
