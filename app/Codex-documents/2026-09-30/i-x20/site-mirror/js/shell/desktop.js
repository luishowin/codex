// Desktop: icons, selection, rubber-band, context menu, drag to reposition,
// Stacks, sort modes and the floating View Options panel.
//
// Settings this file consumes (kept in sync with the Settings worker):
//   desktopStacks   bool     — group icons into kind-stacks
//   desktopSort     'none'|'name'|'kind'|'date'|'size'|'tags'
//   deskIconSize    px thumb size, default 60
//   deskLabelSize   px label font, default 11.5
//   deskGridGap     px extra cell spacing, default 0
// It emits 'widgets:edit' for the Notification Center worker's edit mode.
import { el, $$, clamp, on, emit, fileSize, dirName } from '../core/util.js';
import { fileIcon } from '../core/icons.js';
import * as fs from '../core/fs.js';
import { contextMenu, closeMenu } from './menus.js';
import { startDrag, dropZone, _debug } from './dragdrop.js';
import { launch } from '../core/os.js';
import { state, setSetting, save } from '../core/store.js';
import { notify } from './notify.js';
import { art, PHOTOS } from '../core/photoart.js';
import * as sfx from '../core/sfx.js';

const host = () => document.getElementById('desktop-icons');
const MARGIN = 10;
let selected = new Set();
let nodes = [];
let fanEl = null, viewPanel = null;

/* view options drive the real grid metrics */
const iconSize = () => state.settings.deskIconSize || 60;
const labelSize = () => state.settings.deskLabelSize || 11.5;
const gridGap = () => state.settings.deskGridGap ?? 0;
const cellW = () => iconSize() + 32 + gridGap();
const cellH = () => iconSize() + 24 + gridGap();
const stacksOn = () => !!state.settings.desktopStacks;
const sortKey = () => state.settings.desktopSort || 'none';

/* ── sorting ───────────────────────────────────────────────────────── */
const byteSize = n => n.type === 'dir'
  ? (n.children || []).reduce((s, c) => s + byteSize(c), 1)
  : fileSize(n.content || '');
const TAG_RANK = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray', 'grey'];
const nameCmp = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const KIND_ORDER = { folder: 0, app: 1, image: 2, audio: 3, txt: 4 };
const SORTS = {
  name: nameCmp,
  kind: (a, b) => ((KIND_ORDER[a.kind] ?? 5) - (KIND_ORDER[b.kind] ?? 5)) || nameCmp(a, b),
  date: (a, b) => (b.created - a.created) || nameCmp(a, b),
  size: (a, b) => byteSize(b) - byteSize(a) || nameCmp(a, b),
  tags: (a, b) => {
    const ra = a.tag ? TAG_RANK.indexOf(String(a.tag).toLowerCase()) : -1;
    const rb = b.tag ? TAG_RANK.indexOf(String(b.tag).toLowerCase()) : -1;
    return (a.tag ? 0 : 1) - (b.tag ? 0 : 1) || (ra < 0 ? 0 : ra) - (rb < 0 ? 0 : rb) || nameCmp(a, b);
  },
};
const SORT_LABELS = { none: 'None', name: 'Name', kind: 'Kind', date: 'Date Added', size: 'Size', tags: 'Tags' };

function sortedNodes() {
  const list = fs.desktopEntries();
  const k = sortKey();
  if (k === 'none' || !SORTS[k]) return list;
  return list.slice().sort(SORTS[k]);
}

