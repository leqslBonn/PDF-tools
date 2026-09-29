import { h, dropzone, readPdf, fmtSize, statusBar, download, loadPdfJs, renderPage, resultBox, PL, savePdf, pickFiles, friendlyError, copyInto, busy } from '../lib.js';

export async function mergePdfs(list) {
  const out = await PL().PDFDocument.create();
  for (const bytes of list) {
    const src = await PL().PDFDocument.load(bytes);
    await copyInto(out, src, src.getPageIndices());
  }
  return savePdf(out);
}

export default function (root) {
  let items = []; // {file, bytes, pages, thumb, error}
  let gen = 0;    // bumps when the list changes, so a stale result never shows
  const list = h('div', { class: 'flist' });
  const st = statusBar();
  const res = h('div');
  const panel = h('div', { class: 'panel hidden' },
    h('h3', {}, 'ลำดับไฟล์ (ลากเพื่อสลับ)'), list,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: async () => add(await pickFiles('application/pdf,.pdf')) }, '+ เพิ่มไฟล์'),
      h('button', { class: 'btn', onclick: () => { items.sort((a, b) => a.file.name.localeCompare(b.file.name, 'th', { numeric: true })); draw(); } }, 'เรียงตามชื่อ'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: busy(run) }, 'รวมไฟล์ PDF'),
    ), st, res);

  const dz = dropzone({ accept: '.pdf', multiple: true, onFiles: add });
  root.append(dz, panel);

  new Sortable(list, {
    handle: '.handle', animation: 150,
    onEnd: (e) => { const [m] = items.splice(e.oldIndex, 1); items.splice(e.newIndex, 0, m); draw(); },
  });

  async function add(files) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      st.set(`กำลังอ่านไฟล์ ${i + 1}/${files.length}: ${file.name}`); st.progress((i + 1) / files.length);
      const it = { file, bytes: null, pages: '?', thumb: null };
      items.push(it);
      try {
        const r = await readPdf(file);
        Object.assign(it, { bytes: r.bytes, pages: r.pages, unlocked: r.unlocked, hasForm: r.hasForm });
        const pdf = await loadPdfJs(it.bytes);
        it.thumb = (await renderPage(pdf, 1, { maxW: 44, maxH: 56 })).toDataURL();
        pdf.destroy();
      } catch (e) { it.error = friendlyError(e); }
      draw();
    }
    st.progress(null); st.set('');
  }

  function draw() {
    gen++;
    res.innerHTML = '';
    panel.classList.toggle('hidden', !items.length);
    list.innerHTML = '';
    items.forEach((it, i) => list.append(h('div', { class: 'fitem' + (it.error ? ' bad' : '') },
      h('span', { class: 'handle', title: 'ลากเพื่อย้าย' }, '⋮⋮'),
      it.thumb ? h('img', { class: 'thumb', src: it.thumb, alt: '' }) : h('div', { class: 'thumb' }),
      h('div', { class: 'meta' },
        h('div', { class: 'name' }, it.file.name),
        h('div', { class: 'sub' }, it.error ? '⚠ ' + it.error
          : `${it.pages} หน้า · ${fmtSize(it.file.size)}${it.unlocked ? ' · 🔓 ปลดล็อกแล้ว' : ''}${it.hasForm ? ' · มีช่องกรอกฟอร์ม' : ''}`)),
      h('button', { class: 'btn sm icon', title: 'เลื่อนขึ้น', onclick: () => move(i, -1) }, '↑'),
      h('button', { class: 'btn sm icon', title: 'เลื่อนลง', onclick: () => move(i, 1) }, '↓'),
      h('button', { class: 'btn sm icon danger', title: 'ลบไฟล์นี้', onclick: () => { items.splice(i, 1); draw(); } }, '✕'),
    )));
  }
  function move(i, d) {
    const j = i + d; if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]]; draw();
  }

  async function run() {
    res.innerHTML = '';
    const bad = items.filter(i => i.error || !i.bytes);
    if (bad.length) return st.set(`มีไฟล์ที่เปิดไม่ได้: ${bad.map(b => b.file.name).join(', ')} — กด ✕ เพื่อเอาออกก่อน`, 'err');
    if (items.length < 2) return st.set('กรุณาเลือกอย่างน้อย 2 ไฟล์', 'err');
    const my = gen;
    try {
      st.set('กำลังรวมไฟล์...'); st.progress(0.3);
      const out = await mergePdfs(items.map(i => i.bytes));
      st.progress(null); st.set('');
      if (my !== gen) return;
      const total = items.reduce((s, i) => s + (+i.pages || 0), 0);
      res.append(resultBox(`รวม ${items.length} ไฟล์ (${total} หน้า) · ${fmtSize(out.length)}`, () => download(out, 'merged.pdf')));
    } catch (e) { st.error(e); }
  }
}
