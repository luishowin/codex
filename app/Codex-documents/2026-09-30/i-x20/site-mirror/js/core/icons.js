// Every icon in the OS is hand-drawn inline SVG. No external images.
// Gradient ids are made unique per call so repeated icons never clash.
let seq = 0;
const uid = () => `gx${(++seq).toString(36)}`;

const svg = (body, vb = '0 0 100 100') =>
  `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;

const sq = (fill, radius = 23, x = 5, y = 5, w = 90, h = 90) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}"/>`;
const sheen = `<path d="M5 28C5 15 15 5 28 5h44c13 0 23 10 23 23v6c-18-9-48-12-90-6z" fill="#fff" opacity=".18"/>`;
const edge = `<rect x="5.5" y="5.5" width="89" height="89" rx="22.5" fill="none" stroke="#000" stroke-opacity=".13"/>`;

/* ── app icons ─────────────────────────────────────────────────────── */
const DRAW = {
  finder: () => {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8f4ff"/><stop offset=".5" stop-color="#b6dcfb"/><stop offset="1" stop-color="#7bb7ef"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${sheen}${edge}
      <path d="M50 5h22c13 0 23 10 23 23v44c0 13-10 23-23 23H50z" fill="#3d8ee0" opacity=".62"/>
      <path d="M50 5v90" stroke="#2f7bcc" stroke-opacity=".45"/>
      <ellipse cx="35" cy="42" rx="4.2" ry="7" fill="#163e63"/>
      <ellipse cx="65" cy="42" rx="4.2" ry="7" fill="#12375b"/>
      <path d="M29 58c2 12 10 19 21 19s19-7 21-19" fill="none" stroke="#163e63" stroke-width="4.2" stroke-linecap="round"/>`);
  },
  launchpad: () => {
    const g = uid();
    const colors = ['#ff5f57', '#ffbd2e', '#28c840', '#0a84ff', '#bf5af2', '#ff9f0a', '#64d2ff', '#ff375f', '#30d158'];
    let cells = '';
    colors.forEach((c, i) => {
      const x = 18 + (i % 3) * 22, y = 18 + Math.floor(i / 3) * 22;
      cells += `<rect x="${x}" y="${y}" width="16" height="16" rx="4.5" fill="${c}"/>`;
    });
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fdfdfd"/><stop offset="1" stop-color="#d8d9dd"/></linearGradient></defs>${sq(`url(#${g})`)}${sheen}${edge}${cells}`);
  },
  safari: () => {
    const g = uid(), n = uid();
    return svg(`<defs>
      <linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfdff"/><stop offset="1" stop-color="#dfe8f2"/></linearGradient>
      <radialGradient id="${n}" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#4fb0ff"/><stop offset="1" stop-color="#0664d8"/></radialGradient></defs>
      ${sq(`url(#${g})`)}${edge}
      <circle cx="50" cy="50" r="33" fill="url(#${n})"/>
      <circle cx="50" cy="50" r="33" fill="none" stroke="#fff" stroke-opacity=".55"/>
      ${[...Array(24)].map((_, i) => { const a = i * 15 * Math.PI / 180, r1 = 30, r2 = i % 6 === 0 ? 25.5 : 27.5; return `<line x1="${50 + Math.cos(a) * r1}" y1="${50 + Math.sin(a) * r1}" x2="${50 + Math.cos(a) * r2}" y2="${50 + Math.sin(a) * r2}" stroke="#fff" stroke-opacity=".8" stroke-width="${i % 6 === 0 ? 1.8 : 1}"/>`; }).join('')}
      <path d="M66 34 43.5 57.5 56 43z" fill="#ff4d4d"/><path d="M34 66l22.5-23.5L44 57z" fill="#fff"/>`);
  },
  notes: () => {
    const g = uid();
    let lines = '';
    for (let i = 0; i < 5; i++) lines += `<rect x="26" y="${48 + i * 8}" width="${i === 4 ? 24 : 48}" height="3.2" rx="1.6" fill="#c8c8ce"/>`;
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbe8"/><stop offset="1" stop-color="#fff3b8"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${edge}
      <rect x="5" y="5" width="90" height="22" rx="20" fill="#ffd60a"/>
      <path d="M5 16h90v11H5z" fill="#ffd60a"/>
      <path d="M17 24h66" stroke="#e0b400" stroke-opacity=".4"/>
      <circle cx="50" cy="37" r="3" fill="#a98c00" opacity=".5"/>
      ${lines}`);
  },
  terminal: () => svg(`
      <rect x="5" y="5" width="90" height="90" rx="23" fill="#1b1b1e"/>${edge}
      <rect x="5" y="5" width="90" height="20" rx="20" fill="#3a3a3d"/><path d="M5 15h90v10H5z" fill="#3a3a3d"/>
      <circle cx="16" cy="15" r="3" fill="#ff5f57"/><circle cx="26" cy="15" r="3" fill="#febc2e"/><circle cx="36" cy="15" r="3" fill="#28c840"/>
      <path d="M22 42l14 11-14 11" fill="none" stroke="#f2f2f4" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="43" y="60" width="26" height="5.5" rx="2.7" fill="#f2f2f4"/>`),
  calculator: () => svg(`
      <rect x="5" y="5" width="90" height="90" rx="23" fill="#2f2f33"/>${edge}
      <rect x="17" y="17" width="66" height="18" rx="4" fill="#0d0d0f"/>
      <g fill="#6c6c70">
        <rect x="17" y="42" width="15" height="15" rx="4"/><rect x="36" y="42" width="15" height="15" rx="4"/><rect x="55" y="42" width="15" height="15" rx="4"/>
        <rect x="17" y="62" width="15" height="15" rx="4"/><rect x="36" y="62" width="15" height="15" rx="4"/><rect x="55" y="62" width="15" height="15" rx="4"/>
        <rect x="17" y="82" width="34" height="10" rx="4"/>
      </g>
      <g fill="#ff9f0a"><rect x="74" y="42" width="9" height="35" rx="4"/><rect x="55" y="82" width="28" height="10" rx="4"/></g>`),
  textedit: () => {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3e6ec"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${edge}
      <rect x="24" y="20" width="44" height="52" rx="4" fill="#fff" stroke="#c3c7cf"/>
      <g fill="#b9bec7"><rect x="31" y="30" width="30" height="3" rx="1.5"/><rect x="31" y="39" width="30" height="3" rx="1.5"/><rect x="31" y="48" width="20" height="3" rx="1.5"/></g>
      <g transform="rotate(-40 62 62)"><rect x="56" y="44" width="12" height="32" rx="3" fill="#ffcc33"/><rect x="56" y="44" width="12" height="7" rx="3" fill="#ff5f57"/>
      <path d="M56 76h12l-6 9z" fill="#5b5f68"/><path d="M60 80h4l-2 4z" fill="#2f3238"/></g>`);
  },
  music: () => {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6482"/><stop offset=".5" stop-color="#ff375f"/><stop offset="1" stop-color="#d8133c"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${sheen}${edge}
      <path d="M42 68V29l28-6v39" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
      <ellipse cx="35" cy="68" rx="10" ry="7.5" fill="#fff"/><ellipse cx="63" cy="62" rx="10" ry="7.5" fill="#fff"/>`);
  },
  settings: () => {
    const g = uid();
    const teeth = (cx, cy, r, n, w) => Array.from({ length: n }, (_, i) => {
      const a = i * 2 * Math.PI / n;
      return `<rect x="${cx - w / 2}" y="${cy - r - w * .8}" width="${w}" height="${w * 1.7}" rx="${w * .35}" fill="#e9e9ec" transform="rotate(${(a * 180 / Math.PI).toFixed(1)} ${cx} ${cy})"/>`;
    }).join('');
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a9ba0"/><stop offset="1" stop-color="#5b5c62"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${edge}
      <g transform="translate(50 50) scale(1)">${teeth(0, 0, 25, 10, 8)}
      <circle r="23" fill="#e9e9ec"/><circle r="9" fill="#7a7b81"/></g>
      <g opacity=".95" transform="translate(72 26) scale(.42)">${teeth(0, 0, 25, 8, 9)}<circle r="24" fill="#d6d6da"/><circle r="9" fill="#7a7b81"/></g>`);
  },
  photos: () => {
    const g = uid();
    const petals = ['#ffcc00', '#ff9f0a', '#ff375f', '#bf5af2', '#0a84ff', '#32ade6', '#30d158', '#ffd60a'];
    return svg(`<defs><radialGradient id="${g}" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#f2f2f5"/></radialGradient></defs>
      ${sq(`url(#${g})`)}${edge}
      <g transform="translate(50 50)">${petals.map((c, i) => `<ellipse cx="0" cy="-13" rx="8" ry="14" fill="${c}" opacity=".88" transform="rotate(${i * 45})"/>`).join('')}</g>
      <circle cx="50" cy="50" r="5" fill="#fff" opacity=".85"/>`);
  },
  calendar: () => {
    const d = new Date();
    return svg(`
      <rect x="5" y="5" width="90" height="90" rx="23" fill="#fff"/>${edge}
      <path d="M5 28a23 23 0 0 1 23-23h44a23 23 0 0 1 23 23v9H5z" fill="#ff453a"/>
      <text x="50" y="24" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="13" font-weight="600" fill="#fff" letter-spacing="1.5">${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()}</text>
      <text x="50" y="78" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="52" font-weight="300" fill="#1d1d1f">${d.getDate()}</text>`);
  },
  messages: () => {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6ef07d"/><stop offset="1" stop-color="#20c944"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${sheen}${edge}
      <path d="M50 24c-18 0-31 11-31 25 0 8 5 15 13 19l-3 11 13-7c2 .4 5 .6 8 .6 18 0 31-11 31-24S68 24 50 24z" fill="#fff"/>`);
  },
  mail: () => {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#48b7ff"/><stop offset="1" stop-color="#1274e8"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${sheen}${edge}
      <rect x="20" y="30" width="60" height="42" rx="6" fill="#fff"/>
      <path d="M22 34l28 21 28-21" fill="none" stroke="#2f7ed0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
  },
  maps: () => svg(`
      <rect x="5" y="5" width="90" height="90" rx="23" fill="#e8f3e2"/>${edge}
      <path d="M5 62c18-6 28 8 46 2s28-14 44-8v22a17 17 0 0 1-17 17H22A17 17 0 0 1 5 78z" fill="#a8dba0"/>
      <path d="M5 39l90 22" stroke="#fff" stroke-width="6" opacity=".9"/><path d="M38 5l14 90" stroke="#fff" stroke-width="6" opacity=".9"/>
      <path d="M62 22a11 11 0 0 0-11 11c0 8 11 21 11 21s11-13 11-21a11 11 0 0 0-11-11z" fill="#ff453a"/>
      <circle cx="62" cy="33" r="4" fill="#fff"/>`),
  facetime: () => {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ce07a"/><stop offset="1" stop-color="#1fae46"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${sheen}${edge}
      <rect x="20" y="34" width="40" height="32" rx="7" fill="#fff"/><path d="M64 46l16-9v36l-16-9z" fill="#fff"/>`);
  },
  contacts: () => {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0d9b8"/><stop offset="1" stop-color="#c9a274"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${edge}
      <rect x="5" y="5" width="90" height="90" rx="23" fill="none"/>
      <g fill="#a67c4e"><rect x="14" y="16" width="5" height="68" rx="2.5"/><rect x="27" y="16" width="5" height="68" rx="2.5"/><rect x="68" y="16" width="5" height="68" rx="2.5"/><rect x="81" y="16" width="5" height="68" rx="2.5"/></g>
      <circle cx="50" cy="42" r="13" fill="#fff"/><path d="M29 76c2-13 10-19 21-19s19 6 21 19z" fill="#fff"/>`);
  },
  reminders: () => {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#eceef2"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${edge}
      <g><circle cx="28" cy="34" r="5" fill="#ff453a"/><circle cx="28" cy="52" r="5" fill="#ff9f0a"/><circle cx="28" cy="70" r="5" fill="#0a84ff"/></g>
      <g fill="#c2c5cb"><rect x="40" y="31" width="38" height="6" rx="3"/><rect x="40" y="49" width="30" height="6" rx="3"/><rect x="40" y="67" width="34" height="6" rx="3"/></g>`);
  },
  freeform: () => {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#eef0f4"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${edge}
      <path d="M22 66c6-26 18 8 28-10s18 14 28-6" fill="none" stroke="#ff375f" stroke-width="6" stroke-linecap="round"/>
      <circle cx="26" cy="38" r="6" fill="#0a84ff"/><circle cx="74" cy="70" r="5" fill="#30d158"/>`);
  },
  tv: () => svg(`
      <rect x="5" y="5" width="90" height="90" rx="23" fill="#101012"/>${edge}
      <text x="50" y="66" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="40" font-weight="600" fill="#fff">tv</text>`),
  news: () => svg(`
      <rect x="5" y="5" width="90" height="90" rx="23" fill="#fff"/>${edge}
      <path d="M50 22 72 72H57l-4-10H39l-4 10H20z" fill="#ff3b30"/>
      <path d="M50 38l-5 15h10z" fill="#fff"/>`),
  appstore: () => {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ec6ff"/><stop offset="1" stop-color="#0a6cff"/></linearGradient></defs>
      ${sq(`url(#${g})`)}${sheen}${edge}
      <g stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none">
        <path d="M40 64 56 36"/><path d="M32 40h32"/><path d="M32 40l-4 12 10-2"/><path d="M64 40l4 12-10-2"/><path d="M44 62h24"/></g>`);
  },
  trash: (full = false) => svg(`
      <g>
        <rect x="26" y="26" width="48" height="62" rx="8" fill="rgba(226,232,240,.72)" stroke="rgba(120,132,148,.75)"/>
        <ellipse cx="50" cy="26" rx="24" ry="7" fill="rgba(238,243,250,.85)" stroke="rgba(120,132,148,.75)"/>
        <g stroke="rgba(150,162,178,.65)"><line x1="38" y1="40" x2="38" y2="76"/><line x1="50" y1="40" x2="50" y2="76"/><line x1="62" y1="40" x2="62" y2="76"/></g>
        ${full ? `<path d="M30 22l8-8 7 6 8-6 6 9-4 5-25-6z" fill="#fdfdfd" stroke="rgba(140,150,165,.7)"/>` : ''}
      </g>`),
  generic: () => svg(`
      <path d="M22 8h38l18 18v66a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#fbfbfd" stroke="#b9bec7"/>
      <path d="M60 8l18 18H64a4 4 0 0 1-4-4z" fill="#d7dbe2"/>
      <g fill="#c4c8d0"><rect x="30" y="42" width="38" height="3" rx="1.5"/><rect x="30" y="52" width="38" height="3" rx="1.5"/><rect x="30" y="62" width="24" height="3" rx="1.5"/></g>`),
};

const ALIAS = { about: 'settings', trashEmpty: 'trash', systemSettings: 'settings' };
export function appIcon(id, opts = {}) {
  /* an app meta may carry a raw svg string instead of a registry key */
  if (typeof id === 'string' && id.trim().startsWith('<svg')) return id;
  const key = ALIAS[id] || id;
  const draw = DRAW[key] || DRAW.generic;
  /* `appIcon('trash', {full: true})` and `appIcon('trash', true)` both work */
  const arg = opts && typeof opts === 'object' && 'full' in opts ? opts.full : opts;
  return draw(arg);
}

/* ── folder icons ──────────────────────────────────────────────────── */
const FOLDER_GLYPHS = {
  Desktop: `<rect x="35" y="44" width="30" height="20" rx="2.5" fill="none" stroke="#1d6eb5" stroke-width="3"/><rect x="43" y="53" width="14" height="3" fill="#1d6eb5"/>`,
  Documents: `<path d="M42 40h11l6 7v20a2 2 0 0 1-2 2H42a2 2 0 0 1-2-2V42a2 2 0 0 1 2-2z" fill="none" stroke="#1d6eb5" stroke-width="3"/><path d="M53 40v8h7" fill="none" stroke="#1d6eb5" stroke-width="3"/>`,
  Downloads: `<circle cx="50" cy="50" r="13" fill="#1d6eb5"/><path d="M50 42v11m-5-5 5 5 5-5" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  Pictures: `<rect x="34" y="40" width="32" height="24" rx="3" fill="none" stroke="#1d6eb5" stroke-width="3"/><circle cx="43" cy="48" r="3" fill="#1d6eb5"/><path d="M36 61l9-8 6 5 6-7 7 10z" fill="#1d6eb5"/>`,
  Music: `<path d="M54 40v17" stroke="#1d6eb5" stroke-width="3.2" stroke-linecap="round"/><ellipse cx="47" cy="58" rx="7" ry="5.4" fill="#1d6eb5"/><ellipse cx="58" cy="54" rx="7" ry="5.4" fill="#1d6eb5"/>`,
  Movies: `<rect x="34" y="38" width="32" height="28" rx="3" fill="none" stroke="#1d6eb5" stroke-width="3"/><g fill="#1d6eb5">${[0, 1, 2].map(i => `<rect x="37" y="${41 + i * 8}" width="3" height="6" rx="1"/><rect x="60" y="${41 + i * 8}" width="3" height="6" rx="1"/>`).join('')}</g><path d="M37 56h26" stroke="#1d6eb5" stroke-width="2.4"/>`,
  Public: `<circle cx="50" cy="42" r="5" fill="#1d6eb5"/><path d="M50 49l-3 10 7 4M50 59l-6 9m6-9 7 9m-7-18 9-5" stroke="#1d6eb5" stroke-width="3" fill="none" stroke-linecap="round"/>`,
};
export function folderIcon(name = '', opts = {}) {
  const g = uid();
  /* real macOS only decorates the special folders; anything else is a plain one */
  const glyph = FOLDER_GLYPHS[name] || '';
  return svg(`<defs>
      <linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd4f7"/><stop offset="1" stop-color="#3f9fe0"/></linearGradient>
      <linearGradient id="${g}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5bb5ec"/><stop offset="1" stop-color="#2e8fd4"/></linearGradient></defs>
    <path d="M10 26a6 6 0 0 1 6-6h20l7 7h41a6 6 0 0 1 6 6v41a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6z" fill="url(#${g}t)"/>
    <path d="M8 38a6 6 0 0 1 6-6h72a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z" fill="url(#${g})"/>
    <path d="M8 38a6 6 0 0 1 6-6h72a6 6 0 0 1 6 6v5H8z" fill="#fff" opacity=".28"/>
    <path d="M8 71h84" stroke="#1e6fae" stroke-opacity=".35"/>
    ${glyph}`, '0 0 100 92');
}

