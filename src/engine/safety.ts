// Click denylist (SAF-1). Pure string logic is exported separately so it can be unit tested.
import { accessibleName } from './dom';

/** Built-in part of the denylist. The options page can extend it but never shrink it. */
export const BUILTIN_DENY: RegExp[] = [
  /log\s?-?out/i,
  /sign\s?-?out/i,
  /\bdelete\b/i,
  /remove account/i,
  /check\s?-?out/i,
  /\bpay\b/i,
  /place (an )?order/i,
  /buy it now/i,
  /subscribe/i,
  /\bsubmit\b/i,
  /\bsend\b/i,
  /\bapply\b/i,
];

/**
 * Not in the brief's list, but clicking these changes cart or store state, which is opt-in only.
 * (Kept separate from BUILTIN_DENY so the intent is clear in code and tests.)
 */
export const STATE_CHANGING_DENY: RegExp[] = [
  /add to (cart|bag|basket)/i,
  /\bremove\b/i,
  /\bbuy\b/i,
  /\bpurchase\b/i,
  /unsubscribe/i,
];

export const DENY_HREF =
  /(\/account\/logout|\/checkouts?(\/|\?|$)|\/cart\/c\/|\/cart\/(add|change|update|clear))/i;
export const DENY_ACTION = /(\/cart\/(add|change|update|clear)|\/contact|\/account|\/checkouts?)/i;

export const PAYMENT_SELECTOR =
  '.shopify-payment-button, shopify-accelerated-checkout, shopify-accelerated-checkout-cart, [data-shopify="payment-button"], .additional-checkout-buttons, [class*="payment-button"]';

export function compileExtra(extra: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const e of extra) {
    const s = e.trim();
    if (!s) continue;
    try {
      out.push(new RegExp(s, 'i'));
    } catch {
      out.push(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  }
  return out;
}

export interface DenyInput {
  text: string;
  name: string;
  href: string;
  action: string;
  inPayment: boolean;
  nameAttr?: string;
}

export function isDeniedText(i: DenyInput, extra: RegExp[] = []): string | null {
  if (i.inPayment) return 'payment button';
  const hay = [i.text, i.name, i.nameAttr ?? ''].join(' | ');
  for (const r of [...BUILTIN_DENY, ...STATE_CHANGING_DENY, ...extra]) {
    if (r.test(hay)) return `matches ${r}`;
  }
  if (i.href && DENY_HREF.test(i.href)) return 'href is protected';
  if (i.action && DENY_ACTION.test(i.action)) return 'form action is protected';
  return null;
}

/** Page-side wrapper: why this element must not be clicked, or null if it is fine. */
export function denyReason(el: Element, extra: RegExp[] = []): string | null {
  const form = el.closest('form');
  const a = el as HTMLAnchorElement;
  let href = '';
  const rawHref = el.getAttribute('href');
  if (rawHref !== null) {
    try {
      href = new URL(rawHref, location.href).href;
    } catch {
      href = rawHref;
    }
  }
  return isDeniedText(
    {
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
      name: accessibleName(el).slice(0, 120),
      nameAttr: el.getAttribute('name') ?? '',
      href: a.tagName === 'A' ? href : '',
      action: form?.getAttribute('action') ?? '',
      inPayment: !!el.closest(PAYMENT_SELECTOR),
    },
    extra,
  );
}