/* ── stacks ────────────────────────────────────────────────────────── */
const STACK_ORDER = ['folders', 'documents', 'images', 'music', 'apps', 'other'];
const STACK_LABELS = { folders: 'Folders', documents: 'Documents', images: 'Images', music: 'Music', apps: 'Applications', other: 'Other' };
function stackKeyOf(n) {
  if (n.type === 'dir') return 'folders';
  if (n.kind === 'image') return 'images';
  if (n.kind === 'app') return 'apps';
  if (n.kind === 'audio') return 'music';
  if (n.kind === 'txt' || n.kind === 'doc' || n.kind === 'rtf' || n.kind === 'pdf') return 'documents';
  return 'other';
}
function stackGroups() {
  const groups = new Map();
  for (const n of sortedNodes()) {
    const k = stackKeyOf(n);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  return STACK_ORDER.filter(k => groups.has(k)).map(k => ({ key: k, label: STACK_LABELS[k], members: groups.get(k) }));
}

let initialized = false;
export function initDesktop() {
  if (initialized) { render(); return; }
  initialized = true;
  const desktop = document.getElementById('desktop');
  /* only accept drops of things that live somewhere else — a desktop icon
     dragged back onto the desktop is a reposition, not a drop */
  dropZone(desktop, {
    accept: payload => payload?.type === 'fs' && payload.nodes.some(n => dirName(fs.pathOf(n)) !== fs.desktopPath()),
    onDrop: (payload, e) => {
      let i = 0;
      for (const node of payload.nodes) {
        try {
          fs.move(fs.pathOf(node), fs.desktopPath());
          node.pos = { x: snapX(e.clientX - 44) + i * 18, y: snapY(e.clientY - 30) + i * 18 };
          i++;
        } catch (err) { notify('Finder', err.message); }
      }
      if (i) save();
    },
  });
  /* the Dock's Trash accepts drags through the same zone mechanism, from the
     desktop and from Finder alike */
  const wireTrash = () => {
    const t = document.querySelector('.dock-item[data-app="trash"]');
    if (t) dropZone(t, {
      accept: payload => payload?.type === 'fs',
      hoverClass: 'drop',
      onDrop: payload => {
        let n = 0;
        for (const node of payload.nodes) {
          const p = fs.pathOf(node);
          if (!p || p.startsWith(fs.TRASH)) continue;
          fs.trashNode(p); n++;
        }
        if (n) { sfx.trash(); notify('Trash', `${n} item${n === 1 ? '' : 's'} moved to Trash`); }
      },
    });
  };
  wireTrash();
  on('fs:change', wireTrash);
  host().addEventListener('pointerdown', onPointerDown);
  desktop.addEventListener('contextmenu', e => {
    if (e.target.closest('.desk-icon')) return;
    e.preventDefault();
    desktopMenu(e.clientX, e.clientY);
  });
  desktop.addEventListener('pointerdown', e => {
    if (e.target === host() || e.target.closest('#wallpaper') || e.target === desktop) beginMarquee(e);
  });
  desktop.addEventListener('dblclick', e => {
    if (e.target.closest('.desk-icon') || e.target.closest('.stack-fan')) return;
    launch('finder', { path: fs.HOME });
  });
  on('fs:change', () => render());
  on('settings:change', ({ key } = {}) => {
    if (!key || ['wallpaper', 'desktopStacks', 'desktopSort', 'deskIconSize', 'deskLabelSize', 'deskGridGap'].includes(key)) render();
  });
  window.addEventListener('resize', () => render());
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (fanEl || viewPanel)) { closeFan(); closeViewOptions(); return; }
    if (!selected.size || e.defaultPrevented) return;
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    /* a focused application window owns the keyboard */
    if (window.__wm && window.__wm.focused) return;
    const node = nodes.find(n => n.id === [...selected][0]);
    if (!node) return;
    if (e.key === 'Enter') { e.preventDefault(); startRename(node); }
    else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      for (const n of nodes.filter(n => selected.has(n.id))) fs.trashNode(fs.pathOf(n));
      selected.clear();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const i = nodes.findIndex(n => n.id === node.id);
      const dir = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
      const next = nodes[(i + dir + nodes.length) % nodes.length];
      if (next) { selected.clear(); selected.add(next.id); render(); }
    }
  });
  render();
}


function layout(items) {
  const w = window.innerWidth, h = window.innerHeight;
  const cw = cellW(), ch = cellH();
  const rows = Math.max(1, Math.floor((h - 40 - 110) / ch));
  const out = new Map();
  let slot = 0;
  for (const node of items) {
    if (node.pos && node.pos.x != null) {
      out.set(node.id, { x: clamp(node.pos.x, 0, w - cw), y: clamp(node.pos.y, 30, h - 120) });
      slot = Math.max(slot, 1);
      continue;
    }
    const col = Math.floor(slot / rows), row = slot % rows;
    out.set(node.id, { x: w - MARGIN - cw * (col + 1), y: MARGIN + 26 + row * ch });
    slot++;
  }
  return out;
}

