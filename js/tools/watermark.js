import { h, dropzone, readPdf, busy, statusBar, download, resultBox, PL, savePdf, fmtSize, baseName, seg, field, textToPng, pageGeom, drawVisual, loadPdfJs, renderPage, imageToCanvas, canvasToBytes, pickFiles } from '../lib.js';

/**
 * o: { kind:'text'|'image', text, size, color, bold, imageBytes(png), imageScale (0-1 of page width),
 *      opacity, angle, layout:'center'|'tile', pos (for center: 'c','tl','tr','bl','br') }
 */
export async function addWatermark(bytes, o) {
  const doc = await PL().PDFDocument.load(bytes);
  let img, iw, ih;
  if (o.kind === 'image') {
    img = await doc.embedPng(o.imageBytes);
    iw = img.width; ih = img.height;
  } else {
    const t = await textToPng(o.text || ' ', { size: o.size, color: o.color, bold: o.bold });
    img = await doc.embedPng(t.bytes); iw = t.w; ih = t.h;
  }
  for (const page of doc.getPages()) {
    const { vw, vh } = pageGeom(page);
    let w = iw, hh = ih;
    if (o.kind === 'image') { const k = (vw * (o.imageScale || 0.4)) / iw; w = iw * k; hh = ih * k; }
    const base = { w, h: hh, angle: o.angle || 0, opacity: o.opacity };
    if (o.layout === 'tile') {
      const stepX = w * 1.2 + 60, stepY = hh + 110;
      let row = 0;
      for (let y = -vh * 0.2; y < vh * 1.2; y += stepY, row++)
        for (let x = -vw * 0.2 + (row % 2 ? stepX / 2 : 0); x < vw * 1.2; x += stepX)
          drawVisual(page, img, { ...base, cu: x, cv: y });
    } else {
      const m = 40 + Math.max(w, hh) / 2 * 0.2;
      const pos = o.pos || 'c';
      const cu = pos.includes('l') ? m + w / 2 : pos.includes('r') ? vw - m - w / 2 : vw / 2;
      const cv = pos.includes('t') ? m + hh / 2 : pos.includes('b') ? vh - m - hh / 2 : vh / 2;
      drawVisual(page, img, { ...base, cu, cv });
    }
  }
  return savePdf(doc);
}

