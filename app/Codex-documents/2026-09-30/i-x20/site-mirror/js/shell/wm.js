// Window manager: create, focus, drag, resize, snap, zoom, minimize, z-order.
import { el, $, clamp, emit, on, rafThrottle } from '../core/util.js';
import { saveWindow, dropWindow, save, state as storeState } from '../core/store.js';
import { appIcon } from '../core/icons.js';
import { getApp } from '../core/os.js';

const MENUBAR = 26;
const layer = () => document.getElementById('windows');
let zTop = 100;
let focused = null;
let cascade = 0;
const windows = [];

export const wm = {
  windows,
  get focused() { return focused; },
  byApp: appId => windows.filter(w => w.app === appId),
  activeAppId: () => focused?.app || 'finder',
  open, close, focus, minimize, restore, show, toggleZoom, applyFull,
  setStageMode, toggleStage, isStageOn: () => stageOn, enterMission, exitMission,
  isMission: false,
  spaces: () => spaces.slice(),
  currentSpace: () => currentSpace,
  spaceOf: win => win?.space || currentSpace,
  addSpace, removeSpace, moveToSpace, switchSpace, cycleSpace,
  toggleFullScreen, enterFullScreen, exitFullScreen,
  isFullScreen: win => !!win?.fsSpace,
  toggleDesktop, isDesktopShown: () => desktopShown,
};

/* ── spaces ──────────────────────────────────────────────────────────
   The store schema is frozen, so the desktop list keeps its own storage
   key; window records carry win.space inside saveWindow/dropWindow. */
const SPACES_KEY = 'macos.spaces.v1';
let spaces = [{ id: 'd1', name: 'Desktop 1' }];
let currentSpace = 'd1';
try {
  const saved = JSON.parse(localStorage.getItem(SPACES_KEY) || 'null');
  if (saved && Array.isArray(saved.spaces) && saved.spaces.length) {
    /* a fullscreen space holds one live window, so it never survives a reload */
    const list = saved.spaces.filter(s => s && s.id && !s.fs);
    if (list.length) {
      spaces = list;
      currentSpace = list.some(s => s.id === saved.current) ? saved.current : list[0].id;
    }
  }
} catch { /* an unreadable record just means one desktop again */ }

function saveSpaces() {
  try {
    localStorage.setItem(SPACES_KEY, JSON.stringify({
      spaces: spaces.filter(s => !s.fs).map(({ id, name }) => ({ id, name })),
      current: currentSpace,
    }));
  } catch { /* storage full or blocked: spaces just stop persisting */ }
}

/** the desktop a window is on; undefined answers "the current one" */
const winSpace = win => win.space || currentSpace;
const spaceById = id => spaces.find(s => s.id === id);

function applySpaceVisibility() {
  for (const win of windows) {
    /* minimized windows live in the Dock on every desktop, like real macOS */
    const on = win.state === 'min' || winSpace(win) === currentSpace;
    win.node.style.display = on ? '' : 'none';
  }
}

/** keep the fullscreen affordance on <html> in step with the current space */
function syncFsClass() {
  document.documentElement.classList.toggle('has-fs', !!spaceById(currentSpace)?.fs);
}

export function addSpace() {
  const id = 'd' + Math.random().toString(36).slice(2, 8);
  const name = 'Desktop ' + (spaces.filter(s => !s.fs).length + 1);
  spaces.push({ id, name });
  saveSpaces();
  emit('space:change', { id: currentSpace });
  return { id, name };
}

export function removeSpace(id) {
  const i = spaces.findIndex(s => s.id === id);
  if (i < 0 || spaces.filter(s => !s.fs).length <= 1) return;
  const s = spaces[i];
  if (s.fs) { exitFullScreen(s.fs); return; }
  /* windows on a deleted desktop move to the one before it, like macOS */
  const prev = [...spaces.slice(0, i)].reverse().find(x => !x.fs) || spaces.find(x => !x.fs);
  spaces.splice(i, 1);
  for (const win of windows) if (winSpace(win) === id) { win.space = prev.id; saveWindow(record(win)); }
  if (currentSpace === id) {
    currentSpace = prev.id;
    syncFsClass();
    applySpaceVisibility();
    const next = visible().sort((a, b) => +b.node.style.zIndex - +a.node.style.zIndex)[0];
    if (focused && winSpace(focused) !== currentSpace) { focused.node.classList.add('inactive'); focused = null; }
    if (next) focus(next); else emit('wm:focus', null);
  }
  saveSpaces();
  emit('space:change', { id: currentSpace });
  emit('wm:change');
}

export function moveToSpace(win, id) {
  const s = spaceById(id);
  if (!win || !s || s.fs || win.fsSpace || winSpace(win) === id) return;
  win.space = id;
  applySpaceVisibility();
  saveWindow(record(win));
  if (focused === win && win.space !== currentSpace) {
    focused = null;
    win.node.classList.add('inactive');
    const next = visible().sort((a, b) => +b.node.style.zIndex - +a.node.style.zIndex)[0];
    if (next) focus(next); else emit('wm:focus', null);
  }
  emit('wm:change');
}

/**
 * Switch desktops. Visible windows slide sideways off and the new desktop's
 * windows slide in from the other edge — same direction as Ctrl+Arrow on a Mac.
 */