/* ── file icons ────────────────────────────────────────────────────── */
const IMAGE_PALETTES = [
  ['#123b6d', '#2f7fd0', '#8fd0ff'], ['#7b2d5e', '#d04a7d', '#ffc2a1'],
  ['#0f5b4a', '#2fae86', '#d6f2a8'], ['#2c3566', '#5b6ed6', '#b8c6ff'],
];
export function fileIcon(node) {
  if (!node) return DRAW.generic();
  if (node.type === 'dir') return folderIcon(node.name);
  if (node.kind === 'app') return appIcon(node.app || 'generic');
  if (node.kind === 'image') {
    const g = uid();
    const p = IMAGE_PALETTES[node.palette ?? 0];
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[1]}"/><stop offset="1" stop-color="${p[2]}"/></linearGradient></defs>
      <rect x="8" y="14" width="84" height="72" rx="7" fill="url(#${g})" stroke="rgba(0,0,0,.14)"/>
      <path d="M8 70l24-22 16 14 14-12 30 20v8a7 7 0 0 1-7 8H15a7 7 0 0 1-7-7z" fill="rgba(0,0,0,.32)"/>
      <circle cx="70" cy="34" r="9" fill="rgba(255,255,255,.85)"/>`);
  }
  if (node.kind === 'audio') {
    const g = uid();
    return svg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a8a"/><stop offset="1" stop-color="#d81e4a"/></linearGradient></defs>
      <rect x="10" y="12" width="80" height="76" rx="8" fill="url(#${g})"/>
      <path d="M56 28v30" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
      <ellipse cx="46" cy="58" rx="10" ry="7.5" fill="#fff"/><ellipse cx="60" cy="54" rx="7" ry="5" fill="#fff"/>`);
  }
  return DRAW.generic();
}

