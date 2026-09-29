import { TOOLS } from './registry.js';
import { h, runLeave, unsaved, loadLibs } from './lib.js';

const app = document.getElementById('app');

/* ---------- light / dark toggle ---------- */
function currentTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
const themeBtn = document.getElementById('themeBtn');
if (themeBtn) themeBtn.onclick = () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('pdftk-theme', next); } catch (e) { /* storage blocked: theme lasts for this visit */ }
};

const HERO_ART = `<svg class="hero-art" viewBox="0 0 240 220" aria-hidden="true">
  <defs>
    <linearGradient id="ha1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#7c3aed"/></linearGradient>
    <linearGradient id="ha2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f9a8d4"/><stop offset="1" stop-color="#ec4899"/></linearGradient>
  </defs>
  <g class="float b"><rect x="118" y="26" width="92" height="118" rx="14" fill="url(#ha2)" transform="rotate(12 164 85)"/></g>
  <g class="float">
    <rect x="40" y="40" width="112" height="144" rx="16" fill="#fff" stroke="#e4dff3" stroke-width="2"/>
    <rect x="40" y="40" width="112" height="34" rx="16" fill="url(#ha1)"/><rect x="40" y="58" width="112" height="16" fill="url(#ha1)"/>
    <text x="96" y="64" text-anchor="middle" font-family="Kanit, sans-serif" font-weight="700" font-size="16" fill="#fff">PDF</text>
    <rect x="56" y="90" width="80" height="8" rx="4" fill="#ede9fe"/><rect x="56" y="106" width="64" height="8" rx="4" fill="#ede9fe"/>
    <rect x="56" y="122" width="72" height="8" rx="4" fill="#ede9fe"/>
    <path d="M60 160c8-10 14-18 18-12s-6 14 2 12 10-10 14-6 4 8 12 4" fill="none" stroke="#7c3aed" stroke-width="3" stroke-linecap="round"/>
  </g>
  <g class="float b"><circle cx="186" cy="170" r="26" fill="#22c55e"/><path d="M174 170l8 8 16-16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>
  <path class="spark" d="M24 30l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#f59e0b"/>
  <path class="spark b" d="M214 12l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#38bdf8"/>
  <circle class="spark b" cx="20" cy="150" r="5" fill="#f472b6"/>
</svg>`;

function privacyBox() {
  const li = (icon, title, text) => h('li', {}, h('span', { class: 'pv-ic' }, icon), h('div', {}, h('b', {}, title), h('span', {}, text)));
  return h('section', { class: 'privacy', id: 'privacy' },
    h('div', { class: 'pv-head' },
      h('div', { class: 'pv-shield' }, '🔒'),
      h('div', {},
        h('span', { class: 'pv-tag' }, '100% ในเครื่องคุณ'),
        h('h2', {}, 'เอกสารของคุณไม่ถูกส่งออกไปไหน'),
        h('p', {}, 'เว็บนี้ไม่มีเซิร์ฟเวอร์รับไฟล์ ทุกเครื่องมือทำงานในเบราว์เซอร์บนเครื่องที่คุณใช้อยู่ ไฟล์จึงไม่ถูกอัปโหลด ไม่ถูกเก็บ และไม่มีใครเห็นนอกจากคุณ'))),
    h('ul', {},
      li('📂', 'ตอนเลือกไฟล์', 'เบราว์เซอร์อ่านไฟล์เข้าหน่วยความจำของเครื่องคุณเท่านั้น ปิดแท็บแล้วข้อมูลหายไปทันที'),
      li('⚙️', 'ตอนประมวลผล', 'รวม แยก บีบอัด ใส่รหัสผ่าน หรือเซ็นชื่อ ทำในเครื่องคุณทั้งหมด ไม่มีการส่งไฟล์ผ่านอินเทอร์เน็ต'),
      li('⬇️', 'ตอนดาวน์โหลด', 'ไฟล์ผลลัพธ์ถูกสร้างในเครื่องและบันทึกลงโฟลเดอร์ดาวน์โหลดของคุณโดยตรง'),
      li('✍️', 'ลายเซ็นที่บันทึกไว้', 'ถ้าเลือก "จำลายเซ็น" จะเก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น ลบได้ทุกเมื่อ'),
    ),
    h('details', {},
      h('summary', {}, 'สิ่งที่เชื่อมต่ออินเทอร์เน็ต และวิธีตรวจสอบด้วยตัวเอง'),
      h('p', {}, 'เว็บนี้เชื่อมต่ออินเทอร์เน็ตเฉพาะตอนเปิดหน้าเว็บ เพื่อดาวน์โหลดตัวโปรแกรมและฟอนต์จากเว็บนี้เอง (ไม่เรียกใช้บริการภายนอก เช่น Google) และไม่มีการส่งเนื้อหาเอกสารของคุณออกไป'),
      h('p', {}, 'ตรวจสอบเองได้ 2 วิธี: (1) กด F12 เปิดแท็บ Network แล้วลองใช้เครื่องมือ จะไม่พบการส่งไฟล์ออกไป (2) เปิดหน้าเว็บจนโหลดเสร็จ แล้วปิด Wi-Fi หรือเน็ต เครื่องมือทุกตัวยังใช้งานได้')),
  );
}

