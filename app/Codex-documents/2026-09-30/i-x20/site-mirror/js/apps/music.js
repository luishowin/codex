// Music: sidebar library, a sortable Songs table, real playlists, an Up Next
// queue and a mini player. The red accent lives in css/ext-media.css.
import { el, $, fmtDuration, clamp, on } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { contextMenu } from '../shell/menus.js';
import { player, TRACKS, ALBUMS, library, trackById, mediaKey } from '../core/audio.js';
import { coverArt as cover } from '../core/albumart.js';
import { state } from '../core/store.js';
import * as fs from '../core/fs.js';
import { launch } from '../core/os.js';

const ALBUM_META = Object.fromEntries(ALBUMS.map(a => {
  const t = TRACKS.filter(x => x.album === a);
  return [a, { artist: t[0]?.artist || '', year: Math.max(...t.map(x => x.year || 0)), genre: t[0]?.genre || 'Album' }];
}));
const ARTISTS = [...new Set(TRACKS.map(t => t.artist))];
const STATIONS = [
  { name: 'Sundial Radio', hue: '#ff9a5b', note: 'Bright synth pop and soft mornings' },
  { name: 'Late Night Drive', hue: '#7a2cff', note: 'Electronic for the empty freeway' },
  { name: 'Coast to Coast', hue: '#1f8a7a', note: 'Folktronica along the water' },
  { name: 'Blue Hour', hue: '#0a84ff', note: 'Dream pop as the light goes' },
];
const MUSIC_DIR = () => fs.HOME + '/Music';

/* every track owns a real file in ~/Music, so Show in Finder has somewhere
   real to land. Missing files are created once, idempotently. */
function ensureMusicFiles() {
  const dir = fs.get(MUSIC_DIR());
  if (!dir) return;
  for (const t of TRACKS) {
    if (dir.children.some(n => n.kind === 'audio' && n.song === t.id)) continue;
    try { fs.createFile(MUSIC_DIR(), `${t.title}.m4a`, '', 'audio', { song: t.id }); } catch { /* fs busy */ }
  }
}
function trackFile(t) {
  return fs.children(MUSIC_DIR()).find(n => n.kind === 'audio' && n.song === t.id) || null;
}
const matches = (t, q) => [t.title, t.artist, t.album, t.genre].join(' ').toLowerCase().includes(q);
const byAdded = (a, b) => a.added - b.added;      // smaller `added` = more recent

const meta = {
  id: 'music', name: 'Music', icon: 'music', dock: true,
  settingsPane: 'sound',
  menus: () => [
    { title: 'File', items: () => [
      { label: 'New Playlist', key: '⌘N', action: () => frontMusic()?.newPlaylist() },
      { label: 'Import…', key: '⌘O', action: () => launch('finder', { path: MUSIC_DIR() }) },
      { type: 'sep' },
      { label: 'Close Window', key: '⌘W', action: () => { const w = wm.byApp('music').find(x => x.state !== 'min'); w && wm.close(w); } },
    ] },
    { title: 'Edit', items: () => [
      { label: 'Undo', key: '⌘Z', action: () => document.execCommand('undo') },
      { type: 'sep' },
      { label: 'Cut', key: '⌘X', action: () => document.execCommand('cut') },
      { label: 'Copy', key: '⌘C', action: () => document.execCommand('copy') },
      { label: 'Paste', key: '⌘V', action: () => document.execCommand('paste') },
      { label: 'Select All', key: '⌘A', action: () => document.execCommand('selectAll') },
    ] },
    { title: 'View', items: () => {
      const m = frontMusic();
      return [
        ...['Home', 'New', 'Radio', 'Recently Added', 'Artists', 'Albums', 'Songs'].map(s => ({
          label: s, checked: m?.section === s, action: () => m?.show(s),
        })),
        { type: 'sep' },
        { label: 'Up Next', checked: !!m?.queueOn, action: () => m?.toggleQueue() },
        { label: 'Mini Player', key: '⌘⇧M', action: () => toggleMini() },
      ];
    } },
    { title: 'Controls', items: () => [
      { label: player.playing ? 'Pause' : 'Play', key: 'Space', action: () => player.toggle() },
      { label: 'Next', key: '⌘→', action: () => player.next() },
      { label: 'Previous', key: '⌘←', action: () => player.prev() },
      { type: 'sep' },
      { label: 'Shuffle', checked: player.shuffle, action: () => player.setShuffle(!player.shuffle) },
      { label: `Repeat ${player.repeat === 'one' ? 'One' : player.repeat === 'all' ? 'All' : 'Off'}`, checked: player.repeat !== 'off', action: () => player.cycleRepeat() },
      { type: 'sep' },
      { label: library.isLoved(player.track.id) ? 'Unlove' : 'Love', checked: library.isLoved(player.track.id), action: () => library.toggleLove(player.track.id) },
    ] },
  ],
  launch(opts = {}) { return openMusic(opts); },
};

const frontMusic = () => {
  const w = wm.byApp('music').find(x => x.key === 'main' && x.state !== 'min') || wm.byApp('music')[0];
  return w?._music || null;
};