export function switchSpace(id, opts = {}) {
  const next = spaceById(id);
  if (!next || id === currentSpace) return;
  const prev = currentSpace;
  const dir = opts.dir ?? (spaces.findIndex(s => s.id === id) > spaces.findIndex(s => s.id === prev) ? 1 : -1);
  const animate = opts.animate !== false;
  currentSpace = id;
  saveSpaces();
  syncFsClass();
  const W = window.innerWidth;
  for (const win of windows) {
    if (win.state === 'min' || winSpace(win) !== prev) continue;
    if (animate && win.node.isConnected && !win.node.classList.contains('mc-live')) {
      const node = win.node;
      node.style.transition = 'transform .3s cubic-bezier(.4,0,.3,1)';
      node.style.transform = `translateX(${-dir * W}px)`;
      setTimeout(() => {
        node.style.transition = '';
        node.style.transform = '';
        if (winSpace(win) !== currentSpace) node.style.display = 'none';
      }, 320);
    } else {
      win.node.style.display = 'none';
    }
  }
  for (const win of windows) {
    if (win.state === 'min' || winSpace(win) !== id) continue;
    win.node.style.display = '';
    if (animate && win.node.isConnected && !win.node.classList.contains('mc-live')) {
      const node = win.node;
      node.style.transition = 'none';
      node.style.transform = `translateX(${dir * W}px)`;
      void node.offsetWidth;
      node.style.transition = 'transform .32s cubic-bezier(.22,1,.36,1)';
      node.style.transform = '';
      setTimeout(() => { node.style.transition = ''; }, 340);
    }
  }
  if (focused && winSpace(focused) !== id) { focused.node.classList.add('inactive'); focused = null; }
  const top = visible().sort((a, b) => +b.node.style.zIndex - +a.node.style.zIndex)[0];
  if (top) focus(top); else emit('wm:focus', null);
  emit('space:change', { id, prev });
  emit('wm:change');
  if (wm.isMission) paintMission();
}

export function cycleSpace(dir) {
  const i = spaces.findIndex(s => s.id === currentSpace);
  const j = i + dir;
  if (j < 0 || j >= spaces.length) return;
  switchSpace(spaces[j].id, { dir });
}

/* Stage Manager: the store is the truth, this module is the runtime cache */
import('../core/store.js').then(({ state }) => {
  if (state.settings.stageManager) setStageMode(true);
  on('settings:change', ({ key }) => { if (key === 'stageManager') setStageMode(!!state.settings.stageManager); });
});

let pendingRestore = null;
/* While the persisted windows are being re-opened, focusing one must not
   drag the desktop onto its space — the saved current space wins. */
let restoreBatch = false;
let restoreTimer = 0;
/** Tell the window manager which saved record the next window replaces. */
export function expectRestore(rec) {
  pendingRestore = rec;
  restoreBatch = true;
  clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => { restoreBatch = false; }, 1200);
}

/** The Dock always keeps the last strip of the screen, like real macOS. */
function dockReserve() {
  const dock = document.getElementById('dock-wrap');
  if (!dock) return 0;
  const dockEl = document.getElementById('dock');
  if (dockEl && getComputedStyle(dockEl).display === 'none') return 0;
  const r = dock?.getBoundingClientRect();
  return r ? Math.max(0, Math.round(window.innerHeight - r.top) + 4) : 0;
}

const WORKAREA = () => ({
  top: MENUBAR,
  left: 0,
  width: window.innerWidth,
  height: Math.max(240, window.innerHeight - MENUBAR - dockReserve()),
});

/** Keep a window fully inside the work area. */
function fitRect(rect, area) {
  const w = Math.min(rect.w, area.width - 8);
  const h = Math.min(rect.h, area.height - 8);
  return {
    w: Math.max(rect.w, Math.min(w, rect.w)),
    h,
    x: clamp(rect.x, 4, Math.max(4, area.width - Math.min(rect.w, area.width - 8) - 4)),
    y: clamp(rect.y, area.top, Math.max(area.top, area.height + area.top - h - 4)),
  };
}
export function fitToScreen(win) {
  const area = WORKAREA();
  applyRect(win, fitRect(win.rect, area), true);
}

