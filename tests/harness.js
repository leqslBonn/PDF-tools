// End-to-end test harness — run in the browser console on the local dev server:
//   const T = await import('/tests/harness.js'); await T.runAll()
// Drives every tool through its real UI with generated files and checks the downloaded output.
// Not part of the site (the build doesn't copy /tests).

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export async function until(fn, ms = 30000) {
  const t = performance.now();
  while (performance.now() - t < ms) { const v = fn(); if (v) return v; await sleep(100); }
  throw new Error('timeout');
}
// a hidden browser pane pauses requestAnimationFrame, which pdf.js uses while rendering
window.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0);
window.confirm = () => true;
const caught = [];
const oc = URL.createObjectURL;
URL.createObjectURL = (b) => { caught.push(b); return oc(b); };
HTMLAnchorElement.prototype.click = function () {};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const btn = (t) => $$('#app button').find(b => b.textContent.trim() === t);
const segb = (t) => $$('#app .seg button').find(b => b.textContent.includes(t));
const last = async () => new Uint8Array(await caught.at(-1).arrayBuffer());
async function dl() {
  const n = caught.length;
  $$('#app .result button').pop().click();
  await sleep(400);
  if (caught.length === n) throw new Error('no download');
  return last();
}
async function go(slug, files) {
  location.hash = '#/'; await sleep(150);
  location.hash = '#/' + slug;
  await until(() => $('#app .drop'));
  await sleep(200);
  if (files) $('#app .drop').parentElement.take(files);
  await sleep(800);
}
async function render(bytes, n = 1, s = 0.5) {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const pg = await pdf.getPage(n);
  const vp = pg.getViewport({ scale: s });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c;
}
const pix = (c, u, v) => [...c.getContext('2d').getImageData(c.width * u, c.height * v, 1, 1).data.slice(0, 3)];

export async function fixtures() {
  await go('merge'); // loads the libraries
  const { PDFDocument, StandardFonts, degrees } = PDFLib;
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const pc = document.createElement('canvas'); pc.width = 1800; pc.height = 1200;
  const px = pc.getContext('2d'); const id = px.createImageData(1800, 1200);
  for (let i = 0; i < id.data.length; i += 4) { id.data[i] = (i / 7) % 255; id.data[i + 1] = Math.random() * 255; id.data[i + 2] = 120; id.data[i + 3] = 255; }
  px.putImageData(id, 0, 0);
  const jpgBytes = Uint8Array.from(atob(pc.toDataURL('image/jpeg', 0.98).split(',')[1]), c => c.charCodeAt(0));
  const jpg = await d.embedJpg(jpgBytes);
  for (let i = 0; i < 4; i++) {
    const p = d.addPage([595, 842]);
    if (i === 3) p.setRotation(degrees(90));
    p.drawText('Page ' + (i + 1) + ' ID 1-2345-67890-12-3', { x: 60, y: 760, size: 20, font: f });
    if (i === 0) p.drawImage(jpg, { x: 50, y: 300, width: 495, height: 330 });
  }
  d.getForm().createTextField('fullname').addToPage(d.getPage(2), { x: 50, y: 300 });
  const pdfBytes = await d.save();
  const enc = async (user) => { const e = await PDFDocument.load(pdfBytes); await e.encrypt({ userPassword: user, ownerPassword: 'own', permissions: { modifying: false } }); return e.save({ useObjectStreams: false }); };
  const tp = document.createElement('canvas'); tp.width = 300; tp.height = 200;
  tp.getContext('2d').fillStyle = 'red'; tp.getContext('2d').fillRect(100, 50, 100, 100);
  const file = (b, n, t) => new File([b], n, { type: t });
  return {
    pdf: file(pdfBytes, 't.pdf', 'application/pdf'),
    owner: file(await enc(''), 'owner.pdf', 'application/pdf'),
    png: file(await (await fetch(tp.toDataURL())).blob(), 't.png', 'image/png'),
    jpg: file(await (await fetch(pc.toDataURL('image/jpeg', 0.95))).blob(), 'p.jpg', 'image/jpeg'),
  };
}

