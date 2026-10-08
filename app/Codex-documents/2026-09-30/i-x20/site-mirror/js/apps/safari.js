// Safari: tab bar, unified address field with suggestions, Favorites start page,
// built-in articles, real URLs in an iframe, bookmarks, history and downloads.
import { el, esc, uid, baseName, fmtNoteDate, on } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { state, save } from '../core/store.js';
import { contextMenu } from '../shell/menus.js';
import { notify } from '../shell/notify.js';
import * as fs from '../core/fs.js';
import { launch } from '../core/os.js';

const meta = {
  id: 'safari', name: 'Safari', icon: 'safari', dock: true,
  menus: () => activeMenus(),
  settingsPane: 'privacy',
  newWindow: () => openSafari({ freshWindow: true }),
  launch(opts = {}) { return openSafari(opts); },
};

/* hand-drawn favicons: each site gets its own mark, drawn the way it looks */
const ico = (body, bg = '#fff') =>
  `<svg viewBox="0 0 32 32" style="width:100%;height:100%;display:block"><rect width="32" height="32" rx="7" fill="${bg}"/>${body}</svg>`;
const favLetter = (ch, bg, fg = '#fff') =>
  ico(`<text x="16" y="22.5" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="19" font-weight="600" fill="${fg}">${ch}</text>`, bg);

/* every favorite must really frame; a tile that only shows the browser's
   broken-page glyph is worse than no tile at all */
