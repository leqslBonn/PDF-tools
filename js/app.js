import { TOOLS } from './registry.js';
import { h } from './lib.js';

const app = document.getElementById('app');

function privacyBox() {
  const li = (icon, title, text) => h('li', {}, h('span', { class: 'pv-ic' }, icon), h('div', {}, h('b', {}, title), h('span', {}, text)));
  return h('section', { class: 'privacy' },
    h('div', { class: 'pv-head' },
      h('div', { class: 'pv-shield' }, '🔒'),
      h('div', {},
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
      h('p', {}, 'การเชื่อมต่อมีแค่ตอนเปิดหน้าเว็บ คือโหลดตัวโปรแกรมของเว็บ และโหลดฟอนต์ภาษาไทยจาก Google Fonts ซึ่งไม่มีเนื้อหาเอกสารของคุณติดไปด้วย'),
      h('p', {}, 'ตรวจสอบเองได้ 2 วิธี: (1) กด F12 เปิดแท็บ Network แล้วลองใช้เครื่องมือ จะไม่พบการส่งไฟล์ออกไป (2) เปิดหน้าเว็บไว้แล้วปิด Wi-Fi หรือเน็ต เครื่องมือยังใช้งานได้ตามปกติ')),
  );
}

function renderHome() {
  document.title = 'PDF Toolkit';
  app.innerHTML = '';
  app.append(
    h('section', { class: 'hero' },
      h('h1', {}, 'ครบทุกงาน PDF จบในเบราว์เซอร์เดียว'),
      h('p', {}, 'สแกนเอกสารจากมือถือ รวม-แยกไฟล์ จัดหน้า บีบอัด แปลงรูป ใส่เลขหน้า ลายน้ำ รหัสผ่าน และเซ็นชื่อ — ทุกอย่างประมวลผลบนเครื่องของคุณเอง ไม่ต้องติดตั้งโปรแกรม ไม่ต้องสมัครสมาชิก'),
      h('div', { class: 'pills' },
        h('span', { class: 'pill' }, h('span', { class: 'dot' }), `เครื่องมือ ${TOOLS.length} รายการ`),
        h('span', { class: 'pill' }, '🔒 ไฟล์ไม่ออกจากเครื่องคุณ'),
        h('span', { class: 'pill' }, '📱 ใช้ได้ทั้งมือถือและคอมพิวเตอร์'),
      ),
    ),
    privacyBox(),
    h('div', { class: 'grid' },
      ...TOOLS.map(t => h('a', { class: 'tool-card', href: `#/${t.slug}`, style: `--c:${t.color}` },
        h('div', { class: 'tool-icon', html: t.icon }),
        h('div', {}, h('h3', {}, t.title), h('p', {}, t.desc)),
      )),
    ),
  );
}

async function renderTool(tool) {
  document.title = `${tool.title} — PDF Toolkit`;
  app.innerHTML = '';
  const body = h('div');
  app.append(
    h('a', { class: 'back', href: '#/' }, '← กลับไปเลือกเครื่องมือ'),
    h('div', { class: 'tool-head' },
      h('div', { class: 'tool-icon', style: `--c:${tool.color};background:${tool.color}`, html: tool.icon }),
      h('div', {}, h('h1', {}, tool.title), h('p', {}, tool.desc)),
    ),
    body,
  );
  try {
    const mod = await import(`./tools/${tool.slug}.js`);
    mod.default(body);
  } catch (e) {
    console.error(e);
    body.append(h('div', { class: 'status err' }, 'โหลดเครื่องมือไม่สำเร็จ: ' + e.message));
  }
}

function route() {
  const slug = location.hash.replace(/^#\/?/, '').split('?')[0];
  const tool = TOOLS.find(t => t.slug === slug);
  window.scrollTo(0, 0);
  if (tool) renderTool(tool); else renderHome();
}

window.addEventListener('hashchange', route);
route();
