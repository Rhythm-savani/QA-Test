import type { Check, Finding, RunContext } from '../shared/types';
import { badgeCount, badgeEl, getCart } from '../shopify/page-helpers';
import { rectOf, selectorFor, snippetOf } from '../engine/dom';
import { makeFinding } from './rules';

type Data = {
  badge: number | null;
  itemCount: number | null;
  selector?: string;
  snippet?: string;
  rect?: { x: number; y: number; w: number; h: number };
};

export const chk14: Check<Data> = {
  id: 'CHK-14',
  title: 'Cart badge',
  category: 'shopify',
  group: 'shopify',
  mutatesState: false,
  defaultEnabled: true,
  needs: ['shopify'],
  viewportScope: 'first',
  passedLabel: 'Cart count badge matches /cart.js',
  async collect() {
    const el = badgeEl();
    const cart = await getCart();
    return {
      badge: badgeCount(),
      itemCount: cart ? cart.item_count : null,
      selector: el ? selectorFor(el) : undefined,
      snippet: el ? snippetOf(el) : undefined,
      rect: el ? rectOf(el) : undefined,
    };
  },
  analyze(d: Data, ctx: RunContext): Finding[] {
    if (d.badge === null || d.itemCount === null || d.badge === d.itemCount) return [];
    return [
      makeFinding('CHK-14', ctx, {
        rule: 'shopify/cart-badge-mismatch',
        severity: 'error',
        message: `Cart badge shows ${d.badge} but /cart.js reports item_count ${d.itemCount}`,
        selector: d.selector,
        htmlSnippet: d.snippet,
        rect: d.rect,
      }),
    ];
  },
};
