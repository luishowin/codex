// Notes: sidebar window with folders, a real note editor and iCloud-style lists.
import { el, $, $$, on, esc, fmtClock, fmtNoteDate, uid, pad2 } from '../core/util.js';
import { glyph, appIcon } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { state, save, saveNow, setSetting } from '../core/store.js';
import { notify } from '../shell/notify.js';
import { contextMenu } from '../shell/menus.js';
import * as fs from '../core/fs.js';
import { art } from '../core/photoart.js';

const meta = {
  id: 'notes', name: 'Notes', icon: 'notes', dock: true,
  menus: () => activeMenus(),
  launch(opts = {}) { return openNotes(opts); },
};

/* Notes uses full month names in the document header: "September 26, 2026 at 1:09 AM" */
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const noteStamp = ts => { const d = new Date(ts); return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${fmtClock(d)}`; };
const pwHash = s => { let h = 5381; for (const ch of String(s)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; return h.toString(36); };
const h32 = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const IMG_KIND = ['coast', 'mountain', 'forest', 'abstract'];
const CHECK_RE = /^\s*[-*] \[([ xX])\]\s?(.*)$/;
const LIST_STYLES = ['bullets', 'dash', 'numbered'];

const STARTER = [
  {
    title: 'Groceries', folder: 'Personal', pinned: true,
    body: 'Saturday shop\n- [ ] Sourdough loaf\n- [x] Oat milk\n- [ ] Cherry tomatoes\n- [ ] Olive oil, the green tin\n- [x] Coffee beans — the Ethiopian one\n- [ ] Lemons\n- [ ] Basil',
  },
  {
    title: 'Lisbon, in October', folder: 'Travel',
    body: 'Four days, no rental car.\n\n- [x] Book the flights\n- [ ] Apartment in Alfama, somewhere quiet\n- [x] Tram 28 the morning we land\n- [ ] Time Out Market on a rainy day\n- [ ] Day trip to Sintra — the palaces open at nine\n- [ ] Fado place someone recommended\n\nBring the good camera. Leave the laptop.',
  },
  {
    title: 'Standup — Thursday', folder: 'Work',
    body: 'Shipped the window manager fixes.\n\n- [x] Drag to the left edge snaps again\n- [x] Notes keeps its checklist state across reloads\n- [ ] Terminal still needs a real lexer for pipes\n\nBlocker: none. Risk: the audio work fights the focus ring.',
  },
  {
    title: 'Lemon pasta', folder: 'Personal',
    body: 'Four ingredients, twelve minutes.\n\n1. Boil the water, salt it properly.\n2. Zest and juice the lemon, keep the seeds out.\n3. Pasta in, one minute less than the box says.\n4. Off the heat: pasta, butter, lemon, parmesan, pepper.\n\nThe trick is the pasta water. Save a mug of it before you drain.',
  },
  {
    title: 'Books for the trip', folder: 'Travel',
    body: 'One novel, one history of the harbour.\n\nFinish the Kepler novel before we go — it is the only thing that will get me on the plane.',
  },
];

function seedNotes() {
  if (state.notesSeeded) return;
  state.notesSeeded = true;
  const now = Date.now();
  const day = 86400000;
  state.notes = STARTER.map((n, i) => ({
    id: uid('n'), title: n.title, body: n.body, folder: n.folder, pinned: !!n.pinned,
    created: now - (i + 2) * day, updated: now - i * day * 0.7 - 3600_000,
  }));
  save();
}

function activeMenus() {
  const win = wm.byApp('notes')[0];
  const n = win && win._notes;
  const cur = n?.current;
  const unlocked = cur && (!cur.locked || n.unlocked.has(cur.id));
  return [
    { title: 'File', items: () => [
      { label: 'New Note', key: '⌘N', action: () => n?.createNote() },
      { label: 'New Folder', key: '⇧⌘N', action: () => n?.newFolder() },
      { type: 'sep' },
      { label: cur?.pinned ? 'Unpin Note' : 'Pin Note', disabled: !cur || !!cur.deleted, action: () => n?.togglePin() },
      { label: 'Move to', disabled: !cur || !!cur.deleted, sub: () => n.moveItems(cur) },
      cur?.locked
        ? (unlocked ? { label: 'Remove Lock', action: () => n.removeLock(cur) } : { label: 'Unlock Note…', action: () => n.focusLock() })
        : { label: 'Lock Note', disabled: !cur || !!cur.deleted, action: () => n.lockNote(cur) },
      { type: 'sep' },
      { label: 'Delete', key: '⌘⌫', disabled: !cur, action: () => n?.deleteCurrent() },
      { type: 'sep' },
      { label: 'Close Window', key: '⌘W', action: () => win && wm.close(win) },
    ] },
    { title: 'Edit', items: () => [
      { label: 'Undo', key: '⌘Z', action: () => document.execCommand?.('undo') },
      { label: 'Redo', key: '⇧⌘Z', action: () => document.execCommand?.('redo') },
      { type: 'sep' },
      { label: 'Cut', key: '⌘X', action: () => document.execCommand?.('cut') },
      { label: 'Copy', key: '⌘C', action: () => document.execCommand?.('copy') },
      { label: 'Paste', key: '⌘V', action: () => n?.pastePlain() },
      { label: 'Select All', key: '⌘A', action: () => document.execCommand?.('selectAll') },
      { type: 'sep' },
      { label: 'Find', key: '⌘F', action: () => n?.focusSearch() },
    ] },
    { title: 'View', items: () => [
      { label: 'as List', key: '⌘1', checked: n?.view !== 'grid', action: () => n?.setView('list') },
      { label: 'as Gallery', key: '⌘2', checked: n?.view === 'grid', action: () => n?.setView('grid') },
    ] },
    { title: 'Format', items: () => [
      { label: 'Title', key: '⇧⌘T', action: () => n?.applyStyle('title') },
      { label: 'Heading', key: '⇧⌘H', action: () => n?.applyStyle('heading') },
      { label: 'Subheading', key: '⇧⌘S', action: () => n?.applyStyle('subheading') },
      { label: 'Body', key: '⇧⌘B', action: () => n?.applyStyle('body') },
      { label: 'Monostyled', key: '⇧⌘M', action: () => n?.applyStyle('mono') },
      { type: 'sep' },
      { label: 'Bulleted List', key: '⇧⌘7', action: () => n?.applyStyle('bullets') },
      { label: 'Dashed List', key: '⇧⌘8', action: () => n?.applyStyle('dash') },
      { label: 'Numbered List', key: '⇧⌘9', action: () => n?.applyStyle('numbered') },
      { type: 'sep' },
      { label: 'Block Quote', key: '⌘⌥\'', action: () => n?.applyStyle('quote') },
      { type: 'sep' },
      { label: 'Bold', key: '⌘B', action: () => n?.charStyle('bold') },
      { label: 'Italic', key: '⌘I', action: () => n?.charStyle('italic') },
      { label: 'Underline', key: '⌘U', action: () => n?.charStyle('underline') },
      { label: 'Strikethrough', key: '⌃⌘-', action: () => n?.charStyle('strikeThrough') },
      { type: 'sep' },
      { label: 'Checklist', key: '⇧⌘L', action: () => n?.toggleChecklist() },
    ] },
    { title: 'Window', items: () => [
      { label: 'Minimize', key: '⌘M', action: () => win && wm.minimize(win) },
      { label: 'Zoom', action: () => win?.zoom() },
    ] },
  ];
}

function openNotes(opts = {}) {
  seedNotes();
  const existing = wm.byApp('notes').find(w => w.state !== 'min');
  if (existing) {
    wm.focus(existing);
    if (opts.noteId) existing._notes?.select(opts.noteId);
    return existing;
  }
  return wm.open({
    app: 'notes', key: 'main', title: 'Notes', chromeTitle: false,
    width: 1040, height: 660, minWidth: 760, minHeight: 420,
    getData: w => ({ noteId: w._notes?.current?.id }),
    onClose: w => w._notes?.flush(),
    build: w => new NotesWindow(w, opts).mount(),
  });
}

/* a document-modal sheet, the shape macOS hangs under the title bar */
function sheetOverlay(win, build) {
  const wrap = el('div.sheet-veil');
  const panel = el('div.app-sheet');
  const api = { wrap, panel, close() { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 200); } };
  build(panel, api);
  wrap.append(panel);
  win.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) e.stopPropagation(); });
  return api;
}

class NotesWindow {
  constructor(win, opts) {
    this.win = win;
    this.opts = opts;
    this.query = '';
    this.folder = 'all';
    this.view = 'list';
    this.unlocked = new Set();
    this.renaming = null;
  }

  get folders() {
    const saved = Array.isArray(state.settings.notesFolders) ? state.settings.notesFolders : ['Personal', 'Work', 'Travel', 'Ideas'];
    const list = saved.slice();
    for (const n of state.notes) {
      const f = n.folder || 'Notes';
      if (f !== 'Notes' && !n.deleted && !list.includes(f)) list.push(f);
    }
    return list;
  }
  setFolders(list) { setSetting('notesFolders', list.filter(f => f !== 'Notes')); }

  mount() {
    const win = this.win;
    win._notes = this;
    /* macOS purges Recently Deleted after thirty days; do it on every open */
    const month = 30 * 86400000, now = Date.now();
    const stale = state.notes.filter(n => n.deleted && now - n.deleted > month);
    if (stale.length) { state.notes = state.notes.filter(n => !stale.includes(n)); save(); }

    this.sidebar = el('aside.sidebar');
    this.listPane = el('div.notes-mid');
    this.detail = el('div.notes-detail');
    win.setSidebar(this.sidebar, 196);
    win.body.append(el('div.split', null, this.listPane, this.detail));
    this.buildSidebar();
    this.buildListPane();
    this.buildDetail();
    this.renderList();
    this.select(this.opts.noteId || this.visible()[0]?.id);
    /* Notes opens with the caret in the note, the way it does on a Mac: the
       search field is for ⌘F, not for the first thing you type. */
    setTimeout(() => this.focusBody(), 40);

    /* the selected row is yellow while the list owns the focus, gray once the
       caret is in the note — the same rule the real list follows */
    this.listPane.addEventListener('pointerdown', () => this.listPane.classList.add('lfocus'));
    this.listPane.addEventListener('focusin', () => this.listPane.classList.add('lfocus'));
    this.detail.addEventListener('pointerdown', () => this.listPane.classList.remove('lfocus'));
    this.detail.addEventListener('focusin', () => this.listPane.classList.remove('lfocus'));
    document.addEventListener('focusin', this._track = e => {
      if (!this.win.node.contains(e.target)) this.listPane.classList.remove('lfocus');
    });

    win.onKey = e => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'f') { this.focusSearch(); return true; }
      if (e.key === 'Escape' && document.activeElement === this.searchInput) {
        if (this.query) { this.query = ''; this.searchInput.value = ''; this.renderList(); this.updateFindHL(); }
        this.focusBody();
        return true;
      }
      if (meta && e.key === 'Backspace') { this.deleteCurrent(); return true; }
      /* ⇧⌘7/8/9 arrive as &, *, ( on a US layout — map them back to the list styles */
      if (meta && e.shiftKey) {
        const alt = { '&': 'bullets', '*': 'dash', '(': 'numbered' }[e.key];
        if (alt) { this.applyStyle(alt); return true; }
      }
      if (meta && e.altKey && (e.key === "'" || e.key === 'œ' || e.key === '‘')) { this.applyStyle('quote'); return true; }
      return false;
    };
  }

  /* ── sidebar ──────────────────────────────────────────────────────── */
  buildSidebar() {
    const folders = this.folders;
    const live = state.notes.filter(n => !n.deleted);
    const countIn = f => live.filter(n => (n.folder || 'Notes') === f).length;
    const row = (label, o = {}) => {
      const kids = [
        el('span.n-ico', { html: o.icon || glyph('folderSmall') }),
        this.renaming === label ? this.renameField(label) : el('span.truncate', { text: label }),
        o.count != null && this.renaming !== label ? el('span.sb-count', { text: String(o.count) }) : null,
      ];
      const r = el('button.sb-item' + (o.on ? '.on' : ''), {
        onclick: o.onClick,
        oncontextmenu: o.onMenu || null,
        ondblclick: o.onRename || null,
      }, ...kids);
      if (o.drop) {
        r.addEventListener('dragover', e => { e.preventDefault(); r.classList.add('drop-hint'); });
        r.addEventListener('dragleave', () => r.classList.remove('drop-hint'));
        r.addEventListener('drop', e => {
          e.preventDefault(); r.classList.remove('drop-hint');
          const id = e.dataTransfer.getData('text/x-note-id');
          if (id) this.moveNoteTo(id, o.drop === '__trash' ? '__trash' : o.drop);
        });
      }
      return r;
    };
    this.sidebar.replaceChildren(
      el('div.sb-section', { text: 'iCloud' }),
      row('Notes', { on: this.folder === 'all', count: live.length, icon: glyph('folderSmall'), onClick: () => this.setFolder('all'), drop: 'Notes' }),
      row('Recently Deleted', { on: this.folder === 'Recently Deleted', count: state.notes.filter(n => n.deleted).length, icon: glyph('trashSmall'), onClick: () => this.setFolder('Recently Deleted'), drop: '__trash' }),
      el('div.sb-section', { text: 'Folders' }),
      ...folders.map(f => row(f, {
        on: this.folder === f, count: countIn(f),
        onClick: () => this.setFolder(f), drop: f,
        onMenu: e => { e.preventDefault(); this.folderMenu(f, e); },
        onRename: () => this.startRenameFolder(f),
      })),
      el('div.sb-spacer'),
      el('button.sb-item.sb-newfolder', { onclick: () => this.newFolder(), title: 'New Folder (⇧⌘N)' },
        el('span.n-ico', { html: glyph('plus') }),
        el('span', { text: 'New Folder' }),
      ),
    );
  }
  renameField(folder) {
    const input = el('input.sb-rename', { value: folder, spellcheck: 'false' });
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { this.renaming = null; this.buildSidebar(); }
    });
    input.addEventListener('blur', () => { if (this.renaming === folder) this.commitRename(folder, input.value); });
    setTimeout(() => { input.focus(); input.select(); }, 30);
    return input;
  }
  startRenameFolder(f) { this.renaming = f; this.buildSidebar(); }
  commitRename(oldName, value) {
    this.renaming = null;
    const clean = String(value || '').trim();
    if (clean && clean !== oldName && !this.folders.includes(clean)) {
      for (const n of state.notes) if (n.folder === oldName) n.folder = clean;
      this.setFolders(this.folders.map(f => f === oldName ? clean : f));
      if (this.folder === oldName) this.folder = clean;
      save();
    }
    this.buildSidebar();
    this.renderList();
  }
  folderMenu(f, e) {
    contextMenu([
      { label: 'Rename Folder', action: () => this.startRenameFolder(f) },
      { type: 'sep' },
      { label: 'Delete Folder', danger: true, action: () => this.deleteFolder(f) },
    ], e.clientX, e.clientY);
  }
  deleteFolder(f) {
    const count = state.notes.filter(n => !n.deleted && n.folder === f).length;
    this.confirm(`Delete folder “${f}”?`,
      count ? `${count} ${count === 1 ? 'note' : 'notes'} in this folder will be moved to Notes.` : 'This folder is empty.',
      'Delete', () => {
        for (const n of state.notes) if (n.folder === f) n.folder = 'Notes';
        this.setFolders(this.folders.filter(x => x !== f));
        if (this.folder === f) this.folder = 'all';
        save();
        this.buildSidebar();
        this.renderList();
      });
  }
  setFolder(f) { this.folder = f; this.renderList(); this.buildSidebar(); this.renderDoc(); this.updateFindHL(); }
  newFolder() {
    /* the real app drops a "New Folder" row into the sidebar already in edit mode */
    const folders = this.folders;
    let name = 'New Folder', i = 2;
    while (folders.includes(name)) name = `New Folder ${i++}`;
    this.setFolders([...folders, name]);
    this.folder = name;
    this.renaming = name;
    this.buildSidebar();
    this.renderList();
  }

  /* ── list pane ────────────────────────────────────────────────────── */
  buildListPane() {
    this.deleteBtn = el('button.tb-btn', { html: glyph('trashSmall'), title: 'Delete (⌘⌫)', onclick: () => this.deleteCurrent() });
    this.fmtBtn = el('button.tb-btn.fmt-aa', { title: 'Format', text: 'Aa', onclick: e => this.formatPop(e.currentTarget) });
    this.checkBtn = el('button.tb-btn', { html: checkGlyph, title: 'Checklist (⇧⌘L)', onclick: () => this.toggleChecklist() });
    this.tableBtn = el('button.tb-btn', { html: tableGlyph, title: 'Insert table', onclick: () => this.insertTable() });
    this.attachBtn = el('button.tb-btn', { html: photoGlyph, title: 'Add photo', onclick: e => this.attachPhoto(e) });
    this.shareBtn = el('button.tb-btn', { html: glyph('share'), title: 'Share', onclick: e => this.shareMenu(e) });
    this.lockBtn = el('button.tb-btn', { html: glyph('lock'), title: 'Lock note', onclick: () => this.current && this.lockNote(this.current) });
    this.composeBtn = el('button.tb-btn', { html: composeGlyph, title: 'New note (⌘N)', onclick: () => this.createNote() });
    this.searchInput = el('input', { type: 'search', placeholder: 'Search', oninput: e => { this.query = e.target.value; this.renderList(); this.updateFindHL(); } });
    this.listToggle = el('div.seg', null,
      el('button' + (this.view === 'list' ? '.on' : ''), { html: glyph('list'), title: 'List view (⌘1)', onclick: () => this.setView('list') }),
      el('button' + (this.view === 'grid' ? '.on' : ''), { html: glyph('grid'), title: 'Gallery view (⌘2)', onclick: () => this.setView('grid') }),
    );
    this.delBar = el('div.notes-delbar', { hidden: true },
      el('span.delbar-txt', { text: 'Notes are available in Recently Deleted for up to 30 days.' }),
      el('button.del-all', { text: 'Delete All', onclick: () => this.deleteAll() }));
    const tools = el('div.tools', null,
      this.listToggle, this.deleteBtn, this.fmtBtn, this.checkBtn, this.tableBtn, this.attachBtn, this.shareBtn, this.lockBtn);
    const search = el('div.search-field.notes-search', null, el('span', { html: glyph('search') }), this.searchInput);
    this.win.tbTools.replaceChildren(tools);
    this.win.tbRight.replaceChildren(this.composeBtn, search);
    this.listPane.append(this.delBar, el('div.notes-list.scroll'));
  }
  setView(v) {
    this.view = v;
    this.listToggle?.children[0]?.classList.toggle('on', v === 'list');
    this.listToggle?.children[1]?.classList.toggle('on', v === 'grid');
    this.renderList();
  }

  /* ── detail ───────────────────────────────────────────────────────── */
  buildDetail() {
    this.doc = el('div.note-doc.scroll');
    this.detail.append(this.doc);
  }

  visible() {
    const q = this.query.toLowerCase().trim();
    return state.notes
      .filter(n => this.folder === 'Recently Deleted' ? n.deleted
        : this.folder === 'all' ? !n.deleted
        : !n.deleted && (n.folder || 'Notes') === this.folder)
      .filter(n => !q || (n.title + ' ' + n.body).toLowerCase().includes(q))
      .sort((a, b) => ((b.deleted || b.updated) - (a.deleted || a.updated)) || 0);
  }
  sortedVisible() {
    return this.visible().sort((a, b) => (b.pinned - a.pinned) || ((b.deleted || b.updated) - (a.deleted || a.updated)));
  }
  displayTitle(n) { return n.title || ((n.body || '').split('\n').find(l => l.trim()) || '').replace(/^\s*[-*] \[[ xX]\]\s*/, '').slice(0, 60) || 'New Note'; }
  previewLine(n) {
    if (n.locked && !this.unlocked.has(n.id)) return 'Locked';
    if (n.deleted) return `Deleted ${fmtNoteDate(n.deleted)}`;
    const skip = n.title;
    const lines = (n.body || '').split('\n').filter(l => l.trim());
    const first = lines.find(l => l.replace(/^\s*[-*] \[[ xX]\]\s*/, '').trim() !== skip.trim()) || lines[0] || '';
    const clean = first.replace(/^\s*[-*] \[[ xX]\]\s*/, '').trim();
    return (clean.length > 90 ? clean.slice(0, 90) + '…' : clean) || 'No additional text';
  }
  renderList() {
    const list = this.listPane.querySelector('.notes-list');
    const notes = this.sortedVisible();
    list.replaceChildren();
    this.delBar.hidden = this.folder !== 'Recently Deleted';
    this.updateToolbar();
    if (!notes.length) { list.append(el('div.notes-empty', { text: this.query ? 'No Results' : this.folder === 'Recently Deleted' ? 'No Recently Deleted Notes' : 'No Notes' })); return; }
    if (this.view === 'grid') {
      const grid = el('div.notes-grid');
      for (const n of notes) grid.append(this.cardFor(n, true));
      list.append(grid);
      return;
    }
    const pinned = notes.filter(n => n.pinned && !n.deleted);
    const rest = notes.filter(n => !n.pinned || n.deleted);
    if (pinned.length) {
      list.append(el('div.notes-year.pin-head', null, el('span', { html: glyph('pin') }), 'Pinned'));
      for (const n of pinned) list.append(this.cardFor(n));
    }
    let lastGroup = null;
    for (const note of rest) {
      const group = noteGroup(note);
      if (group !== lastGroup) { lastGroup = group; list.append(el('div.notes-year', { text: group })); }
      list.append(this.cardFor(note));
    }
  }
  cardFor(note, tile = false) {
    const locked = note.locked && !this.unlocked.has(note.id);
    const inner = tile
      ? [el('b', { text: this.displayTitle(note) }),
         locked ? el('span.lock-sub', null, el('span.lock-mini', { html: glyph('lock') }), 'Locked') : el('span', { text: this.previewLine(note) }),
         el('i', { text: fmtNoteDate(note.deleted || note.updated) })]
      : [el('div.note-row', null,
          el('div.note-head', null,
            el('b', { text: this.displayTitle(note) }),
            el('span.date', { text: fmtNoteDate(note.deleted || note.updated) }),
          ),
          el('div.sub', null,
            locked ? [el('span.lock-mini', { html: glyph('lock') }), ' Locked'] : this.previewLine(note)),
        )];
    const card = el(tile ? 'button.note-tile' : 'div.note-card', {
      draggable: 'true',
      onclick: () => { this.listPane.classList.add('lfocus'); this.select(note.id); },
      oncontextmenu: e => { e.preventDefault(); this.select(note.id); this.noteMenu(note, e); },
    }, ...inner);
    if (this.current?.id === note.id) card.classList.add('sel');
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/x-note-id', note.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    return card;
  }
  moveItems(note) {
    if (!note) return [];
    return [
      { label: 'Notes', checked: (note.folder || 'Notes') === 'Notes', action: () => this.moveNoteTo(note.id, 'Notes') },
      { type: 'sep' },
      ...this.folders.map(f => ({ label: f, checked: note.folder === f, action: () => this.moveNoteTo(note.id, f) })),
    ];
  }
  moveNoteTo(id, folder) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    if (folder === '__trash') { this.deleteNote(note); return; }
    note.folder = folder === 'Notes' ? 'Notes' : folder;
    if (note.deleted) note.deleted = 0;   /* dropped on a folder: it comes back */
    note.updated = Date.now();
    save();
    this.renderList();
    this.buildSidebar();
  }
  recover(note, folder) {
    note.deleted = 0;
    if (folder) note.folder = folder;
    note.updated = Date.now();
    save();
    this.renderList();
    this.buildSidebar();
    this.renderDoc();
    notify('Notes', 'Note recovered');
  }
  noteMenu(note, e) {
    if (note.deleted) {
      contextMenu([
        { label: 'Recover Note', action: () => this.recover(note) },
        { label: 'Move to', sub: this.moveItems(note) },
        { type: 'sep' },
        { label: 'Delete Note…', danger: true, action: () => this.eraseNote(note) },
      ], e.clientX, e.clientY);
      return;
    }
    const open = !note.locked || this.unlocked.has(note.id);
    contextMenu([
      { label: note.pinned ? 'Unpin Note' : 'Pin Note', action: () => { this.select(note.id); this.togglePin(); } },
      { label: 'Move to', sub: this.moveItems(note) },
      { label: 'Duplicate', action: () => this.duplicate(note) },
      { type: 'sep' },
      note.locked
        ? (open ? { label: 'Remove Lock', action: () => this.removeLock(note) } : { label: 'Unlock Note…', action: () => { this.select(note.id); this.focusLock(); } })
        : { label: 'Lock Note', action: () => this.lockNote(note) },
      { type: 'sep' },
      { label: 'Delete', danger: true, action: () => this.deleteNote(note) },
    ], e.clientX, e.clientY);
  }
  updateToolbar() {
    const note = this.current;
    const off = !note || !!note.deleted || (note.locked && !this.unlocked.has(note.id));
    for (const b of [this.fmtBtn, this.checkBtn, this.tableBtn, this.attachBtn]) b.disabled = off;
    this.deleteBtn.disabled = !note;
    this.lockBtn.disabled = !note || !!note.deleted;
    this.shareBtn.disabled = !note;
  }
  select(id) {
    this.serialize();
    this.current = state.notes.find(n => n.id === id) || null;
    this.renderList();
    this.renderDoc();
  }
  renderDoc() {
    const note = this.current;
    this.editor = null;
    this.doc.replaceChildren();
    if (!note) {
      this.win.setTitle('Notes');
      this.doc.append(el('div.notes-empty', { style: { paddingTop: '80px' }, text: this.folder === 'Recently Deleted' ? 'No Recently Deleted Notes' : 'No Notes' }));
      return;
    }
    this.win.setTitle(note.title ? `${note.title} — Notes` : 'Notes');
    const date = el('div.date', { text: noteStamp(note.deleted ? note.created : note.updated) });
    this.dateEl = date;
    const title = el('input.title', {
      value: note.title, placeholder: 'Title', spellcheck: 'false',
      oninput: e => { note.title = e.target.value; this.touch(note); this.renderList(); this.win.setTitle(note.title ? `${note.title} — Notes` : 'Notes'); },
    });
    title.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { title.blur(); this.focusBody(); } });
    const inner = el('div.inner', null, date, title);
    this.doc.append(inner);

    if (note.locked && !this.unlocked.has(note.id)) { inner.append(this.lockView(note)); return; }
    if (note.deleted) {
      inner.append(el('div.deleted-banner', null,
        el('span', { text: 'This note is in Recently Deleted.' }),
        el('button.btn', { text: 'Recover', onclick: () => this.recover(note) })));
    }
    this.bodyHost = el('div');
    inner.append(this.bodyHost);
    this.renderBody(note);
    if (this.query) this.updateFindHL();
  }
  lockView(note) {
    const inp = el('input.lock-pw', { type: 'password', placeholder: 'Password', 'aria-label': 'Note password' });
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') this.tryUnlock(note, inp);
    });
    const wrap = el('div.note-lockwrap', null,
      el('span.lock-ic', { html: glyph('lock') }),
      el('b', { text: 'This note is locked.' }),
      el('div.lock-sub', { text: 'Enter the password to view this note.' }),
      el('div.lock-row', null, inp,
        el('button.btn.primary', { text: 'Unlock', onclick: () => this.tryUnlock(note, inp) })),
    );
    this.lockInput = inp;
    return wrap;
  }
  focusLock() { this.lockInput?.focus(); }
  tryUnlock(note, inp) {
    if (pwHash(inp.value) === state.settings.notesPw) {
      this.unlocked.add(note.id);
      this.renderList();
      this.renderDoc();
      setTimeout(() => this.focusBody(), 30);
    } else {
      const w = this.doc.querySelector('.note-lockwrap');
      if (w) { w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake'); }
      inp.select();
    }
  }
  lockNote(note) {
    if (!note || note.deleted) return;
    const doLock = () => {
      note.locked = true;
      this.unlocked.delete(note.id);
      this.touch(note);
      this.renderList();
      this.renderDoc();
    };
    if (state.settings.notesPw) { doLock(); return; }
    /* first lock ever: Notes asks for the account password once */
    let p1, p2;
    const trySet = api => {
      if (!p1.value) { p1.focus(); return; }
      if (p1.value !== p2.value) { p2.closest('.app-sheet').querySelector('.sheet-err').hidden = false; p2.select(); return; }
      setSetting('notesPw', pwHash(p1.value));
      api.close();
      doLock();
    };
    sheetOverlay(this.win, (panel, api) => {
      p1 = el('input.field', { type: 'password', placeholder: 'Password' });
      p2 = el('input.field', { type: 'password', placeholder: 'Verify' });
      const hint = el('input.field', { placeholder: 'Hint (optional)' });
      panel.append(
        el('h3', { text: 'Set a password for locked notes' }),
        el('p.sheet-sub', { text: 'You will need this password to view locked notes.' }),
        p1, p2, hint,
        el('p.sheet-err', { hidden: true, text: 'Passwords do not match.' }),
        el('div.row', null,
          el('button.btn', { text: 'Cancel', onclick: () => api.close() }),
          el('button.btn.primary', { text: 'Set Password', onclick: () => trySet(api) })),
      );
      panel.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') trySet(api); if (e.key === 'Escape') api.close(); });
    });
    setTimeout(() => p1?.focus(), 60);
  }
  removeLock(note) {
    note.locked = false;
    this.touch(note);
    this.renderList();
    this.renderDoc();
    notify('Notes', 'Lock removed');
  }
  /* the note body is one contenteditable surface: .ln lines, .note-check rows,
     .note-table tables and .note-img attachments */
  renderBody(note) {
    const host = this.bodyHost;
    host.replaceChildren();
    const ed = el('div.note-body', { contenteditable: note.deleted ? 'false' : 'true', spellcheck: 'false' });
    ed.dataset.focus = '1';
    if (note.html) {
      ed.innerHTML = note.html;
    } else {
      for (const line of (note.body || '').split('\n')) {
        const m = line.match(CHECK_RE);
        if (m) ed.append(this.checkRow(m[2], /x/i.test(m[1])));
        else ed.append(el('div.ln', { text: line || '\u200b' }));
      }
    }
    if (!ed.children.length) ed.append(el('div.ln', null, el('br')));
    ed.addEventListener('input', () => this.onEdit());
    ed.addEventListener('keydown', e => this.editorKey(e));
    ed.addEventListener('keyup', () => { this._block = this.caretBlock(); });
    ed.addEventListener('mouseup', () => { this._block = this.caretBlock(); });
    ed.addEventListener('click', e => {
      const box = e.target.closest('.box');
      if (box && ed.contains(box) && !this.current?.deleted) {
        const rowEl = box.closest('.note-check');
        const done = rowEl.classList.toggle('done');
        box.innerHTML = done ? glyph('check', 'glyph') : '';
        this.commit();
      }
    });
    ed.addEventListener('contextmenu', e => {
      const t = e.target.closest('table.note-table');
      if (t) { e.preventDefault(); this.tableMenu(t, e.target.closest('td,th'), e); }
    });
    ed.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    this.editor = ed;
    host.append(ed);
  }
  checkRow(text, done) {
    return el('div.note-check' + (done ? '.done' : ''), null,
      el('span.box', { contenteditable: 'false', html: done ? glyph('check', 'glyph') : '' }),
      el('span.txt', { text }));
  }
  onEdit() {
    const ed = this.editor;
    /* the browser splits bare <div>s on Enter — adopt them as note lines */
    if (ed) for (const c of ed.children) {
      if (c.tagName === 'DIV' && !c.matches('.ln,.note-check,.note-img')) c.classList.add('ln');
    }
    this.serialize();
    if (this.current) { this.current.updated = Date.now(); }
    save();
    clearTimeout(this._rlTimer);
    this._rlTimer = setTimeout(() => this.renderList(), 260);
    this.updateFindHL();
    if (this.dateEl && this.current) this.dateEl.textContent = noteStamp(this.current.updated);
  }
  commit() { this.serialize(); if (this.current) this.current.updated = Date.now(); save(); this.renderList(); }
  flush() { this.serialize(); saveNow(); }
  serialize() {
    const ed = this.editor, note = this.current;
    if (!ed || !note) return;
    const out = [];
    for (const n of ed.childNodes) {
      if (n.nodeType === 3) { out.push(n.nodeValue); continue; }
      if (n.classList?.contains('note-check')) {
        out.push(`- ${n.classList.contains('done') ? '[x]' : '[ ]'} ${(n.querySelector('.txt')?.innerText || '').trimEnd()}`);
      } else if (n.tagName === 'TABLE') {
        for (const tr of n.querySelectorAll('tr')) out.push([...tr.cells].map(c => c.innerText.trim()).join('\t'));
      } else if (n.classList?.contains('note-img')) {
        out.push(`[Attachment: ${n.dataset.name || 'image'}]`);
      } else {
        out.push((n.innerText || '').replace(/\n+$/, ''));
      }
    }
    note.body = out.join('\n');
    note.html = ed.innerHTML;
  }

  /* ── editing ──────────────────────────────────────────────────────── */
  caretBlock() {
    const ed = this.editor;
    if (!ed) return null;
    const s = getSelection();
    if (!s.rangeCount || !ed.contains(s.anchorNode)) return this._block || null;
    let n = s.anchorNode;
    while (n && n !== ed && n.parentElement !== ed) n = n.parentElement;
    return n && n !== ed ? (n.nodeType === 1 ? n : n.parentElement) : null;
  }
  caretCell() {
    /* inside a table, keydown's target is still the editor: ask the caret */
    const ed = this.editor;
    const s = getSelection();
    if (!ed || !s.rangeCount || !ed.contains(s.anchorNode)) return null;
    let n = s.anchorNode;
    if (n.nodeType === 3) n = n.parentElement;
    return n?.closest?.('td,th') || null;
  }
  selBlocks() {
    const ed = this.editor;
    if (!ed) return [];
    const s = getSelection();
    if (!s.rangeCount || !ed.contains(s.anchorNode)) return this._block ? [this._block] : [];
    const r = s.getRangeAt(0);
    const blocks = [...ed.children].filter(c => { try { return r.intersectsNode(c); } catch { return false; } });
    return blocks.length ? blocks : (this.caretBlock() ? [this.caretBlock()] : []);
  }
  placeCaret(node, atStart = true) {
    if (!node) return;
    const s = getSelection();
    const r = document.createRange();
    r.selectNodeContents(node);
    r.collapse(atStart);
    s.removeAllRanges();
    s.addRange(r);
    this._block = this.caretBlock();
  }
  editorKey(e) {
    e.stopPropagation();
    const ed = this.editor;
    if (!ed || ed.contentEditable === 'false') return;
    const cell = this.caretCell();
    const blk = this.caretBlock();
    if (e.key === 'Enter') {
      if (cell) { e.preventDefault(); this.tableEnter(cell); return; }
      if (blk?.classList.contains('note-check')) {
        e.preventDefault();
        const txt = blk.querySelector('.txt');
        if (!txt.innerText.trim()) {
          /* Enter on an empty item leaves the checklist, like the real editor */
          const ln = el('div.ln', null, el('br'));
          blk.replaceWith(ln);
          this.placeCaret(ln);
        } else {
          const row = this.checkRow('', false);
          blk.after(row);
          this.placeCaret(row.querySelector('.txt'));
        }
        this.commit();
        return;
      }
      if (blk && LIST_STYLES.includes(blk.dataset?.s)) {
        e.preventDefault();
        if (!blk.innerText.trim()) { blk.removeAttribute('data-s'); this.placeCaret(blk); }
        else {
          const ln = el('div.ln', { dataset: { s: blk.dataset.s } }, el('br'));
          blk.after(ln);
          this.placeCaret(ln);
        }
        this.commit();
        return;
      }
      /* after a styled line the next line is body text, like real Notes */
      if (blk?.classList?.contains('ln') && blk.dataset.s) {
        const s = getSelection();
        const tail = s.rangeCount ? (() => { const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(blk); r.setStart(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset); return r.toString(); })() : '';
        if (tail === '') {
          e.preventDefault();
          const ln = el('div.ln', null, el('br'));
          blk.after(ln);
          this.placeCaret(ln);
          this.commit();
        }
      }
      /* every other line falls through to the browser's own split */
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (cell) this.tableTab(cell, e.shiftKey);
    }
    /* "- " at the start of a line becomes a bullet, like the real editor */
    if (e.key === ' ' && blk?.classList?.contains('ln') && !blk.dataset.s) {
      const t = blk.innerText;
      if (t === '-' || t === '*' || /^\d+\.$/.test(t)) {
        e.preventDefault();
        blk.dataset.s = /^\d/.test(t) ? 'numbered' : 'bullets';
        blk.textContent = '';
        blk.append(el('br'));
        this.placeCaret(blk);
        this.commit();
      }
    }
    if (e.key === 'Backspace' && blk?.classList?.contains('note-img')) {
      e.preventDefault(); blk.remove(); this.commit();
    }
  }
  applyStyle(style) {
    const ed = this.editor;
    if (!ed || !this.current) return;
    let blocks = this.selBlocks();
    if (!blocks.length) { const l = this.caretBlock() || ed.querySelector('.ln,.note-check'); if (l) blocks = [l]; }
    for (const b of blocks) {
      if (b.classList?.contains('note-check')) {
        const ln = el('div.ln', { text: b.querySelector('.txt')?.innerText || '' });
        if (style !== 'body') ln.dataset.s = style;
        b.replaceWith(ln);
        continue;
      }
      if (b.tagName === 'TABLE' || b.classList?.contains('note-img')) continue;
      if (style === 'body') b.removeAttribute('data-s');
      else b.dataset.s = style;
    }
    this.commit();
  }
  charStyle(cmd) {
    if (!this.editor) return;
    this.editor.focus();
    document.execCommand(cmd, false, null);
    this.commit();
  }
  toggleChecklist() {
    const ed = this.editor;
    if (!ed || !this.current) return;
    let blocks = this.selBlocks();
    if (!blocks.length) { const l = this.caretBlock() || ed.querySelector('.ln'); if (l) blocks = [l]; }
    for (const b of blocks) {
      if (b.classList?.contains('note-check')) {
        const ln = el('div.ln', { text: b.querySelector('.txt')?.innerText || '' });
        b.replaceWith(ln);
        this.placeCaret(ln);
      } else if (b.classList?.contains('ln')) {
        const row = this.checkRow(b.innerText.trim(), false);
        b.replaceWith(row);
        this.placeCaret(row.querySelector('.txt'));
      }
    }
    this.commit();
  }
  insertTable() {
    const ed = this.editor;
    if (!ed || !this.current) return;
    const cell = () => el('td', null, el('br'));
    const tbl = el('table.note-table', null,
      el('tbody', null,
        el('tr.note-th', null, cell(), cell()),
        el('tr', null, cell(), cell())));
    const after = el('div.ln', null, el('br'));
    const at = this.caretBlock();
    if (at) at.after(tbl, after); else ed.append(tbl, after);
    this.commit();
    this.placeCaret(tbl.rows[0].cells[0]);
  }
  tableEnter(cell) {
    const row = cell.parentElement;
    const nr = el('tr', null, ...[...row.cells].map(() => el('td', null, el('br'))));
    row.after(nr);
    this.placeCaret(nr.cells[0]);
    this.commit();
  }
  tableTab(cell, back) {
    const row = cell.parentElement;
    const i = cell.cellIndex;
    let target;
    if (!back) {
      if (i < row.cells.length - 1) target = row.cells[i + 1];
      else if (row.nextElementSibling) target = row.nextElementSibling.cells[0];
      else {
        const nr = el('tr', null, ...[...row.cells].map(() => el('td', null, el('br'))));
        row.after(nr);
        target = nr.cells[0];
      }
    } else {
      if (i > 0) target = row.cells[i - 1];
      else if (row.previousElementSibling) target = row.previousElementSibling.cells[row.previousElementSibling.cells.length - 1];
    }
    if (target) { this.placeCaret(target); this.commit(); }
  }
  tableMenu(tbl, cell, e) {
    const row = cell?.parentElement;
    const i = cell ? cell.cellIndex : 0;
    const addRow = where => {
      const base = row || tbl.rows[0];
      const nr = el('tr', null, ...[...base.cells].map(() => el('td', null, el('br'))));
      where === 'above' ? base.before(nr) : base.after(nr);
      this.commit();
    };
    const addCol = where => {
      for (const tr of tbl.rows) {
        const c = el('td', null, el('br'));
        const ref = tr.cells[i];
        if (where === 'left' || !ref) (ref || tr.cells[0]).before(c); else ref.after(c);
      }
      this.commit();
    };
    contextMenu([
      { label: 'Add Row Above', action: () => addRow('above') },
      { label: 'Add Row Below', action: () => addRow('below') },
      { label: 'Add Column Before', action: () => addCol('left') },
      { label: 'Add Column After', action: () => addCol('right') },
      { type: 'sep' },
      { label: 'Delete Row', disabled: !row || tbl.rows.length < 2, action: () => { row.remove(); this.commit(); } },
      { label: 'Delete Column', disabled: !cell || (row?.cells.length || 0) < 2, action: () => { for (const tr of tbl.rows) tr.cells[i]?.remove(); this.commit(); } },
      { type: 'sep' },
      { label: 'Delete Table', danger: true, action: () => { tbl.remove(); this.commit(); } },
    ], e.clientX, e.clientY);
  }
  insertImage(node) {
    const ed = this.editor;
    if (!ed || !this.current) return;
    const kind = IMG_KIND[(node.palette ?? 0) % IMG_KIND.length];
    const img = el('div.note-img', {
      contenteditable: 'false',
      dataset: { path: fs.pathOf(node), name: node.name },
      title: node.name,
    });
    img.innerHTML = art(kind, 1009 + (h32(node.name) % 400));
    const after = el('div.ln', null, el('br'));
    const at = this.caretBlock();
    if (at) at.after(img, after); else ed.append(img, after);
    this.commit();
    this.placeCaret(after);
  }
  attachPhoto(e) {
    if (!this.current) return;
    const pics = fs.children(fs.HOME + '/Pictures').filter(n => n.kind === 'image');
    if (!pics.length) { notify('Notes', 'No photos in Pictures'); return; }
    contextMenu(pics.map(p => ({ label: p.name.replace(/\.[^.]+$/, ''), action: () => this.insertImage(p) })), e.clientX, e.clientY);
  }
  shareMenu(e) {
    const note = this.current;
    if (!note) return;
    contextMenu([
      {
        label: 'Copy Note', action: () => {
          const text = `${note.title ? note.title + '\n\n' : ''}${note.body || ''}`;
          try { navigator.clipboard?.writeText(text); notify('Notes', 'Note copied to the clipboard'); }
          catch { notify('Notes', 'Could not reach the clipboard'); }
        },
      },
      { label: 'Duplicate', action: () => this.duplicate(note) },
      { type: 'sep' },
      { label: 'Move to', sub: this.moveItems(note) },
    ], e.clientX, e.clientY);
  }

  /* ── the Aa format popover, attached under its button ─────────────── */
  formatPop(btn) {
    if (this.fmtPop) { this.closeFmt(); return; }
    const row = (label, key, fn) => el('button.fmt-row', {
      onpointerdown: e => e.preventDefault(),
      onclick: () => { fn(); this.closeFmt(); },
    }, el('span', { text: label }), el('span.fmt-key', { text: key }));
    const char = (label, cmd, title) => el('button.fmt-b', {
      title, text: label,
      onpointerdown: e => e.preventDefault(),
      onclick: () => { this.charStyle(cmd); },
    });
    const pop = el('div.notes-fmt', null,
      el('div.fmt-cap', { text: 'Text Style' }),
      row('Title', '⇧⌘T', () => this.applyStyle('title')),
      row('Heading', '⇧⌘H', () => this.applyStyle('heading')),
      row('Subheading', '⇧⌘S', () => this.applyStyle('subheading')),
      row('Body', '⇧⌘B', () => this.applyStyle('body')),
      row('Monostyled', '⇧⌘M', () => this.applyStyle('mono')),
      el('hr'),
      row('Bulleted List', '⇧⌘7', () => this.applyStyle('bullets')),
      row('Dashed List', '⇧⌘8', () => this.applyStyle('dash')),
      row('Numbered List', '⇧⌘9', () => this.applyStyle('numbered')),
      el('hr'),
      row('Block Quote', "⌘⌥'", () => this.applyStyle('quote')),
      el('hr'),
      el('div.fmt-btns', null,
        char('B', 'bold', 'Bold (⌘B)'),
        el('button.fmt-b.it', { text: 'I', title: 'Italic (⌘I)', onpointerdown: e => e.preventDefault(), onclick: () => this.charStyle('italic') }),
        el('button.fmt-b.ul', { text: 'U', title: 'Underline (⌘U)', onpointerdown: e => e.preventDefault(), onclick: () => this.charStyle('underline') }),
        el('button.fmt-b.st', { text: 'S', title: 'Strikethrough (⌃⌘-)', onpointerdown: e => e.preventDefault(), onclick: () => this.charStyle('strikeThrough') }),
      ),
    );
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(6, r.left - 90) + 'px';
    pop.style.top = r.bottom + 6 + 'px';
    document.getElementById('overlays').append(pop);
    this.fmtPop = pop;
    setTimeout(() => {
      this._fmtClose = e => { if (!pop.contains(e.target)) this.closeFmt(); };
      document.addEventListener('pointerdown', this._fmtClose, true);
    }, 0);
  }
  closeFmt() {
    this.fmtPop?.remove();
    this.fmtPop = null;
    if (this._fmtClose) { document.removeEventListener('pointerdown', this._fmtClose, true); this._fmtClose = null; }
  }

  /* ── search highlight, like macOS find ────────────────────────────── */
  updateFindHL() {
    if (!window.CSS?.highlights) return;
    const q = this.query.trim().toLowerCase();
    if (!q || !this.editor) { CSS.highlights.delete('notes-find'); return; }
    const ranges = [];
    const walker = document.createTreeWalker(this.editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.nodeValue.toLowerCase();
      let i = 0;
      while ((i = t.indexOf(q, i)) >= 0) {
        const r = new Range();
        r.setStart(node, i); r.setEnd(node, i + q.length);
        ranges.push(r);
        i += q.length;
      }
    }
    CSS.highlights.set('notes-find', new Highlight(...ranges));
    if (ranges.length) ranges[0].startContainer.parentElement?.scrollIntoView({ block: 'nearest' });
  }

  /* ── confirm sheet ────────────────────────────────────────────────── */
  confirm(title, body, dangerLabel, onYes) {
    sheetOverlay(this.win, (panel, api) => {
      panel.classList.add('mini');
      panel.append(
        el('h3', { text: title }),
        el('p.sheet-sub', { text: body }),
        el('div.row', null,
          el('button.btn', { text: 'Cancel', onclick: () => api.close() }),
          el('button.btn.danger-btn', { text: dangerLabel, onclick: () => { api.close(); onYes(); } })),
      );
      panel.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') api.close(); });
    });
  }

  /* ── note ops ─────────────────────────────────────────────────────── */
  touch(note) { note.updated = Date.now(); save(); }
  createNote() {
    this.serialize();
    const note = {
      id: uid('n'), title: '',
      folder: this.folder === 'all' || this.folder === 'Recently Deleted' ? 'Notes' : this.folder,
      pinned: false, body: '', created: Date.now(), updated: Date.now(),
    };
    if (this.folder === 'Recently Deleted') this.folder = 'all';
    state.notes.unshift(note);
    save();
    this.renderList();
    this.buildSidebar();
    this.select(note.id);
    setTimeout(() => this.focusBody(), 30);
  }
  duplicate(note) {
    state.notes.unshift({ ...structuredClone(note), id: uid('n'), title: note.title + ' copy', created: Date.now(), updated: Date.now(), deleted: 0, locked: false });
    save();
    this.renderList();
    this.buildSidebar();
  }
  deleteNote(note) {
    if (note.deleted) { this.eraseNote(note); return; }
    note.deleted = Date.now();
    note.pinned = false;
    save();
    this.current = null;
    this.renderList();
    this.buildSidebar();
    this.select(this.visible()[0]?.id);
  }
  eraseNote(note) {
    this.confirm(`Delete this note permanently?`, 'This cannot be undone.', 'Delete', () => {
      const i = state.notes.indexOf(note);
      if (i >= 0) state.notes.splice(i, 1);
      save();
      this.current = null;
      this.renderList();
      this.buildSidebar();
      this.select(this.visible()[0]?.id);
    });
  }
  deleteAll() {
    const n = state.notes.filter(x => x.deleted).length;
    if (!n) return;
    this.confirm(`Permanently delete ${n} ${n === 1 ? 'note' : 'notes'}?`, 'You will not be able to recover them.', 'Delete All', () => {
      state.notes = state.notes.filter(x => !x.deleted);
      save();
      this.current = null;
      this.renderList();
      this.buildSidebar();
      this.select(this.visible()[0]?.id);
    });
  }
  deleteCurrent() { if (this.current) this.deleteNote(this.current); }
  togglePin() {
    if (!this.current) return;
    this.current.pinned = !this.current.pinned;
    this.current.updated = Date.now();
    save();
    this.renderList();
  }
  focusSearch() { this.searchInput?.focus(); this.searchInput?.select(); }
  /** the caret goes into the note itself, at the very start of it */
  focusBody() {
    const ed = this.editor;
    if (!ed) return;
    ed.focus();
    const first = ed.firstElementChild;
    const target = first?.classList?.contains('note-check') ? first.querySelector('.txt') : first;
    if (!target) return;
    try {
      const s = getSelection(), r = document.createRange();
      r.selectNodeContents(target);
      r.collapse(true);
      s.removeAllRanges();
      s.addRange(r);
    } catch { /* focus is still in the note */ }
  }
  pastePlain() {
    /* ⌘V lands through execCommand; the paste listener keeps it plain */
    this.editor?.focus();
    document.execCommand?.('paste');
  }
}

function noteGroup(note) {
  const d = new Date(note.deleted || note.updated);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  if (now - d < 7 * 86400000) return 'Previous 7 Days';
  if (d.getFullYear() === now.getFullYear()) return MONTHS_LONG[d.getMonth()];
  return String(d.getFullYear());
}

const g = (paths, extra = '') => `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;
const composeGlyph = g('<path d="M9.5 2.8H3.6a1.6 1.6 0 0 0-1.6 1.6v8a1.6 1.6 0 0 0 1.6 1.6h8a1.6 1.6 0 0 0 1.6-1.6V6.5"/><path d="M10.9 2.1 13.9 5.1 8.4 10.6l-3.1.4.4-3.1z"/>');
const checkGlyph = g('<circle cx="5" cy="5" r="3"/><path d="m3.6 5 1 1 1.8-2"/><path d="M9.5 5h4.5"/><circle cx="5" cy="11" r="3"/><path d="m3.6 11 1 1 1.8-2"/><path d="M9.5 11h4.5"/>');
const tableGlyph = g('<rect x="2" y="3" width="12" height="10" rx="1.6"/><path d="M2 6.2h12M8 6.2V13"/>');
const photoGlyph = g('<rect x="2" y="3.4" width="12" height="9.6" rx="1.6"/><circle cx="5.6" cy="6.4" r="1"/><path d="m3.2 11.8 3.4-3.2 2.2 2.1 2.4-2.3 1.6 1.6"/>');

/* notes flush on the way out too — a debounced save is not enough when the
   page is going away */
window.addEventListener('beforeunload', () => { wm.byApp('notes').forEach(w => w._notes?.flush()); });
window.addEventListener('pagehide', () => { wm.byApp('notes').forEach(w => w._notes?.flush()); });

export default meta;