const FAVORITES = [
  { title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page', fav: ico(`<text x="16" y="22" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="19" fill="#333">W</text>`) },
  { title: 'Space Morceau', url: 'https://space.morceau.party', fav: ico(`<rect width="32" height="32" rx="7" fill="#0b0d1a"/><circle cx="9" cy="9" r="1.3" fill="#fff"/><circle cx="24" cy="6" r="1" fill="#fff"/><circle cx="27" cy="20" r="1.2" fill="#fff"/><circle cx="6" cy="24" r="1" fill="#fff"/><circle cx="18" cy="16" r="5" fill="#e8a33d"/><path d="M9 16a9 9 0 0 0 18 0 9 9 0 0 1-18 0z" fill="#c97f1f"/>`) },
  { title: 'Google', url: 'https://www.google.com/webhp?igu=1', fav: ico(`<text x="16" y="22.5" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="500"><tspan fill="#4285f4">G</tspan></text>`) },
  { title: 'OpenStreetMap', url: 'https://www.openstreetmap.org/export/embed.html', fav: ico(`<rect width="32" height="32" rx="7" fill="#c4e6a8"/><path d="M0 20c8-4 14 4 22 0s10-6 10-6v18H0z" fill="#8ecb6a"/><path d="M0 12l32 8" stroke="#fff" stroke-width="4"/><path d="M22 8a6 6 0 0 0-6 6c0 5 6 10 6 10s6-5 6-10a6 6 0 0 0-6-6z" fill="#e2574c"/><circle cx="22" cy="14" r="2.4" fill="#fff"/>`) },
  { title: 'Internet Archive', url: 'https://archive.org', fav: ico(`<rect x="6" y="10" width="20" height="3" fill="#333"/><rect x="7" y="15" width="3" height="11" fill="#333"/><rect x="12" y="15" width="3" height="11" fill="#333"/><rect x="17" y="15" width="3" height="11" fill="#333"/><rect x="22" y="15" width="3" height="11" fill="#333"/><rect x="5" y="26" width="22" height="2.4" fill="#333"/>`) },
  { title: 'Gutenberg', url: 'https://www.gutenberg.org', fav: ico(`<path d="M8 6h13a3 3 0 0 1 3 3v17H11a3 3 0 0 0-3 3z" fill="#5b3d8f"/><path d="M8 6v20a3 3 0 0 1 3-3h13" fill="none"/><path d="M11 11h9M11 15h9" stroke="#f5e9c9" stroke-width="1.8"/><rect x="8" y="24" width="16" height="3" fill="#3d2666"/>`) },
  { title: 'NPR Text', url: 'https://text.npr.org', fav: favLetter('npr', '#222', '#fff') },
  { title: 'info.cern.ch', url: 'http://info.cern.ch', fav: favLetter('C', '#0a6cff') },
  { title: 'Sequoia', url: 'mac://welcome', fav: ico(`<rect width="32" height="32" rx="7" fill="#0a84ff"/><path d="M11 22V10h2.6l3.2 7 3.2-7H23v12h-2.4v-7.2L17.8 22h-2.2l-2.2-7.2V22Z" fill="#fff"/>`) },
  { title: 'Shortcuts', url: 'mac://shortcuts', fav: ico(`<rect width="32" height="32" rx="7" fill="#30d158"/><path d="M16 9.5 18 14l4.5.3-3.5 3 1.1 4.4-4.1-2.7-4.1 2.7L13 17.3l-3.5-3L14 14Z" fill="#fff"/>`) },
];

/* hosts that refuse to render inside a frame (X-Frame-Options / CSP
   frame-ancestors). Loading one shows the real Safari error page instead of
   the browser's broken-page glyph. Extend when a site turns out to refuse. */
const NO_FRAME = [
  'apple.com', 'icloud.com', 'github.com', 'github.io', 'developer.mozilla.org',
  'bing.com', 'duckduckgo.com', 'cnn.com', 'lite.cnn.com', 'twitter.com', 'x.com',
  'facebook.com', 'instagram.com', 'medium.com', 'notion.so', 'notion.site',
  'discord.com', 'figma.com', 'vercel.com', 'youtube.com', 'netflix.com',
  'linkedin.com', 'reddit.com', 'tiktok.com', 'chatgpt.com', 'openai.com',
  'stackoverflow.com', 'amazon.com', 'microsoft.com', 'login.microsoftonline.com',
  'news.ycombinator.com', 'ycombinator.com',
];
const hostOf = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
const isGoogleFrame = url => /\.google\.com$|^google\.com$/.test(hostOf(url)) && /[?&]igu=1/.test(url);
function blockedHost(url) {
  if (isGoogleFrame(url)) return false;
  const h = hostOf(url).replace(/^www\./, '');
  if (!h) return false;
  if (/\.google\.com$|^google\.com$/.test(h)) return true;      /* incl. /login */
  return NO_FRAME.some(d => h === d || h.endsWith('.' + d));
}

/* text from the address field: a URL when it looks like one, a Google search
   otherwise — the same rule Safari applies */
const looksLikeUrl = text =>
  /^(https?|mac):\/\//i.test(text) ||
  (!/\s/.test(text) && (/^localhost([:/]|$)/i.test(text) || /^[\w-]+(\.[\w-]+)+/.test(text) || text.includes(':')));
const searchUrl = q => 'https://www.google.com/search?igu=1&q=' + encodeURIComponent(q);

const DL_EXTS = /\.(zip|dmg|pkg|pdf|txt|rtf|md|csv|json|xml|epub|gz|tar|mp3|mp4|m4a|wav|mov|jpg|jpeg|png|gif|webp|svg|ics|docx?|xlsx?|pptx?|webloc)([?#].*)?$/i;

/* ── persistent browser state ────────────────────────────────────────
   bookmarks, the reading list, history and recently closed tabs live in
   settings.safari so they survive a reload like real Safari data does */
function store() {
  if (!state.settings.safari) {
    state.settings.safari = {
      bookmarks: FAVORITES.map(f => ({ id: uid('b'), title: f.title, url: f.url, folder: 'Favorites' })),
      reading: [
        { id: uid('r'), title: 'The Design of Everyday Things', url: 'https://en.wikipedia.org/wiki/The_Design_of_Everyday_Things', ts: Date.now() },
      ],
      history: [], closed: [], blocked: 0, blockedHosts: [],
      showBar: true,
    };
    save();
  }
  return state.settings.safari;
}
const S = () => state.settings.safari || store();
const persist = () => save();
function noteHistory(url, title) {
  if (url.startsWith('mac://')) return;
  const s = S();
  s.history.unshift({ url, title, ts: Date.now() });
  if (s.history.length > 400) s.history.length = 400;
  persist();
}
function countBlocked(host) {
  const s = S();
  s.blocked++;
  if (host && !s.blockedHosts.includes(host)) s.blockedHosts.push(host);
  persist();
}
function activeMenus() {
  const wins = wm.byApp('safari').filter(w => w.state !== 'min');
  const win = (wm.focused && wm.focused.app === 'safari' ? wm.focused : null) || wins[0];
  const s = win && win._sf;
  const tab = s?.tab;
  return [
    {
      title: 'File', items: () => [
        { label: 'New Window', key: '⌘N', action: () => openSafari({ freshWindow: true }) },
        { label: 'New Tab', key: '⌘T', action: () => s?.newTab() },
        { type: 'sep' },
        { label: 'Open Location', key: '⌘L', action: () => s?.focusField() },
        { type: 'sep' },
        { label: 'Close Tab', key: '⌘W', action: () => s?.closeTab() },
        { label: 'Close Window', key: '⇧⌘W', action: () => win && wm.close(win) },
      ],
    },
    {
      title: 'Edit', items: () => [
        { label: 'Undo', key: '⌘Z', action: () => document.execCommand('undo') },
        { label: 'Redo', key: '⇧⌘Z', action: () => document.execCommand('redo') },
        { type: 'sep' },
        { label: 'Cut', key: '⌘X', action: () => document.execCommand('cut') },
        { label: 'Copy', key: '⌘C', action: () => document.execCommand('copy') },
        { label: 'Paste', key: '⌘V', action: () => document.execCommand('paste') },
        { label: 'Select All', key: '⌘A', action: () => document.execCommand('selectAll') },
      ],
    },
    {
      title: 'View', items: () => [
        { label: 'Reload Page', key: '⌘R', action: () => s?.reload(), disabled: !tab || tab.mode === 'start' },
        { label: 'Stop Loading', key: '⌘.', action: () => s?.stop(), disabled: !(tab && tab.loading) },
        { type: 'sep' },
        { label: 'Show Bookmarks Bar', key: '⇧⌘B', checked: S().showBar, action: () => s?.toggleBar() },
        { label: 'Show Sidebar', key: '⌃⌘S', action: () => s?.toggleSidebar() },
        { type: 'sep' },
        { label: 'Show All Tabs', key: '⇧⌘\\', action: () => { if (s?.overview) s.hideTabs(); else s?.showTabs(); } },
        { label: 'Show Start Page', action: () => s?.go('mac://start') },
        { type: 'sep' },
        { label: 'Enter Full Screen', key: '⌃⌘F', action: () => win && wm.toggleZoom(win) },
      ],
    },
    {
      title: 'History', items: () => {
        const st = S();
        return [
          { label: 'Show All History', key: '⌘Y', action: () => s?.go('mac://history') },
          { type: 'sep' },
          {
            label: 'Back', key: '⌘[', disabled: !s?.canBack(), action: () => s?.back(),
            sub: s?.canBack() ? () => s.tab.history.slice(0, s.tab.index).map((h, i) =>
              ({ label: trimTitle(h.title || hostOf(h.url)), action: () => s.jumpTo(i) })) : null,
          },
          {
            label: 'Forward', key: '⌘]', disabled: !s?.canFwd(), action: () => s?.forward(),
            sub: s?.canFwd() ? () => s.tab.history.slice(s.tab.index + 1).map((h, i) =>
              ({ label: trimTitle(h.title || hostOf(h.url)), action: () => s.jumpTo(s.tab.index + 1 + i) })) : null,
          },
          { type: 'sep' },
          {
            label: 'Recently Closed', sub: () => st.closed.length
              ? st.closed.slice(0, 10).map(c => ({ label: trimTitle(c.title || hostOf(c.url)), action: () => { s?.reopenClosed(c); } }))
              : [{ label: 'No Recently Closed Tabs', disabled: true }],
          },
          { label: 'Reopen Last Closed Tab', key: '⇧⌘T', disabled: !st.closed.length, action: () => s?.reopenClosed(st.closed[0]) },
          { type: 'sep' },
          { label: 'Clear History…', disabled: !st.history.length, action: () => s?.confirmClearHistory() },
          { type: 'sep' },
          ...st.history.slice(0, 8).map(h => ({ label: trimTitle(h.title || h.url), action: () => s?.go(h.url) })),
        ];
      },
    },
    {
      title: 'Bookmarks', items: () => {
        const marks = S().bookmarks;
        return [
          { label: 'Add Bookmark…', key: '⌘D', action: () => s?.addBookmarkSheet() },
          { label: 'Add to Reading List', key: '⇧⌘D', action: () => s?.addToReadingList() },
          { type: 'sep' },
          { label: 'Show Bookmarks', key: '⌃⌘B', action: () => s?.toggleSidebar('bookmarks') },
          { label: 'Show Reading List', key: '⌃⇧S', action: () => s?.toggleSidebar('reading') },
          { type: 'sep' },
          ...(marks.length ? marks.map(b => ({ label: trimTitle(b.title), action: () => s?.go(b.url) })) : [{ label: 'No Bookmarks', disabled: true }]),
        ];
      },
    },
    {
      title: 'Window', items: () => [
        { label: 'Show Next Tab', key: '⌃⇥', disabled: !s || s.tabs.length < 2, action: () => s?.stepTab(1) },
        { label: 'Show Previous Tab', key: '⇧⌃⇥', disabled: !s || s.tabs.length < 2, action: () => s?.stepTab(-1) },
        { type: 'sep' },
        ...(s ? s.tabs.map((t, i) => ({ label: trimTitle(t.title), checked: i === s.active, action: () => s.selectTab(i) })) : []),
        ...(s && s.tabs.length ? [{ type: 'sep' }] : []),
        { label: 'Minimize', key: '⌘M', action: () => win && wm.minimize(win) },
      ],
    },
  ];
}
const trimTitle = t => (t || '').length > 44 ? t.slice(0, 43) + '…' : (t || 'Untitled');

function openSafari(opts = {}) {
  const existing = wm.byApp('safari').find(w => w.state !== 'min');
  if (existing && !opts.freshWindow) {
    wm.focus(existing);
    if (opts.page) existing._sf?.go('mac://' + opts.page);
    if (opts.url) existing._sf?.go(opts.url);
    return existing;
  }
  return wm.open({
    app: 'safari', key: `win${Date.now().toString(36)}`, title: 'Start Page',
    width: 1040, height: 700, minWidth: 560, minHeight: 380, chromeTitle: false,
    data: { url: opts.url || (opts.page ? 'mac://' + opts.page : 'mac://start') },
    getData: w => ({ url: w._sf?.tabs?.[w._sf.active]?.url }),
    build: win => new Safari(win, opts).mount(),
  });
}

const BUILTIN = {
  'mac://start': { title: 'Start Page' },
  'mac://welcome': { title: 'Welcome to macOS' },
  'mac://shortcuts': { title: 'Keyboard Shortcuts' },
  'mac://history': { title: 'History' },
};

const reloadGlyph = `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.9"/><path d="M13.6 1.6v3h-3"/></svg>`;
const stopGlyph = `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
const downGlyph = `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.4"/><path d="M8 5v5M5.8 8.2 8 10.4l2.2-2.2"/></svg>`;

class Safari {
  constructor(win, opts) {
    this.win = win;
    const start = opts.url || (opts.page ? 'mac://' + opts.page : 'mac://start');
    this.tabs = [this.makeTab(start)];
    this.active = 0;
    this.sugSel = -1;
    this.sugSeq = 0;
    this.editing = false;
    this.sideTab = 'bookmarks';
    this.unsub = [on('settings:change', ({ key }) => {
      if (key === 'wifi' && this.win.node.isConnected) this.render();
    })];
  }
  makeTab(url) {
    return { id: uid('t'), url, title: BUILTIN[url]?.title || titleFromUrl(url), history: [{ url, title: BUILTIN[url]?.title || titleFromUrl(url) }], index: 0, mode: modeFor(url), loading: false, timer: null };
  }
  get tab() { return this.tabs[this.active]; }
  mount() {
    this.win._sf = this;
    const prevClose = this.win.onClose;
    this.win.onClose = w => { prevClose?.(w); this.unsub.forEach(f => f()); };

    this.tabBar = el('div.sf-tabs', {
      onpointerdown: e => this.tabPointerDown(e),
    });
    this.newTabBtn = el('button.sf-newtab', { html: glyph('plus'), title: 'New tab (⌘T)', onclick: () => this.newTab() });

    this.backBtn = el('button.tb-btn', { html: glyph('chevL'), title: 'Back (⌘[)', onclick: () => this.back() });
    this.fwdBtn = el('button.tb-btn', { html: glyph('chevR'), title: 'Forward (⌘])', onclick: () => this.forward() });

    this.urlInput = el('input', {
      placeholder: 'Search or enter website name', spellcheck: 'false', autocomplete: 'off',
      onkeydown: e => this.fieldKey(e),
      oninput: () => this.suggest(),
      onfocus: () => this.beginEdit(),
      onblur: () => setTimeout(() => { if (document.activeElement !== this.urlInput) this.endEdit(); }, 120),
    });
    this.reloadBtn = el('button.sf-field-btn', { html: reloadGlyph, title: 'Reload', tabindex: '-1',
      onclick: e => { e.stopPropagation(); this.tab.loading ? this.stop() : this.reload(); } });
    this.lockIco = el('span.lock', { html: glyph('lock') });
    this.urlBox = el('div.sf-url', {
      onpointerdown: e => { if (e.target === this.urlBox) { e.preventDefault(); this.urlInput.focus(); } },
    }, this.lockIco, this.urlInput, this.reloadBtn);
    this.sugs = el('div.sf-sugs', { style: { display: 'none' } });
    this.progress = el('div.sf-progress');

    this.sideBtn = el('button.tb-btn.sf-side', { html: glyph('list'), title: 'Sidebar (⌃⌘S)', onclick: () => this.toggleSidebar() });
    this.win.tbTools.replaceChildren(el('div.sf-nav', null, this.sideBtn, this.backBtn, this.fwdBtn), this.urlBox, this.sugs, this.progress);
    this.win.tbRight.replaceChildren(
      el('button.tb-btn', { html: glyph('share'), title: 'Share', onclick: e => this.shareMenu(e.currentTarget) }),
      el('button.tb-btn', { html: downGlyph, title: 'Downloads', onclick: e => this.downloadsMenu(e.currentTarget) }),
      el('button.tb-btn', { html: glyph('columns'), title: 'Show All Tabs (⇧⌘\\)', onclick: () => this.showTabs() }),
      el('button.tb-btn', { html: glyph('plus'), title: 'New Tab (⌘T)', onclick: () => this.newTab() }),
    );

    this.sidebar = el('div.sf-sidebar');
    this.bar = el('div.sf-bbar');
    this.view = el('div.sf-view');
    this.win.body.append(el('div.sf-col', null, this.tabBar, this.bar, el('div.sf-body', null, this.sidebar, this.view)));

    this.renderTabs();
    this.renderBar();
    this.renderSidebar();
    this.render();
    /* what the menus do not already claim: Escape closes the tab overview,
       and ⇧⌘\ still works when the physical key reports | instead of \ */
    this.win.onKey = e => {
      if (e.key === 'Escape' && this.overview) { this.hideTabs(); return true; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '\\' || e.key === '|')) { this.overview ? this.hideTabs() : this.showTabs(); return true; }
      return false;
    };
  }

  /* ── the address field ───────────────────────────────────────────── */
  focusField() {
    this.urlInput.focus();
    /* in odd cases (restored windows, headless) focus() may not dispatch the
       focus event — enter edit mode ourselves so suggestions still work */
    if (!this.editing) this.beginEdit();
    this.urlInput.select();
  }
  beginEdit() {
    this.editing = true;
    this.urlBox.classList.add('editing');
    const tab = this.tab;
    this.urlInput.value = /^https?:/.test(tab.url) ? tab.url : '';
    this.urlInput.select();
    /* a click lands the caret after focus; Safari keeps the whole URL selected */
    requestAnimationFrame(() => { if (document.activeElement === this.urlInput && this.editing) this.urlInput.select(); });
    this.suggest();
  }
  endEdit() {
    this.editing = false;
    this.urlBox.classList.remove('editing');
    this.hideSugs();
    this.paintUrl();
  }
  fieldKey(e) {
    e.stopPropagation();
    const rows = [...this.sugs.querySelectorAll('.sf-sug')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      /* -1 is the field itself: Down steps into row 0, Up into the last row */
      this.sugSel += d;
      if (this.sugSel >= rows.length) this.sugSel = -1;
      if (this.sugSel < -1) this.sugSel = rows.length - 1;
      rows.forEach((r, i) => r.classList.toggle('sel', i === this.sugSel));
      return;
    }
    if (e.key === 'Enter') {
      const row = rows[this.sugSel];
      if (row) this.go(row.dataset.url);
      else this.navigateFromInput();
      return;
    }
    if (e.key === 'Escape') {
      if (this.sugs.style.display !== 'none') { this.hideSugs(); this.paintUrl(); }
      else this.urlInput.blur();
    }
  }
  async suggest() {
    const q = this.urlInput.value.trim();
    if ((!this.editing && document.activeElement !== this.urlInput) || !q) { this.hideSugs(); return; }
    const seq = ++this.sugSeq;
    const needle = q.toLowerCase();
    const search = { label: `Search Google for “${q}”`, url: searchUrl(q), icon: glyph('search') };
    const hist = S().history.filter(h => (h.title + ' ' + h.url).toLowerCase().includes(needle)).slice(0, 4)
      .map(h => ({ label: h.title || h.url, url: h.url, icon: glyph('clock') }));
    const favs = S().bookmarks.filter(b => (b.title + ' ' + b.url).toLowerCase().includes(needle)).slice(0, 4)
      .map(b => ({ label: b.title, url: b.url, icon: FAVORITES.find(f => f.url === b.url)?.fav || null }));
    /* local results paint immediately; the Top Hit drops in when it arrives */
    const local = [search];
    if (hist.length) local.push({ head: 'History' }, ...hist);
    if (favs.length) local.push({ head: 'Bookmarks' }, ...favs);
    this.paintSugs(local);
    const wikiRows = await Promise.race([
      fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&search=${encodeURIComponent(q)}&limit=4`)
        .then(r => r.json()).then(d => (d?.[1] || []).map((t, i) => ({ label: t, url: d[3]?.[i] })).filter(w => w.url)).catch(() => []),
      new Promise(res => setTimeout(() => res([]), 1500)),
    ]);
    if (seq !== this.sugSeq || !this.editing || this.urlInput.value.trim() !== q) return;
    const top = wikiRows.filter(w => !local.some(i => i.url === w.url));
    if (!top.length) return;
    this.paintSugs([search, { head: 'Top Hit' }, ...top.map(w => ({ ...w, icon: FAVORITES[0].fav })), ...local.slice(1)]);
  }
  paintSugs(all) {
    const keep = this.sugSel;
    this.sugs.replaceChildren(...all.map(it => it.head
      ? el('div.sf-sug-head', { text: it.head })
      : el('div.sf-sug', {
          dataset: { url: it.url },
          onpointerdown: e => { e.preventDefault(); this.go(it.url); this.urlInput.blur(); },
        },
          it.icon ? el('span.sf-sug-ico', { html: it.icon }) : null,
          el('span.t', { text: it.label }),
          it.url.startsWith('http') ? el('span.u', { text: hostOf(it.url) }) : null)));
    /* refined results keep the highlighted row instead of dropping it */
    const rows = this.sugs.querySelectorAll('.sf-sug');
    if (keep >= 0 && keep < rows.length) rows[keep].classList.add('sel');
    else this.sugSel = -1;
    const r = this.urlBox.getBoundingClientRect(), tr = this.win.titlebar.getBoundingClientRect();
    this.sugs.style.display = '';
    this.sugs.style.left = Math.round(r.left - tr.left) + 'px';
    this.sugs.style.width = Math.round(r.width) + 'px';
    this.sugs.style.top = Math.round(r.bottom - tr.top + 4) + 'px';
  }
  hideSugs() { this.sugs.style.display = 'none'; this.sugSel = -1; }

  navigateFromInput() {
    const raw = this.urlInput.value.trim();
    if (!raw) { this.urlInput.blur(); return; }
    this.urlInput.blur();
    if (/^mac:\/\//i.test(raw)) return this.go(raw);
    if (/^https?:\/\//i.test(raw)) return this.go(raw);
    if (looksLikeUrl(raw)) return this.go('https://' + raw.replace(/^\/+/, ''));
    this.go(searchUrl(raw));
  }

  /* ── tabs ────────────────────────────────────────────────────────── */
  newTab(url = 'mac://start') {
    this.tabs.push(this.makeTab(url));
    this.active = this.tabs.length - 1;
    this.renderTabs(); this.render();
    if (url === 'mac://start') this.focusField();
  }
  closeTab(i = this.active) {
    if (this.tabs.length === 1) { wm.close(this.win); return; }
    const tab = this.tabs[i];
    if (tab && !tab.url.startsWith('mac://')) {
      S().closed.unshift({ url: tab.url, title: tab.title, ts: Date.now() });
      S().closed.length = Math.min(S().closed.length, 15);
      persist();
    }
    clearTimeout(tab.timer);
    this.tabs.splice(i, 1);
    if (this.active >= this.tabs.length) this.active = this.tabs.length - 1;
    else if (i < this.active) this.active--;
    this.renderTabs(); this.render();
  }
  reopenClosed(entry) {
    if (!entry) return;
    const s = S();
    const i = s.closed.indexOf(entry);
    if (i >= 0) { s.closed.splice(i, 1); persist(); }
    this.newTab(entry.url);
  }
  selectTab(i) { this.active = i; this.renderTabs(); this.render(); }
  stepTab(d) { this.selectTab((this.active + d + this.tabs.length) % this.tabs.length); }
  tabPointerDown(e) {
    const tabEl = e.target.closest('.sf-tab');
    if (!tabEl || e.target.closest('.x')) return;
    const from = [...this.tabBar.querySelectorAll('.sf-tab')].indexOf(tabEl);
    if (from < 0) return;
    const sx = e.clientX;
    let dragging = false, to = from;
    const move = ev => {
      if (!dragging && Math.abs(ev.clientX - sx) < 6) return;
      dragging = true;
      this._dragged = true;
      tabEl.classList.add('drag');
      tabEl.style.transform = `translateX(${ev.clientX - sx}px)`;
      const tabs = [...this.tabBar.querySelectorAll('.sf-tab')];
      to = tabs.length - 1;
      for (let k = 0; k < tabs.length; k++) {
        const r = tabs[k].getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) { to = k; break; }
      }
    };
    const drop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      if (!dragging) return;
      if (to !== from) {
        const [moved] = this.tabs.splice(from, 1);
        this.tabs.splice(to, 0, moved);
        if (this.active === from) this.active = to;
        else if (this.active > from && this.active <= to) this.active--;
        else if (this.active < from && this.active >= to) this.active++;
      }
      this.renderTabs();
      /* the click that follows pointerup must not re-read a stale index */
      setTimeout(() => this._dragged = false, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
  }
  renderTabs() {
    this.tabBar.classList.toggle('solo', this.tabs.length < 2);
    const nodes = this.tabs.map((tab, i) => el('div.sf-tab' + (i === this.active ? '.on' : ''), {
      onclick: () => { if (!this._dragged) this.selectTab(i); },
      oncontextmenu: e => {
        e.preventDefault();
        contextMenu([
          { label: 'Reload Tab', action: () => { this.selectTab(i); this.reload(); } },
          { label: 'Duplicate Tab', action: () => this.newTab(tab.url) },
          { type: 'sep' },
          { label: 'Close Tab', action: () => this.closeTab(i) },
          { label: 'Close Other Tabs', disabled: this.tabs.length < 2, action: () => { this.tabs.forEach(t => clearTimeout(t.timer)); this.tabs = [tab]; this.active = 0; this.renderTabs(); this.render(); } },
        ], e.clientX, e.clientY);
      },
    },
      el('span.fav', { html: favFor(tab.url) }),
      el('span.t.truncate', { text: tab.title }),
      el('span.x', { html: '×', title: 'Close Tab', onclick: e => { e.stopPropagation(); this.closeTab(i); } }),
    ));
    this.tabBar.replaceChildren(...nodes, this.newTabBtn);
  }

  /* ── navigation ──────────────────────────────────────────────────── */
  canBack() { return this.tab.index > 0; }
  canFwd() { return this.tab.index < this.tab.history.length - 1; }
  setEntry(url, title) {
    const tab = this.tab;
    tab.url = url; tab.title = title || BUILTIN[url]?.title || titleFromUrl(url); tab.mode = modeFor(url);
    const cur = tab.history[tab.index];
    if (!cur || cur.url !== url) {
      tab.history = tab.history.slice(0, tab.index + 1);
      tab.history.push({ url, title: tab.title });
      tab.index = tab.history.length - 1;
      noteHistory(url, tab.title);
    } else if (title) cur.title = title;
  }
  go(url) {
    let clean = normalize(url);
    if (!/^[a-z]+:\/\//i.test(clean) && BUILTIN['mac://' + clean]) clean = 'mac://' + clean;
    try {
      const u = new URL(clean);
      if (/^https?:$/.test(u.protocol) && DL_EXTS.test(u.pathname + u.search)) {
        this.download(clean);
        return;
      }
    } catch { /* not a parseable URL; modeFor sorts it out */ }
    this.setEntry(clean);
    this.hideSugs();
    this.renderTabs(); this.render();
  }
  jumpTo(i) {
    const t = this.tab;
    if (i < 0 || i >= t.history.length || i === t.index) return;
    t.index = i;
    const h = t.history[i];
    t.url = h.url; t.title = h.title || BUILTIN[h.url]?.title || titleFromUrl(h.url); t.mode = modeFor(h.url);
    /* Safari logs a revisit as a fresh history entry too */
    noteHistory(h.url, t.title);
    this.renderTabs(); this.render();
  }
  back() { this.jumpTo(this.tab.index - 1); }
  forward() { this.jumpTo(this.tab.index + 1); }
  reload() {
    const tab = this.tab;
    if (tab.mode === 'error' || tab.mode === 'offline') tab.mode = modeFor(tab.url);
    if (tab.mode === 'web' && tab.frame && tab.frame.isConnected) {
      /* re-request the same URL in the live frame, the way Reload does */
      clearTimeout(tab.timer);
      this.setLoading(true);
      try { tab.frame.src = tab.url; } catch { /* rare */ }
      this.armTimer(tab);
      return;
    }
    this.render();
  }
  armTimer(tab) {
    clearTimeout(tab.timer);
    tab.timer = setTimeout(() => {
      if (!tab.loading) return;
      tab.loading = false;
      tab.frame = null; tab.frameSrc = null;
      countBlocked(hostOf(tab.url));
      tab.mode = 'error';
      if (tab === this.tab) this.render();
    }, 4200);
  }
  stop() {
    const tab = this.tab;
    clearTimeout(tab.timer);
    tab.loading = false;
    try { tab.frame?.contentWindow?.stop?.(); } catch { /* cross-origin */ }
    this.setLoading(false);
  }
  setLoading(onOff) {
    this.tab.loading = onOff;
    this.reloadBtn.innerHTML = onOff ? stopGlyph : reloadGlyph;
    this.reloadBtn.title = onOff ? 'Stop loading' : 'Reload';
    this.progress.classList.remove('done');
    if (onOff) {
      this.progress.style.transition = 'none';
      this.progress.style.width = '0%';
      void this.progress.offsetWidth;
      this.progress.style.transition = '';
      this.progress.style.width = '72%';
      clearTimeout(this._progT);
      this._progT = setTimeout(() => { if (this.tab.loading) this.progress.style.width = '88%'; }, 900);
    } else {
      this.progress.style.width = '100%';
      clearTimeout(this._progT);
      this._progT = setTimeout(() => this.progress.classList.add('done'), 240);
    }
  }

  paintUrl() {
    const tab = this.tab;
    const web = tab.mode === 'web' || tab.mode === 'error' || tab.mode === 'offline';
    const start = !web;
    if (!this.editing) this.urlInput.value = web ? hostOf(tab.url) : '';
    this.urlBox.classList.toggle('empty', start);
    this.lockIco.style.display = web && tab.url.startsWith('https') ? '' : 'none';
    this.reloadBtn.style.display = web ? '' : 'none';
    this.backBtn.disabled = !this.canBack();
    this.fwdBtn.disabled = !this.canFwd();
  }

  render() {
    const tab = this.tab;
    this.overview = null;
    this.paintUrl();
    this.win.setTitle(tab.title || 'Start Page');
    if (tab.mode === 'web' && state.settings.wifi === false) tab.mode = 'offline';
    if (tab.mode === 'offline' && state.settings.wifi !== false) tab.mode = 'web';
    if (tab.mode !== 'web') this.setLoading(false);
    if (tab.mode === 'start') this.view.replaceChildren(startPage(q => this.go(q)));
    else if (tab.mode === 'welcome') this.view.replaceChildren(articlePage('Welcome to macOS', `
      <p>Welcome to your Mac. Here are a few things worth trying first.</p>
      <h2>Get organised</h2>
      <p>Open <strong>Finder</strong> and choose <strong>File &rsaquo; New Finder Window</strong>. Drag a file from one folder to another, or press <strong>Space</strong> to Quick Look it without opening anything.</p>
      <h2>Get typing</h2>
      <p><strong>TextEdit</strong> opens a blank page. Use <strong>Format &rsaquo; Bold</strong> to make something heavy, then save it to your Desktop.</p>
      <h2>Find anything, fast</h2>
      <p>Press <strong>Command-Space</strong> for Spotlight. Type a file name, a note, or a sum like <code>12*8</code>, and it will do the arithmetic for you.</p>
    `, 'Sequoia'));
    else if (tab.mode === 'shortcuts') this.view.replaceChildren(articlePage('Keyboard Shortcuts', shortcutTable()));
    else if (tab.mode === 'history') this.view.replaceChildren(historyPage(url => this.go(url), () => this.confirmClearHistory()));
    else if (tab.mode === 'offline') this.view.replaceChildren(offlinePage(() => this.reload()));
    else if (tab.mode === 'error') this.view.replaceChildren(errorPage(tab, () => { tab.mode = 'web'; this.render(); }));
    else this.loadWeb(tab);
  }

  loadWeb(tab) {
    if (state.settings.wifi === false) { tab.mode = 'offline'; this.render(); return; }
    if (blockedHost(tab.url)) {
      tab.mode = 'error';
      countBlocked(hostOf(tab.url));
      this.render();
      return;
    }
    /* switching back to a tab re-attaches its live frame, not a fresh load */
    if (tab.frame && tab.frameSrc === tab.url) {
      this.view.replaceChildren(tab.frame);
      this.setLoading(tab.loading);
      return;
    }
    const frame = el('iframe', {
      src: tab.url,
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups',
      referrerpolicy: 'no-referrer',
      title: tab.title,
    });
    tab.frame = frame;
    tab.frameSrc = tab.url;
    this.setLoading(true);
    frame.addEventListener('load', () => {
      if (tab.frame !== frame) return;         /* a frame we already replaced */
      if (!tab.loading) return;
      clearTimeout(tab.timer);
      /* a refused or dead host lands on Chrome's own error document */
      let refused = false;
      try {
        const doc = frame.contentDocument;
        if (doc && /^chrome-error:/.test(doc.URL || '')) refused = true;
      } catch { /* cross-origin is the healthy case */ }
      tab.loading = false;
      if (tab === this.tab) this.setLoading(false);
      if (refused) {
        countBlocked(hostOf(tab.url));
        tab.frame = null; tab.frameSrc = null;
        tab.mode = 'error';
        if (tab === this.tab) this.render();
      }
    });
    /* a host that never answers gets the same page Safari would draw */
    this.armTimer(tab);
    this.view.replaceChildren(frame);
  }

  /* ── share / downloads ───────────────────────────────────────────── */
  shareMenu(btn) {
    const tab = this.tab;
    const web = tab.mode === 'web';
    const r = btn.getBoundingClientRect();
    contextMenu([
      { label: 'Copy Link', disabled: !web, action: () => copyText(tab.url) },
      { type: 'sep' },
      { label: 'Add Bookmark…', key: '⌘D', action: () => this.addBookmarkSheet() },
      { label: 'Add to Reading List', key: '⇧⌘D', action: () => this.addToReadingList() },
      { type: 'sep' },
      { label: 'Print…', key: '⌘P', disabled: !web, action: () => this.print() },
    ], r.left, r.bottom + 4);
  }
  print() {
    try { this.tab.frame?.contentWindow?.print?.(); return; } catch { /* cross-origin */ }
    try { window.print(); } catch { /* nothing more we can do */ }
  }
  async download(url) {
    const name = decodeURIComponent(baseName(new URL(url).pathname)) || 'download';
    let content = '', kind = 'txt';
    try {
      const r = await fetch(url);
      if (/\.(png|jpe?g|gif|webp|svg|mp3|mp4|m4a|wav|mov|zip|dmg|pkg|gz|tar)$/i.test(name)) {
        const bytes = new Uint8Array(await r.arrayBuffer()).slice(0, 262144);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        content = btoa(bin);
        kind = 'data';
      } else {
        content = (await r.text()).slice(0, 512000);
      }
    } catch { /* keep the file, empty — the download still lands */ }
    try {
      fs.createFile(fs.HOME + '/Downloads', name, content, kind, { from: url });
    } catch (err) { notify('Safari', `Couldn’t save “${name}”.`); }
  }
  downloadsMenu(btn) {
    const files = fs.children(fs.HOME + '/Downloads').filter(n => n.type === 'file')
      .sort((a, b) => b.modified - a.modified).slice(0, 12);
    const r = btn.getBoundingClientRect();
    contextMenu([
      { type: 'title', label: 'Downloads' },
      ...(files.length ? files.map(f => ({
        label: f.name,
        action: () => launch('finder', { path: fs.HOME + '/Downloads' }),
      })) : [{ label: 'No Downloads', disabled: true }]),
      { type: 'sep' },
      { label: 'Show Downloads Folder', action: () => launch('finder', { path: fs.HOME + '/Downloads' }) },
    ], r.right - 240, r.bottom + 4);
  }

  /* ── bookmarks, reading list, history ────────────────────────────── */
  toggleBar() {
    S().showBar = !S().showBar;
    persist();
    this.renderBar();
  }
  renderBar() {
    this.bar.style.display = S().showBar ? '' : 'none';
    const favs = S().bookmarks.filter(b => b.folder === 'Favorites');
    this.bar.replaceChildren(...favs.map(b =>
      el('button.sf-fbar-item', { title: b.url, onclick: () => this.go(b.url) },
        el('span.fb-ico', { html: favFor(b.url) }), el('span', { text: b.title }))));
  }
  toggleSidebar(which) {
    if (which) this.sideTab = which;
    const open = which ? true : !this.sidebar.classList.contains('open');
    this.sidebar.classList.toggle('open', open);
    this.sideBtn.classList.toggle('on', open);
    this.renderSidebar();
  }
  renderSidebar() {
    const seg = el('div.seg.sf-side-seg', null,
      ...[['bookmarks', 'Bookmarks'], ['reading', 'Reading List'], ['history', 'History']].map(([k, t]) =>
        el('button', { text: t, class: this.sideTab === k ? 'on' : '', onclick: () => { this.sideTab = k; this.renderSidebar(); } })));
    const list = el('div.sf-side-list');
    if (this.sideTab === 'bookmarks') {
      const marks = S().bookmarks;
      if (!marks.length) list.append(el('div.sf-side-empty', { text: 'No Bookmarks' }));
      for (const b of marks) {
        const row = el('div.sf-side-row', {
          onclick: () => this.go(b.url),
          oncontextmenu: e => {
            e.preventDefault();
            contextMenu([
              { label: 'Open', action: () => this.go(b.url) },
              { label: 'Rename…', action: () => this.renameBookmark(b, row) },
              { type: 'sep' },
              { label: 'Delete', danger: true, action: () => { const s = S(); s.bookmarks = s.bookmarks.filter(x => x !== b); persist(); this.renderSidebar(); this.renderBar(); } },
            ], e.clientX, e.clientY);
          },
        },
          el('span.sf-side-ico', { html: favFor(b.url) }),
          el('div.sf-side-tx', null, el('b', { text: b.title }), el('span', { text: hostOf(b.url) || b.url })),
          el('button.sf-side-x', { html: '×', title: 'Delete', onclick: e => { e.stopPropagation(); const s = S(); s.bookmarks = s.bookmarks.filter(x => x !== b); persist(); this.renderSidebar(); this.renderBar(); } }),
        );
        list.append(row);
      }
    } else if (this.sideTab === 'reading') {
      const items = S().reading;
      if (!items.length) list.append(el('div.sf-side-empty', { text: 'No Reading List items' }));
      for (const r of items) {
        list.append(el('div.sf-side-row', {
          onclick: () => this.go(r.url),
          oncontextmenu: e => {
            e.preventDefault();
            contextMenu([
              { label: 'Open', action: () => this.go(r.url) },
              { label: 'Remove Item', danger: true, action: () => { const s = S(); s.reading = s.reading.filter(x => x !== r); persist(); this.renderSidebar(); } },
            ], e.clientX, e.clientY);
          },
        },
          el('span.sf-side-ico', { html: favFor(r.url) }),
          el('div.sf-side-tx', null, el('b', { text: r.title }), el('span', { text: hostOf(r.url) || r.url })),
          el('button.sf-side-x', { html: '×', title: 'Remove', onclick: e => { e.stopPropagation(); const s = S(); s.reading = s.reading.filter(x => x !== r); persist(); this.renderSidebar(); } }),
        ));
      }
    } else {
      const hist = S().history;
      if (!hist.length) list.append(el('div.sf-side-empty', { text: 'No History' }));
      for (const h of hist.slice(0, 60)) {
        list.append(el('div.sf-side-row', { onclick: () => this.go(h.url) },
          el('span.sf-side-ico', { html: favFor(h.url) }),
          el('div.sf-side-tx', null, el('b', { text: h.title || h.url }), el('span', { text: hostOf(h.url) })),
        ));
      }
    }
    this.sidebar.replaceChildren(seg, list);
  }
  renameBookmark(b, rowEl) {
    const label = rowEl.querySelector('b');
    const input = el('input.sf-rename', { value: b.title, spellcheck: 'false' });
    label.replaceWith(input);
    input.focus(); input.select();
    const commit = () => { b.title = input.value.trim() || b.title; persist(); this.renderSidebar(); this.renderBar(); };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') this.renderSidebar(); });
    input.addEventListener('blur', commit);
  }
  addBookmarkSheet() {
    const tab = this.tab;
    if (this.sheet) return;
    let folder = 'Favorites';
    const nameIn = el('input.sf-name', { value: tab.title === 'Start Page' ? '' : tab.title, placeholder: 'Name', spellcheck: 'false' });
    const folderBtn = el('button.btn', { html: `Favorites&nbsp;▾`, onclick: e => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(['Favorites', 'Bookmarks'].map(f => ({
        label: f, checked: f === folder,
        action: () => { folder = f; folderBtn.innerHTML = `${esc(f)}&nbsp;▾`; },
      })), r.left, r.bottom + 4);
    } });
    const close = () => { this.sheet?.classList.remove('in'); const s = this.sheet; this.sheet = null; setTimeout(() => s?.remove(), 200); };
    const add = () => {
      const title = nameIn.value.trim() || trimTitle(tab.title) || hostOf(tab.url);
      S().bookmarks.push({ id: uid('b'), title, url: tab.url, folder });
      persist();
      this.renderSidebar(); this.renderBar();
      close();
    };
    nameIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') add(); if (e.key === 'Escape') close(); });
    this.sheet = el('div.sf-sheet', null,
      el('div.sf-sheet-title', { text: 'Add Bookmark' }),
      el('div.sf-sheet-row', null, el('span', { text: 'Name' }), nameIn),
      el('div.sf-sheet-row', null, el('span', { text: 'Folder' }), folderBtn),
      el('div.sf-sheet-btns', null,
        el('button.btn', { text: 'Cancel', onclick: close }),
        el('button.btn.primary', { text: 'Add', onclick: add })),
    );
    this.win.body.append(this.sheet);
    requestAnimationFrame(() => this.sheet?.classList.add('in'));
    nameIn.focus(); nameIn.select();
  }
  addToReadingList() {
    const tab = this.tab;
    if (!tab.url.startsWith('http')) return;
    const s = S();
    if (!s.reading.some(r => r.url === tab.url)) {
      s.reading.unshift({ id: uid('r'), title: tab.title, url: tab.url, ts: Date.now() });
      persist();
      this.renderSidebar();
    }
    notify('Safari', `Added “${trimTitle(tab.title)}” to Reading List`, { app: 'safari', timeout: 3000 });
  }
  confirmClearHistory() {
    if (this.sheet) return;
    const close = () => { this.sheet?.classList.remove('in'); const s = this.sheet; this.sheet = null; setTimeout(() => s?.remove(), 200); };
    this.sheet = el('div.sf-sheet', null,
      el('div.sf-sheet-title', { text: 'Clear History' }),
      el('div.sf-sheet-row', { text: 'Clearing history will remove the list of websites you visited. This cannot be undone.', style: { maxWidth: '300px', fontSize: '12px', color: 'var(--text-2)' } }),
      el('div.sf-sheet-btns', null,
        el('button.btn', { text: 'Cancel', onclick: close }),
        el('button.btn.primary', { text: 'Clear', onclick: () => { S().history = []; persist(); close(); this.renderSidebar(); if (this.tab.mode === 'history') this.render(); } })),
    );
    this.win.body.append(this.sheet);
    requestAnimationFrame(() => this.sheet?.classList.add('in'));
  }

  /* ── tab overview ────────────────────────────────────────────────── */
  hideTabs() { this.overview?.remove(); this.overview = null; }
  showTabs() {
    this.hideTabs();
    const grid = el('div.sf-ov-grid', null, ...this.tabs.map((t, i) =>
      el('div.sf-ov-card' + (i === this.active ? '.on' : ''), {
        onclick: () => { this.hideTabs(); this.selectTab(i); },
      },
        el('button.sf-ov-x', { html: '×', title: 'Close Tab', onclick: e => { e.stopPropagation(); this.closeTab(i); if (this.win.node.isConnected) this.showTabs(); } }),
        el('div.sf-ov-thumb', null, el('span.sf-ov-fav', { html: favFor(t.url) })),
        el('div.sf-ov-t', { text: t.title }),
        el('div.sf-ov-u', { text: hostOf(t.url) || 'Start Page' }),
      )));
    this.overview = el('div.sf-ov', { onclick: e => { if (e.target === this.overview) this.hideTabs(); } },
      el('div.sf-ov-head', null, el('span', { text: `${this.tabs.length} Tab${this.tabs.length === 1 ? '' : 's'}` }),
        el('button.btn', { text: 'New Tab', onclick: e => { e.stopPropagation(); this.newTab(); this.showTabs(); } })),
      grid);
    this.view.append(this.overview);
  }
}

const modeFor = url => {
  if (url.startsWith('mac://start')) return 'start';
  if (url.startsWith('mac://welcome')) return 'welcome';
  if (url.startsWith('mac://shortcuts')) return 'shortcuts';
  if (url.startsWith('mac://history')) return 'history';
  if (/^https?:\/\//i.test(url)) return 'web';
  return 'error';
};
const normalize = url => {
  if (/^https?:\/\//i.test(url) || url.startsWith('mac://')) return url;
  return 'https://' + url;
};
const titleFromUrl = url => {
  try {
    const u = new URL(url);
    if (u.hostname.includes('google.') && u.pathname === '/search') {
      const q = u.searchParams.get('q');
      if (q) return `${q} — Google`;
    }
    return u.hostname.replace(/^www\./, '');
  } catch { return baseName(url); }
};

const FAV_COLORS = ['#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff', '#ffd60a'];
function favFor(url) {
  const known = FAVORITES.find(f => f.url === url || (url.startsWith('http') && hostOf(f.url) === hostOf(url)));
  if (known) return known.fav;
  if (hostOf(url).includes('google.')) return favLetter('G', '#4285f4');
  const h = hostOf(url);
  if (!h) return ico(`<rect width="32" height="32" rx="7" fill="#0a84ff"/><path d="M11 22V10h2.6l3.2 7 3.2-7H23v12h-2.4v-7.2L17.8 22h-2.2l-2.2-7.2V22Z" fill="#fff"/>`);
  let n = 0; for (const c of h) n = (n + c.charCodeAt(0)) % FAV_COLORS.length;
  return favLetter((h.replace(/^www\./, '')[0] || '?').toUpperCase(), FAV_COLORS[n]);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.append(ta); ta.select();
  try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
  ta.remove();
}

/** Safari 18 start page: Favorites, Frequently Visited, Privacy Report, Reading List. */
function startPage(navigate) {
  const wrap = el('div.sf-start');
  const inner = el('div.wrap', null, el('h1', { text: 'Favorites' }));
  const grid = el('div.sf-favs');
  for (const b of S().bookmarks.filter(b => b.folder === 'Favorites')) {
    grid.append(el('button.sf-fav', { onclick: () => navigate(b.url), title: b.url },
      el('div.tile', { html: favFor(b.url) }),
      el('span', { text: b.title }),
    ));
  }
  const search = el('div.search-field.sf-start-search', null,
    el('span', { html: glyph('search') }),
    el('input', { placeholder: 'Search or enter website name', onkeydown: e => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = e.target.value.trim();
        navigate(looksLikeUrl(v) ? (/\:\/\//.test(v) ? v : 'https://' + v) : searchUrl(v));
      }
    } }),
  );
  const section = (title, children, onMore) => el('div.sf-section', null,
    el('div.sf-section-head', null, el('h3', { text: title }), onMore ? el('button.sf-more', { text: 'Show All', onclick: onMore }) : null),
    children);

  const counts = {};
  for (const h of S().history) { const host = hostOf(h.url); if (host) counts[host] = (counts[host] || 0) + 1; }
  const frequent = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const freqGrid = el('div.sf-favs.small', null, ...frequent.map(([host]) =>
    el('button.sf-fav', { onclick: () => navigate('https://' + host), title: host },
      el('div.tile', { html: favFor('https://' + host) }),
      el('span', { text: host.replace(/^www\./, '') }),
    )));

  const s = S();
  const privacy = el('div.sf-report', null,
    el('div.sf-report-ico', { html: glyph('hand') }),
    el('div', null,
      el('b', { text: 'Safari Privacy Report' }),
      el('p', { text: `In the last seven days, Safari blocked ${(s.blocked || 0).toLocaleString('en-US')} tracker${s.blocked === 1 ? '' : 's'} across ${(s.blockedHosts?.length || 0)} website${(s.blockedHosts?.length || 0) === 1 ? '' : 's'}.` }),
    ),
  );
  const reading = el('div.sf-reading', null,
    ...(s.reading.length ? s.reading.slice(0, 5).map(r =>
      el('div.sf-read-row', { onclick: () => navigate(r.url) },
        el('span.sf-read-thumb', { html: favFor(r.url) }),
        el('div', null, el('b', { text: r.title }), el('span', { text: hostOf(r.url) }))))
      : [el('div.sf-side-empty', { text: 'Nothing saved for later' })]));
  inner.append(search, grid,
    el('div.sf-two', null,
      el('div', null,
        section('Frequently Visited', freqGrid, () => navigate('mac://history')),
        section('Privacy Report', privacy),
      ),
      section('Reading List', reading),
    ));
  wrap.append(inner);
  return wrap;
}
function articlePage(title, html, kicker) {
  return el('div.sf-article', null,
    el('div.hero', null, el('div', null, kicker ? el('div', { style: { opacity: .8, marginBottom: '8px' }, text: kicker }) : null, el('h1', { text: title }))),
    el('div.body', { html }),
  );
}
function shortcutTable() {
  const rows = [
    ['Command-Space', 'Spotlight'], ['Command-Tab', 'Switch apps'],
    ['F3 or Control-Up', 'Mission Control'], ['Command-W', 'Close window'], ['Command-M', 'Minimize window'],
    ['Control-Command-F', 'Full screen'], ['Command-Q', 'Quit app'], ['Command-N', 'New window'],
    ['Command-T', 'New tab'], ['Command-[ / ]', 'Back / forward'],
    ['Shift-Command-\\', 'Show all tabs'], ['Escape', 'Cancel / close overlays'],
  ];
  return `<table style="width:100%;border-collapse:collapse">${rows.map(([k, v]) =>
    `<tr><td style="padding:7px 0;border-bottom:.5px solid #ddd"><code>${k}</code></td><td style="padding:7px 0;border-bottom:.5px solid #ddd;color:#666">${v}</td></tr>`).join('')}</table>`;
}
function historyPage(navigate, refresh) {
  const s = S();
  const page = el('div.sf-hist');
  const searchIn = el('input', { placeholder: 'Search History', oninput: () => draw(searchIn.value.trim().toLowerCase()) });
  const list = el('div.sf-hist-list');
  const clearBtn = el('button.btn', {
    text: 'Clear History',
    onclick: () => refresh(),
  });
  page.append(
    el('div.sf-hist-head', null,
      el('h1', { text: 'History' }),
      el('div.search-field', null, el('span', { html: glyph('search') }), searchIn),
      clearBtn),
    list);
  const dayLabel = ts => {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return fmtNoteDate(ts);
  };
  function draw(q) {
    const entries = s.history.filter(h => !q || (h.title + ' ' + h.url).toLowerCase().includes(q));
    list.replaceChildren();
    if (!entries.length) {
      list.append(el('div.sf-side-empty', { text: q ? 'No matching history' : 'No pages visited yet' }));
      return;
    }
    let lastDay = '';
    for (const h of entries) {
      const day = dayLabel(h.ts);
      if (day !== lastDay) { lastDay = day; list.append(el('div.sf-hist-day', { text: day })); }
      list.append(el('div.sf-hist-row', { onclick: () => navigate(h.url) },
        el('span.sf-side-ico', { html: favFor(h.url) }),
        el('div.sf-side-tx', null, el('b', { text: h.title || h.url }), el('span', { text: h.url })),
        el('span.sf-hist-time', { text: new Date(h.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }),
      ));
    }
  }
  draw('');
  return page;
}
function errorPage(tab, retry) {
  const host = hostOf(tab.url) || tab.url;
  return el('div.sf-err', null, el('div', null,
    el('h2', { text: 'Safari Can’t Open the Page' }),
    el('p', { text: `Safari can’t open the page “${host}” because the server where this page is located isn’t responding.` }),
    el('p', { text: 'The webpage might be temporarily unavailable, or the server may be too busy.', class: 'sub' }),
    el('div', { style: { marginTop: '18px', display: 'flex', gap: '8px', justifyContent: 'center' } },
      el('button.btn', { text: 'Try Again', onclick: retry }),
    ),
  ));
}
function offlinePage(retry) {
  return el('div.sf-err', null, el('div', null,
    el('div', { style: { display: 'grid', placeItems: 'center', marginBottom: '12px', color: 'var(--text-3)' }, html: glyph('wifiOff', 'glyph big') }),
    el('h2', { text: 'You Are Not Connected to the Internet' }),
    el('p', { text: 'This page can’t be displayed because your computer is currently offline.' }),
    el('div', { style: { marginTop: '18px', display: 'flex', gap: '8px', justifyContent: 'center' } },
      el('button.btn', { text: 'Try Again', onclick: retry }),
    ),
  ));
}
export default meta;