function openMusic(opts = {}) {
  ensureMusicFiles();
  const existing = wm.byApp('music').find(w => w.key === 'main' && w.state !== 'min')
    || wm.byApp('music').find(w => w.key === 'main');
  if (existing) {
    wm.show(existing);
    if (opts.song) {
      const i = TRACKS.findIndex(t => t.id === opts.song);
      if (i >= 0) { existing._music?.show('Songs'); player.select(i); player.play(); }
    }
    return existing;
  }
  return wm.open({
    app: 'music', key: 'main', title: 'Music',
    width: 980, height: 640, minWidth: 720, minHeight: 440,
    build: win => new Music(win, opts).mount(),
    onClose: w => w._music?.dispose(),
  });
}

/* the floating Mini Player: a second, chrome-light music window */
function toggleMini() {
  const mini = wm.byApp('music').find(w => w.key === 'mini' && w.state !== 'min');
  if (mini) { wm.close(mini); return; }
  wm.open({
    app: 'music', key: 'mini', title: 'Music',
    width: 340, height: 132, minWidth: 300, minHeight: 116, resizable: false,
    build(win) {
      const artEl = el('div.mu-mini-art');
      const titleEl = el('b.truncate');
      const subEl = el('span.truncate');
      const playBtn = el('button.mu-tb.mu-mini-play', { onclick: () => player.toggle() });
      const bar = el('div.mu-mini-bar', null, el('i'));
      const syncMini = () => {
        const t = player.track;
        artEl.innerHTML = cover(t.album, t.title, t.artist);
        titleEl.textContent = t.title;
        subEl.textContent = `${t.artist} — ${t.album}`;
        playBtn.innerHTML = glyph(player.playing ? 'pause' : 'play');
        bar.firstChild.style.width = `${(player.position / t.duration) * 100}%`;
      };
      win.body.replaceChildren(el('div.mu-mini', null,
        artEl,
        el('div.mu-mini-mid', null, titleEl, subEl, bar),
        el('div.mu-mini-ctl', null,
          el('button.mu-tb', { html: glyph('prev'), onclick: () => player.prev() }),
          playBtn,
          el('button.mu-tb', { html: glyph('next'), onclick: () => player.next() })),
      ));
      win.setTitle('');
      syncMini();
      const off = player.onChange(syncMini);
      const tick = setInterval(syncMini, 400);
      const oldClose = win.onClose;
      win.onClose = () => { off(); clearInterval(tick); oldClose?.(win); };
    },
  });
}

class Music {
  constructor(win, opts = {}) {
    this.win = win;
    this.opts = opts;
    this.section = 'Home';
    this.sort = { key: 'title', dir: 1 };
    this.query = '';
    this.queueOn = false;
    this.detail = null;           // {type:'album'|'artist'|'playlist', id}
  }
  dispose() { this.off?.(); this.offLib?.(); clearInterval(this.ticker); }

  mount() {
    this.win._music = this;
    this.sidebar = el('aside.sidebar');
    this.queuePanel = el('aside.mu-queue');
    this.content = el('div.mu-content.scroll');
    this.win.setSidebar(this.sidebar, 208);
    this.wrap = el('div.mu-wrap', null, this.content, this.queuePanel);
    this.win.body.append(this.wrap);
    this.buildSidebar();

    /* toolbar: transport + LCD left, shuffle/repeat/volume/queue right */
    this.lcdArt = el('div.mu-lcd-art');
    this.lcdTitle = el('b', { text: player.track.title });
    this.lcdArtist = el('span', { text: player.track.artist });
    this.range = el('input.range.mu-scrub', {
      type: 'range', min: '0', max: String(player.track.duration), step: '0.1', value: '0',
      oninput: e => player.seek(Number(e.target.value)),
    });
    this.elapsed = el('span.mu-time', { text: '0:00' });
    this.remaining = el('span.mu-time', { text: '−' + fmtDuration(player.track.duration) });
    this.lcd = el('div.mu-lcd', null,
      el('div.mu-lcd-row', null,
        this.lcdArt,
        el('div.mu-lcd-txt', null, this.lcdTitle, el('div.mu-lcd-sub', null, this.lcdArtist)),
        el('div.mu-lcd-times', null, this.elapsed, this.remaining)),
      this.range,
    );
    this.playBtn = el('button.mu-play', { html: glyph('play'), title: 'Play', onclick: () => player.toggle() });
    this.win.tbTools.replaceChildren(el('div.mu-transport', null,
      el('button.mu-tb', { html: glyph('prev'), title: 'Previous', onclick: () => player.prev() }),
      this.playBtn,
      el('button.mu-tb', { html: glyph('next'), title: 'Next', onclick: () => player.next() }),
      this.lcd,
    ));
    this.shuffleBtn = el('button.mu-tb', { html: shuffleGlyph(), title: 'Shuffle', onclick: () => player.setShuffle(!player.shuffle) });
    this.repeatBtn = el('button.mu-tb', { html: repeatGlyph(player.repeat), title: 'Repeat', onclick: () => { player.cycleRepeat(); } });
    this.volInput = el('input.range.mu-vol-range', {
      type: 'range', min: '0', max: '1', step: '0.01', value: String(state.settings.volume),
      oninput: e => player.setVolume(Number(e.target.value)),
    });
    this.queueBtn = el('button.mu-tb', { html: glyph('list'), title: 'Up Next', onclick: () => this.toggleQueue() });
    this.win.tbRight.replaceChildren(
      this.shuffleBtn, this.repeatBtn,
      el('div.mu-vol', null, el('span.mu-vol-ico', { html: volumeGlyph(state.settings.volume > .01 ? 1 : 0) }), this.volInput),
      this.queueBtn,
    );

    if (this.opts.song) {
      const i = TRACKS.findIndex(t => t.id === this.opts.song);
      if (i >= 0) player.select(i);
    }
    this.win.setTitle('');
    this.show(this.section);
    this.sync();
    this.off = player.onChange(what => this.onPlayerChange(what));
    this.offLib = on('music:library', () => { this.buildSidebar(); if (this.detail?.type === 'playlist') this.render(); });
    this.ticker = setInterval(() => this.tick(), 250);
    /* F7/F8/F9 are media keys; the shell dispatcher does not own them, so the
       window forwards them to the shared player via mediaKey() */
    this.win.onKey = e => {
      if (e.key === 'F7') { mediaKey('prev'); return true; }
      if (e.key === 'F8') { mediaKey('playpause'); return true; }
      if (e.key === 'F9') { mediaKey('next'); return true; }
      if (e.key === 'Escape' && this.infoCard) { this.infoCard.remove(); this.infoCard = null; return true; }
      return false;
    };
  }

