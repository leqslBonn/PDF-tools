import { h, dropzone, readBytes, fmtSize, statusBar, download, loadPdfJs, renderPage, resultBox, PL, savePdf, pickFiles, friendlyError } from '../lib.js';

export async function mergePdfs(list) {
  const out = await PL().PDFDocument.create();
  for (const bytes of list) {
    const src = await PL().PDFDocument.load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  return savePdf(out);
}

export default function (root) {
  let items = []; // {file, bytes, pages, thumb}
  const list = h('div', { class: 'flist' });
  const st = statusBar();
  const res = h('div');
  const panel = h('div', { class: 'panel hidden' },
    h('h3', {}, 'ลำดับไฟล์ (ลากเพื่อสลับ)'), list,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: async () => add(await pickFiles('application/pdf,.pdf')) }, '+ เพิ่มไฟล์'),
      h('button', { class: 'btn', onclick: () => { items.sort((a, b) => a.file.name.localeCompare(b.file.name, 'th', { numeric: true })); draw(); } }, 'เรียงตามชื่อ'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: run }, 'รวมไฟล์ PDF'),
    ), st, res);

  const dz = dropzone({ accept: '.pdf', multiple: true, onFiles: add });
  root.append(dz, panel);

  new Sortable(list, {
    handle: '.handle', animation: 150,
    onEnd: (e) => { const [m] = items.splice(e.oldIndex, 1); items.splice(e.newIndex, 0, m); draw(); },
  });

  async function add(files) {
    for (const file of files) {
      const it = { file, bytes: await readBytes(file), pages: '?', thumb: null };
      items.push(it);
      try {
        const pdf = await loadPdfJs(it.bytes);
        it.pages = pdf.numPages;
        it.thumb = (await renderPage(pdf, 1, { maxW: 44, maxH: 56 })).toDataURL();
        pdf.destroy();
      } catch (e) { it.error = friendlyError(e); }
    }
    draw();
  }

  function draw() {
    res.innerHTML = '';
    panel.classList.toggle('hidden', !items.length);
    list.innerHTML = '';
    items.forEach((it, i) => list.append(h('div', { class: 'fitem' },
      h('span', { class: 'handle', title: 'ลากเพื่อย้าย' }, '⋮⋮'),
      it.thumb ? h('img', { class: 'thumb', src: it.thumb }) : h('div', { class: 'thumb' }),
      h('div', { class: 'meta' },
        h('div', { class: 'name' }, it.file.name),
        h('div', { class: 'sub' }, it.error ? '⚠ ' + it.error : `${it.pages} หน้า · ${fmtSize(it.file.size)}`)),
      h('button', { class: 'btn sm icon', title: 'ขึ้น', onclick: () => move(i, -1) }, '↑'),
      h('button', { class: 'btn sm icon', title: 'ลง', onclick: () => move(i, 1) }, '↓'),
      h('button', { class: 'btn sm icon danger', title: 'ลบ', onclick: () => { items.splice(i, 1); draw(); } }, '✕'),
    )));
  }
  function move(i, d) {
    const j = i + d; if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]]; draw();
  }

  async function run() {
    res.innerHTML = '';
    const ok = items.filter(i => !i.error);
    if (ok.length < 2) return st.set('กรุณาเลือกอย่างน้อย 2 ไฟล์', 'err');
    try {
      st.set('กำลังรวมไฟล์...'); st.progress(0.3);
      const out = await mergePdfs(ok.map(i => i.bytes));
      st.progress(null); st.set('');
      const total = ok.reduce((s, i) => s + (+i.pages || 0), 0);
      res.append(resultBox(`รวม ${ok.length} ไฟล์ (${total} หน้า) · ${fmtSize(out.length)}`, () => download(out, 'merged.pdf')));
    } catch (e) { st.error(e); }
  }
}
