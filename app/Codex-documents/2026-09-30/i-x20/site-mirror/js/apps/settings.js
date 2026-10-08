// System Settings: appearance, accent, wallpaper, dock, display, sound and more.
// Every control either does something real — in this window or through the
// settings:change event every setSetting emits — or it is not shown.
import { el, on, emit, fmtStamp, fmtClock, fmtSize } from '../core/util.js';
import { glyph, appIcon, appleLogo } from '../core/icons.js';
import { state, setSetting, patchSettings } from '../core/store.js';
import { WALLPAPERS, wallpaperCSS } from '../core/wallpaper.js';
import { ACCENT_NAMES, ACCENTS, isDark } from '../shell/appearance.js';
import { MACHINE } from '../core/device.js';
import { SOUND_NAMES } from '../core/util.js';
import { player } from '../core/audio.js';
import { wm } from '../shell/wm.js';
import { openMenu } from '../shell/menus.js';
import { launch, allApps } from '../core/os.js';
import { notify } from '../shell/notify.js';
import * as session from '../shell/session.js';
import * as fs from '../core/fs.js';

const meta = {
  id: 'settings', name: 'System Settings', icon: 'settings', dock: true,
  menus: () => [{ title: 'View', items: viewMenu }],
  launch(opts = {}) { return openSettings(opts); },
};

/** The View menu doubles as the pane index, the way real System Settings does. */
function viewMenu() {
  const st = wm.byApp('settings')[0]?._st;
  return [
    { label: 'Back', key: '⌘[', disabled: !st || !st.history.length, action: () => st?.back() },
    { label: 'Forward', key: '⌘]', disabled: !st || !st.future.length, action: () => st?.forward() },
    { type: 'sep' },
    ...SECTIONS.flatMap(s => s.items).map(i => ({
      label: i.label,
      checked: !!st && (st.pane === i.id || SUBPANES[st.pane]?.parent === i.id),
      action: () => launch('settings', { pane: i.id }),
    })),
    { type: 'sep' },
    { label: 'Close Window', key: '⌘W', action: () => { const w = wm.byApp('settings')[0]; w && wm.close(w); } },
  ];
}

/** Real macOS colours: each row carries its rounded-square system icon. */
const SECTIONS = [
  { group: null, items: [
    { id: 'wifi', label: 'Wi-Fi', icon: 'wifi', color: '#0a84ff' },
    { id: 'bluetooth', label: 'Bluetooth', icon: 'bluetooth', color: '#0a84ff' },
    { id: 'network', label: 'Network', icon: 'globe', color: '#0a84ff' },
  ]},
  { group: 'Notifications & Focus', items: [
    { id: 'notifications', label: 'Notifications', icon: 'bell', color: '#ff453a' },
    { id: 'sound', label: 'Sound', icon: 'speaker', color: '#ff375f' },
    { id: 'focus', label: 'Focus', icon: 'moon', color: '#5e5ce6' },
    { id: 'screentime', label: 'Screen Time', icon: 'hourglass', color: '#5e5ce6' },
  ]},
  { group: 'General', items: [
    { id: 'general', label: 'General', icon: 'gear', color: '#8e8e93' },
    { id: 'appearance', label: 'Appearance', icon: 'appearance', color: '#1c1c1e' },
    { id: 'accessibility', label: 'Accessibility', icon: 'person', color: '#0a84ff' },
    { id: 'controlcenter', label: 'Control Center', icon: 'switches', color: '#8e8e93' },
    { id: 'siri', label: 'Siri & Spotlight', icon: 'siri', color: 'linear-gradient(140deg,#ff375f,#5e5ce6)' },
    { id: 'privacy', label: 'Privacy & Security', icon: 'hand', color: '#0a84ff' },
  ]},
  { group: 'Desktop & Dock', items: [
    { id: 'dock', label: 'Desktop & Dock', icon: 'desktop', color: '#636366' },
    { id: 'displays', label: 'Displays', icon: 'display', color: '#0a84ff' },
    { id: 'wallpaper', label: 'Wallpaper', icon: 'flower', color: 'linear-gradient(140deg,#ff9f0a,#ff375f,#5e5ce6)' },
    { id: 'screensaver', label: 'Screen Saver', icon: 'display', color: '#0a84ff' },
    { id: 'battery', label: 'Battery', icon: 'battery', color: '#34c759' },
  ]},
  { group: 'Lock Screen & Users', items: [
    { id: 'lock', label: 'Lock Screen', icon: 'lock', color: '#1c1c1e' },
    { id: 'touchid', label: 'Touch ID & Password', icon: 'fingerprint', color: '#8e8e93' },
    { id: 'users', label: 'Users & Groups', icon: 'users', color: '#0a84ff' },
  ]},
];

/* General is a list of sub-panes; they keep the General sidebar row lit. */
const SUBPANES = {
  'g-about':   { title: 'About', parent: 'general' },
  'g-update':  { title: 'Software Update', parent: 'general' },
  'g-storage': { title: 'Storage', parent: 'general' },
  'g-airdrop': { title: 'AirDrop & Handoff', parent: 'general' },
  'g-time':    { title: 'Date & Time', parent: 'general' },
};

/* The only status items the menu bar can draw; a chip toggle really adds or
   removes the icon. Clock is permanent on macOS, so it is not listed. */
const MENU_BAR_ITEMS = [
  { id: 'battery', label: 'Battery' }, { id: 'wifi', label: 'Wi-Fi' },
  { id: 'spotlight', label: 'Spotlight' }, { id: 'controlcenter', label: 'Control Center' },
  { id: 'siri', label: 'Siri' },
];
const inMenuBar = id => (state.settings.ccMenuBar || MENU_BAR_ITEMS.map(i => i.id)).includes(id);
const setMenuBarItem = (id, on_) => {
  const cur = new Set(state.settings.ccMenuBar || MENU_BAR_ITEMS.map(i => i.id));
  on_ ? cur.add(id) : cur.delete(id);
  setSetting('ccMenuBar', [...cur]);
};

/* a short list of real zones keeps the control honest instead of a fake full map */
const TIMEZONES = [
  { label: 'Cupertino (Pacific)', value: 'America/Los_Angeles' },
  { label: 'Denver (Mountain)', value: 'America/Denver' },
  { label: 'Chicago (Central)', value: 'America/Chicago' },
  { label: 'New York (Eastern)', value: 'America/New_York' },
  { label: 'London', value: 'Europe/London' },
  { label: 'Berlin', value: 'Europe/Berlin' },
  { label: 'Tokyo', value: 'Asia/Tokyo' },
  { label: 'Sydney', value: 'Australia/Sydney' },
];

