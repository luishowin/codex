// Dock: pinned apps, recents, minimized tiles, the Downloads stack, Trash.
// Pinning, reordering, position and autohide are real preferences — they all
// persist through settings and survive a reload.
import { el, on, clamp, rafThrottle } from '../core/util.js';
import { appIcon, fileIcon, folderIcon } from '../core/icons.js';
import { wm } from './wm.js';
import { allApps, getApp, launch, isInstalled } from '../core/os.js';
import { state, setSetting, save } from '../core/store.js';
import { contextMenu, isMenuOpen } from './menus.js';
import { notify } from './notify.js';
import { dropZone } from './dragdrop.js';
import { quitApp } from './menubar.js';
import * as fs from '../core/fs.js';

const dock = () => document.getElementById('dock');
const wrap = () => document.getElementById('dock-wrap');
const layer = () => document.getElementById('windows');
const DOWNLOADS = () => fs.HOME + '/Downloads';
let items = [];
let minHost = null;
let tip = null;
let tipTimer = null;
let edgeEl = null;
let hideTimer = null;
let suppressClick = false;

/* ── pinned apps + recents: settings is the source of truth ────────── */
function pinnedIds() {
  const saved = state.settings.dockPinned;
  let list;
  if (Array.isArray(saved)) list = saved.filter(id => getApp(id) && isInstalled(id));
  else list = allApps().filter(a => a.dock).map(a => a.id);
  if (!list.includes('finder')) list.unshift('finder');   /* Finder never leaves the Dock */
  return list;
}
const isPinned = id => pinnedIds().includes(id);
function setPinned(ids) { setSetting('dockPinned', ids); }
function togglePin(id) { isPinned(id) ? unpinApp(id) : pinApp(id); }
function pinApp(id, at = null) {
  const list = pinnedIds().filter(x => x !== id);
  list.splice(at == null ? list.length : at, 0, id);
  setPinned(list);
}
function unpinApp(id) { if (id !== 'finder') setPinned(pinnedIds().filter(x => x !== id)); }
const loginItems = () => state.settings.loginItems || [];
function toggleLogin(id) {
  const cur = loginItems();
  setSetting('loginItems', cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
}
/* login items open at login — deferred so restored windows win the race */
function openLoginItems() {
  setTimeout(() => { for (const id of loginItems()) if (!wm.byApp(id).length) launch(id); }, 450);
}

/* launched-but-unpinned apps, most recent first */
function recentIds() {
  if (state.settings.dockRecents === false) return [];
  const pinned = new Set(pinnedIds());
  return (state.settings.recentApps || []).filter(id => !pinned.has(id) && getApp(id) && isInstalled(id));
}
let knownOpen = new Set();
function trackLaunches() {
  const open = new Set();
  for (const w of wm.windows) open.add(w.app);
  for (const id of open) {
    if (knownOpen.has(id) || isPinned(id) || !getApp(id)) continue;
    const cur = state.settings.recentApps || [];
    state.settings.recentApps = [id, ...cur.filter(x => x !== id)].slice(0, 8);
    save();
    render();
    break;                       /* one wm:change, one reorder, one render */
  }
  knownOpen = open;
}

export function initDock() {
  render();
  bindMagnify();
  on('wm:change', () => { updateDots(); trackLaunches(); });
  on('app:quit', updateDots);
  on('fs:change', () => { updateTrash(); updateStackIcon(); });
  on('apps:change', render);
  on('settings:change', ({ key }) => {
    if (['dockPosition', 'dockAutoHide', 'dockSize', 'dockMagnify'].includes(key)) applyLayout();
    if (['dockPinned', 'dockRecents', 'recentApps', 'installedApps'].includes(key)) render();
    if (key === 'dockStackDisplay') updateStackIcon();
  });
  updateTrash();
  if (state.settings.booted) openLoginItems();
  else {
    const off = on('boot:done', () => { off(); openLoginItems(); });
  }
}

function dockShell({ id, name, html, cls = '' }) {
  const item = el('button.dock-item' + cls, {
    dataset: { app: id }, title: '', 'aria-label': name,
    style: { '--s': 1 },
  }, el('div.app-icon', { html }), el('div.dot'));
  item.addEventListener('mousedown', e => e.preventDefault());  /* the Dock never keeps the keyboard */
  item.addEventListener('pointerenter', () => scheduleTip(item, name));
  item.addEventListener('pointerleave', hideTip);
  items.push({ el: item, app: id });
  return item;
}

function appItem(id, recent) {
  const app = getApp(id);
  const item = dockShell({ id, name: app.name, html: appIcon(app.icon || id), cls: recent ? '.recent' : '' });
  item.addEventListener('click', () => { if (!suppressClick) activate(id); });
  item.addEventListener('contextmenu', e => { e.preventDefault(); appMenu(id, e.clientX, e.clientY); });
  attachItemDrag(item, id);
  return item;
}

function render() {
  const root = dock();
  if (!root) return;
  /* minimized windows live inside their tiles — carry the tiles across a
     rebuild so a re-render never strands a parked window */
  const tiles = minHost ? Array.from(minHost.children) : [];
  root.replaceChildren();
  items = [];
  for (const id of pinnedIds()) root.append(appItem(id, false));
  root.append(el('div.dock-sep'));
  for (const id of recentIds().slice(0, 3)) root.append(appItem(id, true));
  minHost = el('div#dock-min', { 'aria-label': 'Minimized windows' }, ...tiles);
  root.append(minHost);
  root.append(downloadsItem(), trashItem());
  sizeMinHost();
  updateDots();
  updateTrash();
  applyLayoutClasses();
  measure();
}

/* ── Downloads stack ───────────────────────────────────────────────── */
function sortedDownloads() {
  const kids = fs.children(DOWNLOADS());
  const sort = state.settings.dockStackSort || 'date';
  const by = {
    date: (a, b) => (b.created || 0) - (a.created || 0),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    kind: (a, b) => (a.kind || '').localeCompare(b.kind || '') || a.name.localeCompare(b.name),
  }[sort] || ((a, b) => (b.created || 0) - (a.created || 0));
  return kids.slice().sort(by);
}

function stackIconHtml() {
  const kids = sortedDownloads();
  if (!kids.length || (state.settings.dockStackDisplay || 'stack') === 'folder') return folderIcon('Downloads');
  /* 'stack' display: the newest item sits on the folder like a fanned stack */
  return `<div class="dl-stack">${folderIcon('Downloads')}<i>${fileIcon(kids[0])}</i></div>`;
}

let stackPop = null;
function downloadsItem() {
  const item = dockShell({ id: 'downloads', name: 'Downloads', html: stackIconHtml() });
  item.addEventListener('click', () => { if (!suppressClick) toggleStack(item); });
  item.addEventListener('contextmenu', e => { e.preventDefault(); stackMenu(e.clientX, e.clientY); });
  /* dropping a file on the stack is a move into Downloads, like the real Dock */
  dropZone(item, {
    accept: p => p?.type === 'fs' && p.nodes.some(n => {
      const path = fs.pathOf(n);
      return path && path !== DOWNLOADS() && !path.startsWith(DOWNLOADS() + '/');
    }),
    onDrop: p => {
      for (const n of p.nodes) {
        const path = fs.pathOf(n);
        if (!path || path === DOWNLOADS() || path.startsWith(DOWNLOADS() + '/')) continue;
        try { fs.move(path, DOWNLOADS()); } catch (err) { notify('Downloads', err.message); }
      }
    },
  });
  return item;
}
function updateStackIcon() {
  const holder = dock()?.querySelector('.dock-item[data-app="downloads"] .app-icon');
  if (!holder) return;
  const html = stackIconHtml();
  if (holder._html !== html) { holder._html = html; holder.innerHTML = html; }
}

function openStackNode(node) {
  closeStack();
  const path = fs.pathOf(node);
  if (node.type === 'dir') launch('finder', { path });
  else if (node.kind === 'app') launch(node.app);
  else if (node.kind === 'image') launch('photos', { path });
  else if (node.kind === 'audio') launch('music', { song: node.song });
  else launch('textedit', { path });
}

function stackOutside(e) {
  if (stackPop && !stackPop.contains(e.target) && !e.target.closest('.dock-item')) closeStack();
}
function stackKey(e) {
  if (e.key !== 'Escape' || !stackPop) return;
  e.stopPropagation();
  closeStack();
}
function closeStack() {
  stackPop?.remove();
  stackPop = null;
  document.removeEventListener('pointerdown', stackOutside, true);
  document.removeEventListener('keydown', stackKey, true);
}

function toggleStack(item) {
  if (stackPop) { closeStack(); return; }
  const kids = sortedDownloads();
  if (!kids.length) { launch('finder', { path: DOWNLOADS() }); return; }
  const view = state.settings.dockStackView || 'fan';
  const r = item.getBoundingClientRect();
  stackPop = view === 'fan' ? buildFan(kids, r) : el('div.dock-stack.glass', { role: 'menu' });
  if (view !== 'fan') {
    stackPop.classList.add(view === 'list' ? 'as-list' : 'as-grid');
    for (const node of kids) stackPop.append(stackCell(node, 'stack-cell'));
    document.getElementById('screen').append(stackPop);
    placeStackPanel(stackPop, r);
  } else {
    document.getElementById('screen').append(stackPop);
  }
  setTimeout(() => {
    document.addEventListener('pointerdown', stackOutside, true);
    document.addEventListener('keydown', stackKey, true);
  }, 0);
}
function stackCell(node, cls) {
  const b = el('button.' + cls, { title: node.name, 'aria-label': node.name },
    el('span.stack-ic', { html: node.type === 'dir' ? folderIcon(node.name) : fileIcon(node) }),
    el('span.stack-name', { text: node.name }));
  b.addEventListener('click', () => openStackNode(node));
  return b;
}
/* grid/list panels sit beside the dock icon; which side depends on the Dock's edge */
function placeStackPanel(pop, r) {
  const pos = state.settings.dockPosition || 'Bottom';
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x, y;
  if (pos === 'Left') { x = r.right + 12; y = r.top + r.height / 2 - h / 2; }
  else if (pos === 'Right') { x = r.left - w - 12; y = r.top + r.height / 2 - h / 2; }
  else { x = r.left + r.width / 2 - w / 2; y = r.top - h - 10; }
  x = clamp(x, 8, Math.max(8, window.innerWidth - w - 8));
  y = clamp(y, 32, Math.max(32, window.innerHeight - h - 8));
  pop.style.left = Math.round(x) + 'px';
  pop.style.top = Math.round(y) + 'px';
}

/* the fan is an arc opening toward the screen centre, whichever edge the
   Dock sits on */
function buildFan(kids, r) {
  const pos = state.settings.dockPosition || 'Bottom';
  const pop = el('div.dock-fan', { role: 'menu' });
  const n = Math.min(kids.length, 12);
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const span = Math.min(110, n * 18);                    /* degrees of arc */
  const R = Math.min(300, 130 + n * 26);
  kids.slice(0, n).forEach((node, i) => {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;       /* -1 .. 1 across the arc */
    const a = t * span / 2 * Math.PI / 180;
    let x, y;
    if (pos === 'Left') { x = r.right + Math.cos(a) * (R * .62); y = cy + Math.sin(a) * R; }
    else if (pos === 'Right') { x = r.left - Math.cos(a) * (R * .62); y = cy + Math.sin(a) * R; }
    else { x = cx + Math.sin(a) * R; y = r.top - Math.cos(a) * (R * .58); }
    const b = el('button.stack-item', {
      style: { left: Math.round(x - 30) + 'px', top: Math.round(y - 34) + 'px' },
      title: node.name, 'aria-label': node.name,
    }, el('span.stack-ic', { html: node.type === 'dir' ? folderIcon(node.name) : fileIcon(node) }),
      el('span.stack-name', { text: node.name }));
    b.addEventListener('click', () => openStackNode(node));
    pop.append(b);
  });
  return pop;
}

function stackMenu(x, y) {
  const s = state.settings;
  const opt = (label, group, val, dflt) => ({ label, radio: true, checked: (s[group] || dflt) === val, action: () => setSetting(group, val) });
  contextMenu([
    {
      label: 'Sort by', sub: [
        opt('Date Added', 'dockStackSort', 'date', 'date'),
        opt('Name', 'dockStackSort', 'name', 'date'),
        opt('Kind', 'dockStackSort', 'kind', 'date'),
      ],
    },
    {
      label: 'Display as', sub: [
        opt('Folder', 'dockStackDisplay', 'folder', 'stack'),
        opt('Stack', 'dockStackDisplay', 'stack', 'stack'),
      ],
    },
    {
      label: 'View content as', sub: [
        opt('Fan', 'dockStackView', 'fan', 'fan'),
        opt('Grid', 'dockStackView', 'grid', 'fan'),
        opt('List', 'dockStackView', 'list', 'fan'),
      ],
    },
    { type: 'sep' },
    { label: 'Open Downloads', action: () => launch('finder', { path: DOWNLOADS() }) },
  ], x, y);
}

/* ── Trash ─────────────────────────────────────────────────────────── */
function trashItem() {
  const trash = dockShell({ id: 'trash', name: 'Trash', html: appIcon('trash', { full: fs.trashed().length > 0 }) });
  trash.addEventListener('click', () => { if (!suppressClick) launch('finder', { path: fs.TRASH }); });
  trash.addEventListener('contextmenu', e => {
    e.preventDefault();
    const count = fs.trashed().length;
    contextMenu([
      { label: 'Open', action: () => launch('finder', { path: fs.TRASH }) },
      { label: count ? `Empty Trash (${count})` : 'Empty Trash', disabled: !count, danger: true, action: emptyTrash },
    ], e.clientX, e.clientY);
  });
  /* Finder files dropped on the Trash go to the Trash */
  dropZone(trash, {
    accept: p => p?.type === 'fs' && p.nodes.some(n => {
      const path = fs.pathOf(n);
      return path && !path.startsWith(fs.TRASH);
    }),
    onDrop: p => {
      let moved = 0;
      for (const n of p.nodes) {
        const path = fs.pathOf(n);
        if (!path || path.startsWith(fs.TRASH)) continue;
        try { fs.trashNode(path); moved++; } catch (err) { notify('Finder', err.message); }
      }
      if (moved) notify('Trash', `${moved} item${moved > 1 ? 's' : ''} moved to Trash`, { app: 'finder' });
    },
  });
  return trash;
}
function emptyTrash() {
  const n = fs.emptyTrash();
  /* the crumple sound, when the sfx module exists */
  import('../core/sfx.js').then(m => m.trash?.()).catch(() => {});
  if (n) notify('Trash', 'Trash emptied');
}

/* ── per-app context menu ──────────────────────────────────────────── */
function appMenu(id, x, y) {
  const app = getApp(id);
  const running = wm.byApp(id);
  const pinned = isPinned(id);
  contextMenu([
    { label: 'Open', action: () => activate(id) },
    ...(app?.recentItems ? [{ type: 'sep' }, ...app.recentItems()] : []),
    { type: 'sep' },
    { label: 'Show in Finder', action: () => revealApp(id) },
    ...(running.length ? [
      { label: 'Hide', action: () => running.forEach(w => wm.hide(w)) },
      { label: 'Show All Windows', action: () => running.forEach(w => wm.show(w)) },
    ] : []),
    { type: 'sep' },
    {
      label: 'Options', sub: [
        { label: 'Keep in Dock', checked: pinned, disabled: id === 'finder', action: () => togglePin(id) },
        { label: 'Open at Login', checked: loginItems().includes(id), action: () => toggleLogin(id) },
        { label: 'Show in Finder', action: () => revealApp(id) },
      ],
    },
    { type: 'sep' },
    { label: 'Quit', key: '⌘Q', disabled: !running.length, action: () => quitApp(id) },
  ], x, y);
}
function revealApp(id) {
  const app = getApp(id);
  const dir = fs.get('/Applications');
  const entry = app && dir?.children.find(c => c.app === id);
  launch('finder', { path: '/Applications', ...(entry ? { select: entry.id } : {}) });
}

/* ── dragging icons: sideways reorders, out removes with the puff ──── */
const vertical = () => wrap()?.classList.contains('side');
function attachItemDrag(item, id) {
  item.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    const grabR = item.getBoundingClientRect();
    const grabOff = { x: sx - grabR.left, y: sy - grabR.top };
    let dragging = false;
    const move = ev => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      if (!dragging) {
        dragging = true;
        item.classList.add('dragging');
        hideTip();
      }
      const r = item.getBoundingClientRect();
      const dx = ev.clientX - grabOff.x - r.left;
      const dy = ev.clientY - grabOff.y - r.top;
      item.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
      const far = outDistance(ev) > 64;
      item.classList.toggle('puff-away', far);
      if (!far) reflow(item, ev);
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragging) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 80);
      item.classList.remove('dragging', 'puff-away');
      item.style.transform = '';
      if (outDistance(ev) > 64) {
        puff(ev.clientX, ev.clientY);
        if (isPinned(id)) unpinApp(id);
        else {                           /* a recent icon was never pinned — it just leaves the row */
          state.settings.recentApps = (state.settings.recentApps || []).filter(x => x !== id);
          save();
        }
        render();
        return;
      }
      /* whatever sits before the separator is pinned, in that order */
      const ids = [];
      for (const n of dock().children) {
        if (n.classList.contains('dock-sep')) break;
        if (n.classList.contains('dock-item') && n.dataset.app) ids.push(n.dataset.app);
      }
      setPinned(ids);
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
/* how far the pointer is outside the dock box, on any axis */
function outDistance(e) {
  const r = dock().getBoundingClientRect();
  return Math.max(r.top - e.clientY, e.clientY - r.bottom, r.left - e.clientX, e.clientX - r.right, -1);
}
/* slide the dragged icon through the row as the pointer crosses neighbours */
function reflow(item, e) {
  const root = dock();
  const vert = vertical();
  const pos = vert ? e.clientY : e.clientX;
  const siblings = Array.from(root.querySelectorAll('.dock-item[data-app]'))
    .filter(n => n !== item && !['downloads', 'trash'].includes(n.dataset.app));
  let before = null;
  for (const s of siblings) {
    const b = s.getBoundingClientRect();
    if (pos < (vert ? b.top + b.height / 2 : b.left + b.width / 2)) { before = s; break; }
  }
  if (before) root.insertBefore(item, before);
  else if (siblings.length) {
    const last = siblings[siblings.length - 1];
    root.insertBefore(item, last.nextSibling);
  }
}
/* the little cloud when an icon leaves the Dock */
function puff(x, y) {
  const p = el('div.dock-puff', { style: { left: x + 'px', top: y + 'px' } },
    el('i'), el('i'), el('i'), el('i'), el('i'));
  document.getElementById('screen').append(p);
  setTimeout(() => p.remove(), 650);
}

