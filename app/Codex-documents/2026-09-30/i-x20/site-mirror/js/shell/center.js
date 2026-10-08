// Notification Center: parked notifications on top, a column of live widgets
// below — the panel macOS slides in from the right edge.
import { state, save } from '../core/store.js';
import { el, on, fmtClock, pad2, DAY_NAMES } from '../core/util.js';
import { appIcon, glyph } from '../core/icons.js';
import { getApp } from '../core/os.js';
import { wm } from './wm.js';
import { MACHINE } from '../core/device.js';

let panel = null;
let editing = false;
let clockTimer = null;

/* ── history ─────────────────────────────────────────────────────────
   kept in settings so the list survives a reload */
const history = () => {
  if (!Array.isArray(state.settings.ncHistory)) state.settings.ncHistory = [];
  return state.settings.ncHistory;
};

export function collect(title, body, opts = {}) {
  const h = history();
  h.unshift({ title, body, app: sender(title, opts), at: Date.now() });
  while (h.length > 40) h.pop();
  save();
  render();
  return null;
}
export const log = () => history();

/* most callers say who is sending in the title, not in opts */
const SENDER_ALIAS = {
  systemsettings: 'settings', trash: 'finder', downloads: 'safari',
  screenshot: 'finder', missioncontrol: 'finder',
};
function sender(title, opts) {
  if (opts.app) return opts.app;
  const key = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return (getApp(key) && key) || SENDER_ALIAS[key] || 'settings';
}
const appTitle = id => getApp(id)?.name || 'Notifications';

function host() {
  let h = document.getElementById('overlays');
  if (!h) {
    h = el('div#overlays');
    document.getElementById('screen').append(h);
  }
  return h;
}

function clearGroup(app) {
  state.settings.ncHistory = history().filter(n => n.app !== app);
  save();
  render();
}
function clearAll() {
  state.settings.ncHistory = [];
  save();
  render();
}

function notifSection() {
  const sec = el('div.nc-notifs');
  const h = history();
  if (!h.length) {
    sec.append(el('div.nc-empty', { text: 'No New Notifications' }));
    return sec;
  }
  const groups = new Map();
  for (const n of h) {
    if (!groups.has(n.app)) groups.set(n.app, []);
    groups.get(n.app).push(n);
  }
  for (const [app, items] of groups) {
    sec.append(el('div.nc-group', null,
      el('div.nc-head', null,
        el('span.nc-app', { html: appIcon(app) }),
        el('b', { text: appTitle(app) }),
        el('button.nc-x', { html: glyph('x'), title: `Clear ${appTitle(app)} notifications`, 'aria-label': `Clear ${appTitle(app)} notifications`, onclick: () => clearGroup(app) })),
      items.slice(0, 4).map(n => el('div.nc-item', null,
        el('div.now', { text: fmtClock(new Date(n.at)) }),
        el('div.tx', null,
          el('b', { text: n.title }),
          n.body ? el('p', { text: n.body }) : null)))));
  }
  return sec;
}

/* ── widgets ─────────────────────────────────────────────────────────
   ncWidgets in settings is the ordered list of visible widget ids */
const WIDGETS = [
  { id: 'cal', name: 'Calendar', icon: () => appIcon('calendar'), build: calCard },
  { id: 'wx', name: 'Weather', icon: () => glyph('sun'), build: wxCard },
  { id: 'clock', name: 'Clock', icon: () => glyph('clock'), build: clockCard },
  { id: 'rem', name: 'Reminders', icon: () => appIcon('reminders'), build: remCard },
  { id: 'st', name: 'Screen Time', icon: () => glyph('hourglass'), build: stCard },
  { id: 'batt', name: 'Batteries', icon: () => glyph('battery'), build: battCard },
];

const order = () => {
  const saved = state.settings.ncWidgets;
  const list = Array.isArray(saved) ? saved : WIDGETS.map(w => w.id);
  return list.filter(id => WIDGETS.some(w => w.id === id));
};
const setOrder = ids => { state.settings.ncWidgets = ids; save(); };

function widgetSection() {
  const wrap = el('div.nc-widgets');
  for (const id of order()) {
    const w = WIDGETS.find(x => x.id === id);
    const card = el(`div.nc-widget.nc-${w.id}`);
    if (editing) card.append(el('button.nc-minus', {
      html: glyph('minus'), title: 'Remove', 'aria-label': `Remove ${w.name} widget`,
      onclick: () => { setOrder(order().filter(i => i !== id)); render(); },
    }));
    card.append(...w.build());
    wrap.append(card);
  }
  /* edit mode: widgets that were removed wait underneath to come back */
  if (editing) {
    const hidden = WIDGETS.filter(w => !order().includes(w.id));
    if (hidden.length) wrap.append(el('div.nc-add-label', { text: 'Add Widgets' }));
    for (const w of hidden) {
      wrap.append(el('button.nc-add', { onclick: () => { setOrder([...order(), w.id]); render(); } },
        el('span.nc-add-ic', { html: w.icon() }),
        el('b', { text: w.name }),
        el('span.nc-plus', { html: glyph('plus') })));
    }
  }
  return wrap;
}

