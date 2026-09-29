// Page editor shared by "sign" and "form": renders pages, lets the user place,
// drag and resize image items, then stamps them into the PDF.
import { h, PL, loadPdfJs, renderPage, pageGeom, drawVisual, savePdf, MAX_PREVIEW_PAGES, freeCanvas, onLeave, unsaved } from './lib.js';

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
export function createEditor(container, { onSelect, onEdit, onChange, onDrawRect } = {}) {
  const docEl = h('div', { class: 'doc' });
  container.append(docEl);
  let pages = []; // {wrap, overlay, vw, vh}
  let items = [];
  let selected = null;
  let current = 0;
  let io = null, loadGen = 0, drawMode = !!onDrawRect;
  const dirty = () => { unsaved.value = items.length > 0; onChange && onChange(); };
  // Release observers/renders when the user leaves the tool.
  onLeave(() => ed.destroy());

  const ed = {
    items: () => items,
    selected: () => selected,
    current: () => current,
    pageCount: () => pages.length,
    /** Visible width of page i in PDF points. */
    pagePts: (i = current) => (pages[i] ? pages[i].pts : 595),
    destroy() {
      loadGen++;
      if (io) { io.disconnect(); io = null; }
      docEl.innerHTML = ''; pages = []; items = []; selected = null;
      unsaved.value = false;
    },
    async load(bytes) {
      ed.destroy();
      const my = loadGen;
      const pdf = await loadPdfJs(bytes);
      const n = Math.min(pdf.numPages, MAX_PREVIEW_PAGES);
      const maxW = Math.min(820, Math.max(300, container.clientWidth - 40));
      for (let i = 0; i < n; i++) {
        if (my !== loadGen) { pdf.destroy(); return; }
        const pg = await pdf.getPage(i + 1);
        const pts = pg.getViewport({ scale: 1 }).width;
        const c = await renderPage(pdf, i + 1, { maxW, maxH: 5000 });
        const dpr = Math.min(2, devicePixelRatio || 1);
        const cssW = c.width / dpr;
        // A JPEG <img> uses far less memory than keeping every page canvas alive.
        const img = h('img', { src: c.toDataURL('image/jpeg', 0.88), alt: `หน้า ${i + 1}`, draggable: 'false', style: 'display:block;width:100%;height:auto' });
        const aspect = c.width / c.height;
        freeCanvas(c);
        const overlay = h('div', { class: 'overlay' });
        const wrap = h('div', { class: 'page-wrap', style: `width:${cssW}px` }, h('span', { class: 'plabel' }, `หน้า ${i + 1}`), img, overlay);
        const p = { wrap, overlay, aspect, pts };
        pages.push(p);
        wrap.addEventListener('pointerdown', (e) => { setCurrent(i); if (e.target === overlay) select(null); });
        if (onDrawRect) {
          overlay.style.touchAction = drawMode ? 'none' : '';
          overlay.addEventListener('pointerdown', (e) => { if (drawMode && e.target === overlay) drawRect(e, i); });
        }
        docEl.append(wrap);
      }
      if (pdf.numPages > n) docEl.append(h('div', { class: 'sub' }, `แสดง ${n} หน้าแรกจาก ${pdf.numPages} หน้า`));
      pdf.destroy();
      setCurrent(0);
      io = new IntersectionObserver((es) => {
        const vis = es.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (vis) setCurrent(pages.findIndex(p => p.wrap === vis.target));
      }, { threshold: [0.3, 0.6] });
      pages.forEach(p => io.observe(p.wrap));
    },
    /** Visual page aspect (width / height) of page i. */
    pageAspect: (i) => (pages[i] ? pages[i].aspect : 1),
    /** Drawing rectangles by dragging on empty page area (only when onDrawRect is given). */
    setDrawMode(on) { drawMode = !!on; pages.forEach(p => { p.overlay.style.touchAction = drawMode ? 'none' : ''; p.overlay.classList.toggle('drawing', drawMode); }); },
    /**
     * Add an item sized by desired width in fraction of page width (height from aspect),
     * or at an explicit rect {u,v,w,h} (fractions of the page).
     */
    add(it, { page = current, widthFrac = 0.3, pxAspect, rect, quiet = false } = {}) {
      const P = pages[page];
      if (!P) return null;
      if (rect) Object.assign(it, { page, ...rect, keepAspect: it.keepAspect ?? false });
      else {
        const aspect = pxAspect || it.aspect || 1; // width / height of the item image
        let w = widthFrac, hh = (w / aspect) * P.aspect;
        if (hh > 0.8) { hh = 0.8; w = hh * aspect / P.aspect; }
        Object.assign(it, { page, w, h: hh, u: it.u ?? (1 - w) / 2, v: it.v ?? (1 - hh) / 2, keepAspect: it.keepAspect ?? true });
      }
      items.push(it);
      mount(it);
      if (!quiet) { select(it); pages[page].wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      dirty();
      return it;
    },
    /** Replace an item's image (e.g. after editing text), keeping its top-left & height scale. */
    update(it, { bytes, type, src, aspect }) {
      const P = pages[it.page];
      Object.assign(it, { bytes, type, src });
      if (aspect) { it.w = it.h * aspect / P.aspect; it.aspect = aspect; }
      it.el.querySelector('img').src = src;
      place(it); dirty();
    },
    remove(it) { items = items.filter(x => x !== it); it.el.remove(); if (selected === it) select(null); dirty(); },
    clear() { items.forEach(i => i.el.remove()); items = []; select(null); dirty(); },
    /** Call after the user downloaded the result. */
    saved() { unsaved.value = false; },
    select,
  };

  /** Rubber-band a new rectangle on page i. */
  function drawRect(e, i) {
    e.preventDefault();
    select(null);
    const P = pages[i], R = P.overlay.getBoundingClientRect();
    const cl = (v) => Math.min(1, Math.max(0, v));
    const u0 = cl((e.clientX - R.left) / R.width), v0 = cl((e.clientY - R.top) / R.height);
    const ghost = h('div', { class: 'draw-ghost' });
    P.overlay.append(ghost);
    let r = { u: u0, v: v0, w: 0, h: 0 };
    const mv = (ev) => {
      const u1 = cl((ev.clientX - R.left) / R.width), v1 = cl((ev.clientY - R.top) / R.height);
      r = { u: Math.min(u0, u1), v: Math.min(v0, v1), w: Math.abs(u1 - u0), h: Math.abs(v1 - v0) };
      Object.assign(ghost.style, { left: r.u * 100 + '%', top: r.v * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      ghost.remove();
      if (r.w > 0.008 && r.h > 0.004) onDrawRect(i, r);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

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
    const del = h('button', { class: 'del', title: 'ลบรายการนี้', type: 'button' }, '×');
    it.el = h('div', { class: 'item' + (it.cls ? ' ' + it.cls : ''), tabindex: 0, role: 'group',
      'aria-label': 'รายการที่วางบนหน้า — ลูกศรเพื่อเลื่อน, Shift+ลูกศรเพื่อปรับขนาด, Delete เพื่อลบ' },
      h('img', { src: it.src, draggable: 'false', alt: '' }), rs, del);
    it.el.onfocus = () => { if (selected !== it) select(it); };
    it.el.onkeydown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ed.remove(it); return; }
      if (e.key === 'Enter') { onEdit && onEdit(it); return; }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const step = 0.005;
      if (e.shiftKey) {
        const w = Math.max(0.02, Math.min(1 - it.u, it.w + d[0] * step * 2 - d[1] * step * 2));
        const k = w / it.w;
        it.w = w; it.h = Math.min(1 - it.v, it.h * k);
      } else {
        it.u = Math.min(1 - it.w, Math.max(0, it.u + d[0] * step));
        it.v = Math.min(1 - it.h, Math.max(0, it.v + d[1] * step));
      }
      place(it); dirty();
    };
    del.onpointerdown = (e) => e.stopPropagation();
    del.onclick = (e) => { e.stopPropagation(); ed.remove(it); };
    it.el.ondblclick = () => onEdit && onEdit(it);
    pages[it.page].overlay.append(it.el);
    place(it);
    const drag = (e, mode) => {
      e.preventDefault(); e.stopPropagation();
      select(it);
      it.el.focus({ preventScroll: true });
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
        place(it); dirty();
      };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    };
    it.el.onpointerdown = (e) => drag(e, 'move');
    rs.onpointerdown = (e) => drag(e, 'resize');
  }
  return ed;
}
