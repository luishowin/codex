// Stickies: translucent coloured notes that live on the desktop. Each note is
// its own window, its text and colour persist, and closing a note with text
// asks whether to keep it — exactly like the real app.
import { el, uid } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { state, save } from '../core/store.js';
import { contextMenu } from '../shell/menus.js';

/* the drawn Stickies icon: three translucent notes fanned on white */
const STICKIES_ICON = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="stbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfdfd"/><stop offset="1" stop-color="#e6e7eb"/></linearGradient></defs><rect x="5" y="5" width="90" height="90" rx="23" fill="url(#stbg)"/><rect x="5.5" y="5.5" width="89" height="89" rx="22.5" fill="none" stroke="#000" stroke-opacity=".13"/><rect x="24" y="22" width="44" height="44" rx="4" fill="#bfe3ff" transform="rotate(9 46 44)"/><rect x="24" y="28" width="48" height="48" rx="4" fill="#ffd6dd" transform="rotate(-5 48 52)"/><rect x="27" y="33" width="50" height="50" rx="4" fill="#fdf08a"/><path d="M27 33h50v10H27z" fill="#f0dc68" transform="translate(0 0)"/><g fill="#c9b95c"><rect x="34" y="52" width="34" height="3.6" rx="1.8"/><rect x="34" y="61" width="26" height="3.6" rx="1.8"/><rect x="34" y="70" width="30" height="3.6" rx="1.8"/></g></svg>`;

const COLORS = {
  yellow: '#fdf08a', blue: '#c2e8ff', green: '#d9f3c7',
  pink: '#ffd1dc', purple: '#e6d9f7', gray: '#e4e4e6',
};

const notes = () => state.settings.stickies || [];
const write = list => { state.settings.stickies = list; save(); };
function seed() {
  if (state.settings.stickies) return;
  write([{ id: uid('st'), color: 'yellow', text: 'Welcome to Stickies.\n\nRight-click a note to change its colour. Close one and it asks whether to keep it.' }]);
}

const meta = {
  id: 'stickies', name: 'Stickies', icon: STICKIES_ICON, dock: false,
  menus: () => {
    const win = wm.focused?.app === 'stickies' ? wm.focused : wm.byApp('stickies')[0];
    const note = win && notes().find(n => n.id === win.data?.noteId);
    return [
      { title: 'File', items: () => [
        { label: 'New Note', key: '⌘N', action: () => newNote() },
        { label: 'Close', key: '⌘W', action: () => win && closeNote(win) },
      ] },
      { title: 'Color', items: () => Object.keys(COLORS).map(c => ({
        label: c[0].toUpperCase() + c.slice(1),
        checked: note?.color === c,
        action: () => setColor(win, c),
      })) },
    ];
  },
  launch(opts = {}) {
    seed();
    /* one window per note, the way Stickies restores them */
    if (opts.noteId) {
      const existing = wm.byApp('stickies').find(w => w.data?.noteId === opts.noteId);
      if (existing) return existing;
      const note = notes().find(n => n.id === opts.noteId);
      if (note) return openNote(note);
      return wm.byApp('stickies')[0] || null;
    }
    if (wm.byApp('stickies').length) { const w = wm.byApp('stickies')[0]; wm.show(w); return w; }
    if (!notes().length) write([{ id: uid('st'), color: 'yellow', text: '' }]);
    let first = null;
    notes().forEach((n, i) => {
      const w = openNote(n, i);
      if (!first) first = w;
    });
    return first;
  },
  newWindow() { return newNote(); },
};

function setColor(win, color) {
  const note = notes().find(n => n.id === win?.data?.noteId);
  if (!note) return;
  note.color = color;
  write(notes());
  win.node.dataset.color = color;
}

function openNote(note, i = 0) {
  const win = wm.open({
    app: 'stickies', key: note.id, title: 'Stickies',
    width: 252, height: 252, minWidth: 150, minHeight: 120,
    x: 320 + (i % 4) * 54, y: 180 + (i % 4) * 46,
    resizable: true,
    data: { noteId: note.id },
    getData: w => ({ noteId: w.data?.noteId }),
    build: w => buildNote(w, note),
    onClose: w => w._stk?.done(),
  });
  return win;
}

function newNote() {
  const note = { id: uid('st'), color: 'yellow', text: '' };
  write([...notes(), note]);
  const win = openNote(note, wm.byApp('stickies').length);
  setTimeout(() => win?._stk?.area?.focus(), 60);
  return win;
}

function deleteNote(id) { write(notes().filter(n => n.id !== id)); }

function buildNote(win, note) {
  win.node.dataset.color = note.color || 'yellow';
  win.node.classList.add('sticky');
  win.setTitle((note.text || 'Stickies').split('\n')[0].slice(0, 40) || 'Stickies');
  const area = el('textarea.stk-text', { spellcheck: 'false', placeholder: '' });
  area.value = note.text || '';
  area.addEventListener('input', () => {
    note.text = area.value;
    write(notes());
    win.setTitle(note.text.split('\n')[0].slice(0, 40) || 'Stickies');
  });
  area.addEventListener('keydown', e => e.stopPropagation());
  win.body.append(area);
  const host = { area, done: () => clearInterval(host._t) };
  win._stk = host;

  area.addEventListener('contextmenu', e => {
    e.preventDefault();
    contextMenu([
      { label: 'New Note', key: '⌘N', action: () => newNote() },
      { type: 'sep' },
      {
        label: 'Color', sub: Object.keys(COLORS).map(c => ({
          label: c[0].toUpperCase() + c.slice(1), checked: note.color === c,
          action: () => setColor(win, c),
        })),
      },
      { type: 'sep' },
      { label: 'Close Note', key: '⌘W', action: () => closeNote(win) },
    ], e.clientX, e.clientY);
  });

  /* closing a note with text asks whether to keep it, the Stickies prompt */
  const closeBtn = win.node.querySelector('.light.close');
  if (closeBtn) closeBtn.addEventListener('click', e => {
    const current = notes().find(n => n.id === note.id);
    if (!current || !current.text.trim()) return;   /* empty notes just go */
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault();
    askKeep(win, note);
  }, true);
}

function closeNote(win) {
  const note = notes().find(n => n.id === win.data?.noteId);
  if (!note) { wm.close(win); return; }
  if (!note.text.trim()) { deleteNote(note.id); wm.close(win); return; }
  askKeep(win, note);
}

function askKeep(win, note) {
  if (win._ask) return;
  const sheet = el('div.stk-ask', null,
    el('b', { text: 'Do you want to keep this note?' }),
    el('p', { text: 'Keeping it brings the note back next time you open Stickies.' }),
    el('div.stk-ask-btns', null,
      el('button.btn', { text: 'Delete', onclick: () => { win._ask = null; sheet.remove(); deleteNote(note.id); wm.close(win); } }),
      el('button.btn', { text: 'Cancel', onclick: () => { win._ask = null; sheet.remove(); } }),
      el('button.btn.primary', { text: 'Keep', onclick: () => { win._ask = null; sheet.remove(); wm.close(win); } }),
    ));
  win._ask = sheet;
  win.body.append(sheet);
}

export default meta;
