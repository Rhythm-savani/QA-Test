// Page-side helpers for Shopify-specific checks (product JSON, cart, price and button lookup).
import { isVisible } from '../engine/dom';

export interface ProductJson {
  id: number;
  title: string;
  handle: string;
  options: string[] | { name: string }[];
  variants: {
    id: number;
    title: string;
    options?: string[];
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    price: number;
    available: boolean;
    featured_image?: { src: string } | null;
  }[];
}

export interface CartJson {
  item_count: number;
  total_price: number;
  items: { key: string; id: number; quantity: number; title: string; line_price: number }[];
}

export function productHandle(): string | null {
  const m = location.pathname.match(/\/products\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function rootPrefix(): string {
  const i = location.pathname.indexOf('/products/');
  return i > 0 ? location.pathname.slice(0, i) : '';
}

export async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const getCart = () => fetchJson<CartJson>('/cart.js');

export function optionNames(p: ProductJson): string[] {
  return (p.options as (string | { name: string })[]).map((o) =>
    typeof o === 'string' ? o : o.name,
  );
}

export function variantOptions(v: ProductJson['variants'][number]): string[] {
  if (v.options) return v.options;
  return [v.option1, v.option2, v.option3].filter((x): x is string => typeof x === 'string');
}

/** Select an option value through the storefront UI (select or radio). Returns false if no control. */
export function chooseOption(name: string, value: string): boolean {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const sel = document.querySelector<HTMLSelectElement>(
    `select[name="options[${esc(name)}]"], select[name="${esc(name)}"]`,
  );
  if (sel) {
    sel.value = value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const radios = Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${esc(name)}"]`),
  );
  const r = radios.find((x) => x.value === value);
  if (r) {
    r.checked = true;
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

export function currentSelection(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const esc = n.replace(/"/g, '\\"');
    const sel = document.querySelector<HTMLSelectElement>(
      `select[name="options[${esc}]"], select[name="${esc}"]`,
    );
    if (sel) {
      out[n] = sel.value;
      continue;
    }
    const r = document.querySelector<HTMLInputElement>(`input[type=radio][name="${esc}"]:checked`);
    if (r) out[n] = r.value;
  }
  return out;
}

export function addButton(): HTMLButtonElement | null {
  return (
    document.querySelector<HTMLButtonElement>('product-form button[name="add"]') ??
    document.querySelector<HTMLButtonElement>('button[name="add"]') ??
    document.querySelector<HTMLButtonElement>('form[action*="/cart/add"] button[type="submit"]')
  );
}

export function addButtonSoldOut(btn: HTMLButtonElement | null): boolean {
  if (!btn) return true;
  return (
    btn.disabled ||
    btn.getAttribute('aria-disabled') === 'true' ||
    /sold out|unavailable/i.test(btn.textContent ?? '')
  );
}

export function priceText(): string {
  const scope =
    document.querySelector('product-info, .product__info-container, .product, main') ??
    document.body;
  const pick = (sel: string) =>
    Array.from(scope.querySelectorAll(sel)).find(
      (e) => isVisible(e) && (e.textContent ?? '').trim(),
    );
  const el =
    pick('.price-item--sale') ??
    pick('.price-item--regular') ??
    pick('.price__regular') ??
    pick('.price');
  return (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
}

export function mainMediaSrc(): string {
  const scope = document.querySelector('main') ?? document.body;
  let best: HTMLImageElement | null = null;
  let area = 0;
  for (const img of Array.from(scope.querySelectorAll('img'))) {
    if (!isVisible(img)) continue;
    const r = img.getBoundingClientRect();
    if (r.width * r.height > area) {
      area = r.width * r.height;
      best = img;
    }
  }
  return best?.currentSrc || best?.getAttribute('src') || '';
}

export function badgeEl(): Element | null {
  return (
    document.querySelector('.cart-count-bubble span[aria-hidden="true"]') ??
    document.querySelector('.cart-count-bubble') ??
    document.querySelector('[data-cart-count], [data-cart-count-bubble], #cart-icon-bubble .count')
  );
}

export function badgeCount(): number | null {
  const el = badgeEl();
  if (!el) return null;
  const m = (el.textContent ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

export function cartIconPresent(): boolean {
  return !!document.querySelector('#cart-icon-bubble, a[href$="/cart"], [data-cart-icon]');
}
