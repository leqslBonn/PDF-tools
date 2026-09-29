import { h, dropzone, readPdf, statusBar, download, resultBox, PL, savePdf, fmtSize, baseName, seg, textToPng, pageGeom, drawVisual,
  loadPdfJs, renderPage, freeCanvas, busy, onLeave, unsaved, MAX_PREVIEW_PAGES } from '../lib.js';

/* ---------- reading the form ---------- */

function kindOf(f) {
  const L = PL();
  if (f instanceof L.PDFTextField) return 'text';
  if (f instanceof L.PDFCheckBox) return 'check';
  if (f instanceof L.PDFRadioGroup) return 'radio';
  if (f instanceof L.PDFDropdown) return 'dropdown';
  if (f instanceof L.PDFOptionList) return 'list';
  return null; // push buttons, signature fields: nothing to fill
}

/** Page index of every widget annotation, keyed by the widget's object ref. */
function widgetPages(doc) {
  const map = new Map();
  doc.getPages().forEach((page, i) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) { const ref = annots.get(k); if (ref && ref.toString) map.set(ref.toString(), i); }
  });
  return map;
}

/** Font size from the field's /DA string ("/Helv 12 Tf"); 0 means auto. */
function daSize(field) {
  try { const m = /(\d+(?:\.\d+)?)\s+Tf/.exec(field.acroField.getDefaultAppearance() || ''); return m ? +m[1] : 0; } catch { return 0; }
}

/** Describe all fillable fields: [{ name, kind, value, options, multiline, maxLen, size, widgets:[{page, rect}] }]. */
export function readFields(doc) {
  const wp = widgetPages(doc);
  const out = [];
  for (const f of doc.getForm().getFields()) {
    const kind = kindOf(f);
    if (!kind) continue;
    const d = { name: f.getName(), kind, readOnly: f.isReadOnly(), widgets: [], size: daSize(f) };
    try {
      if (kind === 'text') { d.value = f.getText() || ''; d.multiline = f.isMultiline(); d.maxLen = f.getMaxLength(); }
      if (kind === 'check') d.value = f.isChecked();
      if (kind === 'radio') { d.options = f.getOptions(); d.value = f.getSelected() || ''; }
      if (kind === 'dropdown' || kind === 'list') { d.options = f.getOptions(); d.value = (f.getSelected() || [])[0] || ''; }
    } catch { d.value = kind === 'check' ? false : ''; }
    for (const w of f.acroField.getWidgets()) {
      const ref = doc.context.getObjectRef(w.dict);
      const page = ref ? wp.get(ref.toString()) : undefined;
      if (page === undefined) continue;
      d.widgets.push({ page, rect: w.getRectangle() });
    }
    if (d.widgets.length) out.push(d);
  }
  return out;
}

/* ---------- writing ---------- */