const snapX = x => MARGIN + Math.round((x - MARGIN) / cellW()) * cellW();
const snapY = y => MARGIN + 26 + Math.round((y - MARGIN - 26) / cellH()) * cellH();

/* image files show their drawn photo as the icon, the way real thumbnails do */
function thumbFor(node) {
  if (node.kind === 'image' && Number.isInteger(node.palette) && PHOTOS[node.palette]) {
    const p = PHOTOS[node.palette];
    return `<div class="photo-thumb">${art(p.kind, p.seed)}</div>`;
  }
  return fileIcon(node);
}

function paintVars() {
  const h = host();
  h.style.setProperty('--diw', iconSize() + 'px');
  h.style.setProperty('--dls', labelSize() + 'px');
  h.style.setProperty('--dgap', gridGap() + 'px');
}

function render() {
  closeFan();
  const desktop = fs.desktopDir();
  if (!desktop) return;
  paintVars();
  nodes = sortedNodes();
  const wrap = host();
  if (stacksOn()) return renderStacks(wrap);
  const positions = layout(nodes);
  wrap.replaceChildren(...nodes.map(node => {
    const p = positions.get(node.id) || { x: 20, y: 40 };
    return buildIcon(node, p);
  }));
}

function buildIcon(node, p) {
  const icon = el('div.desk-icon' + (selected.has(node.id) ? '.sel' : ''), {
    dataset: { id: node.id },
    style: { left: p.x + 'px', top: p.y + 'px' },
  },
    el('div.thumb', { html: thumbFor(node) }),
    el('div.label', { text: node.name }),
  );
  icon.addEventListener('dblclick', () => openNode(node));
  icon.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    if (!selected.has(node.id)) { selected.clear(); selected.add(node.id); paintSelection(); }
    contextMenu([
      { label: 'Open', action: () => openNode(node) },
      { label: 'Show in Finder', action: () => launch('finder', { path: fs.desktopPath(), select: node.id }) },
      { type: 'sep' },
      { label: 'Get Info', action: () => launch('finder', { path: fs.desktopPath(), info: node.id }) },
      { label: 'Rename', action: () => startRename(node) },
      { type: 'sep' },
      { label: 'Move to Trash', danger: true, action: () => { fs.trashNode(fs.pathOf(node)); sfx.trash(); notify('Finder', `${node.name} moved to Trash`); } },
    ], e.clientX, e.clientY);
  });
  return icon;
}

/* Stacks: one icon per kind. Clicking fans the members out into a little grid;
   a member opens the same way an icon would. */
function renderStacks(wrap) {
  const groups = stackGroups();
  const pseudo = groups.map(g => ({ id: 'stack:' + g.key, name: g.label, pos: null }));
  const positions = layout(pseudo);
  wrap.replaceChildren(...groups.map(g => {
    const p = positions.get('stack:' + g.key) || { x: 20, y: 40 };
    const top = g.members[0];
    const icon = el('div.desk-icon.desk-stack' + (selected.has('stack:' + g.key) ? '.sel' : ''), {
      dataset: { stack: g.key },
      style: { left: p.x + 'px', top: p.y + 'px' },
    },
      el('div.thumb', null,
        el('div.stack-back'),
        el('div.stack-front', { html: fileIcon(top) }),
        el('span.stack-count', { text: String(g.members.length) })),
      el('div.label', { text: g.label }),
    );
    icon.addEventListener('click', () => toggleFan(g.key, icon));
    icon.addEventListener('dblclick', e => e.stopPropagation());
    icon.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      contextMenu([
        { label: `Open “${g.label}” Stack`, action: () => toggleFan(g.key, icon) },
        { type: 'sep' },
        { label: 'Move Stack to Trash', danger: true, action: () => { g.members.forEach(n => fs.trashNode(fs.pathOf(n))); sfx.trash(); } },
      ], e.clientX, e.clientY);
    });
    return icon;
  }));
}

