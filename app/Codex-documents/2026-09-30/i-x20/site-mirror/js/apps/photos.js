// Photos: a drawn library across three years — groupable by year, month, day;
// a filmstrip viewer with Info (camera + map), Edit (adjust, filter, crop,
// rotate), a slideshow, and Recently Deleted. Edits and favorites persist
// under macos.photos.v1; screenshots arrive from ~/Desktop/Screenshots.
import { el, clamp, fmtStamp, on, emit } from '../core/util.js';
import { glyph } from '../core/icons.js';
import * as fs from '../core/fs.js';
import { wm } from '../shell/wm.js';
import { contextMenu } from '../shell/menus.js';
import { art, PHOTOS } from '../core/photoart.js';

export { art };

const PH_KEY = 'macos.photos.v1';
const DAY = 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHOTS_DIR = () => fs.HOME + '/Desktop/Screenshots';
const FS_KINDS = ['coast', 'mountain', 'forest', 'desert', 'lake', 'field'];

/* persisted bits: hearts, saved edits, the Recently Deleted shelf */
function loadPh() {
  try {
    const d = JSON.parse(localStorage.getItem(PH_KEY) || 'null');
    if (d && typeof d === 'object') return { fav: d.fav || {}, edits: d.edits || {}, deleted: d.deleted || {}, gone: d.gone || {} };
  } catch { /* fresh */ }
  return { fav: {}, edits: {}, deleted: {}, gone: {} };
}
const ph = loadPh();
const savePh = () => { try { localStorage.setItem(PH_KEY, JSON.stringify(ph)); } catch { /* blocked */ } emit('photos:change'); };

/* what a real EXIF panel would read for a given shot */
function cameraFor(p) {
  const tele = ['flower', 'abstract'].includes(p.kind);
  const wide = ['aurora', 'coast', 'mountain'].includes(p.kind);
  return {
    model: 'iPhone 16 Pro',
    lens: tele ? 'Telephoto 77 mm' : wide ? 'Ultra Wide 13 mm' : 'Main 24 mm',
    aperture: tele ? 'ƒ/2.8' : wide ? 'ƒ/2.2' : 'ƒ/1.8',
    iso: 40 + (p.seed * 13) % 460,
    shutter: `1/${[60, 90, 120, 180, 240][p.seed % 5]}`,
    dims: '4032 × 3024',
  };
}
const shotSeed = name => [...name].reduce((h, c) => (h * 33 + c.charCodeAt(0)) % 90000, 101);

/* a screenshot file renders as the desktop it captured: menu bar, wallpaper,
   a window, the dock — drawn, like everything else here */
