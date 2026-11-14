/* Codex — application shell.

   One window, no fake desktop. Routes live in the hash so the app works as
   a plain page, inside a Tauri webview, and from a /read permalink. The
   reader, the shelf and the command chrome are all real; the cassette
   service is the one thing the library fixture stands in for. */

import { esc, num, copyText, pretty, highlight } from './util.js';
import { api, library } from './api.js';
import * as homeView from './views/home.js';
import * as articleView from './views/article.js';
import * as libraryView from './views/library.js';
import * as cassetteView from './views/cassette.js';
import * as searchView from './views/search.js';
import * as browseView from './views/browse.js';
import * as settingsView from './views/settings.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const icon = n => `<svg class="i"><use href="#i-${n}"/></svg>`;

const NS = 'codex.';
const store = {
  get(k, d) { try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  del(k) { try { localStorage.removeItem(NS + k); } catch (e) { /* ignore */ } },
};

const S = {
  theme: store.get('theme', 'auto'),
  readerFont: store.get('readerFont', 'sans'),
  fz: store.get('fz', 1),
  mode: store.get('mode', 'title'),
  recent: store.get('recent', []),
  marks: store.get('marks', []),
  tab: store.get('tab', 'toc'),
  sheet: false,
  route: { k: 'home' },
  hist: [], hi: -1,
  doc: null,
  results: [], rsel: 0,
  scroll: {},
  catalog: [],
  cassettes: [],
  libraryMock: true,
  offline: false,
};

const viewEl = $('#view');
const scrollEl = $('#scroll');
const qEl = $('#q');
const spEl = $('#sp');
const sheetEl = $('#sheet');
const slEl = $('#sl');

/* ---------- theme, route keys ---------- */
const mqDark = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const t = S.theme === 'auto' ? (mqDark.matches ? 'dark' : 'light') : S.theme;
  document.documentElement.dataset.theme = t;
  document.documentElement.style.setProperty('--fz', S.fz);
}
function setTheme(t) {
  S.theme = t; store.set('theme', t); applyTheme();
  toast(t === 'auto' ? 'Following the system' : `${t[0].toUpperCase()}${t.slice(1)} theme`);
  rerenderIfSettings();
}

const key = r => r.k === 'article' ? `a/${r.codex}/${r.id}`
  : r.k === 'cassette' ? `c/${r.name}`
  : r.k === 'search' ? `search/${r.q}`
  : r.k === 'browse' ? `browse/${r.codex}/${r.letter || 'A'}`
  : r.k;

function toHash(r) {
  const e = encodeURIComponent;
  switch (r.k) {
    case 'article': return `#/a/${e(r.codex)}/${r.id}`;
    case 'cassette': return `#/c/${e(r.name)}`;
    case 'search': return `#/search/${e(r.q)}`;
    case 'browse': return `#/browse/${e(r.codex)}/${e(r.letter || 'A')}`;
    case 'library': return '#/library';
    case 'settings': return '#/settings';
    default: return '#/';
  }
}

