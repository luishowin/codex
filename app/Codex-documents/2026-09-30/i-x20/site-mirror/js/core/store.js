// Persistent OS state: settings, notes, filesystem tree, window records.
import { emit } from './util.js';

// v3 prefs: brightness now defaults to 1, so a fresh Mac is not dimmed by a
// 6% black veil sitting over every white surface. The filesystem key stays on
// v2 so saved files, notes and windows survive the settings migration.
const KEY = 'macos.state.v2';
const PREFS = 'macos.prefs.v3';
const LEGACY_PREFS = 'macos.prefs.v2';

const defaultSettings = () => ({
  appearance: 'light',      // auto | light | dark
  accent: 'blue',
  wallpaper: 'sequoia',
  dockSize: 56,
  dockMagnify: true,
  minimizeEffect: 'Genie',
  brightness: 1,
  volume: 0.55,
  wifi: true,
  bluetooth: true,
  airdrop: 'Everyone',
  focus: false,
  darkTile: true,
  userName: 'bunny',
  hostName: 'MacBook Pro',
  booted: false,
  reducedMotion: false,
  highContrast: false,
  reduceTransparency: false,
  zoom: 1,
  sidebarSize: 'Medium',
  lowPower: false,
  trueTone: true,
  nightShift: 0,
  alertSound: 'Boop',
  notifStyle: 'Banners',
  voiceOver: false,
  ccMenuBar: ['battery', 'wifi', 'spotlight', 'controlcenter', 'siri'],
  stageManager: false,
});

/** the old v2 prefs carried brightness 0.92, which dimmed every white surface */
function readPrefs() {
  const saved = readJSON(PREFS, null);
  if (saved) return saved;
  const legacy = readJSON(LEGACY_PREFS, null);
  if (!legacy) return {};
  const migrated = { ...legacy };
  if (migrated.brightness === 0.92) migrated.brightness = 1;
  return migrated;
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const val = JSON.parse(raw);
    return val && typeof val === 'object' ? val : fallback;
  } catch (err) {
    console.warn('store: unreadable state, starting fresh', err);
    return fallback;
  }
}

export const state = {
  settings: { ...defaultSettings(), ...readPrefs() },
  fs: null,
  notes: [],
  notesSeeded: false,
  windows: [],
};

let saveTimer = null;
let resetting = false;
/** While resetting, nothing may be written back to storage. */
export const isResetting = () => resetting;
export function beginReset() { resetting = true; clearTimeout(saveTimer); }
export function endReset() { resetting = false; }

export function save() {
  if (resetting) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ fs: state.fs, notes: state.notes, notesSeeded: state.notesSeeded, windows: state.windows }));
      localStorage.setItem(PREFS, JSON.stringify(state.settings));
    } catch (err) {
      console.warn('store: could not persist state', err);
    }
  }, 90);
}
export function saveNow() {
  if (resetting) return;
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify({ fs: state.fs, notes: state.notes, notesSeeded: state.notesSeeded, windows: state.windows }));
    localStorage.setItem(PREFS, JSON.stringify(state.settings));
  } catch (err) { console.warn('store: could not persist state', err); }
}

export function loadPersisted() {
  resetting = false;
  const data = readJSON(KEY, null);
  if (data) {
    state.fs = data.fs || null;
    state.notes = Array.isArray(data.notes) ? data.notes : [];
    state.notesSeeded = !!data.notesSeeded;
    state.windows = Array.isArray(data.windows) ? data.windows : [];
  }
  return data;
}

export function setSetting(key, value) {
  if (state.settings[key] === value) return;
  state.settings[key] = value;
  save();
  emit('settings:change', { key, value, settings: state.settings });
}
export function patchSettings(patch) {
  let changed = false;
  for (const [k, v] of Object.entries(patch)) if (state.settings[k] !== v) { state.settings[k] = v; changed = true; }
  if (!changed) return;
  save();
  emit('settings:change', { settings: state.settings });
}

/* window records survive reload: {app, key, rect, state, data} */
export function saveWindow(record) {
  const i = state.windows.findIndex(w => w.app === record.app && w.key === record.key);
  if (i >= 0) state.windows[i] = record; else state.windows.push(record);
  save();
}
export function dropWindow(app, key) {
  state.windows = state.windows.filter(w => !(w.app === app && w.key === key));
  save();
}
export const savedWindows = () => state.windows.slice();
