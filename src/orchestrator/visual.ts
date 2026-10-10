// Pixel comparison for the visual baseline check. Runs in the report page (needs a canvas).
import pixelmatch from 'pixelmatch';
import type { Rect } from '../shared/types';

async function decode(dataUrl: string): Promise<ImageData> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return data;
}

function blank(img: ImageData, masks: Rect[], f: number) {
  for (const m of masks) {
    const x0 = Math.max(0, Math.floor(m.x * f));
    const y0 = Math.max(0, Math.floor(m.y * f));
    const x1 = Math.min(img.width, Math.ceil((m.x + m.w) * f));
    const y1 = Math.min(img.height, Math.ceil((m.y + m.h) * f));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 0;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    }
  }
}

export interface DiffOutcome {
  sizeChanged: boolean;
  ratio: number;
  diffDataUrl?: string;
  w: number;
  h: number;
}

/** `f` = image pixels per CSS pixel (screenshots are scaled), `masks` are in CSS pixels. */
export async function diffImages(
  baselineUrl: string,
  currentUrl: string,
  masks: Rect[],
  f: number,
  threshold = 0.1,
): Promise<DiffOutcome> {
  const [a, b] = await Promise.all([decode(baselineUrl), decode(currentUrl)]);
  if (a.width !== b.width || a.height !== b.height) {
    return { sizeChanged: true, ratio: 1, w: b.width, h: b.height };
  }
  blank(a, masks, f);
  blank(b, masks, f);
  const out = new ImageData(a.width, a.height);
  const diff = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold });
  const ratio = diff / (a.width * a.height);
  let diffDataUrl: string | undefined;
  if (diff > 0) {
    const c = new OffscreenCanvas(a.width, a.height);
    c.getContext('2d')!.putImageData(out, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    diffDataUrl = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(blob);
    });
  }
  return { sizeChanged: false, ratio, diffDataUrl, w: a.width, h: a.height };
}
