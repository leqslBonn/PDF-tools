import { h, statusBar, download, resultBox, fmtSize, seg, field, imageToCanvas, pickFiles, toast, flattenWhite, canvasToBytes, freeCanvas, busy, onLeave, tick, unsaved } from '../lib.js';
import { warpAndFilter, rotateCanvas } from '../scan-core.js';
import { imagesToPdf } from './jpg-to-pdf.js';

const FILTERS = [['color', 'ลบเงา (สี)'], ['gray', 'ขาวดำ (เทา)'], ['bw', 'ขาว-ดำ คมชัด'], ['original', 'ต้นฉบับ']];
const MAX_FULL = 2600;   // stored photo (JPEG) long side
const PROXY = 1100;      // on-screen editing/thumbnail copy

/** Corners as fractions of the image: [tl,tr,br,bl]. */
export const fullQuad = (inset = 0) => [[inset, inset], [1 - inset, inset], [1 - inset, 1 - inset], [inset, 1 - inset]];
export const toPx = (quad, c) => quad.map(([x, y]) => [x * c.width, y * c.height]);

export function scaled(src, max) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Modal for dragging (or arrow-keying) the 4 document corners. */
export function cornerModal(item, onDone) {
  const quad = item.quad.map(p => [...p]);
  const src = item.proxy;
  const disp = scaled(src, 1400);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1 1');
  svg.setAttribute('preserveAspectRatio', 'none');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('fill', 'rgba(91,140,255,.18)'); poly.setAttribute('stroke', '#5b8cff');
  poly.setAttribute('stroke-width', '2'); poly.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(poly);
  const stage = h('div', { class: 'corner-stage' }, disp, svg);
  const names = ['มุมบนซ้าย', 'มุมบนขวา', 'มุมล่างขวา', 'มุมล่างซ้าย'];
  const cl = (v) => Math.min(1, Math.max(0, v));
  const handles = quad.map((p, i) => {
    const el = h('div', { class: 'hdl', tabindex: 0, role: 'slider', 'aria-label': names[i] + ' — ใช้ลูกศรเพื่อเลื่อน' });
    el.onpointerdown = (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      const mv = (ev) => {
        const R = disp.getBoundingClientRect();
        quad[i] = [cl((ev.clientX - R.left) / R.width), cl((ev.clientY - R.top) / R.height)];
        draw();
      };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    };
    el.onkeydown = (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.02 : 0.005;
      quad[i] = [cl(quad[i][0] + d[0] * step), cl(quad[i][1] + d[1] * step)];
      draw();
    };
    stage.append(el);
    return el;
  });
  function draw() {
    poly.setAttribute('points', quad.map(p => p.join(',')).join(' '));
    handles.forEach((el, i) => { el.style.left = quad[i][0] * 100 + '%'; el.style.top = quad[i][1] * 100 + '%'; });
  }
  draw();
  const bg = h('div', { class: 'modal-bg' });
  const close = () => { bg.remove(); freeCanvas(disp); };
  bg.append(h('div', { class: 'modal', style: 'width:min(900px,100%);text-align:center' },
    h('h3', { style: 'text-align:left' }, 'ครอบมุมเอกสาร — ลากจุดทั้ง 4 ไปที่มุมกระดาษ'),
    stage,
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm', onclick: () => { fullQuad().forEach((p, i) => quad[i] = p); draw(); } }, 'ใช้ทั้งภาพ'),
      h('button', { class: 'btn sm', onclick: () => { fullQuad(0.08).forEach((p, i) => quad[i] = p); draw(); } }, 'รีเซ็ต'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: close }, 'ยกเลิก'),
      h('button', { class: 'btn primary', onclick: () => { close(); onDone(quad); } }, 'ตกลง'))));
  document.body.append(bg);
  handles[0].focus({ preventScroll: true });
}

/** The live camera needs a secure page (https or localhost). */
const canUseCamera = () => window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;

