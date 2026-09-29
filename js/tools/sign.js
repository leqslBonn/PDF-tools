import { h, dropzone, readBytes, statusBar, download, resultBox, fmtSize, baseName, seg, field, textToPng, imageToCanvas, canvasToBytes, pickFiles, toThaiDigits } from '../lib.js';
import { createEditor, stampItems } from '../editor.js';

const STORE = 'pdftk.signatures';
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } };
const saveSaved = (a) => { try { localStorage.setItem(STORE, JSON.stringify(a.slice(0, 6))); } catch { /* storage unavailable */ } };

/** Crop transparent/white borders from a canvas. */
export function trimCanvas(c, pad = 6) {
  const { width: w, height: hh } = c;
  const d = c.getContext('2d').getImageData(0, 0, w, hh).data;
  let x0 = w, y0 = hh, x1 = -1, y1 = -1;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3] > 20 && !(d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(hh - 1, y1 + pad);
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

/** Make near-white pixels transparent (for photographed signatures). */
export function removeWhite(c, threshold = 200) {
  const ctx = c.getContext('2d');
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (l >= threshold) d[i + 3] = 0;
    else if (l > threshold - 40) d[i + 3] = Math.round(255 * (threshold - l) / 40);
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

function signatureModal(onDone) {
  let mode = 'draw', color = '#1a237e', width = 3;
  const bg = h('div', { class: 'modal-bg' });
  const close = () => bg.remove();
  bg.onclick = (e) => { if (e.target === bg) close(); };

  // draw
  const pad = h('canvas', { class: 'sigpad' });
  let strokes = [], cur = null;
  const redraw = () => {
    const ctx = pad.getContext('2d');
    ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width * (devicePixelRatio || 1);
      ctx.beginPath();
      s.pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else { const q = s.pts[i - 1]; ctx.quadraticCurveTo(q[0], q[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
      });
      if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
      ctx.stroke();
    }
  };
  const sizePad = () => { const r = pad.getBoundingClientRect(); const d = devicePixelRatio || 1; pad.width = r.width * d; pad.height = r.height * d; redraw(); };
  const pt = (e) => { const r = pad.getBoundingClientRect(); const d = pad.width / r.width; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; };
  pad.onpointerdown = (e) => { pad.setPointerCapture(e.pointerId); cur = { color, width, pts: [pt(e)] }; strokes.push(cur); redraw(); };
  pad.onpointermove = (e) => { if (cur) { cur.pts.push(pt(e)); redraw(); } };
  pad.onpointerup = pad.onpointercancel = () => { cur = null; };
  const colors = h('div', { class: 'row' }, ...['#000000', '#1a237e', '#0d47a1', '#b71c1c'].map(c =>
    h('button', { type: 'button', class: 'btn sm', style: `width:30px;height:30px;padding:0;background:${c};border:2px solid #fff`, onclick: () => { color = c; } })),
  field('ความหนา', (() => { const r = h('input', { type: 'range', min: 1, max: 8, value: width }); r.oninput = () => width = +r.value; return r; })()),
  h('button', { class: 'btn sm', onclick: () => { strokes.pop(); redraw(); } }, '↶ ย้อน'),
  h('button', { class: 'btn sm', onclick: () => { strokes = []; redraw(); } }, 'ล้าง'));
  const drawPane = h('div', {}, pad, h('div', { style: 'margin-top:10px' }, colors));

  // upload
  let upCanvas = null;
  const upPrev = h('div', { style: 'background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/16px 16px;border-radius:10px;min-height:120px;display:grid;place-items:center;padding:10px' }, h('span', { style: 'color:#666' }, 'ยังไม่ได้เลือกรูป'));
  const rmWhite = h('input', { type: 'checkbox', checked: true });
  let upFile = null;
  const renderUp = async () => {
    if (!upFile) return;
    const c = await imageToCanvas(upFile, 1400);
    if (rmWhite.checked) removeWhite(c);
    upCanvas = trimCanvas(c) || c;
    upPrev.innerHTML = '';
    const im = h('img', { src: upCanvas.toDataURL(), style: 'max-width:100%;max-height:200px' });
    upPrev.append(im);
  };
  rmWhite.onchange = renderUp;
  const upPane = h('div', { class: 'hidden' },
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => { [upFile] = await pickFiles('image/png,image/jpeg,image/webp', false); renderUp(); } }, 'เลือกรูปลายเซ็น'),
      h('label', { class: 'check' }, rmWhite, 'ลบพื้นหลังสีขาว')),
    h('div', { style: 'margin-top:10px' }, upPrev));

  // type
  const tIn = h('input', { type: 'text', placeholder: 'พิมพ์ชื่อของคุณ', value: '' });
  const fonts = ['Charm', 'Srisakdi', 'Mali', 'Itim', 'Sarabun'];
  let font = fonts[0];
  const tPrev = h('div', { style: 'background:#fff;color:#1a237e;border-radius:10px;min-height:90px;display:grid;place-items:center;font-size:42px;padding:8px' });
  const updT = () => { tPrev.style.fontFamily = `"${font}"`; tPrev.style.color = color; tPrev.textContent = tIn.value || 'ลายเซ็น'; };
  tIn.oninput = updT;
  const typePane = h('div', { class: 'hidden' },
    field('ข้อความ', tIn),
    h('div', { class: 'row', style: 'margin-top:10px' }, field('แบบอักษร', seg(fonts.map(f => [f, f]), font, v => { font = v; updT(); }))),
    h('div', { style: 'margin-top:10px' }, tPrev));
  updT();

  const panes = { draw: drawPane, upload: upPane, type: typePane };
  const saveChk = h('input', { type: 'checkbox', checked: true });
  const modal = h('div', { class: 'modal' },
    h('h3', {}, 'สร้างลายเซ็น'),
    seg([['draw', '✍ วาด'], ['upload', '🖼 อัปโหลด'], ['type', '⌨ พิมพ์']], mode, v => { mode = v; for (const [k, p] of Object.entries(panes)) p.classList.toggle('hidden', k !== v); if (v === 'draw') sizePad(); if (v === 'type') updT(); }),
    h('div', { style: 'margin-top:12px' }, drawPane, upPane, typePane),
    h('div', { class: 'actions' },
      h('label', { class: 'check' }, saveChk, 'จำลายเซ็นไว้ในเครื่องนี้'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: close }, 'ยกเลิก'),
      h('button', { class: 'btn primary', onclick: done }, 'ใช้ลายเซ็นนี้')));
  bg.append(modal);
  document.body.append(bg);
  sizePad();

  async function done() {
    let c;
    if (mode === 'draw') { c = trimCanvas(pad, 8); if (!c) return alert('กรุณาวาดลายเซ็นก่อน'); }
    else if (mode === 'upload') { c = upCanvas; if (!c) return alert('กรุณาเลือกรูป'); }
    else { if (!tIn.value.trim()) return alert('กรุณาพิมพ์ข้อความ'); c = (await textToPng(tIn.value.trim(), { size: 48, font, color, scale: 3 })).canvas; c = trimCanvas(c, 10) || c; }
    const src = c.toDataURL('image/png');
    close();
    onDone({ src, aspect: c.width / c.height }, saveChk.checked);
  }
}