/* ── menu bar / control glyphs (stroke icons) ──────────────────────── */
const G = {
  apple: '',
  gear: `<circle cx="8" cy="8" r="2.4"/><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3"/><circle cx="8" cy="8" r="5.2"/>`,
  doc: `<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>`,
  folderSmall: `<path d="M1.8 4.6A1.2 1.2 0 0 1 3 3.4h3l1.4 1.6h5.6a1.2 1.2 0 0 1 1.2 1.2v6.4a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z"/>`,
  download: `<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8v5.4M5.6 8.2 8 10.6l2.4-2.4"/>`,
  clock: `<circle cx="8" cy="8" r="6.2"/><path d="M8 4.4V8l2.6 1.6"/>`,
  wifi: `<path d="M1 4.5a11 11 0 0 1 14 0M3.6 7.6a7.4 7.4 0 0 1 8.8 0M6.2 10.6a3.8 3.8 0 0 1 3.6 0"/><circle cx="8" cy="13" r="1.1" fill="currentColor" stroke="none"/>`,
  wifiOff: `<path d="M1 4.5a11 11 0 0 1 5-2.7M9 1.8a11 11 0 0 1 6 2.7M3.6 7.6a7.4 7.4 0 0 1 3.3-1.7M10.5 5.7a7.4 7.4 0 0 1 1.9 1.9M8 13h.01"/><path d="M1 1l14 14" stroke-width="1.5"/>`,
  battery: `<rect x="1" y="4.2" width="11.6" height="7.6" rx="2.2" fill="none"/><path d="M14 6.6v2.8" stroke-width="1.8"/><rect x="2.6" y="5.8" width="6.6" height="4.4" rx="1" fill="currentColor" stroke="none"/><path d="M7.6 5.2 5.4 8.4h1.8l-.5 2.4 2.4-3.2H7.4z" fill="currentColor" stroke="none"/>`,
  bolt: `<path d="M9.2 1 3.5 9.2h3.7L7 15l5.7-8.4H9z" fill="currentColor" stroke="none"/>`,
  control: `<rect x="1.4" y="3.2" width="13.2" height="4.2" rx="2.1"/><circle cx="5.2" cy="5.3" r="1.7" fill="currentColor" stroke="none"/><rect x="1.4" y="8.6" width="13.2" height="4.2" rx="2.1"/><circle cx="10.8" cy="10.7" r="1.7" fill="currentColor" stroke="none"/>`,
  search: `<circle cx="7" cy="7" r="5" fill="none"/><path d="m11 11 3.4 3.4"/>`,
  siri: `<circle cx="8" cy="8" r="6.4" fill="none"/><circle cx="8" cy="8" r="2.6" fill="currentColor" stroke="none"/><path d="M8 1.6V3M8 13v1.4M1.6 8H3M13 8h1.4" stroke-width="1.3"/>`,
  volume: `<path d="M2 6.2h2.6L8 3.2v9.6L4.6 9.8H2z" fill="currentColor" stroke="none"/><path d="M10.4 6a3 3 0 0 1 0 4M12.4 4.2a5.6 5.6 0 0 1 0 7.6"/>`,
  volumeMute: `<path d="M2 6.2h2.6L8 3.2v9.6L4.6 9.8H2z" fill="currentColor" stroke="none"/><path d="m10.6 6.2 4 3.6m0-3.6-4 3.6"/>`,
  sun: `<circle cx="8" cy="8" r="3.2"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.2 1.2M11.8 11.8 13 13M13 3l-1.2 1.2M4.2 11.8 3 13"/>`,
  moon: `<path d="M13.4 9.8A5.8 5.8 0 0 1 6.2 2.6a5.8 5.8 0 1 0 7.2 7.2z"/>`,
  bluetooth: `<path d="M5 4.6 11 11 8 13.4V2.6L11 5 5 11.4"/>`,
  airdrop: `<path d="M8 10.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM5 8.2a4.2 4.2 0 0 1 6 0M2.6 5.8a7.6 7.6 0 0 1 10.8 0" fill="none" stroke-width="1.4"/>`,
  play: `<path d="M4 2.6 13 8l-9 5.4z" fill="currentColor" stroke="none"/>`,
  pause: `<rect x="4" y="2.6" width="3" height="10.8" rx="1" fill="currentColor" stroke="none"/><rect x="9" y="2.6" width="3" height="10.8" rx="1" fill="currentColor" stroke="none"/>`,
  next: `<path d="M3 3l7 5-7 5zM12 3v10" fill="currentColor" stroke="none"/>`,
  prev: `<path d="M13 3 6 8l7 5zM4 3v10" fill="currentColor" stroke="none"/>`,
  chevL: `<path d="M10.5 3 5.5 8l5 5"/>`,
  chevR: `<path d="M5.5 3l5 5-5 5"/>`,
  chevD: `<path d="M3.5 6 8 10.5 12.5 6"/>`,
  chevU: `<path d="M3.5 10 8 5.5 12.5 10"/>`,
  plus: `<path d="M8 3v10M3 8h10"/>`,
  minus: `<path d="M3 8h10"/>`,
  check: `<path d="M3 8.5 6.4 12 13 4.5"/>`,
  ellipsis: `<circle cx="3.4" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="12.6" cy="8" r="1.5" fill="currentColor" stroke="none"/>`,
  grid: `<rect x="2" y="2" width="5" height="5" rx="1.4"/><rect x="9" y="2" width="5" height="5" rx="1.4"/><rect x="2" y="9" width="5" height="5" rx="1.4"/><rect x="9" y="9" width="5" height="5" rx="1.4"/>`,
  list: `<path d="M5.5 4.5h9M5.5 8h9M5.5 11.5h9"/><circle cx="2.4" cy="4.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="2.4" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="2.4" cy="11.5" r="1.1" fill="currentColor" stroke="none"/>`,
  columns: `<rect x="2" y="2.6" width="12" height="10.8" rx="2"/><path d="M8 2.6v10.8"/>`,
  gallery: `<path d="M2 10.5V4a1.5 1.5 0 0 1 1.5-1.5H8M8 2.5h5.5A1.5 1.5 0 0 1 15 4v6.5A1.5 1.5 0 0 1 13.5 12H8"/>`,
  share: `<path d="M8 10.5V2.2M5 5.2 8 2.2l3 3"/><path d="M3.2 8v4.6a1.2 1.2 0 0 0 1.2 1.2h7.2a1.2 1.2 0 0 0 1.2-1.2V8"/>`,
  tag: `<path d="M2.5 2.5h5L14 9l-4.5 4.5-6.5-6.5z"/><circle cx="5.4" cy="5.4" r="1.1" fill="currentColor" stroke="none"/>`,
  info: `<circle cx="8" cy="8" r="6.3"/><path d="M8 7.2v4M8 4.6v.1" stroke-width="1.6"/>`,
  folderPlus: `<path d="M2 5.2A1.2 1.2 0 0 1 3.2 4h3l1.4 1.6h5.2A1.2 1.2 0 0 1 14 6.8v5.4a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 12.2z"/><path d="M8 8v3.4M6.3 9.7h3.4"/>`,
  trashSmall: `<path d="M3.5 4.8h9M6.4 4.8V3.2h3.2v1.6M4.6 4.8l.6 8.4h5.6l.6-8.4"/>`,
  lock: `<rect x="3.5" y="7" width="9" height="6.5" rx="1.6"/><path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.8 0V7"/>`,
  display: `<rect x="1.5" y="2.5" width="13" height="9" rx="1.6"/><path d="M6 14h4"/>`,
  bold: `<path d="M5 3h4a2.6 2.6 0 0 1 0 5.2H5zM5 8.2h4.6a2.9 2.9 0 0 1 0 5.8H5z" fill="currentColor" stroke="none"/>`,
  italic: `<path d="M10.5 3h-4M9.5 13h-4M9 3 7 13"/>`,
  underline: `<path d="M4.5 3v5a3.5 3.5 0 0 0 7 0V3M4 14h8"/>`,
  alignLeft: `<path d="M2.5 4h11M2.5 8h7M2.5 12h9"/>`,
  trashFull: `<path d="M3 5h10l-.8 9.2H3.8zM5.5 5V3h5v2"/><path d="M5.6 7.4 6 12M8 7.4V12M10.4 7.4 10 12"/>`,
  star: `<path d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z"/>`,
  pin: `<path d="M6 2h4l-.6 4 2.6 2.2H4L6.6 6zM8 8.2V14"/>`,
  noteNew: `<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 5.5v5M5.5 8h5"/>`,
  camera: `<path d="M2 5.5h2.6l1-1.7h4.8l1 1.7H14v7.2H2z"/><circle cx="8" cy="9" r="2.4"/>`,
  wifiBars: `<path d="M2.5 12.5h1.6v-2H2.5zM6.2 12.5h1.6V7.8H6.2zM9.9 12.5h1.6V4h-1.6z"/>`,
  power: `<path d="M8 2v6"/><path d="M4.4 4.6a5 5 0 1 0 7.2 0"/>`,
  keyboard: `<rect x="1.5" y="4" width="13" height="8.5" rx="1.6"/><path d="M4 7h.1M6.5 7h.1M9 7h.1M11.5 7h.1M4 9.5h8" stroke-width="1.3"/>`,
  globe: `<circle cx="8" cy="8" r="6.3"/><path d="M1.8 8h12.4M8 1.7c2 2.2 2 9.4 0 12.6M8 1.7c-2 2.2-2 9.4 0 12.6"/>`,
};
export function glyph(name, cls = 'glyph') {
  return svg(G[name] || G.info, '0 0 16 16').replace('<svg ', `<svg class="${cls}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" `);
}
/* Hand-drawn Apple silhouette (menu bar, boot, power screens). */
const APPLE_PATH = 'M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zM554.1 159.4c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z';
export function appleLogo(size) {
  const s = size ? ` width="${size}" height="${size}"` : ' style="width:100%;height:100%"';
  return `<svg viewBox="0 0 814 1000" xmlns="http://www.w3.org/2000/svg"${s} aria-hidden="true"><path d="${APPLE_PATH}"/></svg>`;
}
export const powerLogo = () => svg(G.power, '0 0 16 16').replace('<svg ', '<svg style="width:100%;height:100%" fill="none" stroke="currentColor" stroke-width="1.6" ');

