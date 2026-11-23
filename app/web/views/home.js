/* Home: the calm starting canvas. Search, what you were reading, the shelf. */

import { esc, num, bytes, pretty, minutes } from '../util.js';
import { casCard } from '../cover.js';

export function render(route, ctx) {
  const { state, catalog, cassettes } = ctx;
  const recent = (state.recent || []).slice(0, 4);
  const docs = (catalog || []).reduce((a, c) => a + (c.docs || 0), 0);
  const words = (catalog || []).reduce((a, c) => a + (c.words || 0), 0);
  const disk = (catalog || []).reduce((a, c) => a + (c.core_bytes || 0) + (c.deep_bytes || 0), 0);
  const shelf = (cassettes || []).slice(0, 4);

  const recentCard = r => `<button class="cx-card" data-open="${esc(r.codex)}/${r.id}">
      <b>${esc(r.title)}</b>
      <small>${esc(r.codexTitle || pretty(r.codex))}${r.words ? ` · ${minutes(r.words)} min read` : ''}</small>
    </button>`;

  const shelfSection = shelf.length ? `
    <section class="cx-sec">
      <h3>Cassettes<span><a href="#/library">All ${num(cassettes.length)} →</a></span></h3>
      <div class="lib-grid">${shelf.map(casCard).join('')}</div>
    </section>` : '';

  return `<div class="cx-home">
    <div class="cx-mark">Codex</div>
    <p class="cx-tag">Your offline library. Everything here is read from film on your own machine — no account, no network.</p>
    <button class="cx-big" data-act="focus">${ctx.icon('search')}<span>Search your library</span><kbd>/</kbd></button>
    <div class="cx-quick">
      <a class="chip" href="/reader">Family library</a>
      <button class="chip" data-act="lib">Reference shelf</button>
      <button class="chip" data-act="settings">Settings</button>
      <button class="chip" data-act="theme">Light / dark</button>
    </div>
    ${recent.length ? `<section class="cx-sec"><h3>Continue reading</h3>
      <div class="cx-grid">${recent.map(recentCard).join('')}</div></section>` : ''}
    ${shelfSection}
    <p class="cx-foot">
      ${num(catalog.length)} codexes · ${num(docs)} documents · ${num(words)} words · ${bytes(disk)} on disk.<br>
      Film format v1. ${ctx.libraryMock
        ? 'Shelf metadata is generated from these databases while the cassette tool is being built; nothing here is downloadable yet.'
        : 'Cassettes mount from removable media.'}
    </p>
  </div>`;
}
