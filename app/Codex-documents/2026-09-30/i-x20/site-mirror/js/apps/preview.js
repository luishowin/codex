// Preview: opens image files, with real zoom, rotation, a markup toolbar
// (pen, shapes, text) and Export that writes a PNG copy next to the original.
import { el, esc, baseName, dirName, clamp } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import * as fs from '../core/fs.js';
import { notify } from '../shell/notify.js';
import { art } from '../core/photoart.js';

/* the drawn Preview icon: white document, photo, loupe */
const PREVIEW_ICON = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="pvbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfdff"/><stop offset="1" stop-color="#dfe4ee"/></linearGradient><linearGradient id="pvph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6db5f0"/><stop offset="1" stop-color="#2e7cd6"/></linearGradient></defs><rect x="5" y="5" width="90" height="90" rx="23" fill="url(#pvbg)"/><rect x="5.5" y="5.5" width="89" height="89" rx="22.5" fill="none" stroke="#000" stroke-opacity=".13"/><rect x="18" y="16" width="46" height="60" rx="6" fill="#fff" stroke="#c3c8d4"/><rect x="24" y="26" width="34" height="26" rx="3" fill="url(#pvph)"/><circle cx="31" cy="32" r="3.4" fill="#fff3b0"/><path d="M24 48l9-8 7 6 6-5 12 11v0H24z" fill="#1c5fa8" opacity=".8"/><rect x="24" y="60" width="30" height="4" rx="2" fill="#c9cdd6"/><rect x="24" y="68" width="22" height="4" rx="2" fill="#d7dae2"/><circle cx="62" cy="60" r="17" fill="#fff" opacity=".5"/><circle cx="62" cy="60" r="17" fill="none" stroke="#3a3f4a" stroke-width="4.5"/><path d="M73.5 71.5 84 82" stroke="#3a3f4a" stroke-width="6" stroke-linecap="round"/><circle cx="62" cy="60" r="12" fill="#8ec9f5" opacity=".55"/></svg>`;

/* which drawn-photo recipe an fs image maps to, by its icon palette */
const KIND_FOR = ['coast', 'mountain', 'forest', 'abstract'];
const hash = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

const imgFor = node => {
  /* exported copies carry real PNG/svg payloads; library files draw fresh art */
  if (node?.artKind) return { kind: 'art', svg: art(node.artKind, node.artSeed ?? 31) };
  const kind = KIND_FOR[(node?.palette ?? 0) % KIND_FOR.length];
  return { kind: 'art', svg: art(kind, 1009 + (hash(node?.name || '') % 400)) };
};

const MARK_COLORS = ['#d92b1f', '#0a6cff', '#1d9e3f', '#f5a400', '#111114', '#ffffff'];
const NW = 800, NH = 600;   /* the canvas space every image lives in */

const meta = {
  id: 'preview', name: 'Preview', icon: PREVIEW_ICON, dock: false,
  menus: () => {
    const pv = wm.byApp('preview').find(w => w === wm.focused)?._pv || wm.byApp('preview')[0]?._pv;
    return [
      { title: 'File', items: () => [
        { label: 'Export as PNG…', action: () => pv?.exportPNG() },
        { type: 'sep' },
        { label: 'Close', key: '⌘W', action: () => pv && wm.close(pv.win) },
      ] },
      { title: 'View', items: () => [
        { label: 'Zoom In', key: '⌘+', action: () => pv?.zoomBy(1.25) },
        { label: 'Zoom Out', key: '⌘-', action: () => pv?.zoomBy(0.8) },
        { label: 'Actual Size', key: '⌘0', action: () => pv?.actualSize() },
        { type: 'sep' },
        { label: 'Rotate Left', key: '⌘L', action: () => pv?.rotate(-90) },
        { label: 'Rotate Right', key: '⌘R', action: () => pv?.rotate(90) },
      ] },
      { title: 'Tools', items: () => [
        { label: 'Markup Toolbar', key: '⇧⌘A', action: () => pv?.toggleMarkup() },
      ] },
    ];
  },
  launch(opts = {}) {
    const path = opts.file || opts.path;
    if (path) {
      const existing = wm.byApp('preview').find(w => w.data?.file === path);
      if (existing) { wm.show(existing); return existing; }
    }
    const node = path ? fs.get(path) : null;
    const title = node ? node.name : 'Preview';
    return wm.open({
      app: 'preview', key: path || 'main', title,
      width: 760, height: 560, minWidth: 460, minHeight: 320,
      data: { file: path || null },
      getData: w => ({ file: w.data?.file }),
      build: win => new Preview(win, node, path).mount(),
      onClose: win => win._pv?.unmount(),
    });
  },
};

class Preview {
  constructor(win, node, path) {
    this.win = win;
    this.node = node || null;
    this.path = path || null;
    this.zoom = 0;            /* 0 means "fit to window" */
    this.rot = 0;
    this.marks = [];          /* annotation model, image coords */
    this.markup = false;
    this.tool = 'pen';
    this.color = MARK_COLORS[0];
  }
  unmount() { clearInterval(this._tick); }

  mount() {
    const win = this.win;
    win._pv = this;
    win.setTitle(this.node?.name || 'Preview');
    this.stage = el('div.pv-stage.scroll');
    this.markbar = el('div.pv-markbar');
    this.body = el('div.pv-wrap', null, this.markbar, this.stage);
    win.body.append(this.body);
    this.buildToolbar();
    this.render();
    win.onResize = () => { if (this.zoom === 0) this.layout(); };
    win.onKey = e => {
      if (e.key === 'Escape' && this.markup) { this.toggleMarkup(false); return true; }
      return false;
    };
  }

  buildToolbar() {
    const win = this.win;
    this.zoomLabel = el('span.pv-zoom', { text: '100%' });
    this.win.tbTools.replaceChildren(
      el('button.tb-btn', { html: glyph('chevU'), title: 'Rotate Right', onclick: () => this.rotate(90), style: { transform: 'rotate(90deg)' } }),
      el('button.tb-btn', { html: glyph('minus'), title: 'Zoom Out (⌘-)', onclick: () => this.zoomBy(0.8) }),
      this.zoomLabel,
      el('button.tb-btn', { html: glyph('plus'), title: 'Zoom In (⌘+)', onclick: () => this.zoomBy(1.25) }),
      el('button.tb-btn', { text: '1:1', title: 'Actual Size (⌘0)', onclick: () => this.actualSize() }),
    );
    this.markBtn = el('button.tb-btn', { html: glyph('pencil'), title: 'Markup (⇧⌘A)', onclick: () => this.toggleMarkup() });
    this.win.tbRight.replaceChildren(
      el('button.tb-btn', { html: glyph('share'), title: 'Export as PNG…', onclick: () => this.exportPNG() }),
      this.markBtn,
    );
    this.buildMarkbar();
  }

  buildMarkbar() {
    const tool = (id, g, title) => el('button.tb-btn' + (this.tool === id ? '.on' : ''), {
      html: glyph(g), title, onclick: () => { this.tool = id; this.buildMarkbar(); },
    });
    this.markbar.replaceChildren(
      tool('pen', 'pencil', 'Sketch'),
      tool('rect', 'grid', 'Rectangle'),
      tool('ellipse', 'siri', 'Oval'),
      tool('line', 'minus', 'Line'),
      tool('text', 'at', 'Text'),
      el('span.pv-msep'),
      ...MARK_COLORS.map(c => el('button.pv-swatch' + (this.color === c ? '.on' : ''), {
        style: { background: c }, title: c,
        onclick: () => { this.color = c; this.buildMarkbar(); },
      })),
      el('span.pv-msep'),
      el('button.tb-btn', { text: 'Done', onclick: () => this.toggleMarkup(false) }),
    );
  }

  toggleMarkup(force) {
    this.markup = force ?? !this.markup;
    this.markbar.classList.toggle('on', this.markup);
    this.markBtn.classList.toggle('on', this.markup);
    this.renderOverlay();
  }

  /* ── document ─────────────────────────────────────────────────────── */
  render() {
    this.stage.replaceChildren();
    if (!this.node) { this.openPanel(); return; }
    this.frame = el('div.pv-frame');
    this.imgHost = el('div.pv-img');
    this.svgOver = null;
    this.frame.append(this.imgHost);
    this.stage.append(this.frame);
    this.paint();
    this.layout();
  }

  openPanel() {
    /* launched bare: Preview shows the images it can open, like its Open panel */
    const imgs = fs.walkAll().filter(n => n.kind === 'image' && !n.trashed);
    this.stage.append(el('div.pv-open', null,
      el('div.pv-o-icon', { html: PREVIEW_ICON }),
      el('b', { text: 'Open an image' }),
      el('div.pv-o-list', null, ...imgs.slice(0, 8).map(n =>
        el('button.pv-o-row', { onclick: () => { this.node = n; this.path = fs.pathOf(n); this.win.data.file = this.path; this.win.setTitle(n.name); this.render(); } },
          el('span', { html: glyph('gallery') }), el('span', { text: n.name })))),
    ));
  }

  paint() {
    const n = this.node;
    const c = n?.content || '';
    if (c.startsWith('data:image')) {
      this.imgHost.replaceChildren(el('img', { src: c, draggable: 'false', alt: '' }));
    } else if (c.trim().startsWith('<svg')) {
      this.imgHost.replaceChildren(el('div.pv-svg', { html: c }));
    } else {
      this.imgHost.replaceChildren(el('div.pv-svg', { html: imgFor(n).svg }));
    }
    /* the annotation layer sits on the same plane, so zoom/rotate carry it */
    this.svgOver = el('div.pv-over');
    this.svgOver.innerHTML = `<svg viewBox="0 0 ${NW} ${NH}" preserveAspectRatio="none"></svg>`;
    this.frame.append(this.svgOver);
    this.redrawMarks();
    if (this.markup) this.bindMarking();
  }

  layout() {
    if (!this.frame) return;
    const sw = this.stage.clientWidth - 40, sh = this.stage.clientHeight - 40;
    const fit = Math.min(sw / NW, sh / NH);
    const scale = this.zoom === 0 ? fit : this.zoom;
    const [w, h] = this.rot % 180 ? [NH, NW] : [NW, NH];
    this.frame.style.width = w * scale + 'px';
    this.frame.style.height = h * scale + 'px';
    this.imgHost.style.width = NW * scale + 'px';
    this.imgHost.style.height = NH * scale + 'px';
    this.imgHost.style.transform = `rotate(${this.rot}deg)`;
    /* rotating swaps the box: keep it centred in the frame */
    const dx = (w - NW) / 2 * scale, dy = (h - NH) / 2 * scale;
    this.imgHost.style.left = dx + 'px';
    this.imgHost.style.top = dy + 'px';
    if (this.svgOver) {
      this.svgOver.style.width = NW * scale + 'px';
      this.svgOver.style.height = NH * scale + 'px';
      this.svgOver.style.transform = `rotate(${this.rot}deg)`;
      this.svgOver.style.left = dx + 'px';
      this.svgOver.style.top = dy + 'px';
    }
    this.zoomLabel.textContent = Math.round((this.zoom === 0 ? fit : this.zoom) * 100) + '%';
  }

  zoomBy(f) {
    const sw = this.stage.clientWidth - 40, sh = this.stage.clientHeight - 40;
    const fit = Math.min(sw / NW, sh / NH);
    const cur = this.zoom === 0 ? fit : this.zoom;
    this.zoom = clamp(cur * f, 0.1, 8);
    this.layout();
  }
  actualSize() { this.zoom = 1; this.layout(); }
  rotate(deg) { this.rot = (this.rot + deg + 360) % 360; this.layout(); }

  /* ── markup ───────────────────────────────────────────────────────── */
  toImg(e) {
    const r = this.svgOver.getBoundingClientRect();
    /* unrotate the pointer around the overlay centre, then scale into the
       800x600 image space — the same plane the annotations live on */
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const x = e.clientX - cx, y = e.clientY - cy;
    const a = -this.rot * Math.PI / 180;
    const rx = x * Math.cos(a) - y * Math.sin(a), ry = x * Math.sin(a) + y * Math.cos(a);
    const drawn = this.rot % 180 ? r.height : r.width;
    const s = NW / drawn;
    return [rx * s + NW / 2, ry * s + NH / 2];
  }
  bindMarking() {
    const svg = this.svgOver.firstChild;
    let draft = null;
    this.svgOver.style.pointerEvents = 'auto';
    this.svgOver.onpointerdown = e => {
      if (!this.markup) return;
      e.preventDefault();
      this.svgOver.setPointerCapture(e.pointerId);
      const [x, y] = this.toImg(e);
      if (this.tool === 'text') { this.addText(x, y); return; }
      draft = { tool: this.tool, color: this.color, pts: [[x, y]], x0: x, y0: y };
      this.drawDraft(draft);
    };
    this.svgOver.onpointermove = e => {
      if (!draft) return;
      const [x, y] = this.toImg(e);
      draft.pts.push([x, y]);
      draft.x1 = x; draft.y1 = y;
      this.drawDraft(draft);
    };
    const commit = () => {
      if (!draft) return;
      const d = draft; draft = null;
      svg.querySelector('.draft')?.remove();
      if (d.tool !== 'pen' && Math.abs((d.x1 ?? d.x0) - d.x0) + Math.abs((d.y1 ?? d.y0) - d.y0) < 4) return;
      this.marks.push(d);
      this.redrawMarks();
    };
    this.svgOver.onpointerup = commit;
    this.svgOver.onpointercancel = commit;
  }
  drawDraft(d) {
    const svg = this.svgOver.firstChild;
    svg.querySelector('.draft')?.remove();
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'draft');
    g.innerHTML = markSVG(d);
    svg.append(g);
  }
  addText(x, y) {
    const r = this.svgOver.getBoundingClientRect();
    const fr = this.frame.getBoundingClientRect();
    /* rotate the image-space point the way the overlay is drawn, then put
       the input where that lands inside the frame */
    const s = (this.rot % 180 ? r.height : r.width) / NW;
    const a = this.rot * Math.PI / 180;
    const vx = x - NW / 2, vy = y - NH / 2;
    const rx = (vx * Math.cos(a) - vy * Math.sin(a)) * s;
    const ry = (vx * Math.sin(a) + vy * Math.cos(a)) * s;
    const input = el('input.pv-text', {
      style: {
        left: (r.left + r.width / 2 - fr.left + rx) + 'px',
        top: (r.top + r.height / 2 - fr.top + ry) + 'px',
        color: this.color,
      },
    });
    const host = this.svgOver.parentElement;
    host.append(input);
    input.focus();
    const done = () => {
      const v = input.value.trim();
      input.remove();
      if (v) { this.marks.push({ tool: 'text', color: this.color, text: v, x0: x, y0: y }); this.redrawMarks(); }
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(); if (e.key === 'Escape') input.remove(); });
    input.addEventListener('blur', done);
  }
  redrawMarks() {
    const svg = this.svgOver?.firstChild;
    if (!svg) return;
    svg.innerHTML = this.marks.map(m => markSVG(m)).join('');
    if (this.markup) this.bindMarking();
  }
  renderOverlay() {
    if (!this.svgOver) return;
    this.svgOver.style.pointerEvents = this.markup ? 'auto' : 'none';
    this.svgOver.classList.toggle('marking', this.markup);
  }

  /* ── export ───────────────────────────────────────────────────────── */
  async exportPNG() {
    if (!this.node) return;
    const n = this.node;
    const dir = dirName(this.path || fs.pathOf(n));
    const stem = (n.name || 'image').replace(/\.[^.]+$/, '');
    /* composite the artwork and the markup into one SVG, then rasterise */
    const c = (n.content || '').trim();
    let inner;
    if (c.startsWith('data:image')) {
      inner = `<image href="${c}" x="0" y="0" width="${NW}" height="${NH}" preserveAspectRatio="xMidYMid slice"/>`;
    } else if (c.startsWith('<svg')) {
      inner = c.replace('<svg ', `<svg x="0" y="0" width="${NW}" height="${NH}" `);
    } else {
      inner = imgFor(n).svg.replace('<svg ', `<svg x="0" y="0" width="${NW}" height="${NH}" preserveAspectRatio="xMidYMid slice" `);
    }
    const marks = `<svg x="0" y="0" width="${NW}" height="${NH}" viewBox="0 0 ${NW} ${NH}">${this.marks.map(markSVG).join('')}</svg>`;
    const doc = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${NW}" height="${NH}" viewBox="0 0 ${NW} ${NH}"><g transform="rotate(${this.rot} ${NW / 2} ${NH / 2})">${inner}${marks}</g></svg>`;
    let content;
    try {
      content = await rasterize(doc, NW, NH);
    } catch {
      content = doc;   /* no rasteriser: keep the composite as the file */
    }
    const out = fs.createFile(dir, stem + ' copy.png', content, 'image', { palette: n.palette ?? 0 });
    notify('Preview', `Exported “${out.name}” to ${baseName(dir)}`, { app: 'preview' });
  }
}