/** Window dragging: pointer capture, live move, edge snapping, drop. */
function attachDrag(win, handle, dragState, area) {
  if (!handle) return;
  const end = e => {
    const drag = dragState.current;
    if (!drag) return;
    const wasMoved = drag.moved;
    dragState.current = null;
    hideSnapHint();
    if (!wasMoved) return;
    const live = WORKAREA();
    const edge = snapTarget(e.clientX, e.clientY);
    if (edge === 'left') applyRect(win, { x: 0, y: live.top, w: Math.round(live.width / 2), h: live.height }, true);
    else if (edge === 'right') applyRect(win, { x: Math.round(live.width / 2), y: live.top, w: Math.round(live.width / 2), h: live.height }, true);
    else if (edge === 'top') applyFull(win);
    else persist(win);
  };
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button,input,.seg,.tb-btn,select,a')) return;
    /* a full-screen window does not drag; it still takes the focus */
    if (win.state === 'full') { focus(win); return; }
    if (win.state === 'zoom') dragState.current = { restoring: true, sx: e.clientX, sy: e.clientY };
    else dragState.current = { sx: e.clientX, sy: e.clientY, ox: win.rect.x, oy: win.rect.y, moved: false };
    handle.setPointerCapture?.(e.pointerId);
    focus(win);
  });
  handle.addEventListener('pointermove', e => {
    const drag = dragState.current;
    if (!drag) return;
    if (drag.restoring) {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 6) {
        const r = win.prevRect || { ...win.rect };
        applyRect(win, r, false);
        win.state = 'normal';
        win.node.classList.remove('zoomed');
        dragState.current = { sx: drag.sx, sy: drag.sy, ox: r.x, oy: r.y, moved: true };
      }
      return;
    }
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    const live = WORKAREA();
    const nx = clamp(drag.ox + dx, -win.rect.w + 90, live.width - 90);
    const ny = clamp(drag.oy + dy, live.top - 2, live.top + live.height - 30);
    applyRect(win, { ...win.rect, x: Math.round(nx), y: Math.round(ny) }, false);
    showSnapHint(snapTarget(e.clientX, e.clientY));
  });
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/* ── create ────────────────────────────────────────────────────────── */
export function open(opts) {
  const area = WORKAREA();
  const width = opts.raw ? (opts.width || area.width) : Math.min(opts.width || 720, area.width - 24);
  const height = opts.raw ? (opts.height || area.height) : Math.min(opts.height || 480, area.height - 24);
  /* new windows cascade from the previous one instead of stacking */
  const off = (cascade++ % 8) * 22;
  /* full-screen overlays (Launchpad) take the exact rect they ask for */
  const rect = opts.raw ? { x: opts.x || 0, y: opts.y || 0, w: width, h: height } : fitRect({
    x: opts.x !== undefined ? opts.x : Math.round((area.width - width) / 2 + off - 70),
    y: opts.y !== undefined ? opts.y : Math.round((area.height - height) / 2 + off - 46),
    w: width, h: height,
  }, area);
  const { x, y } = rect;

  /* Notes keeps an empty title bar, the way it does on a real Mac */
  const titleSlot = el('div.title-slot', null, el('div.win-title'));
  if (opts.chromeTitle === false) {
    titleSlot.style.visibility = 'hidden';
    titleSlot.setAttribute('aria-hidden', 'true');
  }
  const traffic = el('div.traffic', null,
    el('button.light.close', { title: 'Close', onclick: e => { e.stopPropagation(); close(win); } }),
    el('button.light.min', { title: 'Minimize', onclick: e => { e.stopPropagation(); minimize(win); } }),
    el('button.light.zoom', { title: 'Zoom', onclick: e => { e.stopPropagation(); toggleZoom(win); } }),
  );
  const tbTools = el('div.tb-tools');
  const tbRight = el('div.tb-right');
  const titlebar = el('div.titlebar' + (opts.tallTitle ? '.tall' : ''), null, traffic, tbTools, titleSlot, tbRight);
  const body = el('div.win-body');
  const main = el('div.win-main', null, titlebar, body);
  const node = el('div.window', {
    style: { left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' },
  }, main);
  node.dataset.app = opts.app;
  node.classList.add('app-' + opts.app);
  const handles = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].map(dir => el(`div.rsz.${dir}`));
  node.append(...handles);
  if (opts.chrome === false) node.classList.add('no-chrome');

  const win = {
    id: `${opts.app}:${opts.key || 'main'}:${Math.random().toString(36).slice(2, 6)}`,
    app: opts.app,
    key: opts.key || 'main',
    title: typeof opts.title === 'function' ? opts.title() : (opts.title || 'Window'),
    node, body, titlebar, titleEl: titleSlot.firstChild, tbTools, tbRight,
    rect: { x, y, w: width, h: height },
    prevRect: null,
    minW: opts.minWidth || 300,
    minH: opts.minHeight || 200,
    maxW: opts.maxWidth || 5200,
    resizable: opts.resizable !== false,
    state: 'normal',
    data: opts.data || {},
    getData: opts.getData,
    onClose: opts.onClose,
    onFocus: opts.onFocus,
    onResize: opts.onResize,
    onKey: opts.onKey,
    setTitle(t) {
      win.title = t;
      /* a window with no chrome title (Notes) keeps the text out of the bar */
      if (opts.chromeTitle !== false) win.titleEl.textContent = t;
    },
    setData(d) { win.data = { ...win.data, ...d }; },
    focus: () => focus(win),
    /** give the window DOM focus so its own key handling runs first */
    focusSelf: () => {
      if (opts.focusable === false || win.state === 'min') return;
      const active = document.activeElement;
      if (active && win.node.contains(active) && isTypingTarget(active)) return;
      const target = win.node.querySelector('[data-focus]') || win.body;
      if (!target) return;
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    },
    close: () => close(win),
    hide: () => hide(win),
    minimize: () => minimize(win),
    zoom: () => toggleZoom(win),
    restore: () => restore(win),
    /* a minimized window cannot be moved, so its rect cannot drift */
    setRect: r => { if (win.state !== 'min') applyRect(win, r, true); },
    setSidebar(sidebarNode, width = 200) {
      if (!win.sbHost) {
        win.sbHost = el('div.sb-host');
        win.sbTop = el('div.sb-top');
        win.sbBody = el('div.sb-body.scroll');
        win.sbHost.append(win.sbTop, win.sbBody);
        win.sbTop.append(traffic);
        node.replaceChildren(win.sbHost, main, ...handles);
        node.classList.add('has-sidebar');
        titlebar.classList.add('inset');
        attachDrag(win, win.sbTop, dragState, WORKAREA());
        if (win.state === 'zoom') applyFull(win);
      }
      win.sbBody.replaceChildren(sidebarNode);
      win.sbHost.style.width = width + 'px';
      return win.sbBody;
    },
    hasSidebar: () => !!win.sbHost,
    center() {
      const area = WORKAREA();
      applyRect(win, { x: Math.round((area.width - win.rect.w) / 2), y: Math.round((area.height - win.rect.h) / 2 + 20), w: win.rect.w, h: win.rect.h }, true);
    },
  };

  /* a window belongs to a desktop: the saved record wins, else the current one */
  const restore = opts.restore || pendingRestore;
  pendingRestore = null;
  win.space = (restore && spaceById(restore.space) && !spaceById(restore.space).fs)
    ? restore.space : currentSpace;

  layer().append(node);
  windows.push(win);
  /* a new window dismisses Mission Control and un-hides the desktop */
  if (wm.isMission) exitMission();
  if (desktopShown) showDesktopBack();
  const dragState = { current: null };
  if (opts.build) opts.build(win);

  /* drag by the title bar, and by the sidebar strip in sidebar windows */
  attachDrag(win, titlebar, dragState, area);
  titlebar.addEventListener('dblclick', e => {
    if (e.target.closest('button,input,.seg,.tb-btn')) return;
    toggleZoom(win);
  });

  /* resize handles */
  if (win.resizable) {
    for (const handle of node.querySelectorAll('.rsz')) {
      handle.addEventListener('pointerdown', e => {
        e.stopPropagation();
        focus(win);
        const dir = handle.className.replace('rsz ', '').trim();
        const start = { x: e.clientX, y: e.clientY, ...win.rect };
        handle.setPointerCapture(e.pointerId);
        const move = ev => {
          const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
          let { x, y, w, h } = start;
          if (dir.includes('e')) w = clamp(start.w + dx, win.minW, win.maxW);
          if (dir.includes('s')) h = clamp(start.h + dy, win.minH, 3000);
          if (dir.includes('w')) { w = clamp(start.w - dx, win.minW, win.maxW); x = start.x + (start.w - w); }
          if (dir.includes('n')) { h = clamp(start.h - dy, win.minH, 3000); y = start.y + (start.h - h); }
          y = Math.max(MENUBAR - 2, y);
          applyRect(win, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }, false);
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          if (win.state === 'zoom') { win.state = 'normal'; node.classList.remove('zoomed'); }
          persist(win);
          win.onResize?.(win);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      });
    }
  }

  node.addEventListener('pointerdown', () => focus(win), true);
  titlebar.addEventListener('contextmenu', e => {
    e.preventDefault();
    import('../shell/menus.js').then(m => m.windowMenu(win, e.clientX, e.clientY));
  });

  focus(win);
  if (opts.focusable !== false) win.focusSelf();
  requestAnimationFrame(() => node.style.animation = 'none');
  if (restore) {
    dropWindow(restore.app, restore.key);
    win.key = restore.key;          // keep the identity so saves update in place
    saveWindow(record(win));
  } else {
    saveWindow(record(win));
  }
  return win;
}

