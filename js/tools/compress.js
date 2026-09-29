import { h, dropzone, readBytes, statusBar, download, resultBox, PL, savePdf, fmtSize, baseName, seg, field, loadPdfJs, renderPage, canvasToBytes, tick } from '../lib.js';

export const LEVELS = {
  low: { maxPx: 2400, q: 0.82, dpi: 150, label: 'น้อย (คุณภาพสูง)' },
  medium: { maxPx: 1600, q: 0.68, dpi: 120, label: 'ปานกลาง (แนะนำ)' },
  high: { maxPx: 1100, q: 0.5, dpi: 96, label: 'มาก (ไฟล์เล็กที่สุด)' },
};

function colorComps(ctx, cs) {
  const { PDFName, PDFArray } = PL();
  if (cs instanceof PDFName) return { '/DeviceRGB': 3, '/DeviceGray': 1 }[cs.asString()] || 0;
  if (cs instanceof PDFArray && cs.size() === 2 && cs.get(0).asString && cs.get(0).asString() === '/ICCBased') {
    const icc = ctx.lookup(cs.get(1));
    const n = icc && icc.dict ? icc.dict.get(PDFName.of('N')) : null;
    const v = n && n.asNumber ? n.asNumber() : 0;
    return v === 1 || v === 3 ? v : 0;
  }
  return 0;
}

/**
 * Re-encode embedded raster images (keeps text & vectors intact).
 * Handles JPEG (DCT) and 8-bit Flate RGB/Gray images; everything else is left untouched.
 */
export async function compressImagesInPdf(bytes, { maxPx, q }, onProgress) {
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray } = PL();
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const objs = ctx.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  let done = 0, changed = 0;
  for (const [ref, stream] of objs) {
    onProgress && onProgress(++done / objs.length);
    if (done % 4 === 0) await tick();
    try {
      const d = stream.dict;
      const get = (k) => d.get(PDFName.of(k));
      if (get('ImageMask') || get('Mask') instanceof PDFArray || get('Decode')) continue;
      let filter = get('Filter');
      if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.get(0) : null;
      const fname = filter && filter.asString ? filter.asString() : null;
      const W = get('Width').asNumber(), H = get('Height').asNumber();
      const comps = colorComps(ctx, ctx.lookup(get('ColorSpace')));
      if (!comps || W * H < 40000) continue;
      let canvas;
      if (fname === '/DCTDecode') {
        const bmp = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }), { imageOrientation: 'none' });
        if (bmp.width !== W || bmp.height !== H) { bmp.close(); continue; } // EXIF-rotated or odd JPEG: leave as is
        canvas = document.createElement('canvas'); canvas.width = bmp.width; canvas.height = bmp.height;
        canvas.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
      } else if (fname === '/FlateDecode') {
        const bpc = get('BitsPerComponent');
        if (!bpc || bpc.asNumber() !== 8 || get('DecodeParms')) continue;
        const raw = pako.inflate(stream.contents);
        if (raw.length < W * H * comps) continue;
        canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
        const c2 = canvas.getContext('2d');
        const id = c2.createImageData(W, H);
        for (let i = 0, j = 0; i < W * H; i++, j += comps) {
          const o = i * 4;
          if (comps === 3) { id.data[o] = raw[j]; id.data[o + 1] = raw[j + 1]; id.data[o + 2] = raw[j + 2]; }
          else id.data[o] = id.data[o + 1] = id.data[o + 2] = raw[j];
          id.data[o + 3] = 255;
        }
        c2.putImageData(id, 0, 0);
      } else continue;

      const k = Math.min(1, maxPx / Math.max(canvas.width, canvas.height));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(canvas.width * k)); out.height = Math.max(1, Math.round(canvas.height * k));
      const oc = out.getContext('2d');
      oc.imageSmoothingQuality = 'high';
      oc.drawImage(canvas, 0, 0, out.width, out.height);
      const jpg = await canvasToBytes(out, 'image/jpeg', q);
      if (jpg.length >= stream.contents.length * 0.95) continue;

      const nd = d.clone(ctx);
      nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      nd.delete(PDFName.of('DecodeParms'));
      nd.set(PDFName.of('Width'), PDFNumber.of(out.width));
      nd.set(PDFName.of('Height'), PDFNumber.of(out.height));
      nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      nd.set(PDFName.of('Length'), PDFNumber.of(jpg.length));
      ctx.assign(ref, PDFRawStream.of(nd, jpg));
      changed++;
    } catch (e) { console.warn('skip image', e); }
  }
  return { bytes: await savePdf(doc), images: objs.length, changed };
}