function parseHash(h) {
  const raw = String(h || '').replace(/^#\/?/, '');
  if (!raw) return { k: 'home' };
  const p = raw.split('/').map(decodeURIComponent);
  if (p[0] === 'library') return { k: 'library' };
  if (p[0] === 'settings') return { k: 'settings' };
  if (p[0] === 'c' && p[1]) return { k: 'cassette', name: p[1] };
  if (p[0] === 'a' && p[1] && p[2]) return { k: 'article', codex: p[1], id: +p[2] };
  if (p[0] === 'search' && p[1]) return { k: 'search', q: p[1] };
  if (p[0] === 'browse' && p[1]) return { k: 'browse', codex: p[1], letter: p[2] || 'A' };
  return { k: 'home' };
}

/* ---------- toast, dialog ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2300);
}
function openDlg(html) {
  $('#dlg').innerHTML = html;
  $('#scrim').classList.add('show');
  const b = $('#dlg .btn'); if (b) b.focus();
}
function closeDlg() { $('#scrim').classList.remove('show'); }
$('#scrim').addEventListener('mousedown', e => { if (e.target.id === 'scrim') closeDlg(); });

/* ---------- data helpers ---------- */
const codexTitle = name => {
  const c = S.catalog.find(x => x.name === name);
  return (c && (c.title || c.name)) || pretty(name);
};

/* ---------- routing ---------- */
async function renderRoute() {
  const r = S.route;
  const want = key(r);

  if (r.k !== 'article') S.doc = null;
  document.body.classList.remove('reading');
  $('#find').classList.remove('show');
  $('#bToc').classList.toggle('on', false);

  let mod = homeView;
  if (r.k === 'article') mod = articleView;
  else if (r.k === 'library') mod = libraryView;
  else if (r.k === 'cassette') mod = cassetteView;
  else if (r.k === 'search') mod = searchView;
  else if (r.k === 'browse') mod = browseView;
  else if (r.k === 'settings') mod = settingsView;

  document.title = r.k === 'article' ? 'Codex' : 'Codex';
  try {
    if (mod.mount) await mod.mount(viewEl, r, ctx);
    else viewEl.innerHTML = mod.render(r, ctx);
  } catch (e) {
    viewEl.innerHTML = `<div class="res"><p class="res-empty">This view failed to render.
      The projector may be offline.</p></div>`;
  }
  if (key(S.route) !== want) return;   /* a newer navigation won */

  if (r.k === 'article') document.body.classList.add('reading');
  scrollEl.scrollTop = S.scroll[want] || 0;
  updateNav();
  renderSheet();
}

function navigate(route, o = {}) {
  const k = key(route);
  if (!o.nohist && k === key(S.route)) return;
  closeSearch(); closeFind(); closeMenu(0);
  saveScroll();
  if (!o.nohist) {
    S.hist = S.hist.slice(0, S.hi + 1);
    S.hist.push(route);
    S.hi = S.hist.length - 1;
  }
  S.route = route;
  if (route.k === 'article') store.set('last', route);
  renderRoute();
  const h = toHash(route);
  if (location.hash !== h) location.hash = h;
}

function saveScroll() {
  if (scrollEl) S.scroll[key(S.route)] = scrollEl.scrollTop;
}

function back() { if (S.hi > 0) { S.hi--; navigate(S.hist[S.hi], { nohist: true }); } }
function fwd() { if (S.hi < S.hist.length - 1) { S.hi++; navigate(S.hist[S.hi], { nohist: true }); } }

window.addEventListener('hashchange', () => {
  const r = parseHash(location.hash);
  if (key(r) === key(S.route)) return;
  saveScroll();
  const at = S.hist.findIndex(x => key(x) === key(r));
  if (at >= 0) {
    S.hi = at;
  } else {
    /* A deep link or the address bar went somewhere this session has not
       been: record it as a step so Back still returns where you came from. */
    S.hist = S.hist.slice(0, S.hi + 1);
    S.hist.push(r);
    S.hi = S.hist.length - 1;
  }
  S.route = r;
  renderRoute();
});

/* ---------- chrome ---------- */
function updateNav() {
  $('#bBack').disabled = S.hi <= 0;
  $('#bFwd').disabled = S.hi >= S.hist.length - 1;
  const marked = isMarked(S.route);
  const m = $('#bMark');
  m.disabled = S.route.k !== 'article';
  m.classList.toggle('on', marked);
  m.setAttribute('aria-label', marked ? 'Remove from saved' : 'Save article');
  $('#bToc').classList.toggle('on', S.sheet);
}

const markKey = r => `${r.codex}/${r.id}`;
const isMarked = r => r.k === 'article' && S.marks.some(m => `${m.codex}/${m.id}` === markKey(r));

function toggleMark() {
  if (S.route.k !== 'article') { toast('Open an article first'); return; }
  const k = markKey(S.route);
  const at = S.marks.findIndex(m => `${m.codex}/${m.id}` === k);
  if (at >= 0) { S.marks.splice(at, 1); toast('Removed from saved'); }
  else {
    S.marks.unshift({ ...S.route, title: (S.doc && S.doc.title) || 'Article' });
    toast('Saved for later');
  }
  store.set('marks', S.marks);
  updateNav(); renderSheet();
}

function afterArticle(d, route) {
  if (S.route.k !== 'article' || key(S.route) !== key(route)) return;
  const entry = {
    codex: route.codex, id: route.id, title: d.title,
    words: d.word_count, codexTitle: codexTitle(route.codex),
  };
  S.recent = [entry, ...S.recent.filter(r => !(r.codex === route.codex && r.id === route.id))].slice(0, 8);
  store.set('recent', S.recent);
  /* Keep the title on the history entry so the sheet and Go menu can name it. */
  if (S.hist[S.hi] && key(S.hist[S.hi]) === key(route)) S.hist[S.hi] = { ...route, title: d.title };
  document.title = `${d.title} — Codex`;
  updateNav(); renderSheet();
}

/* ---------- side sheet ---------- */
function renderSheet() {
  $$('.tab', $('#tabs')).forEach(t => t.classList.toggle('on', t.dataset.t === S.tab));
  let h = '';
  if (S.tab === 'toc') {
    const d = S.doc;
    if (!d) h = '<div class="sempty">Open an article to see its contents.</div>';
    else {
      const items = [{ h: d.title, id: 'top' }, ...(d.sections || []).filter(s => s.h), ...(d.related ? [{ h: 'Related', id: 's-rel' }] : [])];
      h = items.map(x => `<button class="si" data-toc="${esc(x.id)}">${esc(x.h)}</button>`).join('');
    }
  } else if (S.tab === 'marks') {
    h = S.marks.length
      ? S.marks.map(m => `<button class="si" data-goto="${esc(m.codex)}/${m.id}">${esc(m.title)}
          <small>${esc(codexTitle(m.codex))}</small></button>`).join('')
      : '<div class="sempty">Nothing saved yet. Press Ctrl+D on an article.</div>';
  } else {
    const arts = S.hist.filter(r => r.k === 'article').slice(-20).reverse();
    h = arts.length
      ? arts.map(r => `<button class="si${key(r) === key(S.route) ? ' on' : ''}" data-goto="${esc(r.codex)}/${r.id}">
          ${esc(r.title || codexTitle(r.codex))}<small>${esc(codexTitle(r.codex))}</small></button>`).join('')
      : '<div class="sempty">Articles you open will show up here.</div>';
  }
  slEl.innerHTML = h;
}

function setSheet(on, tab) {
  if (tab) { S.tab = tab; store.set('tab', tab); }
  S.sheet = on === undefined ? !S.sheet : on;
  sheetEl.classList.toggle('show', S.sheet);
  $('#app').classList.toggle('sh', S.sheet);
  renderSheet(); updateNav();
}

/* ---------- article helpers ---------- */
function scrollToSection(id) {
  if (id === 'top') { scrollEl.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const el = document.getElementById(id);
  if (!el) return;
  const y = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop - 56;
  scrollEl.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

let spyT = 0;
scrollEl.addEventListener('scroll', () => {
  saveScroll();
  if (S.route.k !== 'article' || !S.sheet || S.tab !== 'toc') return;
  if (Date.now() - spyT < 120) return;
  spyT = Date.now();
  const heads = $$('.art [id]', viewEl);
  let cur = 'top';
  const line = scrollEl.getBoundingClientRect().top + 96;
  heads.forEach(h => { if (h.getBoundingClientRect().top <= line) cur = h.id; });
  $$('.si[data-toc]', slEl).forEach(b => b.classList.toggle('on', b.dataset.toc === cur));
}, { passive: true });

/* ---------- find in article ---------- */
const F = { hits: [], i: -1 };
function clearHits() {
  $$('mark.hit', viewEl).forEach(m => {
    const p = m.parentNode;
    p.replaceChild(document.createTextNode(m.textContent), m);
    p.normalize();
  });
  F.hits = []; F.i = -1;
}
function runFind(q) {
  clearHits();
  const ct = $('#findCt');
  const root = $('.art', viewEl);
  if (!root || q.trim().length < 2) { ct.textContent = ''; return; }
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) nodes.push(walk.currentNode);
  const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  nodes.forEach(n => {
    const t = n.nodeValue;
    let m, last = 0, frag = null;
    re.lastIndex = 0;
    while ((m = re.exec(t))) {
      frag = frag || document.createDocumentFragment();
      frag.appendChild(document.createTextNode(t.slice(last, m.index)));
      const k = document.createElement('mark');
      k.className = 'hit'; k.textContent = m[0];
      frag.appendChild(k);
      last = m.index + m[0].length;
    }
    if (frag) {
      frag.appendChild(document.createTextNode(t.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
  });
  F.hits = $$('mark.hit', root);
  if (!F.hits.length) { ct.textContent = '0'; return; }
  F.i = -1; stepFind(1);
}
function stepFind(d) {
  if (!F.hits.length) return;
  if (F.i >= 0) F.hits[F.i].classList.remove('cur');
  F.i = (F.i + d + F.hits.length) % F.hits.length;
  const el = F.hits[F.i];
  el.classList.add('cur');
  const y = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop - scrollEl.clientHeight / 2;
  scrollEl.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  $('#findCt').textContent = `${F.i + 1}/${F.hits.length}`;
}
function openFind() {
  if (S.route.k !== 'article') { toast('Open an article first'); return; }
  $('#find').classList.add('show');
  const i = $('#findIn'); i.focus(); i.select();
}
function closeFind() {
  if (!$('#find').classList.contains('show')) return;
  $('#find').classList.remove('show');
  $('#findIn').value = ''; $('#findCt').textContent = '';
  clearHits();
}
$('#findIn').addEventListener('input', e => runFind(e.target.value));
$('#findIn').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
});
$('#findNext').addEventListener('click', () => stepFind(1));
$('#findPrev').addEventListener('click', () => stepFind(-1));
$('#findX').addEventListener('click', closeFind);

/* ---------- search popover ---------- */
let sugT = null, sugAbort = null, sug = [], sugSel = 0, sugBusy = false;

function renderPopover() {
  const v = qEl.value.trim();
  const terms = v.toLowerCase().split(/\s+/).filter(Boolean);
  let h = '<div class="spsc">' +
    `<button class="chip${S.mode === 'title' ? ' on' : ''}" data-mode="title">Titles</button>` +
    `<button class="chip${S.mode === 'full' ? ' on' : ''}" data-mode="full">Full text</button>` +
    '<button class="chip" data-pop-lib="1" style="margin-left:auto">Library</button></div>';
  if (!v) {
    h += '<div class="sph">Search</div><div class="spe">Type to search titles. Switch to full text for body matches.</div>';
    if (S.recent.length) {
      h += '<div class="sph">Recent</div>' + S.recent.slice(0, 5).map(r =>
        `<button class="sri" data-pop-go="${esc(r.codex)}/${r.id}">
           <div class="t">${esc(r.title)}<span>${esc(r.codexTitle || pretty(r.codex))}</span></div></button>`).join('');
    }
  } else if (sugBusy) {
    h += '<div class="spe">Searching…</div>';
  } else if (!sug.length) {
    h += `<div class="spe">No matches${S.mode === 'title' ? '. Try full text.' : '.'}</div>`;
  } else {
    h += sug.map((r, i) => `<button class="sri${i === sugSel ? ' act' : ''}" data-pop="${i}" role="option">
      <div class="t"><span class="tt">${highlight(r.title, terms)}</span><span class="tn">${esc(codexTitle(r.codex))}</span></div>
      <div class="s">${highlight(r.snippet || '', terms)}</div></button>`).join('');
    h += `<button class="sri" data-pop-all="1" style="color:var(--fg2)">All results for “${esc(v)}”</button>`;
  }
  spEl.innerHTML = h;
}

async function runSuggest() {
  const v = qEl.value.trim();
  clearTimeout(sugT);
  if (v.length < 2) { sug = []; sugBusy = false; renderPopover(); return; }
  sugT = setTimeout(async () => {
    if (sugAbort) sugAbort.abort();
    const ctrl = sugAbort = new AbortController();
    sugBusy = true; renderPopover();
    try {
      const d = await api.search(v, { n: 7, deep: S.mode === 'full' });
      if (ctrl !== sugAbort) return;
      sug = d.hits || []; sugSel = 0; sugBusy = false;
      renderPopover();
    } catch (e) {
      if (e.name === 'AbortError') return;
      sug = []; sugBusy = false;
      if (spEl.classList.contains('show')) { spEl.innerHTML = '<div class="spe">The projector did not answer.</div>'; }
    }
  }, 120);
}

function openSearch() { renderPopover(); spEl.classList.add('show'); }
function closeSearch() { spEl.classList.remove('show'); }

qEl.addEventListener('focus', () => { openSearch(); $('#qk').style.visibility = 'hidden'; });
qEl.addEventListener('blur', () => { $('#qk').style.visibility = ''; });
qEl.addEventListener('input', () => { sugSel = 0; runSuggest(); spEl.classList.add('show'); });
qEl.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); sugSel = Math.min(sug.length - 1, sugSel + 1); renderPopover(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sugSel = Math.max(0, sugSel - 1); renderPopover(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const v = qEl.value.trim();
    if (!v) return;
    if (sug[sugSel] && sug.length) openResult(sug[sugSel]);
    else { qEl.blur(); closeSearch(); navigate({ k: 'search', q: v }); qEl.value = ''; }
  }
});
document.addEventListener('mousedown', e => {
  if (spEl.classList.contains('show') && !e.target.closest('.sf, .sp')) closeSearch();
});
$('#sf').addEventListener('click', () => qEl.focus());

spEl.addEventListener('click', e => {
  const mode = e.target.closest('[data-mode]');
  if (mode) { S.mode = mode.dataset.mode; store.set('mode', S.mode); runSuggest(); return; }
  if (e.target.closest('[data-pop-lib]')) { closeSearch(); navigate({ k: 'library' }); return; }
  const all = e.target.closest('[data-pop-all]');
  if (all) { const v = qEl.value.trim(); closeSearch(); qEl.value = ''; qEl.blur(); navigate({ k: 'search', q: v }); return; }
  const go = e.target.closest('[data-pop-go]');
  if (go) { const [c, id] = go.dataset.popGo.split('/'); closeSearch(); qEl.blur(); navigate({ k: 'article', codex: c, id: +id }); return; }
  const r = e.target.closest('[data-pop]');
  if (r) openResult(sug[+r.dataset.pop]);
});

/* ---------- results ---------- */
function setResults(hits, route) {
  S.results = hits || [];
  S.rsel = 0;
}

function paintSelection() {
  $$('.rhit', viewEl).forEach((el, i) => el.classList.toggle('sel', i === S.rsel));
  const el = $('.rhit.sel', viewEl);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function moveResult(d) {
  if (!S.results.length) return;
  S.rsel = Math.max(0, Math.min(S.results.length - 1, S.rsel + d));
  paintSelection();
}

function openResult(h) {
  if (!h) return;
  closeSearch(); qEl.blur();
  navigate({ k: 'article', codex: h.codex, id: h.id });
}

/* ---------- view delegation ---------- */
viewEl.addEventListener('click', async e => {
  const open = e.target.closest('[data-open]');
  if (open) { const [c, id] = open.dataset.open.split('/'); navigate({ k: 'article', codex: c, id: +id }); return; }

  const cas = e.target.closest('[data-cassette]');
  if (cas) { navigate({ k: 'cassette', name: cas.dataset.cassette }); return; }

  const hit = e.target.closest('[data-hit]');
  if (hit) { openResult(S.results[+hit.dataset.hit]); return; }

  const let_ = e.target.closest('[data-letter]');
  if (let_) { navigate({ k: 'browse', codex: S.route.codex, letter: let_.dataset.letter }, { nohist: true }); return; }

  const browse = e.target.closest('[data-browse]');
  if (browse) { navigate({ k: 'browse', codex: browse.dataset.browse, letter: 'A' }); return; }

  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const ok = await copyText(copy.dataset.copy);
    toast(ok ? (copy.dataset.copyLabel || 'Copied') : 'Copy not available here');
    return;
  }

  const set = e.target.closest('[data-set]');
  if (set) {
    const { set: name, v } = set.dataset;
    if (name === 'theme') setTheme(v);
    else if (name === 'readerFont') { S.readerFont = v; store.set('readerFont', v); renderRoute(); }
    else if (name === 'mode') { S.mode = v; store.set('mode', v); renderRoute(); }
    return;
  }

  const act = e.target.closest('[data-act]');
  if (!act) return;
  switch (act.dataset.act) {
    case 'focus': qEl.focus(); break;
    case 'lib': navigate({ k: 'library' }); break;
    case 'settings': navigate({ k: 'settings' }); break;
    case 'theme': setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); break;
    case 'size-up': setFz(S.fz + 0.1); break;
    case 'size-down': setFz(S.fz - 0.1); break;
    case 'size-reset': setFz(1); break;
    case 'return': openReturn(); break;
    case 'reset-local':
      store.del('marks'); store.del('recent');
      S.marks = []; S.recent = [];
      renderRoute(); renderSheet(); updateNav();
      toast('Saved articles and recent history cleared');
      break;
  }
});