function applyRect(win, r, animate) {
  win.rect = {
    x: Math.round(r.x), y: Math.round(r.y),
    w: Math.round(Math.max(win.minW, r.w)), h: Math.round(Math.max(win.minH, r.h)),
  };
  const s = win.node.style;
  s.left = win.rect.x + 'px'; s.top = win.rect.y + 'px';
  s.width = win.rect.w + 'px'; s.height = win.rect.h + 'px';
  if (animate) { win.node.classList.add('snapping'); setTimeout(() => win.node.classList.remove('snapping'), 320); }
}
function persist(win) {
  clearTimeout(win._persistTimer);
  win._persistTimer = setTimeout(() => saveWindow(record(win)), 220);
}
const record = win => ({
  app: win.app, key: win.key,
  rect: win.state === 'full' ? { ...win.fsPrev } : { ...win.rect },
  state: win.state === 'full' ? 'normal' : win.state,
  space: win.fsSpace ? (win.fsFrom || 'd1') : (win.space || 'd1'),
  data: win.getData ? win.getData(win) : win.data,
});

function applyFull(win) {
  const area = WORKAREA();
  win.prevRect = win.state === 'zoom' ? win.prevRect : { ...win.rect };
  win.state = 'zoom';
  win.node.classList.add('zoomed');
  applyRect(win, { x: 0, y: area.top, w: area.width, h: area.height }, true);
  setTimeout(() => persist(win), 320);
}
function toggleZoom(win) {
  if (win.state === 'full') { exitFullScreen(win); return; }
  if (win.state === 'zoom') {
    win.state = 'normal';
    win.node.classList.remove('zoomed');
    applyRect(win, win.prevRect || { ...win.rect, w: 720, h: 480, x: 80, y: 60 }, true);
    setTimeout(() => persist(win), 320);
  } else applyFull(win);
}

/* ── focus / z-order ───────────────────────────────────────────────── */
export function focus(win) {
  if (!win) return;
  /* the Dock and ⌘Tab can reach a window on another desktop — macOS follows it */
  if (win.space && win.space !== currentSpace && !restoreBatch) switchSpace(win.space);
  else if (win.space && win.space !== currentSpace) win.node.style.display = 'none';
  if (win === focused) {
    zTop += 1;
    win.node.style.zIndex = zTop;
    if (win.state === 'min') restore(win);
    return;
  }
  if (focused && focused !== win) focused.node.classList.add('inactive');
  focused = win;
  zTop += 1;
  win.node.style.zIndex = zTop;
  win.node.classList.remove('inactive');
  if (win.state === 'min') restore(win);
  /* the window takes the keyboard: no shell control keeps DOM focus */
  const active = document.activeElement;
  if (active && active !== document.body && !isTypingTarget(active) && !win.node.contains(active)) active.blur?.();
  win.focusSelf?.();
  emit('wm:focus', win);
  emit('wm:change');
  win.onFocus?.(win);
}

/** true for elements that own the keyboard on purpose */
function isTypingTarget(el) {
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
export function close(win) {
  if (!win) return;
  const i = windows.indexOf(win);
  if (i >= 0) windows.splice(i, 1);
  /* a fullscreen space dies with the one window that owns it */
  if (win.fsSpace) {
    const sid = win.fsSpace;
    win.fsSpace = null;
    spaces = spaces.filter(s => s.id !== sid);
    if (currentSpace === sid) {
      currentSpace = spaces.find(s => s.id === win.fsFrom && !s.fs)?.id || spaces[0]?.id || 'd1';
      if (!spaces.length) spaces = [{ id: 'd1', name: 'Desktop 1' }];
      applySpaceVisibility();
      syncFsClass();
    }
    saveSpaces();
  }
  /* a closed window takes its dock tile with it */
  window.dispatchEvent(new CustomEvent('wm:window-closed', { detail: win }));
  win.node.classList.add('closing');
  win.onClose?.(win);
  dropWindow(win.app, win.key);
  setTimeout(() => win.node.remove(), 170);
  if (focused === win) {
    focused = null;
    const next = visible().sort((a, b) => +b.node.style.zIndex - +a.node.style.zIndex)[0];
    if (next) focus(next);
    else emit('wm:focus', null);
  }
  emit('wm:change');
}
/* "visible" means on this desktop: windows parked on other spaces stay hidden */
const visible = () => windows.filter(w => w.state !== 'min' && w.node.isConnected && winSpace(w) === currentSpace);

/* ── minimize: Genie by default, Scale when the setting says so ───────
   The settings picker only ever wrote 'Scale' before Genie existed, so a
   stored 'Scale' is the old default rather than a choice — migrate it once,
   then honour whatever the picker writes. */
if (String(storeState.settings.minimizeEffect) === 'Scale' && !storeState.settings.minFx) {
  storeState.settings.minFx = 1;
  storeState.settings.minimizeEffect = 'Genie';
  save();
}
const genieOn = () => !/scale/i.test(String(storeState.settings.minimizeEffect ?? 'Genie'));
const scaleMs = () => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--min-scale-ms'));
  return Number.isFinite(v) ? v : 450;
};

