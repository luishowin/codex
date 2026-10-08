// Reminders: list sidebar with drawn glyphs and colour coding, tap-to-check
// circles, an auto-collapsing Completed section, and ⌘N to add. All persisted.
import { el, uid } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { state, save } from '../core/store.js';
import { contextMenu } from '../shell/menus.js';

/* the drawn Reminders icon: three checked bullets on a paper card */
const REM_ICON = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="rmbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ececf0"/></linearGradient></defs><rect x="5" y="5" width="90" height="90" rx="23" fill="url(#rmbg)"/><rect x="5.5" y="5.5" width="89" height="89" rx="22.5" fill="none" stroke="#000" stroke-opacity=".13"/><circle cx="30" cy="32" r="8" fill="#ff9f0a"/><circle cx="30" cy="52" r="8" fill="#30d158"/><circle cx="30" cy="72" r="8" fill="#0a84ff"/><g stroke-width="4.5" stroke-linecap="round"><path d="M46 32h26" stroke="#c9c9ce"/><path d="M46 52h26" stroke="#c9c9ce"/><path d="M46 72h26" stroke="#c9c9ce"/></g><g stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M26 32l2.8 2.8L33.6 30"/><path d="M26 52l2.8 2.8L33.6 50"/><path d="M26 72l2.8 2.8L33.6 70"/></g></svg>`;

const LIST_COLORS = { orange: '#ff9f0a', blue: '#0a84ff', green: '#30d158', red: '#ff453a', purple: '#bf5af2', teal: '#64d2ff', yellow: '#ffd60a' };

const store = () => state.settings.reminders;
const write = v => { state.settings.reminders = v; save(); };
function seed() {
  if (store()) return;
  write({
    lists: [
      { id: 'reminders', name: 'Reminders', color: 'orange', icon: 'list' },
      { id: 'groceries', name: 'Groceries', color: 'green', icon: 'tag' },
      { id: 'work', name: 'Work', color: 'blue', icon: 'desktop' },
    ],
    items: [
      { id: uid('rm'), list: 'reminders', title: 'Water the plants', notes: 'Fiddle leaf gets a cup, succulents a splash', done: false },
      { id: uid('rm'), list: 'reminders', title: 'Call the dentist', done: false },
      { id: uid('rm'), list: 'reminders', title: 'Buy birthday card', done: true },
      { id: uid('rm'), list: 'groceries', title: 'Oat milk', done: false },
      { id: uid('rm'), list: 'groceries', title: 'Eggs', done: false },
      { id: uid('rm'), list: 'groceries', title: 'Bread', done: true },
      { id: uid('rm'), list: 'work', title: 'Send the weekly report', done: false },
      { id: uid('rm'), list: 'work', title: 'Book flights for WWDC', done: false },
    ],
  });
}
const lists = () => store().lists;
const items = listId => store().items.filter(i => i.list === listId);
const pendingCount = listId => items(listId).filter(i => !i.done).length;

const meta = {
  id: 'reminders', name: 'Reminders', icon: REM_ICON, dock: false,
  menus: () => {
    const rm = wm.byApp('reminders')[0]?._rm;
    return [
      { title: 'File', items: () => [
        { label: 'New Reminder', key: '⌘N', action: () => rm?.newItem() },
        { label: 'New List', key: '⇧⌘N', action: () => rm?.newList() },
        { type: 'sep' },
        { label: 'Close', key: '⌘W', action: () => { const w = wm.byApp('reminders')[0]; w && wm.close(w); } },
      ] },
    ];
  },
  launch() {
    seed();
    const existing = wm.byApp('reminders').find(w => w.state !== 'min') || wm.byApp('reminders')[0];
    if (existing) { wm.show(existing); return existing; }
    return wm.open({
      app: 'reminders', key: 'main', title: 'Reminders',
      width: 640, height: 480, minWidth: 480, minHeight: 380,
      build: win => new Reminders(win).mount(),
    });
  },
};

