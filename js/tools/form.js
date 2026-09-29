import { h, dropzone, readBytes, statusBar, download, resultBox, fmtSize, baseName, field, textToPng, imageToCanvas, canvasToBytes, pickFiles, toThaiDigits } from '../lib.js';
import { createEditor, stampItems } from '../editor.js';

const SYMBOLS = ['✓', '✔', '✗', '✘', '●', '○', '■', '□', '☑', '☒', '★', '→', '←', '•', '—', '※'];
const FONTS = ['Sarabun', 'Itim', 'Mali', 'Charm'];

export default function (root) {
  let file, bytes, pageW = 595;
  const st = statusBar();
  const res = h('div');
  const edHost = h('div');

  // text defaults (also used to edit the selected text item)
  const tIn = h('textarea', { rows: 2, placeholder: 'พิมพ์ข้อความ (Enter ขึ้นบรรทัดใหม่)' });
  const size = h('input', { type: 'number', min: 6, max: 96, value: 14 });
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
    h('div', { class: 'sym-grid' }, ...SYMBOLS.map(s => h('button', { type: 'button', title: s, onclick: () => addSymbol(s) }, s))),
    h('h3', { style: 'margin-top:18px' }, 'รูปภาพ'),
    h('button', { class: 'btn', style: 'width:100%', onclick: addImage }, '🖼 เพิ่มรูปภาพ / โลโก้ / ตราประทับ'),
    h('hr', { style: 'border-color:var(--line);margin:16px 0' }),
    h('div', { class: 'sub', style: 'font-size:13px;color:var(--muted)' }, 'คลิกหน้าที่ต้องการก่อน แล้วค่อยเพิ่ม · ลากเพื่อย้าย · ลากจุดมุมเพื่อปรับขนาด · ดับเบิลคลิกข้อความเพื่อแก้ไข'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'), h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: run }, 'บันทึก PDF')),
    st, res);
  const panel = h('div', { class: 'hidden' }, h('div', { class: 'editor-layout' }, edHost, side));
  const dz = dropzone({ accept: '.pdf', hint: 'เลือกเอกสารที่ต้องการเพิ่มข้อมูล', onFiles: load });
  root.append(dz, panel);
  const ed = createEditor(edHost, { onSelect: showSel, onEdit: editText });

  function todayThai() {
    const d = new Date();
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
  }
  const props = () => ({ size: +size.value || 14, color: color.value, bold: bold.checked, font: font.value });

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
    const p = { ...props(), size: Math.max(14, +size.value || 14), font: 'Sarabun' };
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
  // A4 width ≈ 595pt; we only need a rough scale so new text appears at its real size.
  function pageWidthPts() { return pageW; }

  function showSel(it) {
    res.innerHTML = '';
    selBox.innerHTML = '';
    selBox.classList.toggle('hidden', !it || it.kind !== 'text');
    if (!it || it.kind !== 'text') return;
    const ta = h('textarea', { rows: 2 }); ta.value = it.text;
    const sz = h('input', { type: 'number', min: 6, max: 96, value: it.props.size });
    const col = h('input', { type: 'color', value: it.props.color });
    const bd = h('input', { type: 'checkbox', checked: it.props.bold });
    const apply = async () => {
      const oldSize = it.props.size;
      it.text = ta.value || ' ';
      it.props = { ...it.props, size: +sz.value || oldSize, color: col.value, bold: bd.checked };
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

  function reset() { file = bytes = null; ed.clear(); res.innerHTML = ''; panel.classList.add('hidden'); dz.classList.remove('hidden'); }
  async function load([f]) {
    file = f; bytes = await readBytes(f);
    dz.classList.add('hidden'); panel.classList.remove('hidden');
    st.set('กำลังแสดงเอกสาร...');
    try {
      const doc = await window.PDFLib.PDFDocument.load(bytes);
      const p = doc.getPage(0); const r = p.getRotation().angle % 180;
      pageW = r ? p.getCropBox().height : p.getCropBox().width;
      await ed.load(bytes); st.set('');
    } catch (e) { st.error(e); }
  }
  async function run() {
    res.innerHTML = '';
    if (!ed.items().length) return st.set('ยังไม่ได้เพิ่มข้อมูล', 'err');
    try {
      st.set('กำลังบันทึก...');
      const out = await stampItems(bytes, ed.items());
      st.set('');
      res.append(resultBox(fmtSize(out.length), () => download(out, baseName(file.name) + '_filled.pdf')));
    } catch (e) { st.error(e); }
  }
}