function shotArt(seed) {
  const hues = [['#4a6fa5', '#9f7bea'], ['#2f6d5c', '#7fc8a9'], ['#8a5a44', '#e0a877']];
  const [a, b] = hues[seed % hues.length];
  return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">
    <defs><linearGradient id="sw${seed}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="400" height="300" fill="url(#sw${seed})"/>
    <circle cx="${70 + (seed % 200)}" cy="${60 + (seed % 60)}" r="${30 + (seed % 30)}" fill="#fff" opacity=".14"/>
    <rect x="0" y="0" width="400" height="13" fill="rgba(20,22,30,.72)"/>
    ${Array.from({ length: 7 }, (_, i) => `<rect x="${14 + i * 26}" y="4" width="14" height="5" rx="2" fill="#e8e8ee" opacity=".8"/>`).join('')}
    <rect x="${40 + (seed % 60)}" y="${40 + (seed % 30)}" width="240" height="150" rx="7" fill="#f4f4f6" opacity=".96"/>
    <rect x="${40 + (seed % 60)}" y="${40 + (seed % 30)}" width="240" height="15" rx="7" fill="#e2e2e6"/>
    <circle cx="${51 + (seed % 60)}" cy="${47 + (seed % 30)}" r="3" fill="#ff5f57"/><circle cx="${61 + (seed % 60)}" cy="${47 + (seed % 30)}" r="3" fill="#febc2e"/><circle cx="${71 + (seed % 60)}" cy="${47 + (seed % 30)}" r="3" fill="#28c840"/>
    <rect x="${58 + (seed % 60)}" y="${66 + (seed % 30)}" width="130" height="7" rx="3.5" fill="#c9c9d2"/>
    <rect x="${58 + (seed % 60)}" y="${80 + (seed % 30)}" width="180" height="7" rx="3.5" fill="#dcdce4"/>
    <rect x="${58 + (seed % 60)}" y="${94 + (seed % 30)}" width="150" height="7" rx="3.5" fill="#dcdce4"/>
    <rect x="110" y="276" width="180" height="20" rx="10" fill="rgba(20,22,30,.5)"/>
    ${Array.from({ length: 6 }, (_, i) => `<rect x="${122 + i * 26}" y="280" width="14" height="12" rx="3.5" fill="#fff" opacity=".85"/>`).join('')}
  </svg>`;
}

const meta = {
  id: 'photos', name: 'Photos', icon: 'photos', dock: true,
  settingsPane: 'general',
  menus: () => {
    const P = () => wm.byApp('photos')[0]?._ph;
    return [
      { title: 'File', items: () => [
        { label: 'Import…', key: '⌘O', action: () => import('../core/os.js').then(o => o.launch('finder', { path: fs.HOME + '/Pictures' })) },
        { type: 'sep' },
        { label: 'Close Window', key: '⌘W', action: () => { const w = wm.byApp('photos')[0]; w && wm.close(w); } },
      ] },
      { title: 'Edit', items: () => [
        { label: 'Select All', key: '⌘A', action: () => P()?.selectAll() },
        { label: 'Deselect All', key: '⇧⌘A', action: () => P()?.clearSel() },
      ] },
      { title: 'View', items: () => [
        ...['Years', 'Months', 'Days', 'All Photos'].map(v => ({
          label: v, checked: P()?.mode === v, action: () => P()?.setMode(v),
        })),
        { type: 'sep' },
        { label: 'Zoom In', key: '⌘+', action: () => P()?.bumpZoom(1) },
        { label: 'Zoom Out', key: '⌘-', action: () => P()?.bumpZoom(-1) },
      ] },
      { title: 'Image', items: () => [
        { label: 'Play Slideshow', key: 'Space', action: () => P()?.slideshow() },
        { label: 'Hide Info', key: '⌘I', action: () => P()?.toggleInfo() },
        { type: 'sep' },
        { label: 'Delete Photo', key: '⌫', action: () => P()?.deleteViewing() },
      ] },
    ];
  },
  launch(opts = {}) {
    const existing = wm.byApp('photos').find(w => w.state !== 'min');
    if (existing) { wm.focus(existing); if (opts.path) existing._ph?.reveal(opts.path); return existing; }
    return wm.open({
      app: 'photos', key: 'main', title: 'Photos',
      width: 980, height: 640, minWidth: 640, minHeight: 420,
      build: win => new Photos(win, opts).mount(),
      onClose: w => w._ph?.dispose(),
    });
  },
};

class Photos {
  constructor(win, opts) {
    this.win = win;
    this.opts = opts || {};
    this.mode = 'All Photos';       // Years | Months | Days | All Photos
    this.scope = 'Library';         // sidebar row
    this.query = '';
    this.zoom = 3;                  // 1..5, tile size steps
    this.viewing = null;            // index into this.currentList
    this.infoOn = false;
    this.editing = false;
    this.edit = null;               // working copy while the Edit UI is open
    this.aspect = 'Freeform';
    this.sel = new Set();
    this.show = null;               // slideshow state
  }
  dispose() { this.offFs?.(); clearInterval(this.showTimer); document.body.classList.remove('ph-sliding'); }

  /* the library, assembled: drawn photos + imported Pictures + screenshots */
  get photos() {
    const now = Date.now();
    const lib = PHOTOS.map((p, i) => ({
      id: 'l' + p.seed, name: p.name, kind: p.kind, seed: p.seed,
      taken: now - p.day * DAY - (i * 37 % 700) * 60000,
      place: p.place, ll: p.ll, src: 'lib',
    }));
    const pics = fs.children(fs.HOME + '/Pictures').filter(n => n.kind === 'image')
      .map((n, i) => ({
        id: 'fs:' + n.name, name: n.name.replace(/\.[^.]+$/, ''),
        kind: FS_KINDS[i % FS_KINDS.length], seed: 1009 + shotSeed(n.name) % 400,
        taken: (n.modified || now) - i * DAY, place: 'Home', ll: [37.7749, -122.4194], src: 'fs',
      }));
    const shots = fs.children(SHOTS_DIR())
      .map((n, i) => ({
        id: 'shot:' + n.name, name: n.name.replace(/\.[^.]+$/, ''), kind: 'shot',
        seed: shotSeed(n.name), taken: (n.modified || now) - i * 60000,
        place: 'This Mac', ll: [37.7749, -122.4194], src: 'shot',
      }));
    return [...lib, ...pics, ...shots].filter(p => !ph.gone?.[p.id]).sort((a, b) => b.taken - a.taken);
  }
  fav(id) { return !!ph.fav[id]; }
  editOf(p) { return ph.edits[p.id] || null; }
  artOf(p) { return p.kind === 'shot' ? shotArt(p.seed) : art(p.kind, p.seed, this.editOf(p) || undefined); }

  /* the list the current scope shows (deleted live in their own scope) */
  scoped() {
    const all = this.photos.filter(p => !ph.deleted[p.id]);
    let list;
    switch (this.scope) {
      case 'Favorites': list = all.filter(p => this.fav(p.id)); break;
      case 'Screenshots': list = all.filter(p => p.src === 'shot'); break;
      case 'Travel': list = all.filter(p => ['city', 'beach', 'coast', 'aurora'].includes(p.kind)); break;
      case 'Nature': list = all.filter(p => ['mountain', 'forest', 'desert', 'lake', 'field'].includes(p.kind)); break;
      case 'Abstract': list = all.filter(p => p.kind === 'abstract'); break;
      default: list = all;
    }
    const q = this.query.trim().toLowerCase();
    if (q) list = list.filter(p => `${p.name} ${p.place || ''}`.toLowerCase().includes(q));
    return list;
  }
  deletedList() {
    return this.photos.filter(p => ph.deleted[p.id]).sort((a, b) => ph.deleted[b.id] - ph.deleted[a.id]);
  }

  /* date clusters worth remembering: same month, at least two frames */
  memories() {
    const all = this.photos.filter(p => !ph.deleted[p.id] && p.src === 'lib');
    const groups = new Map();
    for (const p of all) {
      const d = new Date(p.taken);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const out = [];
    const today = new Date();
    for (const [key, items] of groups) {
      if (items.length < 2) continue;
      const d = new Date(items[0].taken);
      const sameDay = items.filter(p => { const pd = new Date(p.taken); return pd.getMonth() === today.getMonth() && pd.getDate() === today.getDate() && pd.getFullYear() !== today.getFullYear(); });
      const places = [...new Set(items.map(p => p.place).filter(Boolean))];
      out.push({
        key, items,
        title: sameDay.length ? 'On This Day' : places.length === 1 ? places[0] : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        sub: sameDay.length ? `${d.getFullYear()}` : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      });
    }
    return out.sort((a, b) => b.items[0].taken - a.items[0].taken);
  }

  mount() {
    this.win._ph = this;
    this.sidebar = el('aside.sidebar');
    this.grid = el('div.ph-grid.scroll');
    this.viewer = el('div.ph-viewer');
    this.stage = el('div.ph-stage', null, this.grid, this.viewer);
    this.win.setSidebar(this.sidebar, 200);
    this.win.body.append(this.stage);
    this.win.setTitle('Photos');

    /* toolbar: the Years/Months/Days/All segmented control Photos lives by */
    this.seg = el('div.seg.ph-seg', null,
      ...['Years', 'Months', 'Days', 'All Photos'].map(v =>
        el('button' + (v === this.mode ? '.on' : ''), { text: v, onclick: () => this.setMode(v) })));
    this.win.tbTools.replaceChildren(this.seg);
    this.zoomInput = el('input.range.ph-zoom', {
      type: 'range', min: '1', max: '5', step: '1', value: String(this.zoom),
      oninput: e => { this.zoom = Number(e.target.value); this.render(); },
    });
    this.searchInput = el('input.ph-search', {
      type: 'search', placeholder: 'Search', value: this.query,
      oninput: e => { this.query = e.target.value; this.render(); },
    });
    this.win.tbRight.replaceChildren(
      el('button.ph-tb', { html: glyph('minus'), title: 'Smaller', onclick: () => this.bumpZoom(-1) }),
      this.zoomInput,
      el('button.ph-tb', { html: glyph('plus'), title: 'Larger', onclick: () => this.bumpZoom(1) }),
      el('button.ph-tb', { html: glyph('play'), title: 'Slideshow', onclick: () => this.slideshow() }),
      this.searchInput,
    );

    this.renderSidebar();
    this.render();
    if (this.opts.path) this.reveal(this.opts.path);
    this.offFs = on('fs:change', ({ path } = {}) => {
      if (!path) return;
      if (path.startsWith(SHOTS_DIR()) || path.startsWith(fs.HOME + '/Pictures')) { this.renderSidebar(); this.render(); }
    });
    this.win.onKey = e => this.onKey(e);
    this.grid.addEventListener('dblclick', e => {
      const tile = e.target.closest('.ph-tile');
      if (tile) this.openViewer(Number(tile.dataset.i));
    });
  }

  onKey(e) {
    if (this.show) {
      if (e.key === 'Escape') { this.stopShow(); return true; }
      return true;              /* the slideshow swallows everything else */
    }
    if (this.viewing === null) return false;
    if (e.key === 'Escape') {
      if (this.editing) { this.cancelEdit(); return true; }
      if (this.infoOn) { this.toggleInfo(); return true; }
      this.closeViewer(); return true;
    }
    if (this.editing) return false;
    if (e.key === 'ArrowRight') { this.step(1); return true; }
    if (e.key === 'ArrowLeft') { this.step(-1); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteViewing(); return true; }
    return false;
  }

  setMode(v) {
    this.mode = v;
    [...this.seg.children].forEach(b => b.classList.toggle('on', b.textContent === v));
    this.render();
  }
  bumpZoom(d) {
    this.zoom = clamp(this.zoom + d, 1, 5);
    this.zoomInput.value = String(this.zoom);
    this.render();
  }
  selectAll() { this.currentList?.forEach(p => this.sel.add(p.id)); this.paintSel(); }
  clearSel() { this.sel.clear(); this.paintSel(); }
  paintSel() {
    const list = this.currentList || [];
    [...this.grid.querySelectorAll('.ph-tile')].forEach(t => t.classList.toggle('sel', this.sel.has(list[Number(t.dataset.i)]?.id)));
  }

  /* ── sidebar ─────────────────────────────────────────────────── */
  renderSidebar() {
    const all = this.photos.filter(p => !ph.deleted[p.id]);
    const row = (icon, label, on_, count, onClick) => el('button.sb-item' + (on_ ? '.on' : ''), { onclick: onClick },
      el('span.sb-ico', { html: glyph(icon) }), el('span.truncate', { text: label }),
      count != null ? el('span.sb-count', { text: String(count) }) : null);
    const go = s => () => this.setScope(s);
    this.sidebar.replaceChildren(
      row('gallery', 'Library', this.scope === 'Library', all.length, go('Library')),
      row('sparkle', 'Memories', this.scope === 'Memories', this.memories().length, go('Memories')),
      row('star', 'Favorites', this.scope === 'Favorites', all.filter(p => this.fav(p.id)).length, go('Favorites')),
      el('div.sb-section', { text: 'Albums' }),
      row('desktop', 'Screenshots', this.scope === 'Screenshots', all.filter(p => p.src === 'shot').length, go('Screenshots')),
      row('globe', 'Travel', this.scope === 'Travel', all.filter(p => ['city', 'beach', 'coast', 'aurora'].includes(p.kind)).length, go('Travel')),
      row('flower', 'Nature', this.scope === 'Nature', all.filter(p => ['mountain', 'forest', 'desert', 'lake', 'field'].includes(p.kind)).length, go('Nature')),
      row('gallery', 'Abstract', this.scope === 'Abstract', all.filter(p => p.kind === 'abstract').length, go('Abstract')),
      el('div.sb-section', { text: 'Utilities' }),
      row('trashSmall', 'Recently Deleted', this.scope === 'Deleted', this.deletedList().length, go('Deleted')),
    );
  }
  setScope(s) { this.scope = s; this.renderSidebar(); this.render(); }
  /* opened from Finder or the desktop with a file: land on that photo */
  reveal(path) {
    const base = String(path).split('/').pop();
    const id = (String(path).startsWith(SHOTS_DIR()) ? 'shot:' : 'fs:') + base;
    const list = this.currentList || [];
    let i = list.findIndex(p => p.id === id);
    if (i < 0) {
      /* maybe it lives under a different scope — look everywhere */
      this.setScope('Library');
      i = (this.currentList || []).findIndex(p => p.id === id);
    }
    if (i >= 0) this.openViewer(i);
  }

  /* ── grid ────────────────────────────────────────────────────── */
  groupKey(p) {
    const d = new Date(p.taken), now = new Date();
    if (this.mode === 'Years') return String(d.getFullYear());
    if (this.mode === 'Months') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (d.toDateString() === now.toDateString()) return 'Today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  render() {
    this.viewer.classList.remove('on'); this.viewing = null; this.editing = false;
    if (this.scope === 'Memories') return this.renderMemories();
    if (this.scope === 'Deleted') return this.renderDeleted();
    const list = this.scoped();
    this.currentList = list;
    this.grid.className = `ph-grid scroll mode-${this.mode.replace(/\s/g, '').toLowerCase()}`;
    this.grid.style.setProperty('--tile', [88, 128, 168, 210, 252][this.zoom - 1] + 'px');
    this.grid.replaceChildren();
    const flat = this.mode === 'All Photos';
    const groups = new Map();
    for (const p of list) {
      const key = flat ? '•' : this.groupKey(p);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    let i = 0;
    for (const [key, items] of groups) {
      if (!flat) this.grid.append(el('div.ph-head', null,
        el('span', { text: key }), el('span.ph-count', { text: `${items.length} photo${items.length > 1 ? 's' : ''}` })));
      const rowEl = el('div.ph-row');
      for (const p of items) {
        const tile = el('button.ph-tile' + (this.sel.has(p.id) ? '.sel' : ''), {
          dataset: { i: String(i) }, title: `${p.name} — ${p.place || ''}`,
          ondblclick: () => this.openViewer(Number(tile.dataset.i)),
          onclick: e => {
            if (!e.metaKey && !e.shiftKey) this.sel.clear();
            this.sel.has(p.id) && e.metaKey ? this.sel.delete(p.id) : this.sel.add(p.id);
            this.paintSel();
          },
          oncontextmenu: e => { e.preventDefault(); this.tileMenu(p, e.clientX, e.clientY); },
        },
          el('div.ph-img', { html: this.artOf(p) }),
          this.fav(p.id) ? el('span.ph-fav', { html: heartSvg(true) }) : null);
        rowEl.append(tile);
        i++;
      }
      this.grid.append(rowEl);
    }
    if (!list.length) this.grid.append(el('div.ph-empty', null,
      el('b', { text: 'No Photos' }), el('span', { text: this.query ? `Nothing matches “${this.query}”` : 'Import pictures into ~/Pictures and they appear here.' })));
  }

  renderMemories() {
    const mems = this.memories();
    this.currentList = [];
    this.grid.className = 'ph-grid scroll mode-memories';
    this.grid.replaceChildren();
    this.grid.append(el('div.ph-head', null, el('span', { text: 'Memories' }), el('span.ph-count', { text: `${mems.length}` })));
    if (!mems.length) this.grid.append(el('div.ph-empty', { text: 'Not enough photos yet to make a memory.' }));
    const wrap = el('div.ph-mem-wrap');
    for (const m of mems.slice(0, 8)) {
      const covers = m.items.slice(0, 4);
      wrap.append(el('button.ph-mem', {
        onclick: () => { this.currentList = m.items; this.openViewer(0); },
      },
        el('div.ph-mem-art', null, ...covers.map(p => el('div', { html: this.artOf(p) })),
          covers.length < 4 ? Array.from({ length: 4 - covers.length }, () => el('div.ph-pl-empty')) : []),
        el('div.ph-mem-txt', null, el('b', { text: m.title }), el('span', { text: `${m.sub} · ${m.items.length} photos` }))));
    }
    this.grid.append(wrap);
  }

  renderDeleted() {
    const list = this.deletedList();
    this.currentList = list;
    this.grid.className = 'ph-grid scroll mode-allphotos';
    this.grid.style.setProperty('--tile', '150px');
    this.grid.replaceChildren();
    this.grid.append(el('div.ph-del-note', null,
      el('b', { text: 'Recently Deleted' }),
      el('span', { text: 'Photos are kept here for 30 days before they are permanently deleted. This may take up to 40 days total.' })));
    const rowEl = el('div.ph-row');
    list.forEach((p, i) => {
      const days = Math.max(1, 30 - Math.floor((Date.now() - ph.deleted[p.id]) / DAY));
      rowEl.append(el('button.ph-tile', {
        dataset: { i: String(i) }, title: p.name,
        ondblclick: () => this.openViewer(i),
        oncontextmenu: e => { e.preventDefault(); contextMenu([
          { label: 'Recover', action: () => this.recover(p) },
          { label: 'Delete Permanently', danger: true, action: () => this.erase(p) },
        ], e.clientX, e.clientY); },
      }, el('div.ph-img', { html: this.artOf(p) }), el('span.ph-days', { text: `${days} day${days > 1 ? 's' : ''} left` })));
    });
    this.grid.append(rowEl);
    if (!list.length) this.grid.append(el('div.ph-empty', { text: 'Nothing to see here. Deleted photos land in this album for 30 days.' }));
  }

  tileMenu(p, x, y) {
    contextMenu([
      { label: 'Open', action: () => this.openViewer(this.currentList.indexOf(p)) },
      { label: this.fav(p.id) ? 'Remove from Favorites' : 'Favorite', action: () => this.toggleFav(p) },
      { type: 'sep' },
      { label: 'Play Slideshow', action: () => { this.openViewer(this.currentList.indexOf(p)); this.slideshow(); } },
      { type: 'sep' },
      { label: 'Delete Photo', danger: true, action: () => this.trash(p) },
    ], x, y);
  }

  /* ── favorites / delete ──────────────────────────────────────── */
  toggleFav(p) {
    if (ph.fav[p.id]) delete ph.fav[p.id]; else ph.fav[p.id] = Date.now();
    savePh();
    this.renderSidebar();
    if (this.viewing === null) this.render(); else this.paint();
  }
  trash(p) {
    ph.deleted[p.id] = Date.now();
    savePh();
    this.renderSidebar();
    if (this.viewing !== null) this.closeViewer();
    this.render();
  }
  recover(p) { delete ph.deleted[p.id]; savePh(); this.renderSidebar(); this.render(); }
  erase(p) {
    if (p.src === 'shot') { try { fs.trashNode(SHOTS_DIR() + '/' + p.name + '.png'); } catch { /* gone */ } }
    delete ph.deleted[p.id]; delete ph.edits[p.id]; delete ph.fav[p.id];
    ph.gone = ph.gone || {}; ph.gone[p.id] = Date.now();
    savePh(); this.renderSidebar(); this.render();
  }
  deleteViewing() { const p = this.currentList?.[this.viewing]; if (p) this.trash(p); }
  toggleInfo() { this.infoOn = !this.infoOn; if (this.viewing !== null) this.paint(); }

  /* ── the viewer ──────────────────────────────────────────────── */
  openViewer(i) {
    if (!this.currentList?.length) return;
    this.viewing = clamp(i, 0, this.currentList.length - 1);
    this.editing = false;
    this.viewer.classList.add('on');
    this.paint();
  }
  closeViewer() {
    this.viewing = null; this.editing = false; this.infoOn = false;
    this.viewer.classList.remove('on');
    this.viewer.replaceChildren();
    this.render();
  }
  step(d) {
    const n = this.currentList?.length || 0;
    if (!n) return;
    this.viewing = (this.viewing + d + n) % n;
    if (this.editing) this.editing = false;
    this.paint();
  }

  paint() {
    const list = this.currentList || [];
    const p = list[this.viewing];
    if (!p) return this.closeViewer();
    const isDeleted = !!ph.deleted[p.id];
    this.viewer.replaceChildren(
      el('div.ph-v-top', null,
        el('button.ph-v-btn.wide', { html: glyph('chevL') + '<span>Back</span>', title: 'Back (Esc)', onclick: () => this.closeViewer() }),
        el('div.ph-v-title', null, el('b', { text: p.name }), el('small', { text: fmtStamp(p.taken) })),
        el('div.ph-v-tools', null,
          isDeleted ? null : el('button.ph-v-btn' + (this.fav(p.id) ? '.on' : ''), { html: heartSvg(this.fav(p.id)), title: 'Favorite', onclick: () => this.toggleFav(p) }),
          isDeleted ? el('button.ph-v-btn.wide', { html: '<span>Recover</span>', onclick: () => { this.recover(p); this.closeViewer(); } }) : null,
          isDeleted ? el('button.ph-v-btn.wide.danger', { html: '<span>Delete</span>', onclick: () => { this.erase(p); this.closeViewer(); } }) : null,
          isDeleted ? null : el('button.ph-v-btn' + (this.infoOn ? '.on' : ''), { html: glyph('info'), title: 'Info', onclick: () => this.toggleInfo() }),
          isDeleted || p.kind === 'shot' ? null : el('button.ph-v-btn', { html: glyph('pencil'), title: 'Edit', onclick: () => this.startEdit() }),
          isDeleted ? null : el('button.ph-v-btn', { html: glyph('play'), title: 'Slideshow', onclick: () => this.slideshow() }),
          isDeleted ? null : el('button.ph-v-btn', { html: glyph('trashSmall'), title: 'Delete', onclick: () => this.deleteViewing() }),
        )),
      el('div.ph-v-mid', null,
        el('div.ph-v-stage', null,
          el('button.ph-v-nav.left', { html: glyph('chevL'), title: 'Previous', onclick: () => this.step(-1) }),
          this.editing ? this.editStage(p) : el('div.ph-v-frame', { html: this.artOf(p) }),
          el('button.ph-v-nav.right', { html: glyph('chevR'), title: 'Next', onclick: () => this.step(1) })),
        this.infoOn && !this.editing ? this.infoPanel(p) : null),
      el('div.ph-v-strip', null,
        ...list.map((t, i) => el('button.ph-v-thumb' + (i === this.viewing ? '.on' : ''), {
          onclick: () => { this.viewing = i; this.editing = false; this.paint(); },
        }, el('div', { html: this.artOf(t) })))),
      el('div.ph-v-foot', { text: `${this.viewing + 1} of ${list.length}` }),
    );
    this.win.setTitle(`${p.name} — Photos`);
  }

  infoPanel(p) {
    const cam = cameraFor(p);
    const [lat, lon] = p.ll || [37.7749, -122.4194];
    const mapHost = el('div.ph-map');
    /* the drawn map sits underneath; the live OSM tile lands on top of it */
    mapHost.append(el('div.ph-map-static', { html: miniMapSvg(lat, lon) }));
    const frame = el('iframe.ph-map-frame', {
      src: `https://www.openstreetmap.org/export/embed.html?bbox=${(lon - 0.03).toFixed(4)},${(lat - 0.02).toFixed(4)},${(lon + 0.03).toFixed(4)},${(lat + 0.02).toFixed(4)}&layer=mapnik&marker=${lat},${lon}`,
      loading: 'lazy', referrerpolicy: 'no-referrer', title: 'Map',
    });
    mapHost.append(frame);
    return el('aside.ph-info.scroll', null,
      el('div.ph-info-h', { text: 'Info' }),
      el('div.ph-info-art', { html: this.artOf(p) }),
      el('div.ph-info-rows', null,
        infoRow('Title', p.name),
        infoRow('Date', fmtStamp(p.taken)),
        infoRow('Place', p.place || '—'),
        infoRow('Camera', cam.model),
        infoRow('Lens', `${cam.lens} · ${cam.aperture}`),
        infoRow('Exposure', `${cam.shutter}s · ISO ${cam.iso}`),
        infoRow('Size', cam.dims),
      ),
      mapHost,
      el('div.ph-map-cap', { text: `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` }));
  }

  /* ── edit ────────────────────────────────────────────────────── */
  startEdit() {
    const p = this.currentList[this.viewing];
    if (!p || p.kind === 'shot') return;
    this.editing = true;
    this.edit = { light: 0, color: 0, bw: 0, sepia: 0, hue: 0, rotate: 0, crop: null, ...(ph.edits[p.id] || {}) };
    this.aspect = this.edit.crop ? 'custom' : 'Freeform';
    this.paint();
  }
  cancelEdit() { this.editing = false; this.edit = null; this.paint(); }
  saveEdit() {
    const p = this.currentList[this.viewing];
    const idx = this.viewing;
    const clean = { ...this.edit };
    const dirty = clean.light || clean.color || clean.bw || clean.sepia || clean.hue || clean.rotate || clean.crop;
    if (dirty) ph.edits[p.id] = clean; else delete ph.edits[p.id];
    savePh();
    this.editing = false; this.edit = null;
    this.render(); this.renderSidebar();
    this.openViewer(idx);
  }
  resetEdit() {
    this.edit = { light: 0, color: 0, bw: 0, sepia: 0, hue: 0, rotate: 0, crop: null };
    this.aspect = 'Freeform';
    this.paint();
  }

  editStage(p) {
    /* the live preview renders the working edit through art() itself */
    const preview = el('div.ph-e-frame', { html: art(p.kind, p.seed, { ...this.edit, crop: null }) });
    const cropBox = el('div.ph-crop');
    const stage = el('div.ph-e-stage', null, preview, cropBox);
    const applyCropBox = () => {
      const c = this.edit.crop || { x: 0, y: 0, w: 1, h: 1 };
      Object.assign(cropBox.style, {
        left: c.x * 100 + '%', top: c.y * 100 + '%',
        width: c.w * 100 + '%', height: c.h * 100 + '%',
      });
      /* the preview always shows the full frame; the crop is the box on top */
      preview.innerHTML = art(p.kind, p.seed, { ...this.edit, crop: null });
    };
    applyCropBox();
    /* corner handles resize the crop; dragging the box moves it */
    for (const dir of ['nw', 'ne', 'sw', 'se']) {
      cropBox.append(el('div.ph-ch.' + dir, {
        onpointerdown: e => {
          e.stopPropagation(); e.preventDefault();
          cropBox.setPointerCapture(e.pointerId);
          const r = stage.getBoundingClientRect();
          const move = ev => {
            const fx = clamp((ev.clientX - r.left) / r.width, 0, 1);
            const fy = clamp((ev.clientY - r.top) / r.height, 0, 1);
            let c = { ...(this.edit.crop || { x: 0, y: 0, w: 1, h: 1 }) };
            if (dir.includes('w')) { const x1 = c.x + c.w; c.x = Math.min(fx, x1 - 0.08); c.w = x1 - c.x; }
            if (dir.includes('e')) c.w = Math.max(0.08, fx - c.x);
            if (dir.includes('n')) { const y1 = c.y + c.h; c.y = Math.min(fy, y1 - 0.08); c.h = y1 - c.y; }
            if (dir.includes('s')) c.h = Math.max(0.08, fy - c.y);
            c.w = Math.min(c.w, 1 - c.x); c.h = Math.min(c.h, 1 - c.y);
            this.edit.crop = (c.w >= 0.999 && c.h >= 0.999) ? null : c;
            applyCropBox();
          };
          const up = () => { cropBox.removeEventListener('pointermove', move); cropBox.removeEventListener('pointerup', up); };
          cropBox.addEventListener('pointermove', move);
          cropBox.addEventListener('pointerup', up);
        },
      }));
    }
    cropBox.addEventListener('pointerdown', e => {
      if (e.target !== cropBox) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const c0 = { ...(this.edit.crop || { x: 0, y: 0, w: 1, h: 1 }) };
      const sx = e.clientX, sy = e.clientY;
      const move = ev => {
        const dx = (ev.clientX - sx) / r.width, dy = (ev.clientY - sy) / r.height;
        const c = { ...c0 };
        c.x = clamp(c0.x + dx, 0, 1 - c.w);
        c.y = clamp(c0.y + dy, 0, 1 - c.h);
        this.edit.crop = c;
        applyCropBox();
      };
      const up = () => { cropBox.removeEventListener('pointermove', move); cropBox.removeEventListener('pointerup', up); };
      cropBox.addEventListener('pointermove', move);
      cropBox.addEventListener('pointerup', up);
    });

    const slider = (label, key, min, max, step) => {
      const val = el('span.ph-e-val', { text: String(this.edit[key] || 0) });
      return el('label.ph-e-row', null,
        el('span', { text: label }),
        el('input.range.ph-e-range', {
          type: 'range', min: String(min), max: String(max), step: String(step), value: String(this.edit[key] || 0),
          oninput: e => { this.edit[key] = Number(e.target.value); val.textContent = e.target.value; applyCropBox(); },
        }),
        val);
    };

    const FILTERS = [
      ['Original', {}], ['Vivid', { color: .3, light: .03 }], ['Vivid Warm', { color: .26, sepia: .16 }],
      ['Vivid Cool', { color: .24, hue: -10 }], ['Dramatic', { light: -.1, color: .12, sepia: .08 }],
      ['Mono', { bw: 1 }], ['Silvertone', { bw: 1, light: .07 }], ['Noir', { bw: 1, light: -.08, sepia: .05 }],
    ];
    const filterRow = el('div.ph-e-filters', null, ...FILTERS.map(([name, preset]) => {
      const on = FILTERS_KEYS(name, this.edit, preset);
      return el('button.ph-e-filter' + (on ? '.on' : ''), {
        onclick: () => {
          Object.assign(this.edit, { light: 0, color: 0, bw: 0, sepia: 0, hue: 0 }, preset);
          this.paint();
        },
      }, el('div.ph-e-thumb', { html: art(p.kind, p.seed, { ...preset, crop: null, rotate: 0 }) }), el('span', { text: name }));
    }));

    const aspectBtn = (label, ar) => el('button.ph-e-aspect' + (this.aspect === label ? '.on' : ''), {
      text: label,
      onclick: () => {
        this.aspect = label;
        if (ar) {
          /* a centered crop at the chosen ratio inside the 4:3 frame */
          const hf = Math.min(1, 4 / (3 * ar));
          const wf = Math.min(1, ar * hf * 3 / 4);
          this.edit.crop = { x: (1 - wf) / 2, y: (1 - hf) / 2, w: wf, h: hf };
        } else this.edit.crop = null;
        this.paint();
      },
    });

    return el('div.ph-e', null,
      stage,
      el('aside.ph-e-panel.scroll', null,
        el('div.ph-e-sec', { text: 'Adjust' }),
        slider('Light', 'light', -1, 1, .01),
        slider('Color', 'color', -1, 1, .01),
        slider('B&W', 'bw', 0, 1, .01),
        el('div.ph-e-sec', { text: 'Filters' }),
        filterRow,
        el('div.ph-e-sec', { text: 'Crop' }),
        el('div.ph-e-aspects', null, aspectBtn('Freeform', 0), aspectBtn('1:1', 1), aspectBtn('4:3', 4 / 3), aspectBtn('16:9', 16 / 9), aspectBtn('3:2', 1.5)),
        el('div.ph-e-acts', null,
          el('button.ph-e-btn', { html: '<span>Rotate ⟳</span>', onclick: () => { this.edit.rotate = ((this.edit.rotate || 0) + 90) % 360; this.paint(); } }),
          el('button.ph-e-btn', { html: '<span>Reset All</span>', onclick: () => this.resetEdit() })),
        el('div.ph-e-done', null,
          el('button.ph-e-btn.ghost', { html: '<span>Cancel</span>', onclick: () => this.cancelEdit() }),
          el('button.ph-e-btn.primary', { html: '<span>Done</span>', onclick: () => this.saveEdit() }))));
  }

  /* ── slideshow ───────────────────────────────────────────────── */
  slideshow() {
    const list = (this.currentList?.length ? this.currentList : this.scoped());
    if (!list.length) return;
    if (this.viewing === null) this.viewing = 0;
    this.show = { list, i: this.viewing };
    document.body.classList.add('ph-sliding');
    const overlay = el('div.ph-show', null, el('div.ph-show-layer.a'), el('div.ph-show-layer.b'));
    this.win.node.append(overlay);
    this.show.node = overlay;
    let cur = overlay.firstChild, next = overlay.lastChild;
    const draw = () => {
      const p = this.show.list[this.show.i];
      next.innerHTML = this.artOf(p);
      next.classList.remove('ken', 'in');
      void next.offsetWidth;            /* restarting Ken Burns needs a reflow */
      next.classList.add('ken', 'in');
      cur.classList.remove('in');
      [cur, next] = [next, cur];
    };
    draw();
    this.showTimer = setInterval(() => {
      this.show.i = (this.show.i + 1) % this.show.list.length;
      draw();
    }, 2600);
  }
  stopShow() {
    clearInterval(this.showTimer);
    this.show?.node?.remove();
    this.show = null;
    document.body.classList.remove('ph-sliding');
  }
}

