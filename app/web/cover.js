/* Magazine covers, rendered from a cassette manifest.

   A cover is typography, not a bitmap: the title, the issue, what is inside
   and who made it. When the corpus has a bound hero image it sits behind
   the type under a dark wash; otherwise the palette carries it. The same
   renderer can be used by the pack tool later to bake `cover.svg` into a
   cassette, so nothing here depends on the DOM. */

import { esc, num, bytes } from './util.js';

const SERIF = "'Iowan Old Style','Palatino Linotype','URW Palladio L',P052,Georgia,'Liberation Serif',serif";
const SANS = "ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif";
const MONO = "ui-monospace,'Geist Mono',Menlo,Consolas,monospace";

const PALETTES = {
  ink:   { a: '#11141a', b: '#1e242f', accent: '#8fb0e8' },
  ember: { a: '#1a1311', b: '#2b1a13', accent: '#e0a06a' },
  moss:  { a: '#101614', b: '#18251d', accent: '#8fbf9f' },
  slate: { a: '#111318', b: '#1f252d', accent: '#a9b6c9' },
  wine:  { a: '#180f14', b: '#29141d', accent: '#cf8fa3' },
  sand:  { a: '#17140f', b: '#251d14', accent: '#d8c398' },
};

/* Break a title into at most `max` lines that roughly fit `width`.
   Serif advance is ~0.5 em per character; close enough for a cover, and
   it never clips because the caller shrinks the font when lines overflow. */
function wrap(text, width, fontSize, max) {
  const perLine = Math.max(6, Math.floor(width / (fontSize * 0.52)));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length <= perLine) { line = candidate; continue; }
    if (line) lines.push(line);
    if (w.length > perLine) {
      /* one long token: break it rather than overflow the cover */
      let rest = w;
      while (rest.length > perLine) { lines.push(rest.slice(0, perLine)); rest = rest.slice(perLine); }
      line = rest;
    } else {
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = kept[max - 1].replace(/\s+\S*$/, '') + '…';
  return kept;
}

export function coverSVG(cas, { width = 300, height = 400 } = {}) {
  const p = PALETTES[(cas.cover || {}).palette] || PALETTES.ink;
  const uid = String(cas.cassette_id || cas.name || 'c').replace(/[^a-zA-Z0-9_-]/g, '');
  const pad = 22;
  const inner = width - pad * 2;
  const c = cas.contents || {};

  let size = 30;
  let lines = wrap(cas.title || cas.name, inner, size, 4);
  while (lines.length > 3 && size > 21) { size -= 2; lines = wrap(cas.title || cas.name, inner, size, 4); }
  const lead = size * 1.12;

  /* Deliberately no hero image. art.db's automatic picker is known to
     misfire (the elephant-skull problem), and a wrong picture on a cover
     is worse than no picture. `cover.hero_slug` stays in the manifest for
     a curated cover later; this renderer is type only. */

  const titleY = 92;
  const title = lines.map((l, i) =>
    `<text x="${pad}" y="${titleY + i * lead}" font-family="${SERIF}" font-size="${size}"
       fill="#f4f4f6" letter-spacing="-.2">${esc(l)}</text>`).join('');

  const deep = (cas.film || []).some(f => f.role === 'deep');
  const source = (c.source || '').replace(/\.zim$/, '');

  return `<svg viewBox="0 0 ${width} ${height}" role="img"
    aria-label="${esc(cas.title || cas.name)} cover" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.a}"/><stop offset="1" stop-color="${p.b}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg-${uid})"/>
  <rect x="10.5" y="10.5" width="${width - 21}" height="${height - 21}" fill="none"
        stroke="${p.accent}" stroke-opacity=".28"/>
  <text x="${pad}" y="33" font-family="${SANS}" font-size="9.5" font-weight="600"
        letter-spacing="3.2" fill="${p.accent}">CODEX</text>
  <text x="${width - pad}" y="33" text-anchor="end" font-family="${MONO}" font-size="8.5"
        letter-spacing=".6" fill="#ffffff" fill-opacity=".55">${esc(cas.issue || '')}</text>
  <line x1="${pad}" y1="43" x2="${width - pad}" y2="43" stroke="${p.accent}" stroke-opacity=".45"/>
  ${title}
  <line x1="${pad}" y1="${height - 86}" x2="${width - pad}" y2="${height - 86}"
        stroke="#ffffff" stroke-opacity=".18"/>
  <text x="${pad}" y="${height - 64}" font-family="${SANS}" font-size="10.5" font-weight="600"
        letter-spacing=".8" fill="#ffffff" fill-opacity=".9">${num(c.documents)} DOCUMENTS</text>
  <text x="${pad}" y="${height - 48}" font-family="${MONO}" font-size="8.5"
        fill="#ffffff" fill-opacity=".6">${esc(bytes((cas.film || []).reduce((a, f) => a + (f.bytes || 0), 0)))}${deep ? ' · DEEP INDEX' : ''}</text>
  <text x="${pad}" y="${height - 30}" font-family="${SERIF}" font-size="12" font-style="italic"
        fill="#ffffff" fill-opacity=".8">${esc(cas.created_by || 'Unknown')}</text>
  <text x="${width - pad}" y="${height - 30}" text-anchor="end" font-family="${MONO}"
        font-size="7.6" letter-spacing=".4" fill="#ffffff" fill-opacity=".42">${esc(source.slice(0, 26))}</text>
</svg>`;
}

/* One shelf item: cover, title, and the one number that matters. */
export function casCard(cas) {
  const deep = (cas.film || []).some(f => f.role === 'deep');
  const total = (cas.film || []).reduce((a, f) => a + (f.bytes || 0), 0);
  const docs = (cas.contents || {}).documents || 0;
  return `<button class="cas" data-cassette="${esc(cas.name)}" aria-label="${esc(cas.title || cas.name)} cassette">
    <span class="cover">${coverSVG(cas)}</span>
    <span class="cl"><b>${esc(cas.title || cas.name)}</b>
      <small>${num(docs)} docs · ${bytes(total)}${deep ? ' · deep' : ''}</small></span>
  </button>`;
}
