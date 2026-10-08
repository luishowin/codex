// TextEdit: a document editor with the real macOS habits — sheets that hang
// from the title bar for Save and Open, a find bar, rich and plain documents.
import { el, esc, uid, fmtSize } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { state, save, saveNow, saveWindow, setSetting } from '../core/store.js';
import { notify } from '../shell/notify.js';
import * as fs from '../core/fs.js';

const meta = {
  id: 'textedit', name: 'TextEdit', icon: 'textedit', dock: true,
  menus: () => activeMenus(),
  settingsPane: 'general',
  newWindow: () => openTextEdit({ fresh: true }),
  launch(opts = {}) { return openTextEdit(opts); },
};

const FONTS = [
  { name: 'San Francisco', css: "-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif" },
  { name: 'Menlo', css: "Menlo, 'SF Mono', monospace" },
  { name: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  { name: 'Courier', css: "Courier, 'Courier New', monospace" },
  { name: 'Times', css: "'Times New Roman', Times, serif" },
];
const SIZES = [9, 10, 11, 12, 13, 14, 18, 24, 28, 36, 48, 64];
const COLORS = ['#000000', '#57606a', '#e13238', '#e8730c', '#e6b800', '#1f9d4d', '#0a84ff', '#5e5ce6', '#bf5af2', '#ffffff'];

/* the places a macOS save sheet shows down its left edge */
const PLACES = [
  { name: 'Recents', path: null },
  { name: 'Applications', path: '/Applications' },
  { name: 'Desktop', path: 'HOME/Desktop' },
  { name: 'Documents', path: 'HOME/Documents' },
  { name: 'Downloads', path: 'HOME/Downloads' },
  { name: 'Home', path: 'HOME' },
  { name: 'Pictures', path: 'HOME/Pictures' },
  { name: 'Music', path: 'HOME/Music' },
];
/* the short list in the collapsed "Where:" popup */
const WHERE_POP = [
  { name: 'Desktop', path: 'HOME/Desktop' },
  { name: 'Documents', path: 'HOME/Documents' },
  { name: 'Downloads', path: 'HOME/Downloads' },
  { name: 'iCloud Drive', path: 'ICLOUD' },
];
const placePath = p => !p ? null : p === 'ICLOUD' ? fs.ICLOUD : p === 'HOME' ? fs.HOME : p.startsWith('HOME/') ? fs.HOME + '/' + p.slice(5) : p;
const baseName = p => (p || '').split('/').pop() || 'Untitled';
const extOf = p => (p || '').match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '';
const isTextFile = n => n && n.type !== 'dir' && ['txt', 'rtf', 'md', 'text', ''].includes(extOf(n.name)) && n.kind !== 'app' && n.kind !== 'image';

function activeMenus() {
  const win = wm.byApp('textedit').find(w => w === wm.focused) || wm.byApp('textedit')[0];
  const te = win && win._te;
  return [
    { title: 'File', items: () => [
      { label: 'New', key: '⌘N', action: () => openTextEdit({ fresh: true }) },
      { label: 'Open…', key: '⌘O', action: () => te?.openSheet() },
      { label: 'Open Recent', sub: () => (state.settings.teRecent || []).map(p => ({ label: baseName(p), action: () => openTextEdit({ path: p }) })), disabled: !(state.settings.teRecent || []).length },
      { type: 'sep' },
      { label: 'Close', key: '⌘W', action: () => te?.requestClose() },
      { label: 'Save', key: '⌘S', action: () => te?.save() },
      { label: 'Save As…', key: '⇧⌘S', action: () => te?.saveSheet() },
      { label: 'Duplicate', action: () => te?.duplicate() },
      { type: 'sep' },
      { label: 'Print…', key: '⌘P', action: () => window.print() },
    ] },
    { title: 'Edit', items: () => [
      { label: 'Undo', key: '⌘Z', action: () => document.execCommand?.('undo') },
      { label: 'Redo', key: '⇧⌘Z', action: () => document.execCommand?.('redo') },
      { type: 'sep' },
      { label: 'Cut', key: '⌘X', action: () => document.execCommand?.('cut') },
      { label: 'Copy', key: '⌘C', action: () => document.execCommand?.('copy') },
      { label: 'Paste', key: '⌘V', action: () => document.execCommand?.('paste') },
      { label: 'Select All', key: '⌘A', action: () => document.execCommand?.('selectAll') },
      { type: 'sep' },
      { label: 'Find', sub: [
        { label: 'Find…', key: '⌘F', action: () => te?.showFind() },
        { label: 'Find Next', key: '⌘G', action: () => te?.findNext() },
        { label: 'Find Previous', key: '⇧⌘G', action: () => te?.findNext(true) },
      ] },
    ] },
    { title: 'Format', items: () => [
      { label: 'Font', sub: [
        { label: 'Show Fonts', key: '⌘T', action: () => te?.fontPanel() },
        { type: 'sep' },
        { label: 'Bold', key: '⌘B', action: () => te?.cmd('bold') },
        { label: 'Italic', key: '⌘I', action: () => te?.cmd('italic') },
        { label: 'Underline', key: '⌘U', action: () => te?.cmd('underline') },
        { label: 'Strikethrough', action: () => te?.cmd('strikeThrough') },
        { type: 'sep' },
        { label: 'Bigger', key: '⌘+', action: () => te?.bumpSize(1) },
        { label: 'Smaller', key: '⌘-', action: () => te?.bumpSize(-1) },
      ] },
      { label: 'Text', sub: [
        { label: 'Align Left', key: '⌘{', action: () => te?.cmd('justifyLeft') },
        { label: 'Center', key: '⌘|', action: () => te?.cmd('justifyCenter') },
        { label: 'Align Right', key: '⌘}', action: () => te?.cmd('justifyRight') },
        { label: 'Justify', key: '⌥⌘|', action: () => te?.cmd('justifyFull') },
      ] },
      { type: 'sep' },
      te?.plain
        ? { label: 'Make Rich Text', key: '⇧⌘T', action: () => te?.setPlain(false) }
        : { label: 'Make Plain Text', key: '⇧⌘T', action: () => te?.askMakePlain() },
    ] },
    { title: 'View', items: () => [
      { label: 'Zoom In', key: '⌘=', action: () => te?.zoom(1) },
      { label: 'Zoom Out', key: '⌘-', action: () => te?.zoom(-1) },
    ] },
    { title: 'Window', items: () => [
      { label: 'Minimize', key: '⌘M', action: () => win && wm.minimize(win) },
      { label: 'Zoom', action: () => win?.zoom() },
    ] },
  ];
}

function openTextEdit(opts = {}) {
  if (opts.path) {
    const hit = wm.byApp('textedit').find(w => w._te?.path === opts.path);
    if (hit) { wm.show(hit); return hit; }
  } else if (!opts.fresh && opts.draft == null) {
    /* a bare "open TextEdit" reuses a window; a restored draft is its own doc */
    const hit = wm.byApp('textedit').find(w => w.state !== 'min');
    if (hit) { wm.focus(hit); return hit; }
  }
  return wm.open({
    app: 'textedit',
    key: opts.path ? `doc:${opts.path}` : `untitled:${uid('te')}`,
    title: 'Untitled',
    width: 720, height: 620, minWidth: 480, minHeight: 320,
    getData: w => w._te?.record(),
    onClose: w => w._te?.flush(),
    build: w => new TextEdit(w, opts).mount(),
  });
}

function rememberRecent(path) {
  const list = (state.settings.teRecent || []).filter(p => p !== path);
  list.unshift(path);
  setSetting('teRecent', list.slice(0, 10));
}

class TextEdit {
  constructor(win, opts) {
    this.win = win;
    this.opts = opts;
    this.path = opts.path || null;
    this.plain = opts.plain ?? (this.path ? extOf(this.path) === 'txt' : false);
    this.dirty = !!opts.dirty;
    this.findOn = false;
    this.zoomPct = 100;
  }

  mount() {
    const win = this.win;
    win._te = this;
    this.formatBar = this.buildFormatBar();
    this.ruler = el('div.te-ruler', null,
      el('span', { class: 'r-mark', text: '0' }),
      el('span', { class: 'r-tabs' }));
    this.findBar = this.buildFindBar();
    this.page = el('div.te-page.rich', { contenteditable: 'true', spellcheck: 'false' });
    this.page.dataset.focus = '1';
    this.wrap = el('div.te-wrap', null, this.page);
    win.body.append(this.formatBar, this.ruler, this.findBar, this.wrap);
    win.node.classList.toggle('te-plain', this.plain);

    this.page.addEventListener('input', () => this.markDirty());
    this.page.addEventListener('keydown', e => e.stopPropagation());
    this.page.addEventListener('keyup', () => this.syncFormat());
    this.page.addEventListener('mouseup', () => this.syncFormat());
    this.page.addEventListener('paste', e => {
      if (!this.plain) return;               /* a plain document stays plain */
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });

    /* the close button belongs to the window manager; a dirty document owns it.
       the wm's listener was registered first, so the light has to be stopped
       during capture — before the event reaches it — not in a second handler. */
    const closeBtn = win.node.querySelector('.light.close');
    if (closeBtn) closeBtn.append(el('i.dirty-dot'));
    win.node.addEventListener('click', e => {
      if (!this.dirty || !e.target.closest?.('.light.close')) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.requestClose();
    }, true);

    win.onKey = e => {
      if (e.key === 'Escape' && this._sheet) { this.closeSheet(); return true; }
      if (e.key === 'Escape' && this.findOn) { this.hideFind(); return true; }
      return false;
    };

    /* load path or draft, then paint */
    if (this.path) this.loadPath(this.path);
    else if (this.opts.draft != null) this.setContent(this.opts.draft, this.opts.plain);
    this.updateTitle();
    setTimeout(() => this.page.focus(), 40);
  }

  /* ── content ──────────────────────────────────────────────────────── */
  get text() { return (this.page.innerText || '').replace(/\n+$/, ''); }
  content() { return this.plain ? this.text : this.page.innerHTML; }
  setContent(content, plain) {
    if (plain || !/<[a-z][\s\S]*>/i.test(content || '')) {
      /* no markup to keep: line-per-div so newlines survive */
      this.page.innerHTML = (content || '').split('\n').map(l => `<div>${esc(l) || '<br>'}</div>`).join('');
      if (!this.page.children.length) this.page.innerHTML = '<div><br></div>';
    } else {
      this.page.innerHTML = content;
    }
  }
  loadPath(path) {
    let node;
    try { node = fs.get(path); } catch { node = null; }
    if (!node) { notify('TextEdit', 'The file could not be opened.'); this.path = null; return; }
    this.setContent(node.content || '', extOf(path) === 'txt');
    this.plain = extOf(path) === 'txt';
    this.win.node.classList.toggle('te-plain', this.plain);
    this.dirty = false;
    rememberRecent(path);
  }
  record() {
    return {
      path: this.path,
      draft: this.path ? null : this.content(),
      plain: this.plain,
      dirty: this.dirty,
    };
  }
  persistRecord() {
    saveWindow({
      app: 'textedit', key: this.win.key,
      rect: { ...this.win.rect },
      state: this.win.state === 'full' ? 'normal' : this.win.state,
      space: this.win.space || 'd1',
      data: this.record(),
    });
  }
  markDirty() {
    this.dirty = true;
    this.updateTitle();
    /* a saved file follows the page; a draft is kept in the window record */
    clearTimeout(this._autoT);
    this._autoT = setTimeout(() => this.autosave(), 700);
  }
  autosave() {
    if (this.path) {
      try {
        fs.writeFile(this.path, this.content());
        this.dirty = false;
        this.updateTitle();
      } catch { this.path = null; }
    }
    this.persistRecord();
  }
  flush() {
    clearTimeout(this._autoT);
    if (this.path && this.dirty) { try { fs.writeFile(this.path, this.content()); } catch { /* file is gone */ } }
    saveNow();
  }
  updateTitle() {
    this.win.setTitle(baseName(this.path || (this.plain ? 'Untitled.txt' : 'Untitled.rtf')) + (this.dirty ? ' — Edited' : ''));
    this.win.node.classList.toggle('dirty-doc', this.dirty);
  }

  /* ── the format bar ───────────────────────────────────────────────── */
  buildFormatBar() {
    this.fontSel = el('select.te-sel', { title: 'Font family' },
      ...FONTS.map(f => el('option', { text: f.name, value: f.css })));
    this.fontSel.addEventListener('change', () => this.cmd('fontName', this.fontSel.value));
    this.sizeField = el('input.te-size', { value: '13', title: 'Font size' });
    this.sizeField.addEventListener('change', () => this.cmd('fontSize', this.sizeField.value));
    const stepper = (dir, label) => el('button.tb-btn.te-step', { text: label, title: dir > 0 ? 'Bigger (⌘+)' : 'Smaller (⌘-)', onclick: () => this.bumpSize(dir) });
    const btn = (label, cmd, title) => el('button.tb-btn.te-b' + (label.length === 1 ? '.' + ({ B: 'b', I: 'i', U: 'u', S: 's' }[label] || '') : ''), {
      text: label, title,
      onmousedown: e => e.preventDefault(),
      onclick: () => this.cmd(cmd),
    });
    this.boldB = btn('B', 'bold', 'Bold (⌘B)');
    this.italB = btn('I', 'italic', 'Italic (⌘I)');
    this.undB = btn('U', 'underline', 'Underline (⌘U)');
    this.strkB = btn('S', 'strikeThrough', 'Strikethrough');
    this.listB = btn('• List', 'insertUnorderedList', 'Bulleted list');
    this.colorBtn = el('button.te-well.text-well', { title: 'Text color', onclick: e => this.colorPop(e.currentTarget, 'foreColor') });
    this.hiliteBtn = el('button.te-well.hi-well', { title: 'Highlight color', onclick: e => this.colorPop(e.currentTarget, 'hiliteColor') });
    return el('div.te-format', null,
      this.fontSel, this.sizeField, stepper(-1, '−'), stepper(1, '+'),
      el('span.te-sep'),
      this.boldB, this.italB, this.undB, this.strkB,
      el('span.te-sep'),
      this.listB, this.colorBtn, this.hiliteBtn);
  }
  syncFormat() {
    if (this.plain) return;
    const q = cmd => { try { return document.queryCommandState(cmd); } catch { return false; } };
    this.boldB.classList.toggle('on', q('bold'));
    this.italB.classList.toggle('on', q('italic'));
    this.undB.classList.toggle('on', q('underline'));
    this.strkB.classList.toggle('on', q('strikeThrough'));
    try {
      const f = document.queryCommandValue('fontName');
      const hit = FONTS.find(x => f && x.css.toLowerCase().includes(f.replace(/['"]/g, '').split(',')[0].toLowerCase()));
      if (hit) this.fontSel.value = hit.css;
      /* browsers answer fontSize in 1-7 units; read the real px size instead */
      const host = getSelection().anchorNode?.parentElement;
      if (host) this.sizeField.value = Math.round(parseFloat(getComputedStyle(host).fontSize) || 13);
    } catch { /* no selection yet */ }
  }
  cmd(c, v) {
    if (this.plain && !['undo', 'redo', 'selectAll', 'cut', 'copy', 'paste'].includes(c)) return;
    this.page.focus();
    document.execCommand(c, false, v);
    this.markDirty();
    this.syncFormat();
  }
  format(c, v) { this.cmd(c, v); }
  saveSoon() {
    this.dirty = true;
    clearTimeout(this._autoT);
    this._autoT = setTimeout(() => this.autosave(), 400);
  }
  bumpSize(dir) {
    const cur = parseInt(this.sizeField.value, 10) || 13;
    const next = dir > 0 ? SIZES.find(s => s > cur) : [...SIZES].reverse().find(s => s < cur);
    this.sizeField.value = String(next ?? (dir > 0 ? 64 : 9));
    const s = getSelection();
    if (s.rangeCount && this.page.contains(s.anchorNode) && !s.isCollapsed) {
      /* wrap the selection so the size is a style, not a browser font size */
      const r = s.getRangeAt(0);
      const span = el('span', { style: { fontSize: this.sizeField.value + 'px' } });
      try { r.surroundContents(span); } catch { document.execCommand('fontSize', false, '7'); }
    } else {
      this.page.style.fontSize = this.sizeField.value + 'px';
    }
    this.markDirty();
  }
  zoom(dir) {
    this.zoomPct = Math.min(200, Math.max(60, this.zoomPct + dir * 10));
    this.page.style.fontSize = 13 * this.zoomPct / 100 + 'px';
  }
  colorPop(anchor, command) {
    this.closePop();
    const pop = el('div.te-pop', null,
      COLORS.map(c => el('button.te-swatch', {
        style: { background: c },
        title: c,
        onmousedown: e => e.preventDefault(),
        onclick: () => { this.cmd(command, c); this.closePop(); },
      })));
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(6, r.left - 60) + 'px';
    pop.style.top = r.bottom + 6 + 'px';
    document.getElementById('overlays').append(pop);
    this._pop = pop;
    setTimeout(() => {
      this._popClose = e => { if (!pop.contains(e.target)) this.closePop(); };
      document.addEventListener('pointerdown', this._popClose, true);
    }, 0);
  }
  closePop() {
    this._pop?.remove();
    this._pop = null;
    if (this._popClose) { document.removeEventListener('pointerdown', this._popClose, true); this._popClose = null; }
  }
  fontPanel() { this.formatBar.querySelector('.te-sel')?.focus(); }

  /* ── plain / rich ─────────────────────────────────────────────────── */
  askMakePlain() {
    this.confirmSheet('Make Plain Text',
      'Converting this document to plain text will lose all formatting. Fonts, sizes, styles and colors will be removed.',
      [{ label: 'Cancel' }, { label: 'Make Plain Text', primary: true, action: () => this.setPlain(true) }]);
  }
  setPlain(plain) {
    this.plain = plain;
    if (plain) this.setContent(this.text, true);
    this.win.node.classList.toggle('te-plain', plain);
    this.markDirty();
    this.updateTitle();
  }
  duplicate() {
    openTextEdit({ fresh: true, draft: this.content(), plain: this.plain, dirty: true });
  }

  /* ── find bar ─────────────────────────────────────────────────────── */
  buildFindBar() {
    const bar = el('div.te-find', { hidden: true });
    this.findInput = el('input.find-f', { placeholder: 'Find', type: 'search' });
    this.findCount = el('span.find-count');
    this.replInput = el('input.find-f', { placeholder: 'Replace' });
    const prev = el('button.tb-btn', { text: '‹', title: 'Previous (⇧⌘G)', onclick: () => this.findNext(true) });
    const next = el('button.tb-btn', { text: '›', title: 'Next (⌘G)', onclick: () => this.findNext() });
    const rep = el('button.tb-btn', { text: 'Replace', onclick: () => this.replace() });
    const repAll = el('button.tb-btn', { text: 'All', title: 'Replace all', onclick: () => this.replaceAll() });
    const done = el('button.tb-btn.find-x', { html: glyph('x'), title: 'Done', onclick: () => this.hideFind() });
    bar.append(
      el('span.find-ic', { html: glyph('search') }),
      this.findInput, this.findCount, prev, next,
      el('span.te-sep'), this.replInput, rep, repAll, done);
    this.findInput.addEventListener('input', () => this.findNow());
    this.findInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') this.findNext(e.shiftKey);
      if (e.key === 'Escape') this.hideFind();
    });
    this.replInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') this.replace();
      if (e.key === 'Escape') this.hideFind();
    });
    return bar;
  }
  showFind() {
    this.findOn = true;
    this.findBar.hidden = false;
    const sel = String(getSelection());
    if (sel && sel.length < 80) this.findInput.value = sel;
    this.findInput.focus();
    this.findInput.select();
    this.findNow();
  }
  hideFind() {
    this.findOn = false;
    this.findBar.hidden = true;
    this.clearHL();
    this.page.focus();
  }
  matchRanges(q) {
    const out = [];
    if (!q) return out;
    const lc = q.toLowerCase();
    const walker = document.createTreeWalker(this.page, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.nodeValue.toLowerCase();
      let i = 0;
      while ((i = t.indexOf(lc, i)) >= 0) {
        const r = new Range();
        r.setStart(node, i); r.setEnd(node, i + q.length);
        out.push(r);
        i += q.length;
      }
    }
    return out;
  }
  findNow() {
    const q = this.findInput.value;
    const ranges = this.matchRanges(q);
    this.findCount.textContent = q ? `${ranges.length} ${ranges.length === 1 ? 'match' : 'matches'}` : '';
    if (window.CSS?.highlights) CSS.highlights.set('te-find', new Highlight(...ranges));
    /* typing only counts + highlights — jumping to a match would pull DOM
       focus out of the field and dump the rest of the query into the doc */
  }
  clearHL() { if (window.CSS?.highlights) CSS.highlights.delete('te-find'); }
  findNext(back = false) {
    const q = this.findInput.value;
    if (!q) { this.showFind(); return; }
    const ok = window.find(q, false, back, true, false, true, false);
    if (!ok) notify('TextEdit', `“${q}” not found`, { timeout: 1600 });
  }
  replace() {
    const q = this.findInput.value;
    const r = this.replInput.value;
    if (!q) return;
    const sel = String(getSelection());
    if (sel.toLowerCase() === q.toLowerCase()) {
      document.execCommand('insertText', false, r);
    } else {
      this.findNext();
    }
    this.findNow();
    this.markDirty();
  }
  replaceAll() {
    const q = this.findInput.value;
    const r = this.replInput.value;
    if (!q) return;
    const ranges = this.matchRanges(q);
    for (let i = ranges.length - 1; i >= 0; i--) {
      const rg = ranges[i];
      rg.deleteContents();
      rg.insertNode(document.createTextNode(r));
    }
    this.findNow();
    this.markDirty();
  }

  /* ── sheets ───────────────────────────────────────────────────────── */
  sheet(build) {
    this.closeSheet();
    const wrap = el('div.sheet-veil');
    const panel = el('div.save-sheet');
    const api = {
      wrap, panel,
      close: () => {
        wrap.classList.remove('in');
        panel.classList.remove('in');
        setTimeout(() => wrap.remove(), 220);
        if (this._sheet === api) this._sheet = null;
        this._closing = false;
      },
    };
    build(panel, api);
    wrap.append(panel);
    this.win.body.append(wrap);
    requestAnimationFrame(() => { wrap.classList.add('in'); panel.classList.add('in'); });
    this._sheet = api;
    return api;
  }
  closeSheet() {
    this._sheet?.close();
    this._sheet = null;
    this._closing = false;
  }

  defaultName() { return this.plain ? 'Untitled.txt' : 'Untitled.rtf'; }

  saveSheet() {
    const fmt = this.plain ? 'txt' : 'rtf';
    this.sheetFormat = fmt;
    this.sheetWhere = this.path ? this.path.slice(0, this.path.lastIndexOf('/')) : null;
    const self = this;

    this.sheet((panel, api) => {
      this.nameField = el('input.te-name', { value: this.path ? baseName(this.path) : this.defaultName(), spellcheck: 'false' });
      const whereSel = el('select.ss-where', null,
        ...WHERE_POP.map(p => el('option', { text: p.name, value: p.name })),
        el('option', { text: 'Other…', value: '__other' }));
      /* preselect the folder the file already lives in, else Documents */
      const curDir = this.sheetWhere || fs.HOME + '/Documents';
      const curPlace = WHERE_POP.find(p => placePath(p.path) === curDir);
      whereSel.value = curPlace ? curPlace.name : '__other';
      this.sheetWhere = curPlace ? curDir : curDir;

      const fmtSel = el('select.ss-fmt', null,
        el('option', { text: 'Rich Text Document', value: 'rtf' }),
        el('option', { text: 'Plain Text', value: 'txt' }));
      fmtSel.value = fmt;
      if (this.plain) fmtSel.disabled = true;
      fmtSel.addEventListener('change', () => {
        this.sheetFormat = fmtSel.value;
        /* keep the extension honest when the format flips */
        this.nameField.value = this.nameField.value.replace(/\.(rtf|txt)$/i, '') + '.' + this.sheetFormat;
      });

      const browser = el('div.ss-body', { hidden: true });
      const side = el('div.ss-side');
      const list = el('div.ss-list.scroll');
      browser.append(side, list);
      let dir = this.sheetWhere || fs.HOME + '/Documents';
      const renderSide = () => {
        side.replaceChildren(...PLACES.map(p => el('button.ss-side-item' + (placePath(p.path) === dir ? '.on' : ''), {
          onclick: () => { dir = placePath(p.path) || dir; self.sheetWhere = dir; whereSel.value = '__other'; renderSide(); renderList(); },
        }, el('span.n-ico', { html: glyph('folderSmall') }), p.name)));
      };
      const renderList = () => {
        const kids = dir ? fs.children(dir) : [];
        list.replaceChildren(...kids.filter(n => n.type === 'dir' || isTextFile(n)).map(n =>
          el('button.ss-row', {
            onclick: () => { if (n.type === 'dir') { dir = fs.pathOf(n); renderSide(); renderList(); } else self.nameField.value = n.name; },
            ondblclick: () => { if (n.type !== 'dir') self.nameField.value = n.name; },
          },
            el('span.n-ico', { html: n.type === 'dir' ? glyph('folderSmall') : glyph('doc') }),
            el('span.truncate', { text: n.name }))));
      };
      renderSide();
      renderList();
      whereSel.addEventListener('change', () => {
        if (whereSel.value === '__other') { browser.hidden = false; panel.classList.add('open'); return; }
        const hit = WHERE_POP.find(p => p.name === whereSel.value);
        if (hit) { dir = placePath(hit.path); this.sheetWhere = dir; renderSide(); renderList(); }
      });

      const foot = el('div.ss-foot', null,
        el('button.btn', { text: 'Cancel', onclick: () => api.close() }),
        el('button.btn.primary', { text: 'Save', onclick: () => commit() }));
      panel.append(
        el('div.ss-line', null, el('label', { text: 'Save As:' }), this.nameField),
        el('div.ss-line', null, el('label', { text: 'Where:' }), whereSel,
          el('button.tb-btn.ss-chev', { html: glyph('chevD'), title: 'Show more places', onclick: () => { browser.hidden = !browser.hidden; panel.classList.toggle('open', !browser.hidden); renderList(); } })),
        el('div.ss-line', null, el('label', { text: 'File Format:' }), fmtSel),
        browser,
        foot);
      panel.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') api.close();
        else if (e.key === 'Enter' && e.target.tagName !== 'SELECT') commit();
      });
      const commit = () => {
        let base = self.nameField.value.trim() || self.defaultName();
        const typed = base.match(/\.(rtf|txt)$/i);
        let f = self.sheetFormat;
        if (typed) f = typed[1].toLowerCase(); else base += '.' + f;
        const target = self.sheetWhere || dir || fs.HOME + '/Documents';
        const path = target + '/' + base;
        try {
          self.commit(path, f);
          api.close();
        } catch (err) { notify('TextEdit', String(err.message || err)); }
      };
    });
    setTimeout(() => { this.nameField?.focus(); this.nameField?.select(); }, 60);
  }
  commit(path, fmt) {
    this.plain = fmt === 'txt';
    this.win.node.classList.toggle('te-plain', this.plain);
    const content = this.content();
    const dir = path.slice(0, path.lastIndexOf('/'));
    const name = baseName(path);
    if (fs.get(path)) fs.writeFile(path, content);
    else fs.createFile(dir, name, content, 'txt');
    this.path = path;
    this.dirty = false;
    this.sheetWhere = dir;
    rememberRecent(path);
    this.updateTitle();
    this.persistRecord();
    notify('TextEdit', `Saved “${name}” to ${dir.split('/').pop() || dir}`);
    if (this._closing) { this._closing = false; setTimeout(() => this.win.close(), 260); }
  }

  openSheet() {
    this.sheet((panel, api) => {
      panel.classList.add('open');
      const side = el('div.ss-side');
      const list = el('div.ss-list.scroll');
      let dir = fs.HOME + '/Documents';
      let picked = null;
      const pick = () => {
        if (!picked || picked.type === 'dir') return;
        const path = fs.pathOf(picked);
        api.close();
        openTextEdit({ path });
      };
      const renderSide = () => {
        side.replaceChildren(...PLACES.map(p => el('button.ss-side-item' + (placePath(p.path) === dir ? '.on' : ''), {
          onclick: () => { dir = placePath(p.path) || dir; renderSide(); renderList(); },
        }, el('span.n-ico', { html: glyph('folderSmall') }), p.name)));
      };
      const renderList = () => {
        picked = null;
        const kids = dir ? fs.children(dir) : [];
        list.replaceChildren(...kids.filter(n => n.type === 'dir' || isTextFile(n)).map(n => {
          const row = el('button.ss-row', {
            onclick: () => {
              if (n.type === 'dir') { dir = fs.pathOf(n); renderSide(); renderList(); return; }
              picked = n;
              list.querySelectorAll('.ss-row.on').forEach(r => r.classList.remove('on'));
              row.classList.add('on');
            },
            ondblclick: () => { picked = n; pick(); },
          },
            el('span.n-ico', { html: n.type === 'dir' ? glyph('folderSmall') : glyph('doc') }),
            el('span.truncate', { text: n.name }),
            n.type === 'dir' ? null : el('span.ss-meta', { text: fmtSize((n.content || '').length) }));
          return row;
        }));
      };
      renderSide();
      renderList();
      panel.append(
        el('div.ss-line', null, el('label.sheet-h', { text: 'Open' })),
        el('div.ss-body.open-always', null, side, list),
        el('div.ss-foot', null,
          el('button.btn', { text: 'Cancel', onclick: () => api.close() }),
          el('button.btn.primary', { text: 'Open', onclick: pick })));
      panel.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') api.close();
        if (e.key === 'Enter') pick();
      });
    });
  }

  confirmSheet(title, body, buttons) {
    this.sheet((panel, api) => {
      panel.classList.add('mini');
      panel.append(
        el('h3', { text: title }),
        body ? el('p.sheet-sub', { text: body }) : null,
        el('div.row', null,
          ...buttons.map(b => el('button.btn' + (b.primary ? '.primary' : b.danger ? '.danger-btn' : ''), {
            text: b.label,
            onclick: () => { api.close(); b.action?.(); },
          }))),
      );
      panel.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') { api.close(); return; }
        if (e.key === 'Enter') {
          const p = buttons.find(b => b.primary);
          if (p) { api.close(); p.action?.(); }
        }
      });
      setTimeout(() => panel.querySelector('.btn.primary')?.focus(), 60);
    });
  }

  /* ── save / close ─────────────────────────────────────────────────── */
  save() {
    if (!this.path) { this.saveSheet(); return; }
    try {
      fs.writeFile(this.path, this.content());
      this.dirty = false;
      this.updateTitle();
      this.persistRecord();
      notify('TextEdit', `Saved “${baseName(this.path)}”`);
    } catch (err) {
      notify('TextEdit', 'The file could not be saved.');
      this.path = null;
      this.saveSheet();
    }
  }
  requestClose() {
    if (!this.dirty) { this.win.close(); return; }
    const isNew = !this.path;
    const name = baseName(this.path || this.defaultName());
    this.confirmSheet(
      isNew ? 'Do you want to keep this new document?' : `Do you want to keep the changes to “${name}”?`,
      isNew ? 'If you don’t save, your changes will be lost.' : 'Your changes will be lost if you don’t save them.',
      [
        { label: 'Cancel' },
        { label: 'Don’t Save', danger: true, action: () => { this.dirty = false; this.win.close(); } },
        { label: 'Save…', primary: true, action: () => {
          if (isNew) {
            /* the save sheet takes over; when it commits, the window closes */
            this._closing = true;
            this.saveSheet();
          } else { this.save(); if (!this.dirty) this.win.close(); }
        } },
      ]);
  }
}

window.addEventListener('beforeunload', () => { wm.byApp('textedit').forEach(w => w._te?.flush()); });
window.addEventListener('pagehide', () => { wm.byApp('textedit').forEach(w => w._te?.flush()); });

export default meta;
