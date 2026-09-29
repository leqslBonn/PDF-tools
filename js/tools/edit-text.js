import { h, dropzone, readPdf, statusBar, download, resultBox, PL, savePdf, fmtSize, baseName, field, textToPng, pageGeom, drawVisual,
  loadPdfJs, canvasToBytes, freeCanvas, busy, onLeave, unsaved, copyInto, MAX_PREVIEW_PAGES, tick } from '../lib.js';
import { encodeJpeg } from '../work.js';

/* ---------- fonts ---------- */

// [css font stack, label]; fonts we ship are self-hosted, the rest are common system fonts.
export const FONTS = [
  ['Sarabun', 'Sarabun (≈ TH Sarabun New)'],
  ['"IBM Plex Sans Thai"', 'IBM Plex Sans Thai'],
  ['Kanit', 'Kanit'],
  ['"Tahoma", "Leelawadee UI", sans-serif', 'Tahoma'],
  ['"Arial", "Helvetica", sans-serif', 'Arial / Helvetica'],
  ['"Times New Roman", "Times", serif', 'Times New Roman'],
  ['"Courier New", "Courier", monospace', 'Courier'],
  ['Mali', 'Mali'], ['Itim', 'Itim'], ['Charm', 'Charm'],
];

/** Pick the closest font we can draw for an embedded PDF font name (e.g. "ABCDEF+THSarabunNew-Bold"). */
export function matchFont(pdfName = '', family = '') {
  const n = (pdfName + ' ' + family).toLowerCase();
  const style = { bold: /bold|black|heavy|semibold|demi|,b\b/.test(n), italic: /italic|oblique/.test(n) };
  const pick = (i) => ({ font: FONTS[i][0], ...style });
  if (/sarabun|thsarabun|niramit|chakra|k2d|kodchasan/.test(n)) return pick(0);
  if (/plex/.test(n)) return pick(1);
  if (/kanit|prompt|mitr/.test(n)) return pick(2);
  if (/tahoma|leelawad|thonburi|segoe/.test(n)) return pick(3);
  if (/angsana|browallia|cordia|eucrosia|freesia|iris|jasmine|lily|dillenia/.test(n)) return pick(0);
  if (/times|georgia|garamond|cambria|serif(?!.*sans)|roman|mincho|song/.test(n)) return pick(5);
  if (/courier|mono|consol/.test(n)) return pick(6);
  if (/arial|helvetica|calibri|verdana|sans|roboto|noto/.test(n)) return pick(4);
  return pick(0); // most Thai documents use TH Sarabun
}

/* ---------- reading text lines ---------- */

/**
 * Group pdf.js text items into horizontal lines (in visual page points).
 * Returns [{ text, x0, x1, base, size, fontName }].
 */
export function groupLines(tc, vp) {
  const U = pdfjsLib.Util;
  const pieces = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() && !it.hasEOL) { if (it.str) pieces.push(null); continue; }
    const t = U.transform(vp.transform, it.transform);
    if (Math.abs(t[1]) > Math.abs(t[0]) * 0.05) continue; // skip rotated/vertical text
    const size = Math.hypot(t[2], t[3]);
    const x = t[4], base = t[5];
    const w = it.width * Math.abs(t[0]) / (Math.hypot(it.transform[0], it.transform[1]) || 1);
    pieces.push({ str: it.str, x0: x, x1: x + w, base, size, fontName: it.fontName });
  }
  const items = pieces.filter(Boolean).sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const lines = [];
  for (const p of items) {
    const L = lines.find(l => Math.abs(l.base - p.base) < Math.max(l.size, p.size) * 0.35 && p.x0 - l.x1 < Math.max(l.size, p.size) * 1.2 && p.x0 > l.x0 - 1);
    if (L) {
      const gap = p.x0 - L.x1;
      L.text += (gap > L.size * 0.22 && !/\s$/.test(L.text) && !/^\s/.test(p.str) ? ' ' : '') + p.str;
      L.x1 = Math.max(L.x1, p.x1); L.size = Math.max(L.size, p.size);
    } else lines.push({ text: p.str, x0: p.x0, x1: p.x1, base: p.base, size: p.size, fontName: p.fontName });
  }
  return lines.map(l => ({ ...l, text: l.text.replace(/\s+$/, '') })).filter(l => l.text.trim());
}