export default function (root) {
  let file, bytes, previewSrc, gen = 0;
  const o = { kind: 'text', text: 'ลับเฉพาะ', size: 60, color: '#ff0000', bold: true, opacity: 0.25, angle: 45, layout: 'center', pos: 'c', imageBytes: null, imageScale: 0.5 };
  const st = statusBar();
  const res = h('div');
  const preview = h('div', { class: 'doc', style: 'min-height:200px' });

  const txt = h('input', { type: 'text', value: o.text }); txt.oninput = () => { o.text = txt.value; refresh(); };
  const range = (k, min, max, step, fmt) => {
    const lab = h('span', {}, fmt(o[k]));
    const i = h('input', { type: 'range', min, max, step, value: o[k] });
    i.oninput = () => { o[k] = +i.value; lab.textContent = fmt(o[k]); refresh(); };
    return h('div', {}, i, lab);
  };
  const color = h('input', { type: 'color', value: o.color }); color.oninput = () => { o.color = color.value; refresh(); };
  const bold = h('input', { type: 'checkbox', checked: true }); bold.onchange = () => { o.bold = bold.checked; refresh(); };
  const imgInfo = h('span', { class: 'sub' }, 'ยังไม่ได้เลือกรูป');
  const pickImg = async () => {
    const [f] = await pickFiles('image/png,image/jpeg,image/webp', false);
    if (!f) return;
    o.imageBytes = await canvasToBytes(await imageToCanvas(f, 2000));
    imgInfo.textContent = f.name; refresh();
  };
  const textOpts = h('div', {},
    h('div', { class: 'row' }, field('ข้อความ', txt)),
    h('div', { class: 'row' }, field('ขนาดตัวอักษร', range('size', 12, 160, 1, v => v + ' pt')), field('สี', color)),
    h('div', { class: 'row' }, h('label', { class: 'check' }, bold, 'ตัวหนา')));
  const imgOpts = h('div', { class: 'hidden' },
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: pickImg }, 'เลือกรูปภาพ'), imgInfo),
    h('div', { class: 'row' }, field('ขนาด (เทียบความกว้างหน้า)', range('imageScale', 0.05, 1, 0.05, v => Math.round(v * 100) + '%'))));
  const posSel = h('select', {}, ...[['c', 'กลางหน้า'], ['tl', 'มุมบนซ้าย'], ['tr', 'มุมบนขวา'], ['bl', 'มุมล่างซ้าย'], ['br', 'มุมล่างขวา']].map(([v, l]) => h('option', { value: v }, l)));
  posSel.onchange = () => { o.pos = posSel.value; refresh(); };

  const panel = h('div', { class: 'hidden' },
    h('div', { class: 'editor-layout' },
      preview,
      h('div', { class: 'panel side', style: 'margin-top:0' },
        h('h3', {}, 'ตั้งค่าลายน้ำ'),
        h('div', { class: 'row' }, seg([['text', 'ข้อความ'], ['image', 'รูปภาพ']], o.kind, v => { o.kind = v; textOpts.classList.toggle('hidden', v !== 'text'); imgOpts.classList.toggle('hidden', v !== 'image'); refresh(); })),
        h('div', { style: 'margin-top:12px' }, textOpts, imgOpts),
        h('div', { class: 'row' }, field('ความจาง (ทึบแสง)', range('opacity', 0.05, 1, 0.05, v => Math.round(v * 100) + '%'))),
        h('div', { class: 'row' }, field('องศาการเอียง', range('angle', -90, 90, 5, v => v + '°'))),
        h('div', { class: 'row' }, field('รูปแบบ', seg([['center', 'วางจุดเดียว'], ['tile', 'ปูเต็มหน้า']], o.layout, v => { o.layout = v; posSel.disabled = v === 'tile'; refresh(); }))),
        h('div', { class: 'row' }, field('ตำแหน่ง', posSel)),
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'), h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'ใส่ลายน้ำ')),
        st, res)));
  const dz = dropzone({ accept: '.pdf', onFiles: load });
  root.append(dz, panel);

  function reset() { gen++; file = bytes = previewSrc = null; res.innerHTML = ''; preview.innerHTML = ''; st.set(''); panel.classList.add('hidden'); dz.classList.remove('hidden'); }
  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    try {
      const r = await readPdf(f);
      file = f; bytes = r.bytes;
      const src = await PL().PDFDocument.load(bytes);
      const tmp = await PL().PDFDocument.create();
      const [p] = await tmp.copyPages(src, [0]); tmp.addPage(p);
      previewSrc = await tmp.save();
    } catch (e) { return st.error(e); }
    st.set('');
    dz.classList.add('hidden'); panel.classList.remove('hidden'); refresh(); }
  let timer, previewSeq = 0;
  function refresh() { gen++; res.innerHTML = ''; clearTimeout(timer); timer = setTimeout(drawPreview, 250); }
  async function drawPreview() {
    if (!bytes) return;
    if (o.kind === 'image' && !o.imageBytes) return;
    try {
      const seq = ++previewSeq;
      const out = await addWatermark(previewSrc, o);
      if (seq !== previewSeq) return;
      const pdf = await loadPdfJs(out);
      const c = await renderPage(pdf, 1, { maxW: 560, maxH: 800 });
      c.style.maxWidth = '100%';
      preview.innerHTML = '';
      preview.append(h('div', { class: 'page-wrap' }, h('span', { class: 'plabel' }, 'ตัวอย่างหน้า 1'), c));
      pdf.destroy();
    } catch (e) { st.error(e); }
  }
  async function run() {
    if (o.kind === 'image' && !o.imageBytes) return st.set('กรุณาเลือกรูปภาพ', 'err');
    const my = gen, name = baseName(file.name) + '_watermark.pdf';
    try {
      st.set('กำลังใส่ลายน้ำ...');
      const out = await addWatermark(bytes, { ...o });
      st.set('');
      if (my !== gen) return;
      res.innerHTML = '';
      res.append(resultBox(fmtSize(out.length), () => download(out, name)));
    } catch (e) { st.error(e); }
  }
}