/** where a window flies to and from: its own dock tile, else the app's icon */
function slotRect(win) {
  const tile = document.querySelector(`#dock-min .min-tile[data-win="${CSS.escape(win.id)}"]`)
    || document.querySelector('#dock-min .min-tile:last-child');
  const icon = document.querySelector(`#dock .dock-item[data-app="${win.app}"]`);
  const node = tile || icon;
  return node ? node.getBoundingClientRect() : null;
}
/** the transform that puts this window's rect on that slot, in window-layer coordinates */
function flight(win, to) {
  if (!to) return '';
  const r = win.rect;
  const dx = (to.left + to.width / 2) - (r.x + r.w / 2);
  const dy = (to.top + to.height / 2) - (r.y + r.h / 2);
  const k = clamp(Math.min(to.width, to.height) / Math.max(r.w, r.h), .05, .4);
  return `translate(${dx}px, ${dy}px) scale(${k})`;
}
/** the one place a window's box is written; the rect is the only truth */
function place(win, rect) {
  const s = win.node.style;
  s.left = Math.round(rect.x) + 'px';
  s.top = Math.round(rect.y) + 'px';
  s.width = Math.round(rect.w) + 'px';
  s.height = Math.round(rect.h) + 'px';
}

/** Hide: the window leaves the desktop the way Cmd+H does, and comes back to
    the Dock the same way a minimized window does. */
export function hide(win) {
  if (!win || win.state === 'min') return;
  if (focused === win) {
    focused = null;
    const next = visible().filter(w => w !== win).sort((a, b) => +b.node.style.zIndex - +a.node.style.zIndex)[0];
    if (next) focus(next); else emit('wm:focus', null);
  }
  minimize(win);
}

export function minimize(win) {
  if (!win || win.state === 'min') return;
  if (win.state === 'full') exitFullScreen(win);
  win.restoreRect = { ...win.rect };
  /* the tile has to exist before we can fly to it */
  window.dispatchEvent(new CustomEvent('wm:minimize-request', { detail: win }));
  const to = slotRect(win);
  win.state = 'min';
  win.node.classList.add('minimized', 'minimizing');
  const ms = scaleMs();
  if (genieOn() && genieOut(win, to, ms)) {
    setTimeout(() => finishMinimize(win), ms + 120);
  } else {
    win.node.style.transformOrigin = 'center center';
    win.node.style.willChange = 'transform';
    /* the Scale effect: the whole window shrinks straight into its slot */
    win.node.style.transition = `transform ${ms}ms cubic-bezier(.4, 0, .3, 1)`;
    win.node.style.transform = flight(win, to);
    setTimeout(() => finishMinimize(win), ms);
  }
  const icon = document.querySelector(`#dock .dock-item[data-app="${win.app}"]`);
  icon?.classList.add('bounce');
  setTimeout(() => icon?.classList.remove('bounce'), 1300);
  emit('wm:change');
  setTimeout(() => persist(win), ms + 130);
}

function finishMinimize(win) {
  win.node.classList.remove('minimizing');
  win.node.style.transition = '';
  win.node.style.transform = '';
  win.node.style.willChange = '';
  win.node.style.visibility = '';
  if (!windows.includes(win)) return;
  /* a restore can land before this timer does — never park a living window */
  if (win.state !== 'min') return;
  /* only once it has landed does the window move into its dock tile */
  window.dispatchEvent(new CustomEvent('wm:minimize-dock', { detail: win }));
  if (focused === win) {
    focused = null;
    const next = visible().sort((a, b) => +b.node.style.zIndex - +a.node.style.zIndex)[0];
    if (next) focus(next); else emit('wm:focus', null);
  }
  emit('wm:change');
}

/* ── the Genie effect ────────────────────────────────────────────────
   Sliced-clone technique: the window is cloned into ~26 horizontal strips,
   each strip clipped to one band. The real node hides while every band
   funnels toward its Dock slot — lower bands pull further across and squash
   narrower, which reads exactly like genie. Transform + opacity only. */
