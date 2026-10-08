// Synthesized music player built on Web Audio. No audio files.
// Owns the library model too: queue order, shuffle, repeat, loved tracks and
// playlists — persisted under one key so a reload keeps the user's library.
import { emit, clamp, on, uid } from './util.js';
import { state, setSetting } from './store.js';

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const seq = (...steps) => steps;

export const TRACKS = [
  {
    id: 'daybreak', title: 'Daybreak', artist: 'Paper Lanterns', album: 'Sundial', genre: 'Synth Pop', year: 2024, added: 3, duration: 64, bpm: 112, wave: 'triangle', bright: 1,
    melody: seq(64, 67, 69, 71, 72, 71, 69, 67, 66, 69, 71, 74, 72, 71, 69, null, 67, 69, 72, 74, 76, 74, 72, 69, 71, 72, 69, 67, 64, null),
    bass: seq(40, null, 47, null, 43, null, 50, null, 45, null, 52, null, 41, null, 48, null),
  },
  {
    id: 'night', title: 'Night Drive', artist: 'Nova Coast', album: 'Night Drive', genre: 'Electronic', year: 2025, added: 9, duration: 72, bpm: 96, wave: 'sawtooth', bright: .6,
    melody: seq(69, 72, 76, 72, 74, 77, 74, 72, 69, 68, 72, 75, 72, 68, 67, null, 65, 69, 72, 69, 68, 72, 76, 72, 69, 67, 65, 62, null),
    bass: seq(33, null, 40, null, 36, null, 43, null, 31, null, 38, null, 35, null, 42, null),
  },
  {
    id: 'tiny', title: 'Tiny Song', artist: 'Paper Lanterns', album: 'Sundial', genre: 'Synth Pop', year: 2024, added: 3, duration: 48, bpm: 132, wave: 'square', bright: 1.2,
    melody: seq(72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 81, 79, 76, 74, 72, 79, 76, 72, 71, 74, 79, 74, 72, 76, 72, 67, null),
    bass: seq(48, 55, 48, 55, 45, 52, 45, 52, 43, 50, 43, 50, 41, 48, 41, 48),
  },
  {
    id: 'paper', title: 'Paper Sun', artist: 'Paper Lanterns', album: 'Sundial', genre: 'Synth Pop', year: 2024, added: 3, duration: 58, bpm: 104, wave: 'triangle', bright: 1.1,
    melody: seq(72, 74, 76, 79, 76, 74, 72, 69, 71, 72, 74, 76, 79, 81, 79, null, 76, 74, 72, 71, 69, 71, 72, 74, 76, 72, 71, 69, null),
    bass: seq(45, null, 52, null, 47, null, 54, null, 43, null, 50, null, 45, null, 52, null),
  },
  {
    id: 'sodium', title: 'Sodium Lights', artist: 'Nova Coast', album: 'Night Drive', genre: 'Electronic', year: 2025, added: 9, duration: 66, bpm: 100, wave: 'sawtooth', bright: .55,
    melody: seq(65, 68, 72, 68, 70, 73, 70, 68, 65, 63, 68, 72, 75, 72, 70, null, 68, 65, 63, 65, 68, 72, 75, 77, 75, 72, 68, 65, null),
    bass: seq(31, null, 38, null, 34, null, 41, null, 29, null, 36, null, 33, null, 40, null),
  },
  {
    id: 'latebus', title: 'Late Bus', artist: 'Nova Coast', album: 'Night Drive', genre: 'Electronic', year: 2025, added: 9, duration: 52, bpm: 88, wave: 'triangle', bright: .7,
    melody: seq(62, 65, 69, 72, 69, 65, 62, 60, 62, 65, 67, 69, 72, 74, 72, null, 69, 67, 65, 62, 60, 62, 65, 69, 65, 62, 60, null),
    bass: seq(38, null, 45, null, 41, null, 48, null, 36, null, 43, null, 40, null, 47, null),
  },
  {
    id: 'harbour', title: 'Harbour Song', artist: 'Marin Kite', album: 'Long Way Round', genre: 'Folktronica', year: 2026, added: 21, duration: 70, bpm: 84, wave: 'sine', bright: .9,
    melody: seq(67, 71, 74, 71, 69, 72, 76, 72, 67, 64, 67, 71, 74, 79, 76, null, 74, 71, 69, 67, 64, 62, 64, 67, 71, 67, 64, 62, null),
    bass: seq(43, null, 50, null, 46, null, 53, null, 41, null, 48, null, 45, null, 52, null),
  },
  {
    id: 'saltair', title: 'Salt Air', artist: 'Marin Kite', album: 'Long Way Round', genre: 'Folktronica', year: 2026, added: 21, duration: 60, bpm: 76, wave: 'triangle', bright: .8,
    melody: seq(64, 67, 71, 67, 66, 69, 72, 69, 64, 62, 66, 69, 73, 71, 69, null, 67, 64, 62, 64, 67, 71, 74, 71, 67, 64, 62, null),
    bass: seq(40, null, 47, null, 43, null, 50, null, 38, null, 45, null, 42, null, 49, null),
  },
  {
    id: 'foghorn', title: 'Foghorn', artist: 'Marin Kite', album: 'Long Way Round', genre: 'Folktronica', year: 2026, added: 21, duration: 62, bpm: 72, wave: 'sawtooth', bright: .45,
    melody: seq(60, 63, 67, 63, 60, 58, 60, 63, 60, 55, 58, 60, 63, 67, 70, null, 67, 63, 60, 58, 60, 63, 67, 63, 60, 58, 55, null),
    bass: seq(36, null, 43, null, 39, null, 46, null, 34, null, 41, null, 38, null, 45, null),
  },
  {
    id: 'pines', title: 'Two Pines', artist: 'Marin Kite', album: 'Second Nature', genre: 'Acoustic', year: 2026, added: 40, duration: 56, bpm: 80, wave: 'triangle', bright: .85,
    melody: seq(69, 72, 76, 72, 71, 74, 77, 74, 69, 67, 71, 74, 78, 74, 72, null, 71, 67, 64, 67, 71, 74, 72, 69, 67, 64, null),
    bass: seq(45, null, 52, null, 48, null, 55, null, 43, null, 50, null, 47, null, 54, null),
  },
  {
    id: 'raincheck', title: 'Rain Check', artist: 'Marin Kite', album: 'Second Nature', genre: 'Acoustic', year: 2026, added: 40, duration: 54, bpm: 92, wave: 'sine', bright: .7,
    melody: seq(64, 67, 71, 74, 71, 67, 64, 62, 64, 67, 71, 69, 67, 64, 62, null, 64, 67, 71, 74, 76, 74, 71, 69, 67, 64, 62, null),
    bass: seq(40, null, 47, null, 45, null, 52, null, 41, null, 48, null, 43, null, 50, null),
  },
  {
    id: 'lowtide', title: 'Low Tide', artist: 'Odessa Field', album: 'Blue Hour', genre: 'Dream Pop', year: 2027, added: 62, duration: 68, bpm: 78, wave: 'sawtooth', bright: .5,
    melody: seq(63, 67, 70, 67, 65, 68, 72, 68, 63, 60, 63, 67, 70, 75, 72, null, 70, 67, 63, 60, 63, 67, 70, 67, 65, 63, 60, null),
    bass: seq(39, null, 46, null, 42, null, 49, null, 37, null, 44, null, 41, null, 48, null),
  },
  {
    id: 'ferry', title: 'Ferry', artist: 'Odessa Field', album: 'Blue Hour', genre: 'Dream Pop', year: 2027, added: 62, duration: 60, bpm: 86, wave: 'triangle', bright: .65,
    melody: seq(65, 68, 72, 76, 72, 68, 65, 63, 65, 68, 72, 75, 79, 76, 72, null, 70, 68, 65, 63, 65, 68, 71, 68, 65, 63, 60, null),
    bass: seq(41, null, 48, null, 44, null, 51, null, 39, null, 46, null, 43, null, 50, null),
  },
];

