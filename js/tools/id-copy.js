import { h, dropzone, readPdf, statusBar, download, resultBox, PL, savePdf, fmtSize, baseName, seg, field, textToPng, pageGeom, drawVisual,
  loadPdfJs, renderPage, imageToCanvas, canvasToBytes, pickFiles, freeCanvas, busy, onLeave, unsaved } from '../lib.js';
import { warpAndFilter, rotateCanvas } from '../scan-core.js';
import { encodeJpeg } from '../work.js';
import { fullQuad, toPx, scaled, cornerModal } from './scan.js';
import { loadSaved, saveSaved, signatureModal, thaiDate } from './sign.js';

const MM = 72 / 25.4;
const CARD = { w: 85.6 * MM, h: 54 * MM };   // ISO/IEC 7810 ID-1 (Thai ID card)
const A4 = [595.28, 841.89];

const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return PL().rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };

/** Load an image (data URL) into a canvas. */
async function urlToCanvas(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

/**
 * "สำเนาถูกต้อง" block as one PNG: heading, signature (or a blank signing line), (name), date.
 * Returns { bytes, w, h } in points.
 */
export async function certBlock({ color, sigUrl, name, date, scale = 1 }) {
  const S = 4; // render scale (px per pt)
  const parts = [];
  parts.push((await textToPng('สำเนาถูกต้อง', { size: 15 * scale, color, bold: true, scale: S })).canvas);
  if (sigUrl) {
    const sig = await urlToCanvas(sigUrl);
    const hPx = 42 * scale * S, k = hPx / sig.height;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(Math.min(sig.width * k, 170 * scale * S))); c.height = Math.round(c.width / (sig.width / sig.height));
    c.getContext('2d').drawImage(sig, 0, 0, c.width, c.height);
    parts.push(c);
  } else {
    parts.push((await textToPng('ลงชื่อ ....................................', { size: 13 * scale, color, scale: S })).canvas);
  }
  if (name) parts.push((await textToPng(`( ${name} )`, { size: 13 * scale, color, scale: S })).canvas);
  if (date) parts.push((await textToPng(date, { size: 12 * scale, color, scale: S })).canvas);
  const gap = 2 * S * scale;
  const W = Math.max(...parts.map(p => p.width));
  const H = parts.reduce((s, p) => s + p.height, 0) + gap * (parts.length - 1);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  let y = 0;
  for (const p of parts) { ctx.drawImage(p, (W - p.width) / 2, y); y += p.height + gap; }
  return { bytes: await canvasToBytes(out), w: W / S, h: H / S };
}

/**
 * Cross-lines "ใช้สำหรับ ... เท่านั้น" across a visual rectangle of a page (works on rotated pages too).
 * rect: { u, v, w, h } in visual points.
 */
export async function drawCrossLines(doc, page, rect, { text, color, maxFont = 16 }) {
  const { v2p } = pageGeom(page);
  const ang = Math.atan2(rect.h, rect.w);           // along the rising diagonal
  const diag = Math.hypot(rect.w, rect.h);
  let t = await textToPng(text, { size: maxFont, color, bold: true });
  const fit = Math.min(1, (diag * 0.78) / t.w);
  const tw = t.w * fit, th = t.h * fit;
  const cu = rect.u + rect.w / 2, cv = rect.v + rect.h / 2;
  drawVisual(page, await doc.embedPng(t.bytes), { cu, cv, w: tw, h: th, angle: ang * 180 / Math.PI });
  // two parallel lines above and below the text
  const du = Math.cos(ang), dv = -Math.sin(ang);   // direction (visual, y down)
  const nu = Math.sin(ang), nv = Math.cos(ang);    // normal
  const L = diag * 0.8, off = th / 2 + 3;
  const col = hexRgb(color);
  for (const s of [-1, 1]) {
    const a = v2p(cu - du * L / 2 + nu * off * s, cv - dv * L / 2 + nv * off * s);
    const b = v2p(cu + du * L / 2 + nu * off * s, cv + dv * L / 2 + nv * off * s);
    page.drawLine({ start: a, end: b, thickness: 1.2, color: col, opacity: 0.9 });
  }
}

