// Image processing for the scanner: perspective warp + shadow removal. Pure canvas, no deps.

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

/** quad: [tl,tr,br,bl] in source pixel coords. */
export function warpPerspective(src, quad, maxDim = 2200) {
  let W = Math.round(Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2])));
  let H = Math.round(Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2])));
  const k = Math.min(1, maxDim / Math.max(W, H));
  W = Math.max(1, Math.round(W * k)); H = Math.max(1, Math.round(H * k));
  const hm = homography([[0, 0], [W, 0], [W, H], [0, H]], quad);
  const sw = src.width, sh = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d');
  const od = octx.createImageData(W, H);
  const d = od.data;
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
  octx.putImageData(od, 0, 0);
  return out;
}

export function rotateCanvas(src, deg) {
  deg = ((deg % 360) + 360) % 360;
  if (!deg) return src;
  const c = document.createElement('canvas');
  const swap = deg % 180 !== 0;
  c.width = swap ? src.height : src.width; c.height = swap ? src.width : src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Estimate the paper background (text removed via max-filter, then smoothed). */
function background(src) {
  const sw = Math.max(8, Math.round(src.width / 12)), sh = Math.max(8, Math.round(src.height / 12));
  let cur = src;
  // stepwise downscale for a decent average
  while (cur.width / 2 > sw) {
    const t = document.createElement('canvas'); t.width = Math.round(cur.width / 2); t.height = Math.round(cur.height / 2);
    t.getContext('2d').drawImage(cur, 0, 0, t.width, t.height); cur = t;
  }
  const small = document.createElement('canvas'); small.width = sw; small.height = sh;
  const sctx = small.getContext('2d');
  sctx.drawImage(cur, 0, 0, sw, sh);
  let id = sctx.getImageData(0, 0, sw, sh);
  const maxf = (data, r) => {
    const o = new Uint8ClampedArray(data.length);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let m = 0;
        for (let dy = -r; dy <= r; dy++) { const yy = Math.min(sh - 1, Math.max(0, y + dy));
          for (let dx = -r; dx <= r; dx++) { const xx = Math.min(sw - 1, Math.max(0, x + dx)); const v = data[(yy * sw + xx) * 4 + ch]; if (v > m) m = v; } }
        o[i + ch] = m;
      }
      o[i + 3] = 255;
    }
    return o;
  };
  const boxf = (data, r) => {
    const o = new Uint8ClampedArray(data.length);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let s = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) { const yy = Math.min(sh - 1, Math.max(0, y + dy));
          for (let dx = -r; dx <= r; dx++) { const xx = Math.min(sw - 1, Math.max(0, x + dx)); s += data[(yy * sw + xx) * 4 + ch]; n++; } }
        o[i + ch] = s / n;
      }
      o[i + 3] = 255;
    }
    return o;
  };
  let d = maxf(id.data, 2);
  d = boxf(d, 2);
  d = boxf(d, 1);
  id = new ImageData(d, sw, sh);
  sctx.putImageData(id, 0, 0);
  const big = document.createElement('canvas'); big.width = src.width; big.height = src.height;
  const bctx = big.getContext('2d'); bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, big.width, big.height);
  return bctx.getImageData(0, 0, big.width, big.height).data;
}

/**
 * filter: 'original' | 'color' (shadow removed, colour kept) | 'gray' | 'bw'
 */
export function applyFilter(src, filter) {
  if (filter === 'original') return src;
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  const bg = background(src);
  for (let i = 0; i < d.length; i += 4) {
    let r = Math.min(255, d[i] / Math.max(1, bg[i]) * 255);
    let g = Math.min(255, d[i + 1] / Math.max(1, bg[i + 1]) * 255);
    let b = Math.min(255, d[i + 2] / Math.max(1, bg[i + 2]) * 255);
    if (filter === 'color') {
      // gentle contrast boost
      r = (r - 255) * 1.25 + 255; g = (g - 255) * 1.25 + 255; b = (b - 255) * 1.25 + 255;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    } else {
      let l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (filter === 'gray') l = (l - 255) * 1.35 + 255;
      else l = l < 185 ? (l < 120 ? 0 : (l - 120) * 255 / 65 * 0.5) : 255;
      d[i] = d[i + 1] = d[i + 2] = l;
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}