slEl.addEventListener('click', e => {
  const t = e.target.closest('[data-toc]');
  if (t) { scrollToSection(t.dataset.toc); return; }
  const g = e.target.closest('[data-goto]');
  if (g) { const [c, id] = g.dataset.goto.split('/'); navigate({ k: 'article', codex: c, id: +id }); }
});

function setFz(f) {
  S.fz = Math.min(1.5, Math.max(0.8, Math.round(f * 100) / 100));
  store.set('fz', S.fz);
  document.documentElement.style.setProperty('--fz', S.fz);
  const chip = $('[data-act="size-reset"]');
  if (chip) chip.textContent = `${Math.round(S.fz * 100)}%`;
  toast(`Text size ${Math.round(S.fz * 100)}%`);
}

function openReturn() {
  const cas = (S.cassettes || []).find(c => c.name === S.route.name);
  openDlg(`<h2>Return cassette</h2>
    <p>Returning tells the library that this cassette has left the machine. The film stays on the
    volume it came from; nothing here is deleted from your disk.</p>
    <div class="kr"><span>Cassette</span><span>${esc((cas && cas.title) || S.route.name || '')}</span></div>
    <div class="kr"><span>Status</span><span>Not implemented</span></div>
    <p style="margin-top:14px">Import and return need the cassette service: mount detection, a copy with
    verification, and an eject that removes the entry. That is the next slice, not this one.</p>
    <button class="btn" data-close="1">Close</button>`);
}