function toggleFan(key, anchor) {
  if (fanEl && fanEl.dataset.stack === key) { closeFan(); return; }
  closeFan();
  const group = stackGroups().find(g => g.key === key);
  if (!group) return;
  const r = anchor.getBoundingClientRect();
  fanEl = el('div.stack-fan', { dataset: { stack: key } },
    el('div.fan-head', null, el('b', { text: group.label }), el('span', { text: `${group.members.length} items` })),
    el('div.fan-grid', null, group.members.map(n =>
      el('button.fan-item', { dataset: { id: n.id }, title: n.name },
        el('span.fan-ic', { html: thumbFor(n) }),
        el('span.fan-name', { text: n.name })),
    )));
  fanEl.addEventListener('click', e => {
    const item = e.target.closest('.fan-item');
    if (!item) return;
    const node = group.members.find(n => n.id === item.dataset.id);
    if (node) { closeFan(); openNode(node); }
  });
  fanEl.addEventListener('pointerdown', e => e.stopPropagation());
  document.getElementById('desktop').append(fanEl);
  const fw = fanEl.offsetWidth, fh = fanEl.offsetHeight;
  let x = r.left + r.width / 2 - fw / 2;
  let y = r.bottom + 8;
  x = clamp(x, 8, window.innerWidth - fw - 8);
  if (y + fh > window.innerHeight - 90) y = r.top - fh - 8;
  fanEl.style.left = Math.max(8, x) + 'px';
  fanEl.style.top = Math.max(30, y) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', onFanOutside), 0);
}
function onFanOutside(e) { if (fanEl && !fanEl.contains(e.target)) closeFan(); }
function closeFan() {
  if (!fanEl) return;
  fanEl.remove(); fanEl = null;
  document.removeEventListener('pointerdown', onFanOutside);
}

function openNode(node) {
  if (node.type === 'dir') return launch('finder', { path: fs.pathOf(node) });
  if (node.kind === 'app') return launch(node.app);
  if (node.kind === 'txt') return launch('textedit', { path: fs.pathOf(node) });
  if (node.kind === 'image') return launch('photos', { path: fs.pathOf(node) });
  if (node.kind === 'audio') return launch('music', { song: node.song });
  launch('textedit', { path: fs.pathOf(node) });
}

/* ── selection + drag ──────────────────────────────────────────────── */
function onPointerDown(e) {
  const icon = e.target.closest('.desk-icon');
  if (!icon) { if (e.button === 0) { selected.clear(); paintSelection(); } return; }
  if (e.button !== 0) return;
  if (icon.dataset.stack) {   /* stacks select and fan; they do not drag */
    const id = 'stack:' + icon.dataset.stack;
    if (!selected.has(id)) { selected.clear(); selected.add(id); }
    paintSelection();
    return;
  }
  const id = icon.dataset.id;
  const node = nodes.find(n => n.id === id);
  if (!node) return;
  if (e.metaKey || e.ctrlKey) { selected.has(id) ? selected.delete(id) : selected.add(id); }
  else if (!selected.has(id)) { selected.clear(); selected.add(id); }
  paintSelection();
  const targets = selected.size > 1 ? nodes.filter(n => selected.has(n.id)) : [node];
  const payload = { type: 'fs', nodes: targets };
  const startX = e.clientX, startY = e.clientY;
  let dragging = false;
  let origins = new Map();
  const move = ev => {
    if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
    if (!dragging) {
      dragging = true;
      origins = new Map();
      for (const n of targets) {
        const dom = host().querySelector(`.desk-icon[data-id="${n.id}"]`);
        if (dom) origins.set(dom, { x: parseFloat(dom.style.left), y: parseFloat(dom.style.top) });
      }
      /* the shared machinery finds the Trash, a Finder window or the desktop
         itself under the pointer while the icon follows it */
      startDrag(ev, payload);
    }
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    for (const [dom, o] of origins) {
      dom.style.left = Math.round(o.x + dx) + 'px';
      dom.style.top = Math.round(o.y + dy) + 'px';
    }
  };
  const up = ev => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!dragging) return;
    /* a zone (Trash, a Finder window) already ran its own drop on document */
    const zone = _debug.findZone(ev.clientX, ev.clientY, payload);
    if (zone) { selected.clear(); render(); return; }
    /* landing on a folder icon drops inside the folder */
    const onto = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.desk-icon');
    const ontoNode = onto ? nodes.find(n => n.id === onto.dataset.id) : null;
    if (ontoNode && ontoNode.type === 'dir' && !targets.includes(ontoNode)) {
      for (const n of targets) {
        try { fs.move(fs.pathOf(n), fs.pathOf(ontoNode)); } catch (err) { notify('Finder', err.message); }
      }
      render();
      return;
    }
    /* on a window or outside the desktop, the icons spring back */
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    if (over && (over.closest('.window') || over.closest('#menubar'))) { render(); return; }
    for (const n of targets) {
      const dom = host().querySelector(`.desk-icon[data-id="${n.id}"]`);
      if (dom) n.pos = { x: snapX(parseFloat(dom.style.left)), y: snapY(parseFloat(dom.style.top)) };
    }
    save();
    render();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
