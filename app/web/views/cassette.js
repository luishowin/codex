/* Cassette detail: the label, the contents, and the digest.

   This is the page that has to be honest. A digest is shown only when one
   was computed; otherwise it says so. Verification is not implemented yet,
   and the note says that instead of offering a button that does nothing. */

import { esc, num, bytes, date } from '../util.js';
import { coverSVG } from '../cover.js';

export function render(route, ctx) {
  const cas = (ctx.cassettes || []).find(c => c.name === route.name);
  if (!cas) {
    return `<div class="cs"><a class="cs-back" href="#/library">← Library</a>
      <p class="cs-empty">No cassette named “${esc(route.name)}”.</p></div>`;
  }
  const c = cas.contents || {};
  const film = cas.film || [];
  const core = film.find(f => f.role === 'core') || film[0] || {};
  const deep = film.find(f => f.role === 'deep');
  const total = film.reduce((a, f) => a + (f.bytes || 0), 0);
  const mock = cas._mock || ctx.libraryMock;

  const shaRow = f => {
    const name = String(f.file || '').split('/').pop();
    if (!f.sha256) {
      return `<div class="cs-file">
        <div class="cs-file-top"><span class="k">${esc(name)}</span><span class="v">${bytes(f.bytes)}</span></div>
        <div class="cs-hash muted">not hashed — computed at pack time</div></div>`;
    }
    const short = `${f.sha256.slice(0, 20)}…${f.sha256.slice(-8)}`;
    return `<div class="cs-file">
      <div class="cs-file-top"><span class="k">${esc(name)}</span><span class="v">${bytes(f.bytes)}</span></div>
      <div class="cs-hash"><code title="${esc(f.sha256)}">${esc(short)}</code>
        <button class="ghost" style="height:24px;padding:0 9px"
          data-copy="${esc(f.sha256)}" data-copy-label="SHA-256 copied">copy</button></div></div>`;
  };

  return `<div class="cs">
    <a class="cs-back" href="#/library">← Library</a>
    <div class="cs-top">
      <div class="cs-cover">${coverSVG(cas, { width: 300, height: 400 })}</div>
      <div class="cs-main">
        <div class="eyebrow">Cassette${cas.issue ? ` · ${esc(cas.issue)}` : ''}</div>
        <h1>${esc(cas.title || cas.name)}</h1>
        <p class="sub">${num(c.documents)} documents · ${num(c.words)} words ·
          ${bytes(total)}${c.language ? ` · ${esc(c.language)}` : ''}<br>
          ${esc(c.source || 'source not recorded')}${c.source_date ? ` · ${esc(c.source_date)}` : ''}</p>
        <div class="cs-actions">
          <button class="btn" data-browse="${esc(cas.name)}">Open</button>
          ${core.sha256 ? `<button class="btn ghost" data-copy="${esc(core.sha256)}"
            data-copy-label="Film SHA-256 copied">Copy SHA</button>` : ''}
          <button class="btn ghost" data-act="return">Return…</button>
        </div>
        ${mock ? `<div class="cs-note"><b>Fixture shelf.</b> This manifest is generated from the
          database on disk, not from a sealed cassette. Files over 2 GB were not hashed, and no
          manifest digest exists yet. The cassette tool — pack, verify, import — is the next slice.</div>`
          : `<div class="cs-note"><b>Sealed cassette.</b> Manifest digest
          <code>${esc(cas.manifest_sha256 || 'missing')}</code>. Verification: not implemented yet.</div>`}
      </div>
    </div>

    <div class="cs-grid2">
      <section class="cs-card">
        <h2>At a glance</h2>
        <div class="cs-row"><span class="k">Created</span><span class="v">${esc(date(cas.created_at))}</span></div>
        <div class="cs-row"><span class="k">Created by</span><span class="v">${esc(cas.created_by || 'unknown')}</span></div>
        <div class="cs-row"><span class="k">Cassette id</span><span class="v mono">${esc(cas.cassette_id || '—')}</span></div>
        <div class="cs-row"><span class="k">Schema</span><span class="v">v${esc(cas.schema || 1)}</span></div>
        <div class="cs-row"><span class="k">Adapter</span><span class="v">${esc(c.adapter || 'n/a')}</span></div>
        <div class="cs-row"><span class="k">Deep index</span><span class="v">${deep ? 'yes' : 'no'}</span></div>
      </section>

      <section class="cs-card">
        <h2>Contents</h2>
        <div class="cs-row"><span class="k">Documents</span><span class="v">${num(c.documents)}</span></div>
        <div class="cs-row"><span class="k">Words</span><span class="v">${num(c.words)}</span></div>
        <div class="cs-row"><span class="k">Language</span><span class="v">${esc(c.language || 'n/a')}</span></div>
        <div class="cs-row"><span class="k">Source</span><span class="v">${esc(c.source || 'n/a')}</span></div>
        <div class="cs-row"><span class="k">Source date</span><span class="v">${esc(c.source_date || 'n/a')}</span></div>
        <div class="cs-row"><span class="k">Film</span><span class="v">${film.length} file${film.length === 1 ? '' : 's'} · ${bytes(total)}</span></div>
      </section>

      <section class="cs-card">
        <h2>Integrity</h2>
        ${film.map(shaRow).join('') || '<div class="cs-empty">No film listed.</div>'}
        <div class="cs-row"><span class="k">Manifest</span><span class="v">${
          cas.manifest_sha256 ? esc(String(cas.manifest_sha256).slice(0, 16)) + '…' : 'not present'}</span></div>
      </section>

      <section class="cs-card">
        <h2>Licence</h2>
        <div class="cs-row"><span class="k">Terms</span><span class="v">${esc((cas.licence || {}).name || 'not recorded')}</span></div>
        <div class="cs-row"><span class="k">Reference</span><span class="v">${
          (cas.licence || {}).url
            ? `<a href="${esc(cas.licence.url)}" target="_blank" rel="noreferrer noopener">licence text</a>`
            : '—'}</span></div>
        <div class="cs-row"><span class="k">Note</span><span class="v">${esc((cas.licence || {}).note || '')}</span></div>
      </section>
    </div>
  </div>`;
}