$('#dlg').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDlg(); });

/* ---------- menus ---------- */
let menus = [], menuOpener = null, subT = null;
function closeMenu(depth = 0) {
  while (menus.length > depth) menus.pop().el.remove();
  if (!menus.length && menuOpener) { menuOpener.setAttribute('aria-expanded', 'false'); menuOpener = null; }
}
function openMenu(anchor, items, o = {}) {
  const depth = o.depth || 0;
  closeMenu(depth);
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  items.forEach(it => {
    if (it === '-') { const s = document.createElement('div'); s.className = 'msep'; el.appendChild(s); return; }
    if (it.header) { const h = document.createElement('div'); h.className = 'mh'; h.textContent = it.header; el.appendChild(h); return; }
    const r = document.createElement('div');
    r.className = 'mi' + (it.disabled ? ' dis' : '');
    r.setAttribute('role', 'menuitem');
    r.innerHTML = `<span class="ck">${it.checked ? '✓' : ''}</span><span class="ml">${esc(it.label)}</span>` +
      (it.sub ? '<span class="ar">›</span>' : (it.kbd ? `<span class="k">${esc(it.kbd)}</span>` : ''));
    r.addEventListener('mouseenter', () => {
      clearTimeout(subT);
      $$('.mi.act', el).forEach(x => x.classList.remove('act'));
      r.classList.add('act');
      subT = setTimeout(() => {
        if (it.sub) openMenu(r, it.sub, { depth: depth + 1, side: true });
        else closeMenu(depth + 1);
      }, 80);
    });
    r.addEventListener('click', ev => {
      ev.stopPropagation();
      if (it.sub) { openMenu(r, it.sub, { depth: depth + 1, side: true }); return; }
      closeMenu(0);
      if (it.run) it.run();
    });
    el.appendChild(r);
  });
  el.style.visibility = 'hidden';
  document.body.appendChild(el);
  const vw = innerWidth, vh = innerHeight, gap = 4;
  const ar = anchor.getBoundingClientRect();
  let x = ar.left, y = ar.bottom + gap;
  if (o.side) { x = ar.right - 4; y = ar.top - 5; }
  el.style.maxHeight = Math.max(120, vh - y - 8) + 'px';
  const w = el.offsetWidth, h = el.offsetHeight;
  if (o.side && x + w > vw - 8) x = ar.left - w + 4;
  if (!o.side && x + w > vw - 8) x = vw - w - 8;
  if (x < 8) x = 8;
  if (y + h > vh - 8) y = Math.max(8, vh - h - 8);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.visibility = '';
  menus.push({ el, items });
}

