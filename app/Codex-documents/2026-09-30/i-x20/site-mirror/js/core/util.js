// Small shared helpers: DOM building, event bus, formatting.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** el('div.cls#id', {attrs}, ...children) */
export function el(spec, props = null, ...children) {
  const m = /^([a-zA-Z0-9-]+)?(#[^.]+)?((?:\.[^.#]+)*)$/.exec(spec) || [];
  const node = document.createElement(m[1] || 'div');
  if (m[2]) node.id = m[2].slice(1);
  if (m[3]) node.className = m[3].split('.').filter(Boolean).join(' ');
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'list' && typeof v !== 'object') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  add(node, children);
  return node;
}
function add(node, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) add(node, c);
    else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Build an element tree from a compact array spec. */
export const frag = (...nodes) => { const f = document.createDocumentFragment(); add(f, nodes); return f; };

/* ── event bus ─────────────────────────────────────────────────────── */
const listeners = new Map();
export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => off(topic, fn);
}
export function off(topic, fn) { listeners.get(topic)?.delete(fn); }
export function emit(topic, payload) {
  for (const fn of Array.from(listeners.get(topic) || [])) {
    try { fn(payload); } catch (err) { console.error(`[bus:${topic}]`, err); }
  }
}

/* ── math / timing ─────────────────────────────────────────────────── */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** macOS sliders fill from the left; keep --fill in step with the value */
export function syncRangeFill(input) {
  if (!input) return;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const pct = max === min ? 0 : ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`);
}
export function syncRangeFills(root = document) {
  if (root.matches?.('.range')) syncRangeFill(root);
  root.querySelectorAll?.('.range').forEach(syncRangeFill);
}
export function watchRangeFills() {
  document.addEventListener('input', e => { if (e.target.classList?.contains('range')) syncRangeFill(e.target); });
  syncRangeFills();
  /* windows build their own toolbars, so watch for sliders that arrive later */
  const host = document.getElementById('windows') || document.body;
  new MutationObserver(muts => {
    for (const m of muts) for (const node of m.addedNodes) if (node.nodeType === 1) syncRangeFills(node);
  }).observe(host, { childList: true, subtree: true });
}
export const round = (v, p = 0) => { const f = 10 ** p; return Math.round(v * f) / f; };
export function rafThrottle(fn) {
  let queued = false, lastArgs;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...lastArgs); });
  };
}
export function debounce(fn, ms = 120) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ── formatting ────────────────────────────────────────────────────── */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = MONTHS;
export const pad2 = n => String(n).padStart(2, '0');
export function fmtClock(d = new Date()) {
  let h = d.getHours(); const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad2(d.getMinutes())} ${ampm}`;
}
export function menuClock(d = new Date()) {
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${fmtClock(d)}`;
}export function fmtNoteDate(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : ', ' + d.getFullYear()}`;
}
export function fmtStamp(ts) {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${fmtClock(d)}`;
}
export function fmtSize(bytes) {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1e6) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;
}
export const fileSize = str => new Blob([str ?? '']).size;

/* ── strings ───────────────────────────────────────────────────────── */
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function fuzzy(needle, haystack) {
  const n = needle.toLowerCase(), h = haystack.toLowerCase();
  if (!n) return { score: 0, ranges: [] };
  const direct = h.indexOf(n);
  if (direct >= 0) return { score: 1000 - direct * 2 - (h.length - n.length) * .2, ranges: [[direct, direct + n.length]] };
  let hi = 0, score = 0, streak = 0; const ranges = [];
  for (const ch of n) {
    if (ch === ' ') continue;
    const found = h.indexOf(ch, hi);
    if (found < 0) return null;
    if (found === hi && hi > 0) { streak++; score += 6 + streak * 2; } else { streak = 0; score += 2; }
    const last = ranges[ranges.length - 1];
    if (last && last[1] === found) last[1] = found + 1; else ranges.push([found, found + 1]);
    hi = found + 1;
  }
  score -= hi * .3;
  if (h.startsWith(n)) score += 40;
  return { score, ranges };
}
export function highlight(text, ranges) {
  if (!ranges?.length) return esc(text);
  let out = '', at = 0;
  for (const [a, b] of ranges) { out += esc(text.slice(at, a)) + '<b>' + esc(text.slice(a, b)) + '</b>'; at = b; }
  return out + esc(text.slice(at));
}
export const baseName = p => String(p).split('/').filter(Boolean).pop() || '/';
export const dirName = p => { const parts = String(p).split('/').filter(Boolean); parts.pop(); return '/' + parts.join('/'); };
export const joinPath = (...parts) => {
  const joined = parts.filter(p => p !== '' && p != null).join('/');
  return '/' + joined.split('/').filter((s, i) => s || i === 0).join('/').replace(/\/+/g, '/');
};
export function tildify(p) {
  if (p === fs_home()) return '~';
  if (p.startsWith(fs_home() + '/')) return '~' + p.slice(fs_home().length);
  return p;
}
export const fs_home = () => '/Users/bunny';
export const uid = (() => { let n = 0; return p => `${p}${(++n).toString(36)}${Date.now().toString(36).slice(-3)}`; })();

/* ── math expressions (Spotlight) ──────────────────────────────────── */
export function evalMath(src) {
  const text = String(src).trim();
  if (!text || !/^[\d\s+\-*/%().,×÷^]+$/.test(text)) return null;
  if (!/[+\-*/%×÷^]/.test(text)) return null;
  try {
    const expr = text.replace(/×/g, '*').replace(/÷/g, '/').replace(/\^/g, '**').replace(/,/g, '');
    if (!/[+\-*/%]/.test(expr)) return null;
    const result = Function(`"use strict";return (${expr})`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    return round(result, 10);
  } catch { return null; }
}
export const fmtNumber = n => {
  if (n === null || n === undefined || Number.isNaN(n)) return 'Not a number';
  if (!Number.isFinite(n)) return 'Infinity';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) return n.toExponential(6).replace(/e([+-])(\d)$/, 'e$10$2');
  const s = round(n, 10).toString();
  return s.includes('e') ? Number(n).toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 10 });
};

/* the alert sounds System Settings offers, each with its own pitch */
const SOUND_HZ = { Boop: 660, Blow: 420, Bubble: 990, Crystal: 1180, Funk: 520, Glass: 1320, Hero: 780, Jump: 860, Meep: 700, Pop: 940, Purr: 380, Sosumi: 1050, Tink: 1240 };
export const SOUND_NAMES = Object.keys(SOUND_HZ);
let alertName = 'Boop';
/** which sound the alert plays; Settings changes it and it is used on the next beep */
export function setAlertSound(name) { if (SOUND_HZ[name]) alertName = name; }
export const alertSound = () => alertName;

/** the alert beep, the way macOS answers a key it cannot use */
export function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(SOUND_HZ[alertSound()] ?? 880, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
    setTimeout(() => ctx.close(), 400);
  } catch { /* no audio, no beep */ }
}