export async function runAll() {
  const F = await fixtures();
  const { PDFDocument } = PDFLib;
  const R = {};
  const t = async (name, fn) => { const t0 = performance.now(); try { R[name] = (await fn()) + ` (${((performance.now() - t0) / 1000).toFixed(1)}s)`; } catch (e) { R[name] = 'ERR ' + e.message; } };

  await t('merge', async () => {
    await go('merge', [F.pdf, F.owner]);
    await until(() => $$('.fitem .sub').filter(s => s.textContent.includes('หน้า')).length === 2);
    const b = btn('รวมไฟล์ PDF'); b.click(); b.click();
    await until(() => $('#app .result'));
    const o = await PDFDocument.load(await dl());
    return o.getPageCount() === 8 && $$('#app .result').length === 1 && o.getForm().getFields().length >= 1 ? 'ok' : 'FAIL';
  });
  await t('organize', async () => {
    await go('organize', [F.pdf]); await until(() => $$('.pg canvas').length === 4);
    const pgs = $$('.pg'); pgs[1].click(); pgs[0].querySelector('[title="หมุนขวา"]').click();
    btn('บันทึก PDF').click(); await until(() => $('#app .result'));
    const o = await PDFDocument.load(await dl());
    return o.getPageCount() === 3 && o.getPage(0).getRotation().angle === 90 && o.getForm().getFields().length === 1 ? 'ok' : 'FAIL';
  });
  await t('split', async () => {
    await go('split', [F.pdf]); await until(() => $$('.pg').length === 4);
    $$('.pg')[2].click(); btn('แยกไฟล์ PDF').click(); await until(() => $('#app .result'));
    const one = (await PDFDocument.load(await dl())).getPageCount();
    segb('แยกทุก').click(); btn('แยกไฟล์ PDF').click(); await until(() => $('#app .result'));
    $('#app .result button').click(); await sleep(500);
    const n = Object.keys((await JSZip.loadAsync(caught.at(-1))).files).length;
    return one === 1 && n === 4 ? 'ok' : `FAIL ${one} ${n}`;
  });
  await t('compress', async () => {
    await go('compress', [F.pdf]); await until(() => $('.fitem .name'));
    btn('ลดขนาด PDF').click(); await until(() => $('#app .result, #app .status.err:not(:empty)'), 60000);
    const a = (await dl()).length;
    segb('≤ 1 MB').click(); btn('ลดขนาด PDF').click(); await until(() => $('#app .result, #app .status.err:not(:empty)'), 60000);
    const b = (await dl()).length;
    return a < F.pdf.size && b <= 1048576 ? `ok ${F.pdf.size}→${a}, ≤1MB→${b}` : 'FAIL';
  });
  await t('image', async () => {
    await go('image', [F.pdf]); segb('JPEG').click(); btn('แปลงเป็นรูป').click();
    await until(() => $$('.pg canvas').length === 4, 60000);
    btn('⬇ ทั้งหมด (.zip)').click(); await sleep(1200);
    const n = Object.keys((await JSZip.loadAsync(caught.at(-1))).files).length;
    return n === 4 ? 'ok' : 'FAIL ' + n;
  });
  await t('image-compress', async () => {
    await go('image-compress', [F.jpg, F.png]); btn('บีบอัดรูป').click();
    await until(() => $$('.fitem .sub')[1]?.textContent.includes('→'));
    return $$('.fitem .sub').map(s => s.textContent.split('·')[0].trim()).join(' | ');
  });
  await t('jpg-to-pdf', async () => {
    await go('jpg-to-pdf', [F.png, F.jpg]); await until(() => $$('.pg img').length === 2);
    btn('สร้าง PDF').click(); await until(() => $('#app .result'));
    const b = await dl(); const c = await render(b);
    return (await PDFDocument.load(b)).getPageCount() === 2 && pix(c, 0.1, 0.5).join() === '255,255,255' && pix(c, 0.5, 0.5)[0] > 200 ? 'ok' : 'FAIL ' + pix(c, 0.1, 0.5);
  });
  await t('page-number', async () => {
    await go('page-number', [F.pdf]); await until(() => $$('.doc canvas').length === 2);
    btn('ใส่เลขหน้า').click(); await until(() => $('#app .result'));
    return (await PDFDocument.load(await dl())).getPageCount() === 4 ? 'ok' : 'FAIL';
  });
  await t('watermark', async () => {
    await go('watermark', [F.pdf]); await until(() => $('.doc canvas'));
    btn('ใส่ลายน้ำ').click(); await until(() => $('#app .result'));
    const c = await render(await dl(), 2); const px = pix(c, 0.5, 0.5);
    return px[0] > 200 && px[1] < 240 ? 'ok' : 'FAIL ' + px;
  });
  await t('crop', async () => {
    await go('crop', [F.pdf]); await until(() => $$('.cropbox').length === 4);
    btn('ครอบตัด PDF').click(); await until(() => $('#app .result'));
    const w = (await PDFDocument.load(await dl())).getPage(0).getCropBox().width;
    return Math.abs(w - 535.5) < 1 ? 'ok' : 'FAIL ' + w;
  });
  await t('protect+unlock', async () => {
    await go('protect', [F.pdf]); await until(() => $('.panel:not(.hidden) input[type=password]'));
    const pw = $$('input[type=password]'); pw[0].value = pw[1].value = 'abc';
    btn('🔒 ใส่รหัสผ่าน').click(); await until(() => $('#app .result'));
    const locked = await dl();
    let isLocked = false; try { await pdfjsLib.getDocument({ data: locked.slice() }).promise; } catch (e) { isLocked = e.name === 'PasswordException'; }
    await go('unlock', [new File([locked], 'l.pdf', { type: 'application/pdf' })]);
    await until(() => $('form.modal')); $('form.modal input').value = 'abc'; $('form.modal').requestSubmit();
    await until(() => $('#app .result'));
    const open = await dl(); await pdfjsLib.getDocument({ data: open.slice() }).promise;
    return isLocked ? 'ok' : 'FAIL';
  });
  await t('scan', async () => {
    location.hash = '#/'; await sleep(150); location.hash = '#/scan'; await until(() => $('#app .drop'));
    const dt = new DataTransfer(); dt.items.add(F.jpg); dt.items.add(F.png);
    $('.drop').dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer: dt }));
    await until(() => $$('.pg canvas').length === 2, 60000);
    btn('สร้าง PDF').click(); await until(() => $('#app .result'), 60000);
    const b = await dl(); const c = await render(b, 2); const mid = pix(c, 0.5, 0.5);
    return (await PDFDocument.load(b)).getPageCount() === 2 && mid[0] > 200 && mid[1] < 80 ? 'ok' : 'FAIL ' + mid;
  });
  await t('redact', async () => {
    await go('redact', [F.pdf]); await until(() => $$('.page-wrap img').length === 4);
    btn('เลขบัตรประชาชน').click(); await until(() => $$('.item.redact').length >= 4);
    btn('ปิดข้อมูลและบันทึก').click(); await until(() => $('#app .result'), 60000);
    const b = await dl(); const pdf = await pdfjsLib.getDocument({ data: b.slice() }).promise;
    const txt = (await (await pdf.getPage(2)).getTextContent()).items.map(i => i.str).join('');
    return !/2345/.test(txt) ? 'ok' : 'FAIL ' + txt;
  });
  await t('fill', async () => {
    await go('fill', [F.pdf]); await until(() => $$('.fill-box').length === 1);
    const i = $('.fill-list input'); i.value = 'ทดสอบ'; i.dispatchEvent(new Event('input'));
    btn('บันทึก PDF').click(); await until(() => $('#app .result, #app .status.err:not(:empty)'));
    return $('#app .result') ? 'ok' : 'FAIL ' + $('#app .status.err').textContent;
  });
  await t('edit-text', async () => {
    await go('edit-text', [F.pdf]); await until(() => $$('.tline').length >= 3);
    $$('.tline').find(b => b.title.includes('Page 1')).click(); await sleep(600);
    const ta = $('.side textarea'); ta.value = 'Page one edited'; ta.dispatchEvent(new Event('input')); await sleep(300);
    btn('✓ ใช้').click(); await sleep(300);
    btn('บันทึก PDF').click(); await until(() => $('#app .result'));
    return (await PDFDocument.load(await dl())).getPageCount() === 4 ? 'ok' : 'FAIL';
  });
  await t('id-copy', async () => {
    location.hash = '#/'; await sleep(150); location.hash = '#/id-copy'; await until(() => $('#app input[type=file][capture]'));
    const inp = $('#app input[type=file][capture]'); const dt = new DataTransfer(); dt.items.add(F.jpg); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    await until(() => $('.corner-stage'));
    $$('.modal button').find(b => b.textContent === 'ตกลง').click(); await sleep(800);
    const p = $('.side input[type=text]'); p.value = 'ทดสอบ'; p.dispatchEvent(new Event('input'));
    btn('สร้างไฟล์สำเนา').click(); await until(() => $('#app .result'), 30000);
    return (await PDFDocument.load(await dl())).getPageCount() === 1 ? 'ok' : 'FAIL';
  });
  await t('sign', async () => {
    await go('sign', [F.pdf]); await until(() => $$('.page-wrap img').length === 4);
    btn('+ วันที่').click(); await sleep(700);
    btn('บันทึก PDF').click(); await until(() => $('#app .result'));
    return (await PDFDocument.load(await dl())).getPageCount() === 4 ? 'ok' : 'FAIL';
  });
  await t('form', async () => {
    await go('form', [F.pdf]); await until(() => $$('.page-wrap img').length === 4);
    $('.side textarea').value = 'สวัสดี'; btn('+ เพิ่มข้อความ').click(); await sleep(700);
    btn('บันทึก PDF').click(); await until(() => $('#app .result'));
    return (await PDFDocument.load(await dl())).getPageCount() === 4 ? 'ok' : 'FAIL';
  });
  location.hash = '#/';
  return R;
}