  /* ── sidebar ──────────────────────────────────────────────────── */
  buildSidebar() {
    const row = (icon, label, on, count, onClick, extra = {}) => el('button.sb-item' + (on ? '.on' : ''), { onclick: onClick, ...extra },
      el('span.mu-ico', { html: typeof icon === 'string' ? glyph(icon) : icon }),
      el('span.truncate', { text: label }),
      count != null ? el('span.sb-count', { text: String(count) }) : null);
    const sec = s => this.section === s && !this.detail;
    const det = (t, id) => this.detail?.type === t && this.detail?.id === id;
    this.search = el('input.mu-search', {
      type: 'search', placeholder: 'Search', value: this.query,
      oninput: e => { this.query = e.target.value; this.render(); },
    });
    const plRow = p => el('button.sb-item' + (det('playlist', p.id) ? '.on' : ''), {
      onclick: () => this.show('playlist', p.id),
      ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('drop'); },
      ondragleave: e => e.currentTarget.classList.remove('drop'),
      ondrop: e => {
        e.preventDefault(); e.currentTarget.classList.remove('drop');
        const id = e.dataTransfer.getData('text/x-mu-track');
        if (id && trackById(id)) { library.addToPlaylist(p.id, id); }
      },
    },
      el('span.mu-ico', { html: glyph('list') }),
      el('span.truncate', { text: p.name }),
      el('span.sb-count', { text: String(p.tracks.length) }));

