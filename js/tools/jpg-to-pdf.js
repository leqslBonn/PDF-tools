import { h, dropzone, statusBar, download, resultBox, PL, savePdf, fmtSize, seg, field, imageToCanvas, canvasToBytes, pickFiles, flattenWhite, freeCanvas, busy, tick } from '../lib.js';
import { rotateCanvas } from '../scan-core.js';

export const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };

/**
 * images: [{ canvas } | { getCanvas: async () => canvas }]  (EXIF-normalised)
 * Canvases produced by getCanvas are built one at a time and freed right after embedding,
 * so memory stays flat no matter how many pages there are.
 * opts: { size: 'a4'|'letter'|'legal'|'fit', orient: 'auto'|'portrait'|'landscape', margin: pt, quality, onProgress }
 */
export async function imagesToPdf(images, { size = 'a4', orient = 'auto', margin = 0, quality = 0.9, onProgress } = {}) {
  const doc = await PL().PDFDocument.create();
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    const src = im.canvas || await im.getCanvas();
    const c = flattenWhite(src);
    if (!im.canvas) freeCanvas(src);
    const jpg = await doc.embedJpg(await canvasToBytes(c, 'image/jpeg', quality));
    const cw = c.width, ch = c.height;
    freeCanvas(c);
    // 1 px = 0.75 pt at 96dpi; for "fit" we map image pixels to points so the page matches the photo.
    let pw, ph;
    if (size === 'fit') { pw = cw * 0.75 + margin * 2; ph = ch * 0.75 + margin * 2; }
    else {
      [pw, ph] = PAGE_SIZES[size];
      const land = orient === 'landscape' || (orient === 'auto' && cw > ch);
      if (land) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const aw = pw - margin * 2, ah = ph - margin * 2;
    const k = Math.min(aw / cw, ah / ch);
    const w = cw * k, hh = ch * k;
    page.drawImage(jpg, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
    onProgress && onProgress((i + 1) / images.length);
    await tick();
  }
  return savePdf(doc);
}

/** Small preview (data URL) of an image file, rotated. */
async function thumbOf(file, rot) {
  const c = rotateCanvas(await imageToCanvas(file, 320), rot);
  const url = c.toDataURL('image/jpeg', 0.7);
  freeCanvas(c);
  return url;
}

export default function (root) {
  let items = []; // {file, rot, thumb}
  let size = 'a4', orient = 'auto', margin = 0, gen = 0, lastEnd = 0;
  const list = h('div', { class: 'pages' });
  const st = statusBar();
  const res = h('div');
  const stale = () => { gen++; res.innerHTML = ''; };
  const panel = h('div', { class: 'panel hidden' },
    h('div', { class: 'row' },
      field('ขนาดหน้า', seg([['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['fit', 'ตามขนาดรูป']], size, v => { size = v; stale(); })),
      field('แนวกระดาษ', seg([['auto', 'อัตโนมัติ'], ['portrait', 'แนวตั้ง'], ['landscape', 'แนวนอน']], orient, v => { orient = v; stale(); })),
      field('ขอบกระดาษ', seg([[0, 'ไม่มี'], [18, 'แคบ'], [40, 'กว้าง']], margin, v => { margin = v; stale(); })),
    ),
    h('h3', { style: 'margin-top:16px' }, 'ลำดับหน้า (ลากเพื่อสลับ)'),
    list,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: async () => add(await pickFiles('image/jpeg,image/png,image/webp')) }, '+ เพิ่มรูป'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: busy(run) }, 'สร้าง PDF')),
    st, res);
  const dz = dropzone({ accept: 'image', multiple: true, hint: 'รับ .jpg และ .png — เลือกได้หลายไฟล์ จะเรียงเป็นหน้าตามลำดับ', onFiles: add });
  root.append(dz, panel);
  // preventOnFilter:false — otherwise iOS Safari swallows taps on the tile buttons.
  new Sortable(list, { animation: 150, filter: '.btn', preventOnFilter: false, delay: 120, delayOnTouchOnly: true,
    onEnd: (e) => { lastEnd = Date.now(); const [m] = items.splice(e.oldIndex, 1); items.splice(e.newIndex, 0, m); draw(); } });

  async function add(files) {
    const bad = [];
    for (let i = 0; i < files.length; i++) {
      st.set(`กำลังโหลดรูป ${i + 1}/${files.length}...`);
      try { items.push({ file: files[i], rot: 0, thumb: await thumbOf(files[i], 0) }); }
      catch { bad.push(files[i].name); }
    }
    st.set(bad.length ? `อ่านรูปไม่ได้: ${bad.join(', ')}` : '', bad.length ? 'err' : '');
    draw();
  }
  async function rotate(it) {
    if (Date.now() - lastEnd < 300) return;
    it.rot = (it.rot + 90) % 360;
    it.thumb = await thumbOf(it.file, it.rot);
    draw();
  }
  function draw() {
    stale();
    panel.classList.toggle('hidden', !items.length);
    list.innerHTML = '';
    items.forEach((it, i) => {
      list.append(h('div', { class: 'pg' }, h('div', { class: 'cv' }, h('img', { src: it.thumb, alt: `หน้า ${i + 1}` })), h('div', { class: 'num' }, `หน้า ${i + 1}`),
        h('div', { class: 'tools' },
          h('button', { class: 'btn sm icon', title: 'หมุน 90°', onclick: () => rotate(it) }, '⟳'),
          h('button', { class: 'btn sm icon danger', title: 'ลบรูปนี้', onclick: () => { items.splice(i, 1); draw(); } }, '✕'))));
    });
  }
  async function run() {
    res.innerHTML = '';
    if (!items.length) return;
    const my = gen, snapshot = items.slice();
    try {
      st.set('กำลังสร้าง PDF...'); st.progress(0);
      const out = await imagesToPdf(snapshot.map(it => ({ getCanvas: async () => rotateCanvas(await imageToCanvas(it.file, 3000), it.rot) })),
        { size, orient, margin: +margin, onProgress: p => st.progress(p) });
      st.progress(null); st.set('');
      if (my !== gen) return;
      res.append(resultBox(`${snapshot.length} หน้า · ${fmtSize(out.length)}`, () => download(out, 'images.pdf')));
    } catch (e) { st.error(e); }
  }
}
