// URL helpers: origin rewriting, preview-parameter carry-over, Pages-mode normalisation.

/** Parameters that keep a preview theme (or similar) active across navigations. */
export const PREVIEW_PARAMS = [
  'preview_theme_id',
  'pb',
  'preview_script_id',
  'oseid',
  'key',
  'fts',
];

export function previewParamsOf(startUrl: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const u = new URL(startUrl);
    for (const k of PREVIEW_PARAMS) {
      const v = u.searchParams.get(k);
      if (v !== null) out[k] = v;
    }
  } catch {
    // not a URL
  }
  return out;
}

export function withPreviewParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  return u.toString();
}

/** Re-point a URL (possibly on another host, e.g. the primary domain from a sitemap) at `origin`. */
export function rewriteToOrigin(url: string, origin: string): string {
  const u = new URL(url, origin);
  const o = new URL(origin);
  u.protocol = o.protocol;
  u.host = o.host;
  return u.toString();
}

export type AddPageResult = { ok: true; url: string; path: string } | { ok: false; error: string };

/** Normalise a user-entered full URL or `/path` against the active tab's origin. */
export function normalizePageEntry(input: string, origin: string, startUrl: string): AddPageResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Enter a URL or a /path.' };
  let u: URL;
  try {
    u = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(raw.startsWith('/') ? raw : '/' + raw, origin);
  } catch {
    return { ok: false, error: 'That is not a valid URL or path.' };
  }
  if (u.origin !== new URL(origin).origin) {
    return { ok: false, error: `Only pages on ${new URL(origin).host} can be checked.` };
  }
  u.hash = '';
  const full = withPreviewParams(u.toString(), previewParamsOf(startUrl));
  const fu = new URL(full);
  return { ok: true, url: full, path: fu.pathname + fu.search };
}

export function dedupe<T>(
  list: T[],
  key: (t: T) => string = String as unknown as (t: T) => string,
): T[] {
  const seen = new Set<string>();
  return list.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function isHttpUrl(url: string | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

/** Pages that must never be visited or interacted with (SAF-3). */
export function isCheckoutUrl(url: string): boolean {
  try {
    const p = new URL(url).pathname;
    return (
      /^\/checkouts?(\/|$)/i.test(p) || /^\/cart\/c\//i.test(p) || /^\/\d+\/checkouts\//i.test(p)
    );
  } catch {
    return false;
  }
}

export function originOf(url: string): string {
  return new URL(url).origin;
}
