import { h, dropzone, readPdf, statusBar, download, resultBox, fmtSize, baseName } from '../lib.js';

export default function (root) {
  let gen = 0;
  const st = statusBar();
  const res = h('div');
  const dz = dropzone({ accept: '.pdf', multiple: true, hint: 'เลือกได้หลายไฟล์ — ถ้าไฟล์ต้องใช้รหัสเปิด ระบบจะถามรหัสทีละไฟล์', onFiles: load });
  root.append(
    dz,
    h('p', { class: 'note', style: 'margin-top:14px' },
      'ใช้ได้ 2 กรณี: ไฟล์ที่เปิดอ่านได้แต่ถูกล็อกห้ามแก้/ห้ามพิมพ์/ห้ามคัดลอก (ปลดให้ทันที) และไฟล์ที่ต้องใส่รหัสก่อนเปิด (ต้องรู้รหัส) — ใช้กับเอกสารของคุณเองหรือที่ได้รับอนุญาตเท่านั้น'),
    st, res);

  async function load(files) {
    const my = ++gen;
    res.innerHTML = '';
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      st.set(files.length > 1 ? `กำลังปลดรหัส ${i + 1}/${files.length}: ${f.name}` : `กำลังปลดรหัส ${f.name}...`);
      try {
        const r = await readPdf(f);
        if (my !== gen) return;
        if (!r.unlocked) {
          res.append(h('div', { class: 'status', style: 'margin-top:10px' }, `ℹ️ ${f.name} — ไฟล์นี้ไม่ได้ติดรหัสอยู่แล้ว ใช้งานได้เลย`));
          continue;
        }
        const name = baseName(f.name) + '_unlocked.pdf';
        res.append(resultBox(`${f.name} · ${r.pages} หน้า · ${fmtSize(r.bytes.length)} — ไม่มีรหัสแล้ว`, () => download(r.bytes, name)));
      } catch (e) {
        res.append(h('div', { class: 'status err', style: 'margin-top:10px' }, `${f.name}: ${e.message.startsWith('ต้องใส่รหัสผ่าน') ? 'ยกเลิก — ไม่ได้ใส่รหัส' : 'เปิดไฟล์ไม่ได้ (ไฟล์เสียหรือไม่ใช่ PDF)'}`));
      }
    }
    st.set('');
  }
}