/* which filter chip is lit: the working edit matches the preset exactly */
function FILTERS_KEYS(name, edit, preset) {
  const keys = ['light', 'color', 'bw', 'sepia', 'hue'];
  return keys.every(k => Math.abs((edit[k] || 0) - (preset[k] || 0)) < 0.005);
}
const infoRow = (k, v) => el('div.ph-info-row', null, el('span', { text: k }), el('b', { text: v }));
const heartSvg = filled => `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 13.5S2.6 9.9 1.6 6.4C.9 3.9 2.7 2 5 2c1.3 0 2.4.7 3 1.7C8.6 2.7 9.7 2 11 2c2.3 0 4.1 1.9 3.4 4.4-1 3.5-6.4 7.1-6.4 7.1z"${filled ? ' fill="currentColor"' : ''}/></svg>`;

/* the hand-drawn fallback under the live map tile — always something to see */
function miniMapSvg(lat, lon) {
  const blocks = [];
  let s = Math.abs(Math.floor(lat * 97 + lon * 131)) % 90 + 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 26; i++) {
    blocks.push(`<rect x="${(rnd() * 200) | 0}" y="${(rnd() * 120) | 0}" width="${14 + rnd() * 30}" height="${10 + rnd() * 22}" fill="#dfe4da" stroke="#cfd6c9" stroke-width=".6" rx="2"/>`);
  }
  return `<svg viewBox="0 0 200 120" style="width:100%;height:100%;display:block">
    <rect width="200" height="120" fill="#eceee6"/>
    ${blocks.join('')}
    <path d="M0 60 Q70 ${30 + rnd() * 40} 200 70" stroke="#b9d0e6" stroke-width="9" fill="none"/>
    <path d="M30 0V120M90 0V120M150 0V120M0 34H200M0 88H200" stroke="#fff" stroke-width="4"/>
    <path d="M30 0V120M90 0V120M150 0V120M0 34H200M0 88H200" stroke="#d8dde0" stroke-width="1"/>
    <circle cx="100" cy="60" r="14" fill="#fa2d48" opacity=".22"/>
    <path d="M100 44c-4.6 0-8 3.4-8 7.6 0 5.6 8 12.4 8 12.4s8-6.8 8-12.4c0-4.2-3.4-7.6-8-7.6z" fill="#fa2d48"/>
    <circle cx="100" cy="51.4" r="3" fill="#fff"/>
  </svg>`;
}
export default meta;
