// Spotlight: ranked live search over apps, files, notes, music and settings,
// with a safe expression evaluator (no eval), unit and currency conversion,
// a right-hand preview pane and a Wikipedia lookup for "define word".
import { el, highlight, fuzzy, fmtNumber, fmtSize, fmtStamp, round, dirName } from '../core/util.js';
import { appIcon, fileIcon, glyph } from '../core/icons.js';
import { allApps, launch, isInstalled } from '../core/os.js';
import * as fs from '../core/fs.js';
import { state } from '../core/store.js';
import { notify } from './notify.js';
import { player, TRACKS } from '../core/audio.js';

let panel = null, scrim = null, input = null, list = null, preview = null;
let results = [], cursor = 0, wikiSeq = 0;

export function isSpotlightOpen() { return !!panel && panel.isConnected; }

export function openSpotlight(initial = '') {
  if (panel && !panel.isConnected) panel = null;
  if (panel) { input?.focus(); input.select(); return; }
  scrim = el('div.overlay', { style: { zIndex: 11000 } });
  panel = el('div.glass', { id: 'spotlight', role: 'dialog', 'aria-label': 'Spotlight Search' });
  input = el('input', { type: 'text', placeholder: 'Spotlight Search', spellcheck: 'false', value: initial });
  const search = el('div.sp-search', null, el('div', { html: glyph('search', 'sp-glyph') }), input);
  list = el('div.sp-results.scroll');
  preview = el('div.sp-preview');
  panel.append(search, el('div.sp-body', null, list, preview));
  scrim.append(panel);
  document.getElementById('overlays').append(scrim);
  input.addEventListener('input', () => update(input.value));
  input.addEventListener('keydown', onKey);
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim) closeSpotlight(); });
  update(initial);
  setTimeout(() => input.focus(), 20);
}
export function closeSpotlight() {
  wikiSeq++;
  scrim?.remove();
  panel = null; input = null; list = null; preview = null; results = [];
}
export function toggleSpotlight() { panel ? closeSpotlight() : openSpotlight(); }

/* ── keyboard ──────────────────────────────────────────────────────── */
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeSpotlight(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const item = results[cursor];
    if (e.metaKey || e.ctrlKey) reveal(item);
    else run(item);
  } else if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
    e.preventDefault();
    webSearch(input.value);
  } else if ((e.metaKey || e.ctrlKey) && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    reveal(results[cursor]);
  }
}
function move(dir) {
  if (!results.length) return;
  cursor = (cursor + dir + results.length) % results.length;
  paintSelection();
}
function paintSelection() {
  const rows = list.querySelectorAll('.sp-row');
  rows.forEach(r => r.classList.toggle('sel', Number(r.dataset.i) === cursor));
  [...rows].find(r => Number(r.dataset.i) === cursor)?.scrollIntoView({ block: 'nearest' });
  paintPreview();
}
function run(item) {
  if (!item) return;
  /* recent picks surface above the empty-state prompt next time */
  if (state.settings.spotlightRecents !== false && item.title) {
    const rec = (state.settings.spotRecentsList ||= []);
    const i = rec.findIndex(r => r.title === item.title);
    if (i >= 0) rec.splice(i, 1);
    rec.unshift({ title: item.title, kind: item.kind });
    rec.length = Math.min(rec.length, 6);
  }
  closeSpotlight();
  setTimeout(() => item.run(), 10);
}
function reopenRecent(title) {
  const hit = allApps().find(a => a.name === title);
  if (hit) { launch(hit.id); return; }
  input.value = title;
  update(title);
}
function reveal(item) {
  if (!item) return;
  if (item.reveal) { closeSpotlight(); setTimeout(() => item.reveal(), 10); }
  else run(item);
}
function webSearch(q) {
  const query = String(q || '').trim();
  if (!query) return;
  closeSpotlight();
  launch('safari', { url: 'https://www.google.com/search?igu=1&q=' + encodeURIComponent(query) });
}