/* ---------- install as app (PWA) ---------- */
let installPrompt = null;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  document.querySelectorAll('.install-btn').forEach(b => { b.hidden = false; });
});
window.addEventListener('appinstalled', () => document.querySelectorAll('.install-btn').forEach(b => b.remove()));

function iosInstallHelp() {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } });
  bg.append(h('div', { class: 'modal', style: 'width:min(420px,100%)' },
    h('h3', {}, '📲 ติดตั้งเป็นแอปบน iPhone / iPad'),
    h('ol', { style: 'margin:0 0 8px;padding-left:22px;line-height:1.9' },
      h('li', {}, 'เปิดหน้านี้ด้วย Safari'),
      h('li', {}, 'แตะปุ่ม แชร์ ', h('b', {}, '(สี่เหลี่ยมมีลูกศรชี้ขึ้น ⬆︎)')),
      h('li', {}, 'เลือก ', h('b', {}, '"เพิ่มไปยังหน้าจอโฮม"'), ' แล้วแตะ "เพิ่ม"')),
    h('p', { style: 'margin:0;color:var(--muted);font-size:14px' }, 'จากนั้นเปิดจากไอคอนบนหน้าจอได้เลย ใช้งานได้แม้ไม่มีอินเทอร์เน็ต'),
    h('div', { class: 'actions' }, h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => bg.remove() }, 'เข้าใจแล้ว'))));
  document.body.append(bg);
}
function installButton() {
  if (isStandalone()) return null;
  const b = h('button', { class: 'pill install-btn', type: 'button', hidden: !(installPrompt || isIOS),
    onclick: async () => {
      if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; b.hidden = true; }
      else iosInstallHelp();
    } }, '📲 ติดตั้งเป็นแอป');
  return b;
}

