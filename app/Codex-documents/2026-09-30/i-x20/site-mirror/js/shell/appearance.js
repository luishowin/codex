// Applies saved settings to the document: appearance, accent, wallpaper, dock, brightness.
import { state, setSetting } from '../core/store.js';
import { el, emit, on, setAlertSound } from '../core/util.js';
import { wallpaperCSS, wallpaperTint } from '../core/wallpaper.js';

export const ACCENTS = {
  blue: { light: '#007aff', dark: '#0a84ff' },
  purple: { light: '#af52de', dark: '#bf5af2' },
  pink: { light: '#f5397f', dark: '#ff375f' },
  red: { light: '#e02726', dark: '#ff453a' },
  orange: { light: '#f78000', dark: '#ff9f0a' },
  yellow: { light: '#d99b00', dark: '#ffd60a' },
  green: { light: '#2fa84f', dark: '#30d158' },
  graphite: { light: '#6e6e73', dark: '#98989d' },
};
export const ACCENT_NAMES = Object.keys(ACCENTS);
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function resolvedAppearance() {
  const pref = state.settings.appearance;
  if (pref === 'auto') return darkQuery.matches ? 'dark' : 'light';
  return pref;
}
export function isDark() { return resolvedAppearance() === 'dark'; }

export function applySettings() {
  const s = state.settings;
  const dark = isDark();
  document.documentElement.dataset.appearance = dark ? 'dark' : 'light';
  const accent = ACCENTS[s.accent] || ACCENTS.blue;
  const root = document.documentElement.style;
  root.setProperty('--accent', dark ? accent.dark : accent.light);
  root.setProperty('--accent-contrast', s.accent === 'yellow' && !dark ? '#111' : '#fff');
  root.setProperty('--dock-icon', s.dockSize + 'px');
  const wall = document.getElementById('wallpaper');
  if (wall) wall.style.backgroundImage = wallpaperCSS(s.wallpaper);
  const dim = document.getElementById('brightness');
  if (dim) dim.style.opacity = String(Math.max(0, (1 - s.brightness) * 0.72));

  /* the display settings are not stored for show: each one is applied here.
     Keys consumed: reduceTransparency, increaseContrast | highContrast,
     reduceMotion | reducedMotion, nightShift (0-100), sidebarSize
     (Small|Medium|Large), wallpaperTint (default on). */
  const html = document.documentElement;
  const hiContrast = !!(s.highContrast || s.increaseContrast);
  const noMotion = !!(s.reducedMotion || s.reduceMotion);
  html.dataset.contrast = hiContrast ? 'high' : 'normal';
  html.dataset.transparency = s.reduceTransparency ? 'off' : 'on';
  html.dataset.motion = noMotion ? 'reduce' : 'full';
  html.classList.toggle('reduce-motion', noMotion);
  html.classList.toggle('increase-contrast', hiContrast);
  document.body.classList.toggle('no-transparency', !!s.reduceTransparency);
  const sidebar = String(s.sidebarSize || 'Medium').toLowerCase();
  html.dataset.sidebar = sidebar;
  root.setProperty('--zoom', String(s.zoom || 1));
  root.setProperty('--sb-row', sidebar === 'small' ? '20px' : sidebar === 'large' ? '32px' : '25px');
  root.setProperty('--warmth', String((s.nightShift || 0) / 100));
  root.setProperty('--low-power', s.lowPower ? '1' : '0');
  /* wallpaper tinting tints window chrome with the scene's dominant hue */
  const tintOn = s.wallpaperTint !== false;
  html.dataset.tint = tintOn ? 'on' : 'off';
  root.setProperty('--wall-tint', wallpaperTint(s.wallpaper));
  applyZoom();
  emit('appearance:change', { dark, appearance: dark ? 'dark' : 'light' });
}

/** Zoom: the whole screen scales, and Control-scroll changes it, like macOS */
export function applyZoom() {
  const z = state.settings.zoom || 1;
  document.documentElement.style.setProperty('--zoom', String(z));
}
export function nudgeZoom(delta) {
  const z = Math.min(2, Math.max(1, Math.round(((state.settings.zoom || 1) + delta) * 10) / 10));
  if (z === state.settings.zoom) return;
  setSetting('zoom', z);
  const t = document.getElementById('toast-zoom');
  if (t) { t.textContent = `${Math.round(z * 100)}%`; t.classList.add('on'); clearTimeout(nudgeZoom._t); nudgeZoom._t = setTimeout(() => t.classList.remove('on'), 900); }
}


export function initAppearance() {
  applySettings();
  on('settings:change', applySettings);
  darkQuery.addEventListener?.('change', () => { if (state.settings.appearance === 'auto') applySettings(); });
  document.documentElement.dataset.truetone = state.settings.trueTone === false ? 'off' : 'on';
  on('settings:change', ({ key }) => {
    if (key === 'trueTone') document.documentElement.dataset.truetone = state.settings.trueTone === false ? 'off' : 'on';
    if (key === 'alertSound') setAlertSound(state.settings.alertSound);
  });
  initAccessibility();
}

/* ── accessibility that actually runs ─────────────────────────────────── */
function initAccessibility() {
  /* Zoom: Control and a scroll wheel, exactly like macOS */
  window.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    nudgeZoom(e.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });

  /* VoiceOver: reads the focused control out loud, with a visible caption */
  const cap = document.getElementById('vo-caption');
  let last = '';
  const speak = (text) => {
    if (!text || text === last) return;
    last = text;
    if (cap) {
      cap.replaceChildren(el('b', { text: 'VoiceOver' }), el('span', { text }));
      cap.classList.add('on');
      clearTimeout(speak._t);
      speak._t = setTimeout(() => cap.classList.remove('on'), 2200);
    }
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch { /* no voice, no sound */ }
  };
  const labelFor = (node) => {
    if (!node || node === document.body) return '';
    const t = (node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title'))) || node.textContent || '';
    return String(t).replace(/\s+/g, ' ').trim().slice(0, 120);
  };
  document.addEventListener('focusin', () => {
    if (state.settings.voiceOver) speak(labelFor(document.activeElement));
  });
  document.addEventListener('mouseover', () => {
    if (state.settings.voiceOver) speak(labelFor(event.target));
  });
}
