// Clock: World Clock, Alarms, Stopwatch and Timer in one dark window, with a
// live analogue sweep — the Sequoia Clock app.
import { el, uid, pad2 } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { state, save } from '../core/store.js';
import { notify } from '../shell/notify.js';

/* the drawn Clock icon: a dark tile with a white face, like the real app */
const CLOCK_ICON = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="ckbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e2e33"/><stop offset="1" stop-color="#141417"/></linearGradient></defs><rect x="5" y="5" width="90" height="90" rx="23" fill="url(#ckbg)"/><rect x="5.5" y="5.5" width="89" height="89" rx="22.5" fill="none" stroke="#000" stroke-opacity=".3"/><circle cx="50" cy="50" r="33" fill="#f4f4f6"/><g stroke="#1b1b1e" stroke-width="2">${[...Array(12)].map((_, i) => { const a = i * Math.PI / 6; return `<line x1="${50 + Math.sin(a) * 28}" y1="${50 - Math.cos(a) * 28}" x2="${50 + Math.sin(a) * 31}" y2="${50 - Math.cos(a) * 31}"/>`; }).join('')}</g><path d="M50 50 50 30" stroke="#1b1b1e" stroke-width="4.4" stroke-linecap="round"/><path d="M50 50 66 55" stroke="#1b1b1e" stroke-width="3.4" stroke-linecap="round"/><path d="M50 50 36 66" stroke="#ff9f0a" stroke-width="1.6" stroke-linecap="round"/><circle cx="50" cy="50" r="2.6" fill="#1b1b1e"/></svg>`;

const CITIES = [
  ['Cupertino', 'America/Los_Angeles'], ['San Francisco', 'America/Los_Angeles'], ['Los Angeles', 'America/Los_Angeles'],
  ['New York', 'America/New_York'], ['Boston', 'America/New_York'], ['Chicago', 'America/Chicago'], ['Denver', 'America/Denver'],
  ['Honolulu', 'Pacific/Honolulu'], ['Anchorage', 'America/Anchorage'], ['Mexico City', 'America/Mexico_City'],
  ['Toronto', 'America/Toronto'], ['São Paulo', 'America/Sao_Paulo'], ['London', 'Europe/London'], ['Dublin', 'Europe/Dublin'],
  ['Paris', 'Europe/Paris'], ['Berlin', 'Europe/Berlin'], ['Madrid', 'Europe/Madrid'], ['Rome', 'Europe/Rome'],
  ['Amsterdam', 'Europe/Amsterdam'], ['Stockholm', 'Europe/Stockholm'], ['Cairo', 'Africa/Cairo'], ['Lagos', 'Africa/Lagos'],
  ['Dubai', 'Asia/Dubai'], ['Mumbai', 'Asia/Kolkata'], ['Delhi', 'Asia/Kolkata'], ['Bangkok', 'Asia/Bangkok'],
  ['Singapore', 'Asia/Singapore'], ['Hong Kong', 'Asia/Hong_Kong'], ['Shanghai', 'Asia/Shanghai'], ['Tokyo', 'Asia/Tokyo'],
  ['Seoul', 'Asia/Seoul'], ['Sydney', 'Australia/Sydney'], ['Auckland', 'Pacific/Auckland'],
];
const city = name => CITIES.find(c => c[0] === name);
const nowIn = tz => new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
const hourIn = tz => { const d = nowIn(tz); return `${d.getHours() % 12 || 12}:${pad2(d.getMinutes())}`; };
const ampmIn = tz => nowIn(tz).getHours() >= 12 ? 'PM' : 'AM';
const dayAhead = tz => {
  const local = nowIn(tz), here = new Date();
  const a = new Date(local.getFullYear(), local.getMonth(), local.getDate());
  const b = new Date(here.getFullYear(), here.getMonth(), here.getDate());
  const dd = Math.round((a - b) / 86400000);
  return dd === 0 ? 'Today' : dd > 0 ? 'Tomorrow' : 'Yesterday';
};

/* a small chime for alarms and timers */
let actx = null;
function chime(n = 3) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx ||= new AC();
    if (actx.state === 'suspended') { actx.resume().catch(() => {}); }
    const t0 = actx.currentTime + 0.05;
    for (let i = 0; i < n; i++) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = 1174.66;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.42);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.42 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.42 + 0.36);
      o.connect(g); g.connect(actx.destination);
      o.start(t0 + i * 0.42); o.stop(t0 + i * 0.42 + 0.4);
    }
  } catch { /* no audio device, stay silent */ }
}

const cities = () => state.settings.clockCities || ['Cupertino', 'New York', 'London', 'Tokyo'];
const alarms = () => state.settings.alarms || [];
const writeAlarms = a => { state.settings.alarms = a; save(); };
const writeCities = c => { state.settings.clockCities = c; save(); };

const TABS = [
  ['world', 'World Clock', 'globe'],
  ['alarms', 'Alarm', 'bell'],
  ['stopwatch', 'Stopwatch', 'hourglass'],
  ['timer', 'Timer', 'hourglass'],
];

const meta = {
  id: 'clock', name: 'Clock', icon: CLOCK_ICON, dock: false,
  menus: () => {
    const ck = wm.byApp('clock')[0]?._ck;
    return [
      { title: 'File', items: () => [
        { label: 'Add City', key: '⌘N', disabled: ck?.tab !== 'world', action: () => ck?.addCitySheet() },
        { label: 'New Alarm', key: '⇧⌘N', disabled: ck?.tab !== 'alarms', action: () => ck?.alarmSheet() },
        { type: 'sep' },
        { label: 'Close', key: '⌘W', action: () => { const w = wm.byApp('clock')[0]; w && wm.close(w); } },
      ] },
    ];
  },
  launch() {
    const existing = wm.byApp('clock').find(w => w.state !== 'min') || wm.byApp('clock')[0];
    if (existing) { wm.show(existing); return existing; }
    return wm.open({
      app: 'clock', key: 'main', title: 'Clock',
      width: 700, height: 480, minWidth: 520, minHeight: 400,
      build: win => new Clock(win).mount(),
      onClose: win => win._ck?.unmount(),
    });
  },
};

class Clock {
  constructor(win) {
    this.win = win;
    this.tab = 'world';
    this.laps = [];
    this.swRunning = false;
    this.swStart = 0;
    this.swAcc = 0;
    this.tmLeft = 0;
    this.tmTotal = 0;
    this.tmRunning = false;
    this.tmEnd = 0;
    this.sheet = null;
  }
  mount() {
    this.win._ck = this;
    this.win.node.classList.add('dark-chrome');
    this.body = el('div.ck-body');
    this.tabs = el('div.ck-tabs', null, ...TABS.map(([id, label, g]) =>
      el('button.ck-tab' + (id === this.tab ? '.on' : ''), {
        dataset: { tab: id }, onclick: () => this.setTab(id),
      }, el('span.ck-tico', { html: glyph(g) }), el('span', { text: label }))));
    this.win.body.append(this.body, this.tabs);
    this.tickTimer = setInterval(() => this.tick(), 50);
    this.render();
  }
  unmount() { clearInterval(this.tickTimer); }

  setTab(id) { this.tab = id; this.sheet = null; this.render(); }

  tick() {
    /* one loop drives the analogue faces, the alarm check, the two counters */
    this.checkAlarms();
    if (this.tab === 'world' && this.win.node.isConnected) this.paintFaces();
    if (this.tab === 'stopwatch' && this.swRunning) this.paintStopwatch();
    if (this.tab === 'timer' && this.tmRunning) this.paintTimer();
  }

  render() {
    this.body.replaceChildren();
    this.tabs.querySelectorAll('.ck-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === this.tab));
    ({ world: () => this.renderWorld(), alarms: () => this.renderAlarms(), stopwatch: () => this.renderStopwatch(), timer: () => this.renderTimer() })[this.tab]();
  }

  /* ── world clock ──────────────────────────────────────────────────── */
  renderWorld() {
    const wrap = el('div.ck-world scroll');
    const grid = el('div.ck-grid');
    for (const name of cities()) {
      const c = city(name); if (!c) continue;
      grid.append(el('div.ck-city', { dataset: { city: name } },
        el('div.ck-face', { html: faceSVG() }),
        el('div.ck-cinfo', null,
          el('span.ck-cname', { text: name }),
          el('span.ck-cday', { text: dayAhead(c[1]) }),
          el('span.ck-ctime', { text: `${hourIn(c[1])} ${ampmIn(c[1])}` }))));
    }
    grid.append(el('button.ck-add', { title: 'Add City (⌘N)', onclick: () => this.addCitySheet() },
      el('span', { html: glyph('plus') })));
    wrap.append(grid);
    this.body.append(wrap);
    this.paintFaces();
  }
  paintFaces() {
    this.body.querySelectorAll('.ck-city').forEach(tile => {
      const c = city(tile.dataset.city); if (!c) return;
      const d = nowIn(c[1]);
      const s = d.getSeconds() + d.getMilliseconds() / 1000;
      const m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
      const svg = tile.querySelector('svg');
      if (!svg) return;
      const set = (cls, deg) => { const n = svg.querySelector(cls); if (n) n.setAttribute('transform', `rotate(${deg} 50 50)`); };
      set('.h', h * 30); set('.m', m * 6); set('.s', s * 6);
      const ctime = tile.querySelector('.ck-ctime');
      if (ctime) ctime.textContent = `${hourIn(c[1])} ${ampmIn(c[1])}`;
    });
  }
  addCitySheet() {
    const input = el('input.ck-in', { placeholder: 'Search for a city', spellcheck: 'false' });
    const list = el('div.ck-addlist scroll');
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const hits = CITIES.filter(([n]) => !q || n.toLowerCase().includes(q)).filter(([n]) => !cities().includes(n));
      list.replaceChildren(...hits.slice(0, 8).map(([n, tz]) => {
        const d = nowIn(tz);
        return el('button.ck-addrow', {
          onclick: () => { writeCities([...cities(), n]); this.sheet.remove(); this.sheet = null; this.render(); },
        },
          el('span', { text: n }),
          el('span.ck-arow-t', { text: `${hourIn(tz)} ${ampmIn(tz)}` }));
      }));
      if (!hits.length) list.replaceChildren(el('div.ck-none', { text: 'No cities found' }));
    };
    input.addEventListener('input', draw);
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') this.closeSheet(); if (e.key === 'Enter') list.querySelector('.ck-addrow')?.click(); });
    this.openSheet(el('div.ck-sheet', null,
      el('b', { text: 'Add a City' }), input, list));
    draw();
    setTimeout(() => input.focus(), 30);
  }

  /* ── alarms ───────────────────────────────────────────────────────── */
  renderAlarms() {
    const wrap = el('div.ck-alarms scroll');
    const list = el('div.ck-alist');
    if (!alarms().length) {
      list.append(el('div.ck-none', { text: 'No Alarms' }));
    }
    for (const a of alarms()) {
      const row = el('div.ck-alarm', null,
        el('div.ck-aleft', null,
          el('span.ck-atime' + (a.on ? '' : '.off'), { text: `${a.h % 12 || 12}:${pad2(a.m)}` }),
          el('span.ck-aampm' + (a.on ? '' : '.off'), { text: a.h >= 12 ? 'PM' : 'AM' }),
          el('span.ck-alabel', { text: a.label || 'Alarm' })),
        el('button.sw' + (a.on ? '.on' : ''), {
          role: 'switch', 'aria-checked': String(a.on),
          onclick: () => { a.on = !a.on; delete a.fired; writeAlarms(alarms()); this.render(); },
        }, el('i')),
      );
      row.addEventListener('contextmenu', e => {
        e.preventDefault();
        import('../shell/menus.js').then(m => m.contextMenu([
          { label: 'Delete Alarm', danger: true, action: () => { writeAlarms(alarms().filter(x => x !== a)); this.render(); } },
        ], e.clientX, e.clientY));
      });
      list.append(row);
    }
    wrap.append(list,
      el('button.ck-alarmadd', { onclick: () => this.alarmSheet() },
        el('span', { html: glyph('plus') }), el('span', { text: 'New Alarm' })));
    this.body.append(wrap);
  }
  alarmSheet() {
    const now = new Date();
    const hIn = el('input.ck-num', { type: 'number', min: '1', max: '12', value: String((now.getHours() % 12) || 12) });
    const mIn = el('input.ck-num', { type: 'number', min: '0', max: '59', value: pad2(now.getMinutes()) });
    const apIn = el('select.ck-num', null, el('option', { text: 'AM' }), el('option', { text: 'PM', selected: now.getHours() >= 12 }));
    const labelIn = el('input.ck-in', { placeholder: 'Label', value: 'Alarm' });
    for (const n of [hIn, mIn]) n.addEventListener('keydown', e => e.stopPropagation());
    labelIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') save.click(); });
    const save = el('button.btn.primary', {
      text: 'Save', onclick: () => {
        let h = Math.min(12, Math.max(1, Number(hIn.value) || 12)) % 12;
        if (apIn.value === 'PM') h += 12;
        const m = Math.min(59, Math.max(0, Number(mIn.value) || 0));
        writeAlarms([...alarms(), { id: uid('al'), h, m, label: labelIn.value.trim() || 'Alarm', on: true }]);
        this.closeSheet();
        this.render();
      },
    });
    this.openSheet(el('div.ck-sheet', null,
      el('b', { text: 'New Alarm' }),
      el('div.ck-timepick', null, hIn, el('span.ck-colon', { text: ':' }), mIn, apIn),
      labelIn,
      el('div.ck-sheet-btns', null,
        el('button.btn', { text: 'Cancel', onclick: () => this.closeSheet() }), save)));
    setTimeout(() => hIn.focus(), 30);
  }
  checkAlarms() {
    const now = new Date();
    const stamp = `${now.getHours()}:${now.getMinutes()}:${now.getDate()}`;
    for (const a of alarms()) {
      if (!a.on || a.fired === stamp) continue;
      if (a.h === now.getHours() && a.m === now.getMinutes()) {
        a.fired = stamp;
        writeAlarms(alarms());
        chime(4);
        notify('Clock', `${a.label || 'Alarm'} — ${a.h % 12 || 12}:${pad2(a.m)} ${a.h >= 12 ? 'PM' : 'AM'}`, { app: 'clock', timeout: 8000 });
      }
    }
  }

  /* ── stopwatch ────────────────────────────────────────────────────── */
  renderStopwatch() {
    this.swDisplay = el('div.ck-sw-time', { text: fmtSw(this.swTotal()) });
    this.swList = el('div.ck-laps scroll');
    const lapBtn = this.lapBtn = el('button.ck-btn', { text: 'Lap', disabled: !this.swRunning && !this.swTotal(), onclick: () => this.swRunning ? this.lap() : this.swReset() });
    this.swBtn = el('button.ck-btn.primary', { text: this.swRunning ? 'Stop' : 'Start', onclick: () => this.swToggle() });
    this.body.append(el('div.ck-center', null,
      this.swDisplay,
      el('div.ck-sw-btns', null, lapBtn, this.swBtn),
      this.swList));
    this.renderLaps();
  }
  swTotal() { return this.swAcc + (this.swRunning ? Date.now() - this.swStart : 0); }
  swToggle() {
    if (this.swRunning) { this.swAcc += Date.now() - this.swStart; this.swRunning = false; }
    else { this.swStart = Date.now(); this.swRunning = true; }
    this.render();
  }
  swReset() { this.swAcc = 0; this.laps = []; this.render(); }
  lap() {
    this.laps.unshift(this.swTotal());
    this.renderLaps();
  }
  renderLaps() {
    this.swList?.replaceChildren(...this.laps.map((t, i) => el('div.ck-lap', null,
      el('span', { text: `Lap ${this.laps.length - i}` }), el('span', { text: fmtSw(t) }))));
  }
  paintStopwatch() {
    if (this.swDisplay) this.swDisplay.textContent = fmtSw(this.swTotal());
    if (this.lapBtn) this.lapBtn.textContent = 'Lap';
  }

  /* ── timer ────────────────────────────────────────────────────────── */
  renderTimer() {
    if (this.tmRunning || this.tmLeft > 0) {
      const ring = this.tmRing = el('div.ck-ring', { html: `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="7"/><circle class="arc" cx="60" cy="60" r="52" fill="none" stroke="#ff9f0a" stroke-width="7" stroke-linecap="round" stroke-dasharray="326.7" transform="rotate(-90 60 60)"/></svg>` });
      this.tmDisplay = el('div.ck-tm-left');
      const btns = el('div.ck-sw-btns', null,
        el('button.ck-btn', { text: 'Cancel', onclick: () => this.tmCancel() }),
        this.tmPause = el('button.ck-btn.primary', { text: this.tmRunning ? 'Pause' : 'Resume', onclick: () => this.tmToggle() }));
      this.body.append(el('div.ck-center', null, ring, this.tmDisplay, btns));
      this.paintTimer();
      return;
    }
    const h = this.tmH = el('input.ck-num.big', { type: 'number', min: '0', max: '23', value: '0' });
    const m = this.tmM = el('input.ck-num.big', { type: 'number', min: '0', max: '59', value: '5' });
    const s = this.tmS = el('input.ck-num.big', { type: 'number', min: '0', max: '59', value: '0' });
    for (const n of [h, m, s]) n.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') this.tmStart(); });
    this.body.append(el('div.ck-center', null,
      el('div.ck-tm-pick', null,
        el('div.ck-tm-col', null, h, el('span', { text: 'hours' })),
        el('div.ck-tm-col', null, m, el('span', { text: 'min' })),
        el('div.ck-tm-col', null, s, el('span', { text: 'sec' }))),
      el('div.ck-presets', null, ...[1, 5, 10, 20].map(mm =>
        el('button.ck-chip', { text: `${mm} min`, onclick: () => { this.tmM.value = String(mm); this.tmH.value = '0'; this.tmS.value = '0'; } }))),
      el('div.ck-sw-btns', null, el('button.ck-btn.primary', { text: 'Start Timer', onclick: () => this.tmStart() })),
    ));
  }
  tmStart() {
    const sec = (Number(this.tmH.value) || 0) * 3600 + (Number(this.tmM.value) || 0) * 60 + (Number(this.tmS.value) || 0);
    if (sec <= 0) return;
    this.tmTotal = this.tmLeft = sec * 1000;
    this.tmEnd = Date.now() + this.tmLeft;
    this.tmRunning = true;
    this.render();
  }
  tmToggle() {
    if (this.tmRunning) { this.tmLeft = Math.max(0, this.tmEnd - Date.now()); this.tmRunning = false; }
    else { this.tmEnd = Date.now() + this.tmLeft; this.tmRunning = true; }
    this.render();
  }
  tmCancel() { this.tmLeft = 0; this.tmRunning = false; this.render(); }
  paintTimer() {
    if (!this.tmRunning) { if (this.tmDisplay) this.tmDisplay.textContent = fmtT(this.tmLeft); return; }
    this.tmLeft = Math.max(0, this.tmEnd - Date.now());
    if (this.tmDisplay) this.tmDisplay.textContent = fmtT(this.tmLeft);
    const arc = this.tmRing?.querySelector('.arc');
    if (arc) arc.setAttribute('stroke-dashoffset', String(326.7 * (1 - this.tmLeft / this.tmTotal)));
    if (this.tmLeft <= 0) {
      this.tmRunning = false;
      this.tmLeft = 0;
      chime(4);
      notify('Clock', 'Timer Done', { app: 'clock', timeout: 8000 });
      this.render();
    }
  }

  /* ── sheet host ───────────────────────────────────────────────────── */
  openSheet(node) {
    this.closeSheet();
    const dim = el('div.ck-dim', { onclick: e => { if (e.target === dim) this.closeSheet(); } }, node);
    this.sheet = dim;
    this.win.body.append(dim);
  }
  closeSheet() { this.sheet?.remove(); this.sheet = null; }
}

const fmtSw = ms => {
  const t = Math.floor(ms);
  return `${pad2(Math.floor(t / 60000))}:${pad2(Math.floor(t / 1000) % 60)}.${pad2(Math.floor(t / 10) % 100)}`;
};
const fmtT = ms => {
  const t = Math.ceil(ms / 1000);
  const h = Math.floor(t / 3600);
  return h ? `${h}:${pad2(Math.floor(t / 60) % 60)}:${pad2(t % 60)}` : `${Math.floor(t / 60)}:${pad2(t % 60)}`;
};

/* an analogue face template; hands are rotated by the tick */
const faceSVG = () => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="46" fill="#2b2b30"/>
  <g stroke="#5a5a62" stroke-width="1.6">${[...Array(12)].map((_, i) => { const a = i * Math.PI / 6; return `<line x1="${50 + Math.sin(a) * 40}" y1="${50 - Math.cos(a) * 40}" x2="${50 + Math.sin(a) * 44}" y2="${50 - Math.cos(a) * 44}"/>`; }).join('')}</g>
  <g class="h"><path d="M50 50 50 28" stroke="#fff" stroke-width="4.4" stroke-linecap="round"/></g>
  <g class="m"><path d="M50 50 50 16" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/></g>
  <g class="s"><path d="M50 54 50 12" stroke="#ff9f0a" stroke-width="1.4" stroke-linecap="round"/></g>
  <circle cx="50" cy="50" r="2.4" fill="#ff9f0a"/>
</svg>`;
export default meta;
