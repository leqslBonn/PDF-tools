import { h, dropzone, readPdf, statusBar, download, resultBox, PL, savePdf, fmtSize, baseName, pageGeom, loadPdfJs, renderPage, MAX_PREVIEW_PAGES, busy, freeCanvas } from '../lib.js';
import { rasterizePdf } from './compress.js';

/** boxes: array (per page) of {l,t,r,b} fractions of the visible page to cut away; missing → `all`. */
export async function cropPdf(bytes, boxes, all) {
  const doc = await PL().PDFDocument.load(bytes);
  doc.getPages().forEach((page, i) => {
    const m = boxes[i] || all;
    if (!m) return;
    const { vw, vh, v2p } = pageGeom(page);
    const a = v2p(m.l * vw, m.t * vh), b = v2p((1 - m.r) * vw, (1 - m.b) * vh);
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), hh = Math.abs(a.y - b.y);
    page.setCropBox(x, y, w, hh);
    page.setMediaBox(x, y, w, hh);
  });
  return savePdf(doc);
}

/** Find the non-white content bounds of a rendered canvas, as margin fractions. */
export function detectMargins(canvas, pad = 0.01) {
  const { width: w, height: hh } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, hh).data;
  let x0 = w, y0 = hh, x1 = -1, y1 = -1;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { l: 0, t: 0, r: 0, b: 0 };
  const c = (v) => Math.max(0, v);
  return { l: c(x0 / w - pad), t: c(y0 / hh - pad), r: c(1 - (x1 + 1) / w - pad), b: c(1 - (y1 + 1) / hh - pad) };
}