const ck = (c, label, run, kbd) => ({ label, checked: c, run, kbd });

function menuDefs() {
  const art = S.route.k === 'article';
  const recent = S.recent.slice(0, 6).map(r => ({
    label: r.title, run: () => navigate({ k: 'article', codex: r.codex, id: r.id }),
  }));
  return {
    file: [
      { label: 'Library', kbd: 'Ctrl+L', run: () => navigate({ k: 'library' }) },
      { label: 'Settings', run: () => navigate({ k: 'settings' }) },
      '-',
      { label: isMarked(S.route) ? 'Remove from saved' : 'Save article', kbd: 'Ctrl+D', disabled: !art, run: toggleMark },
      { label: 'Copy link', disabled: !art, run: copyLink },
      '-',
      { label: 'Return cassette…', disabled: S.route.k !== 'cassette', run: openReturn },
    ],
    edit: [
      { label: 'Search the library', kbd: '/', run: () => qEl.focus() },
      { label: 'Find in article', kbd: 'Ctrl+F', disabled: !art, run: openFind },
      '-',
      { label: 'Copy article title', disabled: !art, run: () => {
        copyText((S.doc && S.doc.title) || '').then(ok => toast(ok ? 'Title copied' : 'Copy not available here'));
      } },
    ],
    view: [
      ck(S.sheet && S.tab === 'toc', 'Contents', () => (S.sheet && S.tab === 'toc') ? setSheet(false) : setSheet(true, 'toc'), 'Ctrl+\\'),
      ck(S.sheet && S.tab === 'marks', 'Saved', () => setSheet(true, 'marks')),
      ck(S.sheet && S.tab === 'hist', 'History', () => setSheet(true, 'hist')),
      '-',
      { label: 'Reader font', sub: [
        ck(S.readerFont === 'sans', 'Sans', () => { S.readerFont = 'sans'; store.set('readerFont', 'sans'); renderRoute(); }),
        ck(S.readerFont === 'serif', 'Serif', () => { S.readerFont = 'serif'; store.set('readerFont', 'serif'); renderRoute(); }),
      ] },
      { label: 'Text size', sub: [
        { label: 'Larger', kbd: 'Ctrl+=', run: () => setFz(S.fz + 0.1) },
        { label: 'Smaller', kbd: 'Ctrl+-', run: () => setFz(S.fz - 0.1) },
        { label: 'Reset', kbd: 'Ctrl+0', run: () => setFz(1) },
      ] },
      { label: 'Appearance', sub: [
        ck(S.theme === 'auto', 'Match system', () => setTheme('auto')),
        ck(S.theme === 'light', 'Light', () => setTheme('light')),
        ck(S.theme === 'dark', 'Dark', () => setTheme('dark')),
      ] },
      { label: 'Search by', sub: [
        ck(S.mode === 'title', 'Titles', () => { S.mode = 'title'; store.set('mode', 'title'); }),
        ck(S.mode === 'full', 'Full text', () => { S.mode = 'full'; store.set('mode', 'full'); }),
      ] },
      '-',
      { label: 'Keyboard shortcuts', run: openShortcuts },
      { label: 'About Codex', run: openAbout },
    ],
    go: [
      { label: 'Back', kbd: 'Alt+←', disabled: S.hi <= 0, run: back },
      { label: 'Forward', kbd: 'Alt+→', disabled: S.hi >= S.hist.length - 1, run: fwd },
      { label: 'Home', run: () => navigate({ k: 'home' }) },
      '-',
    ].concat(recent.length ? [{ header: 'Recent' }, ...recent] : [{ label: 'Nothing read yet', disabled: true }]),
  };
}