export const ALBUMS = ['Sundial', 'Night Drive', 'Long Way Round', 'Second Nature', 'Blue Hour'];
export const trackById = id => TRACKS.find(t => t.id === id) || null;

/* ── the library: loved tracks and playlists, persisted as one blob ─────── */
const LIB_KEY = 'macos.music.v1';
function seedLib() {
  return {
    loved: { night: true, pines: true },
    playlists: [
      { id: 'pl-late-shift', name: 'Late Shift', tracks: ['night', 'sodium', 'latebus', 'foghorn', 'lowtide'] },
      { id: 'pl-sunday', name: 'Sunday Morning', tracks: ['daybreak', 'paper', 'harbour'] },
    ],
  };
}
function loadLib() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (!raw) return seedLib();
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.playlists)) return seedLib();
    data.loved = data.loved && typeof data.loved === 'object' ? data.loved : {};
    /* drop references to tracks that no longer exist */
    for (const p of data.playlists) p.tracks = (p.tracks || []).filter(id => trackById(id));
    return data;
  } catch { return seedLib(); }
}
const lib = loadLib();
function saveLib() {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch { /* full or blocked */ }
  emit('music:library');
}

export const library = {
  isLoved: id => !!lib.loved[id],
  toggleLove(id) {
    if (lib.loved[id]) delete lib.loved[id]; else lib.loved[id] = true;
    saveLib();
    return !!lib.loved[id];
  },
  lovedTracks: () => TRACKS.filter(t => lib.loved[t.id]),
  playlists: () => lib.playlists,
  playlist: id => lib.playlists.find(p => p.id === id) || null,
  playlistTracks(id) {
    const p = library.playlist(id);
    return p ? p.tracks.map(trackById).filter(Boolean) : [];
  },
  createPlaylist(name, tracks = []) {
    const p = { id: uid('pl'), name: name || 'New Playlist', tracks: tracks.filter(id => trackById(id)) };
    lib.playlists.push(p);
    saveLib();
    return p;
  },
  renamePlaylist(id, name) {
    const p = library.playlist(id);
    if (!p) return;
    const clean = String(name || '').trim();
    if (!clean) return;
    p.name = clean;
    saveLib();
  },
  deletePlaylist(id) {
    const i = lib.playlists.findIndex(p => p.id === id);
    if (i < 0) return;
    lib.playlists.splice(i, 1);
    saveLib();
  },
  addToPlaylist(id, trackId) {
    const p = library.playlist(id);
    if (!p || !trackById(trackId)) return;
    p.tracks.push(trackId);
    saveLib();
  },
  removeFromPlaylist(id, index) {
    const p = library.playlist(id);
    if (!p) return;
    p.tracks.splice(index, 1);
    saveLib();
  },
  moveInPlaylist(id, from, to) {
    const p = library.playlist(id);
    if (!p || from < 0 || from >= p.tracks.length) return;
    const [x] = p.tracks.splice(from, 1);
    p.tracks.splice(clamp(to, 0, p.tracks.length), 0, x);
    saveLib();
  },
};

