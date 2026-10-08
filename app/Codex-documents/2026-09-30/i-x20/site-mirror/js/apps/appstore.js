// App Store: the real Sequoia storefront — Discover, Arcade, Create, Work,
// Play, Develop, Categories, Updates, search and per-app product pages.
// Apps it sells are the ones that can really be installed (os.js); every
// Get button installs, every Open button launches.
import { el, on } from '../core/util.js';
import { appIcon, glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { allApps, launch, getApp, isInstalled, installApp, installableApps } from '../core/os.js';
import { state, save } from '../core/store.js';
import { MACHINE, userName } from '../core/device.js';

/* an app meta may carry a literal svg icon; the registry names carry keys */
const iconFor = a => String(a?.icon || '').trim().startsWith('<svg') ? a.icon : appIcon(a?.icon || a?.id || 'generic');
const iconForId = id => iconFor(getApp(id) || { id });

/* ── the catalogue ───────────────────────────────────────────────────────
   Everything below maps to a real registered app. Installable rows Get;
   apps that ship with macOS read Open. */
const CAT = {
  weather: {
    genre: 'Weather', tagline: 'Conditions, hourly and 10-day forecasts.',
    rating: 4.8, ratings: '12.4K', size: '6.2 MB',
    desc: 'Weather puts the sky on your desktop. Live conditions, an hour-by-hour strip and a ten-day outlook sit on a sky drawn to match what is actually outside.\n\nAdd as many cities as you like and the forecast follows each one.',
    histo: [82, 10, 4, 2, 2],
  },
  chess: {
    genre: 'Games', tagline: 'The classic strategy game, beautifully rebuilt.',
    rating: 4.6, ratings: '8.1K', size: '3.8 MB',
    desc: 'Play a full game against the computer with legal-move guidance, castling, en passant and promotion — plus a move list, captured pieces and an undo that takes back a whole turn.\n\nFlip the board and pass the Mac for a two-player game.',
    histo: [74, 14, 6, 3, 3],
  },
  stickies: {
    genre: 'Productivity', tagline: 'Colourful notes that stay where you put them.',
    rating: 4.4, ratings: '5.6K', size: '1.4 MB',
    desc: 'Stickies keeps small notes on your desktop in translucent colour. Right-click a note to change its colour; every note is exactly where you left it.',
    histo: [68, 16, 8, 4, 4],
  },
  clock: {
    genre: 'Utilities', tagline: 'World clocks, alarms, stopwatch and timers.',
    rating: 4.5, ratings: '9.7K', size: '2.6 MB',
    desc: 'See the time anywhere with analogue faces, set alarms that alert you on the minute, run a stopwatch with laps, and count a timer down with a live ring.',
    histo: [70, 16, 7, 3, 4],
  },
  reminders: {
    genre: 'Productivity', tagline: 'Lists that keep up with you.',
    rating: 4.7, ratings: '15.2K', size: '2.1 MB',
    desc: 'Make a list for everything — groceries, work, the trip. Tick a circle when it is done, flag what matters, give anything a date.',
    histo: [78, 12, 5, 2, 3],
  },
  calendar: {
    genre: 'Productivity', tagline: 'Your day, week and month at a glance.',
    rating: 4.7, ratings: '21.9K', size: '5.4 MB',
    desc: 'Month, week and day views with a mini calendar alongside. Drag an event to move it, click for details, and a new event is one keystroke away.',
    histo: [76, 13, 6, 3, 2],
  },
  notes: {
    genre: 'Productivity', tagline: 'Capture thoughts in rich notes.',
    rating: 4.7, ratings: '30.1K', size: '4.0 MB',
    desc: 'Notes with checklists, folders and pinning that stay in sync with every other app on this Mac.',
    histo: [77, 13, 5, 3, 2],
  },
  textedit: {
    genre: 'Productivity', tagline: 'A clean editor for everything plain.',
    rating: 4.3, ratings: '11.8K', size: '1.1 MB',
    desc: 'Rich or plain text, ruler, styles — the fast little editor that opens almost anything.',
    histo: [64, 18, 9, 5, 4],
  },
  photos: {
    genre: 'Photo & Video', tagline: 'Your library, beautifully organised.',
    rating: 4.6, ratings: '25.5K', size: '8.7 MB',
    desc: 'Every photo, grouped by day and album, with a viewer that gets out of the way.',
    histo: [73, 14, 7, 3, 3],
  },
  music: {
    genre: 'Entertainment', tagline: 'Songs, albums and playlists.',
    rating: 4.5, ratings: '19.3K', size: '7.9 MB',
    desc: 'Your music with a queue, shuffle, repeat and seek — and a player that sounds like it means it.',
    histo: [71, 15, 7, 4, 3],
  },
  calculator: {
    genre: 'Utilities', tagline: 'Basic, scientific and programmer maths.',
    rating: 4.2, ratings: '9.9K', size: '0.9 MB',
    desc: 'The calculator you know, with scientific and programmer modes a click away.',
    histo: [60, 20, 10, 5, 5],
  },
  terminal: {
    genre: 'Developer Tools', tagline: 'The command line, uncompromised.',
    rating: 4.6, ratings: '14.0K', size: '1.6 MB',
    desc: 'A real shell with pipes, globs, editors and a pager — the whole environment, not a toy.',
    histo: [72, 15, 7, 3, 3],
  },
};
const ORDER = ['weather', 'chess', 'reminders', 'calendar', 'stickies', 'clock'];
const INCLUDED = ['notes', 'photos', 'music', 'textedit', 'calculator', 'terminal'];

const GENRES = [
  { id: 'games', title: 'Games', icon: 'gamepad', apps: ['chess'] },
  { id: 'productivity', title: 'Productivity', icon: 'doc', apps: ['reminders', 'calendar', 'stickies', 'notes', 'textedit'] },
  { id: 'utilities', title: 'Utilities', icon: 'gear', apps: ['clock', 'calculator', 'weather'] },
  { id: 'weather', title: 'Weather', icon: 'sun', apps: ['weather'] },
  { id: 'photo', title: 'Photo & Video', icon: 'camera', apps: ['photos'] },
  { id: 'entertainment', title: 'Entertainment', icon: 'play', apps: ['music', 'chess'] },
  { id: 'dev', title: 'Developer Tools', icon: 'keyboard', apps: ['terminal', 'textedit'] },
];

const PAGES = [
  { id: 'discover', title: 'Discover', icon: 'sparkle' },
  { id: 'arcade', title: 'Arcade', icon: 'gamepad' },
  { id: 'create', title: 'Create', icon: 'pencil' },
  { id: 'work', title: 'Work', icon: 'doc' },
  { id: 'play', title: 'Play', icon: 'play' },
  { id: 'develop', title: 'Develop', icon: 'keyboard' },
];

/* editorial heroes, one per landing page: [tint A, tint B, tag, title, blurb, app] */
const HEROES = {
  discover: [
    { a: '#0a6cff', b: '#7a3cff', tag: 'APP OF THE DAY', title: 'Weather', blurb: 'A forecast that looks like the sky it describes.', app: 'weather' },
    { a: '#16324f', b: '#3c6e9f', tag: 'NOW AVAILABLE', title: 'Clock', blurb: 'Alarms, a stopwatch and the time in every city that matters.', app: 'clock' },
  ],
  arcade: [
    { a: '#511d98', b: '#b347ea', tag: 'APPLE ARCADE', title: 'Chess', blurb: 'No ads, no in-app purchases. Just you and the engine.', app: 'chess' },
  ],
  create: [
    { a: '#b34a00', b: '#ff9f0a', tag: 'GET STARTED', title: 'Make something', blurb: 'Notes, Photos and TextEdit — everything you need is already here.', apps: ['notes', 'photos', 'textedit'] },
  ],
  work: [
    { a: '#0c5b4e', b: '#30d158', tag: 'GET ORGANISED', title: 'The working set', blurb: 'Reminders and Calendar keep the day honest.', apps: ['reminders', 'calendar'] },
  ],
  play: [
    { a: '#5b1a4e', b: '#ff375f', tag: 'GAME NIGHT', title: 'Take a break', blurb: 'A game of Chess, then a record on the turntable.', apps: ['chess', 'music'] },
  ],
  develop: [
    { a: '#1c1c22', b: '#4b5568', tag: 'DEVELOPER TOOLS', title: 'Ship something', blurb: 'A real shell and a real editor, side by side.', apps: ['terminal', 'textedit'] },
  ],
};
const PAGE_APPS = {
  discover: ['weather', 'chess', 'reminders', 'calendar', 'stickies', 'clock'],
  arcade: ['chess'],
  create: ['textedit', 'notes', 'photos', 'music'],
  work: ['reminders', 'calendar', 'notes', 'stickies'],
  play: ['chess', 'music', 'photos'],
  develop: ['terminal', 'textedit', 'calculator'],
};

/* drawn screenshot strips for the store apps — small svg scenes, not photos */
const SHOTS = {
  weather: [
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sw1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6fd0"/><stop offset="1" stop-color="#8fd0ff"/></linearGradient></defs><rect width="200" height="300" fill="url(#sw1)"/><circle cx="150" cy="52" r="20" fill="#ffe9a8"/><text x="16" y="86" font-family="-apple-system,sans-serif" font-size="46" font-weight="300" fill="#fff">72°</text><text x="16" y="106" font-family="-apple-system,sans-serif" font-size="12" fill="#dff0ff">Mostly Sunny</text><g fill="#fff" opacity=".85">${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${14 + i * 30}" y="150" width="22" height="34" rx="6" opacity=".25"/>`).join('')}</g><rect x="10" y="208" width="180" height="80" rx="9" fill="#fff" opacity=".18"/></svg>`,
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#101c30"/>${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="10" y="${14 + i * 40}" width="180" height="32" rx="7" fill="#22344f"/><rect x="20" y="${24 + i * 40}" width="46" height="7" rx="3.5" fill="#7ea4d6"/><rect x="130" y="${24 + i * 40}" width="50" height="7" rx="3.5" fill="#4a6f9f"/>`).join('')}</svg>`,
  ],
  chess: [
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#2a2118"/>${(() => { let s = ''; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) s += `<rect x="${26 + c * 18.5}" y="${46 + r * 18.5}" width="18.5" height="18.5" fill="${(r + c) % 2 ? '#946f51' : '#ecdcb9'}"/>`; return s; })()}<text x="73" y="105" font-size="24" fill="#111">♞</text><text x="110" y="198" font-size="24" fill="#f7ecd7">♔</text><rect x="26" y="24" width="80" height="12" rx="6" fill="#3d3126"/><rect x="26" y="212" width="148" height="12" rx="6" fill="#3d3126"/></svg>`,
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#171310"/>${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<rect x="14" y="${16 + i * 34}" width="172" height="26" rx="5" fill="#262019"/><rect x="24" y="${26 + i * 34}" width="60" height="7" rx="3.5" fill="#8a7a62"/><rect x="140" y="${26 + i * 34}" width="36" height="7" rx="3.5" fill="#5c5142"/>`).join('')}</svg>`,
  ],
  stickies: [
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#3a5068"/><rect x="26" y="40" width="90" height="90" rx="3" fill="#fdf08a" transform="rotate(-3 70 85)"/><rect x="86" y="120" width="90" height="90" rx="3" fill="#c2e8ff" transform="rotate(4 130 165)"/><rect x="40" y="180" width="80" height="80" rx="3" fill="#ffd1dc" transform="rotate(-2 80 220)"/></svg>`,
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#303038"/><rect x="30" y="50" width="140" height="140" rx="4" fill="#fdf08a"/><rect x="30" y="50" width="140" height="18" rx="4" fill="#f5df6e"/><rect x="44" y="88" width="104" height="6" rx="3" fill="#c8b95c"/><rect x="44" y="104" width="80" height="6" rx="3" fill="#c8b95c"/><rect x="44" y="120" width="96" height="6" rx="3" fill="#c8b95c"/></svg>`,
  ],
  clock: [
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#101012"/><circle cx="100" cy="118" r="64" fill="#1e1e22" stroke="#3a3a40"/><circle cx="100" cy="118" r="58" fill="none" stroke="#54545c" stroke-dasharray="1 9"/><path d="M100 118 100 76M100 118 132 132" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M100 118 84 66" stroke="#ff9f0a" stroke-width="2" stroke-linecap="round"/><rect x="20" y="216" width="160" height="30" rx="8" fill="#1e1e22"/><rect x="40" y="256" width="120" height="16" rx="8" fill="#2c2c30"/></svg>`,
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#101012"/><text x="100" y="150" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="44" font-weight="200" fill="#ff9f0a">00:42.18</text>${[0, 1, 2].map(i => `<rect x="24" y="${196 + i * 30}" width="152" height="22" rx="5" fill="#1e1e22"/><rect x="34" y="${204 + i * 30}" width="40" height="6" rx="3" fill="#5c5c64"/>`).join('')}</svg>`,
  ],
  reminders: [
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#f4f4f6"/>${['#ff453a', '#ff9f0a', '#0a84ff', '#30d158'].map((c, i) => `<circle cx="26" cy="${52 + i * 46}" r="8" fill="${c}"/><rect x="44" y="${42 + i * 46}" width="130" height="20" rx="5" fill="#fff" stroke="#e2e2e6"/><rect x="52" y="${49 + i * 46}" width="70" height="6" rx="3" fill="#c9c9cf"/>`).join('')}</svg>`,
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#fff"/><rect x="0" y="0" width="70" height="300" fill="#ececf0"/><circle cx="35" cy="40" r="12" fill="#ff9f0a"/><circle cx="35" cy="80" r="12" fill="#0a84ff"/><circle cx="35" cy="120" r="12" fill="#30d158"/>${[0, 1, 2, 3, 4].map(i => `<circle cx="88" cy="${46 + i * 44}" r="7" fill="none" stroke="#c9c9cf" stroke-width="2"/><rect x="102" y="${42 + i * 44}" width="80" height="8" rx="4" fill="#e2e2e6"/>`).join('')}</svg>`,
  ],
  calendar: [
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#fff"/><rect width="200" height="34" fill="#f4f4f6"/><text x="14" y="22" font-family="-apple-system,sans-serif" font-size="14" font-weight="700" fill="#c33">October</text>${(() => { let s = ''; for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) s += `<rect x="${8 + c * 26.5}" y="${46 + r * 42}" width="25" height="40" fill="none" stroke="#ececf0"/>`; return s; })()}<rect x="61.5" y="130" width="25" height="10" rx="3" fill="#0a84ff"/><rect x="115" y="172" width="25" height="10" rx="3" fill="#30d158"/><rect x="35" y="88" width="25" height="10" rx="3" fill="#bf5af2"/></svg>`,
    `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="#fff"/>${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="56" y="${34 + i * 38}" width="144" height="38" fill="none" stroke="#ececf0"/><text x="10" y="${54 + i * 38}" font-family="-apple-system,sans-serif" font-size="9" fill="#9a9aa0">${i + 8} AM</text>`).join('')}<rect x="58" y="72" width="140" height="30" rx="5" fill="#0a84ff" opacity=".85"/><rect x="58" y="148" width="140" height="30" rx="5" fill="#30d158" opacity=".85"/><rect x="58" y="205" width="140" height="20" rx="5" fill="#bf5af2" opacity=".85"/></svg>`,
  ],
};
const GEN_SHOT = (id, tint) =>
  `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="300" fill="${tint}"/><rect x="16" y="40" width="168" height="130" rx="10" fill="#fff" opacity=".92"/><rect x="16" y="40" width="168" height="18" rx="9" fill="#e8e8ec"/><circle cx="26" cy="49" r="3" fill="#ff5f57"/><circle cx="36" cy="49" r="3" fill="#febc2e"/><circle cx="46" cy="49" r="3" fill="#28c840"/><rect x="30" y="72" width="120" height="8" rx="4" fill="#d7d7dd"/><rect x="30" y="88" width="90" height="8" rx="4" fill="#e5e5ea"/><rect x="30" y="104" width="110" height="8" rx="4" fill="#ececf1"/></svg>`;
const shotFor = id => SHOTS[id] || [GEN_SHOT(id, '#51688f'), GEN_SHOT(id, '#384a66')];

const stars = rating => {
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<span class="${rating >= i - .25 ? 'on' : rating >= i - .75 ? 'half' : ''}">★</span>`;
  return `<span class="as-stars">${out}</span>`;
};

