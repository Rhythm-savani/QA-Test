import type { Check, Finding, RunContext } from '../shared/types';
import { pricesMatch } from '../shared/money';
import {
  addButton,
  addButtonSoldOut,
  chooseOption,
  currentSelection,
  fetchJson,
  mainMediaSrc,
  optionNames,
  priceText,
  productHandle,
  rootPrefix,
  variantOptions,
  type ProductJson,
} from '../shopify/page-helpers';
import { makeFinding } from './rules';

interface VariantObs {
  id: number;
  title: string;
  jsonPrice: number;
  available: boolean;
  hasFeaturedImage: boolean;
  featuredSrc: string;
  controlFound: boolean;
  urlVariant: string | null;
  priceText: string;
  soldOutUi: boolean;
  media: string;
  consoleErrors: string[];
}
type Data = {
  handle: string | null;
  variants: VariantObs[];
  total: number;
  note?: string;
};

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const chk13: Check<Data> = {
  id: 'CHK-13',
  title: 'Product variants',
  category: 'shopify',
  group: 'shopify',
  mutatesState: false,
  defaultEnabled: true,
  needs: ['productPage', 'shopify'],
  viewportScope: 'first',
  passedLabel: 'Variant price, availability and URL match the product JSON',
  async collect(ctx) {
    const handle = productHandle();
    if (!handle) return { handle: null, variants: [], total: 0, note: 'not a product page' };
    const p = await fetchJson<ProductJson>(`${rootPrefix()}/products/${handle}.js`);
    if (!p) return { handle, variants: [], total: 0, note: 'product JSON unavailable' };
    const names = optionNames(p);
    const original = currentSelection(names);
    const originalUrl = location.href;
    const max = Number(ctx.options.variantsMax ?? 8);
    const out: VariantObs[] = [];
    let prevFeatured = '';
    for (const v of p.variants.slice(0, max)) {
      const errBefore = window.__sqa?.events.length ?? 0;
      const opts = variantOptions(v);
      let found = names.length > 0;
      names.forEach((n, i) => {
        if (opts[i] !== undefined && !chooseOption(n, opts[i])) found = false;
      });
      // let the theme fetch/render the new variant, but never wait on a no-op
      const t0 = performance.now();
      while (performance.now() - t0 < 1800) {
        await settle(120);
        if (
          new URL(location.href).searchParams.get('variant') === String(v.id) &&
          performance.now() - t0 > 400
        )
          break;
      }
      await settle(150);
      const btn = addButton();
      const errs = (window.__sqa?.events.slice(errBefore) ?? [])
        .filter(
          (e) => e.kind === 'console-error' || e.kind === 'exception' || e.kind === 'rejection',
        )
        .map((e) => e.message.slice(0, 160));
      const media = mainMediaSrc();
      out.push({
        id: v.id,
        title: v.title,
        jsonPrice: v.price,
        available: v.available,
        hasFeaturedImage: !!v.featured_image,
        featuredSrc: v.featured_image?.src ?? '',
        controlFound: found,
        urlVariant: new URL(location.href).searchParams.get('variant'),
        priceText: priceText(),
        soldOutUi: addButtonSoldOut(btn),
        media: media === prevFeatured ? 'SAME:' + media : media,
        consoleErrors: errs,
      });
      prevFeatured = media;
    }
    // restore the original selection and URL
    for (const [n, val] of Object.entries(original)) chooseOption(n, val);
    await settle(600);
    if (location.href !== originalUrl) history.replaceState(history.state, '', originalUrl);
    return { handle, variants: out, total: p.variants.length };
  },
  analyze(d: Data, ctx: RunContext): Finding[] {
    const out: Finding[] = [];
    let prevFeatured = '';
    for (const v of d.variants) {
      if (!v.controlFound) continue;
      const base = { selector: 'variant-selects', meta: { variantId: v.id, handle: d.handle } };
      if (!pricesMatch(v.priceText, v.jsonPrice)) {
        out.push(
          makeFinding('CHK-13', ctx, {
            ...base,
            rule: 'shopify/variant-price-mismatch',
            severity: 'error',
            message: `Variant "${v.title}": page shows "${v.priceText}" but product JSON price is ${v.jsonPrice}`,
            selector: '.price',
          }),
        );
      }
      if (v.available === v.soldOutUi) {
        out.push(
          makeFinding('CHK-13', ctx, {
            ...base,
            rule: 'shopify/variant-availability-mismatch',
            severity: 'error',
            message: `Variant "${v.title}" is ${v.available ? 'available' : 'sold out'} in the JSON but the add-to-cart button is ${v.soldOutUi ? 'disabled/sold out' : 'enabled'}`,
            selector: 'button[name="add"]',
          }),
        );
      }
      if (v.urlVariant !== String(v.id)) {
        out.push(
          makeFinding('CHK-13', ctx, {
            ...base,
            rule: 'shopify/variant-url-missing',
            severity: 'info',
            message: `Selecting "${v.title}" did not put variant=${v.id} in the URL`,
          }),
        );
      }
      if (
        v.hasFeaturedImage &&
        v.featuredSrc !== prevFeatured &&
        prevFeatured &&
        v.media.startsWith('SAME:')
      ) {
        out.push(
          makeFinding('CHK-13', ctx, {
            ...base,
            rule: 'shopify/variant-media-unchanged',
            severity: 'warning',
            message: `Main product image did not change for variant "${v.title}" (best-effort check)`,
          }),
        );
      }
      if (v.featuredSrc) prevFeatured = v.featuredSrc;
      for (const e of v.consoleErrors) {
        out.push(
          makeFinding('CHK-13', ctx, {
            ...base,
            rule: 'shopify/variant-console-error',
            severity: 'warning',
            message: `Console error while selecting "${v.title}": ${e}`,
          }),
        );
      }
    }
    return out;
  },
};
