import { h, dropzone, readPdf, statusBar, download, downloadZip, loadPdfJs, resultBox, PL, savePdf, fmtSize, baseName, seg, field, pageTile, fillThumbs, copyInto, busy, onLeave } from '../lib.js';

/** Parse "1-3, 5, 8-" into groups of 0-based indices. */
export function parseRanges(str, total) {
  const groups = [];
  for (const part of str.split(/[,;]+/).map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
    else if (/^\d+$/.test(part)) a = b = +part;
    else throw new Error(`รูปแบบช่วงหน้าไม่ถูกต้อง: "${part}"`);
    if (a < 1 || b > total || a > b) throw new Error(`ช่วงหน้าเกินจำนวนหน้า (1-${total}): "${part}"`);
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  return groups;
}

export async function extractPages(bytes, indices, srcDoc) {
  const src = srcDoc || await PL().PDFDocument.load(bytes);
  const out = await PL().PDFDocument.create();
  await copyInto(out, src, indices);
  return savePdf(out);
}

export default function (root) {
  let file, bytes, total = 0, tiles = [], selected = new Set(), pdf = null, gen = 0;
  const closePdf = () => { if (pdf) { pdf.destroy(); pdf = null; } };
  onLeave(closePdf);
  let mode = 'select';
  const grid = h('div', { class: 'pages' });
  const st = statusBar();
  const res = h('div');
  const rangeIn = h('input', { type: 'text', placeholder: 'เช่น 1-3, 5, 8-10' });
  const everyIn = h('input', { type: 'number', min: 1, value: 1 });
  const selInfo = h('span', { class: 'sub' });
  const oneFile = h('input', { type: 'checkbox', checked: true });

  const optSelect = h('div', {},
    h('div', { class: 'row' }, h('span', {}, 'คลิกเลือกหน้าที่ต้องการดึงออกมา'), h('div', { class: 'spacer' }), selInfo,
      h('button', { class: 'btn sm', onclick: () => setAll(true) }, 'เลือกทั้งหมด'),
      h('button', { class: 'btn sm', onclick: () => setAll(false) }, 'ล้าง')),
    h('div', { class: 'row' }, h('label', { class: 'check' }, oneFile, 'รวมหน้าที่เลือกเป็นไฟล์เดียว (ไม่ติ๊ก = แยกไฟล์ละหน้า)')));
  const optRange = h('div', {}, h('div', { class: 'row' }, field('ช่วงหน้า (แต่ละช่วงจะเป็น 1 ไฟล์)', rangeIn)));
  const optEvery = h('div', {}, h('div', { class: 'row' }, field('แยกทุก ๆ กี่หน้า', everyIn)));
  const opts = { select: optSelect, range: optRange, every: optEvery };

  const panel = h('div', { class: 'panel hidden' },
    h('div', { class: 'row' },
      seg([['select', 'เลือกหน้า'], ['range', 'กำหนดช่วงหน้า'], ['every', 'แยกทุก N หน้า']], mode, (v) => { mode = v; showOpts(); changed(); }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn sm', onclick: reset }, 'เลือกไฟล์ใหม่')),
    h('div', { style: 'margin:14px 0' }, optSelect, optRange, optEvery),
    grid,
    h('div', { class: 'actions' }, h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'แยกไฟล์ PDF')),
    st, res);
  const dz = dropzone({ accept: '.pdf', onFiles: load });
  root.append(dz, panel);
  showOpts();
  rangeIn.oninput = everyIn.oninput = oneFile.onchange = () => changed();

  function showOpts() { for (const [k, el] of Object.entries(opts)) el.classList.toggle('hidden', k !== mode); grid.classList.toggle('hidden', mode !== 'select'); }
  function reset() { gen++; closePdf(); file = null; grid.innerHTML = ''; res.innerHTML = ''; st.set(''); selected.clear(); panel.classList.add('hidden'); dz.classList.remove('hidden'); }
  function changed() { gen++; res.innerHTML = ''; }
  function setAll(on) { selected = new Set(on ? tiles.map((_, i) => i) : []); paint(); }
  function paint() { changed(); tiles.forEach((t, i) => { t.classList.toggle('sel', selected.has(i)); t.setAttribute('aria-pressed', String(selected.has(i))); }); selInfo.textContent = `เลือก ${selected.size} หน้า`; }

  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    try {
      const r = await readPdf(f);
      file = f; bytes = r.bytes;
      closePdf();
      pdf = await loadPdfJs(bytes);
      total = pdf.numPages;
      rangeIn.value = `1-${total}`;
      tiles = Array.from({ length: total }, (_, i) => {
        const t = pageTile(i + 1, [h('div', { class: 'tick' })]);
        t.onclick = () => { selected.has(i) ? selected.delete(i) : selected.add(i); paint(); };
        return t;
      });
      grid.innerHTML = ''; grid.append(...tiles); paint();
      dz.classList.add('hidden'); panel.classList.remove('hidden');
      st.set(r.unlocked ? '🔓 ปลดล็อกไฟล์แล้ว' : '');
      const doc = pdf;
      await fillThumbs(doc, tiles, { stopWhenDetached: true });
      if (doc === pdf) closePdf();
    } catch (e) { st.error(e); }
  }

  async function run() {
    res.innerHTML = '';
    let groups;
    try {
      if (mode === 'select') {
        const idx = [...selected].sort((a, b) => a - b);
        if (!idx.length) throw new Error('กรุณาเลือกอย่างน้อย 1 หน้า');
        groups = oneFile.checked ? [idx] : idx.map(i => [i]);
      } else if (mode === 'range') {
        groups = parseRanges(rangeIn.value, total);
        if (!groups.length) throw new Error('กรุณากรอกช่วงหน้า');
      } else {
        const n = Math.max(1, parseInt(everyIn.value) || 1);
        groups = [];
        for (let i = 0; i < total; i += n) groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
      }
    } catch (e) { return st.set(e.message, 'err'); }

    const my = gen, base = baseName(file.name);
    try {
      const src = await PL().PDFDocument.load(bytes);
      const outs = [];
      for (let g = 0; g < groups.length; g++) {
        st.set(`กำลังสร้างไฟล์ ${g + 1}/${groups.length}...`); st.progress((g + 1) / groups.length);
        const grp = groups[g];
        const label = grp.length === 1 ? `p${grp[0] + 1}` : `p${grp[0] + 1}-${grp[grp.length - 1] + 1}`;
        outs.push({ name: `${base}_${label}.pdf`, data: await extractPages(null, grp, src) });
      }
      st.progress(null); st.set('');
      if (my !== gen) return;
      if (outs.length === 1) res.append(resultBox(`${groups[0].length} หน้า · ${fmtSize(outs[0].data.length)}`, () => download(outs[0].data, outs[0].name)));
      else res.append(resultBox(`แยกได้ ${outs.length} ไฟล์ (รวมเป็น .zip)`, () => downloadZip(outs, base + '_split.zip')));
    } catch (e) { st.error(e); }
  }
}
