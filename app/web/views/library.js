/* Library: every codex as a cassette, with the cover as the object. */

import { num, bytes } from '../util.js';
import { casCard } from '../cover.js';

export function render(route, ctx) {
  const list = ctx.cassettes || [];
  const docs = list.reduce((a, c) => a + (c.contents.documents || 0), 0);
  const words = list.reduce((a, c) => a + (c.contents.words || 0), 0);
  const disk = list.reduce((a, c) =>
    a + (c.film || []).reduce((x, f) => x + (f.bytes || 0), 0), 0);

  return `<div class="lib">
    <div class="lib-head">
      <div>
        <h1>Library</h1>
        <p>Each codex is a cassette: film, an index, a cover and a record of where it came from.</p>
      </div>
      <div class="stat">${num(list.length)} cassettes<br>${num(docs)} documents · ${bytes(disk)}</div>
    </div>
    ${list.length ? `<div class="lib-grid">${list.map(casCard).join('')}</div>`
      : '<p class="cs-empty">No film found in the data directory. Build a codex, or insert a cassette.</p>'}
    <p class="set-foot">${ctx.libraryMock
      ? 'These manifests are generated from the real databases so the shelf can be built before the cassette tool exists. Files above 2 GB are not hashed here, and no manifest digest is claimed.'
      : `${num(words)} words across the shelf.`}</p>
  </div>`;
}