/* the seeded pending update — always an app this Mac really has */
const UPDATE_SEED = () => [
  { id: 'notes', version: '4.4', size: '3.1 MB', notes: 'Folders load faster, checklists keep their tick through a restart, and the share menu lists everyone it should.' },
];
const pendingUpdates = () =>
  UPDATE_SEED().filter(u => !(state.settings.storeUpdated || []).includes(`${u.id}@${u.version}`));

const meta = {
  id: 'appstore', name: 'App Store', icon: 'appstore', dock: false,
  menus: () => [{
    title: 'Store', items: () => [
      { label: 'Reload Page', key: '⌘R', action: () => wm.byApp('appstore')[0]?._st?.render() },
      { type: 'sep' },
      { label: 'Check for Updates', action: () => wm.byApp('appstore')[0]?._st?.go('updates') },
      { type: 'sep' },
      { label: 'Close', key: '⌘W', action: () => { const w = wm.byApp('appstore')[0]; w && wm.close(w); } },
    ],
  }],
  launch() {
    const existing = wm.byApp('appstore').find(w => w.state !== 'min') || wm.byApp('appstore')[0];
    if (existing) { wm.show(existing); return existing; }
    return wm.open({
      app: 'appstore', key: 'main', title: 'App Store',
      width: 980, height: 640, minWidth: 720, minHeight: 460,
      build: win => new Store(win).mount(),
      onClose: win => win._st?.unmount(),
    });
  },
};