/* calendar events are seeded once; times are hour/minute so they stay
   "today" on whatever day the panel opens */
function events() {
  if (!Array.isArray(state.settings.ncEvents)) {
    state.settings.ncEvents = [
      { title: 'Team Standup', h: 9, m: 30 },
      { title: 'Lunch with Sam', h: 12, m: 30 },
      { title: 'Design Review', h: 14, m: 0 },
    ];
    save();
  }
  return state.settings.ncEvents;
}

function calCard() {
  const now = new Date();
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
  const upcoming = events()
    .filter(e => e.h * 60 + e.m > now.getHours() * 60 + now.getMinutes())
    .sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m))
    .slice(0, 3);
  return [
    el('div.nc-cal-side', null,
      el('span.nc-cal-day', { text: DAY_NAMES[now.getDay()] }),
      el('span.nc-cal-num', { text: String(now.getDate()) })),
    el('div.nc-cal-evts', null,
      upcoming.length
        ? upcoming.map(e => el('div.nc-cal-evt', null,
            el('b', { text: e.title }),
            el('span', { text: fmtClock(at(e.h, e.m)) })))
        : el('div.nc-cal-none', { text: 'No More Events Today' })),
  ];
}

/* weather: Open-Meteo once per session, and only while the panel is open */
const WMO = {
  0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  56: 'Freezing Drizzle', 57: 'Freezing Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  66: 'Freezing Rain', 67: 'Freezing Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow',
  80: 'Light Showers', 81: 'Showers', 82: 'Heavy Showers',
  85: 'Snow Showers', 86: 'Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};
let wx = null;
let wxStarted = false;

function wxFetch() {
  wxStarted = true;
  const ctrl = new AbortController();
  const stop = setTimeout(() => ctrl.abort(), 4000);
  if (state.settings.locationServices === false) return;
  fetch('https://api.open-meteo.com/v1/forecast?latitude=37.77&longitude=-122.42&current=temperature_2m,weather_code&temperature_unit=fahrenheit', { signal: ctrl.signal })
    .then(r => { if (!r.ok) throw new Error('weather'); return r.json(); })
    .then(d => {
      const t = d?.current?.temperature_2m;
      if (typeof t !== 'number') throw new Error('weather');
      wx = { temp: Math.round(t), cond: WMO[d.current.weather_code] || 'Cloudy' };
    })
    .catch(() => { wx = { temp: 64, cond: 'Partly Cloudy' }; })
    .finally(() => { clearTimeout(stop); render(); });
}

function wxCard() {
  if (!wx && !wxStarted) wxFetch();
  return [
    el('div.nc-wx-loc', { text: 'San Francisco' }),
    el('div.nc-wx-now', null,
      el('b.nc-wx-temp', { text: wx ? `${wx.temp}°` : '' }),
      el('span.nc-wx-cond', { text: wx ? wx.cond : '' })),
  ];
}

/* three small analog faces, redrawn every second while the panel is open */
const ZONES = [
  { city: 'Local', tz: null },
  { city: 'New York', tz: 'America/New_York' },
  { city: 'London', tz: 'Europe/London' },
];
const FACE = '<svg viewBox="0 0 40 40"><circle class="rim" cx="20" cy="20" r="17"/><line class="mh" x1="20" y1="20" x2="20" y2="9"/><line class="hh" x1="20" y1="20" x2="20" y2="13"/><circle class="pin" cx="20" cy="20" r="1.6"/></svg>';
let clockFaces = [];

function hmFor(tz) {
  const d = new Date();
  if (!tz) return { h: d.getHours(), m: d.getMinutes() };
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d);
    return { h: +parts.find(p => p.type === 'hour').value % 24, m: +parts.find(p => p.type === 'minute').value };
  } catch { return null; }
}

function tickClocks() {
  for (const c of clockFaces) {
    const t = hmFor(c.tz);
    if (!t) continue;
    c.face.querySelector('.hh')?.setAttribute('transform', `rotate(${(t.h % 12) * 30 + t.m / 2} 20 20)`);
    c.face.querySelector('.mh')?.setAttribute('transform', `rotate(${t.m * 6} 20 20)`);
    c.time.textContent = `${t.h % 12 || 12}:${pad2(t.m)} ${t.h >= 12 ? 'PM' : 'AM'}`;
  }
}

