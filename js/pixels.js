// Pure pixel routines (no DOM / canvas) — run inside the Web Worker, or on the main thread as a fallback.
// Images are { data: Uint8ClampedArray (RGBA), width, height }.

/** Solve 8x8 linear system (Gaussian elimination). */
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

/** Homography mapping points `from` → `to` (4 pairs). Returns [a..h] with i=1. */
export function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solve(A, b);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Output size for warping `quad` ([tl,tr,br,bl] in px), capped to maxDim. */
export function warpSize(quad, maxDim = 2200) {
  let W = Math.round(Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2])));
  let H = Math.round(Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2])));
  const k = Math.min(1, maxDim / Math.max(W, H));
  return { W: Math.max(1, Math.round(W * k)), H: Math.max(1, Math.round(H * k)) };
}

/** Perspective-correct the quad into a W×H image (bilinear sampling). */
export function warpPx(src, quad, W, H) {
  const hm = homography([[0, 0], [W, 0], [W, H], [0, H]], quad);
  const sw = src.width, sh = src.height, sd = src.data;
  const d = new Uint8ClampedArray(W * H * 4);
  const [a, b, c, e, f, g, p, q] = hm;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const den = p * x + q * y + 1;
      let sx = (a * x + b * y + c) / den, sy = (e * x + f * y + g) / den;
      if (sx < 0) sx = 0; if (sy < 0) sy = 0; if (sx > sw - 1.001) sx = sw - 1.001; if (sy > sh - 1.001) sy = sh - 1.001;
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = sd[i00 + ch] + (sd[i10 + ch] - sd[i00 + ch]) * fx;
        const bot = sd[i01 + ch] + (sd[i11 + ch] - sd[i01 + ch]) * fx;
        d[o + ch] = top + (bot - top) * fy;
      }
      d[o + 3] = 255;
    }
  }
  return { data: d, width: W, height: H };
}

/** Paper background estimate: block-average downscale, max filter (removes ink), box blur. */
function background(img) {
  const { width: w, height: h, data } = img;
  const bs = Math.max(4, Math.round(Math.max(w, h) / 90));        // block size → ~90px long side
  const sw = Math.ceil(w / bs), sh = Math.ceil(h / bs);
  let small = new Float32Array(sw * sh * 3);
  for (let by = 0; by < sh; by++) for (let bx = 0; bx < sw; bx++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = by * bs; y < Math.min(h, (by + 1) * bs); y += 2) for (let x = bx * bs; x < Math.min(w, (bx + 1) * bs); x += 2) {
      const o = (y * w + x) * 4; r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
    }
    const o = (by * sw + bx) * 3; small[o] = r / n; small[o + 1] = g / n; small[o + 2] = b / n;
  }
  const pass = (src, r, fn) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let ch = 0; ch < 3; ch++) {
      let acc = fn === 'max' ? 0 : 0, n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(sh - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(sw - 1, Math.max(0, x + dx));
          const v = src[(yy * sw + xx) * 3 + ch];
          if (fn === 'max') { if (v > acc) acc = v; } else { acc += v; n++; }
        }
      }
      out[(y * sw + x) * 3 + ch] = fn === 'max' ? acc : acc / n;
    }
    return out;
  };
  small = pass(small, 2, 'max');
  small = pass(small, 2, 'box');
  small = pass(small, 1, 'box');
  return { small, sw, sh, bs };
}

/**
 * filter: 'original' | 'color' (shadow removed, colour kept) | 'gray' | 'bw'
 * Returns a new image.
 */
export function filterPx(img, filter) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data);
  if (filter === 'original') return { data: out, width: w, height: h };
  const { small, sw, sh, bs } = background(img);
  for (let y = 0; y < h; y++) {
    // bilinear upsample of the background, sampled at block centres
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / bs - 0.5)), y0 = fy | 0, y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / bs - 0.5)), x0 = fx | 0, x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const i = (y * w + x) * 4;
      const o00 = (y0 * sw + x0) * 3, o01 = (y0 * sw + x1) * 3, o10 = (y1 * sw + x0) * 3, o11 = (y1 * sw + x1) * 3;
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
      const bgR = Math.max(1, small[o00] * w00 + small[o01] * w01 + small[o10] * w10 + small[o11] * w11);
      const bgG = Math.max(1, small[o00 + 1] * w00 + small[o01 + 1] * w01 + small[o10 + 1] * w10 + small[o11 + 1] * w11);
      const bgB = Math.max(1, small[o00 + 2] * w00 + small[o01 + 2] * w01 + small[o10 + 2] * w10 + small[o11 + 2] * w11);
      const r = Math.min(255, data[i] / bgR * 255);
      const g = Math.min(255, data[i + 1] / bgG * 255);
      const b = Math.min(255, data[i + 2] / bgB * 255);
      if (filter === 'color') {
        out[i] = (r - 255) * 1.25 + 255; out[i + 1] = (g - 255) * 1.25 + 255; out[i + 2] = (b - 255) * 1.25 + 255;
      } else {
        let l = 0.299 * r + 0.587 * g + 0.114 * b;
        if (filter === 'gray') l = (l - 255) * 1.35 + 255;
        else l = l < 185 ? (l < 120 ? 0 : (l - 120) * 255 / 65 * 0.5) : 255;
        out[i] = out[i + 1] = out[i + 2] = l;
      }
      out[i + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** Raw 8-bit RGB/Gray samples (from a Flate image stream) → RGBA. */
export function rawToRGBA(raw, width, height, comps) {
  const d = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += comps) {
    const o = i * 4;
    if (comps === 3) { d[o] = raw[j]; d[o + 1] = raw[j + 1]; d[o + 2] = raw[j + 2]; }
    else d[o] = d[o + 1] = d[o + 2] = raw[j];
    d[o + 3] = 255;
  }
  return { data: d, width, height };
}
