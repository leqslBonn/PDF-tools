import { h, dropzone, readPdf, statusBar, download, loadPdfJs, resultBox, PL, savePdf, fmtSize, baseName, pageTile, fillThumbs, copyInto, busy, onLeave } from '../lib.js';

/** order: [{ index (0-based source page), rotate (extra degrees) }] */
export async function organizePdf(bytes, order) {
  const src = await PL().PDFDocument.load(bytes);
  const out = await PL().PDFDocument.create();
  const pages = await copyInto(out, src, order.map(o => o.index));
  pages.forEach((p, i) => {
    const r = order[i].rotate || 0;
    if (r) p.setRotation(PL().degrees((p.getRotation().angle + r + 360) % 360));
  });
  return savePdf(out);
}

export default function (root) {
  let file, bytes, pages = [], pdf = null, gen = 0; // pages: {index, rotate, off, tile}
  const closePdf = () => { if (pdf) { pdf.destroy(); pdf = null; } };
  onLeave(closePdf);
  const grid = h('div', { class: 'pages' });
  const st = statusBar();
  const res = h('div');
  const info = h('span', { class: 'sub' });
  const panel = h('div', { class: 'panel hidden' },
    h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, 'ลากเพื่อสลับลำดับ · คลิกหน้าเพื่อตัดออก/คืน'), h('div', { class: 'spacer' }), info),
    h('div', { class: 'actions', style: 'margin:10px 0 14px' },
      h('button', { class: 'btn sm', onclick: () => rotAll(-90) }, '⟲ หมุนทั้งหมด'),
      h('button', { class: 'btn sm', onclick: () => rotAll(90) }, '⟳ หมุนทั้งหมด'),
      h('button', { class: 'btn sm', onclick: () => { pages.reverse(); redraw(); } }, '⇅ กลับลำดับ'),
      h('button', { class: 'btn sm', onclick: () => { pages.forEach(p => p.off = false); redraw(); } }, 'คืนทุกหน้า'),
      h('button', { class: 'btn sm', onclick: reset }, 'เลือกไฟล์ใหม่'),
    ),
    grid,
    h('div', { class: 'actions' }, h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'บันทึก PDF')),
    st, res);
  const dz = dropzone({ accept: '.pdf', hint: 'เลือกทีละไฟล์ — ลากสลับตำแหน่งหน้า หรือคลิกหน้าที่ไม่ต้องการเพื่อตัดออก', onFiles: load });
  root.append(dz, panel);

  new Sortable(grid, {
    animation: 150, filter: '.btn', preventOnFilter: false, delay: 120, delayOnTouchOnly: true,
    onEnd: (e) => { const [m] = pages.splice(e.oldIndex, 1); pages.splice(e.newIndex, 0, m); changed(); },
  });

  function reset() { gen++; closePdf(); file = null; pages = []; grid.innerHTML = ''; res.innerHTML = ''; st.set(''); panel.classList.add('hidden'); dz.classList.remove('hidden'); }
  function changed() { gen++; res.innerHTML = ''; updateInfo(); }

  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    try {
      const r = await readPdf(f);
      file = f; bytes = r.bytes;
      closePdf();
      pdf = await loadPdfJs(bytes);
      pages = Array.from({ length: pdf.numPages }, (_, i) => ({ index: i, rotate: 0, off: false }));
      pages.forEach(p => {
        p.tile = pageTile(p.index + 1, [h('div', { class: 'tools' },
          h('button', { class: 'btn sm icon', title: 'หมุนซ้าย', onclick: (e) => { e.stopPropagation(); rot(p, -90); } }, '⟲'),
          h('button', { class: 'btn sm icon', title: 'หมุนขวา', onclick: (e) => { e.stopPropagation(); rot(p, 90); } }, '⟳'),
          h('button', { class: 'btn sm icon danger', title: 'ตัดออก', onclick: (e) => { e.stopPropagation(); toggle(p); } }, '✕'),
        )]);
        p.tile.onclick = () => toggle(p);
      });
      dz.classList.add('hidden'); panel.classList.remove('hidden');
      redraw(); st.set('');
      const doc = pdf;
      await fillThumbs(doc, pages.map(p => p.tile), { stopWhenDetached: true });
      pages.forEach(applyRot);
      if (doc === pdf) closePdf();
    } catch (e) { st.error(e); }
  }
  const applyRot = (p) => { if (p.tile.canvas) p.tile.canvas.style.transform = `rotate(${p.rotate}deg) scale(${p.rotate % 180 ? 0.75 : 1})`; };
  function rot(p, d) { p.rotate = (p.rotate + d + 360) % 360; applyRot(p); changed(); }
  function rotAll(d) { pages.forEach(p => rot(p, d)); }
  function toggle(p) { p.off = !p.off; p.tile.classList.toggle('off', p.off); p.tile.setAttribute('aria-pressed', String(p.off)); changed(); }
  function redraw() {
    grid.innerHTML = '';
    pages.forEach(p => { p.tile.classList.toggle('off', p.off); grid.append(p.tile); });
    changed();
  }
  function updateInfo() { const k = pages.filter(p => !p.off).length; info.textContent = `เหลือ ${k} จาก ${pages.length} หน้า`; }

  async function run() {
    res.innerHTML = '';
    const order = pages.filter(p => !p.off);
    if (!order.length) return st.set('ต้องเหลืออย่างน้อย 1 หน้า', 'err');
    const my = gen, name = baseName(file.name) + '_organized.pdf';
    try {
      st.set('กำลังสร้างไฟล์...');
      const out = await organizePdf(bytes, order);
      st.set('');
      if (my !== gen) return;
      res.append(resultBox(`${order.length} หน้า · ${fmtSize(out.length)}`, () => download(out, name)));
    } catch (e) { st.error(e); }
  }
}