/* ── minimized windows: one live tile each, right of the separator ──── */
const TILE_W = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-icon')) * 0.72 || 40;
const TILE_H = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-icon')) * 0.58 || 32;

function tileFor(win) {
  return minHost && minHost.querySelector(`.min-tile[data-win="${CSS.escape(win.id)}"]`);
}
function addMinTile(win) {
  if (!minHost) return null;
  /* "Minimize windows into application icon" — no tile, the window flies
     straight at the app's dock icon */
  if (state.settings.minimizeToIcon) return null;
  const existing = tileFor(win);
  if (existing) return existing;
  const app = getApp(win.app);
  const tile = el('div.min-tile', {
    dataset: { win: win.id, app: win.app },
    role: 'button', tabindex: '-1', 'aria-label': win.title,
  },
    el('div.min-shot'),
    el('span.min-badge', { html: appIcon(app?.icon || win.app) }),
  );
  /* the tile is only a way in: restoring is always the window manager's job */
  tile.addEventListener('click', () => wm.restore(win));
  tile.addEventListener('contextmenu', e => {
    e.preventDefault();
    contextMenu([
      { label: win.title, action: () => wm.restore(win) },
      { type: 'sep' },
      { label: 'Close', key: '⌘W', action: () => wm.close(win) },
    ], e.clientX, e.clientY);
  });
  tile.addEventListener('pointerenter', () => scheduleTip(tile, win.title));
  tile.addEventListener('pointerleave', hideTip);
  minHost.append(tile);
  sizeMinHost();
  return tile;
}

