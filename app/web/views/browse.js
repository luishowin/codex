/* Browse one codex alphabetically. The ranked search is the other door. */

import { esc, num } from '../util.js';
import { api } from '../api.js';

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

export async function mount(el, route, ctx) {
  const letter = route.letter || 'A';
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

  el.innerHTML = `<div class="res">
    <div class="res-head">
      <h1>${esc(ctx.codexTitle(route.codex))}</h1>
      <small>${num(hits.length)} titles starting with ${esc(letter)}</small>
    </div>
    <div class="spsc" style="padding:10px 0">${LETTERS.map(l =>
      `<button class="chip${l === letter ? ' on' : ''}" data-letter="${l}">${l}</button>`).join('')}</div>
    ${hits.length ? hits.map((h, i) => `<button class="rhit${i === 0 ? ' sel' : ''}" data-hit="${i}">
        <span class="t">${esc(h.title)}</span></button>`).join('')
      : `<p class="res-empty">No titles under ${esc(letter)} in this codex.</p>`}
  </div>`;
}
