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
  // Icon-only buttons: expose their tooltip to screen readers too.
  if (attrs && attrs.title && !attrs['aria-label'] && (tag === 'button' || tag === 'a')) el.setAttribute('aria-label', attrs.title);
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

/* ---------------- page lifecycle ----------------
 * Tools register cleanups (camera streams, observers, listeners) that run when the
 * user navigates away, and can flag unsaved work so the router asks before leaving. */
const leaveFns = [];
export const onLeave = (fn) => { leaveFns.push(fn); };
export function runLeave() {
  while (leaveFns.length) { try { leaveFns.pop()(); } catch (e) { console.warn(e); } }
  document.querySelectorAll('.modal-bg, .cam, .flash').forEach(el => el.remove());
  unsaved.value = false;
}
export const unsaved = { value: false };

/** Wrap a button handler: disables the button (with spinner) until the async work ends. */
export function busy(fn) {
  return async (e) => {
    const b = e && e.currentTarget;
    if (b && b.disabled) return;
    if (b) { b.disabled = true; b.classList.add('busy'); b.setAttribute('aria-busy', 'true'); }
    try { await fn(e); } finally { if (b) { b.disabled = false; b.classList.remove('busy'); b.removeAttribute('aria-busy'); } }
  };
}

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
const ICON_UP = `<svg class="drop-art" viewBox="0 0 120 100" aria-hidden="true">
  <rect x="30" y="14" width="52" height="66" rx="9" fill="currentColor" opacity=".14" transform="rotate(-8 56 47)"/>
  <rect x="38" y="10" width="52" height="66" rx="9" fill="var(--card)" stroke="currentColor" stroke-width="2.5"/>
  <path d="M48 26h24M48 34h32M48 42h18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".35"/>
  <g class="arrow"><circle cx="64" cy="70" r="17" fill="currentColor"/><path d="M64 78V62M57 68l7-7 7 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>
  <path class="spark" d="M17 30l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" fill="#f59e0b"/>
  <path class="spark b" d="M101 20l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2z" fill="#ec4899"/>
  <circle class="spark b" cx="100" cy="72" r="3.5" fill="#38bdf8"/>
</svg>`;

/**
 * Drop zone. opts: { accept: '.pdf' | 'image', multiple, title, hint, onFiles(files) }
 */
export function dropzone(opts) {
  const isImg = opts.accept === 'image';
  const accept = isImg ? 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp' : 'application/pdf,.pdf';
  const input = h('input', { type: 'file', accept, multiple: opts.multiple || false, class: 'hidden' });
  const box = h('div', { class: 'drop', tabindex: 0, role: 'button', 'aria-label': isImg ? 'เลือกไฟล์รูปภาพ' : 'เลือกไฟล์ PDF' },
    h('div', { html: ICON_UP }),
    h('div', { class: 'big' }, opts.title || (isImg ? 'ลากไฟล์รูปภาพมาวาง หรือคลิกเพื่อเลือก' : 'ลากไฟล์ PDF มาวาง หรือคลิกเพื่อเลือก')),
    h('div', { class: 'small' }, opts.hint || (opts.multiple ? 'เลือกได้หลายไฟล์พร้อมกัน' : `ไฟล์ละไม่เกิน ${MAX_MB} MB`)),
    h('span', { class: 'drop-cta', 'aria-hidden': 'true' }, isImg ? '🖼 เลือกรูปภาพ' : '📄 เลือกไฟล์ PDF'),
    h('span', { class: 'drop-alt' }, 'หรือลากไฟล์มาปล่อยตรงนี้ได้เลย'),
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
  box.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
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

/** Small modal asking for a PDF password. Resolves to the string, or null if cancelled. */
function askPassword(name, wrong) {
  return new Promise(res => {
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: 'รหัสผ่านของไฟล์', 'aria-label': 'รหัสผ่านของไฟล์' });
    const bg = h('div', { class: 'modal-bg' });
    const done = (v) => { bg.remove(); res(v); };
    const form = h('form', { class: 'modal', style: 'width:min(420px,100%)' },
      h('h3', {}, '🔐 ไฟล์นี้มีรหัสผ่าน'),
      h('p', { style: 'margin:0 0 10px;color:var(--muted);font-size:14px;word-break:break-all' }, name),
      wrong ? h('div', { class: 'status err', style: 'margin-bottom:8px' }, 'รหัสผ่านไม่ถูกต้อง ลองใหม่อีกครั้ง') : null,
      input,
      h('div', { class: 'actions' }, h('div', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'ยกเลิก'),
        h('button', { type: 'submit', class: 'btn primary' }, 'ปลดล็อก')));
    form.onsubmit = (e) => { e.preventDefault(); done(input.value); };
    bg.append(form);
    document.body.append(bg);
    input.focus();
  });
}

