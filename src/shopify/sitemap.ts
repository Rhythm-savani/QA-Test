// Sitemap parsing and deterministic page sampling for Full mode (RUN-6). Pure functions only.
import { dedupe, previewParamsOf, rewriteToOrigin, withPreviewParams } from '../shared/url';

export type PageKind =
  | 'home'
  | 'collection'
  | 'product'
  | 'page'
  | 'blog'
  | 'article'
  | 'cart'
  | 'search'
  | 'not-found'
  | 'custom'
  | 'other';

export interface PlannedPage {
  url: string;
  kind: PageKind;
  /** The document itself is expected to answer 404 (the guaranteed-404 sample). */
  expect404?: boolean;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

export function parseLocs(xml: string): { locs: string[]; isIndex: boolean } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) locs.push(decode(m[1]));
  return { locs, isIndex };
}

export function classify(url: string): PageKind {
  let p: string;
  try {
    p = new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return 'other';
  }
  // strip a leading locale segment such as /en or /fr-ca
  p = p.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/i, '');
  if (p === '/' || p === '') return 'home';
  if (/^\/products\/[^/]+$/.test(p)) return 'product';
  if (/^\/collections\/[^/]+$/.test(p)) return 'collection';
  if (/^\/pages\/[^/]+$/.test(p)) return 'page';
  if (/^\/blogs\/[^/]+$/.test(p)) return 'blog';
  if (/^\/blogs\/[^/]+\/[^/]+$/.test(p)) return 'article';
  if (p === '/cart') return 'cart';
  if (p === '/search') return 'search';
  return 'other';
}

export interface SampleCounts {
  home: number;
  collections: number;
  products: number;
  pages: number;
  blog: number;
  article: number;
}

export interface PlanInput {
  /** Every URL found in sitemaps (any host). */
  listed: string[];
  origin: string;
  startUrl: string;
  counts: SampleCounts;
  customPaths: string[];
  maxPages: number;
  searchQuery?: string;
}

export const NOT_FOUND_PATH = '/pages/storefront-qa-404-check';

export function planPages(input: PlanInput): PlannedPage[] {
  const preview = previewParamsOf(input.startUrl);
  const carry = (u: string) => withPreviewParams(rewriteToOrigin(u, input.origin), preview);
  const byKind: Record<string, string[]> = {};
  for (const raw of input.listed) {
    let u: string;
    try {
      u = rewriteToOrigin(raw, input.origin);
    } catch {
      continue;
    }
    const k = classify(u);
    (byKind[k] ??= []).push(u);
  }
  for (const k of Object.keys(byKind)) byKind[k] = dedupe(byKind[k]).sort();
  const take = (k: PageKind, n: number): PlannedPage[] =>
    (byKind[k] ?? []).slice(0, n).map((u) => ({ url: carry(u), kind: k }));
  const out: PlannedPage[] = [];
  if (input.counts.home > 0) out.push({ url: carry('/'), kind: 'home' });
  out.push(
    { url: carry('/cart'), kind: 'cart' },
    { url: carry(`/search?q=${encodeURIComponent(input.searchQuery || 'a')}`), kind: 'search' },
    { url: carry(NOT_FOUND_PATH), kind: 'not-found', expect404: true },
  );
  for (const p of input.customPaths) {
    try {
      out.push({ url: carry(p.startsWith('/') ? p : '/' + p), kind: 'custom' });
    } catch {
      // skip malformed custom path
    }
  }
  out.push(
    ...take('collection', input.counts.collections),
    ...take('product', input.counts.products),
    ...take('page', input.counts.pages),
    ...take('blog', input.counts.blog),
    ...take('article', input.counts.article),
  );
  const seen = new Set<string>();
  const unique = out.filter((p) => {
    const key = p.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, Math.max(1, input.maxPages));
}

/** Fallback when no sitemap exists: collect internal hrefs from a rendered/fetched home page. */
export function linksFromHtml(html: string, origin: string): string[] {
  const out: string[] = [];
  const re = /href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = decode(m[1]);
    if (/^\/(?!\/)/.test(href) || href.startsWith(origin)) {
      try {
        const u = new URL(href, origin);
        if (u.origin === new URL(origin).origin) out.push(u.origin + u.pathname);
      } catch {
        // ignore
      }
    }
  }
  return dedupe(out);
}