function removeMinTile(win) {
  const tile = tileFor(win);
  if (!tile) return;
  tile.remove();
  sizeMinHost();
}

/** the dock grows and shrinks smoothly as tiles come and go */
function sizeMinHost() {
  if (!minHost) return;
  const n = minHost.children.length;
  const size = Math.round(n * (TILE_W() + 4)) + 2;
  if (vertical()) {
    minHost.style.maxWidth = '';
    minHost.style.maxHeight = (n ? size : 0) + 'px';
  } else {
    minHost.style.maxHeight = '';
    minHost.style.maxWidth = (n ? size : 0) + 'px';
  }
  minHost.style.opacity = n ? '1' : '0';
  minHost.classList.toggle('empty', !n);
}

/** write a window's box. the rect is the only truth there is. */
function writeBox(win, rect) {
  const s = win.node.style;
  s.left = Math.round(rect.x) + 'px';
  s.top = Math.round(rect.y) + 'px';
  s.width = Math.round(rect.w) + 'px';
  s.height = Math.round(rect.h) + 'px';
}

/** hand the real window node to the tile, so the tile is live, not a snapshot */
function parkWindow(win) {
  const tile = addMinTile(win);
  if (!tile) return;
  const r = win.restoreRect || win.rect;
  const k = Math.min(TILE_W() / r.w, TILE_H() / r.h);
  /* zeroed geometry, then scaled: the size still comes from the rect */
  writeBox(win, { x: 0, y: 0, w: r.w, h: r.h });
  win.node.style.transformOrigin = '0 0';
  win.node.style.transform = `translate(${(TILE_W() - r.w * k) / 2}px, ${(TILE_H() - r.h * k) / 2}px) scale(${k})`;
  tile.querySelector('.min-shot').append(win.node);
}

