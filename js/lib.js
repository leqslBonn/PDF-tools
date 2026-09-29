// Shared helpers: DOM, file input, pdf.js rendering, downloads, geometry.
export const MAX_MB = 40;
export const MAX_PREVIEW_PAGES = 50;

/* ---------------- DOM ---------------- */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
  return el;
}

export function toast(msg, ms = 2500) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
export const baseName = (name) => name.replace(/\.[^.]+$/, '');
export const tick = () => new Promise(r => setTimeout(r, 0));

/** Segmented control. opts: [[value,label],...] */
export function seg(opts, value, onChange) {
  const el = h('div', { class: 'seg' });
  el.value = value;
  for (const [v, label] of opts) {
    const b = h('button', { type: 'button', class: v === value ? 'on' : '' }, label);
    b.onclick = () => {
      el.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); el.value = v; onChange && onChange(v);
    };
    el.append(b);
  }
  return el;
}

export function field(label, control) {
  return h('label', { class: 'field' }, h('span', {}, label), control);
}

/* ---------------- file drop ---------------- */
const ICON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></svg>';

/**
 * Drop zone. opts: { accept: '.pdf' | 'image', multiple, title, hint, onFiles(files) }
 */
export function dropzone(opts) {
  const isImg = opts.accept === 'image';
  const accept = isImg ? 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp' : 'application/pdf,.pdf';
  const input = h('input', { type: 'file', accept, multiple: opts.multiple || false, class: 'hidden' });
  const box = h('div', { class: 'drop', tabindex: 0 },
    h('div', { html: ICON_UP }),
    h('div', { class: 'big' }, opts.title || (isImg ? 'ลากไฟล์รูปภาพมาวาง หรือคลิกเพื่อเลือก' : 'ลากไฟล์ PDF มาวาง หรือคลิกเพื่อเลือก')),
    h('div', { class: 'small' }, opts.hint || (opts.multiple ? 'เลือกได้หลายไฟล์พร้อมกัน' : `ไฟล์ละไม่เกิน ${MAX_MB} MB`)),
    input,
  );
  const take = (list) => {
    let files = [...list].filter(f => isImg ? /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)
      : f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!files.length) return toast(isImg ? 'กรุณาเลือกไฟล์รูปภาพ (.jpg .png .webp)' : 'กรุณาเลือกไฟล์ .pdf');
    const big = files.filter(f => f.size > MAX_MB * 1048576);
    if (big.length) toast(`ข้ามไฟล์ที่ใหญ่เกิน ${MAX_MB} MB: ${big.map(f => f.name).join(', ')}`, 4000);
    files = files.filter(f => f.size <= MAX_MB * 1048576);
    if (!opts.multiple) files = files.slice(0, 1);
    if (files.length) opts.onFiles(files);
  };
  box.onclick = () => input.click();
  box.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); };
  input.onchange = () => { take(input.files); input.value = ''; };
  box.ondragover = (e) => { e.preventDefault(); box.classList.add('over'); };
  box.ondragleave = () => box.classList.remove('over');
  box.ondrop = (e) => { e.preventDefault(); box.classList.remove('over'); take(e.dataTransfer.files); };
  const note = h('div', { class: 'note' }, isImg
    ? 'รับ .jpg .png .webp — ประมวลผลในเบราว์เซอร์ ไม่ส่งขึ้นเซิร์ฟเวอร์'
    : `รับไฟล์ .pdf ขนาดไม่เกิน ${MAX_MB} MB · แสดงตัวอย่างได้สูงสุด ${MAX_PREVIEW_PAGES} หน้าแรก`);
  const wrap = h('div', {}, box, note);
  wrap.pick = () => input.click();
  wrap.take = take;
  return wrap;
}

/** Hidden file picker usable from any button. */
export function pickFiles(accept, multiple = true) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, multiple });
    i.onchange = () => res([...i.files]);
    i.click();
  });
}

export const readBytes = async (file) => new Uint8Array(await file.arrayBuffer());

/* ---------------- status / progress ---------------- */
export function statusBar() {
  const bar = h('div', { class: 'progress' }, h('div'));
  const msg = h('div', { class: 'status' });
  const el = h('div', {}, bar, msg);
  el.set = (text, kind = '') => { msg.textContent = text || ''; msg.className = 'status ' + kind; };
  el.progress = (p) => {
    if (p == null) { bar.classList.remove('on'); return; }
    bar.classList.add('on'); bar.firstChild.style.width = Math.round(p * 100) + '%';
  };
  el.error = (e) => { console.error(e); el.progress(null); el.set('เกิดข้อผิดพลาด: ' + friendlyError(e), 'err'); };
  return el;
}

