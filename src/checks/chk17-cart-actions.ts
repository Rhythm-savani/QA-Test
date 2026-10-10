import type { Check, Finding, RunContext } from '../shared/types';
import {
  addButton,
  addButtonSoldOut,
  badgeCount,
  chooseOption,
  fetchJson,
  getCart,
  optionNames,
  productHandle,
  rootPrefix,
  variantOptions,
  type CartJson,
  type ProductJson,
} from '../shopify/page-helpers';
import { isVisible } from '../engine/dom';
import { makeFinding } from './rules';

type Data = {
  ran: boolean;
  note?: string;
  beforeCount: number;
  addedOk: boolean;
  countAfterAdd: number;
  badgeAfterAdd: number | null;
  uiShowsItem: boolean;
  qtyPlusOk: boolean;
  qtyMinusOk: boolean;
  subtotalOk: boolean;
  removeOk: boolean;
  finalCount: number;
  restored: boolean;
  variantTitle?: string;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function change(key: string, quantity: number): Promise<CartJson | null> {
  try {
    const r = await fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: key, quantity }),
      credentials: 'same-origin',
    });
    return r.ok ? ((await r.json()) as CartJson) : null;
  } catch {
    return null;
  }
}

export const chk17: Check<Data> = {
  id: 'CHK-17',
  title: 'Cart actions',
  category: 'cart',
  group: 'cart',
  mutatesState: true,
  defaultEnabled: false,
  needs: ['productPage', 'shopify'],
  viewportScope: 'first',
  passedLabel: 'Add to cart, quantity change and remove behave consistently',
  async collect(ctx) {
    const empty: Data = {
      ran: false,
      beforeCount: 0,
      addedOk: false,
      countAfterAdd: 0,
      badgeAfterAdd: null,
      uiShowsItem: false,
      qtyPlusOk: false,
      qtyMinusOk: false,
      subtotalOk: false,
      removeOk: false,
      finalCount: 0,
      restored: false,
    };
    if (ctx.params.cartConfirmed !== true) return { ...empty, note: 'cart actions not confirmed' };
    const handle = productHandle();
    if (!handle) return { ...empty, note: 'not a product page' };
    const p = await fetchJson<ProductJson>(`${rootPrefix()}/products/${handle}.js`);
    const before = await getCart();
    if (!p || !before) return { ...empty, note: 'product or cart JSON unavailable' };
    const variant = p.variants.find((v) => v.available);
    if (!variant) return { ...empty, note: 'no available variant' };
    const data: Data = {
      ...empty,
      ran: true,
      beforeCount: before.item_count,
      variantTitle: variant.title,
    };
    const beforeKeys = new Map(before.items.map((i) => [i.key, i.quantity]));
    // the lines this test adds are identified by key/quantity diff, never by guessing
    const addedLines = (cart: CartJson) =>
      cart.items.filter((i) => (beforeKeys.get(i.key) ?? 0) < i.quantity);
    try {
      const names = optionNames(p);
      const opts = variantOptions(variant);
      names.forEach((n, i) => opts[i] !== undefined && chooseOption(n, opts[i]));
      await wait(500);
      const btn = addButton();
      if (!btn || addButtonSoldOut(btn)) {
        data.note = 'add to cart button unavailable';
        return data;
      }
      btn.click();
      for (let i = 0; i < 30; i++) {
        await wait(100);
        const c = await getCart();
        if (c && c.item_count > before.item_count) break;
      }
      const afterAdd = await getCart();
      data.countAfterAdd = afterAdd?.item_count ?? before.item_count;
      data.addedOk = !!afterAdd && afterAdd.item_count === before.item_count + 1;
      await wait(400);
      data.badgeAfterAdd = badgeCount();
      const title = p.title.toLowerCase();
      data.uiShowsItem = Array.from(
        document.querySelectorAll(
          'cart-drawer, cart-notification, .cart-notification, #cart-notification, .cart__items, [id*=cart-drawer]',
        ),
      ).some((e) => isVisible(e) && (e.textContent ?? '').toLowerCase().includes(title));
      if (afterAdd && data.addedOk) {
        const line = addedLines(afterAdd)[0];
        if (line) {
          const up = await change(line.key, line.quantity + 1);
          data.qtyPlusOk = !!up && up.item_count === before.item_count + 2;
          const down = await change(line.key, line.quantity);
          data.qtyMinusOk = !!down && down.item_count === before.item_count + 1;
          const now = await getCart();
          data.subtotalOk =
            !!now && now.total_price === now.items.reduce((s, i) => s + i.line_price, 0);
          await wait(300);
        }
      }
    } finally {
      // SAF-5: remove only the lines this test added, restoring exact previous quantities
      let cur = await getCart();
      if (cur) {
        for (const l of addedLines(cur)) {
          const target = beforeKeys.get(l.key) ?? 0;
          cur = (await change(l.key, target)) ?? cur;
        }
        const finalCart = await getCart();
        data.finalCount = finalCart?.item_count ?? -1;
        data.removeOk = !!finalCart && finalCart.item_count === before.item_count;
        data.restored =
          !!finalCart &&
          finalCart.items.length === before.items.length &&
          finalCart.items.every((i) => beforeKeys.get(i.key) === i.quantity);
      }
    }
    return data;
  },
  analyze(d: Data, ctx: RunContext): Finding[] {
    if (!d.ran) return [];
    const out: Finding[] = [];
    const f = (rule: string, message: string, selector = 'product-form') =>
      out.push(makeFinding('CHK-17', ctx, { rule, severity: 'error', message, selector }));
    if (!d.addedOk)
      f(
        'cart/add-failed',
        `Adding "${d.variantTitle}" to the cart did not increase /cart.js item_count within 3 s`,
        'button[name="add"]',
      );
    else {
      if (d.badgeAfterAdd !== null && d.badgeAfterAdd !== d.countAfterAdd) {
        f(
          'cart/count-mismatch',
          `After adding, the badge shows ${d.badgeAfterAdd} but /cart.js has ${d.countAfterAdd}`,
          '.cart-count-bubble',
        );
      }
      if (!d.uiShowsItem) {
        out.push(
          makeFinding('CHK-17', ctx, {
            rule: 'cart/add-failed',
            severity: 'warning',
            message:
              'After adding, no drawer, notification or cart list showing the item became visible',
            selector: 'cart-drawer',
          }),
        );
      }
      if (!d.qtyPlusOk || !d.qtyMinusOk)
        f(
          'cart/quantity-mismatch',
          'Changing the quantity +1 / -1 did not update /cart.js item_count consistently',
          'cart-items',
        );
      else if (!d.subtotalOk)
        f(
          'cart/quantity-mismatch',
          'Cart total_price does not equal the sum of line prices after quantity changes',
          'cart-items',
        );
    }
    if (!d.removeOk || !d.restored) {
      f(
        'cart/not-restored',
        `The cart did not return to its original state (item_count ${d.finalCount}, expected ${d.beforeCount})`,
        '/cart.js',
      );
    }
    return out;
  },
};