/**
 * Take the window back out of the tile. The box is rewritten from the rect, not
 * from a stashed copy, so this is self-healing: it lands correctly even if the
 * tile is already gone, or a park was interrupted halfway.
 */
function unparkWindow(win) {
  const tile = tileFor(win);
  if (tile) layer().append(win.node);
  else if (win.node.parentElement !== layer()) layer().append(win.node);
  writeBox(win, win.rect);
  win.node.style.transformOrigin = 'center center';
}

window.addEventListener('wm:minimize-request', e => addMinTile(e.detail));
window.addEventListener('wm:minimize-dock', e => parkWindow(e.detail));
window.addEventListener('wm:restore-request', e => unparkWindow(e.detail));
window.addEventListener('wm:restore-dock', e => removeMinTile(e.detail));
window.addEventListener('wm:window-closed', e => removeMinTile(e.detail));

function scheduleTip(item, name) {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    hideTip();
    tip = el('div.dock-tip', { text: name });
    item.append(tip);
  }, 420);
}
function hideTip() { clearTimeout(tipTimer); tip?.remove(); tip = null; }

/* ── magnification: one measurement per layout, never per icon ─────── */
let centres = [];
function measure() {
  const root = dock();
  if (!root) return;
  const vert = vertical();
  const r = root.getBoundingClientRect();
  centres = items.map(({ el: item }) => {
    const b = item.getBoundingClientRect();
    return vert ? b.top + b.height / 2 - r.top : b.left + b.width / 2 - r.left;
  });
}
let magnifyBound = false;
function bindMagnify() {
  if (magnifyBound) return;
  magnifyBound = true;
  const root = dock();
  measure();
  window.addEventListener('resize', rafThrottle(measure));
  const onMove = rafThrottle(e => {
    if (!state.settings.dockMagnify) return;
    const vert = vertical();
    const r = root.getBoundingClientRect();
    const base = state.settings.dockSize;
    const lift = base * 0.62;
    const reach = base * 1.55;
    const x = vert ? e.clientY - r.top : e.clientX - r.left;
    for (let i = 0; i < items.length; i++) {
      const d = Math.abs(x - centres[i]);
      const f = Math.exp(-Math.pow(d / reach, 2));
      items[i].el.style.setProperty('--s', (1 + lift / base * f).toFixed(3));
    }
  });
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerenter', measure);
  root.addEventListener('pointerleave', () => {
    for (const { el: item } of items) item.style.setProperty('--s', '1');
    scheduleHide();
  });
}