export function friendlyError(e) {
  const m = String(e && (e.message || e));
  if (/encrypt|password/i.test(m)) return 'ไฟล์นี้ถูกเข้ารหัส/ใส่รหัสผ่านไว้ กรุณาปลดรหัสก่อน';
  if (/Invalid PDF|No PDF header|Failed to parse/i.test(m)) return 'ไฟล์ PDF เสียหรือไม่ใช่ PDF';
  return m;
}

/* ---------------- downloads ---------------- */
export function download(data, name, type = 'application/pdf') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function downloadZip(files, name) {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.data);
  const blob = await zip.generateAsync({ type: 'blob' });
  download(blob, name, 'application/zip');
}

/** Green result box with download button. */
export function resultBox(text, onDownload, extra = []) {
  return h('div', { class: 'result' },
    h('div', { class: 'big' }, '✅ ' + text),
    h('div', { class: 'spacer' }),
    ...extra,
    h('button', { class: 'btn primary', onclick: onDownload }, '⬇ ดาวน์โหลด'),
  );
}

/* ---------------- pdf-lib / pdf.js ---------------- */
export const PL = () => window.PDFLib;

export async function loadPdfLib(bytes) {
  return PL().PDFDocument.load(bytes, { ignoreEncryption: false });
}

/** pdf.js detaches the buffer it's given, so always hand it a copy. */
export async function loadPdfJs(bytes, password) {
  return pdfjsLib.getDocument({ data: bytes.slice(), password }).promise;
}

/** Render a pdf.js page into a canvas, fitting within maxW x maxH css px (or with fixed scale). */
export async function renderPage(pdf, n, { maxW = 260, maxH = 360, scale, rotate = 0 } = {}) {
  const page = await pdf.getPage(n);
  const rot = (page.rotate + rotate) % 360;
  const base = page.getViewport({ scale: 1, rotation: rot });
  const s = scale || Math.min(maxW / base.width, maxH / base.height) * (window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale: s, rotation: rot });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return c;
}

/**
 * Build a page tile (for grids). Thumbnails render lazily for the first MAX_PREVIEW_PAGES pages;
 * later pages show a placeholder.
 */
export function pageTile(n, extra = []) {
  const cv = h('div', { class: 'cv' }, h('div', { class: 'sub' }, '…'));
  const t = h('div', { class: 'pg', 'data-n': n }, cv, h('div', { class: 'num' }, `หน้า ${n}`), ...extra);
  t.cv = cv;
  return t;
}
export async function fillThumbs(pdf, tiles, opts = {}) {
  for (const t of tiles) {
    const n = +t.dataset.n;
    if (n > MAX_PREVIEW_PAGES) { t.cv.innerHTML = '<div style="color:#98a3c7;font-size:12px">ไม่แสดงตัวอย่าง</div>'; continue; }
    if (!t.isConnected && opts.stopWhenDetached) return;
    try { const c = await renderPage(pdf, n, { maxW: 130, maxH: 150 }); t.cv.innerHTML = ''; t.cv.append(c); t.canvas = c; }
    catch { t.cv.textContent = '⚠'; }
  }
}

