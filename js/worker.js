// Background worker: heavy pixel work + MozJPEG encoding, so the page never freezes.
import { warpSize, warpPx, filterPx } from './pixels.js';

let moz = null, mozFailed = false;

/** JPEG bytes for an RGBA image: MozJPEG (smaller files) → OffscreenCanvas → give up (main thread falls back). */
async function jpeg(img, q, progressive) {
  if (!mozFailed) {
    try {
      if (!moz) moz = (await import('../vendor/jsquash/encode.js')).default;
      const buf = await moz(img, { quality: Math.round(Math.min(1, Math.max(0.05, q)) * 100), progressive: !!progressive, optimize_coding: true });
      return new Uint8Array(buf);
    } catch (e) { mozFailed = true; }
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: q })).arrayBuffer());
  }
  throw new Error('no jpeg encoder in worker');
}

const tasks = {
  async warpFilter({ img, quad, maxDim, filter }) {
    const { W, H } = warpSize(quad, maxDim);
    let out = warpPx(img, quad, W, H);
    if (filter && filter !== 'original') out = filterPx(out, filter);
    return { result: out, transfer: [out.data.buffer] };
  },
  async jpeg({ img, q, progressive }) {
    const bytes = await jpeg(img, q, progressive);
    return { result: bytes, transfer: [bytes.buffer] };
  },
};

self.onmessage = async (e) => {
  const { id, task, payload } = e.data;
  try {
    const { result, transfer } = await tasks[task](payload);
    self.postMessage({ id, ok: true, result }, transfer || []);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