    this.sidebar.replaceChildren(
      el('div.mu-searchwrap', null, el('span.mu-search-ico', { html: glyph('search') }), this.search),
      el('div.sb-section', { text: 'Apple Music' }),
      row('play', 'Home', sec('Home'), null, () => this.show('Home')),
      row('sparkle', 'New', sec('New'), null, () => this.show('New')),
      row('wifi', 'Radio', sec('Radio'), null, () => this.show('Radio')),
      el('div.sb-section', { text: 'Library' }),
      row('clock', 'Recently Added', sec('Recently Added'), null, () => this.show('Recently Added')),
      row('users', 'Artists', this.detail?.type === 'artist' || sec('Artists'), ARTISTS.length, () => this.show('Artists')),
      row('gallery', 'Albums', this.detail?.type === 'album' || sec('Albums'), ALBUMS.length, () => this.show('Albums')),
      row('list', 'Songs', sec('Songs'), TRACKS.length, () => this.show('Songs')),
      el('div.sb-section', { text: 'Playlists' }),
      row('plus', 'New Playlist', false, null, () => this.newPlaylist()),
      ...library.playlists().map(plRow),
    );
  }

  show(section, id) {
    if (section === 'playlist') this.detail = { type: 'playlist', id };
    else if (section === 'album') this.detail = { type: 'album', id };
    else if (section === 'artist') this.detail = { type: 'artist', id };
    else { this.detail = null; this.section = section; }
    this.buildSidebar();
    this.render();
  }

  heading(title, sub, extra) {
    return el('div.mu-head', null,
      el('div', null, el('h2', { text: title }), sub ? el('p', { text: sub }) : null), extra || null);
  }

  render() {
    const c = this.content;
    c.replaceChildren();
    if (this.query.trim()) return this.renderSearch(c);
    if (this.detail) return this.renderDetail(c);
    switch (this.section) {
      case 'Home': return this.renderHome(c);
      case 'New': return this.renderNew(c);
      case 'Radio': return this.renderRadio(c);
      case 'Recently Added': return this.renderRecent(c);
      case 'Artists': return this.renderArtists(c);
      case 'Albums': return this.renderAlbums(c);
      case 'Songs': return this.renderSongs(c, TRACKS);
      default: return this.renderHome(c);
    }
  }

  /* ── content views ────────────────────────────────────────────── */
  renderSearch(c) {
    const q = this.query.trim().toLowerCase();
    const songs = TRACKS.filter(t => matches(t, q));
    const albums = ALBUMS.filter(a => a.toLowerCase().includes(q));
    c.append(this.heading(`Results for “${this.query.trim()}”`, `${songs.length} songs`));
    if (albums.length) {
      c.append(el('div.mu-sub', { text: 'Albums' }),
        el('div.mu-grid.albums', null, ...albums.map(a => this.albumTile(a))));
    }
    c.append(el('div.mu-sub', { text: 'Songs' }));
    if (!songs.length) c.append(el('div.mu-empty', { text: 'No results' }));
    else c.append(this.songTable(songs, { sortable: false }));
  }

  renderHome(c) {
    const recent = TRACKS.slice().sort(byAdded).slice(0, 4);
    const lead = TRACKS.find(t => t.album === 'Long Way Round') || TRACKS[0];
    const m = ALBUM_META[lead.album];
    c.append(
      this.heading('Home', 'New music for you'),
      el('button.mu-hero', { onclick: () => this.playAlbum(lead.album) },
        el('div.mu-hero-art', { html: cover(lead.album, lead.album, m.artist) }),
        el('div.mu-hero-txt', null,
          el('small', { text: 'Featured album' }),
          el('h3', { text: lead.album }),
          el('p', { text: `${m.artist} · ${m.genre} · ${m.year}` }),
          el('span.mu-hero-play', { html: glyph('play') + '<span>Play</span>' }))),
      el('div.mu-sub', { text: 'Recently Added' }),
      el('div.mu-grid', null, ...recent.map(t => this.trackTile(t))),
      el('div.mu-sub', { text: 'Playlists' }),
      el('div.mu-grid', null, ...library.playlists().slice(0, 4).map(p => this.playlistTile(p))),
      el('div.mu-sub', { text: 'Albums' }),
      el('div.mu-grid.albums', null, ...ALBUMS.map(a => this.albumTile(a))),
    );
  }

  renderNew(c) {
    const albums = ALBUMS.slice().sort((a, b) => ALBUM_META[b].year - ALBUM_META[a].year);
    const fresh = TRACKS.slice().sort(byAdded).slice(0, 6);
    c.append(this.heading('New', 'Latest releases'),
      el('div.mu-sub', { text: 'New albums' }),
      el('div.mu-grid.albums', null, ...albums.map(a => this.albumTile(a))),
      el('div.mu-sub', { text: 'Latest songs' }),
      this.songTable(fresh, { sortable: false }),
    );
  }

  renderRadio(c) {
    c.append(this.heading('Radio', 'Stations tuned to your library'),
      el('div.mu-grid', null, ...STATIONS.map((s, i) => {
        const live = player.station === s.name;
        return el('button.mu-tile.station' + (live ? '.on' : ''), { onclick: () => player.playStation(s.name) },
          el('div.mu-cover.station', { style: { background: `linear-gradient(150deg, ${s.hue}, #1c1c26)` } },
            el('span.mu-station-ico', { html: glyph('wifi') }),
            live ? el('span.mu-live', { text: '● LIVE' }) : null),
          el('b', { text: s.name }), el('span', { text: live && player.playing ? 'Now playing' : s.note }));
      })));
  }

  renderRecent(c) {
    const list = TRACKS.slice().sort(byAdded);
    const daysAgo = t => t.added === 0 ? 'today' : t.added === 1 ? 'yesterday' : `${t.added} days ago`;
    c.append(this.heading('Recently Added', `${list.length} songs`));
    const table = this.songTable(list, { sortable: false });
    /* the added stamp rides inside the title cell, like the real app */
    table.querySelectorAll('.mu-row').forEach((row, i) => {
      const t = list[i];
      if (t) row.querySelector('.mu-row-tt')?.append(el('span.mu-added', { text: ` · added ${daysAgo(t)}` }));
    });
    c.append(table);
  }

  renderAlbums(c) {
    c.append(this.heading('Albums', `${ALBUMS.length} albums`),
      el('div.mu-grid.albums', null, ...ALBUMS.map(a => this.albumTile(a))));
  }

  renderArtists(c) {
    c.append(this.heading('Artists', `${ARTISTS.length} artists`),
      el('div.mu-grid', null, ...ARTISTS.map((a, i) => el('button.mu-tile', {
        onclick: () => this.show('artist', a),
      },
        el('div.mu-cover.round', { style: { background: `linear-gradient(140deg, ${['#ff9a5b,#ff375f', '#5b6ed6,#0a84ff', '#30d158,#1f8a7a', '#ffd60a,#ff9f0a'][i % 4]})` } }, el('span.mu-artist-init', { text: a[0] })),
        el('b', { text: a }),
        el('span', { text: `${TRACKS.filter(t => t.artist === a).length} songs` })))));
  }

  renderSongs(c, list) {
    c.append(this.heading('Songs', `${list.length} songs`));
    c.append(this.songTable(list, { sortable: true }));
  }

  renderDetail(c) {
    if (this.detail.type === 'album') return this.renderAlbum(c, this.detail.id);
    if (this.detail.type === 'artist') return this.renderArtist(c, this.detail.id);
    return this.renderPlaylist(c, this.detail.id);
  }

  detailHead(opts) {
    return el('div.mu-detail-head', null,
      el('button.mu-back', { html: glyph('chevL') + '<span>Library</span>', onclick: () => this.show(opts.back || 'Albums') }),
      el('div.mu-detail-top', null,
        opts.art,
        el('div.mu-detail-txt', null,
          el('small', { text: opts.kicker }),
          el('h2', { text: opts.title }),
          el('p', { text: opts.sub }),
          el('div.mu-detail-actions', null,
            el('button.mu-btn', { html: glyph('play') + '<span>Play</span>', onclick: opts.onPlay }),
            el('button.mu-btn.ghost', { html: shuffleGlyph() + '<span>Shuffle</span>', onclick: opts.onShuffle }),
            opts.extra || null))));
  }

  renderAlbum(c, album) {
    const m = ALBUM_META[album];
    const tracks = TRACKS.filter(t => t.album === album);
    const total = tracks.reduce((s, t) => s + t.duration, 0);
    const idxs = tracks.map(t => TRACKS.indexOf(t));
    c.append(this.detailHead({
      back: 'Albums',
      art: el('div.mu-detail-art', { html: cover(album, album, m.artist) }),
      kicker: 'Album',
      title: album,
      sub: `${m.artist} · ${m.genre} · ${m.year} · ${tracks.length} songs, ${fmtDuration(total)}`,
      onPlay: () => player.playQueue(idxs, 0),
      onShuffle: () => { if (!player.shuffle) player.setShuffle(true); player.playQueue(idxs, Math.floor(Math.random() * idxs.length)); },
    }));
    c.append(this.songTable(tracks, { sortable: false, numbered: true }));
  }

  renderArtist(c, artist) {
    const tracks = TRACKS.filter(t => t.artist === artist);
    const albums = [...new Set(tracks.map(t => t.album))];
    const idxs = tracks.map(t => TRACKS.indexOf(t));
    c.append(this.detailHead({
      back: 'Artists',
      art: el('div.mu-detail-art.round', null, el('span.mu-artist-init.big', { text: artist[0] })),
      kicker: 'Artist',
      title: artist,
      sub: `${albums.length} albums · ${tracks.length} songs`,
      onPlay: () => player.playQueue(idxs, 0),
      onShuffle: () => { if (!player.shuffle) player.setShuffle(true); player.playQueue(idxs, Math.floor(Math.random() * idxs.length)); },
    }));
    c.append(el('div.mu-sub', { text: 'Albums' }),
      el('div.mu-grid.albums', null, ...albums.map(a => this.albumTile(a))),
      el('div.mu-sub', { text: 'Songs' }),
      this.songTable(tracks, { sortable: false }));
  }

  renderPlaylist(c, id) {
    const p = library.playlist(id);
    if (!p) { this.detail = null; return this.render(); }
    const tracks = library.playlistTracks(id);
    const idxs = tracks.map(t => TRACKS.indexOf(t));
    const head = this.detailHead({
      back: 'Songs',
      art: this.playlistArt(p),
      kicker: 'Playlist',
      title: p.name,
      sub: `${tracks.length} song${tracks.length === 1 ? '' : 's'}`,
      onPlay: () => idxs.length && player.playQueue(idxs, 0),
      onShuffle: () => idxs.length && (player.setShuffle(true), player.playQueue(idxs, Math.floor(Math.random() * idxs.length))),
      extra: el('button.mu-btn.ghost.danger', { html: glyph('trashSmall') + '<span>Delete</span>', onclick: () => this.deletePlaylist(id) }),
    });
    /* double-click the title to rename inline */
    head.querySelector('h2').addEventListener('dblclick', () => this.renameInline(head.querySelector('h2'), p));
    c.append(head);
    if (!tracks.length) {
      c.append(el('div.mu-empty', { text: 'Drag songs here, or right-click a song and choose Add to Playlist.' }));
      return;
    }
    c.append(this.songTable(tracks, { sortable: false, playlist: p }));
  }

  /* ── tiles ────────────────────────────────────────────────────── */
  trackTile(t) {
    return el('button.mu-tile', {
      onclick: () => { player.select(TRACKS.indexOf(t)); player.play(); },
      oncontextmenu: e => { e.preventDefault(); this.trackMenu(t, e.clientX, e.clientY); },
    },
      el('div.mu-cover', { html: cover(t.album, t.title, t.artist) }),
      el('b', { text: t.title }), el('span', { text: t.artist }));
  }
  albumTile(album) {
    const m = ALBUM_META[album];
    return el('button.mu-tile.album', { onclick: () => this.show('album', album) },
      el('div.mu-cover', { html: cover(album, album, m.artist) }),
      el('b', { text: album }), el('span', { text: `${m.artist} · ${m.year}` }));
  }
  playlistTile(p) {
    return el('button.mu-tile', { onclick: () => this.show('playlist', p.id) },
      this.playlistArt(p, 'mu-cover'),
      el('b', { text: p.name }), el('span', { text: `${p.tracks.length} songs` }));
  }
  /* playlist artwork: a 2x2 grid of the first four covers, or a soft gradient */
  playlistArt(p, cls = 'mu-detail-art') {
    const covers = p.tracks.slice(0, 4).map(id => trackById(id)).filter(Boolean);
    if (!covers.length) {
      return el('div.' + cls + '.playlist', { style: { background: 'linear-gradient(145deg,#3a3a44,#1c1c24)' } },
        el('span.mu-pl-glyph', { html: glyph('list') }));
    }
    const cells = covers.map(t => el('div', { html: cover(t.album, t.title, t.artist) }));
    while (cells.length < 4) cells.push(el('div.mu-pl-empty'));
    return el('div.' + cls + '.playlist', null, el('div.mu-pl-grid', null, ...cells));
  }

  /* ── the sortable song table ──────────────────────────────────── */
  songTable(list, opts = {}) {
    const sortable = opts.sortable !== false;
    let rows = list.slice();
    if (sortable && this.sort.key) {
      const k = this.sort.key, d = this.sort.dir;
      const keyOf = t => k === 'time' ? t.duration : k === 'love' ? (library.isLoved(t.id) ? 0 : 1) : String(t[k === 'time' ? 'duration' : k] || '').toLowerCase();
      rows.sort((a, b) => {
        const av = keyOf(a), bv = keyOf(b);
        return (av < bv ? -1 : av > bv ? 1 : 0) * d;
      });
    }
    const head = (key, label, cls = '') => {
      const on = sortable && this.sort.key === key;
      return el('div.mu-th' + (cls ? '.' + cls : '') + (on ? '.on' : '') + (sortable ? '.sort' : ''), {
        onclick: sortable ? () => {
          this.sort = this.sort.key === key ? { key, dir: -this.sort.dir } : { key, dir: 1 };
          this.render();
        } : null,
      }, el('span', { text: label }), on ? el('i.mu-arrow', { text: this.sort.dir === 1 ? '▲' : '▼' }) : null);
    };
    const table = el('div.mu-table' + (sortable ? '.sortable' : ''));
    table.append(el('div.mu-thead', null,
      el('div.mu-th.n'), head('title', 'Title', 't'), head('artist', 'Artist'), head('album', 'Album'), head('genre', 'Genre'), head('time', 'Time', 'd'), head('love', '', 'h')));
    rows.forEach((t, i) => {
      const loved = library.isLoved(t.id);
      const row = el('div.mu-row' + (player.track === t ? '.on' : ''), {
        dataset: { track: t.id },
        draggable: true,
        ondblclick: () => this.playFromTable(t, rows),
        onclick: () => { this.selected = t.id; table.querySelectorAll('.mu-row.sel').forEach(n => n.classList.remove('sel')); row.classList.add('sel'); },
        oncontextmenu: e => { e.preventDefault(); this.trackMenu(t, e.clientX, e.clientY, opts.playlist); },
        ondragstart: e => {
          e.dataTransfer.setData('text/x-mu-track', t.id);
          e.dataTransfer.setData('text/plain', t.title);
          e.dataTransfer.effectAllowed = 'copyMove';
          this._dragRow = { track: t.id, playlist: opts.playlist?.id || null, index: i };
        },
      },
        el('div.mu-row-n', { text: String(i + 1) }),
        el('div.mu-row-t', null,
          el('div.mu-row-art', { html: cover(t.album, t.title, t.artist) }),
          el('div.mu-row-tt', null, el('b', { text: t.title }))),
        el('div.mu-row-a.truncate', { text: t.artist }),
        el('div.mu-row-al.truncate', { text: t.album }),
        el('div.mu-row-g.truncate', { text: t.genre }),
        el('div.mu-row-d', { text: fmtDuration(t.duration) }),
        el('button.mu-heart' + (loved ? '.on' : ''), {
          html: heartGlyph(loved), title: loved ? 'Loved' : 'Love',
          onclick: e => { e.stopPropagation(); library.toggleLove(t.id); },
        }),
      );
      if (opts.playlist) {
        row.addEventListener('dragover', e => { if (this._dragRow?.playlist === opts.playlist.id) { e.preventDefault(); row.classList.add('dropabove'); } });
        row.addEventListener('dragleave', () => row.classList.remove('dropabove'));
        row.addEventListener('drop', e => {
          e.preventDefault(); row.classList.remove('dropabove');
          const d = this._dragRow;
          if (d && d.playlist === opts.playlist.id) { library.moveInPlaylist(opts.playlist.id, d.index, i); }
        });
      }
      table.append(row);
    });
    if (!rows.length) table.append(el('div.mu-empty', { text: 'No songs' }));
    return table;
  }
  /* play inside the order the table currently shows */
  playFromTable(t, rows) {
    const idxs = rows.map(x => TRACKS.indexOf(x));
    player.playQueue(idxs, Math.max(0, idxs.indexOf(TRACKS.indexOf(t))));
  }

  /* ── context menu + info card ─────────────────────────────────── */
  trackMenu(t, x, y, playlist = null) {
    const pls = library.playlists();
    contextMenu([
      { label: 'Play', action: () => { player.select(TRACKS.indexOf(t)); player.play(); } },
      { label: 'Play Next', action: () => player.queueNext(TRACKS.indexOf(t)) },
      { label: 'Add to Playlist', sub: () => [
        { label: 'New Playlist…', action: () => this.newPlaylist([t.id]) },
        ...(pls.length ? [{ type: 'sep' }] : []),
        ...pls.map(p => ({ label: p.name, action: () => library.addToPlaylist(p.id, t.id) })),
      ] },
      ...(playlist ? [{ label: 'Remove from Playlist', action: () => {
        const p = library.playlist(playlist.id);
        const at = p.tracks.indexOf(t.id);
        if (at >= 0) library.removeFromPlaylist(playlist.id, at);
      } }] : []),
      { type: 'sep' },
      { label: library.isLoved(t.id) ? 'Unlove' : 'Love', checked: library.isLoved(t.id), action: () => library.toggleLove(t.id) },
      { label: 'Get Info', action: () => this.showInfo(t) },
      { type: 'sep' },
      { label: 'Show in Finder', action: () => {
        ensureMusicFiles();
        const node = trackFile(t);
        launch('finder', { path: MUSIC_DIR(), select: node?.id });
      } },
    ], x, y);
  }

  showInfo(t) {
    this.infoCard?.remove();
    const file = trackFile(t);
    const card = el('div.mu-info', null,
      el('button.mu-info-x', { html: glyph('x'), title: 'Close', onclick: () => { card.remove(); this.infoCard = null; } }),
      el('div.mu-info-art', { html: cover(t.album, t.title, t.artist) }),
      el('div.mu-info-txt', null,
        el('b', { text: t.title }),
        el('span', { text: `${t.artist} — ${t.album}` }),
        el('dl', null,
          el('dt', { text: 'Genre' }), el('dd', { text: t.genre }),
          el('dt', { text: 'Year' }), el('dd', { text: String(t.year) }),
          el('dt', { text: 'Time' }), el('dd', { text: fmtDuration(t.duration) }),
          el('dt', { text: 'File' }), el('dd.truncate', { text: `~/Music/${file?.name || t.title + '.m4a'}` }),
          el('dt', { text: 'Loved' }), el('dd', { text: library.isLoved(t.id) ? 'Yes' : 'No' }),
        )));
    this.win.body.append(card);
    this.infoCard = card;
  }

  /* ── playlists ────────────────────────────────────────────────── */
  newPlaylist(withTracks = []) {
    const p = library.createPlaylist('New Playlist', withTracks);
    this.show('playlist', p.id);
    requestAnimationFrame(() => {
      const h2 = this.content.querySelector('.mu-detail-txt h2');
      if (h2) this.renameInline(h2, p);
    });
  }
  renameInline(h2, p) {
    const input = el('input.mu-rename', { value: p.name, type: 'text' });
    h2.replaceChildren(input);
    input.focus(); input.select();
    const done = commit => {
      if (input.isConnected) {
        if (commit) library.renamePlaylist(p.id, input.value);
        h2.textContent = library.playlist(p.id)?.name || p.name;
      }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
    input.addEventListener('blur', () => done(true));
  }
  deletePlaylist(id) {
    library.deletePlaylist(id);
    this.show('Songs');
  }

  /* ── up next panel ────────────────────────────────────────────── */
  toggleQueue() {
    this.queueOn = !this.queueOn;
    this.queuePanel.classList.toggle('on', this.queueOn);
    this.queueBtn.classList.toggle('on', this.queueOn);
    this.paintQueue();
  }
  paintQueue() {
    if (!this.queueOn) return;
    const up = player.upcoming().map(i => TRACKS[i]);
    const hist = player.history.slice().reverse().map(trackById).filter(Boolean).slice(0, 12);
    const qRow = (t, i) => {
      const r = el('div.mu-q-row', {
        draggable: true,
        ondragstart: e => { e.dataTransfer.setData('text/x-mu-queue', String(i)); this._dragQ = i; },
        ondragover: e => { if (this._dragQ != null) { e.preventDefault(); r.classList.add('dropabove'); } },
        ondragleave: () => r.classList.remove('dropabove'),
        ondrop: e => { e.preventDefault(); r.classList.remove('dropabove'); if (this._dragQ != null && this._dragQ !== i) player.moveUpcoming(this._dragQ, i); this._dragQ = null; },
        ondblclick: () => player.selectQ(player.qpos + 1 + i),
      },
        el('div.mu-q-art', { html: cover(t.album, t.title, t.artist) }),
        el('div.mu-q-t', null, el('b.truncate', { text: t.title }), el('span.truncate', { text: t.artist })),
        el('span.mu-q-d', { text: fmtDuration(t.duration) }));
      return r;
    };
    const hRow = t => el('div.mu-q-row.hist', null,
      el('div.mu-q-art', { html: cover(t.album, t.title, t.artist) }),
      el('div.mu-q-t', null, el('b.truncate', { text: t.title }), el('span.truncate', { text: t.artist })));
    const now = player.track;
    this.queuePanel.replaceChildren(
      el('div.mu-q-head', null, el('b', { text: 'Up Next' }), player.station ? el('span.mu-q-station', { text: player.station }) : null),
      el('div.mu-q-now', null,
        el('div.mu-q-art', { html: cover(now.album, now.title, now.artist) }),
        el('div.mu-q-t', null, el('b.truncate', { text: now.title }), el('span.truncate', { text: now.artist }))),
      el('div.mu-q-list.scroll', null,
        ...up.map(qRow),
        up.length ? null : el('div.mu-q-empty', { text: 'Queue is empty' }),
        hist.length ? el('div.mu-q-sub', { text: 'History' }) : null,
        ...hist.map(hRow)),
    );
  }

  /* ── player sync ──────────────────────────────────────────────── */
  onPlayerChange(what) {
    if (what === 'position') { this.tick(); return; }
    this.sync();
    if (what === 'queue' || what === 'all') this.paintQueue();
    /* a station's LIVE badge lives in the tiles themselves */
    if (this.section === 'Radio' && !this.detail && !this.query.trim()) this.render();
  }
  tick() {
    if (!player.playing) return;
    this.range.value = String(player.position);
    this.elapsed.textContent = fmtDuration(player.position);
    this.remaining.textContent = '−' + fmtDuration(Math.max(0, player.track.duration - player.position));
  }
  sync() {
    const t = player.track;
    this.lcdTitle.textContent = t.title;
    this.lcdArtist.textContent = `${t.artist} — ${t.album}`;
    this.lcdArt.innerHTML = cover(t.album, t.title, t.artist);
    this.range.max = String(t.duration);
    this.range.value = String(player.position);
    this.elapsed.textContent = fmtDuration(player.position);
    this.remaining.textContent = '−' + fmtDuration(Math.max(0, t.duration - player.position));
    this.playBtn.innerHTML = glyph(player.playing ? 'pause' : 'play');
    this.playBtn.title = player.playing ? 'Pause' : 'Play';
    this.shuffleBtn.classList.toggle('on', player.shuffle);
    this.repeatBtn.innerHTML = repeatGlyph(player.repeat);
    this.repeatBtn.classList.toggle('on', player.repeat !== 'off');
    this.repeatBtn.classList.toggle('one', player.repeat === 'one');
    this.volInput.value = String(state.settings.volume);
    for (const row of this.content.querySelectorAll('.mu-row')) {
      row.classList.toggle('on', row.dataset.track === t.id);
    }
    for (const row of this.content.querySelectorAll('.mu-heart')) {
      const tid = row.closest('.mu-row')?.dataset.track;
      if (tid) row.classList.toggle('on', library.isLoved(tid));
    }
    this.paintQueue();
  }
}
export default meta;

