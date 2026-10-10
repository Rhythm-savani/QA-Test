// Tiny element builder for extension UIs. Strings become text nodes, never HTML (RPT-10).
type Child = Node | string | number | null | undefined | false | Child[];

export interface Attrs {
  class?: string;
  text?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  [k: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'on') {
        for (const [ev, fn] of Object.entries(v as Record<string, EventListener>))
          el.addEventListener(ev, fn);
      } else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  const add = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Small inline icon from a path list (stroke style matches the design files). */
export function icon(paths: string[], size = 16, extra = ''): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  if (extra) s.setAttribute('class', extra);
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

export const ICONS = {
  store: ['M5 8h14l-1 12H6z', 'M9 8V7a3 3 0 0 1 6 0v1'],
  sliders: [
    'M4 7h7M15 7h5M4 17h3M11 17h9',
    'M13 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M9 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  desktop: [
    'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    'M8 20h8M12 16v4',
  ],
  tablet: ['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M11 18h2'],
  mobile: [
    'M10 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M11 18.2h2',
  ],
  play: ['M7 5l12 7-12 7z'],
  chevron: ['M6 9l6 6 6-6'],
  close: ['M6 6l12 12M18 6L6 18'],
  plus: ['M12 5v14M5 12h14'],
  warn: ['M12 4l9 16H3z', 'M12 10v4M12 17.5v.01'],
  check: ['M5 12l4 4 10-10'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
  info: ['M12 8v.01M11 12h1v5h1', 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z'],
  group: ['M4 6h16M4 12h16M4 18h10'],
};
