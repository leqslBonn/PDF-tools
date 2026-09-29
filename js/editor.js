// Page editor shared by "sign" and "form": renders pages, lets the user place,
// drag and resize image items, then stamps them into the PDF.
import { h, PL, loadPdfJs, renderPage, pageGeom, drawVisual, savePdf, MAX_PREVIEW_PAGES } from './lib.js';

export async function stampItems(bytes, items) {
  const doc = await PL().PDFDocument.load(bytes);
  const pages = doc.getPages();
  const cache = new Map();
  for (const it of items) {
    const page = pages[it.page];
    if (!page) continue;
    let img = cache.get(it.bytes);
    if (!img) { img = it.type === 'jpg' ? await doc.embedJpg(it.bytes) : await doc.embedPng(it.bytes); cache.set(it.bytes, img); }
    const { vw, vh } = pageGeom(page);
    drawVisual(page, img, { cu: (it.u + it.w / 2) * vw, cv: (it.v + it.h / 2) * vh, w: it.w * vw, h: it.h * vh, opacity: it.opacity ?? 1 });
  }
  return savePdf(doc);
}

/**
 * createEditor(container, { onSelect(item|null), onEdit(item) })
 * item: { page, u, v, w, h (fractions of visual page), bytes, type:'png'|'jpg', src (url for display), keepAspect, ... }
 */
export function createEditor(container, { onSelect, onEdit } = {}) {
  const docEl = h('div', { class: 'doc' });
  container.append(docEl);
  let pages = []; // {wrap, overlay, vw, vh}
  let items = [];
  let selected = null;
  let current = 0;

  const ed = {
    items: () => items,
    selected: () => selected,
    current: () => current,
    pageCount: () => pages.length,
    async load(bytes) {
      docEl.innerHTML = ''; pages = []; items = []; selected = null;
      const pdf = await loadPdfJs(bytes);
      const n = Math.min(pdf.numPages, MAX_PREVIEW_PAGES);
      const maxW = Math.min(820, Math.max(300, container.clientWidth - 40));
      for (let i = 0; i < n; i++) {
        const c = await renderPage(pdf, i + 1, { maxW, maxH: 5000 });
        const dpr = devicePixelRatio || 1;
        c.style.width = c.width / dpr + 'px';
        const overlay = h('div', { class: 'overlay' });
        const wrap = h('div', { class: 'page-wrap', style: `width:${c.width / dpr}px` }, h('span', { class: 'plabel' }, `หน้า ${i + 1}`), c, overlay);
        const p = { wrap, overlay, aspect: c.width / c.height };
        pages.push(p);
        wrap.addEventListener('pointerdown', (e) => { setCurrent(i); if (e.target === overlay) select(null); });
        docEl.append(wrap);
      }
      if (pdf.numPages > n) docEl.append(h('div', { class: 'sub' }, `แสดง ${n} หน้าแรกจาก ${pdf.numPages} หน้า`));
      pdf.destroy();
      setCurrent(0);
      const io = new IntersectionObserver((es) => {
        const vis = es.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (vis) setCurrent(pages.findIndex(p => p.wrap === vis.target));
      }, { threshold: [0.3, 0.6] });
      pages.forEach(p => io.observe(p.wrap));
    },
    /** Add an item sized by desired width in fraction of page width (height from aspect). */
    add(it, { page = current, widthFrac = 0.3, pxAspect } = {}) {
      const P = pages[page];
      const aspect = pxAspect || it.aspect || 1; // width / height of the item image
      let w = widthFrac, hh = (w / aspect) * P.aspect;
      if (hh > 0.8) { hh = 0.8; w = hh * aspect / P.aspect; }
      Object.assign(it, { page, w, h: hh, u: it.u ?? (1 - w) / 2, v: it.v ?? (1 - hh) / 2, keepAspect: it.keepAspect ?? true });
      items.push(it);
      mount(it);
      select(it);
      pages[page].wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return it;
    },
    /** Replace an item's image (e.g. after editing text), keeping its top-left & height scale. */
    update(it, { bytes, type, src, aspect }) {
      const P = pages[it.page];
      Object.assign(it, { bytes, type, src });
      if (aspect) { it.w = it.h * aspect / P.aspect; it.aspect = aspect; }
      it.el.querySelector('img').src = src;
      place(it);
    },
    remove(it) { items = items.filter(x => x !== it); it.el.remove(); if (selected === it) select(null); },
    clear() { items.forEach(i => i.el.remove()); items = []; select(null); },
    select,
  };

  function setCurrent(i) {
    if (i < 0) return;
    current = i;
    pages.forEach((p, k) => p.wrap.classList.toggle('active', k === i));
  }
  function select(it) {
    selected = it;
    items.forEach(x => x.el.classList.toggle('sel', x === it));
    onSelect && onSelect(it);
  }
  function place(it) {
    Object.assign(it.el.style, { left: it.u * 100 + '%', top: it.v * 100 + '%', width: it.w * 100 + '%', height: it.h * 100 + '%' });
  }
  function mount(it) {
    const rs = h('div', { class: 'rs' });
    const del = h('button', { class: 'del', title: 'ลบ' }, '×');
    it.el = h('div', { class: 'item' }, h('img', { src: it.src, draggable: 'false' }), rs, del);
    del.onpointerdown = (e) => e.stopPropagation();
    del.onclick = (e) => { e.stopPropagation(); ed.remove(it); };
    it.el.ondblclick = () => onEdit && onEdit(it);
    pages[it.page].overlay.append(it.el);
    place(it);
    const drag = (e, mode) => {
      e.preventDefault(); e.stopPropagation();
      select(it);
      const R = pages[it.page].overlay.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY, s = { u: it.u, v: it.v, w: it.w, h: it.h };
      const mv = (ev) => {
        const dx = (ev.clientX - sx) / R.width, dy = (ev.clientY - sy) / R.height;
        if (mode === 'move') {
          it.u = Math.min(1 - it.w, Math.max(0, s.u + dx));
          it.v = Math.min(1 - it.h, Math.max(0, s.v + dy));
        } else {
          let w = Math.max(0.02, Math.min(1 - s.u, s.w + dx));
          let hh = it.keepAspect ? w * (s.h / s.w) : Math.max(0.01, s.h + dy);
          if (s.v + hh > 1) { hh = 1 - s.v; if (it.keepAspect) w = hh * (s.w / s.h); }
          it.w = w; it.h = hh;
        }
        place(it);
      };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    };
    it.el.onpointerdown = (e) => drag(e, 'move');
    rs.onpointerdown = (e) => drag(e, 'resize');
  }
  document.addEventListener('keydown', (e) => {
    if (!selected || !docEl.isConnected) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { ed.remove(selected); e.preventDefault(); }
  });
  return ed;
}
