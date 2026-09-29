// Main-thread side of the background worker, with a same-thread fallback for browsers
// that can't run module workers (old Safari) — results are identical, only slower.
import { warpSize, warpPx, filterPx } from './pixels.js';

let worker = null, broken = false, seq = 0;
const pending = new Map();

function getWorker() {
  if (broken) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        e.data.ok ? p.res(e.data.result) : p.rej(new Error(e.data.error));
      };
      worker.onerror = () => {
        broken = true; worker = null;
        for (const p of pending.values()) p.rej(new Error('worker unavailable'));
        pending.clear();
      };
    } catch { broken = true; return null; }
  }
  return worker;
}

function call(task, payload, transfer = []) {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('worker unavailable'));
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    w.postMessage({ id, task, payload }, transfer);
  });
}

const pixelsOf = (canvas) => {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return { data: d.data, width: d.width, height: d.height };
};
const toCanvas = (img) => {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
};

/** Perspective-correct `quad` (px, [tl,tr,br,bl]) of a canvas and apply a scan filter. */
export async function warpAndFilter(canvas, quad, maxDim = 2200, filter = 'original') {
  const img = pixelsOf(canvas);
  try {
    return toCanvas(await call('warpFilter', { img, quad, maxDim, filter }, [img.data.buffer]));
  } catch {
    const src = img.data.byteLength ? img : pixelsOf(canvas); // buffer may have been transferred
    const { W, H } = warpSize(quad, maxDim);
    let out = warpPx(src, quad, W, H);
    if (filter && filter !== 'original') out = filterPx(out, filter);
    return toCanvas(out);
  }
}

/**
 * JPEG bytes for a canvas. MozJPEG in the worker makes files ~10–20% smaller at the same quality;
 * falls back to the browser's encoder. `progressive` only for standalone image files (PDFs get baseline).
 */
export async function encodeJpeg(canvas, q = 0.85, { progressive = false } = {}) {
  let img;
  try {
    // flatten transparency onto white first (JPEG has no alpha)
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(canvas, 0, 0);
    img = pixelsOf(c);
    c.width = c.height = 0;
    return await call('jpeg', { img, q, progressive }, [img.data.buffer]);
  } catch {
    const s = atob(canvas.toDataURL('image/jpeg', q).split(',')[1]);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
}

/** True when work really runs off the main thread (for status/tests). */
export const workerReady = () => !!getWorker();