function markSVG(m) {
  const c = m.color, w = 5;
  if (m.tool === 'pen') {
    const d = m.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (m.tool === 'rect') {
    const x = Math.min(m.x0, m.x1 ?? m.x0), y = Math.min(m.y0, m.y1 ?? m.y0);
    return `<rect x="${x}" y="${y}" width="${Math.abs((m.x1 ?? m.x0) - m.x0)}" height="${Math.abs((m.y1 ?? m.y0) - m.y0)}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
  }
  if (m.tool === 'ellipse') {
    const cx = (m.x0 + (m.x1 ?? m.x0)) / 2, cy = (m.y0 + (m.y1 ?? m.y0)) / 2;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${Math.abs((m.x1 ?? m.x0) - m.x0) / 2}" ry="${Math.abs((m.y1 ?? m.y0) - m.y0) / 2}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
  }
  if (m.tool === 'line') {
    return `<line x1="${m.x0}" y1="${m.y0}" x2="${m.x1 ?? m.x0}" y2="${m.y1 ?? m.y0}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  }
  if (m.tool === 'text') {
    return `<text x="${m.x0}" y="${m.y0}" font-family="-apple-system,sans-serif" font-size="34" fill="${c}">${esc(m.text)}</text>`;
  }
  return '';
}

/* rasterise an svg string to a PNG data url; callers keep the svg as fallback */
function rasterize(svgText, w, h) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        res(cv.toDataURL('image/png'));
      } catch (err) { rej(err); }
    };
    img.onerror = rej;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  });
}
export default meta;
