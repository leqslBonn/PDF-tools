import { h, dropzone, readPdf, statusBar, download, resultBox, PL, savePdf, fmtSize, baseName, seg, field, loadPdfJs, canvasToBytes,
  freeCanvas, busy, onLeave, copyInto, MAX_PREVIEW_PAGES, tick } from '../lib.js';
import { createEditor } from '../editor.js';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='; // transparent 1×1 (box colour comes from CSS)

/** Search patterns for common personal data. Each returns [start, end] index pairs within a string. */
const PRESETS = {
  id: { label: 'เลขบัตรประชาชน', find: (s) => [...s.matchAll(/\d[\d\s-]{11,20}\d/g)].filter(m => m[0].replace(/\D/g, '').length === 13).map(m => [m.index, m.index + m[0].length]) },
  phone: { label: 'เบอร์โทร', find: (s) => [...s.matchAll(/(?<!\d)0\d(?:[\s-]?\d){7,8}(?!\d)/g)].map(m => [m.index, m.index + m[0].length]) },
  email: { label: 'อีเมล', find: (s) => [...s.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map(m => [m.index, m.index + m[0].length]) },
  bank: { label: 'เลขบัญชี', find: (s) => [...s.matchAll(/(?<!\d)\d{3}[- ]?\d[- ]?\d{5}[- ]?\d(?!\d)/g)].map(m => [m.index, m.index + m[0].length]) },
};
const literal = (q) => (s) => {
  const out = [], a = s.toLowerCase(), b = q.toLowerCase();
  for (let i = a.indexOf(b); i >= 0 && b; i = a.indexOf(b, i + b.length)) out.push([i, i + b.length]);
  return out;
};

/**
 * Find text matches on the first MAX_PREVIEW_PAGES pages.
 * Returns [{ page (0-based), u, v, w, h }] as fractions of the visible page.
 */
const mctx = document.createElement('canvas').getContext('2d');
mctx.font = '100px Arial, "Helvetica Neue", "Sarabun", sans-serif';
const measure = (t) => mctx.measureText(t).width;

export async function findText(bytes, finder) {
  const pdf = await loadPdfJs(bytes);
  const hits = [];
  const n = Math.min(pdf.numPages, MAX_PREVIEW_PAGES);
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str) continue;
      const [a, b, , d, e, f] = it.transform;
      const fontH = Math.hypot(it.transform[2], d) || it.height || 10;
      const len = it.str.length;
      for (const [s0, s1] of finder(it.str)) {
        // horizontal span of the substring, from measured text widths (char counts are too rough),
        // padded ~half a character each side: covering a bit too much is safer than too little
        const full = measure(it.str) || len;
        const padC = 0.45 / Math.max(1, len);
        const x0 = Math.max(0, measure(it.str.slice(0, s0)) / full - padC), x1 = Math.min(1, measure(it.str.slice(0, s1)) / full + padC);
        const dirX = a / (Math.hypot(a, b) || 1), dirY = b / (Math.hypot(a, b) || 1);
        const sx = e + dirX * it.width * x0, sy = f + dirY * it.width * x0;
        const ex = e + dirX * it.width * x1, ey = f + dirY * it.width * x1;
        // text box: from a little below the baseline to the top of tall Thai marks
        const nx = -dirY, ny = dirX;
        const pts = [
          [sx - nx * fontH * 0.3, sy - ny * fontH * 0.3], [ex - nx * fontH * 0.3, ey - ny * fontH * 0.3],
          [sx + nx * fontH * 1.05, sy + ny * fontH * 1.05], [ex + nx * fontH * 1.05, ey + ny * fontH * 1.05],
        ].map(([x, y]) => vp.convertToViewportPoint(x, y));
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        const pad = 1.5;
        const u = Math.max(0, Math.min(...xs) - pad), v = Math.max(0, Math.min(...ys) - pad);
        hits.push({ page: p - 1, u: u / vp.width, v: v / vp.height,
          w: Math.min(vp.width - u, Math.max(...xs) - Math.min(...xs) + pad * 2) / vp.width,
          h: Math.min(vp.height - v, Math.max(...ys) - Math.min(...ys) + pad * 2) / vp.height });
      }
    }
    page.cleanup();
  }
  pdf.destroy();
  return hits;
}

