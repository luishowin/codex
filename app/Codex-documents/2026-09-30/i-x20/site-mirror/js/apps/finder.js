// Finder: sidebar, icon/list/column/gallery views, Quick Look, Get Info,
// tags, toolbar search, sorting, drag and drop — the file manager, for real.
import { el, $, $$, on, fmtStamp, fmtSize, fileSize, baseName, dirName, syncRangeFill, clamp } from '../core/util.js';
import { fileIcon, folderIcon, glyph, appIcon } from '../core/icons.js';
import * as fs from '../core/fs.js';
import { wm } from '../shell/wm.js';
import { contextMenu } from '../shell/menus.js';
import { startDrag, dropZone } from '../shell/dragdrop.js';
import { art as photoArt } from '../core/photoart.js';
import { launch, getApp, appName, isInstalled } from '../core/os.js';
import { notify } from '../shell/notify.js';
import { state, save } from '../core/store.js';

let clipboard = null; // {mode:'copy'|'cut', nodes:[node]}

const FAVORITES = [
  { label: 'AirDrop', icon: 'airdrop', special: 'airdrop', key: '⇧⌘R' },
  { label: 'Recents', icon: 'clock', special: 'recents', key: '⇧⌘F' },
  { label: 'Applications', icon: 'grid', path: '/Applications', key: '⇧⌘A' },
  { label: 'Desktop', icon: 'display', path: fs.HOME + '/Desktop', key: '⇧⌘D' },
  { label: 'Documents', icon: 'folderPlus', path: fs.HOME + '/Documents', key: '⇧⌘O' },
  { label: 'Downloads', icon: 'download', path: fs.HOME + '/Downloads', key: '⌥⌘L' },
];
const homeRow = () => ({ label: state.settings.userName || 'bunny', icon: 'home', path: fs.HOME, key: '⇧⌘H' });
const TAGS = [
  { label: 'Red', color: '#ff5f57' }, { label: 'Orange', color: '#ff9f0a' },
  { label: 'Yellow', color: '#ffcc00' }, { label: 'Green', color: '#28c840' },
  { label: 'Blue', color: '#0a84ff' }, { label: 'Purple', color: '#bf5af2' },
  { label: 'Gray', color: '#8e8e93' },
];
const tagColor = t => TAGS.find(x => x.label === t)?.color || '#8e8e93';

/* a tiny hard-drive glyph for the Macintosh HD sidebar row */
const HD_ICON = `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="6" width="13" height="6" rx="1.8"/><circle cx="12.3" cy="9" r=".9" fill="currentColor" stroke="none"/></svg>`;
const EJECT_ICON = `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3.4 9.4 8 5l4.6 4.4z"/><rect x="3" y="11.4" width="10" height="1.5" rx=".75" fill="currentColor" stroke="none"/></svg>`;
/* volumes the user has ejected stay out of the sidebar until they re-mount */
const unmounted = new Set();

/* per-folder memory, the way Finder keeps each folder's view settings */
const folderOpts = new Map();
const optsFor = path => {
  if (!folderOpts.has(path)) folderOpts.set(path, { sort: 'name', asc: true, icon: 62, labels: 'bottom' });
  return folderOpts.get(path);
};

/* which real apps open which kinds — drives Open, Open With and Get Info */
const OPEN_WITH = {
  txt: ['textedit', 'preview', 'photos'],
  image: ['preview', 'photos', 'textedit'],
  audio: ['music'],
};
function openWithChoices(node) {
  if (!node || node.kind === 'app') return [];
  if (node.type === 'dir') return ['finder'];
  const list = OPEN_WITH[node.kind] || (node.name.endsWith('.txt') || node.name.endsWith('.md') || node.name.endsWith('.rtf') ? OPEN_WITH.txt : []);
  return list.filter(id => getApp(id) && isInstalled(id));
}
const defaultAppFor = node => openWithChoices(node)[0] || null;
function launchOptsFor(appId, node) {
  const path = fs.pathOf(node);
  switch (appId) {
    case 'textedit': return { path };
    case 'preview': return { file: path };
    case 'photos': return { path };
    case 'music': return { song: node.song };
    case 'finder': return { path: node.type === 'dir' ? path : dirName(path) };
    case 'terminal': return { cwd: node.type === 'dir' ? path : dirName(path) };
    default: return { path };
  }
}
function openWith(node, appId = node.openWith || defaultAppFor(node)) {
  if (!appId || !getApp(appId)) return false;
  launch(appId, launchOptsFor(appId, node));
  return true;
}

/* images render as real generated art, keyed to the file's palette */
const PHOTO_KINDS = ['mountain', 'coast', 'forest', 'lake', 'beach', 'desert', 'field', 'city', 'flower', 'abstract'];
const artFor = node => photoArt(PHOTO_KINDS[(node.palette ?? seedOf(node.name)) % PHOTO_KINDS.length], seedOf(node.name));

/* real byte count for a folder: every file inside it, recursively */
function dirStats(node) {
  let bytes = 0, count = 0;
  (function walk(n) {
    for (const c of n.children || []) {
      count++;
      if (c.type === 'dir') walk(c);
      else bytes += fileSize(c.content);
    }
  })(node);
  return { bytes, count };
}
const nodeBytes = node => node.type === 'dir' ? dirStats(node).bytes : fileSize(node.content);
const whereLabel = path => {
  const dir = dirName(path);
  if (dir === '/') return 'Macintosh HD';
  return 'Macintosh HD ▸ ' + dir.split('/').filter(Boolean).join(' ▸ ');
};

const meta = {
  id: 'finder',
  name: 'Finder',
  icon: 'finder',
  dock: true,
  menus: () => activeMenu(),
  settingsPane: 'general',
  newWindow: () => openFinder({ path: fs.HOME }),
  launch(opts = {}) { return openFinder(opts); },
};

/* the Finder window the menus act on: the focused one when it is a real
   browser window, otherwise the first one that is */
function frontFinder() {
  if (wm.focused?.app === 'finder' && wm.focused._finder) return wm.focused;
  return wm.byApp('finder').find(w => w._finder && w.state !== 'min') || wm.byApp('finder').find(w => w._finder) || null;
}

