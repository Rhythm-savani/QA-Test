/**
 * Money text -> minor-unit digits. Locales differ in separators and symbols, so we keep only
 * digits; a trailing ".00"-style fraction is normalised so "$10" and "$10.00" compare equal.
 */
export function moneyToMinorUnits(text: string): string | null {
  const t = text.replace(/\u00a0/g, ' ').trim();
  const m = t.match(/\d[\d.,\s']*\d|\d/);
  if (!m) return null;
  const raw = m[0].replace(/[\s']/g, '');
  // Decimal part = last separator followed by 1-2 digits (not 3, which is a thousands group).
  const dec = raw.match(/[.,](\d{1,2})$/);
  const whole = dec ? raw.slice(0, raw.length - dec[0].length) : raw;
  const wholeDigits = whole.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '');
  const frac = (dec ? dec[1] : '').padEnd(2, '0');
  return `${wholeDigits}${frac}`;
}

/** Compare a displayed price string with a Shopify JSON price (integer minor units). */
export function pricesMatch(displayed: string, jsonMinor: number): boolean {
  const d = moneyToMinorUnits(displayed);
  if (d === null) return false;
  return Number(d) === jsonMinor;
}
