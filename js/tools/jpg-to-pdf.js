import { h, dropzone, statusBar, download, resultBox, PL, savePdf, fmtSize, seg, field, imageToCanvas, canvasToBytes, pickFiles, flattenWhite } from '../lib.js';

export const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };

/**
 * images: [{ canvas }]  (already EXIF-normalised)
 * opts: { size: 'a4'|'letter'|'legal'|'fit', orient: 'auto'|'portrait'|'landscape', margin: pt, quality }
 */
export async function imagesToPdf(images, { size = 'a4', orient = 'auto', margin = 0, quality = 0.9 } = {}) {
  const doc = await PL().PDFDocument.create();
  for (const im of images) {
    const c = flattenWhite(im.canvas);
    const jpg = await doc.embedJpg(await canvasToBytes(c, 'image/jpeg', quality));
    // 1 px = 0.75 pt at 96dpi; for "fit" we map image pixels to points so the page matches the photo.
    let pw, ph;
    if (size === 'fit') { pw = c.width * 0.75 + margin * 2; ph = c.height * 0.75 + margin * 2; }
    else {
      [pw, ph] = PAGE_SIZES[size];
      const land = orient === 'landscape' || (orient === 'auto' && c.width > c.height);
      if (land) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const aw = pw - margin * 2, ah = ph - margin * 2;
    const k = Math.min(aw / c.width, ah / c.height);
    const w = c.width * k, hh = c.height * k;
    page.drawImage(jpg, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
  }
  return savePdf(doc);
}

export default function (root) {
  let items = []; // {file, canvas, url}
  let size = 'a4', orient = 'auto', margin = 0;
  const list = h('div', { class: 'pages' });
  const st = statusBar();
  const res = h('div');
  const panel = h('div', { class: 'panel hidden' },
    h('div', { class: 'row' },
      field('ขนาดหน้า', seg([['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['fit', 'ตามขนาดรูป']], size, v => size = v)),
      field('แนวกระดาษ', seg([['auto', 'อัตโนมัติ'], ['portrait', 'แนวตั้ง'], ['landscape', 'แนวนอน']], orient, v => orient = v)),
      field('ขอบกระดาษ', seg([[0, 'ไม่มี'], [18, 'แคบ'], [40, 'กว้าง']], margin, v => margin = v)),
    ),
    h('h3', { style: 'margin-top:16px' }, 'ลำดับหน้า (ลากเพื่อสลับ)'),
    list,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: async () => add(await pickFiles('image/jpeg,image/png,image/webp')) }, '+ เพิ่มรูป'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: run }, 'สร้าง PDF')),
    st, res);
  const dz = dropzone({ accept: 'image', multiple: true, hint: 'รับ .jpg และ .png — เลือกได้หลายไฟล์ จะเรียงเป็นหน้าตามลำดับ', onFiles: add });
  root.append(dz, panel);
  new Sortable(list, { animation: 150, filter: '.btn', delay: 120, delayOnTouchOnly: true,
    onEnd: (e) => { const [m] = items.splice(e.oldIndex, 1); items.splice(e.newIndex, 0, m); draw(); } });

  async function add(files) {
    st.set('กำลังโหลดรูป...');
    for (const file of files) {
      try { const canvas = await imageToCanvas(file, 3000); items.push({ file, canvas, rot: 0 }); }
      catch { st.set(`อ่านรูปไม่ได้: ${file.name}`, 'err'); }
    }
    st.set(''); draw();
  }
  function rotate(it) {
    const c = document.createElement('canvas');
    c.width = it.canvas.height; c.height = it.canvas.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(it.canvas, 0, 0);
    it.canvas = c; draw();
  }
  function draw() {
    res.innerHTML = '';
    panel.classList.toggle('hidden', !items.length);
    list.innerHTML = '';
    items.forEach((it, i) => {
      const img = h('img', { src: it.canvas.toDataURL('image/jpeg', 0.6) });
      list.append(h('div', { class: 'pg' }, h('div', { class: 'cv' }, img), h('div', { class: 'num' }, `หน้า ${i + 1}`),
        h('div', { class: 'tools' },
          h('button', { class: 'btn sm icon', title: 'หมุน', onclick: () => rotate(it) }, '⟳'),
          h('button', { class: 'btn sm icon danger', title: 'ลบ', onclick: () => { items.splice(i, 1); draw(); } }, '✕'))));
    });
  }
  async function run() {
    res.innerHTML = '';
    if (!items.length) return;
    try {
      st.set('กำลังสร้าง PDF...'); st.progress(0.5);
      const out = await imagesToPdf(items, { size, orient, margin: +margin });
      st.progress(null); st.set('');
      res.append(resultBox(`${items.length} หน้า · ${fmtSize(out.length)}`, () => download(out, 'images.pdf')));
    } catch (e) { st.error(e); }
  }
}