const FOCUS_MODES = ['Do Not Disturb', 'Work', 'Personal', 'Sleep'];
const HIGHLIGHTS = [
  { id: 'accent', label: 'Accent color' }, { id: 'pink', label: 'Pink' },
  { id: 'orange', label: 'Orange' }, { id: 'green', label: 'Green' }, { id: 'graphite', label: 'Graphite' },
];
const NOTIF_APPS = ['finder', 'safari', 'notes', 'music', 'reminders', 'calendar', 'appstore'];
const SAVER_MS = { '1 minute': 60e3, '5 minutes': 300e3, '15 minutes': 900e3 };

function openSettings(opts = {}) {
  const existing = wm.byApp('settings')[0];
  if (existing) {
    if (existing.state === 'min') wm.show(existing); else wm.focus(existing);
    if (opts.pane) existing._st?.show(opts.pane);
    return existing;
  }
  return wm.open({
    app: 'settings', key: 'main', title: 'System Settings',
    width: 780, height: 580, minWidth: 620, minHeight: 400,
    data: { pane: opts.pane || 'general' },
    getData: w => ({ pane: w._st?.pane }),
    build: win => new Settings(win, opts).mount(),
  });
}

class Settings {
  constructor(win, opts) {
    this.win = win;
    this.pane = opts.pane || 'general';
    this.history = [];
    this.future = [];
    this.timers = [];
  }
  mount() {
    this.win._st = this;
    this.sidebar = el('aside.sidebar');
    this.paneEl = el('div.st-pane.scroll');
    this.win.setSidebar(this.sidebar, 232);
    this.win.body.append(this.paneEl);
    this.renderSidebar();
    this.show(this.pane);
    this.win.onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === '[') { this.back(); return true; }
      if ((e.metaKey || e.ctrlKey) && e.key === ']') { this.forward(); return true; }
      return false;
    };
  }
  renderSidebar() {
    const search = el('div.search-field.st-search', null, el('span', { html: glyph('search') }),
      el('input', {
        placeholder: 'Search',
        oninput: e => this.filter(e.target.value),
        onkeydown: e => {
          if (e.key === 'Enter') {
            const first = [...this.sidebar.querySelectorAll('.sb-item')].find(n => n.style.display !== 'none');
            if (first) { first.click(); e.target.select(); }
          } else if (e.key === 'Escape') { e.target.value = ''; this.filter(''); }
        },
      }));
    this.searchInput = search.querySelector('input');
    const account = el('button.sb-account', { onclick: () => this.show('users') },
      el('span.sb-avatar', { text: (state.settings.userName || 'B').slice(0, 1).toUpperCase() }),
      el('span.sb-who', null,
        el('b', { text: displayName() }),
        el('small', { text: 'Apple Account' })),
    );
    const rows = [];
    for (const section of SECTIONS) {
      if (section.group) rows.push(el('div.sb-section', { text: section.group }));
      for (const item of section.items) {
        rows.push(el('button.sb-item' + (this.pane === item.id ? '.on' : ''), {
          dataset: { pane: item.id, label: item.label.toLowerCase() },
          onclick: () => this.show(item.id),
        },
          el('span.set-icon', { style: { background: item.color }, html: glyph(item.icon) }),
          el('span.truncate', { text: item.label }),
        ));
      }
    }
    this.sidebar.replaceChildren(account, search, ...rows);
  }
  filter(q) {
    const query = q.trim().toLowerCase();
    for (const item of this.sidebar.querySelectorAll('.sb-item')) {
      item.style.display = !query || item.dataset.label.includes(query) ? '' : 'none';
    }
    for (const sec of this.sidebar.querySelectorAll('.sb-section')) sec.style.display = query ? 'none' : '';
  }
  show(id, record = true) {
    this.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    this.timers = [];
    if (record && this.pane && id !== this.pane) {
      this.history.push(this.pane);
      this.future.length = 0;
    }
    this.pane = id;
    const parent = SUBPANES[id]?.parent || id;
    this.sidebar.querySelectorAll('.sb-item').forEach(n => n.classList.toggle('on', n.dataset.pane === parent));
    const item = SECTIONS.flatMap(s => s.items).find(i => i.id === parent);
    this.win.setTitle('');
    this.paintToolbar(SUBPANES[id]?.title || item?.label || 'System Settings');
    this.paneEl.replaceChildren();
    const builder = this['pane_' + id.replace(/-/g, '_')] || this.pane_general;
    builder.call(this);
    this.paneEl.scrollTop = 0;
  }
  later(fn, ms) { const t = setTimeout(fn, ms); this.timers.push(t); return t; }
  every(fn, ms) { const t = setInterval(fn, ms); this.timers.push(t); return t; }
  /* the content toolbar: back, forward, then the pane title */
  paintToolbar(label) {
    if (!this.backBtn) {
      this.backBtn = el('button.tb-btn', { html: glyph('chevL'), title: 'Back', onclick: () => this.back() });
      this.fwdBtn = el('button.tb-btn', { html: glyph('chevR'), title: 'Forward', onclick: () => this.forward() });
      this.paneTitle = el('div.st-pane-title');
      this.win.tbTools.replaceChildren(el('div.st-nav', null, this.backBtn, this.fwdBtn), this.paneTitle);
    }
    this.paneTitle.textContent = label;
    this.backBtn.disabled = !this.history.length;
    this.fwdBtn.disabled = !this.future.length;
    this.backBtn.style.opacity = this.history.length ? '' : '.35';
    this.fwdBtn.style.opacity = this.future.length ? '' : '.35';
  }
  back() {
    if (!this.history.length) return;
    this.future.push(this.pane);
    this.show(this.history.pop(), false);
  }
  forward() {
    if (!this.future.length) return;
    this.history.push(this.pane);
    this.show(this.future.pop(), false);
  }
  row(label, sub, control) {
    return el('div.st-row', null,
      el('div.lbl', null, el('span', { text: label }), sub ? el('small', { text: sub }) : null),
      el('div.ctl', null, control),
    );
  }
  card(...children) { return el('div.st-card', null, ...children); }
  label(text) { return el('div.st-label', { text }); }
  link(id, label, sub) {
    return el('button.st-row.st-link', { onclick: () => this.show(id) },
      el('div.lbl', null, el('span', { text: label }), sub ? el('small', { text: sub }) : null),
      el('div.ctl', null, el('span', { style: { color: 'var(--text-3)', display: 'flex' }, html: glyph('chevR') })));
  }
  /* a switch that persists the key; def = the value used when nothing was saved */
  sw(key, def = false, onSet) {
    return toggleSwitch(() => state.settings[key] ?? def, v => { setSetting(key, v); onSet?.(v); });
  }

  /* ── panes ─────────────────────────────────────────────────────── */
  pane_general() {
    this.paneEl.append(
      el('h2', { text: 'General' }),
      this.card(
        this.link('g-about', 'About', `${MACHINE.model}, ${MACHINE.size}`),
        this.link('g-update', 'Software Update', `${MACHINE.os} ${MACHINE.version}`),
        this.link('g-storage', 'Storage', 'Macintosh HD'),
        this.link('g-airdrop', 'AirDrop & Handoff', state.settings.airdrop),
        this.link('g-time', 'Date & Time', fmtStamp(Date.now()).replace(/ at .*/, '')),
      ),
    );
  }
  pane_g_about() {
    this.paneEl.append(
      el('h2', { text: 'About' }),
      this.card(
        el('div.st-hero-row', null,
          el('div', { html: appIcon('settings'), style: { width: '54px', height: '54px', flex: 'none' } }),
          el('div', null,
            el('div', { style: { fontSize: '15px', fontWeight: '600' }, text: `${displayName()}’s ${MACHINE.model}` }),
            el('div', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: `${MACHINE.os} ${MACHINE.version} (${MACHINE.build})` })),
          el('button.btn', { style: { marginLeft: 'auto' }, text: 'More Info…', onclick: () => launch('about') }),
        ),
        this.row('Name', 'The name Terminal and Finder use for this Mac',
          el('input.field', {
            value: state.settings.hostName || MACHINE.hostName,
            onchange: e => patchSettings({ hostName: e.target.value.trim() || MACHINE.hostName }),
          })),
        this.row('Model', null, el('div', { text: `${MACHINE.model}, ${MACHINE.size}` })),
        this.row('Chip', null, el('div', { text: MACHINE.chip })),
        this.row('Memory', null, el('div', { text: MACHINE.memory })),
        this.row('Startup disk', null, el('div', { text: MACHINE.disk })),
        this.row('Serial number', null, el('div', { text: MACHINE.serial })),
      ),
    );
  }
  pane_g_update() {
    const status = el('div', { style: { minWidth: 0 } });
    const card = this.card(
      el('div.st-hero-row', null,
        el('span.set-icon.lg', { style: { background: '#8e8e93' }, html: glyph('gear') }),
        status,
        el('button.btn', { style: { marginLeft: 'auto' }, text: 'Check Now', onclick: () => check() })),
    );
    const check = () => {
      status.replaceChildren(
        el('div.st-checking', null, el('span.st-spin'), el('span', { text: 'Checking for updates…' })));
      this.later(() => {
        status.replaceChildren(
          el('div.st-uptodate', null,
            el('span.st-badge', { html: glyph('check') }),
            el('div', null,
              el('div', { style: { fontWeight: 600 }, text: `${MACHINE.os} ${MACHINE.version} is up to date` }),
              el('small', { style: { color: 'var(--text-2)' }, text: `Last checked: Today at ${fmtClock(new Date())}` }))));
      }, 1600);
    };
    if (state.settings.autoUpdate !== false) this.later(check, 350);
    else {
      status.replaceChildren(
        el('div', null,
          el('div', { style: { fontWeight: 600 }, text: `${MACHINE.os} ${MACHINE.version}` }),
          el('small', { style: { color: 'var(--text-2)' }, text: 'Automatic update checks are off' })));
    }
    this.paneEl.append(
      el('h2', { text: 'Software Update' }), card,
      this.card(
        this.row('Automatically check for updates', 'This Mac checks in the background', this.sw('autoUpdate', true)),
      ),
    );
  }
  pane_g_storage() {
    const GB = 1024 ** 3;
    const total = 512 * GB;
    const apps = fs.children('/Applications').filter(n => n.name.endsWith('.app')).length;
    const docs = fs.usedBytes();
    const parts = [
      { label: 'System', bytes: 31.4 * GB, color: '#8e8e93' },
      { label: 'Applications', bytes: (apps * 1.32 + 4.8) * GB, color: '#bf5af2' },
      { label: 'Documents', bytes: docs, color: '#0a84ff' },
      { label: 'Other', bytes: (12.6 + docs / GB * 0.4) * GB, color: '#64d2ff' },
    ];
    const used = parts.reduce((a, p) => a + p.bytes, 0);
    const free = Math.max(total - used, GB);
    const bar = el('div.st-bar', null, parts.map(p =>
      el('i', { dataset: { seg: p.label }, style: { background: p.color, width: '0%' } })));
    this.later(() => {
      parts.forEach((p, i) => { bar.children[i].style.width = Math.max(p.bytes / total * 100, .4) + '%'; });
    }, 60);
    const fmtGB = b => b >= GB ? `${(b / GB).toFixed(1)} GB` : fmtSize(b);
    this.paneEl.append(
      el('h2', { text: 'Storage' }),
      this.card(
        el('div.st-storage-top', null,
          el('b', { text: MACHINE.disk }),
          el('span', { text: `${fmtGB(free)} of ${fmtGB(total)} available` })),
        bar,
        ...parts.map(p => el('div.st-row', null,
          el('div.lbl', null, el('span', null,
            el('i.st-dot', { style: { background: p.color } }), ` ${p.label}`)),
          el('div.ctl', { text: fmtGB(p.bytes) }))),
      ),
    );
  }
  pane_g_airdrop() {
    this.paneEl.append(
      el('h2', { text: 'AirDrop & Handoff' }),
      this.card(
        el('div.st-hero-row', null,
          el('span.set-icon.lg', { style: { background: '#0a84ff' }, html: glyph('airdrop') }),
          el('div', null,
            el('div', { style: { fontWeight: 600 }, text: 'AirDrop' }),
            el('small', { style: { color: 'var(--text-2)' }, text: state.settings.airdrop === 'Off' ? 'Off — nobody can see this Mac' : `On — discoverable by ${state.settings.airdrop.toLowerCase()}` }))),
        this.row('Discoverable by', 'Who AirDrop shows this Mac to',
          segPick('Off', 'Contacts Only', 'Everyone', state.settings.airdrop, v => { setSetting('airdrop', v); this.show('g-airdrop', false); })),
      ),
    );
  }
  pane_g_time() {
    const clock = el('div.st-clock');
    const date = el('div.st-date');
    const paint = () => {
      const tz = state.settings.timeZone || 'local';
      const opts = tz === 'local' ? {} : { timeZone: tz };
      const d = new Date();
      clock.textContent = new Intl.DateTimeFormat('en-US',
        { ...opts, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: !state.settings.clock24h }).format(d);
      date.textContent = new Intl.DateTimeFormat('en-US',
        { ...opts, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d);
    };
    paint();
    date.style.display = state.settings.clockShowDate === false ? 'none' : '';
    this.every(paint, 1000);
    const tz = state.settings.timeZone || 'local';
    this.paneEl.append(
      el('h2', { text: 'Date & Time' }),
      this.card(
        el('div.st-hero', null, clock, date),
        this.row('Time zone', 'Shown in the menu bar clock',
          popPick(TIMEZONES.some(z => z.value === tz) ? tz : 'local',
            [{ label: 'Cupertino (Pacific)', value: 'local' }, ...TIMEZONES.slice(1)],
            v => setSetting('timeZone', v))),
        this.row('Use 24-hour time', null, this.sw('clock24h', false, v => paint())),
        this.row('Show the date', null, this.sw('clockShowDate', true,
          v => { date.style.display = v ? '' : 'none'; })),
      ),
    );
  }

  pane_appearance() {
    const mock = mode => {
      const face = c => el('div.mock-face' + c, null,
        el('div.mf-side', null, el('i'), el('i'), el('i')),
        el('div.mf-main', null, el('div.mf-bar'), el('div.mf-lines', null, el('i'), el('i'), el('i'))),
      );
      const inner = mode === 'auto' ? el('div.mock-split', null, face('.lt'), face('.dk')) : face(mode === 'dark' ? '.dk' : '.lt');
      return el('div.mock-mac' + (mode === 'dark' ? '.dk' : mode === 'auto' ? '.auto' : '.lt'), null, inner);
    };
    const mk = (id, label) => el('button.appearance-opt' + (state.settings.appearance === id ? '.on' : ''), {
      onclick: () => { setSetting('appearance', id); this.show('appearance', false); },
    }, mock(id), el('span', { text: label }));
    const accents = ['multicolor', ...ACCENT_NAMES].map(name => el('button.accent' + ((state.settings.accent || 'multicolor') === name ? '.on' : '') + (name === 'multicolor' ? '.multi' : ''), {
      style: name === 'multicolor' ? {} : { background: (isDark() ? ACCENTS[name].dark : ACCENTS[name].light) },
      title: name === 'multicolor' ? 'Multicolor' : name,
      onclick: () => { setSetting('accent', name); this.show('appearance', false); },
    }));
    this.paneEl.append(
      el('h2', { text: 'Appearance' }),
      this.card(el('div.st-card-label', { text: 'Appearance' }),
        el('div.appearance-grid', null, mk('light', 'Light'), mk('dark', 'Dark'), mk('auto', 'Auto')),
        el('small', { style: { color: 'var(--text-3)', display: 'block', marginTop: '8px' }, text: 'Auto switches at sunset and sunrise.' })),
      this.card(el('div.st-card-label', { text: 'Accent color' }),
        el('div.accent-row', null, ...accents)),
      this.card(el('div.st-card-label', { text: 'Highlight color' }),
        el('div.accent-row', null, HIGHLIGHTS.map(h =>
          el('button.accent.hl' + ((state.settings.highlightColor || 'accent') === h.id ? '.on' : '') + (h.id === 'accent' ? '.cur' : ''), {
            dataset: { hl: h.id }, title: h.label,
            onclick: () => { setSetting('highlightColor', h.id); this.show('appearance', false); },
          })))),
      this.card(
        this.row('Show scroll bars', null,
          segPick('Automatic', 'When scrolling', 'Always', state.settings.scrollBars || 'Automatic', v => setSetting('scrollBars', v))),
        this.row('Sidebar icon size', null, segPick('Small', 'Medium', 'Large', state.settings.sidebarSize || 'Medium', v => setSetting('sidebarSize', v))),
        this.row('Allow wallpaper tinting in windows', 'Windows pick up a hint of the desktop picture', this.sw('wallpaperTint', true)),
      ),
    );
  }

  pane_notifications() {
    const styles = state.settings.notifStyles || {};
    const appRows = NOTIF_APPS
      .map(id => ({ id, app: allApps().find(a => a.id === id) }))
      .filter(a => a.app)
      .map(({ id, app }) => this.row(app.name, null,
        segVals(
          [{ label: 'None', value: 'None' }, { label: 'Banners', value: 'Banners' }, { label: 'Alerts', value: 'Alerts' }],
          styles[id] || state.settings.notifStyle || 'Banners',
          v => setSetting('notifStyles', { ...(state.settings.notifStyles || {}), [id]: v }))));
    const preview = state.settings.notifPreview;
    const previewCur = preview === false || preview === 'Never' ? false : preview === 'Always' ? 'Always' : 'When Unlocked';
    this.paneEl.append(
      el('h2', { text: 'Notifications' }),
      this.card(
        this.row('Do Not Disturb', 'Banners wait quietly in Notification Center',
          toggleSwitch(() => !!state.settings.focus, v => { setSetting('focus', v ? 'Do Not Disturb' : false); })),
        this.row('Allow notifications', null, this.sw('notifications', true)),
        this.row('Banner style', 'Alerts stay until you dismiss them',
          segPick('Banners', 'Alerts', state.settings.notifStyle || 'Banners', v => setSetting('notifStyle', v))),
        this.row('Show previews', 'What a banner shows before you open it',
          segVals(
            [{ label: 'Always', value: 'Always' }, { label: 'When Unlocked', value: 'When Unlocked' }, { label: 'Never', value: false }],
            previewCur,
            v => setSetting('notifPreview', v))),
      ),
      this.label('App notifications'),
      this.card(...appRows),
    );
  }
  pane_screentime() {
    const used = [2, 1, 3, 4, 5, 6, 4].map(h => h);
    const max = Math.max(...used);
    const chart = el('div.st-chart', null, used.map((h, i) => el('div.col', { title: `${h}h` },
      el('div.bar', { style: { height: (h / max * 100) + '%' } }), el('small', { text: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][i] }))));
    this.paneEl.append(el('h2', { text: 'Screen Time' }), this.card(
      el('div.st-hero', null, el('div.st-hero-time', { text: '5h 12m' }), el('div', { text: 'Average daily use' })),
      chart,
    ));
  }
  pane_accessibility() {
    const zoomPct = `${Math.round((state.settings.zoom || 1) * 100)}%`;
    this.paneEl.append(
      el('h2', { text: 'Accessibility' }),
      this.label('Vision'),
      this.card(
        this.row('VoiceOver', 'Speaks the item under the pointer and shows a caption',
          this.sw('voiceOver', false)),
        this.row('Zoom', 'Hold Control and scroll to enlarge the screen',
          this.sw('zoomGesture', true)),
        this.row('Zoom level', null, el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          el('span', { text: zoomPct }),
          el('button.btn', { text: 'Reset', disabled: !(state.settings.zoom > 1), onclick: () => { setSetting('zoom', 1); this.show('accessibility', false); } }))),
      ),
      this.label('Display'),
      this.card(
        this.row('Increase contrast', 'Stronger borders and separators', this.sw('highContrast', false)),
        this.row('Reduce transparency', 'Sidebar and Dock turn solid', this.sw('reduceTransparency', false)),
      ),
      this.label('Motion'),
      this.card(
        this.row('Reduce motion', 'Animations become plain cuts', this.sw('reducedMotion', false)),
      ),
      this.label('Pointer'),
      this.card(
        this.row('Pointer size', null, el('input.range', {
          type: 'range', min: '1', max: '3', step: '1',
          value: String({ normal: 1, large: 2, xlarge: 3 }[state.settings.pointerSize] || 1),
          style: { width: '160px' },
          oninput: e => setSetting('pointerSize', ['normal', 'large', 'xlarge'][Number(e.target.value) - 1]),
        })),
      ),
    );
  }
  pane_controlcenter() {
    this.paneEl.append(
      el('h2', { text: 'Control Center' }),
      this.label('Control Center modules'),
      this.card(
        this.row('Wi-Fi', 'Turn Wi-Fi on or off', toggleSwitch(() => state.settings.wifi, v => setSetting('wifi', v))),
        this.row('Bluetooth', null, toggleSwitch(() => state.settings.bluetooth, v => setSetting('bluetooth', v))),
        this.row('Focus', 'Do Not Disturb', toggleSwitch(() => !!state.settings.focus, v => setSetting('focus', v ? 'Do Not Disturb' : false))),
        this.row('Stage Manager', 'Arranges windows on the left', toggleSwitch(() => !!state.settings.stageManager, v => setSetting('stageManager', v))),
      ),
      this.label('Show in Menu Bar'),
      this.card(
        el('div.st-row', null,
          el('div.lbl', null, el('span', { text: 'Status items' }), el('small', { text: 'Click to add or remove' })),
          el('div.ctl', null, ...MENU_BAR_ITEMS.map(it => el('button.chip' + (inMenuBar(it.id) ? '.on' : ''), {
            dataset: { mb: it.id },
            onclick: e => {
              const next = !inMenuBar(it.id);
              setMenuBarItem(it.id, next);
              e.currentTarget.classList.toggle('on', next);
            },
          }, it.label)))),
      ),
    );
  }
  pane_siri() {
    this.paneEl.append(
      el('h2', { text: 'Siri & Spotlight' }),
      this.card(
        el('div.st-hero-row', null,
          el('span.set-icon.lg', { style: { background: 'linear-gradient(140deg,#ff375f,#5e5ce6)' }, html: glyph('siri') }),
          el('div', null,
            el('div', { style: { fontWeight: 600 }, text: 'Siri' }),
            el('small', { style: { color: 'var(--text-2)' }, text: 'Answers questions about this Mac' })),
          el('button.btn', { style: { marginLeft: 'auto' }, text: 'Talk to Siri', onclick: () => notify('Siri', 'Hi. Ask me anything about your Mac.', { app: 'settings' }) })),
        this.row('Ask Siri', 'Shows Siri in the menu bar',
          this.sw('siriEnabled', true, v => setMenuBarItem('siri', v))),
        this.row('Show Siri in menu bar', null,
          toggleSwitch(() => inMenuBar('siri'), v => setMenuBarItem('siri', v))),
      ),
      this.label('Spotlight'),
      this.card(
        this.row('Show recent items', 'Recents appear above Spotlight results', this.sw('spotlightRecents', true)),
        this.row('Search', null, el('button.btn', {
          text: 'Open Spotlight', onclick: () => import('../shell/overlays.js').then(o => o.openSpotlight()),
        })),
      ),
    );
  }
  pane_privacy() {
    this.paneEl.append(
      el('h2', { text: 'Privacy & Security' }),
      this.card(
        this.row('Location Services', 'Weather and Spotlight suggestions can use your location', this.sw('locationServices', true)),
        this.row('Share Mac Analytics', 'Sends crash and usage data', this.sw('shareAnalytics', false)),
      ),
      this.card(
        this.row('FileVault', `${MACHINE.disk} is encrypted`, el('div.st-on', { text: 'On' })),
        this.row('Firewall', 'Blocks incoming connections',
          toggleSwitch(() => state.settings.firewall !== false, v => { setSetting('firewall', v); this.show('privacy', false); })),
      ),
    );
  }
  pane_screensaver() {
    this.paneEl.append(
      el('h2', { text: 'Screen Saver' }),
      this.card(
        el('div.st-hero-row', null,
          el('div.st-saver-thumb', { html: appleLogo(28) }),
          el('div', null,
            el('div', { style: { fontWeight: 600 }, text: 'Apple' }),
            el('small', { style: { color: 'var(--text-2)' }, text: 'A slow logo drifts across a dark screen' })),
          el('button.btn', { style: { marginLeft: 'auto' }, text: 'Preview', onclick: () => showSaver() })),
        this.row('Start after', 'When the Mac is idle',
          segPick('Never', '1 minute', '5 minutes', '15 minutes', state.settings.screenSaver || '5 minutes', v => { setSetting('screenSaver', v); armSaver(); })),
      ),
    );
  }
  pane_battery() {
    this.paneEl.append(
      el('h2', { text: 'Battery' }),
      this.card(
        el('div.st-hero', null, el('div.st-hero-time', { text: '94%' }),
          el('div', { text: state.settings.lowPower ? 'On battery · Low Power Mode' : 'Charging on power adapter · 9h 12m remaining' })),
        this.row('Low Power Mode', 'Dims the display and slows the GPU', this.sw('lowPower', false)),
        this.row('Battery health', null, el('div', { text: 'Normal · 100%' })),
        this.row('Show battery in menu bar', null,
          toggleSwitch(() => inMenuBar('battery'), v => setMenuBarItem('battery', v))),
      ),
    );
  }
  pane_touchid() {
    const fingers = state.settings.fingerprints || [];
    const enroll = el('button.btn', {
      text: 'Add Fingerprint',
      onclick: () => {
        const zone = this.paneEl.querySelector('.st-fp-enroll');
        if (!zone) return;
        zone.replaceChildren();
        const dots = el('div.fp-dots', null, [0, 1, 2, 3].map(() => el('i')));
        const cap = el('div', { style: { fontSize: '12px', color: 'var(--text-2)', textAlign: 'center' }, text: 'Rest your finger on Touch ID' });
        const fp = el('button.fp-target', { html: glyph('fingerprint'), 'aria-label': 'Touch ID sensor' });
        let press = 0;
        fp.addEventListener('click', () => {
          press = Math.min(4, press + 1);
          [...dots.children].forEach((d, i) => d.classList.toggle('fill', i < press));
          fp.classList.add('tap');
          setTimeout(() => fp.classList.remove('tap'), 220);
          cap.textContent = press < 4 ? 'Keep going — lift and rest your finger again' : 'Done';
          if (press === 4) this.later(() => {
            setSetting('fingerprints', [...(state.settings.fingerprints || []), `Finger ${(state.settings.fingerprints || []).length + 1}`]);
            this.show('touchid', false);
          }, 500);
        });
        zone.append(fp, dots, cap);
      },
    });
    this.paneEl.append(
      el('h2', { text: 'Touch ID & Password' }),
      this.card(
        ...fingers.map((f, i) => this.row(f, 'Unlocks this Mac', el('button.btn', {
          text: 'Delete', onclick: () => {
            const next = (state.settings.fingerprints || []).filter((_, j) => j !== i);
            setSetting('fingerprints', next);
            this.show('touchid', false);
          },
        }))),
        el('div.st-fp-enroll', null,
          el('div', { style: { display: 'flex', justifyContent: 'center', padding: '4px 0' } }, enroll)),
      ),
      this.card(
        this.row('Use Touch ID to unlock this Mac', null, this.sw('touchIdUnlock', true)),
        this.row('Require password', 'After sleep or screen saver begins',
          popPick(state.settings.requirePassword || 'Immediately',
            ['Immediately', 'After 5 minutes', 'After 15 minutes'].map(v => ({ label: v, value: v })),
            v => setSetting('requirePassword', v))),
      ),
    );
  }
  pane_users() {
    const avatar = () => el('span.sb-avatar.big', { text: (state.settings.userName || 'B').slice(0, 1).toUpperCase() });
    const nameCol = el('div', null,
      el('b', { text: displayName() }),
      el('div', { text: `${state.settings.userName} · Admin` }));
    const edit = el('button.btn', { text: 'Edit…', onclick: () => {
      const input = el('input.field', { value: state.settings.userName || 'bunny', style: { width: '130px' } });
      const commit = () => {
        patchSettings({ userName: input.value.trim().toLowerCase() || 'bunny' });
        this.renderSidebar();
        this.show('users', false);
      };
      const saveBtn = el('button.btn.primary', { text: 'Save', onclick: commit });
      const cancel = el('button.btn', { text: 'Cancel', onclick: () => this.show('users', false) });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
      nameCol.replaceChildren(el('div.st-edit-row', null, input, saveBtn, cancel));
      input.focus(); input.select();
    } });
    this.paneEl.append(
      el('h2', { text: 'Users & Groups' }),
      this.card(
        el('div.st-user', null, avatar(), nameCol, edit),
        this.row('Password', null, el('button.btn', { text: 'Change…', onclick: () => this.passwordSheet() })),
        this.row('Guest User', 'Guests can log in without a password', this.sw('guestEnabled', false)),
      ),
    );
  }
  passwordSheet() {
    const has = !!state.settings.pwHash;
    const cur = el('input.field', { type: 'password', placeholder: has ? 'Current password' : 'No password set — leave blank', autocomplete: 'off' });
    const nw = el('input.field', { type: 'password', placeholder: 'New password', autocomplete: 'off' });
    const verify = el('input.field', { type: 'password', placeholder: 'Verify new password', autocomplete: 'off' });
    const err = el('div.st-err');
    const dlg = el('div.overlay', { style: { zIndex: 12500 } },
      el('div.scrim'),
      el('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' } },
        el('div.dialog-box', { style: { width: '300px', textAlign: 'left' } },
          el('h3', { text: 'Change Password' }),
          el('div.st-sheet-fields', null, cur, nw, verify, err),
          el('div.row', null,
            el('button.btn', { text: 'Cancel', onclick: () => dlg.remove() }),
            el('button.btn.primary', { text: 'Change', onclick: () => {
              if (has && hash(cur.value) !== state.settings.pwHash) { err.textContent = 'Current password is incorrect'; cur.select(); return; }
              if (!nw.value) { err.textContent = 'Enter a new password'; nw.focus(); return; }
              if (nw.value !== verify.value) { err.textContent = 'New passwords do not match'; verify.select(); return; }
              setSetting('pwHash', hash(nw.value));
              dlg.remove();
              notify('Users & Groups', 'Your login password was changed.', { app: 'settings' });
            } }),
          ))));
    document.getElementById('overlays').append(dlg);
    cur.focus();
  }
  pane_wallpaper() {
    const grid = el('div.wall-grid');
    for (const wall of WALLPAPERS) {
      grid.append(el('button.wall-opt' + (state.settings.wallpaper === wall.id ? '.on' : ''), {
        style: { backgroundImage: wallpaperCSS(wall.id) },
        title: wall.name,
        onclick: () => { setSetting('wallpaper', wall.id); this.show('wallpaper', false); },
      }, el('span', { text: wall.name })));
    }
    this.paneEl.append(el('h2', { text: 'Wallpaper' }), this.card(grid));
  }
  pane_dock() {
    const size = el('input.range', {
      type: 'range', min: '38', max: '76', step: '1', value: String(state.settings.dockSize), style: { width: '190px' },
      oninput: e => { setSetting('dockSize', Number(e.target.value)); },
    });
    this.paneEl.append(
      el('h2', { text: 'Desktop & Dock' }),
      this.card(
        this.row('Size', null, size),
        this.row('Magnification', 'Hover over the Dock to enlarge icons',
          toggleSwitch(() => state.settings.dockMagnify, v => setSetting('dockMagnify', v))),
        this.row('Position on screen', null, segPick('Left', 'Bottom', 'Right', state.settings.dockPosition || 'Bottom', v => setSetting('dockPosition', v))),
        this.row('Minimize windows using', null,
          popPick(state.settings.minimizeEffect || 'Scale',
            [{ value: 'Genie', label: 'Genie effect' }, { value: 'Scale', label: 'Scale effect' }],
            v => setSetting('minimizeEffect', v))),
        this.row('Minimize windows into application icon', 'Instead of the strip beside the Trash', this.sw('minimizeToIcon', false)),
        this.row('Automatically hide and show the Dock', 'Point at the screen edge to reveal it', this.sw('dockAutoHide', false)),
        this.row('Show suggested and recent apps in Dock', null, this.sw('dockRecents', true)),
      ),
    );
  }
  pane_displays() {
    const bright = el('input.range', {
      type: 'range', min: '0.2', max: '1', step: '0.01', value: String(state.settings.brightness), style: { width: '220px' },
      oninput: e => setSetting('brightness', Number(e.target.value)),
    });
    const warmth = el('input.range', {
      type: 'range', min: '0', max: '100', step: '1', value: String(state.settings.nightShift || 0), style: { width: '190px' },
      oninput: e => setSetting('nightShift', Number(e.target.value)),
    });
    const mode = state.settings.nightShiftMode || (state.settings.nightShift > 0 ? 'On until tomorrow' : 'Off');
    this.paneEl.append(
      el('h2', { text: 'Displays' }),
      this.card(
        this.row('Brightness', null, el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, el('span', { html: glyph('sun') }), bright)),
        this.row('True Tone', 'Adapts colour to ambient light', this.sw('trueTone', true)),
        this.row('Resolution', null, el('div', { text: `${window.innerWidth} × ${window.innerHeight}` })),
        this.row('Refresh rate', null, el('div', { text: 'ProMotion 120Hz' })),
        this.row('Colour profile', null, el('div', { text: isDark() ? 'Dark Mode colours' : 'Light Mode colours' })),
      ),
      this.label('Night Shift'),
      this.card(
        this.row('Schedule', null,
          segVals(
            [{ label: 'Off', value: 'Off' }, { label: 'Sunset to Sunrise', value: 'Sunset to Sunrise' }, { label: 'On until tomorrow', value: 'On until tomorrow' }],
            mode,
            v => { setSetting('nightShiftMode', v); this.show('displays', false); })),
        this.row('Colour temperature', 'Warmer at night', warmth),
      ),
    );
  }
  pane_sound() {
    const vol = el('input.range', {
      type: 'range', min: '0', max: '1', step: '0.01', value: String(state.settings.volume), style: { width: '220px' },
      oninput: e => { setSetting('volume', Number(e.target.value)); player.setVolume(Number(e.target.value)); },
    });
    const alertVol = el('input.range', {
      type: 'range', min: '0', max: '1', step: '0.01', value: String(state.settings.alertVolume ?? 0.7), style: { width: '160px' },
      oninput: e => setSetting('alertVolume', Number(e.target.value)),
      /* macOS plays the alert when the slider is released */
      onchange: () => previewAlert(state.settings.alertSound),
    });
    const grid = el('div.st-sounds', null, SOUND_NAMES.map(name =>
      el('button.snd' + (state.settings.alertSound === name ? '.on' : ''), {
        text: name,
        onclick: e => {
          setSetting('alertSound', name);
          previewAlert(name);
          grid.querySelectorAll('.snd').forEach(n => n.classList.toggle('on', n === e.currentTarget));
        },
      })));
    this.paneEl.append(
      el('h2', { text: 'Sound' }),
      this.card(
        this.row('Output volume', null, el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, el('span', { html: glyph('volume') }), vol)),
        this.row('Mute', null, toggleSwitch(() => state.settings.volume === 0, v => { setSetting('volume', v ? 0 : .55); player.setVolume(v ? 0 : .55); this.show('sound', false); })),
        this.row('Play sound effects through', null, el('div', { text: 'MacBook Pro Speakers' })),
        this.row('Play sound on startup', null, this.sw('startupSound', false)),
      ),
      this.label('Alert sound'),
      this.card(
        grid,
        this.row('Alert volume', null, alertVol),
      ),
      this.label('Input'),
      this.card(
        this.row('Device', null, el('div', { text: 'MacBook Pro Microphone' })),
      ),
    );
  }
  pane_wifi() {
    this.paneEl.append(
      el('h2', { text: 'Wi-Fi' }),
      this.card(
        this.row('Wi-Fi', state.settings.wifi ? 'Connected to Sequoia-5G' : 'Turned off',
          toggleSwitch(() => state.settings.wifi, v => { setSetting('wifi', v); this.show('wifi', false); })),
        ...(state.settings.wifi ? [
          this.row('IP address', null, el('div', { text: '192.168.1.24' })),
          this.row('Router', null, el('div', { text: '192.168.1.1' })),
          this.row('Security', null, el('div', { text: 'WPA3 Personal' })),
          this.row('Auto-Join', 'Sequoia-5G joins by itself', this.sw('wifiAutoJoin', true)),
        ] : []),
      ),
      ...(state.settings.wifi ? [
        this.label('Known networks'),
        this.card(
          this.row('Sequoia-5G', 'Connected · WPA3', el('div', { style: { color: 'var(--text-3)' }, text: 'Connected' })),
          this.row('CoffeeShop Guest', 'Not in range', el('div', { style: { color: 'var(--text-3)' }, text: '—' })),
        ),
      ] : []),
    );
  }
  pane_bluetooth() {
    const studio = state.settings.btStudio === true;
    this.paneEl.append(
      el('h2', { text: 'Bluetooth' }),
      this.card(
        this.row('Bluetooth', state.settings.bluetooth ? 'On' : 'Off',
          toggleSwitch(() => state.settings.bluetooth, v => { setSetting('bluetooth', v); this.show('bluetooth', false); })),
      ),
      ...(state.settings.bluetooth ? [
        this.label('My devices'),
        this.card(
          this.row('AirPods Pro', 'Connected · 82%', el('div.st-on', { text: 'Connected' })),
          this.row('Studio Display', studio ? 'Audio' : 'Not connected',
            el('button.btn', { text: studio ? 'Disconnect' : 'Connect', onclick: () => { setSetting('btStudio', !studio); this.show('bluetooth', false); } })),
        ),
      ] : []),
    );
  }
  pane_focus() {
    const cur = state.settings.focus === true ? 'Do Not Disturb' : state.settings.focus;
    this.paneEl.append(
      el('h2', { text: 'Focus' }),
      this.card(
        this.row('Off', null, el('button.btn' + (!cur ? '.primary' : ''), {
          text: cur ? 'Turn off' : 'Off',
          disabled: !cur,
          onclick: () => { setSetting('focus', false); this.show('focus', false); },
        })),
        ...FOCUS_MODES.map(mode => this.row(mode, cur === mode ? 'On until this evening' : '',
          toggleSwitch(() => cur === mode, v => { setSetting('focus', v ? mode : false); this.show('focus', false); }))),
      ),
      this.card(
        el('div', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: 'While a Focus is on, banners wait in Notification Center instead of popping in.' }),
      ),
    );
  }
  pane_network() {
    this.paneEl.append(
      el('h2', { text: 'Network' }),
      this.card(
        this.link('wifi', 'Wi-Fi', state.settings.wifi ? 'Sequoia-5G' : 'Off'),
        this.row('IP address', null, el('div', { text: state.settings.wifi ? '192.168.1.24' : '—' })),
        this.row('DNS', null, el('div', { text: '1.1.1.1, 8.8.8.8' })),
        this.row('Firewall', 'Blocks incoming connections', this.sw('firewall', true)),
      ),
    );
  }
  pane_lock() {
    this.paneEl.append(
      el('h2', { text: 'Lock Screen' }),
      this.card(
        this.row('Lock Now', 'Lock the screen right away', el('button.btn', { text: 'Lock', onclick: () => session.lock() })),
        this.row('Require password', 'After the screen saver or sleep',
          popPick(state.settings.requirePassword || 'Immediately',
            ['Immediately', 'After 5 minutes', 'After 15 minutes'].map(v => ({ label: v, value: v })),
            v => setSetting('requirePassword', v))),
        this.row('Message', 'Shown on the lock screen',
          el('input.field', {
            placeholder: 'No message', value: state.settings.lockMessage || '',
            onchange: e => setSetting('lockMessage', e.target.value.trim()),
          })),
      ),
    );
  }
}
/** macOS shows the account name capitalised in the UI, lowercase in the shell. */
export function displayName() {
  const n = (state.settings.userName || 'bunny').trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}
