import { h, dropzone, readBytes, statusBar, download, downloadZip, loadPdfJs, renderPage, fmtSize, baseName, seg, field, canvasToBytes, MAX_PREVIEW_PAGES } from '../lib.js';

/** Render pages → [{name, data(Uint8Array), canvas}] */
export async function pdfToImages(bytes, { format = 'jpeg', dpi = 150, quality = 0.9, pages, onProgress } = {}) {
  const pdf = await loadPdfJs(bytes);
  const list = pages || Array.from({ length: Math.min(pdf.numPages, MAX_PREVIEW_PAGES) }, (_, i) => i + 1);
  const out = [];
  for (const n of list) {
    const c = await renderPage(pdf, n, { scale: dpi / 72 });
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    out.push({ n, canvas: c, data: await canvasToBytes(c, type, quality), ext: format === 'png' ? 'png' : 'jpg' });
    onProgress && onProgress(out.length / list.length);
  }
  pdf.destroy();
  return { images: out, total: pdf.numPages };
}

export default function (root) {
  let file, bytes, images = [], selected = new Set();
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
      field('รูปแบบไฟล์', seg([['jpeg', 'JPEG'], ['png', 'PNG']], format, v => format = v)),
      field('ความละเอียด', seg([[96, 'ต่ำ (96 dpi)'], [150, 'กลาง (150 dpi)'], [300, 'สูง (300 dpi)']], dpi, v => dpi = +v)),
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'),
      h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: run }, 'แปลงเป็นรูป')),
    st, results);
  const dz = dropzone({ accept: '.pdf', hint: `แปลงได้สูงสุด ${MAX_PREVIEW_PAGES} หน้าแรก`, onFiles: load });
  root.append(dz, panel);

  function reset() { file = null; images = []; grid.innerHTML = ''; results.classList.add('hidden'); panel.classList.add('hidden'); dz.classList.remove('hidden'); st.set(''); }
  async function load([f]) { file = f; bytes = await readBytes(f); dz.classList.add('hidden'); panel.classList.remove('hidden'); st.set(f.name); }
  function paint() {
    [...grid.children].forEach((t, i) => t.classList.toggle('sel', selected.has(i)));
    selInfo.textContent = `เลือก ${selected.size}/${images.length}`;
    dlSel.disabled = !selected.size;
  }
  async function run() {
    try {
      st.set('กำลังแปลง...'); st.progress(0);
      const r = await pdfToImages(bytes, { format, dpi, onProgress: p => st.progress(p) });
      images = r.images;
      st.progress(null);
      st.set(r.total > images.length ? `แปลง ${images.length} หน้าแรก จากทั้งหมด ${r.total} หน้า` : `แปลงแล้ว ${images.length} หน้า`, 'ok');
      grid.innerHTML = '';
      images.forEach((im, i) => {
        const thumb = document.createElement('canvas');
        const k = Math.min(260 / im.canvas.width, 300 / im.canvas.height);
        thumb.width = im.canvas.width * k; thumb.height = im.canvas.height * k;
        thumb.getContext('2d').drawImage(im.canvas, 0, 0, thumb.width, thumb.height);
        im.canvas = null; // free memory
        const t = h('div', { class: 'pg' }, h('div', { class: 'tick' }), h('div', { class: 'cv' }, thumb),
          h('div', { class: 'num' }, `หน้า ${im.n} · ${fmtSize(im.data.length)}`),
          h('div', { class: 'tools' }, h('button', { class: 'btn sm icon', title: 'ดาวน์โหลดหน้านี้', onclick: (e) => { e.stopPropagation(); dl([i]); } }, '⬇')));
        t.onclick = () => { selected.has(i) ? selected.delete(i) : selected.add(i); paint(); };
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
    if (files.length === 1) download(files[0].data, files[0].name, format === 'png' ? 'image/png' : 'image/jpeg');
    else if (files.length) await downloadZip(files, baseName(file.name) + '_images.zip');
  }
}