function allMenu() {
  const d = menuDefs();
  return [{ label: 'File', sub: d.file }, { label: 'Edit', sub: d.edit },
    { label: 'View', sub: d.view }, { label: 'Go', sub: d.go }];
}

function openBar(btn) {
  if (menuOpener === btn) { closeMenu(0); return; }
  if (menuOpener) menuOpener.setAttribute('aria-expanded', 'false');
  menuOpener = btn; btn.setAttribute('aria-expanded', 'true');
  const k = btn.dataset.m;
  openMenu(btn, k === 'all' ? allMenu() : menuDefs()[k]);
}

$$('.mb', $('#menubar')).forEach(b => {
  b.addEventListener('click', e => { e.stopPropagation(); openBar(b); });
  b.addEventListener('mouseenter', () => {
    if (menuOpener && menuOpener !== b && getComputedStyle(b).display !== 'none') {
      const prev = menuOpener;
      closeMenu(0); prev.setAttribute('aria-expanded', 'false'); menuOpener = null;
      openBar(b);
    }
  });
});
document.addEventListener('mousedown', e => {
  if (menus.length && !e.target.closest('.menu') && !e.target.closest('[aria-haspopup]')) closeMenu(0);
});

function copyLink() {
  if (S.route.k !== 'article') return;
  const url = `${location.origin}/read?codex=${encodeURIComponent(S.route.codex)}&id=${S.route.id}`;
  copyText(url).then(ok => toast(ok ? 'Permalink copied' : 'Copy not available here'));
}

