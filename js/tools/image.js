import { h, dropzone, readPdf, statusBar, download, downloadZip, loadPdfJs, renderPage, fmtSize, baseName, seg, field, canvasToBytes, MAX_PREVIEW_PAGES, busy, freeCanvas } from '../lib.js';
import { encodeJpeg } from '../work.js';

/** Render pages → [{name, data(Uint8Array), canvas}] */
export async function pdfToImages(bytes, { format = 'jpeg', dpi = 150, quality = 0.9, pages, onProgress } = {}) {
  const pdf = await loadPdfJs(bytes);
  const list = pages || Array.from({ length: Math.min(pdf.numPages, MAX_PREVIEW_PAGES) }, (_, i) => i + 1);
  const out = [];
  for (const n of list) {
    const c = await renderPage(pdf, n, { scale: dpi / 72 });
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    // Keep only a small thumbnail; free the full-size canvas immediately (50 pages at 300 dpi would exhaust memory).
    const thumb = document.createElement('canvas');
    const k = Math.min(260 / c.width, 300 / c.height, 1);
    thumb.width = Math.max(1, Math.round(c.width * k)); thumb.height = Math.max(1, Math.round(c.height * k));
    thumb.getContext('2d').drawImage(c, 0, 0, thumb.width, thumb.height);
    const data = type === 'image/jpeg' ? await encodeJpeg(c, quality, { progressive: true }) : await canvasToBytes(c, type, quality);
    const size = [c.width, c.height];
    freeCanvas(c);
    out.push({ n, thumb, size, data, type, ext: format === 'png' ? 'png' : 'jpg' });
    onProgress && onProgress(out.length / list.length);
  }
  pdf.destroy();
  return { images: out, total: pdf.numPages };
}

export default function (root) {
  let file, bytes, images = [], selected = new Set(), gen = 0;
  let format = 'jpeg', dpi = 150;
  const grid = h('div', { class: 'pages' });
  const st = statusBar();
  const selInfo = h('span', { class: 'sub' });
  const dlSel = h('button', { class: 'btn primary', onclick: () => dl([...selected]) }, '⬇ ดาวน์โหลดที่เลือก');
  const results = h('div', { class: 'hidden' },
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm', onclick: () => { selected = new Set(images.map((_, i) => i)); paint(); } }, 'เลือกทั้งหมด'),
      h('button', { class: 'btn sm', onclick: () => { selected.clear(); paint(); } }, 'ล้าง'),
      selInfo, h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => dl(images.map((_, i) => i)) }, '⬇ ทั้งหมด (.zip)'), dlSel),
    h('div', { style: 'margin-top:14px' }, grid));
  const panel = h('div', { class: 'panel hidden' },
    h('div', { class: 'row' },
      field('รูปแบบไฟล์', seg([['jpeg', 'JPEG'], ['png', 'PNG']], format, v => { format = v; stale(); })),
      field('ความละเอียด', seg([[96, 'ต่ำ (96 dpi)'], [150, 'กลาง (150 dpi)'], [300, 'สูง (300 dpi)']], dpi, v => { dpi = +v; stale(); })),
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'),
      h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'แปลงเป็นรูป')),
    st, results);
  const dz = dropzone({ accept: '.pdf', hint: `แปลงได้สูงสุด ${MAX_PREVIEW_PAGES} หน้าแรก`, onFiles: load });
  root.append(dz, panel);

  function stale() { gen++; images = []; grid.innerHTML = ''; results.classList.add('hidden'); }
  function reset() { gen++; file = null; images = []; grid.innerHTML = ''; results.classList.add('hidden'); panel.classList.add('hidden'); dz.classList.remove('hidden'); st.set(''); }
  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    let r;
    try { r = await readPdf(f); } catch (e) { return st.error(e); }
    stale(); file = f; bytes = r.bytes;
    dz.classList.add('hidden'); panel.classList.remove('hidden'); st.set(`${f.name} · ${r.pages} หน้า`);
  }
  function paint() {
    [...grid.children].forEach((t, i) => { t.classList.toggle('sel', selected.has(i)); t.setAttribute('aria-pressed', String(selected.has(i))); });
    selInfo.textContent = `เลือก ${selected.size}/${images.length}`;
    dlSel.disabled = !selected.size;
  }
  async function run() {
    stale();
    const my = gen;
    try {
      st.set('กำลังแปลง...'); st.progress(0);
      const r = await pdfToImages(bytes, { format, dpi, onProgress: p => st.progress(p) });
      if (my !== gen) return;
      images = r.images;
      st.progress(null);
      st.set(r.total > images.length ? `แปลง ${images.length} หน้าแรก จากทั้งหมด ${r.total} หน้า` : `แปลงแล้ว ${images.length} หน้า`, 'ok');
      grid.innerHTML = '';
      images.forEach((im, i) => {
        const t = h('div', { class: 'pg', role: 'button', tabindex: 0, 'aria-label': `เลือกหน้า ${im.n}` }, h('div', { class: 'tick' }), h('div', { class: 'cv' }, im.thumb),
          h('div', { class: 'num' }, `หน้า ${im.n} · ${fmtSize(im.data.length)}`),
          h('div', { class: 'tools' }, h('button', { class: 'btn sm icon', title: 'ดาวน์โหลดหน้านี้', onclick: (e) => { e.stopPropagation(); dl([i]); } }, '⬇')));
        t.onclick = () => { selected.has(i) ? selected.delete(i) : selected.add(i); paint(); };
        t.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.onclick(); } };
        grid.append(t);
      });
      selected = new Set(images.map((_, i) => i));
      paint();
      results.classList.remove('hidden');
    } catch (e) { st.error(e); }
  }
  async function dl(idx) {
    idx.sort((a, b) => a - b);
    const files = idx.map(i => ({ name: `${baseName(file.name)}_p${images[i].n}.${images[i].ext}`, data: images[i].data }));
    if (files.length === 1) download(files[0].data, files[0].name, images[idx[0]].type);
    else if (files.length) await downloadZip(files, baseName(file.name) + '_images.zip');
  }
}