/** Box to cover a line: generous above (Thai tone marks) and below (lower vowels). */
const coverBox = (l) => {
  // generous above (Thai tone marks) and below (lower vowels), but never into the neighbouring lines
  const top = Math.max(l.base - l.size * 1.18, l.minV ?? -Infinity);
  const bottom = Math.min(l.base + l.size * 0.44, l.maxV ?? Infinity);
  return { u: l.x0 - 1.5, v: top, w: l.x1 - l.x0 + 3, h: Math.max(l.size * 0.9, bottom - top) };
};

/** Record how far each line's cover may extend before touching the lines above/below it. */
export function limitCovers(lines) {
  for (const l of lines) {
    for (const o of lines) {
      if (o === l || o.x1 < l.x0 || o.x0 > l.x1) continue;           // not overlapping horizontally
      if (o.base > l.base) l.maxV = Math.min(l.maxV ?? Infinity, o.base - o.size * 0.8);   // line below: stop above its letters
      else if (o.base < l.base) l.minV = Math.max(l.minV ?? -Infinity, o.base + o.size * 0.12); // line above: stop below its baseline
    }
  }
  return lines;
}

/** Sample background (median of a frame around the box) and ink colour (pixels far from it). */
function sampleColors(canvas, box, k) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const x = Math.max(0, Math.floor(box.u * k) - 3), y = Math.max(0, Math.floor(box.v * k) - 3);
  const w = Math.min(canvas.width - x, Math.ceil(box.w * k) + 6), hh = Math.min(canvas.height - y, Math.ceil(box.h * k) + 6);
  if (w < 4 || hh < 4) return { bg: '#ffffff', ink: '#000000' };
  const d = ctx.getImageData(x, y, w, hh).data;
  const frame = [], inner = [];
  for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
    const o = (j * w + i) * 4, px = [d[o], d[o + 1], d[o + 2]];
    (i < 2 || j < 2 || i >= w - 2 || j >= hh - 2 ? frame : inner).push(px);
  }
  const med = (arr, c) => { const v = arr.map(p => p[c]).sort((a, b) => a - b); return v[v.length >> 1] || 255; };
  const bg = [0, 1, 2].map(c => med(frame, c));
  const far = inner.map(p => [p, Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2])]).filter(q => q[1] > 90).sort((a, b) => b[1] - a[1]);
  const top = far.slice(0, Math.max(1, Math.floor(far.length * 0.15))).map(q => q[0]);
  const ink = top.length && far.length ? [0, 1, 2].map(c => Math.round(top.reduce((s, p) => s + p[c], 0) / top.length)) : [0, 0, 0];
  const hex = (a) => '#' + a.map(v => v.toString(16).padStart(2, '0')).join('');
  return { bg: hex(bg), ink: hex(ink) };
}

/* ---------- writing ---------- */

/**
 * edits: [{ page, cover:{u,v,w,h}, bg, text, font, bold, italic, size, color, x0, base }]
 * secure=false: paint the cover + new text on the original page (old text still in the file underneath).
 * secure=true : edited pages are re-rendered as images with the cover painted in, so old text is gone.
 */
