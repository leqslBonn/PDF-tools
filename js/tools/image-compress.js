import { h, dropzone, statusBar, download, downloadZip, fmtSize, baseName, seg, field, imageToCanvas, encodeImage, flattenWhite, pickFiles, freeCanvas, busy, onLeave } from '../lib.js';
import { encodeJpeg } from '../work.js';

/** Returns { data, type, w, h } */
export async function compressImage(file, { quality = 0.75, maxDim = 0, format = 'auto' } = {}) {
  const c = await imageToCanvas(file, maxDim);
  let type = format === 'auto' ? (file.type === 'image/png' ? 'image/webp' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg') : format;
  const src = type === 'image/jpeg' ? flattenWhite(c) : c;
  const r = type === 'image/jpeg' ? { data: await encodeJpeg(src, quality, { progressive: true }), type } : await encodeImage(src, type, quality);
  const out = { ...r, w: c.width, h: c.height };
  freeCanvas(src); freeCanvas(c);
  return out;
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export default function (root) {
  let items = []; // {file, out}
  const o = { quality: 0.7, maxDim: 2560, format: 'auto' };
  const list = h('div', { class: 'flist' });
  const st = statusBar();
  const summary = h('div', { class: 'result hidden' });
  const qLab = h('span', {}, '70%');
  const q = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: o.quality });
  q.oninput = () => { o.quality = +q.value; qLab.textContent = Math.round(o.quality * 100) + '%'; invalidate(); };
  const dimSel = h('select', {}, ...[[0, 'ไม่ย่อ (สูงสุด 16 ล้านพิกเซล)'], [3840, '3840 px (4K)'], [2560, '2560 px (แนะนำ)'], [1920, '1920 px (Full HD)'], [1280, '1280 px'], [800, '800 px']].map(([v, l]) => h('option', { value: v, selected: v === 2560 }, l)));
  dimSel.onchange = () => { o.maxDim = +dimSel.value; invalidate(); };

  const panel = h('div', { class: 'panel hidden' },
    h('div', { class: 'row' },
      field('คุณภาพ', h('div', {}, q, qLab)),
      field('ย่อด้านที่ยาวที่สุดเหลือ', dimSel),
      field('รูปแบบไฟล์ผลลัพธ์', seg([['auto', 'อัตโนมัติ'], ['image/jpeg', 'JPG'], ['image/webp', 'WEBP'], ['image/png', 'PNG']], o.format, v => { o.format = v; invalidate(); })),
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: async () => add(await pickFiles('image/jpeg,image/png,image/webp')) }, '+ เพิ่มรูป'),
      h('button', { class: 'btn', onclick: () => { items.forEach(revoke); items = []; draw(); } }, 'ล้างทั้งหมด'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: busy(run) }, 'บีบอัดรูป')),
    st, h('div', { style: 'margin-top:12px' }, list), summary);
  const dz = dropzone({ accept: 'image', multiple: true, onFiles: add });
  root.append(dz, panel);

  let gen = 0;
  const revoke = (it) => { if (it.url) { URL.revokeObjectURL(it.url); it.url = null; } };
  onLeave(() => items.forEach(revoke));
  function invalidate() { gen++; if (items.some(i => i.out)) { items.forEach(i => i.out = null); draw(); } }
  function add(files) { files.forEach(file => items.push({ file, out: null })); draw(); }
  // If re-encoding made a file bigger, hand back the original instead.
  const bigger = (it) => it.out && it.out.data.length >= it.file.size;
  const outData = (it) => bigger(it) ? it.file : it.out.data;
  function draw() {
    panel.classList.toggle('hidden', !items.length);
    list.innerHTML = '';
    items.forEach((it, i) => {
      const saved = it.out ? 1 - it.out.data.length / it.file.size : 0;
      const note = bigger(it) ? ' · ใหญ่ขึ้น จะใช้ไฟล์ต้นฉบับแทน' : '';
      list.append(h('div', { class: 'fitem' },
        h('img', { class: 'thumb', alt: '', src: it.url || (it.url = URL.createObjectURL(it.file)), style: 'object-fit:cover' }),
        h('div', { class: 'meta' },
          h('div', { class: 'name' }, it.file.name),
          h('div', { class: 'sub' }, it.out
            ? `${fmtSize(it.file.size)} → ${fmtSize(it.out.data.length)} (${saved >= 0 ? '-' : '+'}${Math.abs(Math.round(saved * 100))}%) · ${it.out.w}×${it.out.h}${note}`
            : fmtSize(it.file.size))),
        it.out ? h('button', { class: 'btn sm', title: 'ดาวน์โหลดรูปนี้', onclick: () => dlOne(it) }, '⬇') : null,
        h('button', { class: 'btn sm icon danger', title: 'ลบรูปนี้', onclick: () => { revoke(it); items.splice(i, 1); draw(); } }, '✕')));
    });
    const done = items.filter(i => i.out);
    summary.classList.toggle('hidden', !done.length);
    if (done.length) {
      const a = done.reduce((s, i) => s + i.file.size, 0), b = done.reduce((s, i) => s + Math.min(i.file.size, i.out.data.length), 0);
      summary.innerHTML = '';
      summary.append(h('div', { class: 'big' }, `✅ รวม ${fmtSize(a)} → ${fmtSize(b)} (ลดลง ${Math.max(0, Math.round((1 - b / a) * 100))}%)`), h('div', { class: 'spacer' }),
        h('button', { class: 'btn primary', onclick: () => done.length === 1 ? dlOne(done[0]) : downloadZip(done.map(i => ({ name: outName(i), data: outData(i) })), 'compressed_images.zip') }, done.length === 1 ? '⬇ ดาวน์โหลด' : '⬇ ดาวน์โหลดทั้งหมด (.zip)'));
    }
  }
  const outName = (it) => bigger(it) ? it.file.name : `${baseName(it.file.name)}_compressed.${EXT[it.out.type]}`;
  const dlOne = (it) => download(outData(it), outName(it), bigger(it) ? it.file.type : it.out.type);
  async function run() {
    const my = ++gen, list = items.slice();
    try {
      for (let i = 0; i < list.length; i++) {
        st.set(`กำลังบีบอัด ${i + 1}/${list.length}...`); st.progress((i + 1) / list.length);
        const out = await compressImage(list[i].file, o);
        if (my !== gen) return;
        list[i].out = out;
      }
      st.progress(null); st.set('');
      draw();
    } catch (e) { st.error(e); }
  }
}
