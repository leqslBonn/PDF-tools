import { h, dropzone, statusBar, download, downloadZip, fmtSize, baseName, seg, field, imageToCanvas, encodeImage, flattenWhite, pickFiles } from '../lib.js';

/** Returns { data, type, w, h } */
export async function compressImage(file, { quality = 0.75, maxDim = 0, format = 'auto' } = {}) {
  const c = await imageToCanvas(file, maxDim);
  let type = format === 'auto' ? (file.type === 'image/png' ? 'image/webp' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg') : format;
  const r = await encodeImage(type === 'image/jpeg' ? flattenWhite(c) : c, type, quality);
  return { ...r, w: c.width, h: c.height };
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export default function (root) {
  let items = []; // {file, out}
  const o = { quality: 0.7, maxDim: 0, format: 'auto' };
  const list = h('div', { class: 'flist' });
  const st = statusBar();
  const summary = h('div', { class: 'result hidden' });
  const qLab = h('span', {}, '70%');
  const q = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: o.quality });
  q.oninput = () => { o.quality = +q.value; qLab.textContent = Math.round(o.quality * 100) + '%'; };
  const dimSel = h('select', {}, ...[[0, 'ไม่ย่อ'], [3840, '3840 px (4K)'], [2560, '2560 px'], [1920, '1920 px (Full HD)'], [1280, '1280 px'], [800, '800 px']].map(([v, l]) => h('option', { value: v }, l)));
  dimSel.onchange = () => o.maxDim = +dimSel.value;

  const panel = h('div', { class: 'panel hidden' },
    h('div', { class: 'row' },
      field('คุณภาพ', h('div', {}, q, qLab)),
      field('ย่อด้านที่ยาวที่สุดเหลือ', dimSel),
      field('รูปแบบไฟล์ผลลัพธ์', seg([['auto', 'อัตโนมัติ'], ['image/jpeg', 'JPG'], ['image/webp', 'WEBP'], ['image/png', 'PNG']], o.format, v => o.format = v)),
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: async () => add(await pickFiles('image/jpeg,image/png,image/webp')) }, '+ เพิ่มรูป'),
      h('button', { class: 'btn', onclick: () => { items = []; draw(); } }, 'ล้างทั้งหมด'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: run }, 'บีบอัดรูป')),
    st, h('div', { style: 'margin-top:12px' }, list), summary);
  const dz = dropzone({ accept: 'image', multiple: true, onFiles: add });
  root.append(dz, panel);

  function add(files) { files.forEach(file => items.push({ file, out: null })); draw(); }
  function draw() {
    panel.classList.toggle('hidden', !items.length);
    list.innerHTML = '';
    items.forEach((it, i) => {
      const saved = it.out ? 1 - it.out.data.length / it.file.size : 0;
      list.append(h('div', { class: 'fitem' },
        h('img', { class: 'thumb', src: it.url || (it.url = URL.createObjectURL(it.file)), style: 'object-fit:cover' }),
        h('div', { class: 'meta' },
          h('div', { class: 'name' }, it.file.name),
          h('div', { class: 'sub' }, it.out
            ? `${fmtSize(it.file.size)} → ${fmtSize(it.out.data.length)} (${saved >= 0 ? '-' : '+'}${Math.abs(Math.round(saved * 100))}%) · ${it.out.w}×${it.out.h}`
            : fmtSize(it.file.size))),
        it.out ? h('button', { class: 'btn sm', onclick: () => dlOne(it) }, '⬇') : null,
        h('button', { class: 'btn sm icon danger', onclick: () => { items.splice(i, 1); draw(); } }, '✕')));
    });
    const done = items.filter(i => i.out);
    summary.classList.toggle('hidden', !done.length);
    if (done.length) {
      const a = done.reduce((s, i) => s + i.file.size, 0), b = done.reduce((s, i) => s + i.out.data.length, 0);
      summary.innerHTML = '';
      summary.append(h('div', { class: 'big' }, `✅ รวม ${fmtSize(a)} → ${fmtSize(b)} (ลดลง ${Math.max(0, Math.round((1 - b / a) * 100))}%)`), h('div', { class: 'spacer' }),
        h('button', { class: 'btn primary', onclick: () => done.length === 1 ? dlOne(done[0]) : downloadZip(done.map(i => ({ name: outName(i), data: i.out.data })), 'compressed_images.zip') }, done.length === 1 ? '⬇ ดาวน์โหลด' : '⬇ ดาวน์โหลดทั้งหมด (.zip)'));
    }
  }
  const outName = (it) => `${baseName(it.file.name)}_compressed.${EXT[it.out.type]}`;
  const dlOne = (it) => download(it.out.data, outName(it), it.out.type);
  async function run() {
    try {
      for (let i = 0; i < items.length; i++) {
        st.set(`กำลังบีบอัด ${i + 1}/${items.length}...`); st.progress((i + 1) / items.length);
        items[i].out = await compressImage(items[i].file, o);
      }
      st.progress(null); st.set('');
      draw();
    } catch (e) { st.error(e); }
  }
}