/** Draggable crop rectangle over a page element. m = {l,t,r,b}; onChange(m). */
function cropOverlay(wrap, m, onChange) {
  const box = h('div', { class: 'cropbox', tabindex: 0, role: 'group', 'aria-label': 'กรอบครอบตัด — ใช้ลูกศรเพื่อเลื่อน, Shift+ลูกศรเพื่อปรับขนาด' },
    ...['nw', 'ne', 'sw', 'se'].map(k => h('div', { class: 'h ' + k, 'data-k': k })));
  const place = () => Object.assign(box.style, { left: m.l * 100 + '%', top: m.t * 100 + '%', right: m.r * 100 + '%', bottom: m.b * 100 + '%' });
  place();
  wrap.append(box);
  const MIN = 0.05, cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  box.onkeydown = (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const dx = d[0] * 0.01, dy = d[1] * 0.01;
    if (e.shiftKey) { m.r = cl(m.r - dx, 0, 1 - m.l - MIN); m.b = cl(m.b - dy, 0, 1 - m.t - MIN); }
    else { const ddx = cl(dx, -m.l, m.r), ddy = cl(dy, -m.t, m.b); m.l += ddx; m.r -= ddx; m.t += ddy; m.b -= ddy; }
    place(); onChange(m);
  };
  box.onpointerdown = (e) => {
    e.preventDefault();
    box.focus({ preventScroll: true });
    const k = e.target.dataset.k || 'move';
    const R = wrap.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, s = { ...m };
    const mv = (ev) => {
      const dx = (ev.clientX - sx) / R.width, dy = (ev.clientY - sy) / R.height;
      if (k === 'move') {
        const ddx = cl(dx, -s.l, s.r), ddy = cl(dy, -s.t, s.b);
        m.l = s.l + ddx; m.r = s.r - ddx; m.t = s.t + ddy; m.b = s.b - ddy;
      } else {
        if (k.includes('w')) m.l = cl(s.l + dx, 0, 1 - s.r - MIN);
        if (k.includes('e')) m.r = cl(s.r - dx, 0, 1 - s.l - MIN);
        if (k.includes('n')) m.t = cl(s.t + dy, 0, 1 - s.b - MIN);
        if (k.includes('s')) m.b = cl(s.b - dy, 0, 1 - s.t - MIN);
      }
      place(); onChange(m);
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  box.place = place;
  return box;
}

export default function (root) {
  let file, bytes, pages = [], gen = 0; // pages: {m, box, probe (small canvas for auto-detect)}
  const same = h('input', { type: 'checkbox', checked: true });
  const secure = h('input', { type: 'checkbox' });
  secure.onchange = () => { gen++; res.innerHTML = ''; };
  const st = statusBar();
  const res = h('div');
  const docEl = h('div', { class: 'doc' });
  const panel = h('div', { class: 'hidden' },
    h('div', { class: 'editor-layout' },
      docEl,
      h('div', { class: 'panel side', style: 'margin-top:0' },
        h('h3', {}, 'ครอบตัดขอบ'),
        h('p', { class: 'sub', style: 'margin-top:0;color:var(--muted);font-size:13.5px' }, 'ลากกรอบสีน้ำเงินหรือจุดมุมเพื่อกำหนดพื้นที่ที่ต้องการเก็บไว้ ส่วนที่มืดจะถูกตัดออก'),
        h('label', { class: 'check' }, same, 'ใช้ขอบเดียวกันทุกหน้า'),
        h('label', { class: 'check', style: 'margin-top:8px' }, secure, 'ลบข้อมูลนอกกรอบออกจริง (แปลงหน้าเป็นภาพ)'),
        h('p', { class: 'sub', style: 'margin:6px 0 0;color:var(--muted);font-size:12.5px' },
          'ถ้าไม่ติ๊ก: ส่วนนอกกรอบแค่ถูกซ่อน ยังอยู่ในไฟล์และกู้คืนได้ — ถ้าจะตัดเพื่อปิดข้อมูลสำคัญ ให้ติ๊กช่องนี้ (ข้อความจะคัดลอกไม่ได้)'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn sm', onclick: auto }, '✨ ตัดขอบขาวอัตโนมัติ'),
          h('button', { class: 'btn sm', onclick: () => setAll({ l: 0, t: 0, r: 0, b: 0 }) }, 'รีเซ็ต')),
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'), h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'ครอบตัด PDF')),
        st, res)));
  const dz = dropzone({ accept: '.pdf', hint: 'ปรับขอบครอบของแต่ละหน้าแยกกันได้หลังอัปโหลด', onFiles: load });
  root.append(dz, panel);

  function reset() { gen++; file = null; pages = []; docEl.innerHTML = ''; res.innerHTML = ''; st.set(''); panel.classList.add('hidden'); dz.classList.remove('hidden'); }
  function setAll(m) { pages.forEach(p => { Object.assign(p.m, m); p.box.place(); }); gen++; res.innerHTML = ''; }

  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    try {
      const r = await readPdf(f);
      file = f; bytes = r.bytes;
      const my = ++gen;
      const pdf = await loadPdfJs(bytes);
      dz.classList.add('hidden'); panel.classList.remove('hidden');
      docEl.innerHTML = ''; pages = [];
      const n = Math.min(pdf.numPages, MAX_PREVIEW_PAGES);
      for (let i = 1; i <= n; i++) {
        if (my !== gen) { pdf.destroy(); return; }
        st.set(`กำลังแสดงหน้า ${i}/${n}...`);
        const c = await renderPage(pdf, i, { maxW: 560, maxH: 760 });
        // Keep a JPEG <img> for display and a tiny canvas for auto-detect, not 50 full canvases.
        const img = h('img', { src: c.toDataURL('image/jpeg', 0.85), alt: `หน้า ${i}`, draggable: 'false',
          style: `display:block;width:${Math.round(c.width / Math.min(2, devicePixelRatio || 1))}px;max-width:100%;height:auto` });
        const probe = document.createElement('canvas');
        const k = Math.min(1, 300 / Math.max(c.width, c.height));
        probe.width = Math.round(c.width * k); probe.height = Math.round(c.height * k);
        probe.getContext('2d').drawImage(c, 0, 0, probe.width, probe.height);
        freeCanvas(c);
        const wrap = h('div', { class: 'page-wrap page-clip' }, img);
        const p = { m: { l: 0.05, t: 0.05, r: 0.05, b: 0.05 }, probe };
        p.box = cropOverlay(wrap, p.m, (m) => { gen++; res.innerHTML = ''; if (same.checked) pages.forEach(q => { if (q !== p) { Object.assign(q.m, m); q.box.place(); } }); });
        pages.push(p);
        docEl.append(h('div', { style: 'position:relative;padding-top:20px;max-width:100%' }, h('span', { class: 'plabel', style: 'position:absolute;top:0;left:0;font-size:12px;color:var(--muted)' }, `หน้า ${i}`), wrap));
      }
      if (pdf.numPages > n) docEl.append(h('div', { class: 'sub' }, `หน้าที่ ${n + 1}–${pdf.numPages} จะใช้ขอบเดียวกับหน้าแรก`));
      pdf.destroy();
      st.set(r.unlocked ? '🔓 ปลดล็อกไฟล์แล้ว' : '');
    } catch (e) { st.error(e); }
  }
  function auto() {
    if (same.checked) {
      // union of content across pages → smallest margins
      const ms = pages.map(p => detectMargins(p.probe));
      setAll({ l: Math.min(...ms.map(m => m.l)), t: Math.min(...ms.map(m => m.t)), r: Math.min(...ms.map(m => m.r)), b: Math.min(...ms.map(m => m.b)) });
    } else { pages.forEach(p => { Object.assign(p.m, detectMargins(p.probe)); p.box.place(); }); gen++; res.innerHTML = ''; }
  }
  async function run() {
    const my = gen, name = baseName(file.name) + '_cropped.pdf';
    try {
      st.set('กำลังครอบตัด...');
      let out = await cropPdf(bytes, same.checked ? [] : pages.map(p => ({ ...p.m })), { ...pages[0].m });
      if (secure.checked) {
        st.set('กำลังลบข้อมูลนอกกรอบ...'); st.progress(0);
        out = await rasterizePdf(out, { dpi: 200, q: 0.88 }, p => st.progress(p));
        st.progress(null);
      }
      st.set('');
      if (my !== gen) return;
      res.innerHTML = '';
      res.append(resultBox(fmtSize(out.length) + (secure.checked ? ' · ลบข้อมูลนอกกรอบแล้ว' : ''), () => download(out, name)));
    } catch (e) { st.error(e); }
  }
}
