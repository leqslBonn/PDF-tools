import { h, dropzone, readPdf, busy, statusBar, download, resultBox, PL, fmtSize, baseName, field } from '../lib.js';

/** o: { userPassword, ownerPassword?, print, copy, modify } */
export async function protectPdf(bytes, o) {
  const doc = await PL().PDFDocument.load(bytes);
  await doc.encrypt({
    userPassword: o.userPassword,
    ownerPassword: o.ownerPassword || o.userPassword + '#owner#' + Math.random().toString(36).slice(2),
    permissions: {
      printing: o.print ? 'highResolution' : false,
      copying: !!o.copy,
      modifying: !!o.modify,
      annotating: !!o.modify,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: !!o.modify,
    },
  });
  return doc.save({ useObjectStreams: false });
}

export default function (root) {
  let file, bytes;
  const pw = h('input', { type: 'password', placeholder: 'รหัสผ่านสำหรับเปิดไฟล์', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', placeholder: 'พิมพ์รหัสผ่านอีกครั้ง', autocomplete: 'new-password' });
  const show = h('input', { type: 'checkbox' });
  show.onchange = () => { pw.type = pw2.type = show.checked ? 'text' : 'password'; };
  const owner = h('input', { type: 'password', placeholder: '(ไม่บังคับ) รหัสผ่านสำหรับแก้สิทธิ์', autocomplete: 'new-password' });
  const print = h('input', { type: 'checkbox', checked: true });
  const copy = h('input', { type: 'checkbox', checked: true });
  const modify = h('input', { type: 'checkbox', checked: true });
  const st = statusBar();
  const res = h('div');
  const info = h('div', { class: 'fitem' });
  const panel = h('div', { class: 'panel hidden' },
    info,
    h('div', { class: 'row', style: 'margin-top:14px' }, field('รหัสผ่าน', pw), field('ยืนยันรหัสผ่าน', pw2)),
    h('div', { class: 'row' }, h('label', { class: 'check' }, show, 'แสดงรหัสผ่าน')),
    h('details', { style: 'margin-top:14px' },
      h('summary', { style: 'cursor:pointer;color:var(--muted)' }, 'ตั้งค่าสิทธิ์เพิ่มเติม'),
      h('div', { class: 'row', style: 'margin-top:10px' }, field('รหัสผ่านเจ้าของ (Owner)', owner)),
      h('div', { class: 'row' },
        h('label', { class: 'check' }, print, 'อนุญาตให้พิมพ์'),
        h('label', { class: 'check' }, copy, 'อนุญาตให้คัดลอกข้อความ'),
        h('label', { class: 'check' }, modify, 'อนุญาตให้แก้ไข'))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'),
      h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: busy(run) }, '🔒 ใส่รหัสผ่าน')),
    st, res);
  const dz = dropzone({ accept: '.pdf', onFiles: load });
  root.append(dz, panel);

  let gen = 0;
  [pw, pw2, owner].forEach(i => i.addEventListener('input', () => { gen++; res.innerHTML = ''; }));
  [print, copy, modify].forEach(i => i.addEventListener('change', () => { gen++; res.innerHTML = ''; }));
  function reset() { gen++; file = null; res.innerHTML = ''; pw.value = pw2.value = owner.value = ''; panel.classList.add('hidden'); dz.classList.remove('hidden'); st.set(''); }
  async function load([f]) {
    st.set('กำลังอ่านไฟล์...');
    let r;
    try { r = await readPdf(f); } catch (e) { return st.error(e); }
    st.set(''); gen++; res.innerHTML = '';
    file = f; bytes = r.bytes;
    info.innerHTML = '';
    info.append(h('div', { class: 'meta' }, h('div', { class: 'name' }, f.name),
      h('div', { class: 'sub' }, fmtSize(f.size) + (r.unlocked ? ' · ไฟล์เดิมมีรหัสอยู่แล้ว จะถูกแทนด้วยรหัสใหม่' : ''))));
    dz.classList.add('hidden'); panel.classList.remove('hidden'); pw.focus();
  }
  async function run() {
    res.innerHTML = '';
    if (pw.value.length < 1) return st.set('กรุณากรอกรหัสผ่าน', 'err');
    if (pw.value !== pw2.value) return st.set('รหัสผ่านทั้งสองช่องไม่ตรงกัน', 'err');
    const my = gen, name = baseName(file.name) + '_protected.pdf';
    try {
      st.set('กำลังเข้ารหัส...');
      const out = await protectPdf(bytes, { userPassword: pw.value, ownerPassword: owner.value, print: print.checked, copy: copy.checked, modify: modify.checked });
      st.set('');
      if (my !== gen) return;
      res.append(resultBox(`เข้ารหัสแล้ว · ${fmtSize(out.length)}`, () => download(out, name)));
    } catch (e) { st.error(e); }
  }
}
