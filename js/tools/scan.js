import { h, statusBar, download, resultBox, fmtSize, seg, field, imageToCanvas, pickFiles, toast, flattenWhite } from '../lib.js';
import { warpPerspective, rotateCanvas, applyFilter } from '../scan-core.js';
import { imagesToPdf } from './jpg-to-pdf.js';

const FILTERS = [['color', 'ลบเงา (สี)'], ['gray', 'ขาวดำ (เทา)'], ['bw', 'ขาว-ดำ คมชัด'], ['original', 'ต้นฉบับ']];

function fullQuad(c, inset = 0) {
  const x = c.width * inset, y = c.height * inset;
  return [[x, y], [c.width - x, y], [c.width - x, c.height - y], [x, c.height - y]];
}

/** Modal for dragging the 4 document corners. */
function cornerModal(item, onDone) {
  const quad = item.quad.map(p => [...p]);
  const src = item.orig;
  const disp = document.createElement('canvas');
  const k = Math.min(1, 1400 / Math.max(src.width, src.height));
  disp.width = src.width * k; disp.height = src.height * k;
  disp.getContext('2d').drawImage(src, 0, 0, disp.width, disp.height);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${src.width} ${src.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('fill', 'rgba(91,140,255,.18)'); poly.setAttribute('stroke', '#5b8cff'); poly.setAttribute('stroke-width', Math.max(src.width, src.height) / 300);
  svg.append(poly);
  const stage = h('div', { class: 'corner-stage' }, disp, svg);
  const handles = quad.map((p, i) => {
    const el = h('div', { class: 'hdl' });
    el.onpointerdown = (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const R = disp.getBoundingClientRect();
        quad[i] = [Math.min(src.width, Math.max(0, (ev.clientX - R.left) / R.width * src.width)), Math.min(src.height, Math.max(0, (ev.clientY - R.top) / R.height * src.height))];
        draw();
      };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    };
    stage.append(el);
    return el;
  });
  function draw() {
    poly.setAttribute('points', quad.map(p => p.join(',')).join(' '));
    handles.forEach((el, i) => { el.style.left = quad[i][0] / src.width * 100 + '%'; el.style.top = quad[i][1] / src.height * 100 + '%'; });
  }
  draw();
  const bg = h('div', { class: 'modal-bg' });
  const close = () => bg.remove();
  bg.append(h('div', { class: 'modal', style: 'width:min(900px,100%);text-align:center' },
    h('h3', { style: 'text-align:left' }, 'ครอบมุมเอกสาร — ลากจุดทั้ง 4 ไปที่มุมกระดาษ'),
    stage,
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm', onclick: () => { fullQuad(src).forEach((p, i) => quad[i] = p); draw(); } }, 'ใช้ทั้งภาพ'),
      h('button', { class: 'btn sm', onclick: () => { fullQuad(src, 0.08).forEach((p, i) => quad[i] = p); draw(); } }, 'รีเซ็ต'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: close }, 'ยกเลิก'),
      h('button', { class: 'btn primary', onclick: () => { close(); onDone(quad); } }, 'ตกลง'))));
  document.body.append(bg);
}

