// Shared dropdown menus for the menu bar, context menus and submenus.
import { el } from '../core/util.js';
import { glyph } from '../core/icons.js';

const stack = [];          // every open popup, oldest first
let closeHandlers = [];
let current = null;

const sel = new WeakMap();        // popup -> highlighted row index, the keyboard cursor
const parentRow = new WeakMap();  // submenu popup -> the parent row that opened it

const top = () => stack[stack.length - 1] || null;
const isOpen = () => !!top();

/* the rows a key may land on: items only, never separators, titles or disabled */
const rowsOf = pop => [...pop.querySelectorAll('.item:not(.disabled)')];
const curRow = pop => rowsOf(pop)[sel.get(pop) ?? -1] || null;
function selRow(pop, i) {
  const rows = rowsOf(pop);
  rows.forEach((r, k) => r.classList.toggle('sel', k === i));
  sel.set(pop, i);
}
function move(dir) {
  const pop = top(); if (!pop) return;
  const rows = rowsOf(pop); if (!rows.length) return;
  const i = sel.get(pop);
  selRow(pop, (i == null || i < 0) ? (dir > 0 ? 0 : rows.length - 1) : (i + dir + rows.length) % rows.length);
}
const selectFirst = () => { const pop = top(); if (pop && rowsOf(pop).length) selRow(pop, 0); };

export function closeMenu() {
  while (stack.length) stack.pop().remove();
  current = null;
  typeBuf = '';
  document.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('blur', closeMenu);
  const hs = closeHandlers; closeHandlers = [];
  hs.forEach(fn => fn());
}
function onOutside(e) {
  if (stack.some(pop => pop.contains(e.target))) return;
  if (e.target.closest?.('.mb-item')) return;
  closeMenu();
}

/* one path opens a submenu whoever asked — the pointer or a key. Deeper
   popups close first, then the new one sits beside the row that owns it. */
function openSub(row, item, pop) {
  while (stack.length && top() !== pop) stack.pop().remove();
  const r = row.getBoundingClientRect();
  const sub = openMenu(typeof item.sub === 'function' ? item.sub() : item.sub, {
    x: r.right - 4, y: r.top - 5, parent: true,
  });
  parentRow.set(sub, row);
  row.classList.add('sel');         // a row stays lit while its submenu is open
  return sub;
}
/* drop the deepest popup and put the cursor back on the row that opened it */
function closeSub() {
  const sub = stack.pop();
  if (!sub) return;
  sub.remove();
  const row = parentRow.get(sub), pop = top();
  if (row && pop) selRow(pop, rowsOf(pop).indexOf(row));
}

/* macOS type-ahead: letters inside 700ms build a prefix; pressing the same
   letter again cycles through the items that start with it */
let typeBuf = '', typeAt = 0;
function typeAhead(ch) {
  const pop = top(); if (!pop) return;
  const now = Date.now();
  if (now - typeAt > 700) typeBuf = '';
  typeAt = now;
  typeBuf += ch;
  const cycle = typeBuf.length > 1 && [...typeBuf].every(c => c === typeBuf[0]);
  const needle = (cycle ? ch : typeBuf).toLowerCase();
  const rows = rowsOf(pop);
  const hits = rows.map((r, i) => i).filter(i => (rows[i]._item?.label || '').toLowerCase().startsWith(needle));
  if (!hits.length) return;
  const cur = sel.get(pop) ?? -1;
  selRow(pop, cycle ? (hits.find(i => i > cur) ?? hits[0]) : hits[0]);
}

/* an open menu owns the keyboard; registered once at load, before the window's
   other capture handlers, so a handled key never reaches the shortcut dispatcher */
