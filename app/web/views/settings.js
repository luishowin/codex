/* Settings: the few things this reader lets you change, and what it is. */

import { num, bytes } from '../util.js';

const seg = (name, value, options) => `<div class="seg" role="group">${options.map(([v, label]) =>
  `<button data-set="${name}" data-v="${v}" aria-pressed="${value === v}">${label}</button>`).join('')}</div>`;

export function render(route, ctx) {
  const { state, catalog } = ctx;
  const docs = (catalog || []).reduce((a, c) => a + (c.docs || 0), 0);
  const disk = (catalog || []).reduce((a, c) => a + (c.core_bytes || 0) + (c.deep_bytes || 0), 0);
  const size = Math.round(state.fz * 100);

  return `<div class="set">
    <h1>Settings</h1>

    <div class="set-card">
      <div class="set-row"><div class="sl2"><b>Appearance</b><small>Match the system, or hold one.</small></div>
        ${seg('theme', state.theme, [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      <div class="set-row"><div class="sl2"><b>Reader font</b><small>The serif is the system book face; the sans is the interface face.</small></div>
        ${seg('readerFont', state.readerFont, [['sans', 'Sans'], ['serif', 'Serif']])}</div>
      <div class="set-row"><div class="sl2"><b>Text size</b><small>Applies to article body text.</small></div>
        <div class="seg">
          <button data-act="size-down" aria-label="Smaller">−</button>
          <button data-act="size-reset" aria-label="Reset">${size}%</button>
          <button data-act="size-up" aria-label="Larger">+</button>
        </div></div>
      <div class="set-row"><div class="sl2"><b>Default search</b><small>Titles is instant. Full text reads every page, and is slower.</small></div>
        ${seg('mode', state.mode, [['title', 'Titles'], ['full', 'Full text']])}</div>
    </div>

    <div class="set-card">
      <div class="set-row"><div class="sl2"><b>Film directory</b><small>${num(catalog.length)} codexes · ${num(docs)} documents · ${bytes(disk)}</small></div>
        <span class="v mono" style="font:11.5px var(--mono);color:var(--mute)">data/*.codex.db</span></div>
      <div class="set-row"><div class="sl2"><b>Cassette shelf</b><small>${ctx.libraryMock
        ? 'Generated from the databases on disk. The cassette service does not exist yet.'
        : 'Read from the library service.'}</small></div>
        <span style="color:var(--mute);font-size:12px">${ctx.libraryMock ? 'fixture' : 'live'}</span></div>
      <div class="set-row"><div class="sl2"><b>Local data</b><small>Saved articles and reading history stay in this browser profile.</small></div>
        <button class="btn ghost" data-act="reset-local">Clear</button></div>
    </div>

    <div class="set-card">
      <div class="set-row"><div class="sl2"><b>Codex</b><small>An offline reader for codex film: one SQLite core per corpus, an optional deep index, images served beside it.</small></div></div>
      <div class="set-row"><div class="sl2"><b>Format</b><small>Film v1, body codec zlib, projector API v1.</small></div></div>
      <div class="set-row"><div class="sl2"><b>Network</b><small>No request leaves this machine. The projector binds loopback.</small></div></div>
      <div class="set-row"><div class="sl2"><b>Cassettes</b><small>Pack, verify, import and return: specified, not built.</small></div></div>
    </div>

    <p class="set-foot">Essential OS application study. The interface follows the Essential OS reader language; the data is real film on this machine.</p>
  </div>`;
}
