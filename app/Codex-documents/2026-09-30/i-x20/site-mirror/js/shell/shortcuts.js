// Keyboard shortcuts, dispatched the way macOS does it: the focused app's own
// menus decide first, from the very labels the menu bar draws. A shortcut that
// is written on a menu is a shortcut that works — there is one source of truth
// and no second, hand-wired copy to fall out of step.
import { el, $, on, emit } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from './wm.js';
import { isMenuOpen, closeMenu } from './menus.js';
import { isSpotlightOpen, openSpotlight, closeSpotlight, toggleControlCenter, closeControlCenter, isControlCenterOpen, isSwitcherOpen, openSwitcher, cycleSwitcher, commitSwitcher, cancelSwitcher, quitSwitcherApp } from './overlays.js';
import { quitApp } from './menubar.js';
import { sessionActive } from './session.js';

let metaHeld = false;

/* ── reading a shortcut label ────────────────────────────────────────────
   "⌘⇧N"  "⌥⌘⎋"  "⌘⌫"  "Ctrl+Left"  "Space"  "⌘+"  "→"  all mean the same
   thing to the person reading the menu, so they all parse the same way. */
/* the glyphs are keys, so they have to be quoted: they are not identifiers *//* the glyphs a label can carry: modifiers first, then keys */
const MOD_GLYPHS = { '\u2318': 'meta', '\u21e7': 'shift', '\u2325': 'alt', '\u2303': 'ctrl' };
const KEY_GLYPHS = {
  '\u238b': 'escape', '\u232b': 'backspace', '\u23ce': 'enter', '\u21b9': 'tab',
  '\u2191': 'arrowup', '\u2193': 'arrowdown', '\u2190': 'arrowleft', '\u2192': 'arrowright',
  '[': '[', ']': ']', ',': ',', '.': '.', '/': '/', '\\': '\\', ';': ';', "'": "'", '`': '`',
};
const NAMED_MODS = { cmd: 'meta', command: 'meta', meta: 'meta', shift: 'shift', alt: 'alt', option: 'alt', opt: 'alt', ctrl: 'ctrl', control: 'ctrl' };
const NAMED_KEYS = {
  space: ' ', spacebar: ' ', esc: 'escape', escape: 'escape', enter: 'enter', return: 'enter',
  tab: 'tab', backspace: 'backspace', del: 'delete', delete: 'delete',
  up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright',
};

/**
 * Read a menu label such as "\u2318\u21e7N", "\u2325\u2318\u238b", "Ctrl+Left", "Space" or "\u2318+" and
 * return { meta, shift, alt, ctrl, key }, or null when it is not a shortcut.
 * Modifiers may be glyphs or words, in any order, separated by + or a space.
 */
export function parseChord(label) {
  if (label == null) return null;
  let text = String(label).trim();
  if (!text) return null;
  const mods = { meta: false, shift: false, alt: false, ctrl: false };
  let key = null;
  for (const [g, m] of Object.entries(MOD_GLYPHS)) {
    while (text.includes(g)) { mods[m] = true; text = text.replace(g, ''); }
  }
  for (const [g, k] of Object.entries(KEY_GLYPHS)) {
    if (text.includes(g)) { key = k; text = text.replace(g, ''); }
  }
  for (const word of text.split(/[+\s]+/).filter(Boolean)) {
    const name = word.toLowerCase();
    if (NAMED_MODS[name]) { mods[NAMED_MODS[name]] = true; continue; }
    key = NAMED_KEYS[name] ?? word;
  }
  /* "\u2318+" leaves only a plus behind, and that plus is the key */
  if (key == null && (text.trim() === '+' || /(^|\s)\+(\s|$)/.test(String(label)))) key = '+';
  if (key == null) return null;
  return { ...mods, key: key.length === 1 ? key.toLowerCase() : String(key).toLowerCase() };
}

/** the chord a KeyboardEvent describes, in the same shape */
export function chordOf(e) {
  return {
    meta: e.metaKey,
    shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey,
    key: (e.key === ' ' ? ' ' : String(e.key || '').length === 1 ? String(e.key).toLowerCase() : String(e.key || '').toLowerCase()),
  };
}
const sameChord = (c, e) => {
  if (!c) return false;
  const meta = e.metaKey;
  if (!!c.meta !== !!meta) return false;
  if (!!c.shift !== !!e.shiftKey) return false;
  if (!!c.alt !== !!e.altKey) return false;
  /* ctrl is its own modifier: ⌃W must never read as ⌘W, and a bare label
     like F3 does not fire when Ctrl is held too */
  if (!!c.ctrl !== !!e.ctrlKey) return false;
  const k = e.key === ' ' ? ' ' : String(e.key || '').toLowerCase();
  return k === c.key;
};