function renderHome() {
  document.title = 'PDF Toolkit';
  app.style.removeProperty('--c');
  app.innerHTML = '';
  const privacy = privacyBox();
  app.append(
    h('section', { class: 'hero' },
      h('div', {},
        h('span', { class: 'hero-kicker' }, '✨ ฟรี · ไม่ต้องสมัคร · ไม่ต้องลงแอป'),
        h('h1', {}, 'งาน PDF ที่ว่าวุ่น ', h('span', { class: 'grad-text' }, 'จบในแท็บเดียว')),
        h('p', {}, 'สแกนจากมือถือ รวม-แยกไฟล์ จัดหน้า บีบให้เล็ก แปลงรูป ใส่เลขหน้า ลายน้ำ รหัสผ่าน และเซ็นชื่อ — ทำบนเครื่องคุณเองทั้งหมด ไม่ต้องติดตั้งโปรแกรม ไม่ต้องสมัครสมาชิก'),
        h('div', { class: 'pills' },
          h('span', { class: 'pill' }, h('span', { class: 'dot' }), `เครื่องมือ ${TOOLS.length} รายการ`),
          h('button', { class: 'pill', type: 'button', onclick: () => privacy.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, '🔒 ไฟล์ไม่ออกจากเครื่องคุณ'),
          h('span', { class: 'pill' }, '📱 ใช้ได้ทั้งมือถือและคอม'),
          installButton(),
        ),
      ),
      h('div', { class: 'hero-art-wrap', html: HERO_ART }),
    ),
    h('div', { class: 'sec-head' }, h('h2', {}, 'วันนี้จะทำอะไรดี?'), h('span', {}, 'แตะเพื่อเริ่มได้เลย')),
    h('div', { class: 'grid' },
      ...TOOLS.map((t, i) => h('a', { class: 'tool-card' + (t.feat ? ' feat' : ''), href: `#/${t.slug}`, style: `--c:${t.color};--i:${i}` },
        h('div', { class: 'tool-icon', html: t.icon }),
        h('div', { class: 'txt' },
          h('h3', {}, t.title, t.tag ? h('span', { class: 'badge' }, t.tag) : null),
          h('p', {}, t.desc)),
        h('span', { class: 'go', 'aria-hidden': 'true' }, '→'),
      )),
    ),
    privacy,
  );
}

async function renderTool(tool) {
  document.title = `${tool.title} — PDF Toolkit`;
  app.style.setProperty('--c', tool.color);
  app.innerHTML = '';
  const body = h('div');
  app.append(
    h('a', { class: 'back', href: '#/' }, '← เครื่องมือทั้งหมด'),
    h('div', { class: 'tool-head' },
      h('div', { class: 'tool-icon', html: tool.icon }),
      h('div', {}, h('h1', {}, tool.title), h('p', {}, tool.desc)),
    ),
    body,
  );
  try {
    const wait = h('div', { class: 'status' }, 'กำลังเตรียมเครื่องมือ...');
    body.append(wait);
    const [mod] = await Promise.all([import(`./tools/${tool.slug}.js`), loadLibs(tool.libs)]);
    wait.remove();
    if (!body.isConnected) return; // user already navigated away
    mod.default(body);
  } catch (e) {
    console.error(e);
    body.append(h('div', { class: 'status err' }, 'โหลดเครื่องมือไม่สำเร็จ: ' + e.message));
  }
}

let currentHash = location.hash;
function route() {
  if (location.hash === currentHash && app.childElementCount) return;
  if (unsaved.value && !confirm('มีงานที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) {
    history.replaceState(null, '', currentHash || '#/');
    return;
  }
  currentHash = location.hash;
  runLeave();
  const slug = location.hash.replace(/^#\/?/, '').split('?')[0];
  const tool = TOOLS.find(t => t.slug === slug);
  window.scrollTo(0, 0);
  if (tool) renderTool(tool); else renderHome();
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (unsaved.value) { e.preventDefault(); e.returnValue = ''; } });
// A file dropped outside a drop zone would make the browser open it and lose the user's work.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
route();

/* ---------- offline support: service worker ----------
 * Skipped on localhost so development always sees fresh files (add ?sw to test it locally). */
const devHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !/[?&]sw\b/.test(location.search);
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !devHost) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  const offerUpdate = (worker) => {
    if (document.querySelector('.update-toast')) return;
    const bar = h('div', { class: 'toast update-toast', role: 'status' }, '✨ มีเวอร์ชันใหม่ ',
      h('button', { class: 'btn sm primary', style: 'margin-left:8px', onclick: () => {
        if (unsaved.value && !confirm('มีงานที่ยังไม่ได้บันทึก โหลดเวอร์ชันใหม่ตอนนี้เลยหรือไม่?')) return;
        worker.postMessage('skipWaiting'); bar.remove();
      } }, 'อัปเดต'),
      h('button', { class: 'btn sm', style: 'margin-left:6px', onclick: () => bar.remove() }, 'ภายหลัง'));
    document.body.append(bar);
  };
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w); });
    });
  }).catch((e) => console.warn('service worker not registered', e));
}

// Warm the font cache (self-hosted) so signature/stamp fonts also work offline later.
(window.requestIdleCallback || setTimeout)(() => {
  for (const f of ['Sarabun', 'Charm', 'Mali', 'Itim', 'Srisakdi']) {
    for (const w of ['400', '700']) document.fonts.load(`${w} 16px "${f}"`, 'กขabc๑').catch(() => {});
  }
});