window.addEventListener('keydown', e => {
  if (!stack.length) return;
  const pop = top();
  const swallow = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  const row = curRow(pop);
  /* arrows are navigation, not typing: the type-ahead buffer starts over */
  if (e.key.startsWith('Arrow')) typeBuf = '';
  switch (e.key) {
    case 'ArrowDown': swallow(); move(1); return;
    case 'ArrowUp': swallow(); move(-1); return;
    case 'ArrowRight':
      swallow();
      if (row?._item?.sub) { openSub(row, row._item, pop); selectFirst(); }
      return;
    case 'ArrowLeft': swallow(); if (stack.length > 1) closeSub(); return;
    case 'Enter': case 'Return':
      swallow();
      if (!row) return;
      if (row._item?.sub) { openSub(row, row._item, pop); selectFirst(); }
      else row.click();
      return;
    case 'Escape': swallow(); stack.length > 1 ? closeSub() : closeMenu(); return;
  }
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
    swallow();
    typeAhead(e.key);
  }
}, true);

/**
 * items: [{label,key,action,disabled,checked,radio,danger,keepOpen,sub} | {type:'sep'} | {type:'title',label}]
 * opts: {x,y,anchor,align:'left'|'right',className,parent,onClose}
 */
export function openMenu(items, opts = {}) {
  if (!opts.parent) closeMenu();
  const parent = opts.parent ? top() : null;
  const pop = el('div.menu-pop' + (opts.className ? '.' + opts.className : '') + (parent ? '.sub-pop' : ''));
  for (const item of items) {
    if (!item) continue;
    if (item.type === 'sep') { pop.append(el('hr')); continue; }
    if (item.type === 'title') { pop.append(el('div.title', { text: item.label })); continue; }
    const row = el('div.item' + (item.disabled ? '.disabled' : '') + (item.checked ? '.checked' : '') + (item.danger ? '.danger' : ''), {
      role: 'menuitem',
    },
      el('span.check', { html: item.checked ? (item.radio ? '•' : glyph('check', 'glyph')) : '' }),
      el('span', { text: item.label }),
      item.key ? el('span.key', { text: item.key }) : null,
      item.sub ? el('span.sub', { text: '›' }) : null,
    );
    row._item = item;
    if (!item.disabled) {
      /* the pointer moves the keyboard cursor too, so an arrow after a hover
         continues from the row the mouse last touched, the way macOS does */
      row.addEventListener('mouseenter', () => {
        sel.set(pop, rowsOf(pop).indexOf(row));
        pop.querySelectorAll('.item.sel').forEach(n => n.classList.remove('sel'));
      });
      row.addEventListener('mouseleave', () => row.classList.remove('sel'));
    }
    if (item.sub) {
      let subTimer;
      row.addEventListener('mouseenter', () => {
        clearTimeout(subTimer);
        /* close any deeper popup first, then open this submenu beside the row */
        subTimer = setTimeout(() => openSub(row, item, pop), 80);
      });
      row.addEventListener('mouseleave', () => clearTimeout(subTimer));
    } else if (!item.disabled) {
      row.addEventListener('click', e => {
        e.stopPropagation();
        if (item.action) { item.action(item, e); if (item.keepOpen) return; }
        closeMenu();
      });
    }
    pop.append(row);
  }
  document.body.append(pop);
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = opts.x ?? 0, y = opts.y ?? 0;
  if (opts.anchor) {
    const a = opts.anchor.getBoundingClientRect();
    x = opts.align === 'right' ? a.right - w : a.left;
    y = a.bottom + 3;
  }
  x = Math.max(6, Math.min(x, window.innerWidth - w - 6));
  y = Math.max(4, Math.min(y, window.innerHeight - h - 6));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  stack.push(pop);
  current = pop;
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('blur', closeMenu);
  }, 0);
  if (opts.onClose) closeHandlers.push(opts.onClose);
  return pop;
}
export const isMenuOpen = () => isOpen();
export const openMenuEl = top;

/* context menus on the desktop, Finder and other surfaces */
export function contextMenu(items, x, y) {
  return openMenu(items, { x, y, className: 'ctx-menu' });
}

/** Title-bar context menu for a window. */
export function windowMenu(win, x, y) {
  const w = window.__wm;
  return contextMenu([
    { label: 'Close', key: '⌘W', action: () => w.close(win) },
    { label: 'Minimise', key: '⌘M', action: () => w.minimize(win) },
    { label: 'Zoom', action: () => w.toggleZoom(win) },
    { type: 'sep' },
    { label: 'Move to Front', action: () => w.focus(win) },
    { label: win.title, checked: true, disabled: true },
  ], x, y);
}