function openShortcuts() {
  const rows = [['Search', '/ or Ctrl+K'], ['Find in article', 'Ctrl+F'], ['Back / Forward', 'Alt+← / →'],
    ['Save article', 'Ctrl+D'], ['Contents panel', 'Ctrl+\\'], ['Library', 'Ctrl+L'],
    ['Text size', 'Ctrl+= / − / 0']];
  openDlg('<h2>Shortcuts</h2><p>Everything here is also in the menus.</p>' +
    rows.map(r => `<div class="kr"><span>${r[0]}</span><kbd>${r[1]}</kbd></div>`).join('') +
    '<button class="btn" data-close="1">Done</button>');
}
function openAbout() {
  openDlg(`<h2>Codex</h2>
    <p>A calm reader for offline film. Each codex is a SQLite core, an optional deep index and
       images served beside it; nothing is fetched, and no request leaves the machine.</p>
    <div class="kr"><span>Format</span><span>Film v1 · zlib</span></div>
    <div class="kr"><span>API</span><span>Projector v1</span></div>
    <div class="kr"><span>Library</span><span>${num(S.catalog.length)} codexes</span></div>
    <div class="kr"><span>Cassettes</span><span>Specified, not built</span></div>
    <button class="btn" data-close="1">Done</button>`);
}

/* ---------- chrome wiring ---------- */
$('#bBack').addEventListener('click', back);
$('#bFwd').addEventListener('click', fwd);
$('#bBrand').addEventListener('click', () => navigate({ k: 'home' }));
$('#bHome').addEventListener('click', () => navigate({ k: 'home' }));
$('#bMark').addEventListener('click', toggleMark);
$('#bToc').addEventListener('click', () => setSheet(!(S.sheet && S.tab === 'toc'), 'toc'));
$('#sheetX').addEventListener('click', () => setSheet(false));
$('#tabs').addEventListener('click', e => {
  const t = e.target.closest('.tab');
  if (t) { S.tab = t.dataset.t; store.set('tab', S.tab); renderSheet(); updateNav(); }
});
$('#top').addEventListener('wheel', e => {
  if (!e.target.closest('.sp')) scrollEl.scrollTop += e.deltaY;
}, { passive: true });
mqDark.addEventListener && mqDark.addEventListener('change', () => { if (S.theme === 'auto') applyTheme(); });

/* ---------- Windows launcher compatibility ----------
   app/launcher.py focuses #q and clicks #mode to switch depth; the overlay
   also asks for a compact layout. Keep both contracts working. */
