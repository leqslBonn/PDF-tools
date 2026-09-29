import { h, dropzone, readPdf, busy, statusBar, download, resultBox, fmtSize, baseName, field, textToPng, imageToCanvas, canvasToBytes, pickFiles, toThaiDigits } from '../lib.js';
import { createEditor, stampItems } from '../editor.js';

const SYMBOLS = ['✓', '✔', '✗', '✘', '●', '○', '■', '□', '☑', '☒', '★', '→', '←', '•', '—', '※'];
const FONTS = ['Sarabun', 'Itim', 'Mali', 'Charm'];

export default function (root) {
  let file, bytes, gen = 0;
  const st = statusBar();
  const res = h('div');
  const edHost = h('div');

  // text defaults (also used to edit the selected text item)
  const tIn = h('textarea', { rows: 2, placeholder: 'พิมพ์ข้อความ (Enter ขึ้นบรรทัดใหม่)' });
  const size = h('input', { type: 'number', min: 6, max: 96, value: 14 });
  size.onblur = () => { size.value = clampSize(size.value, 14); };
  const color = h('input', { type: 'color', value: '#000000' });
  const bold = h('input', { type: 'checkbox' });
  const font = h('select', {}, ...FONTS.map(f => h('option', { value: f }, f)));
  const addBtn = h('button', { class: 'btn primary', onclick: addText }, '+ เพิ่มข้อความ');
  const selBox = h('div', { class: 'hidden', style: 'margin-top:10px;padding:10px;border:1px solid var(--line);border-radius:10px' });

  const side = h('div', { class: 'panel side', style: 'margin-top:0' },
    h('h3', {}, 'ข้อความ'),
    tIn,
    h('div', { class: 'row', style: 'margin-top:8px' }, field('ขนาด', size), field('สี', color)),
    h('div', { class: 'row' }, field('แบบอักษร', font), h('label', { class: 'check', style: 'margin-top:18px' }, bold, 'ตัวหนา')),
    h('div', { class: 'actions', style: 'margin-top:10px' }, addBtn,
      h('button', { class: 'btn sm', onclick: () => { tIn.value = todayThai(); addText(); } }, '+ วันที่'),
      h('button', { class: 'btn sm', onclick: () => { tIn.value = toThaiDigits(todayThai()); addText(); } }, '+ วันที่ (เลขไทย)')),
    selBox,
    h('h3', { style: 'margin-top:18px' }, 'สัญลักษณ์'),
    h('div', { class: 'sym-grid' }, ...SYMBOLS.map(s => h('button', { type: 'button', title: 'เพิ่มสัญลักษณ์ ' + s, onclick: () => addSymbol(s) }, s))),
    h('h3', { style: 'margin-top:18px' }, 'รูปภาพ'),
    h('button', { class: 'btn', style: 'width:100%', onclick: addImage }, '🖼 เพิ่มรูปภาพ / โลโก้ / ตราประทับ'),
    h('hr', { style: 'border-color:var(--line);margin:16px 0' }),
    h('div', { class: 'sub', style: 'font-size:13px;color:var(--muted)' }, 'คลิกหน้าที่ต้องการก่อน แล้วค่อยเพิ่ม · ลากเพื่อย้าย · ลากจุดมุมเพื่อปรับขนาด · ดับเบิลคลิกข้อความเพื่อแก้ไข'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'), h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, 'บันทึก PDF')),
    st, res);
  const panel = h('div', { class: 'hidden' }, h('div', { class: 'editor-layout' }, edHost, side));
  const dz = dropzone({ accept: '.pdf', hint: 'เลือกเอกสารที่ต้องการเพิ่มข้อมูล', onFiles: load });
  root.append(dz, panel);
  const ed = createEditor(edHost, { onSelect: showSel, onEdit: editText, onChange: () => { gen++; res.innerHTML = ''; } });

  function todayThai() {
    const d = new Date();
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
  }
  const clampSize = (v, fallback) => { const n = +v; return isNaN(n) || !n ? fallback : Math.min(96, Math.max(6, n)); };
  const props = () => ({ size: clampSize(size.value, 14), color: color.value, bold: bold.checked, font: font.value });

  async function render(text, p) {
    const t = await textToPng(text, { ...p, pad: 0.1 });
    return { src: t.canvas.toDataURL(), bytes: t.bytes, type: 'png', aspect: t.w / t.h, pts: t.w };
  }
  async function addText() {
    if (!bytes) return;
    const text = tIn.value.trim();
    if (!text) { tIn.focus(); return st.set('กรุณาพิมพ์ข้อความ', 'err'); }
    st.set('');
    const p = props();
    const r = await render(text, p);
    ed.add({ ...r, kind: 'text', text, props: p }, { widthFrac: r.pts / pageWidthPts() });
    tIn.value = '';
  }
  async function addSymbol(s) {
    if (!bytes) return;
    const p = { ...props(), size: Math.max(14, clampSize(size.value, 14)), font: 'Sarabun' };
    const r = await render(s, p);
    ed.add({ ...r, kind: 'text', text: s, props: p }, { widthFrac: r.pts / pageWidthPts() });
  }
  async function addImage() {
    if (!bytes) return;
    const [f] = await pickFiles('image/png,image/jpeg,image/webp', false);
    if (!f) return;
    const c = await imageToCanvas(f, 1600);
    const isPng = /png|webp/.test(f.type);
    const type = isPng ? 'png' : 'jpg';
    const b = await canvasToBytes(c, isPng ? 'image/png' : 'image/jpeg', 0.9);
    ed.add({ kind: 'image', src: c.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.8), bytes: b, type, aspect: c.width / c.height, keepAspect: true }, { widthFrac: 0.3 });
  }
  // Width (pt) of the page the item goes on, so new text appears at its real point size on every page.
  function pageWidthPts() { return ed.pagePts(ed.current()); }

  function showSel(it) {
    res.innerHTML = '';
    selBox.innerHTML = '';
    selBox.classList.toggle('hidden', !it || it.kind !== 'text');
    if (!it || it.kind !== 'text') return;
    const ta = h('textarea', { rows: 2 }); ta.value = it.text;
    const sz = h('input', { type: 'number', min: 6, max: 96, value: it.props.size, 'aria-label': 'ขนาดตัวอักษร' });
    const col = h('input', { type: 'color', value: it.props.color });
    const bd = h('input', { type: 'checkbox', checked: it.props.bold });
    const apply = async () => {
      const oldSize = it.props.size;
      it.text = ta.value || ' ';
      it.props = { ...it.props, size: clampSize(sz.value, oldSize), color: col.value, bold: bd.checked };
      sz.value = it.props.size;
      const r = await render(it.text, it.props);
      // keep rendered scale proportional to the font size change
      it.h = it.h * (it.props.size / oldSize);
      ed.update(it, r);
    };
    ta.onchange = sz.onchange = col.onchange = bd.onchange = apply;
    selBox.append(h('div', { style: 'font-size:13px;color:var(--muted);margin-bottom:6px' }, 'แก้ไขข้อความที่เลือก'), ta,
      h('div', { class: 'row', style: 'margin-top:8px' }, field('ขนาด', sz), field('สี', col), h('label', { class: 'check', style: 'margin-top:18px' }, bd, 'หนา')),
      h('div', { class: 'actions', style: 'margin-top:8px' }, h('button', { class: 'btn sm danger', onclick: () => ed.remove(it) }, 'ลบรายการนี้')));
  }
  function editText(it) { if (it.kind === 'text') { showSel(it); selBox.querySelector('textarea').focus(); } }

  function reset() {
    if (ed.items().length && !confirm('ข้อมูลที่เพิ่มไว้จะหายไป ต้องการเลือกไฟล์ใหม่หรือไม่?')) return;
    gen++; file = bytes = null; ed.destroy(); tIn.value = ''; selBox.innerHTML = ''; selBox.classList.add('hidden');
    res.innerHTML = ''; st.set(''); panel.classList.add('hidden'); dz.classList.remove('hidden');
  }
  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    try {
      const r = await readPdf(f);
      file = f; bytes = r.bytes; gen++;
      dz.classList.add('hidden'); panel.classList.remove('hidden');
      st.set('กำลังแสดงเอกสาร...');
      await ed.load(bytes);
      st.set(r.unlocked ? '🔓 ปลดล็อกไฟล์แล้ว' : '');
    } catch (e) { st.error(e); }
  }
  async function run() {
    res.innerHTML = '';
    if (!ed.items().length) return st.set('ยังไม่ได้เพิ่มข้อมูล', 'err');
    const my = gen, name = baseName(file.name) + '_filled.pdf';
    try {
      st.set('กำลังบันทึก...');
      const out = await stampItems(bytes, ed.items());
      st.set('');
      if (my !== gen) return;
      res.append(resultBox(fmtSize(out.length), () => { download(out, name); ed.saved(); }));
    } catch (e) { st.error(e); }
  }
}
