// Album covers: every cover is a different generative style, never the same template.
// Styles: geom, noise, type, portrait, grid, stripes, wave, mono, bloom, split.
function rng(seed) {
  let s = (seed * 2654435761) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = s * 16807 % 2147483647) - 1) / 2147483646;
}

/** [background, mid, accent, ink] — each album gets its own set */
export const COVER_PALETTES = {
  'Sundial': ['#f7b733', '#fc4a1a', '#2b1055', '#fff6e0'],
  'Night Drive': ['#0b1026', '#2b3f8f', '#7a5cff', '#dfe6ff'],
  'Long Way Round': ['#0d3b4a', '#1f8a7a', '#9be8c8', '#eafff7'],
  'Second Nature': ['#2d1b4e', '#6b3fa0', '#f0a6ca', '#f8ecff'],
  'Blue Hour': ['#10243b', '#3a6ea5', '#f4a259', '#eef6ff'],
};

const STYLES = ['geom', 'noise', 'type', 'portrait', 'grid', 'stripes', 'wave', 'mono', 'bloom', 'split'];
/* albums whose seeded style came out flat get a hand-picked richer one */
const STYLE_FOR = { 'Sundial': 'sundial', 'Second Nature': 'understory' };
/** the cover for an album: a 200x200 SVG, unique per album */
export function coverArt(album, title = '', artist = '') {
  const pal = COVER_PALETTES[album] || ['#2b2f6b', '#5b6ed6', '#0a84ff', '#fff'];
  const [bg, mid, accent, ink] = pal;
  const seed = [...album].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 99991, 17);
  const r = rng(seed);
  const style = STYLE_FOR[album] || STYLES[seed % STYLES.length];
  const W = 200, H = 200;
  /* one filter id per album: every copy of a cover is identical, so repeats
     on one page resolve to the same definition and serializations compare equal */
  const gid = `ag-${seed}`;
  const grain = `<filter id="${gid}n" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="n"/>
      <feColorMatrix type="saturate" values="0"/></filter>
    <rect width="${W}" height="${H}" filter="url(#${gid}n)" opacity=".08" style="mix-blend-mode:overlay"/>`;
  const label = `<text x="14" y="${H - 14}" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" letter-spacing="1.5" fill="${ink}" opacity=".9">${esc(album.toUpperCase())}</text>`;
  const body = {
    geom: () => {
      const shapes = [];
      for (let i = 0; i < 7; i++) {
        const cx = r() * W, cy = r() * H, s = 14 + r() * 46;
        shapes.push(r() > .45
          ? `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${s.toFixed(0)}" fill="${[mid, accent, ink][(i % 3)]}" opacity="${(.5 + r() * .5).toFixed(2)}"/>`
          : `<path d="M${(cx - s).toFixed(0)} ${(cy + s / 2).toFixed(0)} L${cx.toFixed(0)} ${(cy - s).toFixed(0)} L${(cx + s).toFixed(0)} ${(cy + s / 2).toFixed(0)}Z" fill="${[accent, mid][i % 2]}" opacity="${(.6 + r() * .4).toFixed(2)}"/>`);
      }
      return `<rect width="${W}" height="${H}" fill="${bg}"/>${shapes.join('')}
        <rect x="0" y="${(H - 34).toFixed(0)}" width="${W}" height="34" fill="${ink}" opacity=".92"/>
        <text x="12" y="${(H - 12).toFixed(0)}" font-family="-apple-system, sans-serif" font-size="15" font-weight="700" fill="${bg}">${esc(album)}</text>`;
    },
    noise: () => {
      const blobs = [];
      for (let i = 0; i < 26; i++) {
        blobs.push(`<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" r="${(8 + r() * 46).toFixed(0)}" fill="${[mid, accent, ink][i % 3]}" opacity="${(.10 + r() * .22).toFixed(2)}"/>`);
      }
      return `<defs><filter id="${gid}b"><feGaussianBlur stdDeviation="11"/></filter></defs>
        <rect width="${W}" height="${H}" fill="${bg}"/><g filter="url(#${gid}b)">${blobs.join('')}</g>
        <circle cx="${(W * .68).toFixed(0)}" cy="${(H * .34).toFixed(0)}" r="17" fill="${ink}" opacity=".9"/>`;
    },
    type: () => `<rect width="${W}" height="${H}" fill="${mid}"/>
      <rect x="0" y="0" width="${W}" height="${(H * .52).toFixed(0)}" fill="${bg}"/>
      <circle cx="${(W * .74).toFixed(0)}" cy="${(H * .26).toFixed(0)}" r="26" fill="${accent}"/>
      ${wrapText(album, 16, 24, 96, 27, ink)}
      <rect x="14" y="${(H - 30).toFixed(0)}" width="46" height="3" fill="${accent}"/>
      <text x="14" y="${(H - 14).toFixed(0)}" font-family="-apple-system, sans-serif" font-size="11" fill="${ink}" opacity=".8">${esc(artist)}</text>`,
    portrait: () => {
      const skin = ink, hair = accent;
      return `<rect width="${W}" height="${H}" fill="${bg}"/>
        <circle cx="${(W * .3).toFixed(0)}" cy="${(H * .32).toFixed(0)}" r="34" fill="${mid}" opacity=".7"/>
        <path d="M40 200c0-40 26-62 60-62s60 22 60 62Z" fill="${mid}"/>
        <circle cx="100" cy="84" r="40" fill="${skin}"/>
        <path d="M60 78a40 40 0 0 1 80 0c0-26-16-40-40-40S60 52 60 78Z" fill="${hair}"/>
        <circle cx="87" cy="86" r="4" fill="${bg}"/><circle cx="113" cy="86" r="4" fill="${bg}"/>
        <path d="M88 106c7 5 17 5 24 0" stroke="${bg}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    },
    grid: () => {
      const n = 5, cell = 40, cells = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const lit = r() > .62;
        cells.push(`<rect x="${x * cell}" y="${y * cell}" width="${cell - 2}" height="${cell - 2}" rx="3" fill="${lit ? (r() > .5 ? accent : mid) : 'rgba(255,255,255,.09)'}"/>`);
      }
      return `<rect width="${W}" height="${H}" fill="${bg}"/>${cells.join('')}
        <rect x="60" y="60" width="80" height="80" fill="${ink}" opacity=".9"/>
        <text x="100" y="107" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="14" font-weight="700" fill="${bg}">${esc(album.slice(0, 8))}</text>`;
    },
    stripes: () => {
      const lines = [];
      for (let i = -8; i < 22; i++) {
        lines.push(`<rect x="${(i * 16).toFixed(0)}" y="-40" width="8" height="300" fill="${i % 3 === 0 ? accent : (i % 3 === 1 ? mid : 'rgba(255,255,255,.12)')}" transform="rotate(18 100 100)"/>`);
      }
      return `<rect width="${W}" height="${H}" fill="${bg}"/>${lines.join('')}
        <circle cx="100" cy="100" r="30" fill="${ink}"/>
        <circle cx="100" cy="100" r="14" fill="${bg}"/>`;
    },
    wave: () => {
      const arcs = [];
      for (let i = 0; i < 11; i++) {
        arcs.push(`<path d="M-10 ${(30 + i * 16).toFixed(0)} q 55 ${(-26 - r() * 22).toFixed(0)} 110 0 t 110 0" stroke="${i % 2 ? mid : accent}" stroke-width="${(3 + r() * 5).toFixed(1)}" fill="none" opacity="${(.85 - i * .05).toFixed(2)}"/>`);
      }
      return `<rect width="${W}" height="${H}" fill="${bg}"/>${arcs.join('')}
        <circle cx="150" cy="52" r="20" fill="${ink}" opacity=".85"/>`;
    },
    mono: () => `<rect width="${W}" height="${H}" fill="${accent}"/>
      <rect x="0" y="0" width="${W}" height="${(H / 2).toFixed(0)}" fill="${bg}" opacity=".92"/>
      <text x="100" y="150" text-anchor="middle" font-family="-apple-system, sans-serif" font-weight="800" font-size="${album.length > 9 ? 26 : 34}" fill="${ink}">${esc(album[0])}</text>
      <text x="100" y="178" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="11" letter-spacing="2" fill="${ink}" opacity=".8">${esc(album.toUpperCase())}</text>`,
    bloom: () => {
      const petals = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        petals.push(`<ellipse cx="${(100 + Math.cos(a) * 44).toFixed(0)}" cy="${(100 + Math.sin(a) * 44).toFixed(0)}" rx="30" ry="16" fill="${i % 2 ? mid : accent}" opacity=".8" transform="rotate(${(a * 180 / Math.PI).toFixed(0)} ${(100 + Math.cos(a) * 44).toFixed(0)} ${(100 + Math.sin(a) * 44).toFixed(0)})"/>`);
      }
      return `<rect width="${W}" height="${H}" fill="${bg}"/>${petals.join('')}<circle cx="100" cy="100" r="20" fill="${ink}"/>`;
    },
    /* Sundial: a low sun over a dial of rings and rays, graded and grained */
    sundial: () => {
      const cx = 118, cy = 78;
      const rays = [], arcs = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const r0 = 52 + (i % 2) * 6, r1 = 88 + r() * 20;
        rays.push(`<line x1="${(cx + Math.cos(a) * r0).toFixed(0)}" y1="${(cy + Math.sin(a) * r0).toFixed(0)}" x2="${(cx + Math.cos(a) * r1).toFixed(0)}" y2="${(cy + Math.sin(a) * r1).toFixed(0)}" stroke="${i % 3 ? ink : '#fff'}" stroke-width="${(1.4 + r() * 1.8).toFixed(1)}" opacity="${(.35 + r() * .4).toFixed(2)}"/>`);
      }
      for (let i = 0; i < 3; i++) {
        arcs.push(`<circle cx="${cx}" cy="${cy}" r="${64 + i * 22}" fill="none" stroke="${ink}" stroke-width="1" opacity="${(.3 - i * .08).toFixed(2)}"/>`);
      }
      return `<defs>
          <radialGradient id="${gid}s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${ink}"/><stop offset=".45" stop-color="${accent}"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
          <linearGradient id="${gid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mid}"/><stop offset=".62" stop-color="${bg}"/><stop offset="1" stop-color="${bg}"/></linearGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#${gid}g)"/>
        <circle cx="${cx}" cy="${cy}" r="98" fill="url(#${gid}s)" opacity=".8"/>
        ${arcs.join('')}${rays.join('')}
        <circle cx="${cx}" cy="${cy}" r="34" fill="${accent}"/>
        <circle cx="${cx}" cy="${cy}" r="34" fill="url(#${gid}s)" opacity=".5"/>
        <path d="M0 ${(H * .78).toFixed(0)}h${W}V${H}H0Z" fill="${mid}" opacity=".9"/>
        <path d="M0 ${(H * .78).toFixed(0)}h${W}" stroke="${ink}" stroke-width="1.2" opacity=".5"/>
        <path d="M20 ${(H * .86).toFixed(0)}h160M32 ${(H * .91).toFixed(0)}h136" stroke="${ink}" stroke-width="1" opacity=".25"/>
        ${label}${grain}`;
    },
    /* Second Nature: translucent leaves rising on thin stems through dusk light */
    understory: () => {
      const stems = [], leaves = [];
      const n = 9;
      for (let i = 0; i < n; i++) {
        const x = 14 + i * 24 + r() * 10, top = 26 + r() * 70, sway = r() * 36 - 18;
        stems.push(`<path d="M${x.toFixed(0)} ${H} q ${sway.toFixed(0)} ${(-(H - top) / 2).toFixed(0)} ${(sway * 0.4).toFixed(0)} ${-(H - top).toFixed(0)}" stroke="${mid}" stroke-width="1.6" fill="none" opacity="${(.5 + r() * .4).toFixed(2)}"/>`);
        const heads = 2 + Math.floor(r() * 3);
        for (let k = 0; k < heads; k++) {
          const ly = top + 10 + k * ((H - top - 20) / heads);
          const lx = x + sway * 0.4 * ((H - ly) / (H - top)) + (r() * 10 - 5);
          const s = 9 + r() * 17;
          const a = -60 + r() * 120;
          leaves.push(`<ellipse cx="${lx.toFixed(0)}" cy="${ly.toFixed(0)}" rx="${s.toFixed(0)}" ry="${(s * .46).toFixed(0)}" fill="${k % 2 ? accent : mid}" opacity="${(.35 + (1 - k / heads) * .45).toFixed(2)}" transform="rotate(${a.toFixed(0)} ${lx.toFixed(0)} ${ly.toFixed(0)})"/>`);
        }
        if (r() > .5) leaves.push(`<circle cx="${(x + sway * .4).toFixed(0)}" cy="${top.toFixed(0)}" r="${(3 + r() * 4).toFixed(1)}" fill="${ink}" opacity=".85"/>`);
      }
      return `<defs>
          <linearGradient id="${gid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset=".7" stop-color="${mid}"/><stop offset="1" stop-color="${bg}"/></linearGradient>
          <radialGradient id="${gid}m" cx=".6" cy=".3" r=".7"><stop offset="0" stop-color="${accent}" stop-opacity=".5"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#${gid}g)"/>
        <rect width="${W}" height="${H}" fill="url(#${gid}m)"/>
        ${stems.join('')}${leaves.join('')}
        <rect y="${H - 34}" width="${W}" height="34" fill="${bg}" opacity=".55"/>
        ${label}${grain}`;
    },
    split: () => `<rect width="${W}" height="${H}" fill="${mid}"/>
      <path d="M0 0h${W}v${(H * .62).toFixed(0)}L0 ${(H * .30).toFixed(0)}Z" fill="${bg}"/>
      <path d="M0 ${(H * .30).toFixed(0)} L${W} ${(H * .62).toFixed(0)} V${H}H0Z" fill="${accent}"/>
      <circle cx="${(60 + r() * 80).toFixed(0)}" cy="${(40 + r() * 40).toFixed(0)}" r="18" fill="${ink}"/>`,
  }[style]();
  return `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block" role="img" aria-label="${esc(album)} cover">${body}</svg>`;
}

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function wrapText(text, x, y, maxWidth, lineHeight, fill) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 12) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l, i) => `<text x="${x}" y="${y + i * lineHeight}" font-family="-apple-system, sans-serif" font-size="26" font-weight="800" fill="${fill}">${esc(l)}</text>`).join('');
}