/* ── position + autohide: the Dock is a real preference ────────────── */
function applyLayout() {
  applyLayoutClasses();
  /* a moved dock re-measures after the transition settles */
  measure();
  setTimeout(measure, 320);
}
function applyLayoutClasses() {
  const w = wrap();
  if (!w) return;
  const pos = state.settings.dockPosition || 'Bottom';
  w.classList.toggle('side', pos === 'Left' || pos === 'Right');
  w.classList.toggle('left', pos === 'Left');
  w.classList.toggle('right', pos === 'Right');
  const hide = state.settings.dockAutoHide === true;
  w.classList.toggle('autohide', hide);
  w.classList.toggle('hidden', hide);
  ensureEdge(hide);
  sizeMinHost();
}
function ensureEdge(on) {
  if (!edgeEl) {
    edgeEl = el('div#dock-edge', { 'aria-hidden': 'true' });
    document.getElementById('screen').append(edgeEl);
    const show = () => { clearTimeout(hideTimer); wrap()?.classList.remove('hidden'); };
    edgeEl.addEventListener('pointerenter', show);
    edgeEl.addEventListener('pointermove', show);
  }
  edgeEl.dataset.pos = (state.settings.dockPosition || 'Bottom').toLowerCase();
  edgeEl.classList.toggle('on', !!on);
}
/* leaving the Dock hides it again, unless a menu or a stack is open on it */
function scheduleHide() {
  if (state.settings.dockAutoHide !== true) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (stackPop || isMenuOpen()) return;
    wrap()?.classList.add('hidden');
  }, 450);
}

