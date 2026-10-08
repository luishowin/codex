// Menu bar: Apple menu, active app menus, status area, live clock.
import { el, $, on, emit, menuClock, DAY_NAMES, MONTH_NAMES } from '../core/util.js';
import { MACHINE, userName } from '../core/device.js';
import { glyph, appleLogo, appIcon } from '../core/icons.js';
import { openMenu, closeMenu, isMenuOpen } from './menus.js';
import { wm } from './wm.js';
import { setMenuSource } from './shortcuts.js';
import { getApp, launch, allApps } from '../core/os.js';
import { state, setSetting } from '../core/store.js';
import * as fs from '../core/fs.js';
import * as session from './session.js';
import { openSpotlight, toggleControlCenter } from './overlays.js';
import { notify } from './notify.js';

const bar = () => document.getElementById('menubar');
let appleBtn = null, nameBtn = null, menuBar = null, statusEl = null;

export function initMenubar() {
  const root = bar();
  menuBar = el('div.mb-left', { style: { display: 'flex', alignItems: 'center' } });
  appleBtn = el('button.mb-item.mb-apple', { html: appleLogo(), title: 'Apple menu', 'aria-label': 'Apple menu' });
  appleBtn.addEventListener('click', () => toggleApple());
  appleBtn.addEventListener('mouseenter', () => { if (isMenuOpen()) toggleApple(); });
  nameBtn = el('button.mb-item.mb-app');
  menuBar.append(appleBtn, nameBtn);
  statusEl = el('div.mb-right');
  root.replaceChildren(menuBar, statusEl);
  renderStatus();
  renderAppMenus();
  tickClock();
  setInterval(tickClock, 1000);
  on('wm:focus', renderAppMenus);
  on('wm:change', renderAppMenus);
  on('settings:change', renderStatus);
}