/* never a plaintext password: a cheap hash is enough to tell wrong from right */
const hash = s => { let h = 5381; for (const c of String(s)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return 'h' + h.toString(36); };

/**
 * A real macOS popup button: a label, a chevron, and the shell's own menu.
 * `entries` carry a stored value and the label macOS shows for it, so the two
 * can differ ("Scale" is stored, "Scale effect" is what the button reads).
 */
function popPick(current, entries, pick) {
  const labelFor = v => (entries.find(e => e.value === v) || entries[0]).label;
  const text = el('span', { text: labelFor(current) });
  const btn = el('button.pop-btn', { type: 'button' },
    text,
    el('span.chev', { html: '<svg viewBox="0 0 10 16" width="7" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6l3 3 3-3"/></svg>' }));
  btn.addEventListener('click', () => {
    const r = btn.getBoundingClientRect();
    openMenu(entries.map(e => ({
      label: e.label,
      checked: e.value === current,
      action: () => { pick?.(e.value); text.textContent = e.label; btn.blur(); },
    })), { x: Math.round(r.right - 4), y: Math.round(r.bottom + 4) });
  });
  return btn;
}

function segPick(...options) {
  const current = options[options.length - 2];
  const set = options[options.length - 1];
  const seg = el('div.seg');
  for (const opt of options.slice(0, -2)) {
    seg.append(el('button' + (opt === current ? '.on' : ''), {
      text: opt,
      onclick: () => { set(opt); [...seg.children].forEach((b, i) => b.classList.toggle('on', options[i] === opt)); },
    }));
  }
  return seg;
}
/** like segPick, but each segment carries its own stored value */
function segVals(options, current, set) {
  const seg = el('div.seg');
  for (const { label, value } of options) {
    seg.append(el('button' + (value === current ? '.on' : ''), {
      text: label,
      onclick: () => { set(value); [...seg.children].forEach((b, i) => b.classList.toggle('on', options[i].value === value)); },
    }));
  }
  return seg;
}
function toggleSwitch(get, set) {
  const sw = el('div.switch' + (get() ? '.on' : ''));
  sw.addEventListener('click', e => {
    e.stopPropagation();
    const next = !get();
    set(next);
    sw.classList.toggle('on', next);
  });
  return sw;
}

/* each alert sound has its own pitch — the same table sfx.js uses for banners;
   the preview honours the Alert volume slider, which playAlert's fixed .1
   gain cannot reach */
const ALERT_HZ = { Boop: 660, Blow: 420, Bubble: 990, Crystal: 1180, Funk: 520, Glass: 1320, Hero: 780, Jump: 860, Meep: 700, Pop: 940, Purr: 380, Sosumi: 1050, Tink: 1240 };
function previewAlert(name) {
  try {
    const ctx = player.ensure();
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const freq = ALERT_HZ[name] || 660;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq / 1.4, ctx.currentTime + .12);
    const peak = .2 * (state.settings.alertVolume ?? .7);
    env.gain.setValueAtTime(.0001, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(Math.max(peak, .0001), ctx.currentTime + .01);
    env.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .18);
    osc.connect(env); env.connect(player.master);
    osc.start(); osc.stop(ctx.currentTime + .2);
    emit('sfx:played', { name: 'alert', voice: name });
  } catch { /* no audio device */ }
}