/** Break text into lines that fit `maxW` pt at `size` pt, word-aware for Thai (Intl.Segmenter). */
function wrap(text, size, maxW) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${size}px "Sarabun", sans-serif`;
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = seg ? [...seg.segment(para)].map(s => s.segment) : para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      if (line && ctx.measureText(line + w).width > maxW) { lines.push(line.trimEnd()); line = w.trimStart(); }
      else line += w;
    }
    lines.push(line);
  }
  return lines;
}

/** Visual rectangle (of the rotated page as seen) for a widget rect in PDF user space. */
function visualRect(page, r) {
  const { p2v } = pageGeom(page);
  const a = p2v(r.x, r.y), b = p2v(r.x + r.width, r.y + r.height);
  return { u: Math.min(a.u, b.u), v: Math.min(a.v, b.v), w: Math.abs(a.u - b.u), h: Math.abs(a.v - b.v) };
}

/**
 * values: { [fieldName]: string | boolean }
 * mode 'flat': field appearances are baked in and our own text (proper Thai shaping) is drawn on top — looks right everywhere, no longer editable.
 * mode 'editable': values are stored in the fields; the viewer app draws them (Thai may render poorly in some apps).
 */
export async function fillPdf(bytes, values, { mode = 'flat' } = {}) {
  const L = PL();
  const doc = await L.PDFDocument.load(bytes);
  const form = doc.getForm();
  const fields = readFields(doc);
  if (mode === 'editable') {
    for (const d of fields) {
      if (!(d.name in values)) continue;
      const f = form.getField(d.name), v = values[d.name];
      try {
        if (d.kind === 'text') {
          f.setText(String(v));
          // drop the stale appearance so viewers must redraw with the new value
          f.acroField.getWidgets().forEach(w => w.dict.delete(L.PDFName.of('AP')));
        } else if (d.kind === 'check') v ? f.check() : f.uncheck();
        else if (d.kind === 'radio') { if (v) f.select(v); else f.clear(); }
        else if (v) f.select(v);
      } catch (e) { console.warn('field', d.name, e); }
    }
    form.acroForm.dict.set(L.PDFName.of('NeedAppearances'), L.PDFBool.True);
    return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  }

  // flat: bake existing appearances, then draw values ourselves
  form.flatten({ updateFieldAppearances: false });
  const pages = doc.getPages();
  const cache = new Map();
  const png = async (key, make) => { if (!cache.has(key)) { const t = await make(); cache.set(key, { img: await doc.embedPng(t.bytes), w: t.w, h: t.h }); } return cache.get(key); };
  for (const d of fields) {
    const v = values[d.name] ?? d.value;
    if (v === '' || v === false || v == null) continue;
    for (let wi = 0; wi < d.widgets.length; wi++) {
      const { page: pi, rect } = d.widgets[wi];
      const page = pages[pi];
      const r = visualRect(page, rect);
      if (d.kind === 'check' || d.kind === 'radio') {
        // radio: widget order follows getOptions(); only the chosen option gets the mark
        if (d.kind === 'radio' && d.options[wi] !== v) continue;
        const mark = await png(d.kind + '-mark', () => textToPng(d.kind === 'check' ? '✓' : '●', { size: 40, color: '#000000', pad: 0 }));
        const s = Math.min(r.w, r.h) * 0.82, k = s / Math.max(mark.w, mark.h);
        drawVisual(page, mark.img, { cu: r.u + r.w / 2, cv: r.v + r.h / 2, w: mark.w * k, h: mark.h * k });
        continue;
      }
      const text = String(v);
      const padX = 2;
      // /DA sizes are often auto-computed and huge (60pt in a 70pt box) — cap to normal form text
      let size = d.size > 0 ? Math.min(d.size, 14) : 11;
      if (!d.multiline) size = Math.max(6, Math.min(size, r.h * 0.72));
      const lines = d.multiline ? wrap(text, size, r.w - padX * 2) : [text];
      const t = await textToPng(lines.join('\n'), { size, color: '#000000', pad: 0.05 });
      let k = Math.min(1, (r.w - padX * 2) / t.w, (d.multiline ? r.h : r.h * 1.15) / t.h);
      const img = await doc.embedPng(t.bytes);
      const w = t.w * k, hh = t.h * k;
      const cv = d.multiline ? r.v + hh / 2 + 1 : r.v + r.h / 2;
      drawVisual(page, img, { cu: r.u + padX + w / 2, cv, w, h: hh });
    }
  }
  return savePdf(doc);
}

/* ---------- UI ---------- */

export default function (root) {
  let file, bytes, fields = [], gen = 0, mode = 'flat';
  const values = {};
  const st = statusBar();
  const res = h('div');
  const docEl = h('div', { class: 'doc' });
  const list = h('div', { class: 'fill-list' });
  const stale = () => { gen++; res.innerHTML = ''; unsaved.value = true; };
  const inputs = new Map(); // name → input element
  const boxes = new Map();  // name → [overlay boxes]

  const side = h('div', { class: 'panel side', style: 'margin-top:0' },
    h('h3', {}, 'ช่องกรอกในเอกสาร'),
    list,
    h('div', { style: 'margin:14px 0 6px;font-size:13px;color:var(--muted)' }, 'รูปแบบไฟล์ที่ได้'),
    seg([['flat', '🔒 กรอกแล้วล็อก'], ['editable', '✏️ ยังแก้ไขได้']], mode, v => { mode = v; gen++; res.innerHTML = ''; }),
    h('p', { style: 'margin:6px 0 0;color:var(--muted);font-size:12.5px' },
      'กรอกแล้วล็อก: ภาษาไทยแสดงถูกต้องทุกแอป (แนะนำ) · ยังแก้ไขได้: ช่องยังพิมพ์ต่อได้ แต่บางแอป เช่น Preview บน iPhone อาจแสดงภาษาไทยเพี้ยน'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'), h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'บันทึก PDF')),
    st, res);
  const panel = h('div', { class: 'hidden' }, h('div', { class: 'editor-layout' }, docEl, side));
  const dz = dropzone({ accept: '.pdf', hint: 'แบบฟอร์มที่มีช่องกรอกอยู่ในไฟล์ เช่น แบบฟอร์มราชการ ใบสมัคร', onFiles: load });
  root.append(dz, panel);
  onLeave(() => { bytes = null; });

  function focusField(name) {
    const i = inputs.get(name);
    if (i) { i.focus({ preventScroll: false }); i.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  function highlight(name, on) { (boxes.get(name) || []).forEach(b => b.classList.toggle('on', on)); }
  function markFilled(d) {
    const v = values[d.name];
    (boxes.get(d.name) || []).forEach(b => b.classList.toggle('filled', v !== '' && v !== false && v != null));
  }

  function buildList() {
    list.innerHTML = ''; inputs.clear();
    fields.forEach((d, n) => {
      const label = h('div', { class: 'fill-label' }, h('span', { class: 'fill-no' }, String(n + 1)), d.name.split('.').pop());
      let input;
      const set = (v) => { values[d.name] = v; markFilled(d); stale(); };
      if (d.kind === 'text') {
        input = d.multiline ? h('textarea', { rows: 2 }) : h('input', { type: 'text' });
        input.value = values[d.name];
        if (d.maxLen) input.maxLength = d.maxLen;
        input.oninput = () => set(input.value);
      } else if (d.kind === 'check') {
        input = h('input', { type: 'checkbox', checked: !!values[d.name] });
        input.onchange = () => set(input.checked);
        label.prepend(input);
      } else {
        input = h('select', {}, h('option', { value: '' }, '— ไม่เลือก —'), ...d.options.map(o => h('option', { value: o, selected: o === values[d.name] }, o)));
        input.onchange = () => set(input.value);
      }
      if (d.readOnly) { input.disabled = true; label.append(h('span', { class: 'sub' }, ' (อ่านอย่างเดียว)')); }
      input.setAttribute('aria-label', `ช่องที่ ${n + 1}: ${d.name}`);
      input.onfocus = () => highlight(d.name, true);
      input.onblur = () => highlight(d.name, false);
      inputs.set(d.name, input);
      list.append(h('label', { class: 'fill-row' }, label, d.kind === 'check' ? null : input));
    });
  }

  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    try {
      const r = await readPdf(f);
      const doc = await PL().PDFDocument.load(r.bytes);
      const found = readFields(doc);
      if (!found.length) {
        st.set('');
        return st.set('ไฟล์นี้ไม่มีช่องกรอกในตัว — ใช้เครื่องมือ "เพิ่มข้อมูลใน PDF" เพื่อพิมพ์ทับตรงไหนก็ได้แทน', 'err');
      }
      file = f; bytes = r.bytes; fields = found; gen++;
      fields.forEach(d => { values[d.name] = d.value; });
      dz.classList.add('hidden'); panel.classList.remove('hidden');
      buildList();
      await renderPages(doc);
      st.set(`พบ ${fields.length} ช่อง — กรอกทางขวา หรือแตะช่องบนเอกสาร`);
      unsaved.value = false;
    } catch (e) { st.error(e); }
  }

  async function renderPages(doc) {
    docEl.innerHTML = ''; boxes.clear();
    const pdf = await loadPdfJs(bytes);
    const pages = doc.getPages();
    const n = Math.min(pdf.numPages, MAX_PREVIEW_PAGES);
    const maxW = Math.min(820, Math.max(300, docEl.clientWidth - 40));
    for (let i = 0; i < n; i++) {
      const c = await renderPage(pdf, i + 1, { maxW, maxH: 5000 });
      const cssW = c.width / Math.min(2, devicePixelRatio || 1);
      const img = h('img', { src: c.toDataURL('image/jpeg', 0.88), alt: `หน้า ${i + 1}`, style: 'display:block;width:100%;height:auto' });
      freeCanvas(c);
      const overlay = h('div', { class: 'overlay' });
      const { vw, vh } = pageGeom(pages[i]);
      fields.forEach((d, k) => d.widgets.forEach(w => {
        if (w.page !== i) return;
        const r = visualRect(pages[i], w.rect);
        const b = h('button', { type: 'button', class: 'fill-box', title: `ช่องที่ ${k + 1}: ${d.name}`,
          style: `left:${r.u / vw * 100}%;top:${r.v / vh * 100}%;width:${r.w / vw * 100}%;height:${r.h / vh * 100}%`,
          onclick: () => focusField(d.name) }, h('span', {}, String(k + 1)));
        if (!boxes.has(d.name)) boxes.set(d.name, []);
        boxes.get(d.name).push(b);
        overlay.append(b);
      }));
      docEl.append(h('div', { class: 'page-wrap', style: `width:${cssW}px` }, h('span', { class: 'plabel' }, `หน้า ${i + 1}`), img, overlay));
    }
    if (pdf.numPages > n) docEl.append(h('div', { class: 'sub' }, `แสดง ${n} หน้าแรก (ช่องในหน้าที่เหลือยังกรอกได้จากรายการ)`));
    pdf.destroy();
    fields.forEach(markFilled);
  }

  function reset() {
    if (unsaved.value && !confirm('ข้อมูลที่กรอกไว้จะหายไป ต้องการเลือกไฟล์ใหม่หรือไม่?')) return;
    gen++; file = bytes = null; fields = []; for (const k in values) delete values[k];
    list.innerHTML = ''; docEl.innerHTML = ''; res.innerHTML = ''; st.set(''); unsaved.value = false;
    panel.classList.add('hidden'); dz.classList.remove('hidden');
  }
  async function run() {
    res.innerHTML = '';
    const my = gen, name = baseName(file.name) + '_filled.pdf';
    try {
      st.set('กำลังบันทึก...');
      const out = await fillPdf(bytes, { ...values }, { mode });
      st.set('');
      if (my !== gen) return;
      res.append(resultBox(`${mode === 'flat' ? 'กรอกแล้วล็อก' : 'ยังแก้ไขได้'} · ${fmtSize(out.length)}`, () => { download(out, name); unsaved.value = false; }));
    } catch (e) { st.error(e); }
  }
}