function activeMenu() {
  const win = frontFinder();
  const fw = win?._finder;
  const path = fw?.path || fs.HOME;
  const inTrash = path === fs.TRASH;
  return [
    {
      title: 'File', items: () => [
        { label: 'New Finder Window', key: '⌘N', action: () => openFinder({ path }) },
        { label: 'New Folder', key: '⇧⌘N', disabled: inTrash, action: () => fw?.newFolder() },
        { label: 'New Folder with Selection', key: '⌃⌘N', disabled: !fw?.hasSelection() || inTrash, action: () => fw?.newFolderWithSelection() },
        { type: 'sep' },
        { label: 'Open', key: '⌘O', disabled: !fw?.hasSelection(), action: () => fw?.openSelection() },
        {
          label: 'Open With', disabled: !fw?.hasSelection() || !openWithChoices(fw?.selectedNodes()[0]).length,
          sub: () => openWithChoices(fw?.selectedNodes()[0]).map(id => ({
            label: appName(id) + (id === defaultAppFor(fw?.selectedNodes()[0]) ? ' (default)' : ''),
            action: () => openWith(fw?.selectedNodes()[0], id),
          })),
        },
        { label: 'Open in Terminal', disabled: !fw?.hasSelection(), action: () => fw?.openInTerminal() },
        { type: 'sep' },
        { label: 'Get Info', key: '⌘I', disabled: !fw?.hasSelection(), action: () => fw?.getInfo() },
        { label: 'Quick Look', key: 'Space', disabled: !fw?.hasSelection(), action: () => fw?.quickLook() },
        { label: 'Rename', disabled: !fw?.hasSelection(), action: () => fw?.beginRename() },
        { type: 'sep' },
        { label: 'Duplicate', key: '⌘D', disabled: !fw?.hasSelection(), action: () => fw?.duplicate() },
        { label: inTrash ? 'Put Back' : 'Move to Trash', key: '⌘⌫', danger: !inTrash, disabled: !fw?.hasSelection(), action: () => inTrash ? fw?.putBack() : fw?.trashSelection() },
        { label: 'Empty Trash…', key: '⇧⌘⌫', disabled: !fs.trashed().length, action: () => fw?.emptyTrash() },
        { type: 'sep' },
        { label: 'Find', key: '⌘F', action: () => fw?.focusSearch() },
        { label: 'Close Window', key: '⌘W', action: () => win && wm.close(win) },
      ],
    },
    {
      title: 'Edit', items: () => [
        { label: 'Cut', key: '⌘X', disabled: !fw?.hasSelection(), action: () => fw?.cut() },
        { label: 'Copy', key: '⌘C', disabled: !fw?.hasSelection(), action: () => fw?.copy() },
        { label: 'Paste', key: '⌘V', disabled: !clipboard, action: () => fw?.paste() },
        { type: 'sep' },
        { label: 'Select All', key: '⌘A', action: () => fw?.selectAll() },
      ],
    },
    {
      title: 'View', items: () => [
        { label: 'as Icons', key: '⌘1', checked: fw?.view === 'icon', action: () => fw?.setView('icon') },
        { label: 'as List', key: '⌘2', checked: fw?.view === 'list', action: () => fw?.setView('list') },
        { label: 'as Columns', key: '⌘3', checked: fw?.view === 'column', action: () => fw?.setView('column') },
        { label: 'as Gallery', key: '⌘4', checked: fw?.view === 'gallery', action: () => fw?.setView('gallery') },
        { type: 'sep' },
        { label: fw?.previewPane ? 'Hide Preview' : 'Show Preview', key: '⇧⌘P', action: () => fw?.togglePreviewPane() },
        { label: fw?.pathBar ? 'Hide Path Bar' : 'Show Path Bar', key: '⌥⌘P', action: () => fw?.togglePathBar() },
        { label: fw?.statusBar ? 'Hide Status Bar' : 'Show Status Bar', key: '⌘/', action: () => fw?.toggleStatusBar() },
        { label: fw?.sidebarOn ? 'Hide Sidebar' : 'Show Sidebar', key: '⌃⌘S', action: () => fw?.toggleSidebar() },
        { type: 'sep' },
        { label: 'Show View Options', key: '⌘J', action: () => fw?.toggleViewOptions() },
        { type: 'sep' },
        { label: 'Enter Full Screen', key: '⌃⌘F', action: () => win && wm.toggleZoom(win) },
      ],
    },
    {
      title: 'Go', items: () => [
        { label: 'Back', key: '⌘[', disabled: !fw?.canBack(), action: () => fw?.back() },
        { label: 'Forward', key: '⌘]', disabled: !fw?.canForward(), action: () => fw?.forward() },
        { label: 'Enclosing Folder', key: '⌘↑', disabled: !fw || fw.path === '/', action: () => fw && fw.navigate(dirName(fw.path)) },
        { type: 'sep' },
        ...[...FAVORITES, homeRow()].map(f => ({
          label: f.label, key: f.key,
          action: () => f.special ? (f.special === 'airdrop' ? fw?.showAirDrop() : fw?.showRecents()) : fw?.navigate(f.path),
        })),
        { type: 'sep' },
        { label: 'iCloud Drive', action: () => fw?.navigate(fs.ICLOUD) },
        { label: 'Shared', action: () => fw?.navigate(fs.HOME + '/Public') },
        { label: 'Network', key: '⇧⌘K', action: () => { unmounted.delete('network'); fw?.renderSidebar(); notify('Finder', 'No other computers are on the network'); } },
        { type: 'sep' },
        { label: 'Go to Folder…', key: '⇧⌘G', action: () => fw?.goToFolder() },
      ],
    },
  ];
}

/* ── window ────────────────────────────────────────────────────────── */
function openFinder(opts = {}) {
  const path = opts.path && fs.get(opts.path) ? opts.path : fs.HOME;
  const existing = opts.reuse ? wm.byApp('finder').find(w => w.state !== 'min') : null;
  if (existing && opts.focusExisting) { wm.focus(existing); return existing; }
  /* the Trash window is titled "Trash" on a real Mac, without the dot */
  const name = path === fs.TRASH ? 'Trash' : fs.nodeName(path);
  const win = wm.open({
    app: 'finder', key: opts.key || `win${Date.now().toString(36)}`,
    title: name || 'Macintosh HD',
    width: 940, height: 600, minWidth: 560, minHeight: 320,
    data: { path, view: opts.view || 'icon' },
    getData: w => ({
      path: w._finder?.path, view: w._finder?.view,
      history: w._finder?.history?.slice(-20), historyIndex: w._finder?.historyIndex,
      pathBar: w._finder?.pathBar, statusBar: w._finder?.statusBar,
      preview: w._finder?.previewPane, sidebar: w._finder?.sidebarOn,
    }),
    build: w => new FinderWindow(w, opts).mount(),
    onClose: w => { w._finder?.unsubscribe?.(); save(); },
  });
  /* ⌘N from the shell asks the front window where to open */
  win._findLastPath = () => win._finder?.path;
  return win;
}