const modeShim = $('#mode');
const syncModeShim = () => { modeShim.textContent = S.mode === 'full' ? 'deep' : 'quick'; };
modeShim.addEventListener('click', () => {
  S.mode = S.mode === 'full' ? 'title' : 'full';
  store.set('mode', S.mode);
  syncModeShim();
  if (qEl.value.trim().length >= 2) runSuggest();
});
syncModeShim();
window.codexFocus = () => { qEl.focus(); qEl.select(); };
if (location.search.includes('launcher')) document.body.classList.add('launcher');

/* ---------- keyboard ---------- */
document.addEventListener('keydown', e => {
  const k = e.key, mod = e.ctrlKey || e.metaKey;
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);

  if (k === 'Escape') {
    if ($('#scrim').classList.contains('show')) { closeDlg(); return; }
    if (menus.length) { closeMenu(0); return; }
    if ($('#find').classList.contains('show')) { closeFind(); return; }
    if (spEl.classList.contains('show')) { closeSearch(); qEl.value = ''; qEl.blur(); return; }
    if (typing) { document.activeElement.blur(); return; }
    if (S.route.k === 'article') { back(); return; }
    return;
  }

  if (menus.length) {
    const top = menus[menus.length - 1].el;
    const items = $$('.mi:not(.dis)', top);
    const cur = items.findIndex(x => x.classList.contains('act'));
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      const n = items.length; if (!n) return;
      const nx = k === 'ArrowDown' ? (cur + 1) % n : (cur <= 0 ? n - 1 : cur - 1);
      items.forEach(x => x.classList.remove('act')); items[nx].classList.add('act');
    } else if (k === 'Enter' && cur >= 0) { e.preventDefault(); items[cur].click(); }
    else if (k === 'ArrowLeft' && menus.length > 1) { e.preventDefault(); closeMenu(menus.length - 1); }
    return;
  }

  if (typing) return;

  if (mod && k.toLowerCase() === 'k') { e.preventDefault(); qEl.focus(); return; }
  if (k === '/' && !mod) { e.preventDefault(); qEl.focus(); return; }
  if (mod && k.toLowerCase() === 'f') { e.preventDefault(); openFind(); return; }
  if (mod && k.toLowerCase() === 'd') { e.preventDefault(); toggleMark(); return; }
  if (mod && k.toLowerCase() === 'l') { e.preventDefault(); navigate({ k: 'library' }); return; }
  if (mod && k === '\\') { e.preventDefault(); setSheet(!(S.sheet && S.tab === 'toc'), 'toc'); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); setFz(S.fz + 0.1); return; }
  if (mod && k === '-') { e.preventDefault(); setFz(S.fz - 0.1); return; }
  if (mod && k === '0') { e.preventDefault(); setFz(1); return; }
  if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); back(); return; }
  if (e.altKey && k === 'ArrowRight') { e.preventDefault(); fwd(); return; }

  if (S.route.k === 'search' || S.route.k === 'browse') {
    if (k === 'ArrowDown') { e.preventDefault(); moveResult(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); moveResult(-1); }
    else if (k === 'Enter') { e.preventDefault(); openResult(S.results[S.rsel]); }
  }
});

/* ---------- boot ---------- */
const ctx = {
  get state() { return S; },
  get catalog() { return S.catalog; },
  get cassettes() { return S.cassettes; },
  get libraryMock() { return S.libraryMock; },
  icon, codexTitle, navigate, toast, go: navigate,
  setResults,
  afterArticle: d => afterArticle(d, S.route),
};

function rerenderIfSettings() { if (S.route.k === 'settings') renderRoute(); }

async function boot() {
  applyTheme();
  document.documentElement.style.setProperty('--fz', S.fz);

  const [health, shelf] = await Promise.allSettled([api.health(), library.load()]);
  if (health.status === 'fulfilled' && health.value && health.value.ok) {
    S.catalog = health.value.codexes || [];
  } else {
    S.offline = true;
    toast('Projector offline: start codexd to read film');
  }
  if (shelf.status === 'fulfilled') {
    S.cassettes = shelf.value.cassettes || [];
    S.libraryMock = shelf.value.mock !== false;
  }

  /* /read permalink wins over the stored route. */
  const params = new URLSearchParams(location.search);
  const pc = params.get('codex'), pid = +(params.get('id') || 0);
  if (location.pathname === '/read' && pc && pid) {
    S.route = { k: 'article', codex: pc, id: pid };
    S.hist = [S.route]; S.hi = 0;
  } else if (location.hash && location.hash !== '#/') {
    S.route = parseHash(location.hash);
    S.hist = [S.route]; S.hi = 0;
  } else {
    const last = store.get('last', null);
    S.hist = [{ k: 'home' }];
    S.hi = 0;
    if (last && last.codex && last.id) S.route = last;
  }

  await renderRoute();
  if (location.hash !== toHash(S.route) && location.pathname !== '/read') {
    history.replaceState(null, '', toHash(S.route));
  }
  updateNav();
  renderSheet();
}

boot();