/** Rasterise every page to JPEG (text becomes non-selectable). */
export async function rasterizePdf(bytes, { dpi, q }, onProgress) {
  const pdf = await loadPdfJs(bytes);
  const out = await PL().PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const c = await renderPage(pdf, i, { scale: dpi / 72 });
    const img = await out.embedJpg(await canvasToBytes(c, 'image/jpeg', q));
    out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    onProgress && onProgress(i / pdf.numPages);
  }
  pdf.destroy();
  return savePdf(out);
}

export default function (root) {
  let file, bytes;
  let level = 'medium', mode = 'smart';
  const st = statusBar();
  const res = h('div');
  const modeNote = h('div', { class: 'sub', style: 'font-size:13px;color:var(--muted);margin-top:8px' });
  const setNote = () => modeNote.textContent = mode === 'smart'
    ? 'บีบอัดเฉพาะรูปภาพในเอกสาร ข้อความยังคัดลอก/ค้นหาได้ตามเดิม'
    : 'แปลงทุกหน้าเป็นภาพ เหมาะกับไฟล์สแกน — ข้อความจะคัดลอกไม่ได้';
  setNote();
  const info = h('div', { class: 'fitem' });
  const panel = h('div', { class: 'panel hidden' },
    info,
    h('div', { class: 'row', style: 'margin-top:14px' },
      field('ระดับการบีบอัด', seg(Object.entries(LEVELS).map(([k, v]) => [k, v.label]), level, v => { level = v; res.innerHTML = ''; })),
    ),
    h('div', { class: 'row' },
      field('วิธีบีบอัด', seg([['smart', 'บีบอัดรูปภาพ (คงข้อความ)'], ['raster', 'แปลงทั้งหน้าเป็นภาพ']], mode, v => { mode = v; setNote(); res.innerHTML = ''; })),
    ),
    modeNote,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'),
      h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: run }, 'ลดขนาด PDF')),
    st, res);
  const dz = dropzone({ accept: '.pdf', onFiles: load });
  root.append(dz, panel);

  function reset() { file = null; res.innerHTML = ''; panel.classList.add('hidden'); dz.classList.remove('hidden'); st.set(''); }
  async function load([f]) {
    file = f; bytes = await readBytes(f);
    info.innerHTML = '';
    info.append(h('div', { class: 'meta' }, h('div', { class: 'name' }, f.name), h('div', { class: 'sub' }, 'ขนาดเดิม ' + fmtSize(f.size))));
    dz.classList.add('hidden'); panel.classList.remove('hidden');
  }
  async function run() {
    res.innerHTML = '';
    try {
      st.set('กำลังบีบอัด...'); st.progress(0);
      const L = LEVELS[level];
      let out, detail = '';
      if (mode === 'smart') {
        const r = await compressImagesInPdf(bytes, L, p => st.progress(p));
        out = r.bytes; detail = r.images ? ` · บีบอัดรูป ${r.changed}/${r.images} รูป` : ' · ไม่พบรูปภาพในเอกสาร';
      } else out = await rasterizePdf(bytes, L, p => st.progress(p));
      st.progress(null); st.set('');
      if (out.length >= bytes.length) {
        res.append(h('div', { class: 'status err' }, `ไม่สามารถลดขนาดได้อีก (ผลลัพธ์ ${fmtSize(out.length)} ไม่เล็กกว่าเดิม ${fmtSize(bytes.length)})${detail}` +
          (mode === 'smart' ? ' — ลองเลือก "แปลงทั้งหน้าเป็นภาพ" หรือเพิ่มระดับการบีบอัด' : ' — ลองวิธี "บีบอัดรูปภาพ"')));
        return;
      }
      const pct = Math.round((1 - out.length / bytes.length) * 100);
      res.append(resultBox(`${fmtSize(bytes.length)} → ${fmtSize(out.length)} (ลดลง ${pct}%)${detail}`, () => download(out, baseName(file.name) + '_compressed.pdf')));
    } catch (e) { st.error(e); }
  }
}