/** Full-screen camera for rapid multi-shot capture. */
async function cameraModal(onShot) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
  } catch (e) {
    toast('เปิดกล้องไม่ได้: ' + (e.name === 'NotAllowedError' ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง' : e.message), 4000);
    return;
  }
  let n = 0;
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  video.srcObject = stream;
  const count = h('div', { class: 'count' }, 'ถ่ายแล้ว 0 ภาพ');
  const flash = h('div', { class: 'flash' });
  const stop = () => { stream.getTracks().forEach(t => t.stop()); cam.remove(); flash.remove(); };
  const cam = h('div', { class: 'cam' }, video,
    h('div', { class: 'bar' }, count,
      h('button', { class: 'shutter', title: 'ถ่าย', onclick: shoot }),
      h('button', { class: 'btn primary', onclick: stop }, 'เสร็จสิ้น')));
  document.body.append(cam, flash);
  function shoot() {
    if (!video.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    flash.style.opacity = '.8'; setTimeout(() => flash.style.opacity = '0', 120);
    n++; count.textContent = `ถ่ายแล้ว ${n} ภาพ`;
    onShot(c);
  }
}

export default function (root) {
  let items = []; // {orig, quad, rot, filter, out}
  let defFilter = 'color', size = 'a4';
  const list = h('div', { class: 'pages' });
  const st = statusBar();
  const res = h('div');
  const oneShot = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
  oneShot.onchange = () => { addFiles([...oneShot.files]); oneShot.value = ''; };

  const bigBtn = (icon, title, onclick) => h('button', { class: 'btn scan-opt', style: 'flex-direction:column;padding:16px 10px;flex:1;min-width:140px', onclick },
    h('span', { style: 'font-size:28px' }, icon), h('span', {}, title));
  const drop = h('div', { class: 'drop scan-drop', style: 'cursor:default' },
    h('div', { class: 'big' }, 'ถ่ายเอกสาร หรือลากรูปมาวางได้เลย 📄✨'),
    h('div', { class: 'row', style: 'justify-content:center;margin-top:14px' },
      bigBtn('📷', 'ถ่ายทีละภาพ', () => oneShot.click()),
      bigBtn('📸', 'ถ่ายหลายภาพรวด', () => cameraModal((c) => addCanvas(c))),
      bigBtn('🖼', 'เลือกจากเครื่อง', async () => addFiles(await pickFiles('image/jpeg,image/png,image/webp')))),
    h('div', { class: 'small', style: 'margin-top:12px' }, 'รับไฟล์ .jpg และ .png — ถ่ายหรือเลือกได้หลายภาพพร้อมกัน'), oneShot);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))); };

  const panel = h('div', { class: 'panel hidden' },
    h('div', { class: 'row' },
      field('ฟิลเตอร์ (ทุกหน้า)', seg(FILTERS, defFilter, v => { defFilter = v; items.forEach(i => { i.filter = v; i.out = null; }); draw(); })),
      field('ขนาดหน้า', seg([['a4', 'A4'], ['letter', 'Letter'], ['fit', 'ตามขนาดภาพ']], size, v => size = v))),
    h('div', { class: 'sub', style: 'font-size:13px;color:var(--muted);margin:10px 0' }, 'คลิกที่หน้าเพื่อครอบมุมเอกสาร · ลากเพื่อสลับลำดับ'),
    list,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => oneShot.click() }, '📷 ถ่ายเพิ่ม'),
      h('button', { class: 'btn', onclick: () => cameraModal((c) => addCanvas(c)) }, '📸 ถ่ายรวด'),
      h('button', { class: 'btn', onclick: async () => addFiles(await pickFiles('image/jpeg,image/png,image/webp')) }, '🖼 เพิ่มรูป'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: run }, 'สร้าง PDF')),
    st, res);
  root.append(drop, panel);
  new Sortable(list, { animation: 150, filter: '.btn', delay: 120, delayOnTouchOnly: true,
    onEnd: (e) => { const [m] = items.splice(e.oldIndex, 1); items.splice(e.newIndex, 0, m); draw(); } });

  async function addFiles(files) {
    for (const f of files) {
      try { addCanvas(await imageToCanvas(f, 2600), false); } catch { toast('อ่านรูปไม่ได้: ' + f.name); }
    }
    draw();
  }
  function addCanvas(c, redraw = true) {
    let orig = flattenWhite(c);
    if (Math.max(c.width, c.height) > 2600) {
      const k = 2600 / Math.max(c.width, c.height);
      orig = document.createElement('canvas'); orig.width = c.width * k; orig.height = c.height * k;
      orig.getContext('2d').drawImage(flattenWhite(c), 0, 0, orig.width, orig.height);
    }
    items.push({ orig, quad: fullQuad(orig), rot: 0, filter: defFilter, out: null });
    if (redraw) draw();
  }
  function process(it) {
    if (!it.out) it.out = applyFilter(rotateCanvas(warpPerspective(it.orig, it.quad), it.rot), it.filter);
    return it.out;
  }
  async function draw() {
    res.innerHTML = '';
    panel.classList.toggle('hidden', !items.length);
    drop.classList.toggle('hidden', !!items.length);
    list.innerHTML = '';
    const tiles = items.map((it, i) => {
      const cv = h('div', { class: 'cv' }, h('span', { class: 'sub' }, '…'));
      const fsel = h('select', { style: 'margin-top:6px;padding:3px 6px;font-size:12px', onclick: (e) => e.stopPropagation() },
        ...FILTERS.map(([v, l]) => h('option', { value: v, selected: v === it.filter }, l)));
      fsel.onchange = () => { it.filter = fsel.value; it.out = null; draw(); };
      const t = h('div', { class: 'pg' }, cv, h('div', { class: 'num' }, `หน้า ${i + 1}`), fsel,
        h('div', { class: 'tools' },
          h('button', { class: 'btn sm icon', title: 'ครอบมุม', onclick: (e) => { e.stopPropagation(); edit(it); } }, '⌗'),
          h('button', { class: 'btn sm icon', title: 'หมุน', onclick: (e) => { e.stopPropagation(); it.rot = (it.rot + 90) % 360; it.out = null; draw(); } }, '⟳'),
          h('button', { class: 'btn sm icon danger', title: 'ลบ', onclick: (e) => { e.stopPropagation(); items.splice(i, 1); draw(); } }, '✕')));
      t.onclick = () => edit(it);
      list.append(t);
      return { t, cv, it };
    });
    for (const { cv, it } of tiles) {
      await new Promise(r => setTimeout(r, 0));
      const o = process(it);
      const th = document.createElement('canvas');
      const k = Math.min(260 / o.width, 300 / o.height);
      th.width = o.width * k; th.height = o.height * k;
      th.getContext('2d').drawImage(o, 0, 0, th.width, th.height);
      cv.innerHTML = ''; cv.append(th);
    }
  }
  function edit(it) { cornerModal(it, (q) => { it.quad = q; it.out = null; draw(); }); }
  async function run() {
    res.innerHTML = '';
    if (!items.length) return;
    try {
      st.set('กำลังสร้าง PDF...'); st.progress(0.3);
      const out = await imagesToPdf(items.map(it => ({ canvas: process(it) })), { size, orient: 'auto', margin: 0, quality: 0.85 });
      st.progress(null); st.set('');
      const d = new Date();
      const name = `scan_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.pdf`;
      res.append(resultBox(`${items.length} หน้า · ${fmtSize(out.length)}`, () => download(out, name)));
    } catch (e) { st.error(e); }
  }
}