/** Full-screen camera for rapid multi-shot capture. Returns a stop() function. */
async function cameraModal(onShot) {
  if (!canUseCamera()) { toast('เปิดกล้องสดไม่ได้บนหน้านี้ (ต้องเปิดเว็บผ่าน https) — ใช้ "ถ่ายทีละภาพ" แทนได้', 4500); return null; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
  } catch (e) {
    const why = { NotAllowedError: 'ไม่ได้รับอนุญาตให้ใช้กล้อง', NotFoundError: 'ไม่พบกล้องในเครื่องนี้', NotReadableError: 'กล้องถูกใช้งานโดยแอปอื่นอยู่' }[e.name] || 'เกิดข้อผิดพลาดกับกล้อง';
    toast('เปิดกล้องไม่ได้: ' + why, 4000);
    return null;
  }
  let n = 0;
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  video.srcObject = stream;
  const count = h('div', { class: 'count', 'aria-live': 'polite' }, 'ถ่ายแล้ว 0 ภาพ');
  const flash = h('div', { class: 'flash' });
  const stop = () => { stream.getTracks().forEach(t => t.stop()); cam.remove(); flash.remove(); };
  const cam = h('div', { class: 'cam' }, video,
    h('div', { class: 'bar' }, count,
      h('button', { class: 'shutter', title: 'ถ่ายภาพ', onclick: shoot }),
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
  return stop;
}

export default function (root) {
  // item: { blob (JPEG ≤2600px), proxy (canvas ≤1100px), quad (fractions), rot, filter, thumb (canvas|null) }
  let items = [];
  let defFilter = 'color', size = 'a4', gen = 0, drawGen = 0, lastEnd = 0, stopCam = null;
  onLeave(() => { if (stopCam) stopCam(); items = []; });
  const openCam = async () => { stopCam = await cameraModal((c) => addCanvas(c)); };
  const list = h('div', { class: 'pages' });
  const st = statusBar();
  const res = h('div');
  const oneShot = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
  oneShot.onchange = () => { addFiles([...oneShot.files]); oneShot.value = ''; };
  const camOk = !!canUseCamera();

  const bigBtn = (icon, title, onclick) => h('button', { class: 'btn scan-opt', style: 'flex-direction:column;padding:16px 10px;flex:1;min-width:140px', onclick },
    h('span', { style: 'font-size:28px', 'aria-hidden': 'true' }, icon), h('span', {}, title));
  const drop = h('div', { class: 'drop scan-drop', style: 'cursor:default' },
    h('div', { class: 'big' }, 'ถ่ายเอกสาร หรือลากรูปมาวางได้เลย 📄✨'),
    h('div', { class: 'row', style: 'justify-content:center;margin-top:14px' },
      bigBtn('📷', 'ถ่ายทีละภาพ', () => oneShot.click()),
      camOk ? bigBtn('📸', 'ถ่ายหลายภาพรวด', openCam) : null,
      bigBtn('🖼', 'เลือกจากเครื่อง', async () => addFiles(await pickFiles('image/jpeg,image/png,image/webp')))),
    h('div', { class: 'small', style: 'margin-top:12px' }, 'รับไฟล์ .jpg และ .png — ถ่ายหรือเลือกได้หลายภาพพร้อมกัน'), oneShot);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))); };

  const panel = h('div', { class: 'panel hidden' },
    h('div', { class: 'row' },
      field('ฟิลเตอร์ (ทุกหน้า)', seg(FILTERS, defFilter, v => { defFilter = v; items.forEach(i => { i.filter = v; i.thumb = null; }); draw(); })),
      field('ขนาดหน้า', seg([['a4', 'A4'], ['letter', 'Letter'], ['fit', 'ตามขนาดภาพ']], size, v => { size = v; gen++; res.innerHTML = ''; }))),
    h('div', { class: 'sub', style: 'font-size:13px;color:var(--muted);margin:10px 0' }, 'คลิกที่หน้าเพื่อครอบมุมเอกสาร · ลากเพื่อสลับลำดับ'),
    list,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => oneShot.click() }, '📷 ถ่ายเพิ่ม'),
      camOk ? h('button', { class: 'btn', onclick: openCam }, '📸 ถ่ายรวด') : null,
      h('button', { class: 'btn', onclick: async () => addFiles(await pickFiles('image/jpeg,image/png,image/webp')) }, '🖼 เพิ่มรูป'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: busy(run) }, 'สร้าง PDF')),
    st, res);
  root.append(drop, panel);
  // preventOnFilter:false — otherwise iOS Safari swallows taps on the tile buttons.
  new Sortable(list, { animation: 150, filter: '.btn, select', preventOnFilter: false, delay: 120, delayOnTouchOnly: true,
    onEnd: (e) => { lastEnd = Date.now(); const [m] = items.splice(e.oldIndex, 1); items.splice(e.newIndex, 0, m); draw(); } });

  async function addFiles(files) {
    const bad = [];
    for (let i = 0; i < files.length; i++) {
      st.set(`กำลังโหลดรูป ${i + 1}/${files.length}...`);
      try { await addCanvas(await imageToCanvas(files[i], MAX_FULL), false); } catch { bad.push(files[i].name); }
    }
    st.set(bad.length ? 'อ่านรูปไม่ได้: ' + bad.join(', ') : '', bad.length ? 'err' : '');
    draw();
  }
  async function addCanvas(c, redraw = true) {
    const full = scaled(c, MAX_FULL);           // also flattens transparency onto white
    freeCanvas(c);
    const blob = new Blob([await canvasToBytes(full, 'image/jpeg', 0.92)], { type: 'image/jpeg' });
    const proxy = scaled(full, PROXY);
    freeCanvas(full);
    items.push({ blob, proxy, quad: fullQuad(), rot: 0, filter: defFilter, thumb: null });
    unsaved.value = true;
    if (redraw) draw();
  }
  /** Low-res processed preview (from the proxy); the pixel work runs in the background worker. */
  async function preview(it) {
    if (!it.thumb) {
      const o = rotateCanvas(await warpAndFilter(it.proxy, toPx(it.quad, it.proxy), 900, it.filter), it.rot);
      it.thumb = scaled(o, 300);
      freeCanvas(o);
    }
    return it.thumb;
  }
  /** Full-resolution processed page, built only at export time. */
  async function fullPage(it) {
    const full = await imageToCanvas(it.blob);
    const out = await warpAndFilter(full, toPx(it.quad, full), 2200, it.filter);
    freeCanvas(full);
    return rotateCanvas(out, it.rot);
  }
  async function draw() {
    const my = ++drawGen;
    gen++;
    res.innerHTML = '';
    panel.classList.toggle('hidden', !items.length);
    drop.classList.toggle('hidden', !!items.length);
    if (!items.length) unsaved.value = false;
    list.innerHTML = '';
    const tiles = items.map((it, i) => {
      const cv = h('div', { class: 'cv' }, h('span', { class: 'sub' }, '…'));
      const fsel = h('select', { style: 'margin-top:6px;padding:3px 6px;font-size:12px', 'aria-label': `ฟิลเตอร์หน้า ${i + 1}`, onclick: (e) => e.stopPropagation() },
        ...FILTERS.map(([v, l]) => h('option', { value: v, selected: v === it.filter }, l)));
      fsel.onchange = () => { it.filter = fsel.value; it.thumb = null; draw(); };
      const t = h('div', { class: 'pg', tabindex: 0, role: 'button', 'aria-label': `หน้า ${i + 1} — กด Enter เพื่อครอบมุม` },
        cv, h('div', { class: 'num' }, `หน้า ${i + 1}`), fsel,
        h('div', { class: 'tools' },
          h('button', { class: 'btn sm icon', title: 'ครอบมุม', onclick: (e) => { e.stopPropagation(); edit(it); } }, '⌗'),
          h('button', { class: 'btn sm icon', title: 'หมุน 90°', onclick: (e) => { e.stopPropagation(); it.rot = (it.rot + 90) % 360; it.thumb = null; draw(); } }, '⟳'),
          h('button', { class: 'btn sm icon danger', title: 'ลบหน้านี้', onclick: (e) => { e.stopPropagation(); items.splice(i, 1); draw(); } }, '✕')));
      t.onclick = () => edit(it);
      t.onkeydown = (e) => { if (e.target === t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); edit(it); } };
      list.append(t);
      return { cv, it };
    });
    // Render thumbnails one by one; stop if a newer draw() started meanwhile.
    for (const { cv, it } of tiles) {
      await tick();
      if (my !== drawGen) return;
      const th = await preview(it);
      if (my !== drawGen) return;
      const c = document.createElement('canvas');
      c.width = th.width; c.height = th.height;
      c.getContext('2d').drawImage(th, 0, 0);
      cv.innerHTML = ''; cv.append(c);
    }
  }
  function edit(it) {
    if (Date.now() - lastEnd < 300) return; // the click that ends a drag-reorder
    cornerModal(it, (q) => { it.quad = q; it.thumb = null; draw(); });
  }
  async function run() {
    res.innerHTML = '';
    if (!items.length) return;
    const my = gen, snapshot = items.slice();
    try {
      st.set('กำลังสร้าง PDF...'); st.progress(0);
      const out = await imagesToPdf(snapshot.map(it => ({ getCanvas: () => fullPage(it) })),
        { size, orient: 'auto', margin: 0, quality: 0.85, onProgress: p => st.progress(p) });
      st.progress(null); st.set('');
      if (my !== gen) return;
      const d = new Date();
      const name = `scan_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.pdf`;
      res.append(resultBox(`${snapshot.length} หน้า · ${fmtSize(out.length)}`, () => { download(out, name); unsaved.value = false; }));
    } catch (e) { st.error(e); }
  }
}
