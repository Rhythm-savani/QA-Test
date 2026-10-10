// Every rule slug the extension can emit, with a title and a (Dawn-aware where known) fix hint.
import type { Category, Finding, RunContext, Rect, Severity } from '../shared/types';
import { fingerprint, truncate } from '../shared/util';

export interface RuleInfo {
  title: string;
  category: Category;
  hint?: string;
}

export const RULES: Record<string, RuleInfo> = {
  'health/uncaught-exception': {
    title: 'Uncaught JavaScript exception',
    category: 'health',
    hint: 'Open DevTools on this page and check the stack. Often a theme app block or a custom snippet referencing something that is not on the page.',
  },
  'health/console-error': {
    title: 'console.error call',
    category: 'health',
    hint: 'Find the logging source and fix the cause, or remove the log if it is expected.',
  },
  'health/unhandled-rejection': {
    title: 'Unhandled promise rejection',
    category: 'health',
    hint: 'Add a .catch or try/await handling around the failing fetch or async call.',
  },
  'health/csp-violation': {
    title: 'Content-Security-Policy violation',
    category: 'health',
    hint: 'A resource was blocked by CSP. Check inline scripts and third-party hosts.',
  },
  'health/console-warn': { title: 'console.warn call', category: 'health' },
  'health/network-failure': {
    title: 'Request failed',
    category: 'health',
    hint: 'Check the URL exists. For theme assets run `shopify theme push` or fix the asset_url filter name.',
  },
  'health/page-timeout': {
    title: 'Page timed out',
    category: 'health',
    hint: 'The page did not finish loading within the timeout. Check for hanging requests.',
  },
  'health/load-error': { title: 'Page failed to load', category: 'health' },

  'media/broken-image': {
    title: 'Broken image',
    category: 'media',
    hint: 'The image URL does not load. In Dawn check the image_url filter input and that the asset exists.',
  },
  'media/missing-alt': {
    title: 'Image without alt attribute',
    category: 'media',
    hint: 'Add alt text (alt="" for purely decorative images).',
  },
  'media/stretched-image': {
    title: 'Stretched image',
    category: 'media',
    hint: 'Rendered aspect ratio differs from the file. Use object-fit: cover/contain or fix the container ratio.',
  },
  'media/video-error': { title: 'Video failed to load', category: 'media' },
  'media/oversized-image': {
    title: 'Oversized image',
    category: 'media',
    hint: 'Use image_url with a width and a responsive srcset/sizes.',
  },

  'links/broken-internal': {
    title: 'Broken internal link',
    category: 'links',
    hint: 'The link target returns an error. Fix the URL or create the page/redirect.',
  },
  'links/broken-external': { title: 'Broken external link', category: 'links' },
  'links/dead-anchor': {
    title: 'Link with no destination',
    category: 'links',
    hint: 'Empty, "#" or javascript: href. Use a real URL or a <button>.',
  },
  'links/malformed-contact': { title: 'Malformed mailto/tel link', category: 'links' },
  'links/capped': { title: 'Link check capped', category: 'links' },
  'links/noopener-missing': {
    title: 'target=_blank without rel=noopener',
    category: 'links',
    hint: 'Add rel="noopener".',
  },

  'content/liquid-error': {
    title: 'Liquid error shown on page',
    category: 'content',
    hint: 'A Liquid tag failed during render. Check the section/snippet named in the message.',
  },
  'content/translation-missing': {
    title: 'Missing translation',
    category: 'content',
    hint: 'Add the key to locales/*.json or fix the key name in the t filter.',
  },
  'content/raw-template-syntax': {
    title: 'Raw template syntax or placeholder value shown',
    category: 'content',
    hint: 'Unrendered {{ }} / {% %}, [object Object], undefined or NaN reached the page.',
  },
  'content/placeholder-text': {
    title: 'Placeholder text',
    category: 'content',
    hint: 'Replace Lorem ipsum with real content.',
  },
  'content/empty-section': {
    title: 'Empty section',
    category: 'content',
    hint: 'The section renders nothing visible. Check its settings/blocks or hide it when empty.',
  },
  'content/empty-heading': { title: 'Empty heading', category: 'content' },
  'content/font-failed': {
    title: 'Font failed to load',
    category: 'content',
    hint: 'The font file returned an error. Check the @font-face src URL or the font_url filter.',
  },

  'layout/horizontal-overflow': {
    title: 'Horizontal overflow',
    category: 'layout',
    hint: 'Something is wider than the viewport. Look for fixed widths, 100vw usage or unwrapped long strings.',
  },
  'layout/obscured-interactive': {
    title: 'Interactive element is covered',
    category: 'layout',
    hint: 'Another element sits on top of this one. Check z-index and absolutely-positioned overlays.',
  },
  'layout/clipped-text': { title: 'Clipped text', category: 'layout' },
  'layout/tap-target-small': {
    title: 'Tap target too small',
    category: 'layout',
    hint: 'Make the clickable area at least 24x24 CSS px (44x44 recommended).',
  },
  'layout/tap-target-strict': { title: 'Tap target under 44px', category: 'layout' },
  'layout/fixed-covers-viewport': {
    title: 'Fixed element covers much of the viewport',
    category: 'layout',
    hint: 'Sticky/fixed bars taking over a third of a phone screen hurt usability.',
  },

  'interaction/trigger-no-effect': {
    title: 'Trigger has no visible effect',
    category: 'interaction',
    hint: 'Clicking did nothing observable. Check the JS handler, aria-controls target and that the component script loaded.',
  },
  'interaction/close-obscured': {
    title: 'Close button is covered',
    category: 'interaction',
    hint: 'Something overlaps the close control. Check z-index/stacking of the drawer or modal header.',
  },
  'interaction/close-no-effect': {
    title: 'Close button does not close',
    category: 'interaction',
    hint: 'The close control has no working handler. In Dawn it relies on the details-modal / drawer custom element.',
  },
  'interaction/escape-not-closing': {
    title: 'Escape does not close',
    category: 'interaction',
    hint: 'Add a keydown Escape handler (Dawn: details-modal and cart-drawer already do).',
  },
  'interaction/backdrop-not-closing': {
    title: 'Backdrop click does not close',
    category: 'interaction',
  },
  'interaction/scroll-lock-stuck': {
    title: 'Page scroll stays locked after closing',
    category: 'interaction',
    hint: 'The overflow-hidden class/style was not removed on close. Remove the lock in the close path.',
  },
  'interaction/focus-not-moved': { title: 'Focus not moved into dialog', category: 'interaction' },
  'interaction/focus-not-returned': {
    title: 'Focus not returned to trigger',
    category: 'interaction',
  },
  'interaction/carousel-no-effect': {
    title: 'Carousel button has no effect',
    category: 'interaction',
    hint: 'Next/previous did not move the slider. Check slider-component initialisation.',
  },
  'interaction/tab-panel-mismatch': {
    title: 'Tab or accordion panel did not change',
    category: 'interaction',
  },
  'interaction/unexpected-navigation': {
    title: 'Interaction navigated away',
    category: 'interaction',
  },

  'performance/lcp': {
    title: 'Largest Contentful Paint',
    category: 'performance',
    hint: 'Numbers are indicative (measured in your browser).',
  },
  'performance/fcp': { title: 'First Contentful Paint', category: 'performance' },
  'performance/cls': { title: 'Cumulative Layout Shift', category: 'performance' },
  'performance/ttfb': { title: 'Time to First Byte', category: 'performance' },
  'performance/lcp-lazy': {
    title: 'LCP image is lazy-loaded',
    category: 'performance',
    hint: 'Remove loading="lazy" from the above-the-fold hero image (Dawn: loading: nil / eager for the first section).',
  },
  'performance/lcp-priority': {
    title: 'LCP image lacks fetchpriority=high',
    category: 'performance',
  },
  'performance/render-blocking': {
    title: 'Render-blocking scripts in <head>',
    category: 'performance',
    hint: 'Add defer/async or move scripts to the end of the body.',
  },
  'performance/dom-size': { title: 'Large DOM', category: 'performance' },
  'performance/transfer-size': { title: 'Page weight and requests', category: 'performance' },
  'performance/third-party': { title: 'Many third-party hosts', category: 'performance' },

  'seo/title-missing': {
    title: 'Missing page title',
    category: 'seo',
    hint: 'Add a non-empty <title> (Dawn: {{ page_title }} in theme.liquid).',
  },
  'seo/description-missing': { title: 'Missing meta description', category: 'seo' },
  'seo/h1-count': { title: 'Page should have exactly one h1', category: 'seo' },
  'seo/lang-missing': { title: 'Missing <html lang>', category: 'seo' },
  'seo/viewport-missing': { title: 'Missing viewport meta', category: 'seo' },
  'seo/canonical-missing': { title: 'Missing canonical link', category: 'seo' },
  'seo/noindex': { title: 'Page is noindex', category: 'seo', hint: 'Expected on preview themes.' },

  'shopify/theme-changed': {
    title: 'Theme changed during the run',
    category: 'shopify',
    hint: 'A page rendered a different theme than the first one. Preview parameters may have been lost.',
  },
  'shopify/variant-price-mismatch': {
    title: 'Variant price differs from product JSON',
    category: 'shopify',
    hint: 'The price shown does not update (or updates wrongly) when this variant is selected.',
  },
  'shopify/variant-availability-mismatch': {
    title: 'Variant availability mismatch',
    category: 'shopify',
    hint: 'Add to cart state does not match the variant availability.',
  },
  'shopify/variant-url-missing': { title: 'Variant not reflected in URL', category: 'shopify' },
  'shopify/variant-media-unchanged': { title: 'Variant image did not change', category: 'shopify' },
  'shopify/variant-console-error': {
    title: 'Console error while changing variant',
    category: 'shopify',
  },
  'shopify/cart-badge-mismatch': {
    title: 'Cart count badge differs from cart',
    category: 'shopify',
    hint: 'The header badge is out of sync with /cart.js item_count.',
  },
  'shopify/search-failed': { title: 'Search did not work', category: 'shopify' },

  'newsletter/form-invalid': { title: 'Newsletter form misconfigured', category: 'newsletter' },
  'newsletter/no-success-state': {
    title: 'Newsletter submit shows no success state',
    category: 'newsletter',
  },
  'newsletter/not-testable': { title: 'Newsletter form not testable', category: 'newsletter' },

  'cart/add-failed': { title: 'Add to cart did not work', category: 'cart' },
  'cart/count-mismatch': { title: 'Cart badge not updated', category: 'cart' },
  'cart/quantity-mismatch': { title: 'Quantity change inconsistent', category: 'cart' },
  'cart/remove-failed': { title: 'Remove from cart did not work', category: 'cart' },
  'cart/not-restored': { title: 'Cart not restored to its original state', category: 'cart' },

  'custom/rule-failed': { title: 'Custom rule failed', category: 'interaction' },
  'safety/left-safe-zone': {
    title: 'Navigation to a protected page was blocked',
    category: 'safety',
  },
  'check/errored': { title: 'A check crashed', category: 'health' },
};