/**
 * Read a PDF file and make sure pdf-lib can edit it.
 * Encrypted files are decrypted in memory (owner-password-only files silently; files that
 * need a password to open ask the user) and returned as plain, unencrypted bytes.
 * Returns { bytes, unlocked, hasForm, pages }.
 */
export async function readPdf(file) {
  const raw = await readBytes(file);
  const { PDFDocument } = PL();
  let doc, unlocked = false;
  try {
    doc = await PDFDocument.load(raw, { updateMetadata: false });
  } catch (e) {
    if (!/encrypted/i.test(e.message)) throw e;
    try { doc = await PDFDocument.load(raw, { password: '', updateMetadata: false }); }
    catch (e2) {
      let wrong = false;
      for (;;) {
        const pw = await askPassword(file.name, wrong);
        if (pw == null) throw new Error('ต้องใส่รหัสผ่านเพื่อเปิดไฟล์ ' + file.name);
        try { doc = await PDFDocument.load(raw, { password: pw, updateMetadata: false }); break; }
        catch { wrong = true; }
      }
    }
    unlocked = true;
  }
  const pages = doc.getPageCount();
  if (!pages) throw new Error('ไฟล์ ' + file.name + ' ไม่มีหน้าเอกสาร');
  let hasForm = false;
  try { hasForm = doc.getForm().getFields().length > 0; } catch { /* malformed AcroForm */ }
  const bytes = unlocked ? await doc.save({ useObjectStreams: false }) : raw;
  return { bytes, unlocked, hasForm, pages };
}

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
  if (/ต้องใส่รหัสผ่าน|ไม่มีหน้า/.test(m)) return m;
  if (/encrypt|password/i.test(m)) return 'ไฟล์นี้ถูกเข้ารหัสไว้และปลดล็อกไม่ได้';
  if (/null is not an object|getContext|out of memory|allocation/i.test(m)) return 'ไฟล์/รูปใหญ่เกินกว่าที่เครื่องนี้จะประมวลผลได้ ลองลดความละเอียดหรือใช้ไฟล์ที่เล็กลง';
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
  const bits = ['#a78bfa', '#f472b6', '#facc15', '#34d399', '#38bdf8', '#fb923c', '#c084fc', '#4ade80'];
  const confetti = h('span', { class: 'confetti', 'aria-hidden': 'true' },
    ...bits.map((k, i) => h('i', { style: `--k:${k};--x:${40 + i * 22}px;--y:${(i % 2 ? -1 : 1) * (18 + (i * 7) % 26)}px;--r:${200 + i * 45}deg;--d:${i * 40}ms` })));
  return h('div', { class: 'result', role: 'status' },
    confetti,
    h('div', { class: 'ok-ic', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' }),
    h('div', { class: 'big' }, h('small', {}, 'เสร็จแล้ว! ไฟล์พร้อมดาวน์โหลด'), text),
    h('div', { class: 'spacer' }),
    ...extra,
    h('button', { class: 'btn primary', onclick: onDownload }, '⬇ ดาวน์โหลดไฟล์'),
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
  // DPR capped at 2: sharper beyond that isn't visible but costs a lot of memory on phones.
  const s = scale || Math.min(maxW / base.width, maxH / base.height) * Math.min(2, window.devicePixelRatio || 1);
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
    if (n > MAX_PREVIEW_PAGES) { t.cv.innerHTML = '<div style="color:var(--muted);font-size:12px">ไม่แสดงตัวอย่าง</div>'; continue; }
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
export const MAX_CANVAS_PX = 16000000; // iOS Safari refuses larger canvases

async function decodeImage(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch {
    // Older Safari: no options support → decode via <img> (which applies EXIF itself).
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
}

export async function imageToCanvas(src, maxDim = 0) {
  const bmp = await decodeImage(src instanceof Blob ? src : new Blob([src]));
  let w = bmp.naturalWidth || bmp.width, hh = bmp.naturalHeight || bmp.height;
  let k = 1;
  if (maxDim && Math.max(w, hh) > maxDim) k = maxDim / Math.max(w, hh);
  if (w * hh * k * k > MAX_CANVAS_PX) k = Math.sqrt(MAX_CANVAS_PX / (w * hh));
  w = Math.max(1, Math.floor(w * k)); hh = Math.max(1, Math.floor(hh * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('out of memory');
  ctx.drawImage(bmp, 0, 0, w, hh);
  bmp.close && bmp.close();
  return c;
}

/** Release a canvas's pixel memory right away (Safari keeps it until GC otherwise). */
export const freeCanvas = (c) => { if (c) { c.width = 0; c.height = 0; } };

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
  // `font` may be a single family name or a full CSS stack (e.g. '"Tahoma", sans-serif')
  const fam = /[",]/.test(font) ? font : `"${font}"`;
  const spec = `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${size * scale}px ${fam}, "Sarabun", sans-serif`;
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
  // baseline / x0: where the first line's baseline and text start sit inside the image (in pt) — for exact placement
  return { bytes: await canvasToBytes(c), w: c.width / scale, h: c.height / scale, canvas: c, baseline: (p + asc) / scale, x0: (p + left) / scale };
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
  // inverse of v2p: PDF user space → visual
  const p2v = (x, y) => {
    switch (rot) {
      case 90: return { u: y - y0, v: x - x0 };
      case 180: return { u: x1 - x, v: y - y0 };
      case 270: return { u: y1 - y, v: x1 - x };
      default: return { u: x - x0, v: y1 - y };
    }
  };
  return { rot, vw, vh, v2p, p2v, box };
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

/**
 * copyPages() drops the document-level AcroForm, which makes fill-in fields dead.
 * This re-links the copied pages' widgets into the output's AcroForm so forms stay fillable.
 */
export function copyForms(src, out, copiedPages) {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFObjectCopier } = PL();
  const srcAF = src.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!srcAF) return 0;
  const ctx = out.context;
  let af = out.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!af) {
    af = ctx.obj({ Fields: [] });
    const copier = PDFObjectCopier.for(src.context, ctx);
    for (const k of ['DA', 'DR', 'NeedAppearances', 'Q']) {
      const v = srcAF.get(PDFName.of(k));
      if (v) af.set(PDFName.of(k), copier.copy(v));
    }
    out.catalog.set(PDFName.of('AcroForm'), ctx.register(af));
  }
  const fields = af.lookup(PDFName.of('Fields'), PDFArray);
  const seen = new Set(fields.asArray().map(r => r.toString()));
  let n = 0;
  for (const p of copiedPages) {
    const annots = p.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      let ref = annots.get(i);
      let d = ctx.lookup(ref);
      if (!(d instanceof PDFDict) || d.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) continue;
      while (d.get(PDFName.of('Parent'))) { ref = d.get(PDFName.of('Parent')); d = ctx.lookup(ref, PDFDict); }
      if (ref instanceof PDFRef && !seen.has(ref.toString())) { seen.add(ref.toString()); fields.push(ref); n++; }
    }
  }
  return n;
}

/** Copy pages (by 0-based index) from src into out, keeping form fields working. */
export async function copyInto(out, src, indices) {
  const pages = await out.copyPages(src, indices);
  pages.forEach(p => out.addPage(p));
  try { copyForms(src, out, pages); } catch (e) { console.warn('form copy skipped', e); }
  return pages;
}

/** Save with object streams for smaller output. */
export const savePdf = (doc) => doc.save({ useObjectStreams: true });