/**
 * Card mode: front/back canvases (already cropped) onto one A4 page.
 * o: { purpose, color, sigUrl, name, date, scale }
 */
export async function buildCardCopy(cards, o) {
  const doc = await PL().PDFDocument.create();
  const page = doc.addPage(A4);
  const cw = CARD.w * o.scale, ch = CARD.h * o.scale;
  const x = (A4[0] - cw) / 2;
  let v = 64;
  for (const c of cards) {
    // Force the ID-1 aspect ratio so a slightly off crop still prints at true card size.
    const fit = document.createElement('canvas');
    fit.width = 1400; fit.height = Math.round(1400 * CARD.h / CARD.w);
    fit.getContext('2d').drawImage(c, 0, 0, fit.width, fit.height);
    const img = await doc.embedJpg(await encodeJpeg(fit, 0.9));
    freeCanvas(fit);
    page.drawImage(img, { x, y: A4[1] - v - ch, width: cw, height: ch });
    page.drawRectangle({ x, y: A4[1] - v - ch, width: cw, height: ch, borderColor: PL().rgb(0.75, 0.75, 0.75), borderWidth: 0.5 });
    if (o.purpose) await drawCrossLines(doc, page, { u: x, v, w: cw, h: ch }, { text: o.purpose, color: o.color, maxFont: 13 * o.scale });
    v += ch + 28;
  }
  const blk = await certBlock({ ...o, scale: 1 });
  drawVisual(page, await doc.embedPng(blk.bytes), { cu: x + cw - blk.w / 2, cv: v + blk.h / 2, w: blk.w, h: blk.h });
  return savePdf(doc);
}

/** PDF mode: stamp every page of an existing document. */
export async function certifyPdf(bytes, o) {
  const doc = await PL().PDFDocument.load(bytes);
  const blk = o.block || await certBlock(o);
  const blkImg = await doc.embedPng(blk.bytes);
  for (const page of doc.getPages()) {
    const { vw, vh } = pageGeom(page);
    const k = Math.min(1, (vw * 0.4) / blk.w);
    const bw = blk.w * k, bh = blk.h * k, m = Math.min(36, vw * 0.06);
    if (o.purpose) {
      // cross the middle of the page (inset so it doesn't hit the margins)
      const iw = vw * 0.7, ih = vh * 0.5;
      await drawCrossLines(doc, page, { u: (vw - iw) / 2, v: (vh - ih) / 2, w: iw, h: ih }, { text: o.purpose, color: o.color, maxFont: 22 });
    }
    drawVisual(page, blkImg, { cu: vw - m - bw / 2, cv: vh - m - bh / 2, w: bw, h: bh });
  }
  return savePdf(doc);
}

