/* Browse one codex.

   Two shapes, one door. A flat codex (Wikipedia, ready.gov, MDN) is a set of
   independent pages, so A–Z over the pages is right: "A" holds Aviation and
   American history. A codex with containers (military-medicine, libretexts,
   iFixit) is a shelf of books: A–Z belongs on the *books*, and opening one
   shows its own contents in source order. That is what keeps "APPENDIX 1..9"
   after the chapter it belongs to instead of piled up under A.

   The server decides which shape it is (/api/index). Absent that endpoint —
   an older daemon — this falls back to the alphabetical browse unchanged. */

import { esc, num } from '../util.js';
import { api } from '../api.js';

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
// Deeper than this and the page stops being a contents list and starts being
// a stress test. iFixit's device tree is the only codex that goes this far.
const MAX_DEPTH = 6;

const initial = title => {
  const c = String(title || '').slice(0, 1).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
};

export async function mount(el, route, ctx) {
  const letter = route.letter || 'A';
  /* No prefix: the whole shelf. The letter in the route belongs to the flat
     view; a codex of books is read as one list.

     Two tries before falling back: a reload can abort the first request, and
     "the daemon is older than /api/index" should not be inferred from that. */
  let idx = null;
  for (let attempt = 0; attempt < 2 && !idx; attempt++) {
    try { idx = await api.index(route.codex, {}); } catch (e) { /* retry */ }
  }
  if (!idx || idx.mode !== 'contents') return flat(el, route, ctx, letter);
  return contents(el, route, ctx, idx);
}

/* ---------- flat: A–Z over documents (unchanged) ---------- */
async function flat(el, route, ctx, letter) {
  el.innerHTML = `<div class="res"><div class="res-head"><h1>${esc(ctx.codexTitle(route.codex))}</h1></div></div>`;
  let d;
  try {
    d = await api.browse(letter, { n: 200, codex: route.codex });
  } catch (e) {
    el.innerHTML = `<div class="res"><div class="res-head"><h1>${esc(ctx.codexTitle(route.codex))}</h1></div>
      <p class="res-empty">Browse failed. Is the codex still loaded?</p></div>`;
    return;
  }
  const hits = (d.hits || []).map(h => ({ ...h, codex: route.codex }));
  ctx.setResults(hits, route);

  /* A source that names twenty pages the same thing (MedlinePlus's tutorial)
     reads as broken in a list. Keep every page; show the path tail on the ones
     that collide, so the duplicates are identifiable instead of mysterious. */
  const tkey = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const seen = new Map();
  for (const h of hits) seen.set(tkey(h.title), (seen.get(tkey(h.title)) || 0) + 1);
  const tail = p => {
    const bits = String(p || '').split('?')[0].replace(/\/+$/, '').split('/');
    const s = bits.slice(-2).join('/').replace(/\.(html?|php|aspx)$/i, '');
    return s.length > 64 ? '…' + s.slice(-63) : s;
  };

  el.innerHTML = `<div class="res">
    <div class="res-head">
      <h1>${esc(ctx.codexTitle(route.codex))}</h1>
      <small>${num(hits.length)} titles starting with ${esc(letter)}</small>
    </div>
    <div class="spsc" style="padding:10px 0">${LETTERS.map(l =>
      `<button class="chip${l === letter ? ' on' : ''}" data-letter="${l}">${l}</button>`).join('')}</div>
    ${hits.length ? hits.map((h, i) => `<button class="rhit${i === 0 ? ' sel' : ''}" data-hit="${i}">
        <span class="t"><span class="tt">${esc(h.title)}</span>${
          seen.get(tkey(h.title)) > 1 && tail(h.path).toLowerCase() !== tkey(h.title)
            ? `<em>${esc(tail(h.path))}</em>` : ''}</span></button>`).join('')
      : `<p class="res-empty">No titles under ${esc(letter)} in this codex.</p>`}
  </div>`;
}