/* ── the menus, as data ────────────────────────────────────────────────── */
let menuData = null;
export function setMenuSource(fn) { menuData = fn; }
export const __peek = id => menusFor(id);
function menusFor(appId) {
  if (!menuData) return null;
  try { return menuData(appId); } catch { return null; }
}

/** every item in an app's menus, flattened, with its menu title and action.
    Submenus count: a chord printed inside one is a chord someone can press. */
function itemsFor(appId) {
  const out = [];
  const walk = (list, title, depth) => {
    for (const it of list) {
      if (!it || it.type === 'sep' || it.type === 'title') continue;
      out.push({ menu: title, item: it, sub: depth > 0 });
      if (it.sub) {
        try { walk(typeof it.sub === 'function' ? it.sub() : it.sub, title, depth + 1); } catch { /* nothing to walk */ }
      }
    }
  };
  for (const m of menusFor(appId) || []) {
    let list = [];
    try { list = typeof m.items === 'function' ? m.items() : (m.items || []); } catch { list = []; }
    walk(list, m.title, 0);
  }
  return out;
}

/** flash a menu title in the menu bar, the way macOS does when you use a key */
let flashTimer = null;
export function flashMenuTitle(title) {
  clearTimeout(flashTimer);
  document.querySelectorAll('.mb-item.flash').forEach(n => n.classList.remove('flash'));
  const btn = [...document.querySelectorAll('.mb-item.app-menu')].find(n => n.textContent.trim() === title);
  if (!btn) return;
  btn.classList.add('flash');
  flashTimer = setTimeout(() => btn.classList.remove('flash'), 420);
}

/** a text field owns its own editing keys, so ⌘C there must still cut text */
function editingText(node) {
  if (!node) return false;
  const tag = node.tagName;
  if (tag === 'INPUT') return !/^(button|checkbox|radio|range|color|file|submit)$/i.test(node.type || 'text');
  return tag === 'TEXTAREA' || node.isContentEditable === true;
}

/** the chords a text field performs itself: select all, cut, copy, paste, undo */
const FIELD_CHORDS = new Set(['a', 'c', 'v', 'x', 'z']);

/* ── the dispatcher ────────────────────────────────────────────────────── */
function runMenus(e) {
  const front = wm.focused || wm.windows[wm.windows.length - 1];
  if (!front) return false;
  const inField = editingText(document.activeElement);
  for (const { menu, item, sub } of itemsFor(front.app)) {
    const chord = parseChord(item.key);
    if (!sameChord(chord, e)) continue;
    /* With a text field focused:
         · a plain key is text. Space in the Finder is Quick Look, but a space
           typed into the search field is a space, and the field wins.
         · the editing chords are the field's, and nothing else may also run.
         · every other chord a menu draws runs the menu, which is what makes
           ⌘N a new note with the caret in the body where you are typing. */
    if (inField) {
      if (!chord.meta && !chord.alt && !chord.ctrl) return false;
      if (chord.meta && !chord.alt && !chord.ctrl && FIELD_CHORDS.has(chord.key)) return true;
    }
    if (item.disabled) return true;                 /* shown, but not now */
    e.preventDefault();
    flashMenuTitle(menu);
    if (typeof item.action === 'function') {
      try {
        /* a menu action can outlive its window — an async action whose window
           closed mid-flight resolves quietly instead of throwing on the console */
        const r = item.action();
        if (r && typeof r.catch === 'function') r.catch(err => console.debug('menu action:', err));
      } catch (err) { console.debug('menu action:', err); }
    }
    else if (item.sub) {
      /* A chord on an item that only carries a submenu opens that submenu, the
         way clicking the item does. */
      const list = typeof item.sub === 'function' ? item.sub() : item.sub;
      emit('menu:open-sub', { item, items: list });
    }
    return true;
  }
  return false;
}

/** diagnostic seams: what the handler last saw, and a hand-run of the dispatcher */
export const __trace = { calls: 0, last: null };
export const __dispatch = e => runMenus(e);

/* The Window menu itself belongs to menubar.js; the desktop-move rows are
   grafted onto the open menu here, the one seam the visual menu shares. */