export async function applyEdits(bytes, edits, { secure = false, dpi = 200, onProgress } = {}) {
  const L = PL();
  const byPage = new Map();
  for (const e of edits) { if (!byPage.has(e.page)) byPage.set(e.page, []); byPage.get(e.page).push(e); }
  const hexRgb = (hx) => { const n = parseInt(hx.slice(1), 16); return L.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };

  const drawTexts = async (doc, page, list) => {
    for (const e of list) {
      if (!e.text.trim()) continue; // deleted line: cover only
      const t = await textToPng(e.text, { size: e.size, color: e.color, font: e.font, bold: e.bold, italic: e.italic, pad: 0.1 });
      const img = await doc.embedPng(t.bytes);
      const left = e.x0 - t.x0, top = e.base - t.baseline;
      drawVisual(page, img, { cu: left + t.w / 2, cv: top + t.h / 2, w: t.w, h: t.h });
    }
  };

  if (!secure) {
    const doc = await L.PDFDocument.load(bytes);
    const pages = doc.getPages();
    for (const [pi, list] of byPage) {
      const page = pages[pi];
      const { v2p } = pageGeom(page);
      for (const e of list) {
        const a = v2p(e.cover.u, e.cover.v), b = v2p(e.cover.u + e.cover.w, e.cover.v + e.cover.h);
        page.drawRectangle({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y), color: hexRgb(e.bg), borderWidth: 0 });
      }
      await drawTexts(doc, page, list);
    }
    return savePdf(doc);
  }

  const src = await L.PDFDocument.load(bytes);
  const out = await L.PDFDocument.create();
  const pdf = await loadPdfJs(bytes);
  const total = src.getPageCount();
  let run = [];
  const flush = async () => { if (run.length) { await copyInto(out, src, run); run = []; } };
  for (let i = 0; i < total; i++) {
    const list = byPage.get(i);
    if (!list) { run.push(i); continue; }
    await flush();
    const pg = await pdf.getPage(i + 1);
    const vp1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: dpi / 72 });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const k = c.width / vp1.width;
    for (const e of list) { ctx.fillStyle = e.bg; ctx.fillRect(e.cover.u * k, e.cover.v * k, e.cover.w * k, e.cover.h * k); }
    const img = await out.embedJpg(await encodeJpeg(c, 0.92));
    freeCanvas(c); pg.cleanup();
    const page = out.addPage([vp1.width, vp1.height]);
    page.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    await drawTexts(out, page, list);
    onProgress && onProgress((i + 1) / total);
    await tick();
  }
  await flush();
  pdf.destroy();
  return savePdf(out);
}

/* ---------- UI ---------- */

