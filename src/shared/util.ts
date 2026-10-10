// Small dependency-free helpers shared by every context (page, worker, UI).

/** Synchronous SHA-1 (hex). Used for finding fingerprints, not for security. */
export function sha1(msg: string): string {
  const bytes = new TextEncoder().encode(msg);
  const l = bytes.length;
  const withPad = new Uint8Array((((l + 8) >> 6) + 1) << 6);
  withPad.set(bytes);
  withPad[l] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, (l * 8) >>> 0);
  dv.setUint32(withPad.length - 8, Math.floor((l * 8) / 4294967296));
  let h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rol = (n: number, s: number) => (n << s) | (n >>> (32 - s));
  for (let i = 0; i < withPad.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 80; t++) w[t] = rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;
    for (let t = 0; t < 80; t++) {
      let f: number, k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const tmp = (rol(a, 5) + f + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = rol(b, 30) >>> 0;
      b = a;
      a = tmp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, '0')).join('');
}

/** Strip volatile bits (numbers, whitespace, case) so equal problems fingerprint equally. */
export function normalizeForFingerprint(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function fingerprint(
  checkId: string,
  rule: string,
  selector?: string,
  message?: string,
): string {
  return sha1(
    [checkId, rule, normalizeForFingerprint(selector), normalizeForFingerprint(message)].join('|'),
  );
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Compile user-supplied regex strings; invalid ones are dropped silently. */
export function compileRegexes(list: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const s of list) {
    if (!s.trim()) continue;
    try {
      out.push(new RegExp(s, 'i'));
    } catch {
      // ignored on purpose: options validation reports bad patterns to the user
    }
  }
  return out;
}

export function matchesAny(text: string, res: RegExp[]): boolean {
  return res.some((r) => r.test(text));
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
