import type { Check, Finding, RunContext } from '../shared/types';
import { makeFinding } from './rules';

type Data = {
  title: string | null;
  description: string | null;
  h1Count: number;
  lang: string | null;
  viewport: string | null;
  canonical: string | null;
  robots: string | null;
};

export const chk12: Check<Data> = {
  id: 'CHK-12',
  title: 'Page basics',
  category: 'seo',
  group: 'basics',
  mutatesState: false,
  defaultEnabled: true,
  viewportScope: 'first',
  passedLabel: 'Title, description, single h1, lang, viewport and canonical are present',
  async collect() {
    const meta = (n: string) =>
      document.querySelector<HTMLMetaElement>(`meta[name="${n}"]`)?.content?.trim() ?? null;
    const titleEl = document.querySelector('title');
    return {
      title: titleEl ? (titleEl.textContent ?? '').trim() : null,
      description: meta('description'),
      h1Count: document.querySelectorAll('h1').length,
      lang: document.documentElement.getAttribute('lang'),
      viewport: meta('viewport'),
      canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
      robots: meta('robots'),
    };
  },
  analyze(d: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    const f = (rule: string, severity: 'warning' | 'info', message: string, selector: string) =>
      out.push(makeFinding('CHK-12', ctx, { rule, severity, message, selector }));
    if (!d.title || /^undefined$/i.test(d.title)) {
      f(
        'seo/title-missing',
        'warning',
        d.title ? `Page title is "${d.title}"` : 'Page has no <title> or it is empty',
        'head > title',
      );
    }
    if (!d.description) f('seo/description-missing', 'warning', 'No meta description', 'head');
    if (d.h1Count !== 1) {
      f(
        'seo/h1-count',
        'warning',
        d.h1Count === 0 ? 'Page has no h1' : `Page has ${d.h1Count} h1 elements`,
        'h1',
      );
    }
    if (!d.lang)
      f('seo/lang-missing', 'warning', 'The <html> element has no lang attribute', 'html');
    if (!d.viewport) f('seo/viewport-missing', 'warning', 'No viewport meta tag', 'head');
    if (!d.canonical) f('seo/canonical-missing', 'info', 'No canonical link', 'head');
    if (d.robots && /noindex/i.test(d.robots)) {
      f('seo/noindex', 'info', 'Page is marked noindex (expected on preview themes)', 'head');
    }
    return out;
  },
};