function clockCard() {
  clockFaces = [];
  const row = el('div.nc-clockrow');
  for (const z of ZONES) {
    const face = el('span.nc-face', { html: FACE });
    const time = el('span.nc-face-t');
    clockFaces.push({ face, time, tz: z.tz });
    row.append(el('div.nc-clock-item', null, face, el('b', { text: z.city }), time));
  }
  tickClocks();
  return [row];
}

/* reminders: a seeded checkable list, done state persisted */
function reminders() {
  if (!Array.isArray(state.settings.ncReminders)) {
    state.settings.ncReminders = [
      { t: 'Buy milk', done: false },
      { t: 'Water the plants', done: false },
      { t: 'Call Mom', done: false },
    ];
    save();
  }
  return state.settings.ncReminders;
}

function remCard() {
  const list = reminders();
  return [
    el('div.nc-w-label', { text: 'Reminders' }),
    ...list.slice(0, 4).map(r => {
      const row = el('button.nc-rem-row' + (r.done ? '.done' : ''), null,
        el('span.nc-rem-dot', { html: r.done ? glyph('check') : '' }),
        el('span.nc-rem-t', { text: r.t }));
      row.addEventListener('click', () => {
        r.done = !r.done;
        row.classList.toggle('done', r.done);
        row.querySelector('.nc-rem-dot').innerHTML = r.done ? glyph('check') : '';
        save();
      });
      return row;
    }),
  ];
}

/* screen time counted from the windows that are actually open */
const screenTime = new Map();
setInterval(() => {
  for (const w of wm.windows) screenTime.set(w.app, (screenTime.get(w.app) || 0) + 0.25);
}, 15000);

function stCard() {
  const rows = [...screenTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = Math.max(1, ...rows.map(r => r[1]));
  return [
    el('div.nc-w-label', { text: 'Screen Time' }),
    ...(rows.length ? rows.map(([app, mins]) =>
      el('div.nc-st-row', null,
        el('span.nc-st-app', { text: getApp(app)?.name || app }),
        el('span.nc-st-bar', null, el('i', { style: { width: `${Math.max(5, mins / max * 100)}%` } })),
        el('span.nc-st-min', { text: Math.ceil(mins) + 'm' })))
      : [el('div.nc-st-empty', { text: 'No Activity Yet' })]),
  ];
}

/* the Battery Manager only exists on platforms that ship one */
let battery = null;
if (navigator.getBattery) {
  navigator.getBattery().then(b => {
    battery = b;
    b.addEventListener('levelchange', render);
    b.addEventListener('chargingchange', render);
    render();
  }).catch(() => {});
}

function battCard() {
  const pct = battery ? Math.round(battery.level * 100) : 100;
  const src = battery && !battery.charging ? 'On Battery' : 'Power Adapter';
  return [el('div.nc-batt-row', null,
    el('span.nc-batt-ic', { html: glyph('battery') }),
    el('div.nc-batt-tx', null,
      el('b', { text: MACHINE.model }),
      el('span', { text: src })),
    el('b.nc-batt-pct', { text: pct + '%' }))];
}

/* ── panel ─────────────────────────────────────────────────────────── */
function render() {
  if (!panel) return;
  panel.classList.toggle('editing', editing);
  panel.replaceChildren(
    el('div.nc-head.top', null,
      el('b', { text: 'Notification Center' }),
      history().length ? el('button.nc-clear', { text: 'Clear All', onclick: clearAll }) : null),
    notifSection(),
    widgetSection(),
    el('button.nc-edit', { text: editing ? 'Done' : 'Edit Widgets', onclick: () => { editing = !editing; render(); } }),
  );
}

export function isOpen() { return !!panel; }
export function openCenter() {
  if (panel) return;
  panel = el('div.nc-panel.glass', { role: 'dialog', 'aria-label': 'Notification Center' });
  const scrim = el('div.nc-scrim', { onclick: closeCenter });
  host().append(scrim, panel);
  clockTimer = setInterval(tickClocks, 1000);
  render();
  on('keydown-escape', closeCenter);
}
export function closeCenter() {
  if (!panel) return;
  clearInterval(clockTimer);
  clockTimer = null;
  editing = false;
  panel.remove();
  document.querySelector('.nc-scrim')?.remove();
  panel = null;
}
export function toggleCenter() { panel ? closeCenter() : openCenter(); }

/* the desktop's "Edit Widgets" context-menu item lands here */
on('widgets:edit', () => {
  editing = true;
  openCenter();
  render();
});
