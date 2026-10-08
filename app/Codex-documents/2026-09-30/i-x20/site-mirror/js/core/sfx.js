// System sounds: every effect is synthesized with Web Audio, nothing is loaded.
//
// Two ways in. Call a function directly (shot.js calls `screenshot()`), or emit
// on the event bus — `emit('sfx', { name: 'trash' })` plays `trash()` — which is
// how modules that do not own this file (dock, wm, notify) request a sound.
import { on, emit } from './util.js';
import { state as storeState } from './store.js';
import { player } from './audio.js';

const SOUND_HZ = { Boop: 660, Blow: 420, Bubble: 990, Crystal: 1180, Funk: 520, Glass: 1320, Hero: 780, Jump: 860, Meep: 700, Pop: 940, Purr: 380, Sosumi: 1050, Tink: 1240 };

/* Chrome only lets an AudioContext start after a real user gesture, so sounds
   requested before the first click — or from a synthetic event — stay silent
   instead of logging an autoplay warning. Once the context exists it resumes. */
const ctxOf = () => {
  try {
    if (!player.ctx && !navigator.userActivation?.hasBeenActive) return null;
    return player.ensure();
  } catch { return null; }
};

function tone({ at = 0, from = 440, to = null, dur = .12, gain = .06, type = 'sine' }) {
  const ctx = ctxOf();
  if (!ctx || !player.master) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
  env.gain.setValueAtTime(.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(.012, dur * .2));
  env.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  osc.connect(env); env.connect(player.master);
  osc.start(t0); osc.stop(t0 + dur + .02);
}

function hiss({ at = 0, dur = .08, gain = .05, freq = 2000, q = .8, to = null, type = 'bandpass' }) {
  const ctx = ctxOf();
  if (!ctx || !player.master) return;
  const t0 = ctx.currentTime + at;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = type; filter.frequency.setValueAtTime(freq, t0); filter.Q.value = q;
  if (to != null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + .008);
  env.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  src.connect(filter); filter.connect(env); env.connect(player.master);
  src.start(t0);
}

/* the alert beep Settings picks a voice for; name falls back to Boop */
export function playAlert(name = 'Boop') {
  const freq = SOUND_HZ[name] ?? SOUND_HZ.Boop;
  const v = Math.max(0, Math.min(1, Number(storeState.settings.alertVolume ?? 1)));
  tone({ from: freq, to: freq / 1.4, dur: .18, gain: .1 * v, type: name === 'Blow' || name === 'Purr' ? 'sine' : 'triangle' });
  emit('sfx:played', { name: 'alert', voice: name });
}

/* paper crumple when something lands in the Trash */
export function trash() {
  hiss({ dur: .09, gain: .09, freq: 2600, q: .6 });
  hiss({ at: .05, dur: .12, gain: .08, freq: 1400, q: 1.2 });
  tone({ at: .02, from: 300, to: 90, dur: .14, gain: .05, type: 'triangle' });
  emit('sfx:played', { name: 'trash' });
}

/* two mechanical clicks plus a hiss: the camera shutter */
export function screenshot() {
  const ctx = ctxOf();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [at, freq, gain] of [[0, 2400, .10], [.055, 1700, .07]]) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now + at);
    osc.frequency.exponentialRampToValueAtTime(freq * .55, now + at + .04);
    env.gain.setValueAtTime(.0001, now + at);
    env.gain.exponentialRampToValueAtTime(gain, now + at + .004);
    env.gain.exponentialRampToValueAtTime(.0001, now + at + .05);
    osc.connect(env); env.connect(player.master);
    osc.start(now + at); osc.stop(now + at + .07);
  }
  hiss({ dur: .05, gain: .06, freq: 3200 });
  emit('sfx:played', { name: 'screenshot' });
}

/* the tick when a volume step changes */
export function volumePop() {
  tone({ from: 1600, dur: .035, gain: .07, type: 'sine' });
  emit('sfx:played', { name: 'volumePop' });
}

/* the startup chime: a C-major swell, roughly the modern Mac voicing */
export function bootChime() {
  const ctx = ctxOf();
  if (!ctx || !player.master) return;
  const now = ctx.currentTime;
  /* C3 G3 C4 E4 G4 with a slow attack and a long, soft decay */
  for (const [at, freq, gain, dur] of [[0, 130.81, .10, 2.6], [.02, 196.0, .07, 2.4], [.04, 261.63, .09, 2.8], [.06, 329.63, .08, 2.6], [.08, 392.0, .05, 2.4]]) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    env.gain.setValueAtTime(.0001, now + at);
    env.gain.exponentialRampToValueAtTime(gain, now + at + .28);
    env.gain.exponentialRampToValueAtTime(.0001, now + at + dur);
    osc.connect(env); env.connect(player.master);
    osc.start(now + at); osc.stop(now + at + dur + .05);
  }
  emit('sfx:played', { name: 'bootChime' });
}

/* a little whoosh for windows flying into the Dock */
export function moveToDock() {
  hiss({ dur: .16, gain: .06, freq: 3200, to: 700, q: 1.4 });
  tone({ from: 620, to: 210, dur: .15, gain: .035, type: 'sine' });
  emit('sfx:played', { name: 'moveToDock' });
}

/* the suction sweep of the Genie minimize effect */
export function genie() {
  hiss({ dur: .22, gain: .05, freq: 900, to: 3400, q: 2 });
  tone({ from: 220, to: 880, dur: .2, gain: .03, type: 'triangle' });
  emit('sfx:played', { name: 'genie' });
}

const SOUNDS = { alert: playAlert, trash, screenshot, volumePop, bootChime, moveToDock, genie };

/* the bus hook: emit('sfx', { name }) plays the named sound from anywhere */
on('sfx', ({ name, arg } = {}) => { const fn = SOUNDS[name]; if (fn) try { fn(arg); } catch { /* sounds never throw */ } });