const GENIE_BANDS = 26;
function buildStrips(win) {
  const r = win.rect;
  if (!win.node.isConnected || r.w < 40 || r.h < 40) return null;
  const host = el('div.genie-host');
  host.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;z-index:${win.node.style.zIndex || 100};`;
  const bandH = r.h / GENIE_BANDS;
  for (let i = 0; i < GENIE_BANDS; i++) {
    const strip = el('div.genie-strip');
    strip.style.top = (i * bandH) + 'px';
    strip.style.height = (Math.ceil(bandH) + 1) + 'px';
    const clone = win.node.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.remove('minimizing', 'minimized', 'closing', 'snapping', 'zoomed', 'mc-live', 'fullscreen');
    /* cloned iframes would load a second browsing context — swap for a plate */
    clone.querySelectorAll('iframe').forEach(f => {
      const plate = el('div', { style: { width: '100%', height: '100%', background: '#fff' } });
      f.replaceWith(plate);
    });
    clone.style.cssText = `position:absolute;left:0;top:${-i * bandH}px;width:${r.w}px;height:${r.h}px;transform:none;animation:none;`;
    strip.append(clone);
    host.append(strip);
  }
  layer().append(host);
  return host;
}
/** where each band ends up: pulled toward the slot, lower bands more so */
function bandTarget(win, to, i, n) {
  const r = win.rect;
  const t = n === 1 ? 1 : i / (n - 1);       /* 0 = top band, 1 = bottom */
  const bandCx = r.x + r.w / 2;
  const bandCy = r.y + (i + .5) * (r.h / n);
  const slotCx = to.left + to.width / 2;
  const slotCy = to.top + to.height / 2;
  const pull = .3 + .7 * Math.pow(t, 1.35);
  const sx = Math.max(.03, .62 * (1 - t) + (to.width / r.w) * 1.4 * t);
  return {
    x: (slotCx - bandCx) * pull,
    y: slotCy - bandCy,
    sx,
    delay: Math.round((1 - t) * 80),
    fade: 1 - t * .4,
  };
}
function genieOut(win, to, ms) {
  if (!to) return false;
  const host = buildStrips(win);
  if (!host) return false;
  win.node.style.visibility = 'hidden';
  const n = host.children.length;
  for (let i = 0; i < n; i++) {
    const b = bandTarget(win, to, i, n);
    const strip = host.children[i];
    strip.style.transition = `transform ${ms}ms var(--ease-genie, cubic-bezier(.42,.06,.3,1.02)) ${b.delay}ms, opacity ${ms}ms ease ${b.delay}ms`;
    strip.style.transform = `translate(${b.x}px, ${b.y}px) scaleX(${b.sx})`;
    strip.style.opacity = String(b.fade);
  }
  setTimeout(() => host.remove(), ms + 140);
  return true;
}
function genieIn(win, to, ms) {
  if (!to) return false;
  const host = buildStrips(win);
  if (!host) return false;
  win.node.style.visibility = 'hidden';
  const n = host.children.length;
  for (let i = 0; i < n; i++) {
    const b = bandTarget(win, to, i, n);
    const strip = host.children[i];
    strip.style.transition = 'none';
    strip.style.transform = `translate(${b.x}px, ${b.y}px) scaleX(${b.sx})`;
    strip.style.opacity = String(b.fade);
  }
  void host.offsetWidth;
  for (let i = 0; i < n; i++) {
    const b = bandTarget(win, to, i, n);
    const strip = host.children[i];
    strip.style.transition = `transform ${ms}ms var(--ease-genie, cubic-bezier(.42,.06,.3,1.02)) ${b.delay}ms, opacity ${ms}ms ease ${b.delay}ms`;
    strip.style.transform = '';
    strip.style.opacity = '1';
  }
  setTimeout(() => { host.remove(); win.node.style.visibility = ''; }, ms + 120);
  return true;
}

/**
 * Un-minimize. Every path into this function — the dock tile, the app icon,
 * Cmd-Tab, the menu bar — lands here, and the window goes back to `win.rect`,
 * which nothing else is allowed to write while it is minimized.
 */
export function restore(win) {
  if (!win) return;
  /* a minimized window on another desktop pulls you to its space first */
  if (win.space && win.space !== currentSpace) switchSpace(win.space);
  if (win.state !== 'min') {
    win.node.classList.remove('minimized');
    if (focused !== win) { focused = null; focus(win); }
    emit('wm:change');
    return;
  }
  const to = slotRect(win);
  const ms = scaleMs();
  /* the dock hands the node back and rewrites the box from the rect */
  window.dispatchEvent(new CustomEvent('wm:restore-request', { detail: win }));
  win.state = 'normal';
  win.node.classList.remove('minimized', 'minimizing');
  /* put it in its true position first, then play the flight on top of it, so
     the window is never left stranded at the tile's coordinates */
  place(win, win.rect);
  win.node.style.transformOrigin = 'center center';
  /* unpark leaves the tile's scale on the node — the genie strips carry the
     animation, so the real window comes back with no transform at all */
  if (genieOn() && genieIn(win, to, ms)) {
    win.node.style.transform = '';
    setTimeout(() => {
      /* re-minimized mid-flight: the new minimize owns the tile now */
      if (win.state !== 'normal') return;
      window.dispatchEvent(new CustomEvent('wm:restore-dock', { detail: win }));
      emit('wm:change');
    }, ms + 120);
  } else {
    win.node.style.transition = 'none';
    win.node.style.transform = flight(win, to);
    void win.node.offsetWidth;
    win.node.style.transition = `transform ${ms}ms cubic-bezier(.4, 0, .3, 1)`;
    win.node.style.transform = '';
    setTimeout(() => {
      if (win.state !== 'normal') return;
      win.node.style.transition = '';
      win.node.style.willChange = '';
      window.dispatchEvent(new CustomEvent('wm:restore-dock', { detail: win }));
      emit('wm:change');
    }, ms);
  }
  if (focused !== win) { focused = null; focus(win); }
  emit('wm:change');
}

export function show(win) {
  if (win.state === 'min') restore(win); else focus(win);
}

/* ── snapping ─────────────────────────────────────────────────────── */
let hint;
function snapTarget(cx, cy) {
  if (cy <= MENUBAR + 10) return 'top';
  if (cy > MENUBAR + 12) {
    if (cx <= 4) return 'left';
    if (cx >= window.innerWidth - 4) return 'right';
  }
  return null;
}
function showSnapHint(edge) {
  if (!edge) return hideSnapHint();
  if (!hint) { hint = el('div.snap-hint'); layer().append(hint); }
  const area = WORKAREA();
  hint.classList.add('show');
  if (edge === 'top') Object.assign(hint.style, { left: '0px', top: area.top + 'px', width: area.width + 'px', height: area.height + 'px' });
  else if (edge === 'left') Object.assign(hint.style, { left: '0px', top: area.top + 'px', width: area.width / 2 + 'px', height: area.height + 'px' });
  else if (edge === 'right') Object.assign(hint.style, { left: area.width / 2 + 'px', top: area.top + 'px', width: area.width / 2 + 'px', height: area.height + 'px' });
  else Object.assign(hint.style, { left: '0px', top: area.top + 'px', width: area.width + 'px', height: area.height + 'px' });
}
function hideSnapHint() { hint?.classList.remove('show'); setTimeout(() => { if (hint && !hint.classList.contains('show')) { hint.remove(); hint = null; } }, 180); }


/* ── mission control ───────────────────────────────────────────────── */
/* one accent per app, so a window label reads at a glance */
const APP_COLORS = {
  finder: '#3ea6ff', notes: '#ffd60a', terminal: '#1c1c1e', textedit: '#0a84ff',
  safari: '#0a84ff', music: '#ff375f', photos: '#fff', settings: '#8e8e93',
  calculator: '#ff9f0a', launchpad: '#8e8e93', appstore: '#0a84ff', about: '#8e8e93',
};
let missionLayer = null;
export function enterMission() {
  if (wm.isMission) return;
  if (desktopShown) showDesktopBack();
  wm.isMission = true;
  wm.missionRects = new Map();
  /* the scrim sits behind the windows so only the desktop is dimmed, like real Mission Control */
  wm.missionScrim = el('div.mc-scrim', { onclick: () => exitMission() });
  layer().prepend(wm.missionScrim);
  missionLayer = el('div.mc-overlay', {
    id: 'mission-control',
    onclick: e => { if (e.target === missionLayer) exitMission(); },
  });
  layer().append(missionLayer);
  paintMission();
  emit('mission:change', true);
}

/** one tile per space: the wallpaper thumbnail with tiny window rects on it */
function spaceThumb(s) {
  const wall = getComputedStyle(document.getElementById('wallpaper')).backgroundImage;
  const tile = el('button.mc-space' + (s.id === currentSpace ? '.on' : ''), {
    style: { backgroundImage: wall },
    title: s.name,
    onclick: () => { exitMission(); if (s.id !== currentSpace) switchSpace(s.id); },
  });
  const minis = el('div.mc-minis');
  for (const win of windows) {
    if (winSpace(win) !== s.id) continue;
    const rr = win.state === 'min' ? (win.restoreRect || win.rect) : win.rect;
    minis.append(el('div.mc-mini', {
      style: {
        left: clamp(rr.x / window.innerWidth * 100, 0, 97) + '%',
        top: clamp(rr.y / window.innerHeight * 100, 0, 92) + '%',
        width: Math.max(3.5, rr.w / window.innerWidth * 100) + '%',
        height: Math.max(5, rr.h / window.innerHeight * 100) + '%',
        borderTopColor: APP_COLORS[win.app] || '#c8c8cc',
      },
    }));
  }
  tile.append(minis, el('span', { text: s.name }));
  /* × removes a space once more than one exists; on a fullscreen space it
     hands the window back to its desktop instead */
  if (s.fs || spaces.filter(x => !x.fs).length > 1) {
    tile.append(el('button.mc-x', {
      title: 'Remove',
      onclick: e => { e.stopPropagation(); removeSpace(s.id); paintMission(); },
    }, '×'));
  }
  /* a window thumbnail dropped on a space moves there */
  if (!s.fs) {
    tile.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tile.classList.add('over'); });
    tile.addEventListener('dragleave', () => tile.classList.remove('over'));
    tile.addEventListener('drop', e => {
      e.preventDefault();
      tile.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      const win = windows.find(w => w.id === id);
      if (win) moveToSpace(win, s.id);
      paintMission();
    });
  }
  return tile;
}

/** repaint the spaces strip and the current space's window grid */
function paintMission() {
  if (!missionLayer) return;
  /* windows that left this desktop stop posing for the grid */
  for (const [win] of wm.missionRects) {
    if (winSpace(win) !== currentSpace || win.state === 'min' || !win.node.isConnected) {
      win.node.classList.remove('mc-live');
      win.node.style.transform = '';
      wm.missionRects.delete(win);
    }
  }
  missionLayer.replaceChildren();
  const bar = el('div.mc-spaces');
  for (const s of spaces) bar.append(spaceThumb(s));
  bar.append(el('button.mc-space.add', {
    title: 'Add Space',
    onclick: () => { addSpace(); paintMission(); },
  }, el('span.plus', { text: '+' })));
  missionLayer.append(bar);

  const open = visible();
  const area = WORKAREA();
  const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(open.length))));
  const rows = Math.ceil(open.length / cols);
  const gap = 34;
  const cellW = (area.width - 80 - gap * (cols - 1)) / cols;
  const cellH = Math.min((area.height - 190 - gap * (rows - 1)) / rows, cellW * .68);
  open.forEach((win, i) => {
    const scale = Math.min(cellW / win.rect.w, cellH / win.rect.h, 1);
    const w = win.rect.w * scale, h = win.rect.h * scale;
    const col = i % cols, row = Math.floor(i / cols);
    const x = 40 + col * (cellW + gap) + (cellW - w) / 2;
    const y = 120 + row * (cellH + gap) + (cellH - h) / 2;
    /* the real window slides into the grid; the proxy carries the label, the
       click and the drag onto a space tile */
    const app = getApp(win.app);
    const proxy = el('div.mc-proxy', {
      style: { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' },
      draggable: 'true',
      onclick: () => { exitMission(); focus(win); },
      ondragstart: e => {
        e.dataTransfer.setData('text/plain', win.id);
        e.dataTransfer.effectAllowed = 'move';
      },
    }, el('div.mc-label', null,
      el('span.mic', { html: appIcon(app?.icon || win.app) }),
      el('span', { text: win.title })));
    missionLayer.append(proxy);
    wm.missionRects.set(win, { x, y, scale });
    win.node.classList.add('mc-live');
    win.node.style.transition = 'transform .34s cubic-bezier(.22,1,.36,1)';
    win.node.style.transformOrigin = 'top left';
    win.node.style.transform = `translate(${x - win.rect.x}px, ${y - win.rect.y}px) scale(${scale})`;
  });
}

export function exitMission() {
  if (!wm.isMission) return;
  wm.isMission = false;
  for (const [win] of wm.missionRects) {
    win.node.classList.remove('mc-live');
    win.node.style.transform = '';
    win.node.style.transition = '';
  }
  const layerEl = missionLayer;
  missionLayer = null;
  const scrim = wm.missionScrim;
  wm.missionScrim = null;
  setTimeout(() => { layerEl?.remove(); scrim?.remove(); }, 60);
  emit('mission:change', false);
}
wm.missionRects = new Map();
wm.exitMission = exitMission;

/* ── true full screen ────────────────────────────────────────────────
   ⌃⌘F puts the window on a space of its own: no dock, the menu bar and the
   title bar autohide until the pointer grazes the top edge. */
export function toggleFullScreen(win) {
  if (!win) return;
  if (win.fsSpace) exitFullScreen(win); else enterFullScreen(win);
}
export function enterFullScreen(win) {
  if (!win || win.fsSpace) return;
  if (wm.isMission) exitMission();
  if (desktopShown) showDesktopBack();
  if (win.state === 'min') {
    /* the dock tile hands the node back so it can grow to the whole screen */
    window.dispatchEvent(new CustomEvent('wm:restore-request', { detail: win }));
    window.dispatchEvent(new CustomEvent('wm:restore-dock', { detail: win }));
    win.state = 'normal';
    win.node.classList.remove('minimized');
    win.node.style.transform = '';      /* the tile's parked scale must not survive */
  }
  const s = { id: 'fs-' + Math.random().toString(36).slice(2, 8), name: win.title, fs: win };
  win.fsFrom = win.space || currentSpace;
  win.fsPrev = { ...win.rect };
  spaces.push(s);
  win.fsSpace = s.id;
  win.space = s.id;
  win.state = 'full';
  win.node.classList.add('fullscreen');
  switchSpace(s.id, { animate: true });
  applyRect(win, { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }, true);
  syncFsClass();
  saveSpaces();
  persist(win);
  emit('wm:change');
}
export function exitFullScreen(win) {
  if (!win || !win.fsSpace) return;
  const sid = win.fsSpace;
  win.fsSpace = null;
  spaces = spaces.filter(s => s.id !== sid);
  const back = (spaceById(win.fsFrom) && !spaceById(win.fsFrom).fs) ? win.fsFrom
    : (spaces.find(s => !s.fs) || spaces[0]).id;
  win.space = back;
  win.state = 'normal';
  win.node.classList.remove('fullscreen');
  document.documentElement.classList.remove('fs-peek');
  if (currentSpace === sid) currentSpace = back;
  syncFsClass();
  applySpaceVisibility();
  saveSpaces();
  applyRect(win, win.fsPrev || { x: 60, y: 60, w: 720, h: 480 }, true);
  persist(win);
  emit('wm:change');
}

/* hover the top edge on a fullscreen space and the chrome slides back in */
let fsPeekTimer = 0;
document.addEventListener('pointermove', e => {
  const root = document.documentElement;
  if (!root.classList.contains('has-fs')) {
    if (root.classList.contains('fs-peek')) root.classList.remove('fs-peek');
    return;
  }
  if (e.clientY <= 3) {
    clearTimeout(fsPeekTimer);
    root.classList.add('fs-peek');
  } else if (e.clientY > 88 && root.classList.contains('fs-peek')) {
    clearTimeout(fsPeekTimer);
    fsPeekTimer = setTimeout(() => root.classList.remove('fs-peek'), 320);
  }
}, { passive: true });

/* ── show desktop (F11) ──────────────────────────────────────────────
   Every window on this desktop slides off toward its nearest screen edge;
   F11 again or a click on the desktop brings them back. */
let desktopShown = false;
export function toggleDesktop() {
  if (desktopShown) showDesktopBack(); else showDesktop();
}
function showDesktop() {
  if (desktopShown || wm.isMission) return;
  desktopShown = true;
  const W = window.innerWidth;
  for (const win of visible()) {
    const r = win.rect;
    const goLeft = r.x + r.w / 2 < W / 2;
    const dx = goLeft ? -(r.x + r.w + 30) : (W - r.x + 30);
    win.node.classList.add('desktop-away');
    win.node.style.transition = 'transform .38s cubic-bezier(.32,.72,.35,1)';
    win.node.style.transform = `translateX(${dx}px)`;
  }
  document.addEventListener('pointerdown', desktopClick, true);
}
function desktopClick(e) {
  if (!e.target.closest('#desktop')) return;
  showDesktopBack();
}
export function showDesktopBack() {
  if (!desktopShown) return;
  desktopShown = false;
  document.removeEventListener('pointerdown', desktopClick, true);
  for (const win of windows) {
    if (win.state === 'min') continue;
    if (!win.node.classList.contains('desktop-away')) continue;
    win.node.classList.remove('desktop-away');
    win.node.style.transition = 'transform .38s cubic-bezier(.32,.72,.35,1)';
    win.node.style.transform = '';
  }
}

/* ── stage manager mode ────────────────────────────────────────────── */
let stageOn = false;
const stageRects = new Map();
export function setStageMode(on) {
  stageOn = on;
  const vis = visible();
  const stripW = Math.round(window.innerWidth * .34);
  const maxH = window.innerHeight - MENUBAR - 110;
  if (on) {
    let y = MENUBAR + 18;
    for (const win of vis) {
      if (!stageRects.has(win)) stageRects.set(win, { ...win.rect });
      const scale = Math.min((stripW - 28) / win.rect.w, (maxH / Math.max(vis.length, 1) - 12) / win.rect.h, .6);
      const h = win.rect.h * scale;
      win.node.style.transition = 'transform .38s cubic-bezier(.22,1,.36,1)';
      win.node.style.transformOrigin = 'top left';
      win.node.style.transform = `translate(${14 - win.rect.x}px, ${y - win.rect.y}px) scale(${scale})`;
      y += h + 12;
    }
  } else {
    for (const win of stageRects.keys()) {
      win.node.style.transform = '';
      win.node.style.transition = 'transform .32s cubic-bezier(.22,1,.36,1)';
    }
    stageRects.clear();
  }
}
/* Stage Manager lives in the store, so Settings and Control Center share it */
export function toggleStage() {
  const next = !stageOn;
  import('../core/store.js').then(({ setSetting }) => setSetting('stageManager', next));
  setStageMode(next);
  return stageOn;
}
wm.toggleStage = toggleStage;
wm.hide = hide;
wm.setStageMode = setStageMode;

function reflow() {
  const area = WORKAREA();
  for (const win of windows) {
    if (win.state === 'full') applyRect(win, { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }, false);
    else if (win.state === 'zoom') applyRect(win, { x: 0, y: area.top, w: area.width, h: area.height }, false);
    else applyRect(win, fitRect(win.rect, area), false);
    win.onResize?.(win);
  }
}
window.addEventListener('resize', rafThrottle(reflow));
on('settings:change', ({ key }) => { if (key === 'dockSize') rafThrottle(reflow)(); });

on('wm:change', () => emit('dock:change'));
export function saveAllWindows() {
  for (const win of windows) saveWindow(record(win));
}

export const windowForApp = appId => {
  const list = wm.byApp(appId);
  return list.find(w => w.state !== 'min') || list[0] || null;
};
export { layer as windowLayer, MENUBAR };