/* ── glyphs the icon set does not ship ──────────────────────────────── */
function volumeGlyph(level) {
  const waves = [
    '',
    '<path d="M10.4 6.2a2.5 2.5 0 0 1 0 3.6" stroke-width="1.2" stroke-linecap="round"/>',
    '<path d="M10.4 6.2a2.5 2.5 0 0 1 0 3.6M12.2 4.4a5 5 0 0 1 0 7.2" stroke-width="1.2" stroke-linecap="round"/>',
  ][level];
  return `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="M8 3.4 4.9 5.9H2.6v4.2h2.3L8 12.6Z" fill="currentColor" stroke="none"/>${waves}</svg>`;
}
function heartGlyph(filled) {
  return `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">`
    + `<path d="M8 13.5S2.6 9.9 1.6 6.4C.9 3.9 2.7 2 5 2c1.3 0 2.4.7 3 1.7C8.6 2.7 9.7 2 11 2c2.3 0 4.1 1.9 3.4 4.4-1 3.5-6.4 7.1-6.4 7.1z"${filled ? ' fill="currentColor"' : ''}/></svg>`;
}
function shuffleGlyph() {
  return `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="M1.5 4.5h2.4c4.6 0 3.6 7 8.2 7h2.4"/><path d="M12.2 9.4 14.5 11.5l-2.3 2.1"/><path d="M1.5 11.5h2.4c1 0 1.8-.5 2.4-1.2M9.8 5.6c.5-.7 1.4-1.1 2.3-1.1h2.4"/><path d="M12.2 2.4 14.5 4.5l-2.3 2.1"/></svg>`;
}
function repeatGlyph(mode) {
  const one = mode === 'one' ? '<text x="6.4" y="10.6" font-size="6.4" fill="currentColor" stroke="none" font-family="-apple-system,sans-serif" font-weight="700">1</text>' : '';
  return `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="M2 7a4 4 0 0 1 4-4h6.4"/><path d="M10.6.7 12.9 3l-2.3 2.3"/><path d="M14 9a4 4 0 0 1-4 4H3.6"/><path d="M5.9 15.3 3.6 13l2.3-2.3"/>${one}</svg>`;
}