export function ruleInfo(rule: string): RuleInfo {
  if (RULES[rule]) return RULES[rule];
  if (rule.startsWith('a11y/axe:')) {
    return { title: 'Accessibility: ' + rule.slice(9), category: 'a11y' };
  }
  return { title: rule, category: 'health' };
}

export interface FindingInput {
  rule: string;
  severity: Severity;
  message: string;
  title?: string;
  selector?: string;
  htmlSnippet?: string;
  rect?: Rect;
  hint?: string;
  meta?: Record<string, unknown>;
  /** Overrides ctx.url (e.g. for run-level findings). */
  url?: string;
}

export function makeFinding(
  checkId: string,
  ctx: Pick<RunContext, 'url' | 'viewport'>,
  p: FindingInput,
): Finding {
  const info = ruleInfo(p.rule);
  const message = truncate(p.message, 600);
  return {
    id: fingerprint(checkId, p.rule, p.selector, message),
    checkId,
    rule: p.rule,
    severity: p.severity,
    category: info.category,
    title: p.title ?? info.title,
    message,
    url: p.url ?? ctx.url,
    viewport: ctx.viewport,
    selector: p.selector,
    htmlSnippet: p.htmlSnippet ? truncate(p.htmlSnippet, 400) : undefined,
    rect: p.rect,
    hint: p.hint ?? info.hint,
    meta: p.meta,
  };
}