/* extra system glyphs for the Settings sidebar (filled or stroked, per shape) */
Object.assign(G, {
  bell: `<path d="M8 2.2a4.4 4.4 0 0 0-4.4 4.4v2.6L2.4 11.4h11.2L12.4 9.2V6.6A4.4 4.4 0 0 0 8 2.2Z" fill="currentColor" stroke="none"/><path d="M6.4 13a1.6 1.6 0 0 0 3.2 0" stroke-width="1.2" stroke-linecap="round"/>`,
  speaker: `<path d="M8 3.4 4.9 5.8H2.6v4.4h2.3L8 12.6Z" fill="currentColor" stroke="none"/><path d="M10.4 6.1a2.6 2.6 0 0 1 0 3.8M12.2 4.3a5.2 5.2 0 0 1 0 7.4" stroke-width="1.2" stroke-linecap="round"/>`,
  hourglass: `<path d="M4.2 2.6h7.6M4.2 13.4h7.6" stroke-width="1.4" stroke-linecap="round"/><path d="M5.2 2.6v2.1c0 1.6 2.8 2.2 2.8 3.3 0 1.1-2.8 1.7-2.8 3.3v2.1M10.8 2.6v2.1c0 1.6-2.8 2.2-2.8 3.3 0 1.1 2.8 1.7 2.8 3.3v2.1" stroke-width="1.2" stroke-linecap="round"/>`,
  person: `<circle cx="8" cy="5" r="2.3" fill="currentColor" stroke="none"/><path d="M3.5 13.4c0-2.5 2-4.2 4.5-4.2s4.5 1.7 4.5 4.2Z" fill="currentColor" stroke="none"/>`,
  hand: `<path d="M5.4 8.2V4.3a1.05 1.05 0 0 1 2.1 0v3M7.5 6.9V3.3a1.05 1.05 0 0 1 2.1 0v3.6M9.6 6.9V4.2a1.05 1.05 0 0 1 2.1 0v3.7M11.7 7.4a1.05 1.05 0 0 1 2.1 0v2.2c0 2.5-1.9 4.2-4.4 4.2s-4-1.4-4.5-3l-.7-1.9a1.05 1.05 0 0 1 1.8-.8Z" fill="currentColor" stroke="none"/>`,
  users: `<circle cx="6.1" cy="5.4" r="2.1" fill="currentColor" stroke="none"/><path d="M2.5 12.6c0-2 1.6-3.4 3.6-3.4s3.6 1.4 3.6 3.4Z" fill="currentColor" stroke="none"/><path d="M10.7 3.7a2.1 2.1 0 0 1 0 4.1M11.7 9.5c1.3.4 2.2 1.5 2.2 3.1" stroke-width="1.1" stroke-linecap="round"/>`,
  at: `<circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/><path d="M10 6.1v3.3a1.7 1.7 0 0 0 3 .6A6 6 0 1 0 10.1 13" stroke-width="1.2" stroke-linecap="round"/>`,
  desktop: `<rect x="1.8" y="3" width="12.4" height="8" rx="1.2" fill="currentColor" stroke="none"/><path d="M5.4 13.4h5.2" stroke-width="1.3" stroke-linecap="round"/>`,
  flower: `<circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/><circle cx="8" cy="4.1" r="1.6" fill="currentColor" stroke="none"/><circle cx="8" cy="11.9" r="1.6" fill="currentColor" stroke="none"/><circle cx="4.4" cy="6" r="1.6" fill="currentColor" stroke="none"/><circle cx="11.6" cy="6" r="1.6" fill="currentColor" stroke="none"/><circle cx="4.4" cy="10" r="1.6" fill="currentColor" stroke="none"/><circle cx="11.6" cy="10" r="1.6" fill="currentColor" stroke="none"/>`,
  fingerprint: `<path d="M4.2 8.2a3.8 3.8 0 0 1 7.6 0c0 1.9-.2 3.3-.6 4.4M2.4 7.4a5.6 5.6 0 0 1 11.2 0c0 2.6-.4 4.4-1 5.6M6.7 8.8a1.3 1.3 0 0 1 2.6 0c0 2.3-.3 3.9-.7 4.9M8 9.2v1.5" stroke-width="1.1" stroke-linecap="round"/>`,
  switches: `<rect x="2" y="4.4" width="12" height="3.2" rx="1.6" fill="currentColor" stroke="none"/><circle cx="5.4" cy="6" r="1.3" fill="#fff" stroke="none"/><rect x="2" y="9" width="12" height="3.2" rx="1.6" fill="currentColor" stroke="none"/><circle cx="10.6" cy="10.6" r="1.3" fill="#fff" stroke="none"/>`,
  sparkle: `<path d="M8 1.4 9.4 5.6 13.6 7 9.4 8.4 8 12.6 6.6 8.4 2.4 7 6.6 5.6z"/><path d="M12.6 10.8l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" stroke-width="1.1"/>`,
  pencil: `<path d="M11.4 2.2l2.4 2.4-8 8-3.2.8.8-3.2z"/><path d="M9.8 3.8l2.4 2.4" stroke-width="1.1"/>`,
  x: `<path d="M4 4l8 8M12 4l-8 8"/>`,
  appearance: `<circle cx="8" cy="8" r="5.4" fill="none"/><path d="M8 2.6a5.4 5.4 0 0 0 0 10.8Z" fill="currentColor" stroke="none"/>`,
  backspace: `<path d="M6 3.2h7.2v9.6H6L1.8 8Z"/><path d="M8.6 6.4 11 8.8M11 6.4 8.6 8.8" stroke-width="1.2" stroke-linecap="round"/>`,
  home: `<path d="M2.6 7.4 8 2.8l5.4 4.6v5.4a.8.8 0 0 1-.8.8H3.4a.8.8 0 0 1-.8-.8Z"/><path d="M6.4 13.6V9.2h3.2v4.4"/>`,
  gamepad: `<path d="M4.6 5.6h6.8a3.3 3.3 0 0 1 3.2 4.1l-.6 2.1a1.6 1.6 0 0 1-2.9.5l-.9-1.5H6.8l-.9 1.5a1.6 1.6 0 0 1-2.9-.5l-.6-2.1a3.3 3.3 0 0 1 3.2-4.1Z" fill="currentColor" stroke="none"/><path d="M5.6 7.4v2.4M4.4 8.6h2.4" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/><circle cx="10.3" cy="7.8" r=".75" fill="#fff" stroke="none"/><circle cx="11.8" cy="9.2" r=".75" fill="#fff" stroke="none"/>`,
});