/**
 * Burn boxes into the pages: every page that has a box is re-rendered as an image with the
 * boxes painted in, so the covered text/images are really gone. Other pages stay untouched.
 * boxes: [{ page, u, v, w, h }] (fractions of the visible page), color '#000000' | '#ffffff'.
 */
export async function redactPdf(bytes, boxes, { color = '#000000', dpi = 200, onProgress } = {}) {
  const src = await PL().PDFDocument.load(bytes);
  const out = await PL().PDFDocument.create();
  const pdf = await loadPdfJs(bytes);
  const byPage = new Map();
  for (const b of boxes) { if (!byPage.has(b.page)) byPage.set(b.page, []); byPage.get(b.page).push(b); }
  const total = src.getPageCount();
  let run = []; // consecutive untouched pages copied together
  const flush = async () => { if (run.length) { await copyInto(out, src, run); run = []; } };
  for (let i = 0; i < total; i++) {
    const list = byPage.get(i);
    if (!list) { run.push(i); continue; }
    await flush();
    const page = await pdf.getPage(i + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: dpi / 72 });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    ctx.fillStyle = color;
    for (const b of list) ctx.fillRect(Math.floor(b.u * c.width), Math.floor(b.v * c.height), Math.ceil(b.w * c.width) + 1, Math.ceil(b.h * c.height) + 1);
    const img = await out.embedJpg(await canvasToBytes(c, 'image/jpeg', 0.9));
    freeCanvas(c);
    page.cleanup();
    out.addPage([vp1.width, vp1.height]).drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    onProgress && onProgress((i + 1) / total);
    await tick();
  }
  await flush();
  pdf.destroy();
  return savePdf(out);
}