export const canvasToBlob = (c, type = 'image/png', q) => new Promise(r => c.toBlob(r, type, q));
/** Synchronous encode (toBlob gets throttled in background tabs). */
export async function canvasToBytes(c, type = 'image/png', q) {
  const s = atob(c.toDataURL(type, q).split(',')[1]);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Load an image file (EXIF orientation applied) into a canvas, optionally downscaled.
 */
export async function imageToCanvas(src, maxDim = 0) {
  const bmp = await createImageBitmap(src instanceof Blob ? src : new Blob([src]), { imageOrientation: 'from-image' });
  let w = bmp.width, hh = bmp.height;
  if (maxDim && Math.max(w, hh) > maxDim) { const k = maxDim / Math.max(w, hh); w = Math.round(w * k); hh = Math.round(hh * k); }
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  c.getContext('2d').drawImage(bmp, 0, 0, w, hh);
  bmp.close && bmp.close();
  return c;
}

/** Copy onto an opaque white background (JPEG has no alpha; transparent would turn black). */
export function flattenWhite(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** Encode with a fallback when the browser can't produce the requested type (e.g. WebP on old Safari). */
export async function encodeImage(c, type, q) {
  let url = c.toDataURL(type, q);
  if (!url.startsWith('data:' + type)) { type = 'image/jpeg'; url = flattenWhite(c).toDataURL(type, q); }
  const s = atob(url.split(',')[1]);
  const data = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) data[i] = s.charCodeAt(i);
  return { data, type };
}

/* ---------------- text → PNG (proper Thai shaping via the browser) ---------------- */
export const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
export const toThaiDigits = (s) => String(s).replace(/[0-9]/g, d => THAI_DIGITS[d]);

const fontCache = new Map();
function ensureFont(spec) {
  const key = spec.replace(/\d+(\.\d+)?px/, '');
  if (!fontCache.has(key)) {
    // Thai + Latin sample so both unicode-range subsets load; offline falls back to system font.
    fontCache.set(key, Promise.race([
      document.fonts.load(spec, 'กขคabc123๑').catch(() => {}),
      new Promise(r => setTimeout(r, 3000)),
    ]));
  }
  return fontCache.get(key);
}

export async function textToPng(text, { size = 24, color = '#000000', font = 'Sarabun', bold = false, italic = false, scale = 4, pad = 0.15 } = {}) {
  const spec = `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${size * scale}px "${font}", "Sarabun", sans-serif`;
  await ensureFont(spec);
  const lines = String(text).split('\n');
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  ctx.font = spec;
  ctx.textBaseline = 'alphabetic';
  // Size each line from real ink bounds so stacked Thai marks (ปั้น ญี่ ฐู) never clip.
  const ms = lines.map(l => ctx.measureText(l || ' '));
  const em = size * scale;
  const asc = Math.max(em * 0.95, ...ms.map(m => m.actualBoundingBoxAscent || 0));
  const desc = Math.max(em * 0.3, ...ms.map(m => m.actualBoundingBoxDescent || 0));
  const lh = asc + desc;
  const left = Math.max(0, ...ms.map(m => m.actualBoundingBoxLeft || 0));
  const w = Math.max(1, ...ms.map(m => Math.max(m.width, (m.actualBoundingBoxRight || 0) + left)));
  const p = em * pad;
  c.width = Math.ceil(w + left + p * 2); c.height = Math.ceil(lh * lines.length + p * 2);
  ctx = c.getContext('2d');
  ctx.font = spec; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => ctx.fillText(l, p + left, p + lh * i + asc));
  return { bytes: await canvasToBytes(c), w: c.width / scale, h: c.height / scale, canvas: c };
}

/* ---------------- geometry: "visual" page space ↔ PDF user space ----------------
 * Visual space = the page as a viewer shows it (after /Rotate and CropBox),
 * origin top-left, y downward, units = PDF points.
 */
export function pageGeom(page) {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const W = box.width, H = box.height;
  const vw = rot % 180 ? H : W, vh = rot % 180 ? W : H;
  const x0 = box.x, y0 = box.y, x1 = box.x + W, y1 = box.y + H;
  const v2p = (u, v) => {
    switch (rot) {
      case 90: return { x: x0 + v, y: y0 + u };
      case 180: return { x: x1 - u, y: y0 + v };
      case 270: return { x: x1 - v, y: y1 - u };
      default: return { x: x0 + u, y: y1 - v };
    }
  };
  return { rot, vw, vh, v2p, box };
}

/**
 * Draw an embedded image centred at visual point (cu,cv), size w×h visual points,
 * rotated `angle` degrees counter-clockwise as the reader sees it.
 */
export function drawVisual(page, img, { cu, cv, w, h, angle = 0, opacity = 1 }) {
  const { rot, v2p } = pageGeom(page);
  const c = v2p(cu, cv);
  const th = (rot + angle) * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const x = c.x - (cos * w / 2 - sin * h / 2);
  const y = c.y - (sin * w / 2 + cos * h / 2);
  page.drawImage(img, { x, y, width: w, height: h, rotate: PL().degrees(rot + angle), opacity });
}

/** Save with object streams for smaller output. */
export const savePdf = (doc) => doc.save({ useObjectStreams: true });