export default function (root) {
  let file, bytes, pdf = null, gen = 0, pages = [], current = null; // current: { page, line, edit? }
  const edits = new Map(); // key "page:lineIndex" → edit
  const st = statusBar();
  const res = h('div');
  const docEl = h('div', { class: 'doc' });
  const secure = h('input', { type: 'checkbox' });
  secure.onchange = () => { gen++; res.innerHTML = ''; };
  onLeave(() => { if (pdf) { pdf.destroy(); pdf = null; } });

  // editor controls
  const ta = h('textarea', { rows: 2, 'aria-label': 'ข้อความใหม่' });
  const fontSel = h('select', { 'aria-label': 'แบบอักษร' }, ...FONTS.map(([v, l]) => h('option', { value: v }, l)));
  const sizeIn = h('input', { type: 'number', min: 4, max: 200, step: 0.5, 'aria-label': 'ขนาดตัวอักษร' });
  const boldChk = h('input', { type: 'checkbox' });
  const colorIn = h('input', { type: 'color', 'aria-label': 'สีตัวอักษร' });
  const bgIn = h('input', { type: 'color', 'aria-label': 'สีพื้นที่ใช้ปิดข้อความเดิม' });
  const detected = h('div', { class: 'sub', style: 'font-size:12.5px;color:var(--muted);word-break:break-all' });
  const editBox = h('div', { class: 'hidden', style: 'margin-top:10px' },
    h('div', { style: 'font-size:13px;color:var(--muted);margin-bottom:6px' }, 'ข้อความใหม่ (ลบให้ว่างเพื่อลบบรรทัดนี้)'), ta, detected,
    h('div', { class: 'row', style: 'margin-top:8px' }, field('แบบอักษร', fontSel)),
    h('div', { class: 'row' }, field('ขนาด (pt)', sizeIn), field('สีตัวอักษร', colorIn), field('สีพื้น', bgIn)),
    h('div', { class: 'row' }, h('label', { class: 'check' }, boldChk, 'ตัวหนา')),
    h('div', { class: 'actions', style: 'margin-top:8px' },
      h('button', { class: 'btn sm danger', onclick: () => { ta.value = ''; applyCurrent(); } }, '🗑 ลบบรรทัดนี้'),
      h('button', { class: 'btn sm', onclick: revertCurrent }, '↶ คืนค่าเดิม'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm primary', onclick: applyCurrent }, '✓ ใช้')));
  [ta, sizeIn, colorIn, bgIn].forEach(i => i.addEventListener('input', () => current && preview()));
  [fontSel, boldChk].forEach(i => i.addEventListener('change', () => current && preview()));
  const hint = h('p', { style: 'margin:0;color:var(--muted);font-size:13.5px' }, 'แตะบรรทัดบนเอกสารที่ต้องการแก้ ระบบจะจับแบบอักษร ขนาด และสีให้อัตโนมัติ');
  const count = h('span', { class: 'sub' });

  const side = h('div', { class: 'panel side', style: 'margin-top:0' },
    h('h3', {}, 'แก้ข้อความ'), hint, editBox,
    h('hr', { style: 'border-color:var(--line);margin:16px 0' }),
    h('div', { class: 'row' }, count),
    h('label', { class: 'check', style: 'margin-top:8px' }, secure, 'ลบข้อความเดิมออกจากไฟล์จริง'),
    h('p', { style: 'margin:4px 0 0;color:var(--muted);font-size:12.5px' },
      'ไม่ติ๊ก: ปิดทับด้วยสีพื้น ไฟล์คมชัดเหมือนเดิม แต่ข้อความเดิมยังซ่อนอยู่ข้างใต้ · ติ๊ก: หน้าที่แก้จะถูกแปลงเป็นภาพ ข้อความเดิมหายจริง'),
    h('p', { style: 'margin:8px 0 0;color:var(--muted);font-size:12.5px' },
      '⚠️ ถ้าข้อความที่ดึงมาเป็นภาษาไทยเพี้ยน (สระลอย ตัวอักษรแปลก) แปลว่าไฟล์เก็บรหัสตัวอักษรผิดมา ให้พิมพ์ใหม่ทั้งบรรทัด'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'), h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'บันทึก PDF')),
    st, res);
  const panel = h('div', { class: 'hidden' }, h('div', { class: 'editor-layout' }, docEl, side));
  const dz = dropzone({ accept: '.pdf', title: 'ลากไฟล์ PDF ที่ไม่ใช่ไฟล์สแกนมาวาง หรือคลิกเพื่อเลือก', hint: 'เนียนที่สุดกับเอกสารพื้นขาวที่ใช้ฟอนต์ TH Sarabun', onFiles: load });
  // Up-front guidance: this tool only works on "real text" PDFs.
  const guide = h('div', { class: 'kind-guide' },
    h('div', { class: 'kind ok' }, h('b', {}, '✅ ใช้ได้'), h('span', {}, 'PDF ที่สร้างจากคอม เช่น Save/Export จาก Word, Excel, Google Docs, ใบเสร็จ/ใบแจ้งหนี้จากระบบ, หนังสือราชการที่พิมพ์ด้วย TH Sarabun')),
    h('div', { class: 'kind no' }, h('b', {}, '❌ ใช้ไม่ได้'), h('span', {}, 'ไฟล์สแกน หรือรูปถ่ายเอกสารที่แปลงเป็น PDF — ในไฟล์มีแต่ภาพ ไม่มีตัวอักษรให้แก้')),
    h('div', { class: 'kind tip' }, h('b', {}, '💡 วิธีดูง่ายๆ'), h('span', {}, 'เปิดไฟล์แล้วลองลากคลุมข้อความ ถ้าคลุม/คัดลอกได้ = ใช้ได้ ถ้าคลุมไม่ได้ = ไฟล์สแกน')));
  const scanBox = h('div', { class: 'panel hidden', role: 'alert' });
  root.append(guide, dz, scanBox, panel);

  /** A document is "scanned" when its first pages carry (almost) no extractable text. */
  async function textInfo(doc) {
    const n = Math.min(doc.numPages, 5);
    let chars = 0;
    for (let i = 1; i <= n; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      chars += tc.items.reduce((c, it) => c + (it.str || '').replace(/\s/g, '').length, 0);
    }
    return { chars, checked: n };
  }
  function showScanned(name) {
    scanBox.innerHTML = '';
    scanBox.append(
      h('h3', { style: 'margin-top:0' }, '📷 ไฟล์นี้เป็นไฟล์สแกน / รูปภาพ'),
      h('p', { style: 'margin:0 0 10px' }, `"${name}" ไม่มีตัวอักษรจริงอยู่ในไฟล์ (มีแต่ภาพของตัวหนังสือ) จึงแก้ข้อความเดิมตรงๆ ไม่ได้`),
      h('p', { style: 'margin:0 0 12px;color:var(--muted);font-size:14px' }, 'ทางเลือกที่ทำได้กับไฟล์สแกน:'),
      h('div', { class: 'actions', style: 'margin-top:0' },
        h('a', { class: 'btn', href: '#/redact' }, '⬛ ปิดข้อความเดิม (ปิดข้อมูลส่วนตัว)'),
        h('a', { class: 'btn', href: '#/form' }, '✍️ พิมพ์ข้อความใหม่ทับ (เพิ่มข้อมูลใน PDF)'),
        h('button', { class: 'btn primary', onclick: () => { scanBox.classList.add('hidden'); dz.classList.remove('hidden'); guide.classList.remove('hidden'); } }, 'เลือกไฟล์อื่น')),
      h('p', { style: 'margin:12px 0 0;color:var(--muted);font-size:13px' }, 'เคล็ดลับ: ใช้ "ปิดข้อมูลส่วนตัว" แบบกรอบสีขาวลบของเดิม แล้วใช้ "เพิ่มข้อมูลใน PDF" พิมพ์ข้อความใหม่ลงตำแหน่งเดิม'));
    scanBox.classList.remove('hidden');
  }

  const updCount = () => {
    const n = edits.size;
    count.textContent = n ? `แก้แล้ว ${n} บรรทัด` : 'ยังไม่ได้แก้';
    unsaved.value = n > 0; gen++; res.innerHTML = '';
  };

  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    try {
      const r = await readPdf(f);
      file = f; bytes = r.bytes; gen++; edits.clear();
      if (pdf) pdf.destroy();
      pdf = await loadPdfJs(bytes);
      const info = await textInfo(pdf);
      st.set('');
      if (info.chars < 5) { pdf.destroy(); pdf = null; bytes = null; dz.classList.add('hidden'); guide.classList.add('hidden'); showScanned(f.name); return; }
      scanBox.classList.add('hidden'); guide.classList.add('hidden');
      dz.classList.add('hidden'); panel.classList.remove('hidden');
      await renderPages();
      const imgPages = pages.filter(p => !p.lines.length).map(p => p.i + 1);
      st.set(imgPages.length ? `หน้า ${imgPages.join(', ')} เป็นภาพสแกน แก้ข้อความไม่ได้ — หน้าอื่นแก้ได้ตามปกติ` : '', imgPages.length ? 'err' : '');
      updCount();
    } catch (e) { st.error(e); }
  }

  async function renderPages() {
    docEl.innerHTML = ''; pages = [];
    const n = Math.min(pdf.numPages, MAX_PREVIEW_PAGES);
    const maxW = Math.min(820, Math.max(300, docEl.clientWidth - 40));
    for (let i = 0; i < n; i++) {
      st.set(`กำลังแสดงหน้า ${i + 1}/${n}...`);
      const pg = await pdf.getPage(i + 1);
      const vp1 = pg.getViewport({ scale: 1 });
      const k = Math.min(maxW / vp1.width, 2000 / vp1.width) * Math.min(2, devicePixelRatio || 1);
      const vp = pg.getViewport({ scale: k });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const lines = limitCovers(groupLines(await pg.getTextContent(), vp1));
      // real font names are known once the page has rendered
      const fontName = (id) => { try { const o = pg.commonObjs.get(id); return (o && (o.name || o.loadedName)) || ''; } catch { return ''; } };
      lines.forEach(l => { l.pdfFont = fontName(l.fontName); l.colors = sampleColors(c, coverBox(l), k); });
      const cssW = c.width / Math.min(2, devicePixelRatio || 1);
      const img = h('img', { src: c.toDataURL('image/jpeg', 0.9), alt: `หน้า ${i + 1}`, style: 'display:block;width:100%;height:auto' });
      freeCanvas(c);
      const overlay = h('div', { class: 'overlay' });
      const P = { i, vw: vp1.width, vh: vp1.height, overlay, lines, marks: [] };
      lines.forEach((l, li) => {
        const b = coverBox(l);
        const btn = h('button', { type: 'button', class: 'tline', title: l.text,
          style: `left:${b.u / P.vw * 100}%;top:${b.v / P.vh * 100}%;width:${b.w / P.vw * 100}%;height:${b.h / P.vh * 100}%`,
          onclick: () => select(P, li) });
        l.btn = btn;
        overlay.append(btn);
      });
      pages.push(P);
      const badge = lines.length ? null : h('div', { class: 'scan-badge' }, '📷 หน้านี้เป็นภาพสแกน — แก้ข้อความไม่ได้');
      docEl.append(h('div', { class: 'page-wrap', style: `width:${cssW}px` }, h('span', { class: 'plabel' }, `หน้า ${i + 1}`), img, overlay, badge));
      await tick();
    }
    if (pdf.numPages > n) docEl.append(h('div', { class: 'sub' }, `แสดง ${n} หน้าแรก`));
  }

  /** Font size for our font so the original line keeps its width (TH Sarabun vs Sarabun differ ~30%). */
  async function calibrate(l, font, bold) {
    const spec = `${bold ? 700 : 400} 100px ${/[",]/.test(font) ? font : `"${font}"`}, "Sarabun", sans-serif`;
    try { await document.fonts.load(spec, l.text); } catch { /* system font */ }
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = spec;
    const w100 = ctx.measureText(l.text).width;
    const target = l.x1 - l.x0;
    if (!w100 || target < 4) return +l.size.toFixed(1);
    const s = target / w100 * 100;
    return +Math.min(l.size * 1.6, Math.max(l.size * 0.55, s)).toFixed(1);
  }

  async function select(P, li) {
    const l = P.lines[li], key = `${P.i}:${li}`;
    current = { P, li, key, l };
    pages.forEach(p => p.lines.forEach(x => x.btn.classList.remove('sel')));
    l.btn.classList.add('sel');
    const e = edits.get(key);
    const m = matchFont(l.pdfFont);
    ta.value = e ? e.text : l.text;
    fontSel.value = e ? e.font : m.font;
    boldChk.checked = e ? e.bold : m.bold;
    colorIn.value = e ? e.color : l.colors.ink;
    bgIn.value = e ? e.bg : l.colors.bg;
    sizeIn.value = e ? e.size : await calibrate(l, fontSel.value, boldChk.checked);
    detected.textContent = `แบบอักษรในไฟล์: ${(l.pdfFont || 'ไม่ทราบ').replace(/^[A-Z]{6}\+/, '')} → ใช้ ${FONTS.find(f => f[0] === m.font)[1]}${m.bold ? ' ตัวหนา' : ''}`;
    editBox.classList.remove('hidden'); hint.classList.add('hidden');
    ta.focus();
    preview();
  }

  const readForm = () => ({ text: ta.value.replace(/\n+/g, ' '), font: fontSel.value, bold: boldChk.checked, italic: false,
    size: Math.min(200, Math.max(4, +sizeIn.value || current.l.size)), color: colorIn.value, bg: bgIn.value });

  /** Live preview on the page: cover box + rendered new text. */
  let pseq = 0;
  async function preview(commit = false) {
    if (!current) return;
    const { P, l, key } = current;
    const e = { ...readForm(), page: P.i, cover: coverBox(l), x0: l.x0, base: l.base };
    const my = ++pseq;
    const t = e.text.trim() ? await textToPng(e.text, { size: e.size, color: e.color, font: e.font, bold: e.bold, pad: 0.1 }) : null;
    if (my !== pseq) return;
    (P.marks[current.li] || []).forEach(m => m.remove());
    const pct = (v, total) => v / total * 100 + '%';
    const cover = h('div', { class: 'tedit-cover', style: `left:${pct(e.cover.u, P.vw)};top:${pct(e.cover.v, P.vh)};width:${pct(e.cover.w, P.vw)};height:${pct(e.cover.h, P.vh)};background:${e.bg}` });
    const marks = [cover];
    if (t) {
      const left = e.x0 - t.x0, top = e.base - t.baseline;
      marks.push(h('img', { class: 'tedit-text', src: t.canvas.toDataURL(), alt: '',
        style: `left:${pct(left, P.vw)};top:${pct(top, P.vh)};width:${pct(t.w, P.vw)};height:${pct(t.h, P.vh)}` }));
    }
    P.marks[current.li] = marks;
    P.overlay.insertBefore(cover, P.overlay.firstChild);
    if (marks[1]) P.overlay.insertBefore(marks[1], cover.nextSibling);
    if (commit) { edits.set(key, e); l.btn.classList.add('edited'); updCount(); }
    else if (!edits.has(key)) { /* uncommitted preview stays until "ใช้" or another line is chosen */ }
  }
  async function applyCurrent() { await preview(true); closeEditor(); }
  function revertCurrent() {
    if (!current) return;
    (current.P.marks[current.li] || []).forEach(m => m.remove());
    current.P.marks[current.li] = [];
    edits.delete(current.key); current.l.btn.classList.remove('edited');
    updCount(); closeEditor();
  }
  function closeEditor() {
    if (current && !edits.has(current.key)) { (current.P.marks[current.li] || []).forEach(m => m.remove()); current.P.marks[current.li] = []; }
    if (current) current.l.btn.classList.remove('sel');
    current = null;
    editBox.classList.add('hidden'); hint.classList.remove('hidden');
  }

  function reset() {
    if (edits.size && !confirm('การแก้ไขจะหายไป ต้องการเลือกไฟล์ใหม่หรือไม่?')) return;
    guide.classList.remove('hidden'); scanBox.classList.add('hidden');
    gen++; closeEditor(); edits.clear(); file = bytes = null; if (pdf) { pdf.destroy(); pdf = null; }
    docEl.innerHTML = ''; res.innerHTML = ''; st.set(''); unsaved.value = false;
    panel.classList.add('hidden'); dz.classList.remove('hidden');
  }
  async function run() {
    res.innerHTML = '';
    if (current) await applyCurrent();
    if (!edits.size) return st.set('ยังไม่ได้แก้ข้อความ — แตะบรรทัดบนเอกสารเพื่อเริ่ม', 'err');
    const my = gen, name = baseName(file.name) + '_edited.pdf';
    try {
      st.set('กำลังบันทึก...'); st.progress(0);
      const out = await applyEdits(bytes, [...edits.values()], { secure: secure.checked, onProgress: p => st.progress(p) });
      st.progress(null); st.set('');
      if (my !== gen) return;
      res.append(resultBox(`แก้ ${edits.size} บรรทัด · ${fmtSize(out.length)}`, () => { download(out, name); unsaved.value = false; }));
    } catch (e) { st.error(e); }
  }
}
