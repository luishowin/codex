// Calendar: month, week and day views over a real event store — click an event
// for details, drag blocks to move them, and ⌘N opens the new-event sheet.
import { el, uid, pad2 } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { state, save } from '../core/store.js';

/* the drawn Calendar icon is owned by icons.js already (appIcon('calendar')) */

const CAL_COLORS = { personal: '#0a84ff', work: '#ff9f0a', home: '#30d158' };
const CAL_NAMES = { personal: 'Personal', work: 'Work', home: 'Home' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dkey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromKey = k => new Date(k + 'T12:00');
const sameDay = (a, b) => dkey(a) === dkey(b);

const events = () => state.settings.calEvents;
const writeEv = v => { state.settings.calEvents = v; save(); };
function seed() {
  if (events()) return;
  const t = new Date();
  const at = (dOff, h, m, len, title, cal, notes = '') => ({
    id: uid('ev'), date: dkey(new Date(t.getFullYear(), t.getMonth(), t.getDate() + dOff)),
    start: pad2(h) + ':' + pad2(m), end: pad2(h + Math.floor((m + len) / 60)) + ':' + pad2((m + len) % 60),
    title, cal, notes,
  });
  writeEv([
    at(0, 9, 0, 30, 'Team standup', 'work', 'Daily sync in the usual room'),
    at(0, 12, 30, 60, 'Lunch with Maya', 'personal', 'The new place on 4th'),
    at(1, 10, 0, 90, 'Design review', 'work', 'Bring the latest mocks'),
    at(2, 18, 0, 60, 'Gym', 'home'),
    at(4, 14, 0, 45, 'Dentist', 'personal', 'Ask about the night guard'),
    at(6, 11, 0, 120, 'Farmers market', 'home'),
    at(-1, 16, 0, 60, 'Quarterly planning', 'work'),
    at(7, 9, 30, 60, 'Sprint planning', 'work'),
  ]);
}

const meta = {
  id: 'calendar', name: 'Calendar', icon: 'calendar', dock: false,
  menus: () => {
    const cal = wm.byApp('calendar')[0]?._cal;
    return [
      { title: 'File', items: () => [
        { label: 'New Event', key: '⌘N', action: () => cal?.eventSheet() },
        { type: 'sep' },
        { label: 'Close', key: '⌘W', action: () => { const w = wm.byApp('calendar')[0]; w && wm.close(w); } },
      ] },
      { title: 'View', items: () => [
        { label: 'by Day', key: '⌘1', checked: cal?.view === 'day', action: () => cal?.setView('day') },
        { label: 'by Week', key: '⌘2', checked: cal?.view === 'week', action: () => cal?.setView('week') },
        { label: 'by Month', key: '⌘3', checked: cal?.view === 'month', action: () => cal?.setView('month') },
        { type: 'sep' },
        { label: 'Go to Today', key: '⌘T', action: () => cal?.today() },
      ] },
    ];
  },
  launch() {
    seed();
    const existing = wm.byApp('calendar').find(w => w.state !== 'min') || wm.byApp('calendar')[0];
    if (existing) { wm.show(existing); return existing; }
    return wm.open({
      app: 'calendar', key: 'main', title: 'Calendar',
      width: 880, height: 600, minWidth: 660, minHeight: 460,
      build: win => new Cal(win).mount(),
    });
  },
};

class Cal {
  constructor(win) {
    this.win = win;
    this.view = state.settings.calView || 'month';
    this.cursor = new Date();
    this.cursor.setHours(12, 0, 0, 0);
    this.pop = null;
  }
  mount() {
    this.win._cal = this;
    this.main = el('div.cal-main scroll');
    this.side = el('aside.cal-side');
    this.win.body.append(el('div.cal-root', null, this.side, this.main));
    this.seg = el('div.seg', null, ...['day', 'week', 'month'].map(v =>
      el('button.seg-b' + (v === this.view ? '.on' : ''), { text: v[0].toUpperCase() + v.slice(1), onclick: () => this.setView(v) })));
    this.nav = el('div.cal-nav', null,
      el('button.tb-btn', { html: glyph('chevL'), title: 'Previous', onclick: () => this.step(-1) }),
      el('button.tb-btn', { html: glyph('chevR'), title: 'Next', onclick: () => this.step(1) }));
    this.win.tbTools.replaceChildren(this.seg, this.nav,
      el('button.tb-btn', { text: 'Today', onclick: () => this.today() }));
    this.win.tbRight.replaceChildren(
      el('button.tb-btn', { html: glyph('plus'), title: 'New Event (⌘N)', onclick: () => this.eventSheet() }));
    this.render();
  }
  setView(v) { this.view = v; state.settings.calView = v; save(); this.seg.querySelectorAll('.seg-b').forEach(b => b.classList.toggle('on', b.textContent.toLowerCase() === v)); this.render(); }
  today() { this.cursor = new Date(); this.cursor.setHours(12, 0, 0, 0); this.render(); }
  step(d) {
    const c = this.cursor;
    if (this.view === 'month') c.setMonth(c.getMonth() + d);
    else if (this.view === 'week') c.setDate(c.getDate() + d * 7);
    else c.setDate(c.getDate() + d);
    this.render();
  }
  titleText() {
    const c = this.cursor;
    if (this.view === 'month') return `${MON[c.getMonth()]} ${c.getFullYear()}`;
    if (this.view === 'day') return `${DOW[c.getDay()]}, ${MON[c.getMonth()]} ${c.getDate()}, ${c.getFullYear()}`;
    const s = weekStart(c), e = new Date(s); e.setDate(e.getDate() + 6);
    return s.getMonth() === e.getMonth()
      ? `${MON[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${e.getFullYear()}`
      : `${MON[s.getMonth()].slice(0, 3)} ${s.getDate()} – ${MON[e.getMonth()].slice(0, 3)} ${e.getDate()}, ${e.getFullYear()}`;
  }
  render() {
    this.win.setTitle(`Calendar — ${this.titleText()}`);
    this.renderSide();
    this.closePop();
    if (this.view === 'month') this.renderMonth();
    else this.renderHours(this.view === 'day' ? [this.cursor] : weekDays(this.cursor));
  }

  /* ── sidebar: mini-month + calendars ────────────────────────────────── */
  renderSide() {
    const c = this.cursor;
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const cells = [];
    const lead = first.getDay();
    const dim = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(d);
    this.side.replaceChildren(
      el('div.cal-mini-t', { text: MON[c.getMonth()] }),
      el('div.cal-mini', null,
        ...'SMTWTFS'.split('').map(d => el('span.cal-mh', { text: d })),
        ...cells.map(d => {
          const date = d ? new Date(c.getFullYear(), c.getMonth(), d) : null;
          return el('button.cal-md' + (date && sameDay(date, this.cursor) ? '.sel' : '') + (date && sameDay(date, new Date()) ? '.today' : ''), {
            text: d ? String(d) : '', disabled: !d,
            onclick: () => { this.cursor = date; this.render(); },
          });
        })),
      el('div.cal-cals-t', { text: 'Calendars' }),
      ...Object.keys(CAL_NAMES).map(k => {
        const on = state.settings.calHidden?.includes(k) ? false : true;
        return el('button.cal-cal', {
          onclick: () => {
            const h = new Set(state.settings.calHidden || []);
            h.has(k) ? h.delete(k) : h.add(k);
            state.settings.calHidden = [...h]; save(); this.render();
          },
        }, el('span.cal-cdot', { style: { background: CAL_COLORS[k] } }, el('span.cal-ck', { html: on ? glyph('check') : '' })),
          el('span', { text: CAL_NAMES[k] }));
      }));
  }
  visible(ev) { return !(state.settings.calHidden || []).includes(ev.cal); }
  evsOn(k) { return events().filter(e => e.date === k && this.visible(e)); }

  /* ── month view ─────────────────────────────────────────────────────── */
  renderMonth() {
    const c = this.cursor;
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const grid = el('div.cal-mgrid');
    grid.append(...DOW.map(d => el('div.cal-dow', { text: d })));
    const today = new Date();
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const inMonth = d.getMonth() === c.getMonth();
      const cell = el('div.cal-cell' + (inMonth ? '' : '.out') + (sameDay(d, today) ? '.today' : ''), {
        ondblclick: () => this.eventSheet(dkey(d)),
      }, el('span.cal-dnum', { text: String(d.getDate()) }));
      for (const ev of this.evsOn(dkey(d)).slice(0, 3)) {
        cell.append(el('button.cal-ev', {
          style: { background: CAL_COLORS[ev.cal] },
          onclick: e => { e.stopPropagation(); this.popEvent(e.currentTarget, ev); },
        }, el('span.cal-et', { text: ev.start.slice(0, 5) }), el('span', { text: ev.title })));
      }
      const extra = this.evsOn(dkey(d)).length - 3;
      if (extra > 0) cell.append(el('button.cal-more', {
        text: `${extra} more…`,
        onclick: () => { this.cursor = d; this.setView('day'); },
      }));
      grid.append(cell);
    }
    this.main.replaceChildren(grid);
  }

  /* ── week / day view ────────────────────────────────────────────────── */
  renderHours(days) {
    const H = 56;                                  /* px per hour */
    const wrap = el('div.cal-wk');
    const head = el('div.cal-wkhead', { style: { 'grid-template-columns': `52px repeat(${days.length},1fr)` } },
      el('span'),
      ...days.map(d => el('div.cal-wh' + (sameDay(d, new Date()) ? '.today' : ''), null,
        el('span.cal-whd', { text: DOW[d.getDay()] }), el('span.cal-whn', { text: String(d.getDate()) }))));
    const body = el('div.cal-wkbody', { style: { 'grid-template-columns': `52px repeat(${days.length},1fr)` } },
      el('div.cal-times', null, ...[...Array(24)].map((_, h) => el('span.cal-t', { text: h ? `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}` : '' }))),
      ...days.map(d => {
        const col = el('div.cal-col' + (sameDay(d, new Date()) ? '.today' : ''), { style: { height: 24 * H + 'px' } });
        for (let h = 0; h < 24; h++) col.append(el('div.cal-hr', { ondblclick: () => this.eventSheet(dkey(d), h) }));
        if (sameDay(d, new Date())) {
          const now = new Date();
          col.append(el('div.cal-now', { style: { top: (now.getHours() * 60 + now.getMinutes()) / 60 * H + 'px' } }));
        }
        for (const ev of this.evsOn(dkey(d))) col.append(this.evBlock(ev, H));
        return col;
      }));
    wrap.append(head, body);
    this.main.replaceChildren(wrap);
    /* scroll to 8am-ish like the real app */
    const nowY = sameDay(this.cursor, new Date()) ? (new Date().getHours() - 1) * H : 8 * H;
    setTimeout(() => { body.scrollTop = Math.max(0, nowY); }, 0);
  }
  evBlock(ev, H) {
    const [sh, sm] = ev.start.split(':').map(Number);
    const [eh, em] = ev.end.split(':').map(Number);
    const top = (sh * 60 + sm) / 60 * H;
    const h = Math.max(18, ((eh * 60 + em) - (sh * 60 + sm)) / 60 * H);
    const b = el('div.cal-eb', {
      style: { top: top + 'px', height: h + 'px', background: CAL_COLORS[ev.cal] },
    }, el('b', { text: ev.title }), h > 30 ? el('span', { text: `${fmt12(ev.start)} – ${fmt12(ev.end)}` }) : null);
    b.addEventListener('click', e => { e.stopPropagation(); this.popEvent(b, ev); });
    /* drag vertically to move the event */
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      const y0 = e.clientY, startTop = top;
      let moved = false;
      const mm = ev2 => {
        const dy = ev2.clientY - y0;
        if (Math.abs(dy) > 3) moved = true;
        if (moved) b.style.top = Math.max(0, startTop + dy) + 'px';
      };
      const up = ev2 => {
        window.removeEventListener('pointermove', mm);
        window.removeEventListener('pointerup', up);
        if (!moved) return;
        const newTop = parseFloat(b.style.top);
        const mins = Math.round(newTop / H * 60 / 15) * 15;
        const len = (eh * 60 + em) - (sh * 60 + sm);
        ev.start = pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
        ev.end = pad2(Math.floor((mins + len) / 60)) + ':' + pad2((mins + len) % 60);
        writeEv(events());
        this.render();
      };
      window.addEventListener('pointermove', mm);
      window.addEventListener('pointerup', up);
    });
    return b;
  }

  /* ── event popover + sheet ──────────────────────────────────────────── */
  popEvent(anchor, ev) {
    this.closePop();
    const r = anchor.getBoundingClientRect();
    const wr = this.win.node.getBoundingClientRect();
    const pop = el('div.cal-pop', null,
      el('b.cal-pt', { text: ev.title }),
      el('div.cal-pd', { text: `${fromKey(ev.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}` }),
      el('div.cal-ptm', { text: `${fmt12(ev.start)} – ${fmt12(ev.end)}` }),
      ev.notes ? el('div.cal-pn', { text: ev.notes }) : null,
      el('div.cal-pc', null, el('span.cal-cdot.sm', { style: { background: CAL_COLORS[ev.cal] } }), el('span', { text: CAL_NAMES[ev.cal] })),
      el('div.cal-pbtns', null,
        el('button.btn', { text: 'Delete', onclick: () => { writeEv(events().filter(x => x !== ev)); this.closePop(); this.render(); } }),
        el('button.btn.primary', { text: 'Edit', onclick: () => { this.closePop(); this.eventSheet(ev.date, null, ev); } })));
    pop.style.left = Math.min(r.left - wr.left, wr.width - 240) + 'px';
    pop.style.top = Math.min(r.bottom - wr.top + 6, wr.height - 200) + 'px';
    this.pop = pop;
    this.win.node.append(pop);
    setTimeout(() => document.addEventListener('pointerdown', this._popOff = e => { if (!pop.contains(e.target)) this.closePop(); }), 0);
  }
  closePop() {
    if (this._popOff) { document.removeEventListener('pointerdown', this._popOff); this._popOff = null; }
    this.pop?.remove(); this.pop = null;
  }
  eventSheet(dateKey, hour, ev) {
    const isNew = !ev;
    ev = ev || { title: '', date: dateKey || dkey(this.cursor), start: pad2(hour ?? 9) + ':00', end: pad2((hour ?? 9) + 1) + ':00', cal: 'personal', notes: '' };
    const tIn = el('input.ck-in', { placeholder: 'Title', value: ev.title, spellcheck: 'false' });
    const dIn = el('input.ck-in', { type: 'date', value: ev.date });
    const sIn = el('input.ck-num', { type: 'time', value: ev.start });
    const eIn = el('input.ck-num', { type: 'time', value: ev.end });
    const nIn = el('input.ck-in', { placeholder: 'Notes', value: ev.notes || '', spellcheck: 'false' });
    const cIn = el('select.ck-num', null, ...Object.keys(CAL_NAMES).map(k =>
      el('option', { value: k, text: CAL_NAMES[k], selected: ev.cal === k })));
    for (const n of [tIn, dIn, sIn, eIn, nIn]) n.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') dim.remove(); });
    const dim = el('div.ck-dim', null, el('div.ck-sheet', null,
      el('b', { text: isNew ? 'New Event' : 'Edit Event' }),
      tIn,
      el('div.ck-row2', null, dIn, cIn),
      el('div.ck-row2', null, sIn, el('span.ck-colon', { text: 'to' }), eIn),
      nIn,
      el('div.ck-sheet-btns', null,
        el('button.btn', { text: 'Cancel', onclick: () => dim.remove() }),
        el('button.btn.primary', {
          text: isNew ? 'Add' : 'Save', onclick: () => {
            if (!tIn.value.trim()) { tIn.focus(); return; }
            ev.title = tIn.value.trim();
            ev.date = dIn.value || ev.date;
            ev.start = sIn.value || ev.start;
            ev.end = eIn.value || ev.end;
            ev.cal = cIn.value;
            ev.notes = nIn.value.trim();
            if (isNew) { ev.id = uid('ev'); writeEv([...events(), ev]); } else writeEv(events());
            dim.remove();
            this.cursor = fromKey(ev.date);
            this.render();
          },
        }))));
    this.win.body.append(dim);
    setTimeout(() => tIn.focus(), 30);
  }
}
function weekStart(d) { const s = new Date(d); s.setDate(d.getDate() - d.getDay()); s.setHours(12, 0, 0, 0); return s; }
function weekDays(d) { const s = weekStart(d); return [...Array(7)].map((_, i) => { const x = new Date(s); x.setDate(s.getDate() + i); return x; }); }
const fmt12 = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
export default meta;