export default function (root) {
  let file, bytes, gen = 0, color = '#000000';
  const st = statusBar();
  const res = h('div');
  const edHost = h('div');
  const count = h('span', { class: 'sub' }, 'ยังไม่มีกรอบ');
  const changed = () => {
    gen++; res.innerHTML = '';
    const n = ed.items().length;
    count.textContent = n ? `${n} กรอบ ใน ${new Set(ed.items().map(i => i.page)).size} หน้า` : 'ยังไม่มีกรอบ';
  };
  const ed = createEditor(edHost, { onChange: changed, onSelect: () => {}, onDrawRect: (page, rect) => addBox(page, rect, false) });

  function addBox(page, rect, quiet) {
    return ed.add({ kind: 'box', src: PIXEL, cls: 'redact' + (color === '#ffffff' ? ' white' : ''), keepAspect: false }, { page, rect, quiet });
  }
  function recolor() {
    ed.items().forEach(it => it.el.classList.toggle('white', color === '#ffffff'));
    changed();
  }

  const q = h('input', { type: 'text', placeholder: 'พิมพ์ข้อความที่ต้องการปิด เช่น ชื่อ-นามสกุล' });
  async function search(finder, label) {
    if (!bytes) return;
    st.set('กำลังค้นหา...');
    try {
      const hits = await findText(bytes, finder);
      hits.forEach(r => addBox(r.page, { u: r.u, v: r.v, w: r.w, h: r.h }, true));
      st.set(hits.length ? `เจอ${label} ${hits.length} จุด — ตรวจดูอีกครั้งว่าครบ (ข้อความที่อยู่ในรูปภาพหรือไฟล์สแกนจะค้นหาไม่เจอ)` : `ไม่เจอ${label} — ถ้าเป็นไฟล์สแกน ให้ลากวาดกรอบเองบนหน้า`, hits.length ? 'ok' : '');
    } catch (e) { st.error(e); }
  }
  const drawToggle = seg([['on', '✏️ ลากวาดกรอบ'], ['off', '✋ เลื่อน/ย้ายกรอบ']], 'on', v => ed.setDrawMode(v === 'on'));

  const side = h('div', { class: 'panel side', style: 'margin-top:0' },
    h('h3', {}, 'ปิดข้อมูลส่วนตัว'),
    h('p', { style: 'margin:0 0 10px;color:var(--muted);font-size:13.5px' }, 'ลากบนหน้าเอกสารเพื่อวาดกรอบทับข้อมูลที่ไม่อยากให้เห็น หรือค้นหาอัตโนมัติด้านล่าง'),
    drawToggle,
    h('div', { class: 'row', style: 'margin-top:12px' }, field('สีกรอบ', seg([['#000000', '⬛ ดำ'], ['#ffffff', '⬜ ขาว']], color, v => { color = v; recolor(); }))),
    h('div', { style: 'margin:14px 0 6px;font-size:13px;color:var(--muted)' }, 'ค้นหาแล้วปิดอัตโนมัติ'),
    h('div', { class: 'row', style: 'gap:6px' }, ...Object.values(PRESETS).map(p => h('button', { class: 'btn sm', onclick: busy(() => search(p.find, p.label)) }, p.label))),
    h('div', { class: 'row', style: 'margin-top:8px;gap:6px;flex-wrap:nowrap' }, q,
      h('button', { class: 'btn sm', onclick: busy(() => q.value.trim() ? search(literal(q.value.trim()), ` "${q.value.trim()}"`) : st.set('พิมพ์ข้อความที่ต้องการค้นหา', 'err')) }, 'ค้นหา')),
    h('div', { class: 'row', style: 'margin-top:14px' }, count, h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm danger', onclick: () => { if (ed.items().length && confirm('ลบกรอบทั้งหมด?')) ed.clear(); } }, 'ลบกรอบทั้งหมด')),
    h('p', { style: 'margin:12px 0 0;color:var(--muted);font-size:12.5px' },
      '🔒 หน้าที่มีกรอบจะถูกแปลงเป็นภาพ ข้อมูลใต้กรอบถูกลบออกจริง คัดลอกหรือกู้คืนไม่ได้ (ข้อความในหน้านั้นจะคัดลอกไม่ได้ด้วย) หน้าที่ไม่มีกรอบคงเดิม'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'), h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'ปิดข้อมูลและบันทึก')),
    st, res);
  const panel = h('div', { class: 'hidden' }, h('div', { class: 'editor-layout' }, edHost, side));
  const dz = dropzone({ accept: '.pdf', hint: 'เช่น สำเนาบัตร statement ธนาคาร เอกสารที่มีข้อมูลคนอื่น', onFiles: load });
  root.append(dz, panel);
  onLeave(() => { bytes = null; });

  function reset() {
    if (ed.items().length && !confirm('กรอบที่วาดไว้จะหายไป ต้องการเลือกไฟล์ใหม่หรือไม่?')) return;
    gen++; file = bytes = null; ed.destroy(); q.value = ''; res.innerHTML = ''; st.set(''); changed();
    panel.classList.add('hidden'); dz.classList.remove('hidden');
  }
  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    try {
      const r = await readPdf(f);
      file = f; bytes = r.bytes; gen++;
      dz.classList.add('hidden'); panel.classList.remove('hidden');
      st.set('กำลังแสดงเอกสาร...');
      await ed.load(bytes);
      ed.setDrawMode(true);
      st.set(r.pages > MAX_PREVIEW_PAGES ? `แสดงและค้นหาได้ ${MAX_PREVIEW_PAGES} หน้าแรก` : '');
    } catch (e) { st.error(e); }
  }
  async function run() {
    res.innerHTML = '';
    const boxes = ed.items().map(({ page, u, v, w, h: hh }) => ({ page, u, v, w, h: hh }));
    if (!boxes.length) return st.set('ยังไม่มีกรอบ — ลากบนหน้าเอกสารเพื่อวาดกรอบก่อน', 'err');
    const my = gen, name = baseName(file.name) + '_redacted.pdf';
    try {
      st.set('กำลังลบข้อมูลใต้กรอบ...'); st.progress(0);
      const out = await redactPdf(bytes, boxes, { color, onProgress: p => st.progress(p) });
      st.progress(null); st.set('');
      if (my !== gen) return;
      res.append(resultBox(`ปิดข้อมูล ${boxes.length} จุด · ${fmtSize(out.length)}`, () => { download(out, name); ed.saved(); }));
    } catch (e) { st.error(e); }
  }
}