/* ── shell-side settings applied here, whoever changed them ─────────────
   appearance.js owns the big ones (theme, accent, wallpaper, tint, sidebar
   row height); dock.js owns dock position, hiding and recents; wm.js owns
   Stage Manager. What is left lives here: pointer size, scroll bars, the
   selection highlight colour, the minimize flight timing, auto appearance
   by the clock, and Night Shift's schedule. */
const htmlEl = document.documentElement;

/* macOS "Auto" follows the sun: light from 7am to 7pm */
const autoDark = () => { const h = new Date().getHours(); return h >= 19 || h < 7; };

/* Night Shift: the slider is the warmth, the schedule decides if it shows now */
const nightShiftActive = () => {
  const s = state.settings;
  const mode = s.nightShiftMode || (s.nightShift > 0 ? 'On until tomorrow' : 'Off');
  if (mode === 'On until tomorrow') return true;
  if (mode === 'Sunset to Sunrise') { const h = new Date().getHours(); return h >= 18 || h < 7; }
  return false;
};

function applyShellSettings() {
  const s = state.settings;
  htmlEl.dataset.pointer = s.pointerSize || 'normal';
  htmlEl.dataset.scrollbars = s.scrollBars || 'Automatic';
  htmlEl.dataset.hl = s.highlightColor || 'accent';
  /* genie is the same flight with a longer, more elastic curve */
  htmlEl.style.setProperty('--min-scale-ms', s.minimizeEffect === 'Genie' ? '620' : '450');
}