async function dataUrlBytes(url) { return new Uint8Array(await (await fetch(url)).arrayBuffer()); }

export default function (root) {
  let file, bytes;
  const st = statusBar();
  const res = h('div');
  const edHost = h('div');
  const savedEl = h('div', { class: 'saved-sigs' });
  const selInfo = h('div', { class: 'sub', style: 'font-size:13px;color:var(--muted)' }, 'คลิกลายเซ็นบนหน้าเอกสารเพื่อเลือก ลากเพื่อย้าย ลากจุดมุมขวาล่างเพื่อปรับขนาด');
  let dateDigits = 'arabic';
  const side = h('div', { class: 'panel side', style: 'margin-top:0' },
    h('h3', {}, 'ลายเซ็น'),
    h('button', { class: 'btn primary', style: 'width:100%', onclick: () => signatureModal(async (sig, remember) => {
      if (remember) { const a = loadSaved(); a.unshift(sig); saveSaved(a); drawSaved(); }
      place(sig);
    }) }, '+ สร้างลายเซ็นใหม่'),
    h('div', { style: 'margin:12px 0 6px;font-size:13px;color:var(--muted)' }, 'ลายเซ็นที่บันทึกไว้ (คลิกเพื่อวาง)'),
    savedEl,
    h('div', { style: 'margin:14px 0 6px;font-size:13px;color:var(--muted)' }, 'เพิ่มวันที่'),
    h('div', { class: 'row' }, seg([['arabic', '29/9/2569'], ['thai', '๒๙/๙/๒๕๖๙'], ['long', '29 ก.ย. 2569']], dateDigits, v => dateDigits = v),
      h('button', { class: 'btn sm', onclick: addDate }, '+ วันที่')),
    h('hr', { style: 'border-color:var(--line);margin:16px 0' }),
    selInfo,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: reset }, 'ไฟล์ใหม่'), h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: run }, 'บันทึก PDF')),
    st, res);
  const panel = h('div', { class: 'hidden' }, h('div', { class: 'editor-layout' }, edHost, side));
  const dz = dropzone({ accept: '.pdf', hint: 'เลือกเอกสารที่ต้องการเซ็น', onFiles: load });
  root.append(dz, panel);
  const ed = createEditor(edHost, { onSelect: () => { res.innerHTML = ''; } });
  drawSaved();

  function drawSaved() {
    savedEl.innerHTML = '';
    const a = loadSaved();
    if (!a.length) savedEl.append(h('span', { class: 'sub', style: 'font-size:13px;color:var(--muted)' }, '— ยังไม่มี —'));
    a.forEach((s, i) => savedEl.append(h('div', { class: 's', title: 'คลิกเพื่อวาง', onclick: () => place(s) },
      h('img', { src: s.src }),
      h('button', { class: 'del', style: 'display:block', onclick: (e) => { e.stopPropagation(); a.splice(i, 1); saveSaved(a); drawSaved(); } }, '×'))));
  }
  async function place(sig) {
    if (!bytes) return;
    ed.add({ src: sig.src, bytes: await dataUrlBytes(sig.src), type: 'png', aspect: sig.aspect }, { widthFrac: 0.28 });
  }
  async function addDate() {
    if (!bytes) return;
    const d = new Date(), y = d.getFullYear() + 543;
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    let s = dateDigits === 'long' ? `${d.getDate()} ${months[d.getMonth()]} ${y}` : `${d.getDate()}/${d.getMonth() + 1}/${y}`;
    if (dateDigits === 'thai') s = toThaiDigits(s);
    const t = await textToPng(s, { size: 14, color: '#1a237e' });
    const src = t.canvas.toDataURL();
    ed.add({ src, bytes: t.bytes, type: 'png', aspect: t.w / t.h }, { widthFrac: Math.min(0.5, t.w / 595) });
  }
  function reset() { file = bytes = null; ed.clear(); res.innerHTML = ''; panel.classList.add('hidden'); dz.classList.remove('hidden'); }
  async function load([f]) {
    file = f; bytes = await readBytes(f);
    dz.classList.add('hidden'); panel.classList.remove('hidden');
    st.set('กำลังแสดงเอกสาร...');
    try { await ed.load(bytes); st.set(''); } catch (e) { st.error(e); }
  }
  async function run() {
    res.innerHTML = '';
    if (!ed.items().length) return st.set('ยังไม่ได้วางลายเซ็น', 'err');
    try {
      st.set('กำลังบันทึก...');
      const out = await stampItems(bytes, ed.items());
      st.set('');
      res.append(resultBox(fmtSize(out.length), () => download(out, baseName(file.name) + '_signed.pdf')));
    } catch (e) { st.error(e); }
  }
}