class FinderWindow {
  constructor(win, opts) {
    this.win = win;
    this.path = opts.path && fs.get(opts.path) ? opts.path : fs.HOME;
    this.view = opts.view || 'icon';
    this.history = [this.path];
    this.historyIndex = 0;
    this.selection = new Set(opts.select ? [opts.select] : []);
    this.query = '';
    this.scope = 'mac';
    this.pathBar = !!opts.pathBar;
    this.statusBar = opts.statusBar !== false;
    this.sidebarOn = opts.sidebar !== false;
    this.previewPane = !!opts.preview;
    this.lastIdx = null;
    this.cols = { name: 200, date: 150, size: 84, kind: 130 }; // list column widths, px
    this.opts = opts;
    this.win._finder = this;
  }
  mount() {
    const win = this.win;
    /* sidebar */
    this.sidebar = el('aside.sidebar');
    /* toolbar */
    this.backBtn = el('button.tb-btn', { html: glyph('chevL'), title: 'Back', onclick: () => this.back() });
    this.fwdBtn = el('button.tb-btn', { html: glyph('chevR'), title: 'Forward', onclick: () => this.forward() });
    this.viewSeg = el('div.seg', null,
      ...[['icon', 'grid', 'Icon view'], ['list', 'list', 'List view'], ['column', 'columns', 'Column view'], ['gallery', 'gallery', 'Gallery view']].map(([id, g, title]) =>
        el('button' + (this.view === id ? '.on' : ''), {
          dataset: { view: id }, html: glyph(g), title,
          onclick: () => this.setView(id),
        })),
    );
    this.searchInput = el('input', {
      type: 'search', placeholder: 'Search',
      oninput: e => { this.query = e.target.value; this.renderFiles(); this.renderScopeBar(); },
    });
    this.searchBox = el('div.search-field', { style: { width: '160px' } }, el('span', { html: glyph('search') }), this.searchInput);
    win.tbTools.append(this.backBtn, this.fwdBtn);
    win.tbRight.append(this.viewSeg,
      el('button.tb-btn', { html: glyph('share'), title: 'Share', onclick: e => this.shareMenu(e) }),
      el('button.tb-btn', { html: glyph('tag'), title: 'Tags', onclick: e => this.tagMenu(e) }),
      el('button.tb-btn', { html: glyph('ellipsis'), title: 'More', onclick: e => this.moreMenu(e) }),
      this.searchBox,
    );
    /* content: scope bar, files + optional preview pane, path bar, status */
    this.files = el('div.fx-files.scroll');
    this.side = el('aside.fx-side', { hidden: !this.previewPane });
    this.content = el('div.fx-content', null, this.files, this.side);
    this.scopeBar = el('div.fx-scope', { hidden: true });
    this.status = el('div.fx-status', { hidden: !this.statusBar });
    this.crumbs = el('div.fx-pathbar', { hidden: !this.pathBar });
    this.win.setSidebar(this.sidebar, 196);
    this.win.body.append(el('div.main-pane', null, this.scopeBar, this.content, this.crumbs, this.status));
    if (!this.sidebarOn) this.applySidebar();
    this.renderSidebar();
    this.render();
    this.bindKeys();
    this.bindFileArea();
    const offFs = on('fs:change', () => { if (this.win.state !== 'min') this.render(); });
    this.unsubscribe = () => { offFs(); this.closeViewOptions(); this.closeQuickLook(); };
    if (this.opts?.info) {
      if (this.opts.info !== 'folder') { this.selection.clear(); this.selection.add(this.opts.info); }
      setTimeout(() => this.getInfo(), 60);
    }
  }
  bindFileArea() {
    const files = this.files;
    files.addEventListener('contextmenu', e => {
      if (e.target.closest('.fx-item, .fx-row, .fx-col-row, .fx-thumb, .fx-preview, .fx-hero')) return;
      e.preventDefault();
      this.backgroundMenu(e.clientX, e.clientY);
    });
    files.addEventListener('pointerdown', e => {
      if (e.target.closest('.fx-item, .fx-row, .fx-col-row, .fx-thumb')) return;
      if (e.button !== 0) return;
      /* icon view drags a marquee; other views just clear the selection */
      if (this.view === 'icon') this.beginMarquee(e);
      else if (!e.shiftKey && !e.metaKey && !e.ctrlKey) { this.selection.clear(); this.paintSelection(); }
    });
    /* Drop targets are delegated so re-rendering never loses them:
       a drop lands on a folder cell when one is under the cursor, otherwise
       on the current folder. Sidebar rows carry their own drop zones. */
    dropZone(files, {
      accept: payload => payload?.type === 'fs' && this.path !== fs.TRASH,
      onDrop: (payload, e) => {
        const cell = e.target.closest?.('.fx-item, .fx-row, .fx-col-row, .fx-thumb');
        const node = cell ? (this.items || []).find(n => n.id === cell.dataset.id && n.type === 'dir') : null;
        const target = node ? fs.pathOf(node) : this.path;
        for (const item of payload.nodes) {
          if (item === node) continue;
          try { fs.move(fs.pathOf(item), target); notify('Finder', `${item.name} moved to ${baseName(target)}`); }
          catch (err) { notify('Finder', err.message); }
        }
        this.render();
      },
    });
  }
  /* rubber-band selection over the icon grid, like dragging on the Desktop */
  beginMarquee(e) {
    const host = this.files;
    const rect0 = host.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const box = el('div.fx-marquee');
    let active = false;
    const additive = e.shiftKey;
    const move = ev => {
      const x = Math.min(sx, ev.clientX), y = Math.min(sy, ev.clientY);
      const w = Math.abs(ev.clientX - sx), h = Math.abs(ev.clientY - sy);
      if (!active && w < 4 && h < 4) return;
      if (!active) { active = true; if (!additive) this.selection.clear(); host.append(box); }
      const r = host.getBoundingClientRect();
      Object.assign(box.style, {
        left: (x - r.left + host.scrollLeft) + 'px', top: (y - r.top + host.scrollTop) + 'px',
        width: w + 'px', height: h + 'px',
      });
      const mq = { left: x, right: x + w, top: y, bottom: y + h };
      for (const cell of $$('.fx-item', host)) {
        const c = cell.getBoundingClientRect();
        const hit = c.left < mq.right && c.right > mq.left && c.top < mq.bottom && c.bottom > mq.top;
        if (hit) this.selection.add(cell.dataset.id);
        else if (!additive) this.selection.delete(cell.dataset.id);
      }
      this.paintSelection();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      box.remove();
      if (!active && !additive) { this.selection.clear(); this.paintSelection(); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ── navigation ─────────────────────────────────────────────────── */
  navigate(path, { push = true } = {}) {
    if (path === 'recents') { this.showRecents(); return; }
    if (!fs.get(path)) { notify('Finder', `The folder “${baseName(path)}” does not exist.`); return; }
    this.specialView = null;
    this.path = path;
    this.selection.clear();
    this.lastIdx = null;
    this.query = '';
    this.scope = 'mac';
    this.searchInput.value = '';
    if (push) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(path);
      this.historyIndex = this.history.length - 1;
    }
    this.render();
    save();
  }
  canBack() { return this.historyIndex > 0; }
  canForward() { return this.historyIndex < this.history.length - 1; }
  back() { if (this.canBack()) { this.historyIndex--; this.navigate(this.history[this.historyIndex], { push: false }); } }
  forward() { if (this.canForward()) { this.historyIndex++; this.navigate(this.history[this.historyIndex], { push: false }); } }
  goToFolder() {
    const input = el('input.field', { placeholder: 'Go to folder: /Users/bunny/…', style: { width: '260px' }, value: this.path });
    const box = el('div.dialog-box', null,
      el('h3', { text: 'Go to Folder' }),
      el('div', { style: { margin: '12px 0' } }, input),
      el('div.row', null,
        el('button.btn', { text: 'Cancel', onclick: () => dlg.remove() }),
        el('button.btn.primary', { text: 'Go', onclick: () => { const p = fs.resolve(input.value, fs.HOME); dlg.remove(); this.navigate(p); } }),
      ));
    const dlg = el('div.dialog', { style: { position: 'absolute', inset: '0', zIndex: '40' } }, box);
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const p = fs.resolve(input.value, fs.HOME); dlg.remove(); this.navigate(p); } });
    dlg.addEventListener('pointerdown', e => { if (e.target === dlg) dlg.remove(); });
    this.win.body.append(dlg);
    setTimeout(() => input.focus(), 20);
  }

  /* ── sidebar ────────────────────────────────────────────────────── */
  renderSidebar() {
    const activePath = this.path;
    const special = this.specialView;
    const row = (label, iconHtml, onClick, opts = {}) => {
      const b = el('button.sb-item' + (opts.on ? '.on' : ''), {
        onclick: onClick,
        dataset: { path: opts.path || '', tag: opts.tag || '', special: opts.special || '' },
      },
        opts.color
          ? el('span.fx-tag-dot', { style: { background: opts.color } })
          : el('span', { html: iconHtml }),
        el('span.truncate', { text: label }),
        /* removable and remote volumes show an eject button on hover */
        opts.ejectable ? el('span.fx-eject', {
          html: EJECT_ICON, title: `Eject “${label}”`,
          onclick: e => {
            e.stopPropagation();
            unmounted.add(opts.special || opts.path || label);
            this.renderSidebar();
          },
        }) : null,
      );
      /* every row with a real destination accepts drops; a tag row tags */
      if (opts.path || opts.tag || opts.special === 'airdrop') dropZone(b, {
        accept: payload => payload?.type === 'fs',
        onDrop: payload => this.sidebarDrop(opts, payload),
      });
      return b;
    };
    const pathRow = f => row(f.label, glyph(f.icon), () => this.navigate(f.path), {
      path: f.path, on: !special && activePath === f.path,
    });
    this.sidebar.replaceChildren(
      el('div.sb-section', { text: 'Favorites' }),
      row('AirDrop', glyph('airdrop'), () => this.showAirDrop(), { special: 'airdrop', on: special === 'airdrop' }),
      row('Recents', glyph('clock'), () => this.showRecents(), { special: 'recents', on: special === 'recents' }),
      ...FAVORITES.slice(2).map(pathRow),
      (() => { const h = homeRow(); return pathRow(h); })(),
      el('div.sb-section', { text: 'iCloud' }),
      row('iCloud Drive', glyph('globe'), () => this.navigate(fs.ICLOUD), { path: fs.ICLOUD, on: !special && activePath === fs.ICLOUD }),
      row('Shared', glyph('users'), () => this.navigate(fs.HOME + '/Public'), { path: fs.HOME + '/Public', on: !special && activePath === fs.HOME + '/Public' }),
      el('div.sb-section', { text: 'Locations' }),
      row('Macintosh HD', HD_ICON, () => this.navigate('/'), { path: '/', on: !special && activePath === '/' }),
      unmounted.has('network') ? null
        : row('Network', glyph('wifi'), () => notify('Finder', 'No other computers are on the network'), { special: 'network', ejectable: true }),
      el('div.sb-section', { text: 'Tags' }),
      ...TAGS.map(t => row(t.label, null, () => this.showTag(t), { color: t.color, tag: t.label, on: special === 'tag:' + t.label })),
    );
  }
  sidebarDrop(opts, payload) {
    if (opts.tag) {
      for (const n of payload.nodes) fs.setTag(fs.pathOf(n), opts.tag);
      return;
    }
    if (opts.special === 'airdrop') { notify('AirDrop', 'No one nearby to share with'); return; }
    if (!opts.path) return;
    for (const node of payload.nodes) {
      try { fs.move(fs.pathOf(node), opts.path); } catch (err) { notify('Finder', err.message); }
    }
  }
  showAirDrop() {
    this.specialView = 'airdrop';
    this.items = [];
    this.files.replaceChildren(el('div', { style: { padding: '60px', textAlign: 'center' } },
      el('div', { html: glyph('airdrop', 'glyph'), style: { width: '54px', height: '54px', margin: '0 auto 14px', color: 'var(--accent)' } }),
      el('div', { text: 'AirDrop' }),
      el('div', { style: { color: 'var(--text-3)', marginTop: '4px' }, text: 'No one else is sharing nearby.' })));
    this.status.textContent = 'AirDrop';
    this.win.setTitle('AirDrop');
    this.renderSidebar();
    this.renderScopeBar();
    this.renderSide();
  }
  showRecents() {
    this.specialView = 'recents';
    this.items = fs.recentlyUsed(30);
    this.win.setTitle('Recents');
    this.renderSidebar();
    this.renderFiles();
    this.renderScopeBar();
  }
  showTag(tag) {
    this.specialView = 'tag:' + tag.label;
    this.items = fs.walkAll().filter(n => n.tag === tag.label);
    this.win.setTitle(tag.label);
    this.renderSidebar();
    this.renderFiles();
    this.renderScopeBar();
  }

  /* ── rendering ──────────────────────────────────────────────────── */
  render() {
    if (!this.specialView) {
      this.win.setTitle(this.path === '/' ? 'Macintosh HD' : baseName(this.path));
      this.items = fs.children(this.path);
    }
    this.renderSidebar();
    this.renderFiles();
    this.renderStatus();
    this.renderPathBar();
    this.renderScopeBar();
    this.backBtn.disabled = !this.canBack();
    this.fwdBtn.disabled = !this.canForward();
  }
  renderPathBar() {
    this.crumbs.hidden = !this.pathBar;
    if (!this.pathBar) return;
    const parts = this.path === '/' ? [] : this.path.split('/').filter(Boolean);
    const nodes = [{ label: 'Macintosh HD', path: '/' }];
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      nodes.push({ label: part, path: acc });
    }
    this.crumbs.replaceChildren(...nodes.flatMap((node, i) => {
      const crumb = el('button.fx-crumb-item', { text: node.label, onclick: () => this.navigate(node.path) });
      return i ? [el('span.fx-crumb-sep', { html: glyph('chevR') }), crumb] : [crumb];
    }));
  }
  renderScopeBar() {
    const q = this.query.trim();
    this.scopeBar.hidden = !q;
    if (!q) return;
    const folderName = this.specialView ? this.win.title
      : this.path === '/' ? 'Macintosh HD' : baseName(this.path);
    const btn = (label, key) => el('button.fx-scope-btn' + (this.scope === key ? '.on' : ''), {
      text: label,
      onclick: () => { this.scope = key; this.renderFiles(); this.renderScopeBar(); },
    });
    this.scopeBar.replaceChildren(
      el('span', { text: 'Search:', style: { color: 'var(--text-3)' } }),
      btn('This Mac', 'mac'),
      this.specialView ? null : btn(`“${folderName}”`, 'folder'),
      el('span', { style: { marginLeft: 'auto', color: 'var(--text-3)' }, text: `${this.currentItems().length} found` }),
    );
  }
  /* the Show Preview pane: whatever is selected, drawn big with its facts */
  renderSide() {
    this.side.hidden = !this.previewPane;
    if (!this.previewPane) return;
    const node = this.selectedNodes()[0] || (this.currentItems().length === 1 ? this.currentItems()[0] : null);
    if (!node) {
      this.side.replaceChildren(el('div', { style: { color: 'var(--text-3)', fontSize: '11.5px', padding: '18px 6px', textAlign: 'center' }, text: 'Nothing selected' }));
      return;
    }
    const tag = node.tag ? TAGS.find(t => t.label === node.tag) : null;
    this.side.replaceChildren(
      el('div.fx-side-ic', { html: this.bigIcon(node) }),
      el('b.fx-side-name', { text: node.name }),
      el('div.fx-side-kind', { text: kindLabel(node) }),
      el('div.fx-side-facts', null,
        sideRow('Size', node.type === 'dir' ? `${dirStats(node).count} items` : fmtSize(nodeBytes(node))),
        sideRow('Created', fmtStamp(node.created)),
        sideRow('Modified', fmtStamp(node.modified)),
        tag ? sideRow('Tag', tag.label) : null,
      ),
    );
  }
  currentItems() {
    let pool;
    if (this.query.trim()) {
      const q = this.query.toLowerCase();
      pool = this.specialView ? (this.items || [])
        : this.scope === 'folder'
          ? fs.walkAll().filter(n => { const p = fs.pathOf(n) || ''; return p.startsWith(this.path === '/' ? '/' : this.path + '/'); })
          : fs.walkAll();
      pool = pool.filter(n => n.name.toLowerCase().includes(q));
    } else pool = this.items || [];
    return this.applySort(pool);
  }
  applySort(list) {
    const o = optsFor(this.path);
    const arr = list.slice();
    const name = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const cmp = {
      name,
      modified: (a, b) => a.modified - b.modified || name(a, b),
      size: (a, b) => (a.type === 'dir' ? -1 : nodeBytes(a)) - (b.type === 'dir' ? -1 : nodeBytes(b)) || name(a, b),
      kind: (a, b) => kindLabel(a).localeCompare(kindLabel(b)) || name(a, b),
    }[o.sort] || name;
    arr.sort((a, b) => {
      /* folders keep their own group ahead of files when sorting by name */
      if (o.sort === 'name' && a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return (o.asc ? 1 : -1) * cmp(a, b);
    });
    return arr;
  }
  sortBy(key) {
    const o = optsFor(this.path);
    if (o.sort === key) o.asc = !o.asc;
    else { o.sort = key; o.asc = true; }
    this.renderFiles();
  }
  applyViewOpts() {
    const o = optsFor(this.path);
    this.files.style.setProperty('--fx-icon', o.icon + 'px');
    this.files.style.setProperty('--fx-cols',
      `minmax(${this.cols.name}px, 2fr) ${this.cols.date}px ${this.cols.size}px ${this.cols.kind}px`);
  }
  bigIcon(node) {
    if (node.kind === 'image') return artFor(node);
    if (node.type === 'dir') return folderIcon(node.name);
    return fileIcon(node);
  }
  renderFiles() {
    const items = this.currentItems();
    this.files.replaceChildren();
    this.applyViewOpts();
    if (this.specialView === 'airdrop') { this.renderSide(); return; }
    if (!items.length) {
      this.files.append(el('div', { style: { padding: '40px', textAlign: 'center', color: 'var(--text-3)' }, text: this.query ? 'No Results' : 'Folder is empty' }));
      this.renderSide();
      return;
    }
    if (this.view === 'list') this.renderList(items);
    else if (this.view === 'column') this.renderColumns(items);
    else if (this.view === 'gallery') this.renderGallery(items);
    else this.renderGrid(items);
    this.renderSide();
  }
  tagDot(node) {
    if (!node.tag) return null;
    return el('span.fx-tag-dot', { style: { background: tagColor(node.tag) }, title: `Tag: ${node.tag}` });
  }
  renderColumns(items) {
    const wrap = el('div.fx-columns');
    const columns = [[this.path, items]];
    /* the drill chain: each selected folder opens the next column */
    let current = items.find(n => this.selection.has(n.id));
    let guard = 0;
    while (current && current.type === 'dir' && guard++ < 6) {
      const kids = fs.children(current);
      columns.push([fs.pathOf(current), kids]);
      current = kids.find(n => this.selection.has(n.id));
    }
    columns.forEach(([dir, entries]) => {
      const col = el('div.fx-col.scroll');
      for (const node of entries) {
        const row = el('div.fx-col-row' + (this.selection.has(node.id) ? '.sel' : ''), { dataset: { id: node.id } },
          el('span.ic', { html: node.type === 'dir' ? folderIcon(node.name) : fileIcon(node) }),
          el('span.truncate', { text: node.name }),
          this.tagDot(node),
          node.type === 'dir' ? el('span.arrow', { html: glyph('chevR') }) : null,
        );
        row.addEventListener('click', e => {
          if (e.metaKey || e.ctrlKey) { this.selection.has(node.id) ? this.selection.delete(node.id) : this.selection.add(node.id); }
          else { this.selection.clear(); this.selection.add(node.id); }
          /* clicking a folder drills: rebuild the columns from the selection */
          if (node.type === 'dir') this.renderFiles();
          else this.paintSelection();
        });
        row.addEventListener('dblclick', () => this.open(node));
        row.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); this.itemMenu(node, e.clientX, e.clientY); });
        col.append(row);
      }
      if (!entries.length) col.append(el('div', { style: { padding: '10px', color: 'var(--text-3)', fontSize: '11.5px' }, text: 'Empty' }));
      wrap.append(col);
    });
    /* the last column is the preview of whatever is selected */
    const sel = this.selectedNodes()[0];
    const pad = el('div.fx-col.fx-col-preview', null,
      sel ? [
        el('div', { html: this.bigIcon(sel), style: { width: '96px', height: '96px', margin: '10px auto 8px', display: 'block' } }),
        el('div', { style: { textAlign: 'center', fontSize: '12px', fontWeight: '600', overflowWrap: 'anywhere' }, text: sel.name }),
        el('div', { style: { textAlign: 'center', fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }, text: kindLabel(sel) }),
      ] : el('div', { style: { padding: '10px', color: 'var(--text-3)', fontSize: '11px', textAlign: 'center' }, text: 'No selection' }));
    wrap.append(pad);
    this.files.append(wrap);
  }
  /* Gallery view is a filmstrip: one big preview above a strip of frames */
  renderGallery(items) {
    const wrap = el('div.fx-film');
    const hero = el('div.fx-hero');
    const paint = node => {
      hero.replaceChildren(
        el('div.fx-hero-ic', { html: this.bigIcon(node) }),
        el('div.fx-hero-meta', null,
          el('b', { text: node.name }),
          el('span', { text: `${kindLabel(node)}${node.type === 'dir' ? ` — ${fs.children(node).length} items` : ' — ' + fmtSize(nodeBytes(node))}` })),
      );
    };
    const sel = this.selectedNodes()[0] || items[0];
    paint(sel);
    const strip = el('div.fx-strip');
    for (const node of items) {
      const cell = el('div.fx-thumb' + (this.selection.has(node.id) ? '.sel' : ''), { dataset: { id: node.id } },
        el('div.ic', { html: node.type === 'dir' ? folderIcon(node.name) : fileIcon(node) }),
        el('div.nm', { text: node.name }),
      );
      cell.addEventListener('click', () => paint(node));
      this.wireItem(cell, node);
      strip.append(cell);
    }
    wrap.append(hero, strip);
    this.files.append(wrap);
  }
  renderGrid(items) {
    const o = optsFor(this.path);
    const grid = el('div.fx-grid' + (o.labels === 'right' ? '.labels-right' : ''));
    for (const node of items) {
      const cell = el('div.fx-item' + (this.selection.has(node.id) ? '.sel' : ''), { dataset: { id: node.id } },
        el('div.ic', { html: node.type === 'dir' ? folderIcon(node.name) : fileIcon(node) }),
        el('div.nm', { text: node.name }),
        this.tagDot(node),
      );
      this.wireItem(cell, node);
      grid.append(cell);
    }
    this.files.append(grid);
  }
  renderList(items) {
    const o = optsFor(this.path);
    const heads = [['name', 'Name'], ['modified', 'Date Modified'], ['size', 'Size'], ['kind', 'Kind']];
    const head = el('div.fx-head', null,
      ...heads.map(([key, label], i) => el('button.fx-hcell' + (o.sort === key ? '.on' : ''), {
        onclick: () => this.sortBy(key),
      },
        el('span', { text: label }),
        o.sort === key ? el('span.fx-sort-arrow', { text: o.asc ? '▲' : '▼' }) : null,
        i < heads.length - 1 ? el('span.fx-rez', {
          dataset: { col: key },
          onpointerdown: e => this.startColResize(e, key),
          onclick: e => e.stopPropagation(),
        }) : null,
      )),
    );
    const list = el('div.fx-list');
    for (const node of items) {
      const row = el('div.fx-row' + (this.selection.has(node.id) ? '.sel' : ''), { dataset: { id: node.id } },
        el('div.ic', { style: { display: 'flex', alignItems: 'center', gap: '7px' } },
          el('span', { html: node.type === 'dir' ? folderIcon(node.name) : fileIcon(node), style: { width: '17px', height: '17px', display: 'block', flex: 'none' } }),
          el('span.name', { text: node.name }),
          this.tagDot(node)),
        el('div', { text: fmtStamp(node.modified).replace(/,.*at/, '').replace(/, \d{4}/, '') }),
        el('div', { text: node.type === 'dir' ? '--' : fmtSize(nodeBytes(node)) }),
        el('div', { text: kindLabel(node) }),
      );
      this.wireItem(row, node);
      list.append(row);
    }
    this.files.append(head, list);
  }
  /* drag the divider between two list headers to resize the column */
  startColResize(e, key) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startW = this.cols[key];
    const move = ev => {
      this.cols[key] = clamp(startW + ev.clientX - startX, 56, 640);
      this.applyViewOpts();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  renderStatus() {
    const items = this.currentItems();
    const selected = items.filter(n => this.selection.has(n.id));
    if (this.path === fs.TRASH) {
      this.status.replaceChildren(
        el('span', { text: `${items.length} item${items.length === 1 ? '' : 's'}` }),
        el('button.btn', { text: 'Empty Trash', disabled: !items.length, onclick: () => this.emptyTrash() }),
      );
      return;
    }
    const used = fs.usedBytes();
    const freeGb = Math.max(0, 494.38 - used / 1e9);
    this.status.textContent = `${selected.length || items.length} item${(selected.length || items.length) === 1 ? '' : 's'}, ${freeGb.toFixed(2)} GB available`;
  }

  /* ── item interaction ───────────────────────────────────────────── */
  wireItem(cell, node) {
    cell.addEventListener('pointerdown', e => {
      if (e.button === 2) return;
      const items = this.currentItems();
      const idx = items.findIndex(n => n.id === node.id);
      if (e.shiftKey && this.lastIdx != null && idx >= 0) {
        /* range select from the last plain click */
        const [a, b] = [Math.min(this.lastIdx, idx), Math.max(this.lastIdx, idx)];
        if (!e.metaKey && !e.ctrlKey) this.selection.clear();
        for (let i = a; i <= b; i++) this.selection.add(items[i].id);
      } else if (e.metaKey || e.ctrlKey) {
        this.selection.has(node.id) ? this.selection.delete(node.id) : this.selection.add(node.id);
        this.lastIdx = idx;
      } else if (!this.selection.has(node.id)) {
        this.selection.clear(); this.selection.add(node.id); this.lastIdx = idx;
      } else this.lastIdx = idx;
      this.paintSelection();
      const startX = e.clientX, startY = e.clientY;
      const move = ev => {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const nodes = this.currentItems().filter(n => this.selection.has(n.id));
        if (!nodes.length) return;
        startDrag(ev, { type: 'fs', nodes }, payload => {
          const g = el('div', {
            style: {
              position: 'fixed', zIndex: 13000, pointerEvents: 'none', display: 'flex', gap: '4px',
              filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.35))',
            },
          });
          payload.nodes.slice(0, 3).forEach((n, i) => {
            g.append(el('div', { html: n.type === 'dir' ? folderIcon(n.name) : fileIcon(n), style: { width: '54px', height: '54px', marginLeft: i ? '-26px' : 0 } }));
          });
          return g;
        });
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    cell.addEventListener('dblclick', () => this.open(node));
    cell.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      if (!this.selection.has(node.id)) { this.selection.clear(); this.selection.add(node.id); this.paintSelection(); }
      this.itemMenu(node, e.clientX, e.clientY);
    });
  }
  itemMenu(node, x, y) {
    const inTrash = this.path === fs.TRASH;
    const choices = openWithChoices(node);
    contextMenu([
      { label: 'Open', action: () => this.open(node) },
      ...(choices.length > 1 ? [{ label: 'Open With', sub: choices.map(id => ({ label: appName(id), action: () => openWith(node, id) })) }] : []),
      ...(node.type === 'dir' ? [{ label: 'Open in New Window', action: () => openFinder({ path: fs.pathOf(node) }) }] : []),
      { label: 'New Terminal at Folder', action: () => { launch('terminal', { cwd: node.type === 'dir' ? fs.pathOf(node) : dirName(fs.pathOf(node)) }); } },
      { type: 'sep' },
      { label: 'Get Info', key: '⌘I', action: () => this.getInfo() },
      { label: 'Quick Look', key: 'Space', action: () => this.quickLook() },
      {
        label: 'Tags…', sub: TAGS.map(t => ({
          label: t.label, checked: this.selectedNodes().some(n => n.tag === t.label),
          action: () => {
            const next = this.selectedNodes().every(n => n.tag === t.label) ? undefined : t.label;
            for (const n of this.selectedNodes()) fs.setTag(fs.pathOf(n), next);
          },
        })),
      },
      { label: 'Rename', action: () => this.beginRename() },
      { label: 'Duplicate', key: '⌘D', action: () => this.duplicate() },
      { type: 'sep' },
      { label: 'Copy', key: '⌘C', action: () => this.copy() },
      { label: 'Cut', key: '⌘X', action: () => this.cut() },
      { type: 'sep' },
      inTrash
        ? { label: 'Put Back', action: () => { fs.restoreFromTrash(fs.pathOf(node)); } }
        : { label: 'Move to Trash', danger: true, action: () => this.trashSelection() },
    ], x, y);
  }
  backgroundMenu(x, y) {
    contextMenu([
      { label: 'New Folder', key: '⇧⌘N', action: () => this.newFolder() },
      { label: 'New Folder with Selection', disabled: !this.hasSelection(), action: () => this.newFolderWithSelection() },
      { label: 'New Finder Window', action: () => openFinder({ path: this.path }) },
      { type: 'sep' },
      { label: 'Paste', key: '⌘V', disabled: !clipboard, action: () => this.paste() },
      { label: 'Select All', key: '⌘A', action: () => this.selectAll() },
      { type: 'sep' },
      { label: 'as Icons', checked: this.view === 'icon', action: () => this.setView('icon') },
      { label: 'as List', checked: this.view === 'list', action: () => this.setView('list') },
      { label: 'as Columns', checked: this.view === 'column', action: () => this.setView('column') },
      { label: 'as Gallery', checked: this.view === 'gallery', action: () => this.setView('gallery') },
      { type: 'sep' },
      { label: this.pathBar ? 'Hide Path Bar' : 'Show Path Bar', action: () => this.togglePathBar() },
      { label: this.previewPane ? 'Hide Preview' : 'Show Preview', action: () => this.togglePreviewPane() },
      { label: 'Show View Options', action: () => this.toggleViewOptions() },
    ], x, y);
  }
  open(node) {
    if (!node) return;
    if (node.type === 'dir') { this.navigate(fs.pathOf(node)); return; }
    if (node.kind === 'app') { launch(node.app); return; }
    if (!openWith(node)) notify('Finder', `There is no application set to open “${node.name}”.`);
  }
  openSelection() { for (const n of this.selectedNodes()) this.open(n); }
  openInTerminal() {
    const node = this.selectedNodes()[0];
    const dir = node ? (node.type === 'dir' ? fs.pathOf(node) : dirName(fs.pathOf(node))) : this.path;
    launch('terminal', { cwd: dir });
  }
  selectedNodes() { return this.currentItems().filter(n => this.selection.has(n.id)); }
  hasSelection() { return this.selectedNodes().length > 0; }
  selectAll() { this.currentItems().forEach(n => this.selection.add(n.id)); this.renderFiles(); this.renderStatus(); }
  setView(v) {
    this.view = v;
    $$('button', this.viewSeg).forEach(b => b.classList.toggle('on', b.dataset.view === v));
    this.renderFiles();
  }
  focusSearch() { this.searchInput.focus(); this.searchInput.select(); }
  newFolder(nodes) {
    if (this.path === fs.TRASH) { notify('Finder', 'You cannot make a folder in the Trash.'); return null; }
    const node = fs.mkdir(this.path, 'untitled folder');
    if (nodes?.length) for (const n of nodes) { try { fs.move(fs.pathOf(n), fs.pathOf(node)); } catch (err) { notify('Finder', err.message); } }
    this.selection.clear(); this.selection.add(node.id);
    this.render();
    setTimeout(() => this.beginRename(), 40);
    return node;
  }
  newFolderWithSelection() {
    const nodes = this.selectedNodes();
    if (!nodes.length) return;
    this.newFolder(nodes);
  }
  beginRename() {
    const node = this.selectedNodes()[0];
    if (!node) return;
    const cell = this.files.querySelector(`.fx-item[data-id="${node.id}"] .nm, .fx-list [data-id="${node.id}"] .name, .fx-col-row[data-id="${node.id}"] .truncate, .fx-thumb[data-id="${node.id}"] .nm`);
    if (!cell) return;
    const input = el('input.rename-input', { value: node.name });
    cell.replaceWith(input);
    input.focus(); input.select();
    const finish = ok => {
      if (ok && input.value.trim() && input.value !== node.name) fs.rename(fs.pathOf(node), input.value.trim());
      this.render();
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('dblclick', e => e.stopPropagation());
  }
  duplicate() {
    for (const node of this.selectedNodes()) {
      try { fs.copy(fs.pathOf(node), this.path); } catch (err) { notify('Finder', err.message); }
    }
    this.render();
  }
  trashSelection() {
    const nodes = this.selectedNodes();
    if (!nodes.length) return;
    for (const node of nodes) {
      if (this.path === fs.TRASH) fs.removePermanent(fs.pathOf(node));
      else fs.trashNode(fs.pathOf(node));
    }
    this.selection.clear();
    this.render();
  }
  putBack() {
    const node = this.selectedNodes()[0];
    if (!node) return;
    fs.restoreFromTrash(fs.pathOf(node));
    this.selection.clear();
    this.render();
  }
  putBackAll() {
    for (const node of this.currentItems()) fs.restoreFromTrash(fs.pathOf(node));
    this.render();
  }
  /* Empty Trash asks first, like the real Finder does */
  emptyTrash() {
    const n = fs.trashed().length;
    if (!n) return;
    const box = el('div.dialog-box', null,
      el('h3', { text: 'Empty Trash' }),
      el('p', { text: `Are you sure you want to permanently delete the ${n} item${n === 1 ? '' : 's'} in the Trash? You can’t undo this action.` }),
      el('div.row', null,
        el('button.btn', { text: 'Cancel', onclick: () => dlg.remove() }),
        el('button.btn.primary', {
          text: 'Empty Trash', onclick: () => {
            dlg.remove(); fs.emptyTrash();
            import('../core/sfx.js').then(m => m.trash?.()).catch(() => {});
          },
        }),
      ));
    const dlg = el('div.dialog', { style: { position: 'absolute', inset: '0', zIndex: '40' } }, box);
    dlg.addEventListener('pointerdown', e => { if (e.target === dlg) dlg.remove(); });
    this.win.body.append(dlg);
  }
  cut() { clipboard = { mode: 'cut', nodes: this.selectedNodes() }; this.renderFiles(); }
  copy() { clipboard = { mode: 'copy', nodes: this.selectedNodes() }; this.renderFiles(); }
  paste() {
    if (!clipboard) return;
    for (const node of clipboard.nodes) {
      try {
        if (clipboard.mode === 'cut') fs.move(fs.pathOf(node), this.path);
        else fs.copy(fs.pathOf(node), this.path);
      } catch (err) { notify('Finder', err.message); }
    }
    if (clipboard.mode === 'cut') clipboard = null;
    this.render();
  }
  shareMenu(e) {
    const n = this.selectedNodes().length;
    contextMenu([
      { label: n ? `Share ${n} item${n > 1 ? 's' : ''}…` : 'Share…', disabled: true },
      { label: 'AirDrop', action: () => notify('Finder', 'Sent with AirDrop') },
      { label: 'Copy Link', action: () => notify('Finder', 'Link copied') },
    ], e.clientX, e.clientY);
  }
  tagMenu(e) {
    contextMenu([
      { type: 'title', label: 'Tags' },
      ...TAGS.map(t => ({
        label: t.label, checked: this.selectedNodes().some(n => n.tag === t.label),
        action: () => {
          const next = this.selectedNodes().every(n => n.tag === t.label) ? undefined : t.label;
          for (const n of this.selectedNodes()) fs.setTag(fs.pathOf(n), next);
        },
      })),
    ], e.clientX, e.clientY);
  }
  moreMenu(e) {
    contextMenu([
      { label: 'New Folder', action: () => this.newFolder() },
      { label: 'New Terminal at Folder', action: () => this.openInTerminal() },
      { type: 'sep' },
      { label: 'Show View Options', action: () => this.toggleViewOptions() },
      { label: this.pathBar ? 'Hide Path Bar' : 'Show Path Bar', action: () => this.togglePathBar() },
      { label: this.previewPane ? 'Hide Preview' : 'Show Preview', action: () => this.togglePreviewPane() },
      { type: 'sep' },
      { label: this.path === fs.TRASH ? 'Put Back All' : 'Move to Trash', danger: this.path !== fs.TRASH, action: () => this.trashSelection() },
    ], e.clientX, e.clientY);
  }

  /* ── view toggles — every entry in the View menu is real ─────────── */
  togglePathBar() { this.pathBar = !this.pathBar; this.renderPathBar(); save(); }
  toggleStatusBar() { this.statusBar = !this.statusBar; this.status.hidden = !this.statusBar; save(); }
  togglePreviewPane() { this.previewPane = !this.previewPane; this.renderSide(); save(); }
  toggleSidebar() { this.sidebarOn = !this.sidebarOn; this.applySidebar(); save(); }
  applySidebar() {
    const host = this.win.sbHost;
    if (!host) return;
    host.style.display = this.sidebarOn ? '' : 'none';
    /* with the sidebar gone the traffic lights live in the toolbar instead */
    const traffic = this.win.node.querySelector('.traffic');
    if (traffic) {
      if (this.sidebarOn) host.querySelector('.sb-top')?.append(traffic);
      else this.win.titlebar.prepend(traffic);
    }
  }
  /* ⌘J: the floating View Options panel, applied live like the real one */
  toggleViewOptions() {
    if (this.vopts) { this.closeViewOptions(); return; }
    const o = optsFor(this.path);
    const slider = el('input.range', {
      type: 'range', min: '32', max: '96', step: '2', value: String(o.icon),
      oninput: e => { o.icon = Number(e.target.value); this.applyViewOpts(); },
    });
    const sortSel = el('select.fx-vo-sel', {
      onchange: e => { o.sort = e.target.value; this.renderFiles(); },
    }, ...[['name', 'Name'], ['modified', 'Date Modified'], ['size', 'Size'], ['kind', 'Kind']]
      .map(([v, l]) => el('option', { value: v, text: l, selected: o.sort === v })));
    const posSeg = el('div.seg', null,
      ...[['bottom', 'Bottom'], ['right', 'Right']].map(([v, l]) =>
        el('button' + (o.labels === v ? '.on' : ''), {
          text: l,
          onclick: ev => {
            o.labels = v;
            $$('button', posSeg).forEach(b => b.classList.toggle('on', b === ev.currentTarget));
            this.renderFiles();
          },
        })));
    const panel = el('div.fx-vopts', null,
      el('div.fx-vopts-head', null,
        el('b', { text: baseName(this.path) }),
        el('button.tb-btn', { html: glyph('x'), title: 'Close', onclick: () => this.closeViewOptions() })),
      el('div.vo-row', null, el('label', { text: 'Icon size' }), slider),
      el('div.vo-row', null, el('label', { text: 'Sort by' }), sortSel),
      el('div.vo-row', null, el('label', { text: 'Label position' }), posSeg),
    );
    requestAnimationFrame(() => syncRangeFill(slider));
    this.win.body.append(panel);
    this.vopts = panel;
    /* a click anywhere else dismisses it, like a real floating panel */
    this._voAway = e => { if (!panel.contains(e.target)) this.closeViewOptions(); };
    setTimeout(() => document.addEventListener('pointerdown', this._voAway), 0);
  }
  closeViewOptions() {
    this.vopts?.remove();
    this.vopts = null;
    if (this._voAway) { document.removeEventListener('pointerdown', this._voAway); this._voAway = null; }
  }

  /* Get Info opens a real window, like the Finder does. */
  getInfo() {
    const node = this.selectedNodes()[0];
    const target = node || fs.get(this.path);
    if (!target) return;
    const key = 'info:' + fs.pathOf(target);
    const existing = wm.byApp('finder').find(w => w.key === key);
    if (existing) { wm.focus(existing); return existing; }
    const win = wm.open({
      app: 'finder', key, title: `${target.name} Info`, resizable: false,
      width: 292, height: 400, minWidth: 260, minHeight: 320,
      build: w => {
        w.node.classList.add('info-window');
        w.body.append(this.buildInfoPane(w, target));
      },
    });
    return win;
  }
  buildInfoPane(win, target) {
    const path = fs.pathOf(target);
    const stats = target.type === 'dir' ? dirStats(target) : null;
    const sizeText = stats ? `${fmtSize(stats.bytes)} for ${stats.count} items` : fmtSize(nodeBytes(target));
    const nameInput = el('input.info-name', {
      value: target.name,
      onkeydown: e => {
        e.stopPropagation();
        if (e.key === 'Enter') { fs.rename(path, nameInput.value.trim()); win.setTitle(`${nameInput.value.trim()} Info`); nameInput.blur(); }
        if (e.key === 'Escape') nameInput.blur();
      },
      onblur: () => { if (nameInput.value.trim() && nameInput.value.trim() !== target.name) { fs.rename(path, nameInput.value.trim()); win.setTitle(`${nameInput.value.trim()} Info`); } },
    });
    const choices = openWithChoices(target);
    const openWithSel = choices.length ? el('select.info-sel', {
      onchange: e => { target.openWith = e.target.value === defaultAppFor(target) ? undefined : e.target.value; save(); },
    }, ...choices.map(id => el('option', {
      value: id, text: appName(id) + (id === defaultAppFor(target) ? ' (default)' : ''),
      selected: (target.openWith || defaultAppFor(target)) === id,
    }))) : null;
    const tagPicker = el('div.info-tags', null,
      ...TAGS.map(t => el('button.info-tag' + (target.tag === t.label ? '.on' : ''), {
        style: { background: t.color }, title: t.label,
        onclick: () => {
          fs.setTag(path, target.tag === t.label ? undefined : t.label);
          $$('.info-tag', tagPicker).forEach(d => d.classList.remove('on'));
          if (target.tag === t.label) tagPicker.querySelectorAll('.info-tag')[TAGS.indexOf(t)].classList.add('on');
        },
      })));
    return el('div.info-pane', null,
      el('div.info-hero', null,
        el('div', { html: target.type === 'dir' ? folderIcon(target.name) : fileIcon(target), style: { width: '72px', height: '72px', flex: 'none' } }),
        el('div', { style: { minWidth: '0', flex: '1' } },
          nameInput,
          el('span', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: sizeText })),
      ),
      el('div.info-sec', null,
        infoRow('Kind', kindLabel(target)),
        infoRow('Size', sizeText),
        infoRow('Where', whereLabel(path)),
      ),
      el('div.info-sec', null,
        infoRow('Created', fmtStamp(target.created)),
        infoRow('Modified', fmtStamp(target.modified))),
      el('div.info-sec', null,
        el('div.info-tag-row', null, el('span.info-lab', { text: 'Tags' }), tagPicker)),
      openWithSel ? el('div.info-sec', null,
        el('div.info-tag-row', null, el('span.info-lab', { text: 'Open with' }), openWithSel)) : null,
      el('div.info-sec', null, infoRow('Permissions', target.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--')),
    );
  }
  /* Space opens Quick Look over the selection; Space again closes it.
     Arrows move through the folder without leaving the preview. */
  quickLook() {
    if (this.qlHost) { this.closeQuickLook(); return; }
    const target = this.selectedNodes()[0] || fs.get(this.path);
    if (!target) return;
    const box = el('div.quicklook', null,
      el('div.ql-bar', null,
        el('span.truncate', { text: target.name }),
        el('button.tb-btn', { html: glyph('x'), title: 'Close (Esc)', onclick: () => this.closeQuickLook() })),
      el('div.ql-body'));
    const host = el('div.ql-host', { onclick: e => { if (e.target === host) this.closeQuickLook(); } }, box);
    this.win.body.append(host);
    this.qlHost = host;
    this.qlBox = box;
    this.fillQuickLook(target);
    requestAnimationFrame(() => box.classList.add('in'));
  }
  fillQuickLook(target) {
    if (!this.qlHost) return;
    this.qlBox.querySelector('.ql-bar span').textContent = target.name;
    const body = this.qlBox.querySelector('.ql-body');
    const art = target.type === 'dir'
      ? el('div.ql-folder', null,
          el('div', { html: folderIcon(target.name), style: { width: '150px', height: '150px' } }),
          el('b', { text: target.name }),
          el('span', { text: `${fs.children(target).length} items` }))
      : target.kind === 'app'
        ? el('div.ql-generic', null,
            el('div', { html: appIcon(target.app), style: { width: '128px', height: '128px' } }),
            el('b', { text: target.name }),
            el('span', { text: 'Application' }))
        : target.kind === 'image'
          ? el('div.ql-image', { html: artFor(target) })
          : target.kind === 'audio'
            ? el('div.ql-generic', null,
                el('div', { html: fileIcon(target), style: { width: '120px', height: '120px' } }),
                el('b', { text: target.name }),
                el('span', { text: 'Audio File' }))
            : el('pre.ql-text', { text: (target.content || '').slice(0, 8000) || kindLabel(target) });
    body.replaceChildren(art);
  }
  refreshQuickLook() {
    if (!this.qlHost) return;
    const target = this.selectedNodes()[0];
    if (target) this.fillQuickLook(target);
  }
  closeQuickLook() { this.qlHost?.remove(); this.qlHost = null; this.qlBox = null; }
  bindKeys() {
    this.win.onKey = e => {
      const meta = e.metaKey || e.ctrlKey;
      const ae = document.activeElement;
      const typing = ae && this.win.node.contains(ae) &&
        (ae.isContentEditable || (ae.tagName === 'INPUT' && !/^(button|checkbox|radio|range|color|file|submit)$/i.test(ae.type || 'text')) || ae.tagName === 'TEXTAREA');
      /* while Quick Look is up it owns the arrows, Space and Escape */
      if (this.qlHost) {
        if (e.key === 'Escape' || e.key === ' ') { this.closeQuickLook(); return true; }
        if (e.key.startsWith('Arrow')) {
          this.moveSelection(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
          this.refreshQuickLook();
          return true;
        }
        return true;
      }
      if (typing) {
        if (ae === this.searchInput) {
          if (e.key === 'Enter') { const first = this.currentItems()[0]; if (first) { this.open(first); ae.blur(); } return true; }
          if (e.key === 'Escape') { this.searchInput.value = ''; this.query = ''; ae.blur(); this.renderFiles(); this.renderScopeBar(); return true; }
        }
        return false;
      }
      if (!meta) {
        if (e.key === ' ') { this.quickLook(); return true; }
        if (e.key === 'Enter') { this.beginRename(); return true; }
        if (e.key === 'Escape') {
          if (this.vopts) { this.closeViewOptions(); return true; }
          if (this.selection.size) { this.selection.clear(); this.paintSelection(); return true; }
          return false;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { this.moveSelection(1); return true; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { this.moveSelection(-1); return true; }
        return false;
      }
      /* meta chords that have no printed menu label: ⌘↓ opens, ⌘Delete with
         the forward-delete key, ⌘⇧Delete empties */
      if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey) { this.openSelection(); return true; }
      if (e.key === 'Delete') {
        if (e.shiftKey) this.emptyTrash(); else this.trashSelection();
        return true;
      }
      if (e.key === 'Backspace') {
        /* ⌘⌫ and ⇧⌘⌫ are printed menu labels and are claimed upstream;
           reaching here means the menu was disabled */
        return true;
      }
      return false;
    };
  }
  paintSelection() {
    $$('.fx-item, .fx-row, .fx-col-row, .fx-thumb', this.files).forEach(cell => {
      cell.classList.toggle('sel', this.selection.has(cell.dataset.id));
    });
    this.renderStatus();
    this.renderSide();
    if (this.qlHost) this.refreshQuickLook();
  }
  moveSelection(dir) {
    const items = this.currentItems();
    if (!items.length) return;
    const idx = items.findIndex(n => this.selection.has(n.id));
    const next = items[Math.max(0, Math.min(items.length - 1, idx + dir))];
    if (next) { this.selection.clear(); this.selection.add(next.id); this.paintSelection(); }
  }
}

function sideRow(label, value) {
  return el('div.fx-side-row', null,
    el('span', { style: { color: 'var(--text-3)' }, text: label }),
    el('span', { text: value }));
}
function infoRow(label, value) {
  return el('div', { style: { display: 'flex', gap: '8px', fontSize: '11px', marginBottom: '4px' } },
    el('span', { style: { color: 'var(--text-3)', width: '62px', textAlign: 'right', flex: 'none' }, text: label }),
    el('span.truncate', { text: value }));
}
function kindLabel(node) {
  if (node.type === 'dir') return 'Folder';
  const ext = (node.name.split('.').pop() || '').toLowerCase();
  const byExt = {
    txt: 'Plain Text Document', rtf: 'Rich Text Document', md: 'Markdown Document',
    png: 'PNG Image', jpg: 'JPEG Image', gif: 'GIF Image', svg: 'SVG Image',
    m4a: 'Audio File', mp3: 'MP3 Audio', wav: 'WAV Audio', app: 'Application',
    key: 'Keynote Presentation', numbers: 'Numbers Spreadsheet', pages: 'Pages Document',
  };
  return byExt[ext] || { txt: 'Plain Text Document', image: 'PNG Image', audio: 'Audio File', app: 'Application' }[node.kind] || 'Document';
}

/* bind drop zones and background context menu */
export function initFinder() {
  on('wm:focus', win => {
    const fw = win?._finder;
    if (!fw) return;
    const back = fw.backBtn, fwd = fw.fwdBtn;
    back.disabled = !fw.canBack(); fwd.disabled = !fw.canForward();
    back.style.opacity = fw.canBack() ? 1 : .35;
    fwd.style.opacity = fw.canForward() ? 1 : .35;
  });
  /* the dock wires its own Trash drop zone (js/shell/dock.js) — files dragged
     onto it, sidebar folders and in-window folders all share the same
     `type:'fs'` payload so a single format covers every target */
}

/* per-window wiring is in bindFileArea() above */
export default meta;

/** the same name always draws the same picture */
function seedOf(name) {
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973;
  return h;
}