/* ---------- contents: a shelf of books, then each book's order ---------- */
async function contents(el, route, ctx, idx) {
  const items = (idx.items || []).slice();
  /* One shelf, all of it: page through until the server says there is no more.
     22 books for a manual set, 1,582 devices for iFixit. */
  while (items.length < (idx.total || 0)) {
    try {
      const page = await api.index(route.codex, { after: items[items.length - 1].title, n: 500 });
      if (!page.items || !page.items.length) break;
      items.push(...page.items);
    } catch (e) { break; }
  }
  const open = new Map();       // id -> children (null while loading)

  el.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'res';
  el.appendChild(box);
  box.addEventListener('click', onClick);

  async function toggle(id) {
    if (open.has(id)) { open.delete(id); render(); return; }
    open.set(id, null);                       // show it as open before it arrives
    render();
    try {
      const d = await api.index(route.codex, { root: id });
      open.set(id, d.items || []);
    } catch (e) {
      open.set(id, []);                       // an empty book is better than a stuck one
    }
    render();
  }

  async function onClick(e) {
    const row = e.target.closest('[data-row]');
    if (!row) return;
    const id = +row.dataset.row;
    if (row.dataset.toggle) { await toggle(id); return; }
    ctx.go({ k: 'article', codex: route.codex, id });
  }

  function rowHtml(it, depth) {
    const kids = it.children || 0;
    const isOpen = open.has(it.id);
    const loading = isOpen && open.get(it.id) === null;
    const meta = kids
      ? `${num(kids)} ${kids === 1 ? 'section' : 'sections'}`
      : (it.words ? `${num(it.words)} words` : '');
    const arrow = kids ? `<span class="con-x" aria-hidden="true">${isOpen ? '▾' : '▸'}</span>` : '';
    return `<button class="rhit con${isOpen ? ' open' : ''}" data-row="${it.id}"
        data-toggle="${kids ? it.id : ''}" aria-expanded="${kids ? isOpen : 'false'}"
        style="padding-left:${14 + depth * 18}px">
        <span class="t"><span class="tt">${esc(it.title)}</span>${
          meta ? `<em>${meta}</em>` : ''}${arrow}</span>
      </button>` + (isOpen && depth < MAX_DEPTH
        ? (loading
            ? `<div class="con-load" style="padding-left:${14 + (depth + 1) * 18}px">loading…</div>`
            : (open.get(it.id) || []).map(c => rowHtml(c, depth + 1)).join(''))
        : '');
  }

  /* Same pre-order the markup uses, so arrow keys and .sel stay in step. */
  function visibleRows() {
    const out = [];
    const walk = (list, depth) => {
      for (const it of list) {
        out.push(it);
        if (open.has(it.id) && depth < MAX_DEPTH) walk(open.get(it.id) || [], depth + 1);
      }
    };
    walk(items, 0);
    return out;
  }

  function render() {
    const unit = idx.unit || 'book';
    const label = `${num(idx.total)} ${unit}${idx.total === 1 ? '' : 's'} · ${num(idx.sections)} sections`;
    let body = '';
    let last = null;
    for (const it of items) {
      const head = initial(it.title);
      if (head !== last) {
        body += `<div class="con-letter">${esc(head)}</div>`;
        last = head;
      }
      body += rowHtml(it, 0);
    }
    box.innerHTML = `<div class="res-head">
        <h1>${esc(ctx.codexTitle(route.codex))}</h1>
        <small>${label}</small>
      </div>
      ${items.length
        ? `<div class="con-list">${body}</div>`
        : `<p class="res-empty">This codex has no contents.</p>`}`;

    const rows = visibleRows();
    ctx.setResults(rows.map(it => ({
      codex: route.codex, id: it.id, title: it.title,
      toggle: it.children ? it.id : 0,
    })), route);
    box.querySelector('.rhit')?.classList.add('sel');
  }

  render();
  if (route.root) await toggle(route.root);   /* deep link opens one book */
}