/* deferred: appearance.js writes these in the same settings:change pass, so the
   schedule-aware values have to land after it is done */
const applyTimed = () => queueMicrotask(() => {
  const s = state.settings;
  if (s.appearance === 'auto') {
    const dark = autoDark();
    htmlEl.dataset.appearance = dark ? 'dark' : 'light';
    const accent = ACCENTS[s.accent] || ACCENTS.blue;
    htmlEl.style.setProperty('--accent', dark ? accent.dark : accent.light);
    htmlEl.style.setProperty('--accent-contrast', s.accent === 'yellow' && !dark ? '#111' : '#fff');
  }
  htmlEl.style.setProperty('--warmth', String((nightShiftActive() ? s.nightShift || 0 : 0) / 100));
});

on('settings:change', () => { applyShellSettings(); applyTimed(); });
applyShellSettings();
applyTimed();
setInterval(applyTimed, 60_000);   /* auto appearance and Night Shift follow the clock */

/* "Use scroll gesture to zoom" off means Control-scroll does nothing at all.
   Capture phase so this runs before appearance.js's own wheel listener. */
window.addEventListener('wheel', e => {
  if (e.ctrlKey && state.settings.zoomGesture === false) { e.preventDefault(); e.stopImmediatePropagation(); }
}, { passive: false, capture: true });

/* the screen saver: idle for the chosen interval and the logo drifts in */
let saverEl = null, saverTimer = null;
function showSaver() {
  if (saverEl) return;
  saverEl = el('div#saver', null, el('div.saver-logo', { html: appleLogo() }));
  document.getElementById('overlays').append(saverEl);
}
function hideSaver() { saverEl?.remove(); saverEl = null; }
function armSaver() {
  clearTimeout(saverTimer);
  const ms = SAVER_MS[state.settings.screenSaver || '5 minutes'];
  if (ms) saverTimer = setTimeout(showSaver, ms);
}
['keydown', 'pointerdown', 'wheel'].forEach(t =>
  window.addEventListener(t, () => { if (saverEl) hideSaver(); armSaver(); }, { passive: true, capture: true }));
window.addEventListener('pointermove', () => { hideSaver(); armSaver(); }, { passive: true });
armSaver();

export default meta;