/* ── Apple menu ────────────────────────────────────────────────────── */
/** the Apple menu as data, so the keyboard dispatcher reads it like any other */
export const APPLE_MENU = { title: 'Apple', items: () => appleItems() };
export function appleItems() {
  const recent = fs.recentlyUsed(8);
  return [
    { label: 'About This Mac', action: () => launch('about') },
    { type: 'sep' },
    { label: 'System Settings…', action: () => launch('settings') },
    { label: 'App Store…', action: () => launch('appstore') },
    { type: 'sep' },
    {
      label: 'Recent Items', sub: recent.length ? [
        ...recent.map(n => ({ label: n.name, action: () => launch('finder', { path: fs.pathOf(n) }) })),
        { type: 'sep' },
        { label: 'Clear Menu', action: () => notify('Finder', 'Recent items cleared') },
      ] : [{ label: 'None', disabled: true }],
    },
    { type: 'sep' },
    { label: 'Force Quit…', key: '⌥⌘⎋', action: openForceQuit },
    { type: 'sep' },
    { label: 'Sleep', action: () => session.sleep() },
    { label: 'Restart…', action: () => session.restart() },
    { label: 'Shut Down…', action: () => session.shutdown() },
    { type: 'sep' },
    { label: 'Lock Screen', key: '⌃⌘Q', action: () => session.lock() },
    { label: `Log Out ${cap(userName())}…`, key: '⇧⌘Q', action: () => logOut() },
    { type: 'sep' },
    { label: 'Reset This Mac…', danger: true, action: () => confirmReset() },
  ];
}
function toggleApple() {
  if (appleBtn.classList.contains('open')) { closeMenu(); appleBtn.classList.remove('open'); return; }
  openApple();
}
function openApple() {
  appleBtn.classList.add('open');
  openMenu(appleItems(), {
    anchor: appleBtn,
    onClose: () => appleBtn.classList.remove('open'),
  });
}
export function quitApp(appId) {
  const list = wm.byApp(appId);
  for (const win of list.slice()) wm.close(win);
  emit('app:quit', appId);
  const next = wm.windows.filter(w => w.state !== 'min').sort((a, b) => +b.node.style.zIndex - +a.node.style.zIndex)[0];
  if (next) wm.focus(next);
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** shared modal: a question with Cancel + one primary action */
function confirmSheet({ title, body = '', okLabel = 'Continue', danger = false, onOk }) {
  const box = el('div.dialog-box', { style: { width: '300px' } },
    el('h3', { text: title }),
    body ? el('p', { text: body }) : null,
    el('div.row', null,
      el('button.btn', { text: 'Cancel', onclick: () => dlg.remove() }),
      el('button.btn.primary', { text: okLabel, style: danger ? { background: '#e02726' } : {}, onclick: () => { dlg.remove(); onOk(); } }),
    ),
  );
  const dlg = el('div.overlay', { style: { zIndex: 12500 } }, el('div.scrim'), el('div', {
    style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' }, onclick: e => { if (e.target === dlg) dlg.remove(); },
  }, box));
  document.getElementById('overlays').append(dlg);
}
function logOut() {
  const who = cap(MACHINE.user || userName());
  confirmSheet({ title: `Are you sure you want to log out ${who} now?`, okLabel: 'Log Out', onOk: () => session.lock() });
}

/* ── Force Quit: a real window listing the running apps ────────────── */
let fqWin = null;
function openForceQuit() {
  if (fqWin && wm.windows.includes(fqWin)) { wm.show(fqWin); return; }
  fqWin = wm.open({
    app: 'forcequit',
    key: 'force-quit',
    title: 'Force Quit Applications',
    width: 460, height: 340, minWidth: 400, minHeight: 220,
    resizable: true,
    build: buildForceQuit,
  });
}
function buildForceQuit(win) {
  const list = el('div.fq-list', { role: 'listbox' });
  const btn = el('button.btn.primary.fq-btn', { text: 'Force Quit' });
  let sel = null;
  const rows = () => {
    const ids = new Set(['finder']);
    for (const w of wm.windows) if (w.app !== 'forcequit') ids.add(w.app);
    return [...ids];
  };
  const render = () => {
    list.replaceChildren(...rows().map(id => {
      const app = getApp(id);
      const row = el('div.fq-row' + (id === sel ? '.sel' : ''), { role: 'option' },
        el('span.fq-ic', { html: appIcon(app?.icon || id) }),
        el('span.fq-name', { text: app?.name || id }),
      );
      row.addEventListener('click', () => { sel = id; render(); });
      row.addEventListener('dblclick', () => { sel = id; forceQuit(); });
      return row;
    }));
    btn.disabled = !sel;
    btn.textContent = sel === 'finder' ? 'Relaunch' : 'Force Quit';
  };
  function forceQuit() {
    if (!sel) return;
    const id = sel, name = getApp(id)?.name || id;
    if (id === 'finder') { quitApp('finder'); launch('finder'); }   /* Finder only ever relaunches */
    else { quitApp(id); notify('Force Quit', `"${name}" quit unexpectedly`, { app: 'finder' }); }
    sel = null;
    setTimeout(render, 80);
  }
  btn.addEventListener('click', forceQuit);
  win.node.addEventListener('keydown', e => {
    if (e.key === 'Enter' && sel) { e.preventDefault(); forceQuit(); }
    if (e.key === 'Escape') { e.preventDefault(); wm.close(win); }
  });
  win.body.append(el('div.fq-wrap', null, list, el('div.fq-foot', null, btn)));
  const off = on('wm:change', render);
  win.onClose = () => { off(); fqWin = null; };
  render();
}

/** Reset This Mac: confirm, wipe everything, then replay the boot. */
function confirmReset() {
  const items = fs.walkAll().length;
  const body = `This erases every file, note and setting stored by this Mac (${items} items) and returns to a fresh desktop. This cannot be undone.`;
  const box = el('div.dialog-box', { style: { width: '320px' } },
    el('h3', { text: 'Are you sure you want to reset this Mac?' }),
    el('p', { text: body }),
    el('div.row', null,
      el('button.btn', { text: 'Cancel', onclick: () => dlg.remove() }),
      el('button.btn.primary', { text: 'Reset', style: { background: '#e02726' }, onclick: () => { dlg.remove(); doReset(); } }),
    ),
  );
  const dlg = el('div.overlay', { style: { zIndex: 12500 } }, el('div.scrim'), el('div', {
    style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' }, onclick: e => { if (e.target === dlg) dlg.remove(); },
  }, box));
  document.getElementById('overlays').append(dlg);
}

function doReset() {
  import('../core/store.js').then(async store => {
    store.beginReset();
    window.__wm.windows.slice().forEach(w => { try { w.onClose?.(w); } catch { /* ignore */ } w.node.remove(); });
    window.__wm.windows.length = 0;
    try {
      localStorage.removeItem('macos.state.v2');
      localStorage.removeItem('macos.prefs.v2');
      localStorage.removeItem('macos.terminal.history');
    } catch { /* ignore */ }
    state.fs = null;
    state.notes = [];
    state.notesSeeded = false;
    state.windows = [];
    Object.assign(state.settings, {
      appearance: 'light', accent: 'blue', wallpaper: 'sequoia', dockSize: 56, dockMagnify: true, minimizeEffect: 'Scale',
      brightness: 1, volume: .55, wifi: true, bluetooth: true, airdrop: 'Everyone', focus: false, booted: false,
    });
    store.endReset();
    const fs = await import('../core/fs.js');
    fs.initFS();
    import('./appearance.js').then(a => a.applySettings());
    import('./dock.js').then(d => { d.initDock(); });
    import('./desktop.js').then(d => d.initDesktop());
    session.boot({ fresh: true, onDone: () => { launch('finder', { path: fs.HOME }); } });
  });
}

/* ── app menus ─────────────────────────────────────────────────────── */
function renderAppMenus() {
  if (!menuBar) return;
  const appId = wm.activeAppId();
  const app = getApp(appId);
  nameBtn.textContent = app?.name || 'Finder';
  const existing = menuBar.querySelectorAll('.mb-item.app-menu');
  existing.forEach(n => n.remove());
  const menus = [...(app?.menus ? app.menus() : []), ...windowMenus(appId), helpMenu()];
  /* the keyboard dispatcher reads exactly this list, so a shortcut drawn on a
     menu and a shortcut that works can never drift apart */
  setMenuSource(id => {
    const a = getApp(id);
    return [APPLE_MENU, ...(a?.menus ? a.menus() : []), ...windowMenus(id), helpMenu()];
  });
  for (const menu of menus) {
    if (!menu) continue;
    const btn = el('button.mb-item.app-menu', { text: menu.title });
    btn.addEventListener('click', e => { e.stopPropagation(); toggleAppMenu(btn, menu); });
    /* a menu already open hands over on hover, the way macOS does */
    btn.addEventListener('mouseenter', () => { if (isMenuOpen() && !btn.classList.contains('open')) toggleAppMenu(btn, menu); });
    menuBar.append(btn);
  }
}
function toggleAppMenu(btn, menu) {
  if (btn.classList.contains('open')) { closeMenu(); return; }
  document.querySelectorAll('.mb-item.open').forEach(n => n.classList.remove('open'));
  btn.classList.add('open');
  const items = typeof menu.items === 'function' ? menu.items() : menu.items;
  openMenu(items, { anchor: btn, onClose: () => btn.classList.remove('open') });
}
function windowMenus(appId) {
  const list = wm.byApp(appId);
  return [{
    title: 'Window',
    items: () => [
      { label: 'Minimize', key: '⌘M', disabled: !wm.focused, action: () => wm.focused && wm.minimize(wm.focused) },
      { label: 'Zoom', disabled: !wm.focused, action: () => wm.focused && wm.toggleZoom(wm.focused) },
      { type: 'sep' },
      ...(list.length ? list.map(win => ({
        label: win.title, checked: win === wm.focused, action: () => wm.show(win),
      })) : [{ label: 'No Windows', disabled: true }]),
      { type: 'sep' },
      { label: 'Bring All to Front', action: () => list.forEach(w => wm.focus(w)) },
    ],
  }];
}
/* A chord on an item that only carries a submenu opens that submenu, by the
   same code path a click takes: open the owning menu, then hand the row a
   hover. There is no second implementation to fall out of step. */
on('menu:open-sub', ({ menu, item }) => {
  const label = item.label;
  const open = () => {
    const pop = [...document.querySelectorAll('.menu-pop')].pop();
    if (!pop) return;
    const row = [...pop.querySelectorAll('.item')].find(n => n.textContent.replace(/[\s\u00a0]+$/, '').trim().startsWith(label.replace(/…$/, '')));
    if (row) row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  };
  if (isMenuOpen()) { open(); return; }
  const btn = menu === 'Apple' ? appleBtn
    : [...menuBar.querySelectorAll('.mb-item.app-menu')].find(n => n.textContent.trim() === menu);
  if (!btn) return;
  if (menu === 'Apple') openApple(); else toggleAppMenu(btn, menuDefFor(btn, menu));
  setTimeout(open, 60);
});
/** the menu definition behind a menu-bar title, for the chord path */
function menuDefFor(btn, title) {
  const id = wm.activeAppId();
  const a = getApp(id);
  return [APPLE_MENU, ...(a?.menus ? a.menus() : []), ...windowMenus(id), helpMenu()]
    .find(m => m.title === title);
}
function helpMenu() {
  return {
    title: 'Help',
    items: [
      { label: 'Welcome to macOS', action: () => launch('safari', { page: 'welcome' }) },
      { label: 'Keyboard Shortcuts', action: () => launch('safari', { page: 'shortcuts' }) },
    ],
  };
}

/* ── status area ───────────────────────────────────────────────────── */
/* every status icon opens its own real menu or panel, the way macOS does */
let battInfo = { level: 1, charging: true };
let battKnown = false;
function initBattery() {
  if (battKnown || !navigator.getBattery) return;
  navigator.getBattery().then(b => {
    battKnown = true;
    const up = () => { battInfo = { level: b.level, charging: b.charging }; updateBattButton(); };
    b.addEventListener('levelchange', up);
    b.addEventListener('chargingchange', up);
    up();
  }).catch(() => {});
}
function battGlyph() {
  const pct = Math.round(battInfo.level * 100);
  const fill = Math.max(2, Math.round(pct / 100 * 16));
  const charge = battInfo.charging ? ' charging' : '';
  return `<span class="batt-glyph${charge}" title="Battery"><i style="width:${fill}px"></i></span>`;
}
function updateBattButton() {
  const b = statusEl?.querySelector('.mb-batt');
  if (!b) return;
  b.querySelector('.mb-pct').textContent = Math.round(battInfo.level * 100) + '%';
  const g = b.querySelector('.batt-glyph');
  if (g) g.outerHTML = battGlyph();
}

function renderStatus() {
  if (!statusEl) return;
  const s = state.settings;
  initBattery();
  const mk = (name, title, html) => el('button.mb-item', { title, 'aria-label': title, html: html ?? glyph(name, 'glyph') });
  const cc = mk('control', 'Control Center');
  cc.addEventListener('click', e => { e.stopPropagation(); toggleControlCenter(cc); });
  const siri = mk('siri', 'Siri', siriOrbIcon());
  siri.classList.add('mb-siri');
  siri.addEventListener('click', e => { e.stopPropagation(); toggleSiri(siri); });
  const battery = el('button.mb-item.mb-batt', { title: 'Battery', 'aria-label': 'Battery' },
    el('span.mb-pct', { text: Math.round(battInfo.level * 100) + '%' }),
    el('span', { html: battGlyph(), style: { display: 'grid', placeItems: 'center' } }));
  battery.addEventListener('click', e => { e.stopPropagation(); batteryMenu(battery); });
  const wifi = mk(s.wifi ? 'wifi' : 'wifiOff', 'Wi-Fi');
  if (!s.wifi) wifi.style.opacity = '.45';
  wifi.addEventListener('click', e => { e.stopPropagation(); wifiMenu(wifi); });
  const search = mk('search', 'Spotlight Search');
  search.addEventListener('click', () => openSpotlight());
  const clock = el('button.mb-item.mb-clock', { text: menuClockText() });
  clock.addEventListener('click', e => {
    e.stopPropagation();
    import('./center.js').then(c => c.toggleCenter());
  });
  /* Show in Menu Bar decides which status items exist at all */
  const on_ = new Set(state.settings.ccMenuBar || ['battery', 'wifi', 'spotlight', 'controlcenter', 'siri']);
  statusEl.replaceChildren(
    ...(on_.has('battery') ? [battery] : []),
    ...(on_.has('wifi') ? [wifi] : []),
    ...(on_.has('spotlight') ? [search] : []),
    ...(on_.has('controlcenter') ? [cc] : []),
    ...(on_.has('siri') ? [siri] : []),
    clock);
}

/* the Siri glyph is an iridescent orb, not a crosshair */
function siriOrbIcon() {
  return `<svg class="siri-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <defs><radialGradient id="siri-g" cx="38%" cy="32%" r="80%">
      <stop offset="0%" stop-color="#a6e9ff"/><stop offset="35%" stop-color="#7f7bf4"/>
      <stop offset="70%" stop-color="#c05cf0"/><stop offset="100%" stop-color="#5b3bd6"/>
    </radialGradient></defs>
    <circle cx="12" cy="12" r="9" fill="url(#siri-g)"/>
    <circle cx="12" cy="12" r="5.6" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.2"/>
    <circle cx="12" cy="12" r="2.6" fill="rgba(255,255,255,.85)"/>
  </svg>`;
}

/* ── Wi-Fi menu ────────────────────────────────────────────────────── */
const KNOWN_NETS = ['HomeNet'];
const OTHER_NETS = ['BunnyNet 5G', 'Coffee Shop Guest', 'Airport Free Wi-Fi', 'xfinitywifi'];
const wifiKnown = () => state.settings.wifiKnown || KNOWN_NETS;

function wifiMenu(btn) {
  const s = state.settings;
  const items = [
    { label: 'Wi-Fi', checked: !!s.wifi, action: () => { setSetting('wifi', !state.settings.wifi); reopen(); } },
    { type: 'sep' },
  ];
  if (s.wifi) {
    const current = s.wifiNetwork || 'HomeNet';
    items.push({ type: 'title', label: 'Known Networks' });
    for (const n of wifiKnown()) items.push({
      label: n, checked: n === current,
      action: () => setSetting('wifiNetwork', n),
    });
    const others = OTHER_NETS.filter(n => !wifiKnown().includes(n));
    if (others.length) {
      items.push({ type: 'sep' }, { type: 'title', label: 'Other Networks' });
      for (const n of others) items.push({ label: n, action: () => joinNetwork(n) });
    }
    items.push({ type: 'sep' });
  }
  items.push({ label: 'Network Settings…', action: () => launch('settings', { pane: 'wifi' }) });
  const reopen = () => setTimeout(() => wifiMenu(btn), 60);
  btn.classList.add('open');
  openMenu(items, { anchor: btn, align: 'right', onClose: () => btn.classList.remove('open') });
}
/* networks the Mac has never joined ask for a password first */
function joinNetwork(name) {
  const field = el('input.field', { type: 'password', placeholder: 'Password', 'aria-label': 'Password' });
  const err = el('div.join-err');
  const doJoin = () => {
    if (!field.value) { err.textContent = 'The Wi-Fi network requires a password.'; field.focus(); return; }
    dlg.remove();
    setSetting('wifiNetwork', name);
    setSetting('wifiKnown', [...new Set([...wifiKnown(), name])]);
    notify('Wi-Fi', `Connected to "${name}"`, { app: 'settings' });
  };
  const box = el('div.dialog-box.wifi-join', { style: { width: '280px' } },
    el('h3', { text: `Enter the password for "${name}"` }),
    field, err,
    el('div.row', null,
      el('button.btn', { text: 'Cancel', onclick: () => dlg.remove() }),
      el('button.btn.primary', { text: 'Join', onclick: doJoin }),
    ),
  );
  const dlg = el('div.overlay', { style: { zIndex: 12500 } }, el('div.scrim'), el('div', {
    style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' }, onclick: e => { if (e.target === dlg) dlg.remove(); },
  }, box));
  field.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') doJoin();
    if (e.key === 'Escape') dlg.remove();
  });
  document.getElementById('overlays').append(dlg);
  setTimeout(() => field.focus(), 40);
}