/** Categories whose findings can point at a visible region (RPT-7). */
export const VISUAL_RULES = new Set<string>([
  'layout/horizontal-overflow',
  'layout/obscured-interactive',
  'layout/clipped-text',
  'layout/tap-target-small',
  'layout/tap-target-strict',
  'layout/fixed-covers-viewport',
  'media/broken-image',
  'media/missing-alt',
  'media/stretched-image',
  'media/oversized-image',
  'media/video-error',
  'content/empty-section',
  'content/empty-heading',
  'content/liquid-error',
  'content/translation-missing',
  'content/raw-template-syntax',
  'content/placeholder-text',
  'interaction/close-obscured',
  'interaction/close-no-effect',
  'interaction/escape-not-closing',
  'interaction/backdrop-not-closing',
  'interaction/scroll-lock-stuck',
  'interaction/trigger-no-effect',
  'interaction/carousel-no-effect',
  'interaction/tab-panel-mismatch',
  'shopify/variant-price-mismatch',
  'shopify/variant-availability-mismatch',
  'shopify/cart-badge-mismatch',
  'newsletter/form-invalid',
  'newsletter/no-success-state',
  'custom/rule-failed',
]);

export function isVisualFinding(f: Finding): boolean {
  if (f.rule.startsWith('a11y/axe:')) return !!f.selector;
  return VISUAL_RULES.has(f.rule);
}