/* a shuffle that keeps the current track first, so playback never jumps */
function shuffledKeepFirst(order, firstIdx) {
  const rest = order.filter(i => i !== firstIdx);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [firstIdx, ...rest];
}
const seededShuffle = (order, seed) => {
  const out = order.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

class SynthPlayer {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.playing = false;
    this.offset = 0;         // seconds into track
    this.startedAt = 0;      // ctx time when offset began
    this.listeners = new Set();
    this.timer = null;
    this.step = 0;
    /* srcOrder is the list the user chose from (album, playlist, all songs);
       order is what actually plays — identical until shuffle rearranges it */
    this.srcOrder = TRACKS.map((_, i) => i);
    this.order = this.srcOrder.slice();
    this.qpos = 0;
    this.shuffle = false;
    this.repeat = 'off';          // off | all | one
    this.station = null;          // set while a radio station is tuned
    this.history = [];            // track ids in the order they started
  }
  get index() { return this.order[this.qpos] ?? 0; }
  get track() { return TRACKS[this.index]; }
  get volume() { return state.settings.volume; }
  get position() {
    if (!this.playing) return this.offset;
    return clamp(this.offset + (this.ctx.currentTime - this.startedAt), 0, this.track.duration);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(what = 'all') { this.listeners.forEach(fn => fn(what)); emit('music:change', this.snapshot()); }
  snapshot() {
    return {
      index: this.index, qpos: this.qpos, track: this.track, playing: this.playing,
      position: this.position, volume: state.settings.volume,
      shuffle: this.shuffle, repeat: this.repeat, station: this.station,
    };
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = state.settings.volume * 0.6;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  setVolume(v) {
    setSetting('volume', clamp(v, 0, 1));
    if (this.master) this.master.gain.setTargetAtTime(state.settings.volume * 0.6, this.ctx.currentTime, .02);
    this.changed('volume');
  }
  tone(freq, time, dur, gain, wave) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(gain, time + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.92);
    osc.connect(env); env.connect(this.master);
    osc.start(time); osc.stop(time + dur);
  }
  noise(time, gain, dur) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const env = ctx.createGain(); env.gain.value = gain;
    src.connect(hp); hp.connect(env); env.connect(this.master);
    src.start(time);
  }
  start() {
    this.ensure();
    this.playing = true;
    this.startedAt = this.ctx.currentTime;
    this.timer = setInterval(() => this.schedule(), 60);
    this.schedule();
    this.changed();
  }
  stopScheduling() { clearInterval(this.timer); this.timer = null; }
  schedule() {
    const track = this.track;
    const stepDur = 60 / track.bpm / 2;      // eighth notes
    const lookahead = 0.25;
    const now = this.ctx.currentTime;
    const elapsed = this.offset + (now - this.startedAt);
    if (elapsed >= track.duration) { this.advance(); return; }
    const first = Math.floor(elapsed / stepDur);
    const target = first + Math.ceil(lookahead / stepDur);
    for (let i = first; i < target; i++) {
      const when = this.startedAt + (i * stepDur - this.offset);
      if (when < now) continue;
      const idx = i % track.melody.length;
      const n = track.melody[idx];
      if (n != null) this.tone(mtof(n), when, stepDur * 1.5, 0.11 * track.bright, track.wave);
      const b = track.bass[i % track.bass.length];
      if (b != null) this.tone(mtof(b), when, stepDur * 1.9, 0.09, 'sine');
      if (i % 4 === 0) this.noise(when, 0.02, 0.05);
      if (i % 4 === 2) this.noise(when, 0.012, 0.04);
    }
  }
  play() {
    if (this.playing) return;
    if (this.offset >= this.track.duration - 0.05) this.offset = 0;
    this.noteTrack();
    this.start();
  }
  pause() {
    if (!this.playing) return;
    this.offset = this.position;
    this.playing = false;
    this.stopScheduling();
    this.changed();
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  /** a track counts as played the moment it starts, which is also when the
      station line in Up Next should carry it */
  noteTrack() {
    const id = this.track?.id;
    if (id && this.history[this.history.length - 1] !== id) {
      this.history.push(id);
      if (this.history.length > 40) this.history.shift();
    }
  }
  /** pick a track from the library by TRACKS index; the current list stays the
      queue when it already contains the track */
  select(i) {
    i = clamp(i, 0, TRACKS.length - 1);
    this.station = null;
    if (!this.srcOrder.includes(i)) {
      this.srcOrder = TRACKS.map((_, k) => k);
      this.order = this.shuffle ? shuffledKeepFirst(this.srcOrder, i) : this.srcOrder.slice();
    } else if (!this.order.includes(i)) this.order = this.srcOrder.slice();
    this.selectQ(this.order.indexOf(i));
  }
  /** play a whole list (album page, playlist, song table): indices into TRACKS */
  playQueue(indices, pos = 0) {
    if (!indices.length) return;
    this.station = null;
    this.srcOrder = indices.slice();
    this.order = indices.slice();
    let q = clamp(pos, 0, this.order.length - 1);
    if (this.shuffle) {
      this.order = shuffledKeepFirst(this.srcOrder, indices[q]);
      q = 0;
    }
    this.playing = false;
    this.stopScheduling();
    this.qpos = q;
    this.offset = 0;
    this.noteTrack();
    this.start();
  }
  /** a radio station is a seeded rotation that never stops */
  playStation(name) {
    const seed = [...String(name)].reduce((h, c) => h * 31 + c.charCodeAt(0), 7);
    this.station = name;
    this.srcOrder = seededShuffle(TRACKS.map((_, i) => i), seed);
    this.order = this.srcOrder.slice();
    this.qpos = 0;
    this.playing = false;
    this.stopScheduling();
    this.offset = 0;
    this.noteTrack();
    this.start();
  }
  selectQ(q) {
    const wasPlaying = this.playing;
    this.stopScheduling();
    this.playing = false;
    this.qpos = clamp(q, 0, this.order.length - 1);
    this.offset = 0;
    this.step = 0;
    if (wasPlaying) { this.noteTrack(); this.start(); } else this.changed();
  }
  /* manual Next always moves; the scheduler's own end-of-track path is advance() */
  next() { this.selectQ(this.qpos + 1 < this.order.length ? this.qpos + 1 : 0); }
  prev() {
    if (this.position > 3) { this.seek(0); return; }
    this.selectQ((this.qpos - 1 + this.order.length) % this.order.length);
  }
  advance() {
    if (this.repeat === 'one') { this.offset = 0; this.startedAt = this.ctx.currentTime; return; }
    if (this.qpos + 1 < this.order.length) { this.selectQ(this.qpos + 1); return; }
    if (this.repeat === 'all' || this.station) { this.selectQ(0); return; }
    /* end of the queue with repeat off: the record stops */
    this.playing = false;
    this.stopScheduling();
    this.offset = 0;
    this.changed();
  }
  setShuffle(on) {
    this.shuffle = !!on;
    const cur = this.index;
    this.order = this.shuffle ? shuffledKeepFirst(this.srcOrder, cur) : this.srcOrder.slice();
    this.qpos = this.order.indexOf(cur);
    this.changed('queue');
  }
  cycleRepeat() {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    this.changed('queue');
    return this.repeat;
  }
  /* the queue as seen in Up Next: [current, ...upcoming] as TRACKS indices */
  queue() { return this.order.slice(this.qpos); }
  upcoming() { return this.order.slice(this.qpos + 1); }
  /** insert a TRACKS index right after the current track ("Play Next") */
  queueNext(i) {
    if (!TRACKS[i]) return;
    this.order = this.order.filter(x => x !== i);
    this.order.splice(this.qpos + 1, 0, i);
    if (!this.srcOrder.includes(i)) this.srcOrder.push(i);
    this.changed('queue');
  }
  moveUpcoming(from, to) {
    const up = this.order.slice(this.qpos + 1);
    if (from < 0 || from >= up.length) return;
    const [x] = up.splice(from, 1);
    up.splice(clamp(to, 0, up.length), 0, x);
    this.order = [...this.order.slice(0, this.qpos + 1), ...up];
    this.changed('queue');
  }
  seek(seconds) {
    const wasPlaying = this.playing;
    this.stopScheduling();
    this.offset = clamp(seconds, 0, this.track.duration - 0.1);
    if (wasPlaying) this.start(); else this.changed();
  }
  tick() { if (this.playing) this.changed('position'); }
}
export const player = new SynthPlayer();

/* ── what other surfaces read ─────────────────────────────────────────────
   Control Center and the menu bar's Now Playing row build on this snapshot. */
export function nowPlaying() {
  return {
    track: player.track,
    playing: player.playing,
    position: player.position,
    duration: player.track?.duration ?? 0,
    station: player.station,
    shuffle: player.shuffle,
    repeat: player.repeat,
  };
}

/** hardware media keys (F7/F8/F9) land here — the global shortcut dispatcher
    owns the keys, this is the stable API it calls. */
export function mediaKey(action) {
  switch (String(action).toLowerCase()) {
    case 'play': player.play(); break;
    case 'pause': player.pause(); break;
    case 'playpause': case 'toggle': player.toggle(); break;
    case 'next': case 'fastforward': player.next(); break;
    case 'prev': case 'previous': case 'rewind': player.prev(); break;
  }
  return nowPlaying();
}

on('settings:change', ({ key } = {}) => {
  if (key === 'volume' && player.master) player.master.gain.setTargetAtTime(state.settings.volume * 0.6, player.ctx.currentTime, .02);
});
/* the dispatcher emits the chord; the player answers even with no Music window up */
on('media:key', ({ action }) => mediaKey(action));
setInterval(() => player.tick(), 250);