export default function (root) {
  let mode = 'card', gen = 0, sigUrl = null;
  const sides = { front: null, back: null }; // { blob, proxy, quad, rot }
  let pdf = null; // { file, bytes }
  const o = { purpose: '', color: '#1f3a93', name: '', withDate: true, scale: 1, enhance: true };
  const st = statusBar();
  const res = h('div');
  const preview = h('div', { class: 'doc', style: 'min-height:260px' }, h('div', { class: 'sub', style: 'color:var(--muted)' }, 'ตัวอย่างจะแสดงตรงนี้'));
  const stale = () => { gen++; res.innerHTML = ''; refresh(); };

  /* ---------- card slots ---------- */
  const slotEls = {};
  const slot = (key, label) => {
    const shot = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
    shot.onchange = () => { if (shot.files[0]) setSide(key, shot.files[0]); shot.value = ''; };
    const thumb = h('div', { class: 'cv', style: 'height:120px' }, h('span', { style: 'color:var(--muted);font-size:13px' }, 'ยังไม่มีรูป'));
    const tools = h('div', { class: 'row', style: 'justify-content:center;gap:6px;margin-top:8px' },
      h('button', { class: 'btn sm', onclick: () => shot.click() }, '📷 ถ่าย'),
      h('button', { class: 'btn sm', onclick: async () => { const [f] = await pickFiles('image/jpeg,image/png,image/webp', false); if (f) setSide(key, f); } }, '🖼 เลือกรูป'),
      h('button', { class: 'btn sm icon', title: 'ครอบมุมบัตร', onclick: () => crop(key) }, '⌗'),
      h('button', { class: 'btn sm icon', title: 'หมุน 90°', onclick: () => { if (sides[key]) { sides[key].rot = (sides[key].rot + 90) % 360; drawSlot(key); stale(); } } }, '⟳'),
      h('button', { class: 'btn sm icon danger', title: 'เอารูปออก', onclick: () => { sides[key] = null; drawSlot(key); stale(); } }, '✕'));
    const el = h('div', { class: 'pg', style: 'cursor:default' }, h('div', { class: 'num', style: 'margin:0 0 6px;font-weight:600' }, label), thumb, tools, shot);
    slotEls[key] = { el, thumb };
    return el;
  };
  async function setSide(key, file) {
    try {
      st.set('กำลังโหลดรูป...');
      const full = scaled(await imageToCanvas(file, 2600), 2600);
      const blob = new Blob([await canvasToBytes(full, 'image/jpeg', 0.92)], { type: 'image/jpeg' });
      const proxy = scaled(full, 1100);
      freeCanvas(full);
      sides[key] = { blob, proxy, quad: fullQuad(), rot: 0 };
      unsaved.value = true;
      st.set('');
      drawSlot(key);
      crop(key); // most photos need the card corners marked
    } catch (e) { st.error(e); }
  }
  function crop(key) {
    const s = sides[key];
    if (!s) return;
    cornerModal(s, (q) => { s.quad = q; drawSlot(key); stale(); });
  }
  /** Processed card image from the proxy (preview) or the stored photo (export). */
  async function cardCanvas(s, full) {
    const src = full ? await imageToCanvas(s.blob) : s.proxy;
    const c = rotateCanvas(await warpAndFilter(src, toPx(s.quad, src), full ? 1800 : 700, o.enhance ? 'color' : 'original'), s.rot);
    if (full) freeCanvas(src);
    return c;
  }
  async function drawSlot(key) {
    const { thumb } = slotEls[key];
    const s = sides[key];
    thumb.innerHTML = '';
    if (!s) { thumb.append(h('span', { style: 'color:var(--muted);font-size:13px' }, 'ยังไม่มีรูป')); return; }
    const c = scaled(await cardCanvas(s, false), 260);
    c.style.maxHeight = '120px'; c.style.maxWidth = '100%';
    thumb.append(c);
  }
  const cardPanel = h('div', {},
    h('div', { class: 'pages', style: 'grid-template-columns:repeat(auto-fill,minmax(210px,1fr))' }, slot('front', 'ด้านหน้าบัตร'), slot('back', 'ด้านหลังบัตร (ไม่ใส่ก็ได้)')),
    h('p', { class: 'note', style: 'text-align:left' }, 'วางบัตรบนพื้นสีเข้ม ถ่ายให้เห็นครบทั้ง 4 มุม แล้วลากจุดให้ตรงมุมบัตร — บัตรจะถูกพิมพ์ขนาดเท่าจริงบน A4'));

  /* ---------- pdf mode ---------- */
  const pdfInfo = h('div', { class: 'sub', style: 'margin-top:8px' });
  const pdfPanel = h('div', { class: 'hidden' },
    dropzone({ accept: '.pdf', title: 'ลากไฟล์ PDF ที่ต้องการรับรองสำเนามาวาง', hint: 'เช่น สำเนาทะเบียนบ้าน วุฒิการศึกษา — จะประทับทุกหน้า', onFiles: async ([f]) => {
      st.set('กำลังอ่านไฟล์...');
      try { const r = await readPdf(f); pdf = { file: f, bytes: r.bytes }; pdfInfo.textContent = `📄 ${f.name} · ${r.pages} หน้า`; st.set(''); unsaved.value = true; stale(); }
      catch (e) { st.error(e); }
    } }),
    pdfInfo);

  /* ---------- options ---------- */
  const purposeIn = h('input', { type: 'text', placeholder: 'เช่น สมัครงานบริษัท ABC', maxlength: 80 });
  purposeIn.oninput = () => { o.purpose = purposeIn.value.trim(); stale(); };
  const nameIn = h('input', { type: 'text', placeholder: 'ชื่อ-นามสกุล (ไม่ใส่ก็ได้)', maxlength: 60 });
  nameIn.oninput = () => { o.name = nameIn.value.trim(); stale(); };
  const dateChk = h('input', { type: 'checkbox', checked: true }); dateChk.onchange = () => { o.withDate = dateChk.checked; stale(); };
  const enhChk = h('input', { type: 'checkbox', checked: true }); enhChk.onchange = () => { o.enhance = enhChk.checked; drawSlot('front'); drawSlot('back'); stale(); };
  const sigList = h('div', { class: 'saved-sigs' });
  function drawSigs() {
    sigList.innerHTML = '';
    const none = h('div', { class: 's', title: 'ไม่ใส่ลายเซ็น (เซ็นด้วยปากกาหลังพิมพ์)', style: `display:grid;place-items:center;min-width:70px;height:56px;color:#555;font-size:12px;${!sigUrl ? 'border-color:var(--accent)' : ''}`,
      onclick: () => { sigUrl = null; drawSigs(); stale(); } }, 'เซ็นเองหลังพิมพ์');
    sigList.append(none);
    loadSaved().forEach(s => sigList.append(h('div', { class: 's', title: 'ใช้ลายเซ็นนี้', style: s.src === sigUrl ? 'border-color:var(--accent)' : '',
      onclick: () => { sigUrl = s.src; drawSigs(); stale(); } }, h('img', { src: s.src, alt: 'ลายเซ็นที่บันทึกไว้' }))));
  }
  drawSigs();

  const side = h('div', { class: 'panel side', style: 'margin-top:0' },
    h('h3', {}, 'ข้อความรับรอง'),
    field('ใช้สำหรับ ... เท่านั้น', purposeIn),
    h('div', { class: 'row' }, field('สีหมึก', seg([['#1f3a93', 'น้ำเงิน'], ['#000000', 'ดำ']], o.color, v => { o.color = v; stale(); }))),
    h('div', { style: 'margin:12px 0 6px;font-size:13px;color:var(--muted)' }, 'ลายเซ็น'),
    sigList,
    h('button', { class: 'btn sm', style: 'margin-top:8px', onclick: () => signatureModal((sig, remember) => {
      if (remember) saveSaved([sig, ...loadSaved()]);
      sigUrl = sig.src; drawSigs(); stale();
    }) }, '+ สร้างลายเซ็นใหม่'),
    h('div', { class: 'row', style: 'margin-top:12px' }, field('ชื่อใต้ลายเซ็น', nameIn)),
    h('div', { class: 'row' }, h('label', { class: 'check' }, dateChk, `ใส่วันที่ (${thaiDate('long')})`)),
    h('div', { class: 'row', id: 'idc-card-opts' },
      h('label', { class: 'check' }, enhChk, 'ปรับรูปให้สว่าง คมชัด'),
      field('ขนาดบัตรบนกระดาษ', seg([[1, 'เท่าจริง'], [1.5, 'ขยาย 1.5 เท่า']], o.scale, v => { o.scale = +v; stale(); }))),
    h('div', { class: 'actions' }, h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'สร้างไฟล์สำเนา')),
    st, res);

  const modeSeg = seg([['card', '🪪 บัตรประชาชน / บัตรต่างๆ'], ['pdf', '📄 รับรองสำเนา PDF']], mode, v => {
    mode = v;
    cardPanel.classList.toggle('hidden', v !== 'card');
    pdfPanel.classList.toggle('hidden', v !== 'pdf');
    side.querySelector('#idc-card-opts').classList.toggle('hidden', v !== 'card');
    stale();
  });
  root.append(
    h('div', { class: 'row', style: 'margin-bottom:14px' }, modeSeg),
    cardPanel, pdfPanel,
    h('div', { class: 'editor-layout' }, preview, side));

  onLeave(() => { sides.front = sides.back = null; pdf = null; });

  const opts = () => ({ ...o, purpose: o.purpose ? `ใช้สำหรับ ${o.purpose} เท่านั้น` : '', sigUrl, date: o.withDate ? thaiDate('long') : '' });

  async function build(full) {
    if (mode === 'card') {
      const list = ['front', 'back'].map(k => sides[k]).filter(Boolean);
      if (!list.length) return null;
      const canvases = [];
      for (const s of list) canvases.push(await cardCanvas(s, full));
      const out = await buildCardCopy(canvases, opts());
      canvases.forEach(freeCanvas);
      return out;
    }
    if (!pdf) return null;
    if (full) return certifyPdf(pdf.bytes, opts());
    // preview: first page only
    const src = await PL().PDFDocument.load(pdf.bytes);
    const tmp = await PL().PDFDocument.create();
    const [p] = await tmp.copyPages(src, [0]); tmp.addPage(p);
    return certifyPdf(await tmp.save(), opts());
  }

  let timer, pseq = 0;
  function refresh() { clearTimeout(timer); timer = setTimeout(drawPreview, 300); }
  async function drawPreview() {
    const my = ++pseq;
    try {
      const out = await build(false);
      if (my !== pseq) return;
      preview.innerHTML = '';
      if (!out) { preview.append(h('div', { class: 'sub', style: 'color:var(--muted)' }, mode === 'card' ? 'ใส่รูปบัตรเพื่อดูตัวอย่าง' : 'เลือกไฟล์ PDF เพื่อดูตัวอย่าง')); return; }
      const doc = await loadPdfJs(out);
      const c = await renderPage(doc, 1, { maxW: 560, maxH: 800 });
      doc.destroy();
      if (my !== pseq) return;
      c.style.maxWidth = '100%';
      preview.append(h('div', { class: 'page-wrap' }, h('span', { class: 'plabel' }, 'ตัวอย่าง'), c));
    } catch (e) { st.error(e); }
  }

  async function run() {
    res.innerHTML = '';
    if (mode === 'card' && !sides.front && !sides.back) return st.set('กรุณาใส่รูปบัตรอย่างน้อย 1 ด้าน', 'err');
    if (mode === 'pdf' && !pdf) return st.set('กรุณาเลือกไฟล์ PDF', 'err');
    if (!o.purpose && !confirm('ยังไม่ได้ใส่ "ใช้สำหรับ ... เท่านั้น" — สำเนาที่ไม่มีข้อความนี้อาจถูกนำไปใช้อย่างอื่นได้ ต้องการสร้างต่อหรือไม่?')) return;
    const my = gen;
    const name = mode === 'card' ? `สำเนาบัตร_${thaiDate('arabic').replace(/\//g, '-')}.pdf` : baseName(pdf.file.name) + '_รับรองสำเนา.pdf';
    try {
      st.set('กำลังสร้างไฟล์...');
      const out = await build(true);
      st.set('');
      if (my !== gen) return;
      res.append(resultBox(fmtSize(out.length), () => { download(out, name); unsaved.value = false; }));
    } catch (e) { st.error(e); }
  }
  refresh();
}