/* ── launching, dots, trash icon ───────────────────────────────────── */
function activate(appId) {
  const existing = wm.byApp(appId);
  if (existing.length) {
    const minimized = existing.find(w => w.state === 'min');
    if (minimized) { wm.show(minimized); return; }
    const top = existing.sort((a, b) => +b.node.style.zIndex - +a.node.style.zIndex)[0];
    if (wm.focused?.app === appId && existing.length === 1) wm.minimize(top);
    else wm.focus(top);
    return;
  }
  bounce(appId);
  launch(appId);
}
export function bounce(appId) {
  const item = dock().querySelector(`.dock-item[data-app="${appId}"]`);
  if (!item) return;
  item.classList.remove('bounce');
  void item.offsetWidth;
  item.classList.add('bounce');
  setTimeout(() => item.classList.remove('bounce'), 1400);
}
/** an app keeps its dot while any of its windows is open *or* minimized */
export function updateDots() {
  for (const { el: item, app } of items) {
    if (app === 'trash' || app === 'downloads') continue;
    const windows = wm.byApp(app);
    item.classList.toggle('running', windows.length > 0);
    item.classList.toggle('all-minimized', windows.length > 0 && windows.every(w => w.state === 'min'));
  }
}
function updateTrash() {
  const item = dock()?.querySelector('.dock-item[data-app="trash"]');
  if (!item) return;
  const full = fs.trashed().length > 0;
  const holder = item.firstChild;
  if (holder.dataset.full !== String(full)) {
    holder.dataset.full = String(full);
    holder.innerHTML = appIcon('trash', { full });
  }
}
