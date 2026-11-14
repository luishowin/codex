/* Search results page. The popover shows the top few; this is the full list. */

import { esc, num, highlight } from '../util.js';
import { api } from '../api.js';

export async function mount(el, route, ctx) {
  const deep = ctx.state.mode === 'full';
  el.innerHTML = `<div class="res"><div class="res-head"><h1>Searching…</h1></div></div>`;
  let d;
  try {
    d = await api.search(route.q, { n: 25, deep, codex: route.codex || '' });
  } catch (e) {
    el.innerHTML = `<div class="res"><div class="res-head"><h1>Search failed</h1></div>
      <p class="res-empty">The projector did not answer. Is codexd still running?</p></div>`;
    return;
  }
  const hits = d.hits || [];
  const terms = String(route.q).toLowerCase().split(/\s+/).filter(Boolean);
  ctx.setResults(hits.map(h => ({ ...h, codex: h.codex })), route);

  el.innerHTML = `<div class="res">
    <div class="res-head">
      <h1>${esc(route.q)}</h1>
      <small>${num(d.total)}${d.capped ? '+' : ''} result${d.total === 1 ? '' : 's'} ·
        ${deep ? 'full text' : 'titles'} · ${d.ms} ms${route.codex ? ` · ${esc(route.codex)}` : ''}</small>
    </div>
    ${hits.length ? hits.map((h, i) => `<button class="rhit${i === 0 ? ' sel' : ''}" data-hit="${i}">
        <span class="t"><span class="tt">${highlight(h.title, terms)}</span>${h.context ? `<em>${esc(h.context)}</em>` : ''}</span>
        <span class="s">${highlight(h.snippet || '', terms)}</span>
        <span class="m">${esc(h.codex || '')}${h.tier ? ` · ${esc(h.tier)}` : ''}</span>
      </button>`).join('')
      : `<p class="res-empty">Nothing matched${deep ? '' : ' in titles'}.
         ${deep ? 'Try fewer words.' : 'Switch to full text in the search popover.'}</p>`}
  </div>`;
}
