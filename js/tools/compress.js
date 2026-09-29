import { h, dropzone, readPdf, statusBar, download, resultBox, PL, savePdf, fmtSize, baseName, seg, field, loadPdfJs, renderPage, canvasToBytes, tick, busy, freeCanvas } from '../lib.js';

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
    freeCanvas(c);
    out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    onProgress && onProgress(i / pdf.numPages);
  }
  pdf.destroy();
  return savePdf(out);
}

// Quality ladders for "fit under N MB": tried from best quality to smallest file.
const SMART_LADDER = [
  { maxPx: 2400, q: 0.82 }, { maxPx: 2000, q: 0.75 }, { maxPx: 1600, q: 0.68 }, { maxPx: 1300, q: 0.6 },
  { maxPx: 1100, q: 0.5 }, { maxPx: 900, q: 0.45 }, { maxPx: 700, q: 0.4 },
];
const RASTER_LADDER = [
  { dpi: 150, q: 0.8 }, { dpi: 120, q: 0.7 }, { dpi: 100, q: 0.62 }, { dpi: 85, q: 0.55 },
  { dpi: 72, q: 0.5 }, { dpi: 60, q: 0.45 },
];

/**
 * Find the best-quality version that is at most `target` bytes.
 * Tries image-only compression first (keeps text selectable), then whole-page rasterising.
 * Returns { bytes, hit, raster, step } — when nothing fits, the smallest result with hit=false.
 */
export async function compressToTarget(bytes, target, { onProgress, onStep, allowRaster = true } = {}) {
  const total = SMART_LADDER.length + (allowRaster ? RASTER_LADDER.length : 0);
  let best = null, n = 0;
  const consider = (out, raster, step) => {
    if (!best || out.length < best.bytes.length) best = { bytes: out, hit: out.length <= target, raster, step };
    return out.length <= target;
  };
  for (const L of SMART_LADDER) {
    onStep && onStep(`ลองบีบรูประดับ ${n + 1}/${total}...`);
    const r = await compressImagesInPdf(bytes, L, p => onProgress && onProgress((n + p) / total));
    n++;
    if (consider(r.bytes, false, L)) return { ...best, hit: true };
    if (!r.images || !r.changed) break;   // no (compressible) images: smaller settings won't help
  }
  if (allowRaster) {
    n = SMART_LADDER.length;
    for (const L of RASTER_LADDER) {
      onStep && onStep(`ลองแปลงเป็นภาพระดับ ${n - SMART_LADDER.length + 1}/${RASTER_LADDER.length}...`);
      const out = await rasterizePdf(bytes, L, p => onProgress && onProgress((n + p) / total));
      n++;
      if (consider(out, true, L)) return { ...best, hit: true };
    }
  }
  return best;
}