class Store {
  constructor(win) {
    this.win = win;
    this.view = { type: 'page', id: 'discover' };
    this.catOpen = false;
    this.query = '';
    this.installing = new Set();
    this.offApps = on('apps:change', () => this.render());
  }
  unmount() { this.offApps?.(); }
  mount() {
    const win = this.win;
    win._st = this;
    this.back = el('button.tb-btn.as-back', { html: glyph('chevL'), title: 'Back', onclick: () => this.go(this.view.back || 'discover'), style: { visibility: 'hidden' } });
    win.tbTools.replaceChildren(this.back);
    this.searchInput = el('input', { type: 'search', placeholder: 'Search', oninput: e => { this.query = e.target.value; this.render(); } });
    this.searchInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { this.searchInput.value = ''; this.query = ''; this.render(); this.searchInput.blur(); }
      if (e.key === 'Enter') this.searchInput.blur();
    });
    win.tbRight.replaceChildren(el('div.search-field.as-search', null, el('span', { html: glyph('search') }), this.searchInput));
    this.sidebar = el('aside.as-side');
    this.pane = el('div.as-pane.scroll', { dataset: { focus: '1' } });
    win.setSidebar(this.sidebar, 196);
    win.body.append(this.pane);
    this.render();
    win.onKey = e => {
      if (e.key === 'Escape' && !this.query && this.view.type !== 'page') { this.go(this.view.back || 'discover'); return true; }
      return false;
    };
  }

  /* ── frame ────────────────────────────────────────────────────────── */
  go(page) { this.view = { type: 'page', id: page }; this.query = ''; this.searchInput.value = ''; this.render(); }
  openDetail(id, back) { this.view = { type: 'detail', id, back: back || this.view.id || 'discover' }; this.render(); }
  openGenre(id) { this.view = { type: 'genre', id }; this.render(); }
  openAccount() { this.view = { type: 'account', back: this.view.id || 'discover' }; this.render(); }

  render() {
    this.renderSidebar();
    this.pane.replaceChildren();
    this.back.style.visibility = this.view.type === 'detail' || this.view.type === 'account' || this.view.type === 'genre' ? 'visible' : 'hidden';
    const q = this.query.trim().toLowerCase();
    if (q) return this.renderSearch(q);
    if (this.view.type === 'detail') return this.renderDetail(this.view.id);
    if (this.view.type === 'genre') return this.renderGenre(this.view.id);
    if (this.view.type === 'account') return this.renderAccount();
    if (this.view.id === 'updates') return this.renderUpdates();
    return this.renderPage(this.view.id);
  }

  renderSidebar() {
    const item = (p, extra = {}) => el('button.sb-item.as-item' + (this.view.type === 'page' && this.view.id === p.id ? '.on' : ''), {
      onclick: () => this.go(p.id),
    },
      el('span.as-ico', { html: glyph(p.icon) }), el('span.truncate', { text: p.title }), extra.tail || null);
    const upd = pendingUpdates().length;
    this.sidebar.replaceChildren(
      el('div.sb-section', { text: 'App Store' }),
      item(PAGES[0]), item(PAGES[1]),
      el('div.sb-spacer', { style: { minHeight: '4px' } }),
      item(PAGES[2]), item(PAGES[3]), item(PAGES[4]), item(PAGES[5]),
      el('button.sb-item.as-item' + (this.catOpen ? '.on' : ''), {
        onclick: () => { this.catOpen = !this.catOpen; this.renderSidebar(); },
      },
        el('span.as-ico', { html: glyph('grid') }), el('span.truncate', { text: 'Categories' }),
        el('span.as-chev', { html: glyph(this.catOpen ? 'chevD' : 'chevR') })),
      ...(this.catOpen ? GENRES.map(g => el('button.sb-item.as-item.as-sub' + (this.view.type === 'genre' && this.view.id === g.id ? '.on' : ''), {
        onclick: () => this.openGenre(g.id),
      }, el('span.as-ico', { html: glyph(g.icon) }), el('span.truncate', { text: g.title }))) : []),
      el('div.sb-spacer'),
      item({ id: 'updates', title: 'Updates', icon: 'download' }, {
        tail: upd ? el('span.as-badge', { text: String(upd) }) : null,
      }),
      el('button.as-account', { onclick: () => this.openAccount() },
        el('span.as-avatar', { html: glyph('person') }),
        el('span.truncate', { text: userName() }),
        this.view.type === 'account' ? el('span.as-chev', { html: glyph('chevR') }) : null),
    );
  }

  /* ── shared pieces ────────────────────────────────────────────────── */
  heroCard(h) {
    const ids = h.apps || [h.app];
    const hero = el('div.as-hero', { style: { background: `linear-gradient(118deg, ${h.a}, ${h.b})` } },
      el('div.as-hero-art', { html: heroArt(h) }),
      el('div.as-hero-tx', null,
        el('div.as-tag', { text: h.tag }),
        el('div.as-hero-title', { text: h.title }),
        el('div.as-hero-blurb', { text: h.blurb }),
        ids.length === 1 && getApp(ids[0]) ? this.getButton(ids[0], true) : null),
    );
    if (ids.length > 1) {
      hero.append(el('div.as-hero-apps', null, ...ids.map(id => {
        const a = getApp(id); if (!a) return null;
        return el('button.as-hero-chip', { onclick: e => { e.stopPropagation(); this.openDetail(id); } },
          el('span.as-hero-ic', { html: iconFor(a) }), el('span', { text: a.name }));
      })));
    }
    if (ids.length === 1) hero.addEventListener('click', () => this.openDetail(ids[0]));
    return hero;
  }

  getButton(id, inHero = false) {
    const installed = isInstalled(id);
    const busy = this.installing.has(id);
    const updatable = pendingUpdates().some(u => u.id === id);
    if (busy) {
      return el('span.as-ring', { html: `<svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="10" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2.4"/><circle class="as-arc" cx="13" cy="13" r="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="63" stroke-dashoffset="63"/></svg>` });
    }
    if (installed) {
      return el('button.as-pill' + (inHero ? '.light' : ''), {
        text: 'OPEN', onclick: e => { e.stopPropagation(); launch(id); },
      });
    }
    return el('button.as-pill' + (inHero ? '.light' : '.fill'), {
      text: 'GET', onclick: e => { e.stopPropagation(); this.install(id); },
    });
  }

  install(id) {
    if (this.installing.has(id) || isInstalled(id)) return;
    this.installing.add(id);
    this.render();
    setTimeout(() => {
      installApp(id);
      this.installing.delete(id);
      this.render();
    }, 1500);
  }

  appRow(id, opts = {}) {
    const app = getApp(id); if (!app) return null;
    const c = CAT[id] || {};
    return el('button.as-row', { onclick: () => this.openDetail(id) },
      el('span.as-ric', { html: iconFor(app) }),
      el('span.as-rmain', null,
        el('b', { text: app.name }),
        el('span.as-sub', { text: c.tagline || 'Included with macOS' }),
        opts.rating === false ? null : el('span.as-rate', { html: stars(c.rating || 4.5) }),
      ),
      el('span.as-rside', null, this.getButton(id)),
    );
  }

  section(title, rows) {
    return el('section.as-sec', null,
      el('div.as-sec-head', null, el('h2', { text: title })),
      el('div.as-rows', null, ...rows));
  }

  shotStrip(id) {
    return el('div.as-shots', null, ...shotFor(id).map(s => el('div.as-shot', { html: s })));
  }

  /* ── pages ────────────────────────────────────────────────────────── */
  renderPage(id) {
    const pane = this.pane;
    pane.append(el('h1.as-title', { text: PAGES.find(p => p.id === id)?.title || 'Discover' }));
    for (const h of HEROES[id] || []) pane.append(this.heroCard(h));
    const apps = (PAGE_APPS[id] || []).map(getApp).filter(Boolean);
    if (id === 'discover') {
      pane.append(this.section('Apps We Love', ORDER.slice(0, 4).map(i => this.appRow(i))));
      pane.append(this.section('Essentials', ORDER.slice(4).map(i => this.appRow(i))));
      pane.append(this.section('Made by Apple', INCLUDED.slice(0, 4).map(i => this.appRow(i))));
    } else if (id === 'arcade') {
      pane.append(this.section('What to Play', apps.map(a => this.appRow(a.id))));
      pane.append(el('div.as-note', { text: 'Every game runs offline, with no ads and nothing else to buy.' }));
    } else {
      pane.append(this.section('Featured', apps.slice(0, 6).map(a => this.appRow(a.id, { rating: false }))));
      /* category pages get the drawn screenshot strip per app */
      for (const a of apps.slice(0, 3)) {
        pane.append(el('div.as-feature', null,
          el('button.as-fhead', { onclick: () => this.openDetail(a.id) },
            el('span.as-ric', { html: iconFor(a) }),
            el('span.as-rmain', null,
              el('b', { text: a.name }),
              el('span.as-sub', { text: CAT[a.id]?.tagline || '' }),
              el('span.as-rate', { html: stars(CAT[a.id]?.rating || 4.5) })),
            this.getButton(a.id)),
          this.shotStrip(a.id),
        ));
      }
    }
  }

  renderGenre(id) {
    const g = GENRES.find(x => x.id === id); if (!g) return this.renderPage('discover');
    this.pane.append(el('h1.as-title', { text: g.title }));
    const apps = g.apps.map(getApp).filter(Boolean);
    if (!apps.length) { this.pane.append(el('div.as-note', { text: 'Nothing here yet.' })); return; }
    for (const a of apps) {
      this.pane.append(el('div.as-feature', null,
        el('button.as-fhead', { onclick: () => this.openDetail(a.id) },
          el('span.as-ric', { html: iconFor(a) }),
          el('span.as-rmain', null,
            el('b', { text: a.name }),
            el('span.as-sub', { text: CAT[a.id]?.tagline || '' }),
            el('span.as-rate', { html: stars(CAT[a.id]?.rating || 4.5) })),
          this.getButton(a.id)),
        this.shotStrip(a.id),
      ));
    }
  }

  renderUpdates() {
    const pane = this.pane;
    pane.append(el('div.as-upd-head', null,
      el('h1.as-title', { text: 'Updates' }),
      pendingUpdates().length ? el('button.as-pill.fill', { text: 'Update All', onclick: () => this.updateAll() }) : null));
    const pend = pendingUpdates();
    if (!pend.length) {
      pane.append(el('div.as-note', { html: `${glyph('check', 'glyph')} <span>Your Mac is up to date.</span>` }));
    }
    for (const u of pend) {
      const app = getApp(u.id); if (!app) continue;
      pane.append(el('div.as-upd', null,
        el('button.as-fhead', { onclick: () => this.openDetail(u.id, 'updates') },
          el('span.as-ric', { html: iconFor(app) }),
          el('span.as-rmain', null,
            el('b', { text: app.name }),
            el('span.as-sub', { text: `${app.name} ${u.version} · ${u.size}` }),
            el('span.as-sub', { text: u.notes })),
          el('span.as-rside', null,
            this.installing.has('upd:' + u.id)
              ? el('span.as-ring', { html: `<svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="10" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2.4"/><circle class="as-arc" cx="13" cy="13" r="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="63" stroke-dashoffset="63"/></svg>` })
              : el('button.as-pill.fill', { text: 'UPDATE', onclick: e => { e.stopPropagation(); this.applyUpdate(u); } })),
        )));
    }
    const done = UPDATE_SEED().filter(u => (state.settings.storeUpdated || []).includes(`${u.id}@${u.version}`));
    if (done.length) {
      pane.append(el('div.sb-section', { text: 'Updated Recently' }));
      for (const u of done) {
        const app = getApp(u.id); if (!app) continue;
        pane.append(el('div.as-row.static', null,
          el('span.as-ric', { html: iconFor(app) }),
          el('span.as-rmain', null, el('b', { text: app.name }), el('span.as-sub', { text: `Version ${u.version}` })),
          el('span.as-rside', null,
            el('span.as-updated', { text: 'Updated' }),
            el('button.as-pill', { text: 'OPEN', onclick: () => launch(u.id) })),
        ));
      }
    }
  }

  applyUpdate(u) {
    const key = 'upd:' + u.id;
    if (this.installing.has(key)) return;
    this.installing.add(key);
    this.render();
    setTimeout(() => {
      this.installing.delete(key);
      state.settings.storeUpdated = [...(state.settings.storeUpdated || []), `${u.id}@${u.version}`];
      save();
      this.render();
    }, 1500);
  }
  updateAll() { for (const u of pendingUpdates()) this.applyUpdate(u); }

  renderSearch(q) {
    const hits = Object.keys(CAT).map(getApp).filter(Boolean)
      .filter(a => a.name.toLowerCase().includes(q) || (CAT[a.id]?.tagline || '').toLowerCase().includes(q) || (CAT[a.id]?.genre || '').toLowerCase().includes(q));
    this.pane.append(el('div.sb-section', { text: `${hits.length} result${hits.length === 1 ? '' : 's'}` }));
    if (!hits.length) this.pane.append(el('div.as-note', { text: `No results for “${this.query.trim()}”.` }));
    for (const a of hits) this.pane.append(this.appRow(a.id));
  }

  renderAccount() {
    const pane = this.pane;
    pane.append(el('h1.as-title', { text: 'Account' }));
    pane.append(el('div.as-card', null,
      el('div.as-acct', null,
        el('span.as-avatar.big', { html: glyph('person') }),
        el('div', null, el('b', { text: userName() }), el('div.as-sub', { text: `${MACHINE.iCloud} Account` }))),
    ));
    const owned = allApps().filter(a => CAT[a.id] && isInstalled(a.id));
    pane.append(this.section('Purchased', owned.map(a => this.appRow(a.id))));
  }

  renderDetail(id) {
    const app = getApp(id); if (!app) return this.renderPage('discover');
    const c = CAT[id] || {};
    const pane = this.pane;
    const installed = isInstalled(id);
    pane.append(
      el('div.as-dhead', null,
        el('div.as-dicon', { html: iconFor(app) }),
        el('div.as-dmain', null,
          el('h1', { text: app.name }),
          el('div.as-sub', { text: c.tagline || 'Included with macOS' }),
          el('div.as-dget', null, this.getButton(id),
            el('span.as-dmeta', { text: 'Free · No in-app purchases' })),
        ),
        el('div.as-dchips', null,
          el('div.as-chip', null, el('b', { html: stars(c.rating || 4.5) }), el('span', { text: `${c.ratings || '0'} Ratings` })),
          el('div.as-chip', null, el('b', { text: '4+' }), el('span', { text: 'Age' })),
          el('div.as-chip', null, el('b', { text: `#${(ORDER.indexOf(id) + 1) || 3}` }), el('span', { text: `in ${c.genre || 'Apps'}` })),
          el('div.as-chip', null, el('b', { text: c.size || '2 MB' }), el('span', { text: 'Size' })),
        ),
      ),
      el('div.as-strip', null, ...shotFor(id).map(s => el('div.as-shot.big', { html: s }))),
      el('section.as-sec', null,
        el('div.as-sec-head', null, el('h2', { text: 'About' })),
        ...(c.desc || '').split('\n\n').map(t => el('p.as-desc', { text: t }))),
      el('section.as-sec', null,
        el('div.as-sec-head', null, el('h2', { text: 'Ratings & Reviews' })),
        el('div.as-ratings', null,
          el('div.as-rnum', null, el('b', { text: String(c.rating || 4.5) }), el('div', { html: stars(c.rating || 4.5) }), el('span.as-sub', { text: `${c.ratings || '0'} Ratings` })),
          el('div.as-histo', null, ...(c.histo || [70, 15, 8, 4, 3]).map((v, i) =>
            el('div.as-hrow', null, el('span', { text: `${5 - i}★` }), el('div.as-hbar', null, el('i', { style: { width: v + '%' } })))))),
      ),
      el('section.as-sec', null,
        el('div.as-sec-head', null, el('h2', { text: 'App Privacy' })),
        el('div.as-card', null,
          el('div.as-priv', null,
            el('span.as-pico', { html: glyph('hand') }),
            el('div', null, el('b', { text: 'Data Not Collected' }), el('div.as-sub', { text: 'The developer does not collect any data from this app.' })),
          ))),
      el('section.as-sec', null,
        el('div.as-sec-head', null, el('h2', { text: 'Information' })),
        el('div.as-card.as-info', null,
          ...[
            ['Seller', 'Apple'],
            ['Size', c.size || '2 MB'],
            ['Category', c.genre || 'Apps'],
            ['Compatibility', `Mac · ${MACHINE.os} ${MACHINE.version} or later`],
            ['Languages', 'English and 23 more'],
            ['Age Rating', '4+'],
            ['Copyright', '© Apple Inc.'],
            ['Price', 'Free'],
          ].map(([k, v]) => el('div.as-irow', null, el('span', { text: k }), el('b', { text: v }))))),
    );
    pane.scrollTop = 0;
  }
}

/* a drawn scene inside each hero card, per hero tone */
function heroArt(h) {
  const id = `${(h.a + h.b).length}${h.title.length}`;
  return `<svg viewBox="0 0 220 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="168" cy="30" r="70" fill="#fff" opacity=".10"/>
    <circle cx="30" cy="140" r="90" fill="#fff" opacity=".08"/>
    <rect x="120" y="26" width="76" height="98" rx="12" fill="#fff" opacity=".94" transform="rotate(-6 158 75)"/>
    <rect x="132" y="42" width="52" height="7" rx="3.5" fill="${h.b}" opacity=".55" transform="rotate(-6 158 75)"/>
    <rect x="132" y="58" width="40" height="6" rx="3" fill="#c9c9cf" transform="rotate(-6 158 75)"/>
    <rect x="132" y="72" width="46" height="6" rx="3" fill="#d9d9de" transform="rotate(-6 158 75)"/>
    <rect x="132" y="86" width="34" height="6" rx="3" fill="#e3e3e8" transform="rotate(-6 158 75)"/>
  </svg>`;
}
export default meta;