class Reminders {
  constructor(win) {
    this.win = win;
    this.sel = state.settings.remindersSel || 'reminders';
    this.showDone = false;
  }
  mount() {
    this.win._rm = this;
    this.side = el('aside.rm-side');
    this.main = el('div.rm-main scroll');
    this.win.body.append(el('div.rm-root', null, this.side, this.main));
    this.win.tbTools.replaceChildren(
      el('button.tb-btn', { html: glyph('plus'), title: 'New Reminder (⌘N)', onclick: () => this.newItem() }),
      el('button.tb-btn', { html: glyph('list'), title: 'New List (⇧⌘N)', onclick: () => this.newList() }),
    );
    this.render();
  }
  render() {
    this.renderSide();
    this.renderMain();
  }
  renderSide() {
    this.side.replaceChildren(
      el('div.rm-side-t', { text: 'My Lists' }),
      el('div.rm-counts', null, ...lists().map(l =>
        el('button.rm-cnt' + (l.id === this.sel ? '.on' : ''), { onclick: () => { this.sel = l.id; state.settings.remindersSel = l.id; save(); this.render(); } },
          el('span.rm-cnum', { text: String(pendingCount(l.id)) }),
          el('span.rm-cl', { text: l.name })))),
      el('div.rm-lists', null, ...lists().map(l =>
        el('button.rm-list' + (l.id === this.sel ? '.on' : ''), {
          onclick: () => { this.sel = l.id; state.settings.remindersSel = l.id; save(); this.render(); },
          oncontextmenu: e => this.listMenu(e, l),
        },
          el('span.rm-dot', { style: { background: LIST_COLORS[l.color] || LIST_COLORS.orange }, html: glyph(l.icon || 'list') }),
          el('span.rm-lname', { text: l.name }),
          el('span.rm-lnum', { text: String(pendingCount(l.id)) })))),
      el('button.rm-addlist', { onclick: () => this.newList() }, el('span', { html: glyph('plus') }), el('span', { text: 'Add List' })),
    );
  }
  listMenu(e, l) {
    e.preventDefault();
    contextMenu([
      {
        label: 'List Color', sub: Object.keys(LIST_COLORS).map(c => ({
          label: c[0].toUpperCase() + c.slice(1), checked: l.color === c,
          action: () => { l.color = c; write(store()); this.render(); },
        })),
      },
      { type: 'sep' },
      lists().length > 1
        ? { label: 'Delete List', danger: true, action: () => this.delList(l) }
        : { label: 'Delete List', disabled: true },
    ], e.clientX, e.clientY);
  }
  delList(l) {
    store().items = store().items.filter(i => i.list !== l.id);
    store().lists = lists().filter(x => x !== l);
    if (this.sel === l.id) this.sel = lists()[0].id;
    write(store());
    this.render();
  }
  renderMain() {
    const list = lists().find(l => l.id === this.sel) || lists()[0];
    this.sel = list.id;
    const col = LIST_COLORS[list.color] || LIST_COLORS.orange;
    const open = items(list.id).filter(i => !i.done);
    const done = items(list.id).filter(i => i.done);
    const rows = open.map(i => this.row(i, col));
    const doneSec = el('div.rm-done', null);
    if (done.length) {
      doneSec.append(el('button.rm-done-h', {
        onclick: () => { this.showDone = !this.showDone; this.render(); },
      }, el('span.rm-dchev' + (this.showDone ? '.open' : ''), { html: glyph('chevR') }),
        el('b', { text: `Completed` }), el('span.rm-dn', { text: String(done.length) }),
        el('span.rm-clear', { text: 'Clear', onclick: e => { e.stopPropagation(); store().items = store().items.filter(i => !(i.list === list.id && i.done)); write(store()); this.render(); } })));
      if (this.showDone) doneSec.append(...done.map(i => this.row(i, col, true)));
    }
    this.main.replaceChildren(
      el('h1.rm-title', { text: list.name, style: { color: col } }),
      el('div.rm-open-count', { text: `${open.length} Remaining` }),
      ...rows,
      doneSec,
      el('button.rm-new', { onclick: () => this.newItem() },
        el('span.rm-nico', { style: { color: col }, html: glyph('plus') }),
        el('span.rm-nlbl', { text: 'New Reminder' })),
    );
  }
  row(i, col, isDone = false) {
    const row = el('div.rm-row' + (i.done ? '.done' : ''), null,
      el('button.rm-check', {
        style: { '--c': col },
        'aria-label': i.done ? 'Mark incomplete' : 'Mark complete',
        onclick: () => { i.done = !i.done; write(store()); this.render(); },
      }, el('span.rm-in', { html: i.done ? glyph('check') : '' })),
      el('div.rm-fields', null,
        el('input.rm-t', { value: i.title, placeholder: 'Reminder', spellcheck: 'false' }),
        i.notes !== undefined || i.title ? el('input.rm-n', { value: i.notes || '', placeholder: 'Notes', spellcheck: 'false' }) : null),
    );
    const [t, n] = [row.querySelector('.rm-t'), row.querySelector('.rm-n')];
    t.addEventListener('input', () => { i.title = t.value; write(store()); });
    n?.addEventListener('input', () => { i.notes = n.value; write(store()); });
    t.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !t.value.trim()) this.delItem(i);
      if (e.key === 'Enter') t.blur();
    });
    n?.addEventListener('keydown', e => e.stopPropagation());
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      contextMenu([
        { label: i.done ? 'Mark as Incomplete' : 'Mark as Complete', action: () => { i.done = !i.done; write(store()); this.render(); } },
        { type: 'sep' },
        { label: 'Delete Reminder', danger: true, action: () => this.delItem(i) },
      ], e.clientX, e.clientY);
    });
    return row;
  }
  delItem(i) {
    store().items = store().items.filter(x => x !== i);
    write(store());
    this.render();
  }
  newItem() {
    const i = { id: uid('rm'), list: this.sel, title: '', notes: '', done: false };
    store().items.unshift(i);
    write(store());
    this.render();
    setTimeout(() => this.main.querySelector('.rm-row .rm-t')?.focus(), 30);
  }
  newList() {
    const l = { id: uid('rl'), name: 'New List', color: 'blue', icon: 'list' };
    store().lists.push(l);
    this.sel = l.id;
    state.settings.remindersSel = l.id;
    write(store());
    this.render();
    this.renameList(l);
  }
  renameList(l) {
    const h = this.main.querySelector('.rm-title');
    if (!h) return;
    const inp = el('input.rm-title-in', { value: l.name, spellcheck: 'false' });
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') { l.name = inp.value.trim() || 'List'; write(store()); this.render(); }
    });
    inp.addEventListener('blur', () => { l.name = inp.value.trim() || 'List'; write(store()); this.render(); });
    h.replaceChildren(inp);
    inp.select();
  }
}
export default meta;