export default function (root) {
  let file, bytes;
  let level = 'medium', mode = 'smart', target = 'none';
  const st = statusBar();
  const res = h('div');
  const stale = () => { gen++; res.innerHTML = ''; };
  const modeNote = h('div', { class: 'sub', style: 'font-size:13px;color:var(--muted);margin-top:8px' });
  const setNote = () => modeNote.textContent = target !== 'none'
    ? 'ระบบจะลองหลายระดับ แล้วเลือกคุณภาพดีที่สุดที่ขนาดไม่เกินเป้า — ถ้าบีบรูปอย่างเดียวไม่พอ จะแปลงทั้งหน้าเป็นภาพ (ข้อความจะคัดลอกไม่ได้)'
    : mode === 'smart'
      ? 'บีบอัดเฉพาะรูปภาพในเอกสาร ข้อความยังคัดลอก/ค้นหาได้ตามเดิม'
      : 'แปลงทุกหน้าเป็นภาพ เหมาะกับไฟล์สแกน — ข้อความจะคัดลอกไม่ได้';
  const customMb = h('input', { type: 'number', min: 0.1, step: 0.1, value: 3, style: 'max-width:110px', 'aria-label': 'ขนาดเป้าหมาย (MB)' });
  customMb.oninput = stale;
  const customWrap = h('div', { class: 'row hidden', style: 'margin-top:8px' }, h('span', {}, 'ไม่เกิน'), customMb, h('span', {}, 'MB'));
  const keepText = h('input', { type: 'checkbox' });
  keepText.onchange = stale;
  const keepWrap = h('label', { class: 'check hidden', style: 'margin-top:8px' }, keepText, 'ห้ามแปลงเป็นภาพ (ให้ข้อความยังคัดลอกได้เสมอ)');
  const manual = h('div', {},
    h('div', { class: 'row' },
      field('ระดับการบีบอัด', seg(Object.entries(LEVELS).map(([k, v]) => [k, v.label]), level, v => { level = v; stale(); })),
    ),
    h('div', { class: 'row' },
      field('วิธีบีบอัด', seg([['smart', 'บีบอัดรูปภาพ (คงข้อความ)'], ['raster', 'แปลงทั้งหน้าเป็นภาพ']], mode, v => { mode = v; setNote(); stale(); })),
    ));
  setNote();
  const info = h('div', { class: 'fitem' });
  const panel = h('div', { class: 'panel hidden' },
    info,
    h('div', { class: 'row', style: 'margin-top:14px' },
      field('ขนาดที่ต้องการ', seg([['none', 'ไม่กำหนด'], ['1', '≤ 1 MB'], ['2', '≤ 2 MB'], ['5', '≤ 5 MB'], ['custom', 'กำหนดเอง']], target, v => {
        target = v;
        manual.classList.toggle('hidden', v !== 'none');
        customWrap.classList.toggle('hidden', v !== 'custom');
        keepWrap.classList.toggle('hidden', v === 'none');
        setNote(); stale();
      }))),
    customWrap, keepWrap,
    manual,
    modeNote,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'),
      h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'ลดขนาด PDF')),
    st, res);
  const dz = dropzone({ accept: '.pdf', onFiles: load });
  root.append(dz, panel);

  let gen = 0;
  function reset() { gen++; file = null; res.innerHTML = ''; panel.classList.add('hidden'); dz.classList.remove('hidden'); st.set(''); }
  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    let r;
    try { r = await readPdf(f); } catch (e) { return st.error(e); }
    st.set('');
    stale();
    file = f; bytes = r.bytes;
    info.innerHTML = '';
    info.append(h('div', { class: 'meta' }, h('div', { class: 'name' }, f.name), h('div', { class: 'sub' }, 'ขนาดเดิม ' + fmtSize(f.size) + (r.unlocked ? ' · 🔓 ปลดล็อกแล้ว (ไฟล์ผลลัพธ์จะไม่มีรหัส)' : ''))));
    dz.classList.add('hidden'); panel.classList.remove('hidden');
  }
  function targetBytes() {
    const mb = target === 'custom' ? +customMb.value : +target;
    return mb > 0 ? Math.floor(mb * 1024 * 1024) : 0;
  }
  async function run() {
    res.innerHTML = '';
    const my = gen, name = baseName(file.name) + '_compressed.pdf';
    const pct = (out) => Math.round((1 - out.length / bytes.length) * 100);
    try {
      if (target !== 'none') {
        const t = targetBytes();
        if (!t) return st.set('กรุณากรอกขนาดเป้าหมายเป็นตัวเลข', 'err');
        if (bytes.length <= t) {
          res.append(resultBox(`ไฟล์นี้ ${fmtSize(bytes.length)} เล็กกว่าเป้า ${fmtSize(t)} อยู่แล้ว ไม่ต้องบีบ`, () => download(bytes, file.name)));
          return;
        }
        st.progress(0);
        const r = await compressToTarget(bytes, t, { allowRaster: !keepText.checked, onStep: s => st.set(s), onProgress: p => st.progress(p) });
        st.progress(null); st.set('');
        if (my !== gen) return;
        if (r.bytes.length >= bytes.length) {
          res.append(h('div', { class: 'status err' }, `บีบให้เล็กลงไม่ได้ (${fmtSize(bytes.length)})` + (keepText.checked ? ' — ลองเอาติ๊ก "ห้ามแปลงเป็นภาพ" ออก' : '')));
          return;
        }
        const how = r.raster ? ' · แปลงเป็นภาพ (ข้อความคัดลอกไม่ได้)' : ' · ข้อความยังคัดลอกได้';
        if (r.hit) res.append(resultBox(`${fmtSize(bytes.length)} → ${fmtSize(r.bytes.length)} ไม่เกิน ${fmtSize(t)} ✓ (ลดลง ${pct(r.bytes)}%)${how}`, () => download(r.bytes, name)));
        else {
          res.append(h('div', { class: 'status err' }, `บีบได้เล็กสุด ${fmtSize(r.bytes.length)} ยังเกินเป้า ${fmtSize(t)}` +
            (keepText.checked ? ' — ลองเอาติ๊ก "ห้ามแปลงเป็นภาพ" ออก' : ' — ไฟล์มีหน้าเยอะเกินไป ลองแยกไฟล์เป็นหลายส่วน')));
          res.append(resultBox(`ไฟล์ที่เล็กที่สุดที่ทำได้ ${fmtSize(r.bytes.length)} (ลดลง ${pct(r.bytes)}%)${how}`, () => download(r.bytes, name)));
        }
        return;
      }
      st.set('กำลังบีบอัด...'); st.progress(0);
      const L = LEVELS[level];
      let out, detail = '';
      if (mode === 'smart') {
        const r = await compressImagesInPdf(bytes, L, p => st.progress(p));
        out = r.bytes; detail = r.images ? ` · บีบอัดรูป ${r.changed}/${r.images} รูป` : ' · ไม่พบรูปภาพในเอกสาร';
      } else out = await rasterizePdf(bytes, L, p => st.progress(p));
      st.progress(null); st.set('');
      if (my !== gen) return;
      if (out.length >= bytes.length) {
        res.append(h('div', { class: 'status err' }, `ไม่สามารถลดขนาดได้อีก (ผลลัพธ์ ${fmtSize(out.length)} ไม่เล็กกว่าเดิม ${fmtSize(bytes.length)})${detail}` +
          (mode === 'smart' ? ' — ลองเลือก "แปลงทั้งหน้าเป็นภาพ" หรือเพิ่มระดับการบีบอัด' : ' — ลองวิธี "บีบอัดรูปภาพ"')));
        return;
      }
      res.append(resultBox(`${fmtSize(bytes.length)} → ${fmtSize(out.length)} (ลดลง ${pct(out)}%)${detail}`, () => download(out, name)));
    } catch (e) { st.error(e); }
  }
}
