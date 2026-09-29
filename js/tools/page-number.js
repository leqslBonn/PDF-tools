import { h, dropzone, readBytes, statusBar, download, resultBox, PL, savePdf, fmtSize, baseName, seg, field, textToPng, toThaiDigits, pageGeom, drawVisual, loadPdfJs, renderPage } from '../lib.js';

export const FORMATS = {
  n: (n) => `${n}`,
  page: (n) => `หน้า ${n}`,
  of: (n, t) => `${n} / ${t}`,
  pageof: (n, t) => `หน้า ${n} จาก ${t}`,
  dash: (n) => `- ${n} -`,
};

/**
 * opts: { pos: 'tl'|'tc'|'tr'|'bl'|'bc'|'br', digits: 'arabic'|'thai', format, start, size, margin, color, skipFirst, from, to }
 */
export async function addPageNumbers(bytes, o = {}) {
  const { pos = 'bc', digits = 'arabic', format = 'n', start = 1, size = 12, margin = 28, color = '#000000', skipFirst = false } = o;
  const doc = await PL().PDFDocument.load(bytes);
  const pages = doc.getPages();
  const first = skipFirst ? 1 : 0;
  const total = pages.length - first + start - 1;
  const cache = new Map();
  for (let i = first; i < pages.length; i++) {
    const n = i - first + start;
    let label = FORMATS[format](n, total);
    if (digits === 'thai') label = toThaiDigits(label);
    if (!cache.has(label)) {
      const t = await textToPng(label, { size, color });
      cache.set(label, { img: await doc.embedPng(t.bytes), w: t.w, h: t.h });
    }
    const { img, w, h: hh } = cache.get(label);
    const page = pages[i];
    const { vw, vh } = pageGeom(page);
    const cu = pos[1] === 'l' ? margin + w / 2 : pos[1] === 'r' ? vw - margin - w / 2 : vw / 2;
    const cv = pos[0] === 't' ? margin * 0.8 + hh / 2 : vh - margin * 0.8 - hh / 2;
    drawVisual(page, img, { cu, cv, w, h: hh });
  }
  return savePdf(doc);
}

export default function (root) {
  let file, bytes, previewSrc;
  const o = { pos: 'bc', digits: 'arabic', format: 'n', start: 1, size: 12, margin: 28, color: '#000000', skipFirst: false };
  const st = statusBar();
  const res = h('div');
  const preview = h('div', { class: 'doc', style: 'min-height:200px' });
  const posGrid = h('div', { style: 'display:grid;grid-template-columns:repeat(3,44px);gap:4px' });
  const positions = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];
  const drawPos = () => {
    posGrid.innerHTML = '';
    positions.forEach(p => posGrid.append(h('button', { type: 'button', class: 'btn sm' + (o.pos === p ? ' primary' : ''), style: 'height:34px',
      title: p, onclick: () => { o.pos = p; drawPos(); refresh(); } }, { tl: '↖', tc: '↑', tr: '↗', bl: '↙', bc: '↓', br: '↘' }[p])));
  };
  drawPos();
  const num = (k, min, max) => { const i = h('input', { type: 'number', min, max, value: o[k] }); i.oninput = () => { o[k] = +i.value || 0; refresh(); }; return i; };
  const fmtSel = h('select', {}, ...Object.entries({ n: '1', page: 'หน้า 1', of: '1 / 10', pageof: 'หน้า 1 จาก 10', dash: '- 1 -' }).map(([v, l]) => h('option', { value: v }, l)));
  fmtSel.onchange = () => { o.format = fmtSel.value; refresh(); };
  const color = h('input', { type: 'color', value: o.color }); color.oninput = () => { o.color = color.value; refresh(); };
  const skip = h('input', { type: 'checkbox' }); skip.onchange = () => { o.skipFirst = skip.checked; refresh(); };

  const panel = h('div', { class: 'hidden' },
    h('div', { class: 'editor-layout' },
      preview,
      h('div', { class: 'panel side', style: 'margin-top:0' },
        h('h3', {}, 'ตั้งค่า'),
        field('ตำแหน่ง', posGrid),
        h('div', { class: 'row' }, field('ชนิดตัวเลข', seg([['arabic', '1 2 3'], ['thai', '๑ ๒ ๓']], o.digits, v => { o.digits = v; refresh(); }))),
        h('div', { class: 'row' }, field('รูปแบบ', fmtSel)),
        h('div', { class: 'row' }, field('เริ่มที่เลข', num('start', 0, 9999)), field('ขนาดตัวอักษร', num('size', 6, 72))),
        h('div', { class: 'row' }, field('ระยะจากขอบ (pt)', num('margin', 0, 200)), field('สี', color)),
        h('div', { class: 'row' }, h('label', { class: 'check' }, skip, 'ไม่ใส่เลขหน้าแรก (หน้าปก)')),
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'), h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: run }, 'ใส่เลขหน้า')),
        st, res)));
  const dz = dropzone({ accept: '.pdf', onFiles: load });
  root.append(dz, panel);

  function reset() { file = null; res.innerHTML = ''; panel.classList.add('hidden'); dz.classList.remove('hidden'); }
  async function load([f]) {
    file = f; bytes = await readBytes(f);
    try {
      const src = await PL().PDFDocument.load(bytes);
      const tmp = await PL().PDFDocument.create();
      (await tmp.copyPages(src, [...Array(Math.min(2, src.getPageCount())).keys()])).forEach(p => tmp.addPage(p));
      previewSrc = await tmp.save();
    } catch (e) { return st.error(e); }
    dz.classList.add('hidden'); panel.classList.remove('hidden');
    refresh();
  }
  let timer, previewSeq = 0;
  function refresh() { clearTimeout(timer); timer = setTimeout(drawPreview, 250); res.innerHTML = ''; }
  async function drawPreview() {
    if (!bytes) return;
    try {
      // Preview: first 2 pages only, with numbers applied.
      const seq = ++previewSeq;
      const out = await addPageNumbers(previewSrc, { ...o });
      if (seq !== previewSeq) return;
      const pdf = await loadPdfJs(out);
      const n = pdf.numPages;
      preview.innerHTML = '';
      for (let i = 1; i <= n; i++) {
        const c = await renderPage(pdf, i, { maxW: 560, maxH: 800 });
        c.style.maxWidth = '100%';
        preview.append(h('div', { class: 'page-wrap' }, h('span', { class: 'plabel' }, `ตัวอย่างหน้า ${i}`), c));
      }
      pdf.destroy();
    } catch (e) { st.error(e); }
  }
  async function run() {
    try {
      st.set('กำลังใส่เลขหน้า...');
      const out = await addPageNumbers(bytes, o);
      st.set('');
      res.innerHTML = '';
      res.append(resultBox(fmtSize(out.length), () => download(out, baseName(file.name) + '_numbered.pdf')));
    } catch (e) { st.error(e); }
  }
}