/* ── Battery menu ──────────────────────────────────────────────────── */
function batteryMenu(btn) {
  const pct = Math.round(battInfo.level * 100);
  const source = battInfo.charging ? 'Power Adapter' : 'Battery';
  const apps = [...new Set(wm.windows.filter(w => w.app !== 'forcequit').map(w => w.app))];
  btn.classList.add('open');
  openMenu([
    { type: 'title', label: 'Battery' },
    { label: `Battery: ${pct}%`, disabled: true },
    { label: `Power Source: ${source}`, disabled: true },
    { type: 'sep' },
    { type: 'title', label: 'Using Significant Energy' },
    ...(apps.length
      ? apps.map(id => ({ label: getApp(id)?.name || id, action: () => { const w = wm.byApp(id)[0]; if (w) wm.show(w); } }))
      : [{ label: 'No Apps Using Significant Energy', disabled: true }]),
    { type: 'sep' },
    { label: 'Battery Settings…', action: () => launch('settings', { pane: 'battery' }) },
  ], { anchor: btn, align: 'right', onClose: () => btn.classList.remove('open') });
}

/* ── Siri panel ────────────────────────────────────────────────────── */
let siriPop = null;
function toggleSiri(btn) {
  if (siriPop) { closeSiri(); return; }
  const orb = el('div.siri-orb', { html: siriOrbIcon() });
  const reply = el('div.siri-reply', { text: 'Hi. What can I do for you?' });
  const input = el('input.siri-input', { type: 'text', placeholder: 'Ask anything', 'aria-label': 'Ask Siri' });
  siriPop = el('div.siri-panel.glass', null,
    el('div.siri-head', null, orb, el('span.siri-title', { text: 'Siri' })),
    reply,
    el('form.siri-form', null, input));
  const r = btn.getBoundingClientRect();
  siriPop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  siriPop.style.top = (r.bottom + 6) + 'px';
  document.getElementById('overlays').append(siriPop);
  const outside = e => { if (siriPop && !siriPop.contains(e.target) && e.target !== btn) closeSiri(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  siriPop._outside = outside;
  siriPop._orb = orb;
  siriPop._reply = reply;
  siriPop.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    askSiri(q, orb, reply);
  });
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); siriPop.querySelector('form').requestSubmit(); }
    if (e.key === 'Escape') closeSiri();
  });
  setTimeout(() => input.focus(), 40);
}
function closeSiri() {
  document.removeEventListener('pointerdown', siriPop?._outside, true);
  siriPop?.remove();
  siriPop = null;
}
/* the orb pulses while Siri "thinks", then the answer lands */
function askSiri(q, orb, reply) {
  orb.classList.add('listening');
  reply.textContent = '…';
  setTimeout(() => {
    orb.classList.remove('listening');
    answerSiri(q.toLowerCase(), reply);
  }, 500 + Math.random() * 300);
}
function answerSiri(q, reply) {
  const say = t => { reply.textContent = t; };
  const now = new Date();
  if (/\b(time)\b/.test(q)) {
    return say(`It's ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`);
  }
  if (/\b(date|day)\b/.test(q)) {
    return say(`It's ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`);
  }
  const open = q.match(/^(?:open|launch|start)\s+(.+)$/);
  if (open) {
    const want = open[1].replace(/[.\s]+$/, '');
    const app = allApps().find(a => a.name.toLowerCase() === want || a.id === want);
    if (app) { launch(app.id); return say(`Opening ${app.name}.`); }
    return say(`I can't find an app called "${want}".`);
  }
  const dark = q.match(/dark mode (on|off)|turn (on|off) dark mode/);
  if (dark) {
    const on_ = dark[1] === 'on' || dark[2] === 'on';
    setSetting('appearance', on_ ? 'dark' : 'light');
    return say(`Dark Mode is now ${on_ ? 'on' : 'off'}.`);
  }
  const vol = q.match(/volume(?:\s+(?:to\s+)?(\d+)|\s+(up|down))?/);
  if (vol) {
    let v = Math.round((state.settings.volume ?? .55) * 100);
    if (vol[1]) v = +vol[1];
    else if (vol[2] === 'up') v += 10;
    else if (vol[2] === 'down') v -= 10;
    v = Math.max(0, Math.min(100, v));
    setSetting('volume', v / 100);
    return say(`Volume is set to ${v}%.`);
  }
  if (/weather|forecast/.test(q)) {
    say('Checking the weather…');
    fetch('https://api.open-meteo.com/v1/forecast?latitude=37.77&longitude=-122.42&current_weather=true')
      .then(r => r.json())
      .then(d => {
        const t = Math.round(d.current_weather.temperature * 9 / 5 + 32);
        say(`It's currently ${t}°F and ${d.current_weather.weathercode < 3 ? 'clear' : 'cloudy'} in San Francisco.`);
      })
      .catch(() => say("I couldn't reach the weather service."));
    return;
  }
  if (/joke/.test(q)) {
    const jokes = [
      'I told a joke about UDP once. Nobody got it.',
      'Why did the Mac go to therapy? Too many open windows.',
      'There are only 10 kinds of people: those who understand binary and those who don’t.',
    ];
    return say(jokes[Math.floor(Math.random() * jokes.length)]);
  }
  const expr = q.replace(/what is|what's|calculate|equals?|=/g, '').trim();
  if (/^[\d\s+\-*/().%^x]+$/.test(expr) && /\d/.test(expr)) {
    try {
      const val = Function(`"use strict"; return (${expr.replace(/x/g, '*').replace(/\^/g, '**')})`)();
      if (Number.isFinite(val)) return say(`That's ${Math.round(val * 1e6) / 1e6}.`);
    } catch { /* fall through to search */ }
  }
  say("Here's what I found on the web.");
  launch('safari', { page: `https://www.google.com/search?igu=1&q=${encodeURIComponent(q)}` });
}

/* the menubar clock honors Date & Time settings: 24-hour, hide date, timezone */
function menuClockText(d = new Date()) {
  const s = state.settings;
  if (s.timeZone) {
    try { d = new Date(d.toLocaleString('en-US', { timeZone: s.timeZone })); } catch { /* bad tz: local */ }
  }
  const h24 = s.clock24h;
  let h = d.getHours(); const ampm = h >= 12 ? ' PM' : ' AM';
  const hh = h24 ? String(h).padStart(2, '0') : String(h % 12 || 12);
  const t = `${hh}:${String(d.getMinutes()).padStart(2, '0')}${h24 ? '' : ampm}`;
  return s.clockShowDate === false ? t : menuClock(d).replace(/ [0-9]+:[0-9]+ [AP]M$/, '') + ' ' + t;
}
function tickClock() {
  const clock = statusEl?.querySelector('.mb-clock');
  if (!clock) return;
  const text = menuClockText();
  if (clock.textContent !== text) clock.textContent = text;
}
on('settings:change', () => tickClock());
export const refreshStatus = renderStatus;