function graftSpaceItems() {
  const openBtn = document.querySelector('.mb-item.app-menu.open');
  if (!openBtn || openBtn.textContent.trim() !== 'Window') return;
  /* the root pop of the open menu — a submenu also lands on body, so skip it */
  const pops = document.querySelectorAll('body > .menu-pop:not(.sub-pop)');
  const pop = pops[pops.length - 1];
  if (!pop || pop.dataset.spacesAug) return;
  const win = wm.focused;
  pop.dataset.spacesAug = '1';
  if (!win || win.fsSpace) return;
  const list = wm.spaces().filter(s => !s.fs);
  if (list.length < 2) return;
  pop.append(el('hr'));
  for (const s of list) {
    const on = (win.space || list[0].id) === s.id;
    const row = el('div.item' + (on ? '.checked' : ''), { role: 'menuitem' },
      el('span.check', { html: on ? glyph('check', 'glyph') : '' }),
      el('span', { text: `Move Window to ${s.name}` }));
    row.addEventListener('click', e => {
      e.stopPropagation();
      wm.moveToSpace(win, s.id);
      closeMenu();
    });
    pop.append(row);
  }
}

export function initShortcuts() {
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  new MutationObserver(graftSpaceItems).observe(document.body, { childList: true });
}

function onKeyDown(e) {
  __trace.calls++;
  __trace.last = {
    key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey,
    session: sessionActive(), front: (wm.focused || {}).app,
    active: document.activeElement ? document.activeElement.tagName + '.' + (document.activeElement.className || '') : 'none',
    inField: editingText(document.activeElement), handled: 'pending',
  };
  if (sessionActive()) {
    /* boot, lock, sleep and power screens own every key */
    if (e.key === 'Enter' || e.key === 'Escape' || e.key.length === 1) return;
  }
  /* Ctrl is not Command: on this Mac the shell keeps its own Ctrl keys */
  const meta = e.metaKey;
  const key = e.key;
  const modOnly = key === 'Meta' || key === 'Control' || key === 'Shift' || key === 'Alt';

  /* while the switcher is up the keyboard belongs to it: Tab walks, Q quits the
     highlighted app, Enter clicks, Esc cancels — typing does nothing */
  if (isSwitcherOpen()) {
    if (key === 'Tab') { e.preventDefault(); cycleSwitcher(e.shiftKey); return; }
    if (key === 'Escape') { e.preventDefault(); cancelSwitcher(); return; }
    if (key === 'Enter') { e.preventDefault(); commitSwitcher(); return; }
    if (key === 'ArrowRight' || key === 'ArrowDown') { e.preventDefault(); cycleSwitcher(false); return; }
    if (key === 'ArrowLeft' || key === 'ArrowUp') { e.preventDefault(); cycleSwitcher(true); return; }
    if (key.toLowerCase() === 'q') { e.preventDefault(); quitSwitcherApp(); return; }
    if (modOnly) return;
    e.preventDefault();
    return;
  }
  /* Mission Control answers only to its own keys — typing does nothing */
  if (wm.isMission) {
    const shellKey = key === 'Escape' || key === 'F3' || key === 'F4'
      || (e.ctrlKey && (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp'));
    if (!shellKey && !modOnly) { e.preventDefault(); return; }
  }

  /* ⌃⌘F is true full screen in Sequoia — it beats any menu that prints it */
  if (meta && e.ctrlKey && !e.shiftKey && !e.altKey && key.toLowerCase() === 'f') {
    e.preventDefault();
    if (wm.focused) wm.toggleFullScreen(wm.focused);
    return;
  }

  /* 1. the focused app's own menus, from the labels the menu bar draws */
  if (runMenus(e)) { __trace.last.handled = 'menu'; return; }
  __trace.last.handled = 'none';

  /* 2. the true globals: there is no Cmd+digit on a real Mac */
  if (key === 'F3' || (e.ctrlKey && key === 'ArrowUp')) {
    e.preventDefault();
    import('./overlays.js').then(o => o.toggleMissionControl());
    return;
  }
  if (key === 'F4') {
    e.preventDefault();
    import('../core/os.js').then(o => o.launch('launchpad'));
    return;
  }
  if (meta && (key === ' ' || key === 'Spacebar')) {
    e.preventDefault();
    isSpotlightOpen() ? closeSpotlight() : openSpotlight();
    return;
  }
  if (e.key === 'Tab' && (e.metaKey || (e.ctrlKey && !isSpotlightOpen()))) {
    e.preventDefault();
    if (isMenuOpen()) closeMenu();
    if (!isSwitcherOpen()) openSwitcher();
    else cycleSwitcher(e.shiftKey);
    return;
  }
  if (meta || e.ctrlKey) metaHeld = true;

  /* media keys are the Music app's, whoever is focused: the bus carries them */
  if (key === 'F7' || key === 'F8' || key === 'F9') {
    e.preventDefault();
    emit('media:key', { action: key === 'F7' ? 'prev' : key === 'F8' ? 'playpause' : 'next' });
    return;
  }
  /* F11 shows the desktop; again or a desktop click brings the windows back */
  if (key === 'F11') {
    e.preventDefault();
    wm.toggleDesktop();
    return;
  }
  /* Ctrl+← / Ctrl+→ move between desktops */
  if (e.ctrlKey && !meta && !e.shiftKey && !e.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    e.preventDefault();
    wm.cycleSpace(key === 'ArrowRight' ? 1 : -1);
    return;
  }

  /* window commands, for apps whose menus do not carry them */
  if (meta && key.toLowerCase() === 'w') {
    e.preventDefault();
    if (isSpotlightOpen()) closeSpotlight();
    else if (wm.focused) wm.close(wm.focused);
    return;
  }
  if (meta && key.toLowerCase() === 'm' && !e.shiftKey) {
    if (wm.focused) { e.preventDefault(); wm.minimize(wm.focused); }
    return;
  }
  if (meta && key.toLowerCase() === 'n' && !e.shiftKey) {
    const front = wm.focused || wm.windows[wm.windows.length - 1];
    if (front) {
      e.preventDefault();
      import('../core/os.js').then(o => o.newWindow(front.app, { path: front._findLastPath?.() }));
    }
    return;
  }
  if (meta && key === ',') {
    const front = wm.focused || wm.windows[wm.windows.length - 1];
    if (front) {
      e.preventDefault();
      import('../core/os.js').then(o => o.appSettings(front.app));
    }
    return;
  }
  if (meta && e.shiftKey && (key === '3' || key === '#')) {
    e.preventDefault();
    import('./shot.js').then(m => m.takeScreenshot());
    return;
  }
  if (meta && e.shiftKey && (key === '4' || key === '$')) {
    e.preventDefault();
    /* shot.js grows area selection later; the whole-screen shot is the floor */
    import('./shot.js').then(m => { const fn = m.takeAreaShot || m.takeScreenshot; fn?.(); });
    return;
  }
  if (meta && e.shiftKey && (key === '5' || key === '%')) {
    e.preventDefault();
    import('./shot.js').then(m => { const fn = m.screenshotPanel || m.takeScreenshot; fn?.(); });
    return;
  }
  if (meta && key.toLowerCase() === 'q') {
    e.preventDefault();
    if (wm.focused) quitApp(wm.focused.app);
    return;
  }
  /* Hide the front app — every one of its windows — and the others with ⌥ */
  if (meta && key.toLowerCase() === 'h') {
    e.preventDefault();
    const front = wm.focused;
    if (!front) return;
    const victims = e.altKey ? wm.windows.filter(w => w.app !== front.app) : wm.byApp(front.app);
    for (const w of victims) wm.hide(w);
    return;
  }
  /* ⌘` cycles the windows of the front app */
  if (meta && (key === '`' || key === '~')) {
    e.preventDefault();
    const front = wm.focused;
    if (!front) return;
    const mine = wm.byApp(front.app).filter(w => w.state !== 'min');
    if (mine.length < 2) return;
    const i = mine.indexOf(front);
    wm.focus(mine[(i + 1) % mine.length]);
    return;
  }

  /* Escape walks down a stack: the shell's modal overlays first (they answer
     to Esc even while a text field inside them has focus), then the window's
     popovers — find bars, Quick Look, sheets — and only then the open menu */
  if (key === 'Escape') {
    if (isSpotlightOpen()) { closeSpotlight(); e.preventDefault(); return; }
    if (isControlCenterOpen()) { closeControlCenter(); e.preventDefault(); return; }
    if (isSwitcherOpen()) { cancelSwitcher(); e.preventDefault(); return; }
    if (wm.isMission) { import('./overlays.js').then(o => o.closeOverlays()); e.preventDefault(); return; }
    const win0 = wm.focused;
    if (win0?.onKey && win0.onKey(e, win0) === true) { e.preventDefault(); return; }
    if (isMenuOpen()) { closeMenu(); e.preventDefault(); return; }
    return;
  }

  /* 3. the app's own key handler, for everything its menus do not claim */
  const win = wm.focused;
  if (win?.onKey && win.onKey(e, win) === true) { e.preventDefault(); return; }
}

function onKeyUp(e) {
  if ((e.key === 'Meta' || e.key === 'Control') && metaHeld) {
    metaHeld = false;
    if (isSwitcherOpen()) commitSwitcher();
  }
}
window.addEventListener('blur', () => { metaHeld = false; if (isSwitcherOpen()) cancelSwitcher(); });