const wrap = () => host();
function paintSelection() {
  $$('.desk-icon', host()).forEach(n => n.classList.toggle('sel', selected.has(n.dataset.id || ('stack:' + n.dataset.stack))));
}
function startRename(node) {
  const dom = wrap().querySelector(`.desk-icon[data-id="${node.id}"] .label`);
  if (!dom) return;
  const input = el('input.rename-input', { value: node.name });
  dom.replaceWith(input);
  input.focus(); input.select();
  const finish = ok => {
    if (ok && input.value.trim()) fs.rename(fs.pathOf(node), input.value.trim());
    render();
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
}

/* ── marquee selection ─────────────────────────────────────────────── */
function beginMarquee(e) {
  const box = document.getElementById('marquee');
  const startX = e.clientX, startY = e.clientY;
  let active = false;
  const move = ev => {
    const x = Math.min(startX, ev.clientX), y = Math.min(startY, ev.clientY);
    const w = Math.abs(ev.clientX - startX), h = Math.abs(ev.clientY - startY);
    if (!active && w < 3 && h < 3) return;
    active = true;
    box.hidden = false;
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const rect = box.getBoundingClientRect();
    selected.clear();
    for (const icon of $$('.desk-icon', host())) {
      const r = icon.getBoundingClientRect();
      if (r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top) selected.add(icon.dataset.id || ('stack:' + icon.dataset.stack));
    }
    paintSelection();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    box.hidden = true;
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ── menus + view options ──────────────────────────────────────────── */
function sortSubmenu(current, pick, includeNone = false) {
  return Object.keys(SORT_LABELS).filter(k => includeNone || k !== 'none').map(k => ({
    label: SORT_LABELS[k], checked: k === current, action: () => pick(k),
  }));
}

function desktopMenu(x, y) {
  const stacks = stacksOn();
  contextMenu([
    { label: 'New Folder', action: () => { fs.mkdir(fs.desktopPath(), 'untitled folder'); promptRenameNew(); } },
    { type: 'sep' },
    { label: 'Get Info', action: () => showDesktopInfo() },
    { label: 'Change Wallpaper…', action: () => launch('settings', { pane: 'wallpaper' }) },
    { label: 'Edit Widgets…', action: () => emit('widgets:edit') },
    { type: 'sep' },
    { label: 'Use Stacks', checked: stacks, action: () => setSetting('desktopStacks', !stacks) },
    {
      label: 'Sort By', sub: sortSubmenu(sortKey(), k => {
        setSetting('desktopSort', k);
        if (k !== 'none') { nodes.forEach(n => delete n.pos); save(); }
      }, true),
    },
    { label: 'Clean Up', action: () => { nodes.forEach(n => delete n.pos); save(); render(); } },
    { label: 'Clean Up By', sub: sortSubmenu(null, k => cleanUpBy(k)) },
    { type: 'sep' },
    { label: 'Show View Options', action: () => showViewOptions(x, y) },
  ], x, y);
}

/* Clean Up By: a one-shot arrangement — positions are written in sorted order
   and stay put; it does not switch on a live sort. */
function cleanUpBy(key) {
  const sorted = nodes.slice().sort(SORTS[key]);
  const h = window.innerHeight, w = window.innerWidth;
  const rows = Math.max(1, Math.floor((h - 40 - 110) / cellH()));
  sorted.forEach((n, i) => {
    const col = Math.floor(i / rows), row = i % rows;
    n.pos = { x: w - MARGIN - cellW() * (col + 1), y: MARGIN + 26 + row * cellH() };
  });
  save();
  render();
}

function showViewOptions(x, y) {
  closeViewOptions();
  const s = state.settings;
  const slider = (label, min, max, val, key) => el('div.vo-row', null,
    el('span.vo-label', { text: label }),
    el('input.range', { type: 'range', min, max, value: val, oninput: e => setSetting(key, Number(e.target.value)) }),
    el('span.vo-val', { text: val }));
  const sortBtn = el('button.btn.vo-sort', { text: SORT_LABELS[sortKey()] });
  sortBtn.addEventListener('click', e => {
    e.stopPropagation();
    contextMenu(Object.keys(SORT_LABELS).map(k => ({
      label: SORT_LABELS[k], checked: k === sortKey(),
      action: () => { setSetting('desktopSort', k); sortBtn.textContent = SORT_LABELS[k]; },
    })), e.clientX, e.clientY);
  });
  const stackSwitch = el('button.switch' + (stacksOn() ? '.on' : ''), { role: 'switch', 'aria-checked': String(stacksOn()), title: 'Use Stacks' });
  stackSwitch.addEventListener('click', () => {
    setSetting('desktopStacks', !stacksOn());
    stackSwitch.classList.toggle('on', stacksOn());
  });
  viewPanel = el('div.vo-panel', { role: 'dialog', 'aria-label': 'Desktop view options' },
    el('div.vo-title', { text: 'Desktop' }),
    slider('Icon size:', 40, 96, s.deskIconSize || 60, 'deskIconSize'),
    slider('Grid spacing:', 0, 40, s.deskGridGap ?? 0, 'deskGridGap'),
    slider('Text size:', 10, 16, s.deskLabelSize || 11.5, 'deskLabelSize'),
    el('div.vo-row', null, el('span.vo-label', { text: 'Sort by:' }), sortBtn),
    el('div.vo-row', null, el('span.vo-label', { text: 'Use Stacks' }), stackSwitch),
    el('div.vo-sub', { text: `${wallpaperLabel()} · ${nodes.length} items` }),
  );
  viewPanel.addEventListener('pointerdown', e => e.stopPropagation());
  document.body.append(viewPanel);
  const pw = viewPanel.offsetWidth, ph = viewPanel.offsetHeight;
  viewPanel.style.left = clamp(x, 8, window.innerWidth - pw - 8) + 'px';
  viewPanel.style.top = clamp(y + 8, 30, window.innerHeight - ph - 90) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', onVoOutside, true), 0);
}
function onVoOutside(e) {
  if (viewPanel && !viewPanel.contains(e.target) && !e.target.closest('.menu-pop')) { closeMenu(); closeViewOptions(); }
}
function closeViewOptions() {
  if (!viewPanel) return;
  viewPanel.remove(); viewPanel = null;
  document.removeEventListener('pointerdown', onVoOutside, true);
}

function wallpaperLabel() {
  const w = state.settings.wallpaper;
  return w ? w[0].toUpperCase() + w.slice(1) : 'Default';
}
function promptRenameNew() {
  const desktop = fs.desktopDir();
  const node = desktop?.children[desktop.children.length - 1];
  if (node) setTimeout(() => startRename(node), 30);
}
function showDesktopInfo() {
  launch('finder', { path: fs.desktopPath(), info: 'folder' });
}