/* ── safe math evaluator ─────────────────────────────────────────────
   Tokeniser + recursive descent. No eval, no Function. Grammar:
     expr    := term (('+'|'-') term)*
     term    := unary (('*'|'/'|'%' value) unary)*
     unary   := ('-'|'+') unary | postfix
     postfix := power ('!' | trailing '%')*
     power   := primary ('^' power)?          (right-associative)
     primary := number | const | func '(' expr ')' | '(' expr ')' | '√' unary
   Implicit multiplication is inserted between a value and a following
   value/opener, so 2(3), 2π and (2)(3) all compute. */
const MATH_CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2, '∞': Infinity };
const MATH_FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  ln: Math.log, log: Math.log10, log2: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: x => Math.round(x), exp: Math.exp,
};
function tokenizeMath(text) {
  const s = text.replace(/×/g, '*').replace(/÷/g, '/');
  const raw = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === ',') { i++; continue; }
    if (/[\d.]/.test(c)) {
      const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
      if (!m) return null;
      raw.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if (/[a-zA-Zπ√∞]/.test(c)) {
      const m = s.slice(i).match(/^[a-zA-Z][a-zA-Z0-9]*|^π|^√|^∞/);
      if (!m) return null;
      raw.push({ t: 'id', v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ('+-*/%^()!'.includes(c)) {
      raw.push({ t: 'op', v: c });
      i++;
    } else return null;
  }
  /* splice in the implied multiplications */
  const isValue = tk => tk.t === 'num' || (tk.t === 'id' && MATH_CONSTS[tk.v] !== undefined) || (tk.t === 'op' && (tk.v === ')' || tk.v === '!'));
  const opensValue = tk => tk.t === 'num' || tk.t === 'id' || (tk.t === 'op' && tk.v === '(');
  const out = [];
  for (const tk of raw) {
    if (out.length) {
      const prev = out[out.length - 1];
      if (isValue(prev) && opensValue(tk)) out.push({ t: 'op', v: '*' });
    }
    out.push(tk);
  }
  return out;
}
const factorial = n => {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw 'x';
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
};
function parseMath(tk) {
  let i = 0;
  const peek = () => tk[i];
  const peek2 = () => tk[i + 1];
  const take = () => tk[i++];
  const isOp = (t, v) => !!t && t.t === 'op' && t.v === v;
  const opensValue = t => !!t && (t.t === 'num' || t.t === 'id' || isOp(t, '('));
  function expr() {
    let v = term();
    while (isOp(peek(), '+') || isOp(peek(), '-')) v = take().v === '+' ? v + term() : v - term();
    return v;
  }
  function term() {
    let v = unary();
    for (;;) {
      const t = peek();
      if (isOp(t, '*')) { take(); v *= unary(); }
      else if (isOp(t, '/')) { take(); v /= unary(); }
      else if (isOp(t, '%') && opensValue(peek2())) { take(); v %= unary(); }
      else break;
    }
    return v;
  }
  function unary() {
    if (isOp(peek(), '-')) { take(); return -unary(); }
    if (isOp(peek(), '+')) { take(); return unary(); }
    return postfix();
  }
  function postfix() {
    let v = power();
    for (;;) {
      if (isOp(peek(), '!')) { take(); v = factorial(v); }
      /* a trailing % is a percentage (50% → .5); between operands it is modulo */
      else if (isOp(peek(), '%') && (!peek2() || isOp(peek2(), ')'))) { take(); v /= 100; }
      else break;
    }
    return v;
  }
  function power() {
    const base = primary();
    if (isOp(peek(), '^')) { take(); return Math.pow(base, power()); }
    return base;
  }
  function primary() {
    const t = take();
    if (!t) throw 'x';
    if (t.t === 'num') return t.v;
    if (t.t === 'id') {
      if (MATH_FUNCS[t.v]) {
        if (!isOp(peek(), '(')) throw 'x';
        take();
        const arg = expr();
        if (!isOp(peek(), ')')) throw 'x';
        take();
        return MATH_FUNCS[t.v](arg);
      }
      if (MATH_CONSTS[t.v] !== undefined) return MATH_CONSTS[t.v];
      if (t.v === '√') return Math.sqrt(unary());
      throw 'x';
    }
    if (isOp(t, '(')) {
      const v = expr();
      if (!isOp(peek(), ')')) throw 'x';
      take();
      return v;
    }
    throw 'x';
  }
  const v = expr();
  if (i !== tk.length) throw 'x';
  return v;
}
/** a number, or null when the text is not an expression */
export function safeMath(src) {
  const text = String(src).trim();
  if (!text) return null;
  const tk = tokenizeMath(text);
  if (!tk || tk.length > 200) return null;
  /* a lone identifier or empty parens should stay a search, not math */
  if (tk.length === 1 && tk[0].t !== 'num' && MATH_CONSTS[tk[0].v] === undefined) return null;
  try {
    const v = parseMath(tk);
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return round(v, 10);
  } catch { return null; }
}

/* ── conversions ───────────────────────────────────────────────────── */
const CONV = /^\s*(-?[\d.,]+)\s*([a-z°$€£]+)\s+(?:in|to|as)\s+([a-z°$€£]+)\s*$/i;
/* linear units, in terms of each family's base */
const UNIT_BASE = {
  m: 1, meter: 1, meters: 1, km: 1e3, kilometer: 1e3, kilometers: 1e3,
  cm: .01, mm: .001, mile: 1609.344, miles: 1609.344, mi: 1609.344,
  ft: .3048, foot: .3048, feet: .3048, inch: .0254, inches: .0254,
  yd: .9144, yard: .9144, yards: .9144, nmi: 1852,
  kg: 1, g: .001, gram: .001, grams: .001, lb: .45359237, lbs: .45359237,
  oz: .0283495231, ounce: .0283495231, ounces: .0283495231, ton: 907.1847,
  l: 1, liter: 1, liters: 1, ml: .001, gal: 3.785411784, gallon: 3.785411784, gallons: 3.785411784,
  qt: .946352946, pint: .473176473, pints: .473176473, cup: .2365882365, cups: .2365882365,
  sec: 1, s: 1, second: 1, seconds: 1, min: 60, minute: 60, minutes: 60,
  hr: 3600, hour: 3600, hours: 3600, day: 86400, days: 86400, week: 604800, weeks: 604800,
  ms: .001,
};
const TEMP = { f: 1, c: 1, k: 1 };
const tempToC = { f: v => (v - 32) * 5 / 9, c: v => v, k: v => v - 273.15 };
const tempFromC = { f: v => v * 9 / 5 + 32, c: v => v, k: v => v + 273.15 };
const TEMP_SYM = { f: '°F', c: '°C', k: 'K' };
/* rough fixed rates, like Spotlight's cached exchange table; base: usd */
const FX = {
  usd: 1, eur: .92, gbp: .79, jpy: 149.5, chf: .88, cad: 1.36, aud: 1.52,
  cny: 7.24, inr: 83.2, mxn: 17.1, brl: 4.97, krw: 1340,
};
const FX_SYM = { '$': 'usd', '€': 'eur', '£': 'gbp' };
const FX_NAME = { usd: 'USD', eur: 'EUR', gbp: 'GBP', jpy: 'JPY', chf: 'CHF', cad: 'CAD', aud: 'AUD', cny: 'CNY', inr: 'INR', mxn: 'MXN', brl: 'BRL', krw: 'KRW' };
export function conversion(q) {
  const m = CONV.exec(q);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const from = (FX_SYM[m[2]] || m[2]).toLowerCase();
  const to = (FX_SYM[m[3]] || m[3]).toLowerCase();
  if (TEMP[from] && TEMP[to]) {
    const v = tempFromC[to](tempToC[from](n));
    return { text: `${fmtNumber(n)} ${TEMP_SYM[from]} = ${fmtNumber(round(v, 2))} ${TEMP_SYM[to]}`, sub: 'Temperature conversion' };
  }
  if (FX[from] && FX[to]) {
    const v = n / FX[from] * FX[to];
    return { text: `${fmtNumber(n)} ${FX_NAME[from]} ≈ ${fmtNumber(round(v, 2))} ${FX_NAME[to]}`, sub: 'Currency conversion' };
  }
  if (UNIT_BASE[from] && UNIT_BASE[to]) {
    const v = n * UNIT_BASE[from] / UNIT_BASE[to];
    return { text: `${fmtNumber(n)} ${m[2]} = ${fmtNumber(round(v, 4))} ${m[3]}`, sub: 'Unit conversion' };
  }
  return null;
}

/* ── result sources ────────────────────────────────────────────────── */
/* tiers: 4 computed, 3 name-prefix, 2 name-substring, 1 content */
const KIND_ORDER = ['Calculator', 'Top Hit', 'Applications', 'Folders', 'Documents', 'Music', 'Notes', 'System Settings', 'Definition', 'Web'];
const PANES = [
  ['wifi', 'Wi-Fi'], ['bluetooth', 'Bluetooth'], ['network', 'Network'],
  ['notifications', 'Notifications'], ['sound', 'Sound'], ['focus', 'Focus'],
  ['screentime', 'Screen Time'], ['general', 'General'], ['appearance', 'Appearance'],
  ['accessibility', 'Accessibility'], ['controlcenter', 'Control Center'],
  ['siri', 'Siri & Spotlight'], ['privacy', 'Privacy & Security'], ['dock', 'Desktop & Dock'],
  ['displays', 'Displays'], ['wallpaper', 'Wallpaper'], ['screensaver', 'Screen Saver'],
  ['battery', 'Battery'], ['lock', 'Lock Screen'], ['touchid', 'Touch ID & Password'],
  ['users', 'Users & Groups'], ['internet', 'Internet Accounts'], ['gamecenter', 'Game Center'],
].map(([id, label]) => ({ id, label }));

function tierOf(q, name, content = '') {
  const n = name.toLowerCase();
  const qq = q.toLowerCase();
  if (n.startsWith(qq)) return 3;
  if (n.includes(qq)) return 2;
  if (content && content.toLowerCase().includes(qq)) return 1;
  return 0;
}
function fileReveal(path, node) {
  return () => launch('finder', { path: dirName(path), select: node.id });
}
function collect(q) {
  const out = [];
  /* apps: prefix before substring; Mail never surfaces */
  for (const app of allApps()) {
    if (app.id === 'mail' || !isInstalled(app.id)) continue;
    const t = tierOf(q, app.name);
    if (t) out.push({
      title: app.name, sub: 'Application', kind: 'Applications', tier: t,
      icon: appIcon(app.icon || app.id),
      run: () => launch(app.id),
      reveal: () => launch('finder', { path: '/Applications' }),
      preview: () => previewCard(appIcon(app.icon || app.id), app.name, 'Application', `/Applications/${app.name}.app`),
    });
  }
  /* files and folders */
  for (const hit of fs.search(q)) {
    const node = hit.node;
    const t = tierOf(q, node.name);
    if (!t) continue;
    const isDir = node.type === 'dir';
    out.push({
      title: node.name, sub: hit.path, kind: isDir ? 'Folders' : 'Documents', tier: t,
      icon: fileIcon(node), node, path: hit.path,
      run: () => openNode(hit),
      reveal: fileReveal(hit.path, node),
      preview: () => previewFile(node, hit.path),
    });
  }
  /* file contents, tier 1, text files only */
  if (q.length > 2) {
    for (const node of fs.walkAll()) {
      if (node.type === 'dir' || node.kind !== 'txt' || !node.content) continue;
      if (node.name.toLowerCase().includes(q.toLowerCase())) continue;   /* already a name hit */
      if (!node.content.toLowerCase().includes(q.toLowerCase())) continue;
      const path = fs.pathOf(node);
      out.push({
        title: node.name, sub: path, kind: 'Documents', tier: 1,
        icon: fileIcon(node), node, path,
        run: () => openNode({ node, path }),
        reveal: fileReveal(path, node),
        preview: () => previewFile(node, path),
      });
    }
  }
  /* notes */
  for (const note of state.notes || []) {
    const t = tierOf(q, note.title || '', note.body || '');
    if (!t) continue;
    out.push({
      title: note.title || 'New Note', sub: noteSnippet(note), kind: 'Notes', tier: t,
      icon: appIcon('notes'),
      run: () => launch('notes', { noteId: note.id }),
      preview: () => previewCard(appIcon('notes'), note.title || 'New Note', 'Notes', noteSnippet(note)),
    });
  }
  /* music */
  for (const tr of TRACKS) {
    const t = tierOf(q, tr.title, tr.artist + ' ' + tr.album);
    if (!t) continue;
    out.push({
      title: tr.title, sub: `${tr.artist} — ${tr.album}`, kind: 'Music', tier: t,
      icon: appIcon('music'),
      run: () => { player.select(TRACKS.indexOf(tr)); launch('music'); },
      preview: () => previewCard(appIcon('music'), tr.title, `${tr.artist} · ${tr.album}`, `${tr.genre} · ${tr.year}`),
    });
  }
  /* settings panes */
  for (const pane of PANES) {
    const t = tierOf(q, pane.label);
    if (!t) continue;
    out.push({
      title: pane.label, sub: 'System Settings', kind: 'System Settings', tier: t,
      icon: appIcon('settings'),
      run: () => launch('settings', { pane: pane.id }),
      preview: () => previewCard(appIcon('settings'), pane.label, 'System Settings', 'Opens the settings pane'),
    });
  }
  return out;
}

function update(raw) {
  const q = raw.trim();
  const mySeq = ++wikiSeq;
  results = [];
  list.replaceChildren();
  preview.replaceChildren();
  panel.classList.toggle('with-preview', false);
  if (!q) {
    const rec = state.settings.spotlightRecents !== false ? (state.settings.spotRecentsList || []) : [];
    if (rec.length) {
      list.append(el('div.sp-head', { text: 'Recent' }));
      rec.slice(0, 6).forEach(r => {
        const app = allApps().find(a => a.name === r.title);
        list.append(el('button.sp-row', {
          onclick: () => { input.value = ''; reopenRecent(r.title); },
        },
          el('i.sp-ic', { html: app ? appIcon(app.id) : glyph('search', 'sp-mini') }),
          el('span.sp-t', { text: r.title }),
          el('span.sp-k', { text: r.kind || '' }),
        ));
      });
    }
    list.append(el('div.sp-empty', { text: 'Search apps, files, notes and more' }));
    return;
  }
  /* computed answers always lead */
  const conv = conversion(q);
  const math = conv ? null : safeMath(q);
  if (conv) results.push({
    title: conv.text, sub: conv.sub, kind: 'Calculator', tier: 4, icon: glyph('search', 'sp-mini'),
    run: () => copyResult(conv.text),
    preview: () => previewMath(q, conv.text),
  });
  else if (math !== null) results.push({
    title: fmtNumber(math), sub: `= ${q}`, kind: 'Calculator', tier: 4, icon: glyph('search', 'sp-mini'),
    run: () => copyResult(fmtNumber(math)),
    preview: () => previewMath(q, fmtNumber(math)),
  });
  results.push(...collect(q));
  /* web search is always the backstop, like Spotlight's Search Web */
  results.push({
    title: `Search the Web for “${q}”`, sub: 'Safari', kind: 'Web', tier: 0, icon: appIcon('safari'),
    run: () => webSearch(q),
    preview: () => previewCard(appIcon('safari'), `“${q}”`, 'Web Search', 'Searches the web in Safari'),
  });
  /* rank: tier first, then short names win ties */
  results.sort((a, b) => b.tier - a.tier || a.title.length - b.title.length || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  /* "define word" and bare lookups ask Wikipedia for a summary */
  const def = /^define\s+(.+)/i.exec(q);
  const wantWiki = def ? def[1].trim() : (results.length <= 1 ? q : null);
  if (wantWiki) fetchWiki(wantWiki, mySeq);
  renderResults(q);
}

function insertDefinition(j, query) {
  const item = {
    title: j.title || query, sub: j.extract ? j.extract.slice(0, 140) + '…' : 'Wikipedia',
    kind: 'Definition', tier: .5, icon: appIcon('safari'),
    run: () => { closeSpotlight(); launch('safari', { url: j.content_urls?.desktop?.page || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(query)) }); },
    preview: () => previewCard(appIcon('safari'), j.title || query, 'Wikipedia', j.extract || 'No summary available'),
  };
  const webIdx = results.findIndex(r => r.kind === 'Web');
  results.splice(webIdx < 0 ? results.length : webIdx, 0, item);
  renderResults(input.value.trim(), cursor);
}

let wikiController = null;
async function fetchWiki(term, mySeq) {
  try {
    wikiController?.abort();
    const ctl = wikiController = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(term), { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok || mySeq !== wikiSeq) return;
    const j = await r.json();
    if (mySeq !== wikiSeq || !panel || !j.extract) return;
    insertDefinition(j, term);
  } catch { /* offline: the web-search row remains as the fallback */ }
}

function renderResults(q, keepCursor = -1) {
  cursor = keepCursor >= 0 ? Math.min(keepCursor, results.length - 1) : 0;
  list.replaceChildren();
  if (!results.length) {
    list.append(el('div.sp-empty', { text: `No results for “${q}”` }));
    return;
  }
  let grouped = null;
  results.forEach((item, i) => {
    /* the first result is the Top Hit; the rest group by kind */
    const group = i === 0 ? 'Top Hit' : item.kind;
    if (group !== grouped) {
      grouped = group;
      list.append(el('div.sp-group', { text: group }));
    }
    const ranges = fuzzy(q, item.title)?.ranges;
    const row = el('div.sp-row' + (i === cursor ? '.sel' : ''), { dataset: { i } },
      el('div.ic', { html: item.icon }),
      el('div', { style: { minWidth: 0 } },
        el('div.t.truncate', { html: highlight(item.title, ranges) }),
        el('div.sub.truncate', { text: item.sub })),
      el('div.kind', { text: item.kind === 'Web' ? 'Safari' : item.kind }),
    );
    row.addEventListener('click', () => run(item));
    row.addEventListener('pointerenter', () => { cursor = i; paintSelection(); });
    list.append(row);
  });
  paintSelection();
}
function paintPreview() {
  const item = results[cursor];
  preview.replaceChildren(item?.preview ? item.preview() : null);
  panel.classList.toggle('with-preview', !!item?.preview);
}

/* ── preview builders ──────────────────────────────────────────────── */
function previewCard(icon, title, sub, detail) {
  return el('div.spv-card', null,
    el('div.spv-icon', { html: icon }),
    el('div.spv-title', { text: title }),
    el('div.spv-sub', { text: sub }),
    detail ? el('div.spv-detail', { text: detail }) : null,
    el('div.spv-hint', { text: 'Return to open · ⌘B searches the web' }));
}
function previewFile(node, path) {
  const rows = [['Kind', node.kind || 'folder'], ['Size', node.type === 'dir' ? `${node.children.length} items` : fmtSize(node.content)], ['Modified', fmtStamp(node.modified)], ['Where', path]];
  return el('div.spv-card', null,
    el('div.spv-icon', { html: fileIcon(node) }),
    el('div.spv-title', { text: node.name }),
    el('div.spv-sub', { text: node.type === 'dir' ? 'Folder' : 'Document' }),
    el('table.spv-table', null, rows.map(([k, v]) => el('tr', null, el('td', { text: k }), el('td', { text: v })))),
    el('div.spv-hint', { text: 'Return to open · ⌘Return shows it in Finder' }));
}
function previewMath(expr, res) {
  return el('div.spv-card', null,
    el('div.spv-icon', { html: glyph('search', 'sp-mini') }),
    el('div.spv-title', { text: res }),
    el('div.spv-sub', { text: expr }),
    el('div.spv-detail', { text: 'Press Return to copy the result' }));
}

function noteSnippet(note) {
  const line = (note.body || '').split('\n').find(l => l.trim()) || 'No additional text';
  return line.length > 60 ? line.slice(0, 60) + '…' : line;
}
function openNode(hit) {
  if (hit.node.type === 'dir') launch('finder', { path: hit.path });
  else if (hit.node.kind === 'app') launch(hit.node.app);
  else if (hit.node.kind === 'txt') launch('textedit', { path: hit.path });
  else if (hit.node.kind === 'audio') { player.select(trackIndexFor(hit.node)); launch('music'); }
  else if (hit.node.kind === 'image') launch('photos', { path: hit.path });
  else launch('finder', { path: dirName(hit.path), select: hit.node.id });
}
function trackIndexFor(node) {
  const i = TRACKS.findIndex(t => t.id === node.song);
  return i < 0 ? 0 : i;
}
async function copyResult(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify('Spotlight', `Copied ${text} to the clipboard`);
  } catch {
    notify('Spotlight', text);
  }
}
