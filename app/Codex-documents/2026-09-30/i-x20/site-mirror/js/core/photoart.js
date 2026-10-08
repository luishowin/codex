// Photo artwork: every picture in this Mac is drawn, never loaded — and drawn to
// read as a photograph rather than an illustration. The recipe is the one a
// landscape photographer works to: a graded sky with real cloud banks, light
// falling from a low sun, three depth planes kept clearly apart in value, air
// between them, texture and shadow in the foreground, a warm/cool grade, film
// grain and a lens vignette.
/* deterministic noise, so a photo always looks the same */
function rng(seed) {
  let s = (seed * 2654435761) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = s * 16807 % 2147483647) - 1) / 2147483646;
}

/* the library: real dates spread across three years, real places a photo
   could have been taken, `ll` = latitude/longitude for the Info map */
export const PHOTOS = [
  { name: 'Cove at low tide', kind: 'beach', seed: 11, day: 0, place: 'Stinson Beach', ll: [37.9006, -122.6444] },
  { name: 'Snow on the pass', kind: 'mountain', seed: 23, day: 0, place: 'Mount Tamalpais', ll: [37.9235, -122.5965] },
  { name: 'Harbour lights', kind: 'city', seed: 31, day: 0, place: 'San Francisco', ll: [37.7955, -122.3937] },
  { name: 'Pines before the rain', kind: 'forest', seed: 37, day: 1, place: 'Muir Woods', ll: [37.8970, -122.5810] },
  { name: 'Dune trail', kind: 'desert', seed: 41, day: 9, place: 'Death Valley', ll: [36.5323, -116.9325] },
  { name: 'Sea stack at dusk', kind: 'coast', seed: 47, day: 15, place: 'Point Reyes', ll: [38.0693, -122.8100] },
  { name: 'Northern lights', kind: 'aurora', seed: 53, day: 26, place: 'Tromsø', ll: [69.6492, 18.9553] },
  { name: 'Foxgloves', kind: 'flower', seed: 59, day: 44, place: 'Mount Diablo', ll: [37.8817, -121.9142] },
  { name: 'Glass district', kind: 'city', seed: 67, day: 61, place: 'San Francisco', ll: [37.7897, -122.4027] },
  { name: 'Still water', kind: 'lake', seed: 71, day: 84, place: 'Lake Alpine', ll: [38.4773, -119.9982] },
  { name: 'Study in ultramarine', kind: 'abstract', seed: 79, day: 110, place: 'Home', ll: [37.7749, -122.4194] },
  { name: 'Alpenglow', kind: 'mountain', seed: 83, day: 138, place: 'Mount Tamalpais', ll: [37.9290, -122.5770] },
  { name: 'Last light, north ridge', kind: 'coast', seed: 97, day: 172, place: 'Point Reyes', ll: [38.0440, -122.7987] },
  { name: 'Cedar smoke', kind: 'forest', seed: 103, day: 205, place: 'Muir Woods', ll: [37.8953, -122.5786] },
  { name: 'Salt flats', kind: 'desert', seed: 109, day: 246, place: 'Death Valley', ll: [36.6061, -117.1450] },
  /* a real weekend away, so Memories has a cluster to find */
  { name: 'Driftwood shack', kind: 'coast', seed: 113, day: 285, place: 'Bodega Bay', ll: [38.3332, -123.0481] },
  { name: 'Gull on the rail', kind: 'beach', seed: 127, day: 286, place: 'Bodega Bay', ll: [38.3240, -123.0570] },
  { name: 'Harbour fog, morning', kind: 'coast', seed: 139, day: 287, place: 'Bodega Bay', ll: [38.3294, -123.0580] },
  { name: 'Cliff path', kind: 'field', seed: 149, day: 287, place: 'Bodega Bay', ll: [38.3155, -123.0444] },
  { name: 'Blue hour ferry', kind: 'city', seed: 157, day: 330, place: 'San Francisco', ll: [37.7955, -122.3937] },
  { name: 'Wildflower meadow', kind: 'field', seed: 163, day: 402, place: 'Petaluma', ll: [38.2324, -122.6367] },
  { name: 'Rain on the window', kind: 'abstract', seed: 167, day: 480, place: 'Home', ll: [37.7749, -122.4194] },
  { name: 'Morning market', kind: 'city', seed: 179, day: 555, place: 'Oakland', ll: [37.8044, -122.2712] },
  { name: 'Green flash', kind: 'beach', seed: 191, day: 620, place: 'Stinson Beach', ll: [37.8947, -122.6396] },
  { name: 'Paper garden', kind: 'abstract', seed: 223, day: 700, place: 'Home', ll: [37.7749, -122.4194] },
  { name: 'Frozen tarn', kind: 'lake', seed: 241, day: 780, place: 'Lake Alpine', ll: [38.4801, -119.9507] },
  { name: 'Dawn over the sound', kind: 'coast', seed: 257, day: 855, place: 'Sausalito', ll: [37.8591, -122.4853] },
  { name: 'Shingle beach', kind: 'beach', seed: 263, day: 930, place: 'Stinson Beach', ll: [37.8972, -122.6380] },
  { name: 'Fog bank', kind: 'coast', seed: 269, day: 990, place: 'Point Reyes', ll: [38.0693, -122.8100] },
  { name: 'First snow', kind: 'mountain', seed: 271, day: 1045, place: 'Mount Tamalpais', ll: [37.9235, -122.5965] },
];

/** per kind: [sky top, sky mid, horizon, far plane, near plane, light, accent] */
const PALETTES = {
  beach: [
    ['#3f9ce0', '#8ccdf0', '#cfe8f4', '#6f9cb4', '#2c5567', '#fff6d4', '#dcc79a'],
    ['#ec9461', '#ffc999', '#ffe6c4', '#8e7269', '#4a3630', '#fff8e4', '#b8916a'],
    ['#d78678', '#f6b49b', '#fdd6bf', '#8f6f67', '#472f2c', '#fff2e2', '#ab7c5c'],
  ],
  mountain: [
    ['#7ba6d8', '#adc8e6', '#dde9f6', '#5c7597', '#243146', '#ffffff', '#59697f'],
    ['#dfa877', '#eecaa6', '#f7e4c9', '#7b6d7c', '#33293a', '#fffaf2', '#6b5a63'],
    ['#948fb8', '#bcbade', '#e2e2f2', '#544f74', '#231f3c', '#fbfbff', '#3a3656'],
  ],
  city: [
    ['#f0a065', '#ff8a5c', '#ffcf92', '#2a2038', '#0f0a1c', '#ffe08f', '#2f2444'],
    ['#6fa2d8', '#a3c6e8', '#d2e4f6', '#26314e', '#0e1524', '#ffeaa0', '#1c2740'],
    ['#060c1e', '#101d38', '#1c2a4a', '#080e1c', '#04070f', '#ffc95e', '#0a1224'],
  ],
  forest: [
    ['#96bc88', '#bcd8a6', '#dcecd0', '#3c5a3e', '#14240f', '#f4ffe8', '#264a2a'],
    ['#c2a97f', '#dcc49d', '#eeddbe', '#4e3a22', '#1d1409', '#fff8e8', '#3c2d18'],
    ['#86a89e', '#a9c6bb', '#cfe2d8', '#2b4a3e', '#0e2018', '#e6fff2', '#173a30'],
  ],
  desert: [
    ['#f0c078', '#ffc873', '#ffdfa4', '#a87a45', '#5c3a1c', '#fff0c8', '#b47c3c'],
    ['#d8ab79', '#e8c294', '#f7dcb6', '#95643a', '#4e2f14', '#ffeccb', '#95562a'],
    ['#dfb47e', '#f0cb9a', '#fbe4c4', '#a06e38', '#54381c', '#fff4d8', '#ab6e2f'],
  ],
  coast: [
    ['#e88f63', '#ff6f78', '#ffb894', '#3d2748', '#1a1026', '#ffdc9e', '#2c1c3a'],
    ['#7ea8d4', '#aec9e6', '#d8e6f4', '#33485c', '#16232f', '#ffffff', '#243646'],
    ['#d5917a', '#e8b79e', '#f6d7c0', '#6a4644', '#331f1f', '#ffe8d2', '#5a3a3a'],
  ],
  aurora: [
    ['#02060c', '#061428', '#0a2036', '#0a1a24', '#03080e', '#5cf0c0', '#03101a'],
    ['#04080f', '#0a1630', '#122244', '#081420', '#02060c', '#8cf0cc', '#050e1c'],
    ['#03070f', '#0c1e38', '#142c48', '#07121c', '#02060c', '#7ae0ff', '#040a16'],
  ],
  lake: [
    ['#84b4da', '#acccec', '#d8eaf6', '#41616f', '#152a36', '#ffffff', '#3a5a6a'],
    ['#eeb480', '#ffd6ac', '#fce9cc', '#7a6444', '#33291a', '#fff6e0', '#6a5638'],
    ['#0c2034', '#2c5068', '#5a86a4', '#12303f', '#08161f', '#dcf0ff', '#0e2430'],
  ],
  flower: [
    ['#c6dda2', '#dcecb8', '#eaf3d4', '#54762e', '#1c320e', '#fffce0', '#b04e4a'],
    ['#e6dcbe', '#f0e6ce', '#f7f1e0', '#6a7a38', '#232a10', '#ffffff', '#a8465c'],
    ['#d2d9e8', '#e2e8f2', '#eef1f8', '#456a48', '#152a1a', '#ffffff', '#7c3f7a'],
  ],
  field: [
    ['#94c47c', '#b8dca0', '#d6ecc0', '#6a8a2c', '#2b4014', '#f6ffe0', '#4c7020'],
    ['#dbbf7e', '#eedcae', '#f8e8bc', '#94743a', '#3c2e12', '#fffbe0', '#7a5c22'],
    ['#9dbcd8', '#c2dcee', '#dceaf6', '#486a84', '#1a3244', '#ffffff', '#3a5a72'],
  ],
  abstract: [
    ['#050e20', '#123266', '#2f66b4', '#08111e', '#03070e', '#ffc94a', '#0a1220'],
    ['#180620', '#4c1646', '#a44489', '#0e0414', '#05010a', '#ffd8f0', '#120618'],
    ['#07130f', '#1b473c', '#5aa88c', '#06100c', '#020604', '#e8fbf2', '#081410'],
  ],
};
/* kinds that are always night */
const NIGHT = new Set(['aurora']);
const F = (n, d) => n.toFixed(d);

/* ── shared drawing helpers ─────────────────────────────────────────────── */

/**
 * A ridgeline. Distance reads as round shoulders; the near planes need hard
 * crests, so `jitter` sets how many of them come out angular. `jitter: 0.95`
 * gives far hills, `jitter: 0.25` gives alpine rock.
 */
function ridgeline(r, baseY, height, jitter = 0.5) {
  const pts = [];
  let x = -20;
  while (x < 430) {
    const w = 26 + r() * 84;
    const crest = r() > 0.4;
    pts.push({
      x: x + w * (0.28 + r() * 0.44),
      y: baseY - height * (crest ? 0.42 + r() * 0.58 : 0.02 + r() * 0.16),
      sharp: crest && r() > 0.12 + jitter * 0.72,
    });
    x += w;
  }
  let d = `M-20 320 L${F(pts[0].x, 1)} ${F(pts[0].y, 1)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.sharp) {
      /* a straight run up to the crest: rock, not dunes */
      d += ` L${F(b.x, 1)} ${F(b.y, 1)}`;
    } else {
      const my = Math.min(a.y, b.y) - Math.abs(b.x - a.x) * 0.035;
      d += ` Q${F((a.x + b.x) / 2, 1)} ${F(my, 1)} ${F(b.x, 1)} ${F(b.y, 1)}`;
    }
  }
  return `${d} L432 320Z`;
}
/* all ids are prefixed per photo — two photos on one page must never share a
   gradient or filter node, or the second frame wears the first frame's light */
let curId = 'p';
/** the air between the camera and the distance: a soft band, never a white-out */
const veil = (y, h, op) => `<rect x="-8" y="${F(y, 0)}" width="416" height="${F(h, 0)}" fill="url(#${curId}haze)" opacity="${op}"/>`;
/** soft contact shadow, so objects sit on the ground instead of floating */
const shade = (cx, cy, rx, ry, o = 0.2) =>
  `<ellipse cx="${F(cx, 0)}" cy="${F(cy, 0)}" rx="${F(rx, 0)}" ry="${F(ry, 0)}" fill="#05090f" opacity="${o}" filter="url(#${curId}bl8)"/>`;

/** every photo is drawn, never loaded.
 *  `edit` = saved Edit-panel adjustments: {light,color,bw,sepia,hue,rotate,crop:{x,y,w,h}}
 *  crop is applied through the viewBox, rotate through an inner group that
 *  scales to keep the frame covered at 90/270 degrees. */
export function art(kind, seed, edit) {
  const r = rng(seed);
  const pals = PALETTES[kind] || PALETTES.beach;
  const pal = pals[seed % pals.length];
  const [top, mid, horizon, far, near, light, accent] = pal;
  const night = NIGHT.has(kind);
  /* a small per-photo shift so no two frames of the same kind ever match */
  const hue = ((seed * 13) % 19) - 9;
  const id = `p${seed}`;
  curId = id;
  const sunX = 50 + r() * 300;
  const sunY = 34 + r() * 62;
  const hz = 150 + r() * 40;

  /* Cloud banks: long, soft-edged, lit from the sun side. This is most of what
     makes a sky read as a photograph instead of a two-stop gradient. */
  let clouds = '';
  const bands = 3 + Math.floor(r() * 3);
  for (let i = 0; i < bands; i++) {
    const cy = 16 + r() * (hz - 26);
    const cx = r() * 400 - 40;
    const w = 100 + r() * 200;
    const h = 4 + r() * 10;
    const warm = Math.abs(cx + w / 2 - sunX) < 160;
    clouds += `<g filter="url(#${id}bl${i % 2 ? 5 : 10})" opacity="${F((0.14 + r() * 0.2) * (night ? 0.5 : 1), 2)}">
      <ellipse cx="${F(cx + w / 2, 0)}" cy="${F(cy, 0)}" rx="${F(w / 2, 0)}" ry="${F(h, 1)}"
        fill="${night ? '#1b2c44' : warm ? '#fff4e0' : '#ffffff'}"/>
      <ellipse cx="${F(cx + w * 0.36, 0)}" cy="${F(cy - h * 0.5, 0)}" rx="${F(w / 3.6, 0)}" ry="${F(h * 0.68, 1)}"
        fill="${night ? '#24374f' : warm ? '#fffaf0' : '#ffffff'}" opacity=".75"/>
    </g>`;
  }

  const defs = `
    <linearGradient id="${id}s" x1="0" y1="0" x2=".14" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset=".34" stop-color="${mid}"/>
      <stop offset=".72" stop-color="${horizon}"/>
      <stop offset="1" stop-color="${horizon}"/>
    </linearGradient>
    <linearGradient id="${id}gr" x1=".2" y1="0" x2=".5" y2="1">
      <stop offset="0" stop-color="${light}" stop-opacity=".26"/>
      <stop offset=".45" stop-color="${light}" stop-opacity="0"/>
      <stop offset="1" stop-color="#0a1424" stop-opacity=".14"/>
    </linearGradient>
    <radialGradient id="${id}sun" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="${light}" stop-opacity=".9"/>
      <stop offset=".24" stop-color="${light}" stop-opacity=".36"/>
      <stop offset=".58" stop-color="${light}" stop-opacity=".11"/>
      <stop offset="1" stop-color="${light}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${horizon}" stop-opacity="0"/>
      <stop offset=".55" stop-color="${horizon}" stop-opacity=".7"/>
      <stop offset="1" stop-color="${horizon}" stop-opacity=".95"/>
    </linearGradient>
    <!-- water / ground: a real body of colour that darkens toward the camera -->
    <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${horizon}" stop-opacity="0"/>
      <stop offset=".1" stop-color="${horizon}"/>
      <stop offset=".46" stop-color="${far}"/>
      <stop offset="1" stop-color="${near}"/>
    </linearGradient>
    <!-- a landform: crest catches the light, base falls into shadow -->
    <linearGradient id="${id}m" x1=".1" y1="0" x2=".3" y2="1">
      <stop offset="0" stop-color="${light}" stop-opacity=".22"/>
      <stop offset=".45" stop-color="${light}" stop-opacity=".02"/>
      <stop offset="1" stop-color="#060a12" stop-opacity=".34"/>
    </linearGradient>
    <radialGradient id="${id}v" cx=".5" cy=".44" r=".74">
      <stop offset=".48" stop-color="#000" stop-opacity="0"/>
      <stop offset=".82" stop-color="#000" stop-opacity=".09"/>
      <stop offset="1" stop-color="#04060a" stop-opacity=".32"/>
    </radialGradient>
    <filter id="${id}bl0" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0"/></filter>
    <filter id="${id}bl10" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="${id}bl5" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="4.5"/></filter>
    <filter id="${id}bl8" x="-45%" y="-45%" width="190%" height="190%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="${id}bl2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.5"/></filter>
    <filter id="${id}grn" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" result="n"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>`;

  /* the light source itself */
  let sun;
  if (night) {
    const moonX = 110 + r() * 180, moonY = 24 + r() * 40;
    sun = `<circle cx="${F(moonX, 0)}" cy="${F(moonY, 0)}" r="${F(1.4 + r() * 1.8, 1)}" fill="#fff" opacity=".9"/>
      <circle cx="278" cy="40" r="10" fill="#fdf8e2" opacity=".92"/>
      <circle cx="278" cy="40" r="58" fill="url(#${id}sun)" opacity=".4"/>`;
  } else {
    sun = `<circle cx="${F(sunX, 0)}" cy="${F(sunY, 0)}" r="112" fill="url(#${id}sun)" opacity=".75"/>
      <circle cx="${F(sunX, 0)}" cy="${F(sunY, 0)}" r="${F(8 + r() * 5, 1)}" fill="${light}" opacity=".95" filter="url(#${id}bl2)"/>
      <circle cx="${F(sunX, 0)}" cy="${F(sunY, 0)}" r="${F(3.4 + r() * 1.6, 1)}" fill="#fffdf6"/>`;
  }

  /* ── the scene: three depth planes, kept clearly apart in value ───────── */
  let scene;
  switch (kind) {
    case 'beach': {
      const surf = [];
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const y = hz + 10 + i * 15 + r() * 5;
        const amp = 2.5 + t * 8;
        surf.push(`<path d="M-140 ${F(y, 0)} q 52 ${F(-amp - r() * 3, 1)} 104 0 t 104 0 t 104 0 t 104 0 t 104 0 t 104 0"
          stroke="#fff" stroke-width="${F(0.9 + t * 3.2, 1)}" fill="none"
          opacity="${F(0.46 - i * 0.04, 2)}" filter="url(#${id}${i < 4 ? 'bl2' : 'bl0'})"/>`);
      }
      const sand = 252 + r() * 20;
      scene = `${sun}
        <rect x="-8" y="${F(hz, 0)}" width="416" height="${F(320 - hz, 0)}" fill="url(#${id}g)"/>
        <rect x="-8" y="${F(hz + 4, 0)}" width="416" height="26" fill="${light}" opacity=".2" filter="url(#${id}bl5)"/>
        ${surf.join('')}
        <path d="M-140 ${F(sand + 18, 0)} q 100 -13 200 2 t 200 2 t 200 -8 L540 320 L-140 320Z" fill="${accent}"/>
        <path d="M-140 ${F(sand + 18, 0)} q 100 -13 200 2 t 200 2 t 200 -8 L540 320 L-140 320Z" fill="url(#${id}m)" opacity=".8"/>
        <path d="M${F(sunX - 18, 0)} ${F(hz + 6, 0)} L${F(sunX + 18, 0)} ${F(hz + 6, 0)} L${F(sunX + 50, 0)} 320 L${F(sunX - 50, 0)} 320Z"
          fill="${light}" opacity=".17" filter="url(#${id}bl5)"/>
        <g opacity=".17">${Array.from({ length: 22 }, () => `<ellipse cx="${F(r() * 400, 0)}" cy="${F(sand + 22 + r() * 40, 0)}" rx="${F(8 + r() * 26, 0)}" ry="${F(1 + r() * 1.6, 1)}" fill="#fff"/>`).join('')}</g>
        <path d="M-140 ${F(sand + 17, 0)} q 100 -12 200 2 t 200 2 t 200 -8" stroke="${light}" stroke-width="1.8" fill="none" opacity=".45" filter="url(#${id}bl2)"/>`;
      break;
    }
    case 'mountain': {
      /* three ranges, each a step darker than the one behind it */
      const d1 = ridgeline(r, 190 + r() * 10, 138, 0.95);
      const d2 = ridgeline(r, 236 + r() * 10, 104, 0.6);
      const d3 = ridgeline(r, 274 + r() * 8, 64, 0.3);
      /* snow lies on the upper faces, and only where the far range shows */
      const snow = [];
      for (let i = 0; i < 9; i++) {
        const sx = r() * 400, sy = 176 + r() * 34, sw = 14 + r() * 34;
        snow.push(`<path d="M${F(sx, 0)} ${F(sy, 0)} l${F(sw / 2, 0)} ${F(8 + r() * 14, 0)} l${F(sw / 2, 0)} ${F(-8 - r() * 14, 0)}Z"
          fill="#fff" opacity="${F(0.28 + r() * 0.42, 2)}" filter="url(#${id}bl2)"/>`);
      }
      scene = `${sun}
        <g filter="url(#${id}bl2)"><path d="${d1}" fill="${far}" opacity=".72"/><path d="${d1}" fill="url(#${id}m)" opacity=".5"/></g>
        ${veil(178, 52, 0.3)}
        ${snow.join('')}
        <path d="${d2}" fill="${far}" opacity=".92"/><path d="${d2}" fill="url(#${id}m)" opacity=".7"/>
        ${veil(228, 36, 0.18)}
        <path d="${d3}" fill="${near}"/><path d="${d3}" fill="url(#${id}m)"/>
        <!-- the snow field sweeping into the foreground, with its own shading -->
        <path d="M-6 320 L-6 288 q 92 -24 186 -4 t 220 -12 L420 320Z" fill="#f8fbff"/>
        <path d="M-6 320 L-6 302 q 100 -18 196 -2 t 220 -8 L420 320Z" fill="#c3d6e8" opacity=".9"/>
        <path d="M-6 320 L-6 311 q 110 -10 200 0 t 210 -4 L420 320Z" fill="#8fa9c2" opacity=".7"/>
        ${shade(200, 316, 200, 8, 0.2)}`;
      break;
    }
    case 'city': {
      /* towers sorted back to front; each plane a clear step darker */
      const towers = [];
      for (let depth = 0; depth < 4; depth++) {
        const base = 296 - depth;
        const fill = depth < 2 ? far : near;
        const fade = [0.6, 0.8, 0.93, 1][depth];
        const hMax = 118 + depth * 44;
        let x = -10;
        while (x < 416) {
          const w = 12 + r() * (22 + depth * 13);
          const h = 26 + r() * hMax;
          const top = base - h;
          let t = `<g opacity="${fade}">`;
          t += `<rect x="${F(x, 0)}" y="${F(top, 0)}" width="${F(w, 0)}" height="${F(h + 10, 0)}" fill="${fill}"/>`;
          t += `<rect x="${F(x, 0)}" y="${F(top, 0)}" width="${F(w * 0.32, 0)}" height="${F(h + 10, 0)}" fill="${light}" opacity=".07"/>`;
          t += `<rect x="${F(x + w * 0.85, 0)}" y="${F(top, 0)}" width="${F(w * 0.15, 0)}" height="${F(h + 10, 0)}" fill="#03060c" opacity=".3"/>`;
          /* a mast or a setback, so the skyline is not a row of flat tops */
          if (r() > 0.66) t += `<rect x="${F(x + w * 0.44, 0)}" y="${F(top - 5 - r() * 12, 0)}" width="${F(1.6 + r() * 1.6, 1)}" height="${F(7 + r() * 12, 0)}" fill="${fill}"/>`;
          /* windows: lit ones glow, unlit ones are just the facade */
          if (depth) {
            for (let wy = top + 5; wy < base - 6; wy += 10) {
              for (let wx = x + 2.6; wx < x + w - 4; wx += 8) {
                t += r() > (night ? 0.42 : 0.74)
                  ? `<rect x="${F(wx, 1)}" y="${F(wy, 1)}" width="2.2" height="2.8" fill="${light}" opacity="${F(0.34 + r() * 0.6, 2)}"/>`
                  : `<rect x="${F(wx, 1)}" y="${F(wy, 1)}" width="2.2" height="2.8" fill="${light}" opacity=".05"/>`;
              }
            }
          }
          t += '</g>';
          towers.push(t);
          x += w + 1 + r() * (6 - depth * 1.3);
        }
        if (depth < 3) towers.push(veil(base - hMax * 0.5, 32, 0.22));
      }
      scene = `${sun}<g>${towers.join('')}</g>
        <path d="M-6 288 h412 v32 H-6Z" fill="${near}"/>
        <path d="M-6 291 h412" stroke="${light}" stroke-width="1.3" opacity=".22" filter="url(#${id}bl2)"/>
        ${shade(200, 302, 200, 7, 0.34)}
        ${Array.from({ length: 7 }, (_, i) => `<ellipse cx="${F(30 + i * 58 + r() * 18, 0)}" cy="${F(298 + r() * 6, 0)}" rx="${F(8 + r() * 11, 0)}" ry="2.2" fill="${light}" opacity="${F(0.09 + r() * 0.13, 2)}" filter="url(#${id}bl2)"/>`).join('')}`;
      break;
    }
    case 'forest': {
      /* soft canopies, not clip-art firs: clusters of blurred ellipses */
      const trees = [];
      const layers = [
        { base: 210, n: 13, hMax: 128, fill: far, op: 0.46, blur: 'bl5' },
        { base: 246, n: 10, hMax: 152, fill: '#24381f', op: 0.82, blur: 'bl5' },
        { base: 288, n: 6, hMax: 178, fill: '#0e1c08', op: 1, blur: 'bl2' },
      ];
      for (const L of layers) {
        for (let i = 0; i < L.n; i++) {
          const tx = -16 + (i + r() * 0.75) * (436 / L.n);
          const h = L.hMax * (0.46 + r() * 0.54);
          const w = h * (0.3 + r() * 0.1);
          /* a wide flat cluster of blobs reads as one soft mass of foliage */
          let canopy = '';
          for (let k = 0; k < 10; k++) {
            canopy += `<ellipse cx="${F(tx + (r() - 0.5) * w * 0.8, 1)}" cy="${F(L.base - h * (0.56 + r() * 0.4), 1)}"
              rx="${F(w * (0.3 + r() * 0.2), 1)}" ry="${F(h * (0.07 + r() * 0.05), 1)}" fill="${L.fill}"/>`;
          }
          trees.push(`<g filter="url(#${id}${L.blur})" opacity="${L.op}">
            <rect x="${F(tx - 1.3, 1)}" y="${F(L.base - h * 0.4, 1)}" width="2.6" height="${F(h * 0.42, 1)}" fill="${L.fill}"/>
            ${canopy}
            <ellipse cx="${F(tx - w * 0.16, 1)}" cy="${F(L.base - h * 0.86, 1)}" rx="${F(w * 0.4, 1)}" ry="${F(h * 0.08, 1)}" fill="${light}" opacity=".14"/>
          </g>`);
        }
        trees.push(veil(L.base - L.hMax * 0.7, 40, 0.22));
      }
      scene = `${sun}<g>${trees.join('')}</g>
        <path d="M-6 320 L-6 292 q 100 -10 200 -2 t 210 -6 L420 320Z" fill="${near}" filter="url(#${id}bl2)"/>
        ${shade(200, 302, 190, 9, 0.34)}
        <g opacity=".2">${Array.from({ length: 8 }, () => `<ellipse cx="${F(20 + r() * 360, 0)}" cy="${F(20 + r() * 40, 0)}" rx="${F(30 + r() * 30, 0)}" ry="${F(6 + r() * 6, 0)}" fill="#fff" filter="url(#${id}bl5)"/>`).join('')}</g>
        <g opacity=".22">${Array.from({ length: 12 }, () => `<ellipse cx="${F(r() * 400, 0)}" cy="${F(290 + r() * 26, 0)}" rx="${F(6 + r() * 18, 0)}" ry="1.5" fill="${light}"/>`).join('')}</g>`;
      break;
    }
    case 'desert': {
      /* dunes: each crest catches the light, each trough falls to shadow */
      const dunes = [];
      const lines = 5;
      for (let i = 0; i < lines; i++) {
        const t = i / (lines - 1);
        const base = 180 + t * 120;
        const fill = i < 2 ? far : near;
        let d = `M-8 320 L-8 ${F(base, 0)}`;
        let x = -8;
        while (x < 424) {
          const w = 60 + r() * 130;
          d += ` q ${F(w * 0.5, 0)} ${F(-(12 + r() * 26) * (1 - t * 0.45), 1)} ${F(w, 0)} ${F((r() * 10 - 5) * (1 - t * 0.5), 1)}`;
          x += w;
        }
        d += ' L420 320Z';
        dunes.push(`<path d="${d}" fill="${fill}" opacity="${F(0.62 + t * 0.38, 2)}"/><path d="${d}" fill="url(#${id}m)" opacity=".85"/>`);
        if (i < 2) dunes.push(veil(base - 12, 34, 0.16));
      }
      const rip = Array.from({ length: 12 }, (_, i) => {
        const y = 266 + i * 5;
        return `<path d="M-8 ${F(y, 0)} q 100 ${F(-3 - r() * 4, 1)} 200 0 t 210 -2" stroke="${light}" stroke-width="1" fill="none" opacity="${F(0.19 - i * 0.012, 3)}"/>`;
      }).join('');
      scene = `${sun}${dunes.join('')}${rip}${shade(200, 306, 190, 6, 0.16)}`;
      break;
    }
    case 'coast': {
      const stacks = [];
      for (let i = 0; i < 4; i++) {
        const depth = i / 3;
        const sx = 20 + i * 96 + r() * 46;
        const sh = (36 + r() * 62) * (0.6 + depth * 0.6);
        const fill = depth < 0.5 ? far : near;
        const w = 14 + r() * 13;
        stacks.push(`<g opacity="${F(0.6 + depth * 0.4, 2)}">
          ${shade(sx, 298, w * 1.6, 5, 0.26)}
          <path d="M${F(sx - w, 0)} 300 L${F(sx - w * 0.5, 0)} ${F(300 - sh, 0)} L${F(sx + w * 0.2, 0)} ${F(300 - sh * 0.62, 0)} L${F(sx + w, 0)} 300Z" fill="${fill}"/>
          <path d="M${F(sx - w, 0)} 300 L${F(sx - w * 0.5, 0)} ${F(300 - sh, 0)} L${F(sx - w * 0.1, 0)} ${F(300 - sh * 0.5, 0)} L${F(sx - w * 0.42, 0)} 300Z" fill="${light}" opacity=".2"/>
          <path d="M${F(sx - w, 0)} 300 L${F(sx - w * 0.5, 0)} ${F(300 - sh, 0)} L${F(sx + w * 0.2, 0)} ${F(300 - sh * 0.62, 0)} L${F(sx + w, 0)} 300Z" fill="url(#${id}m)"/>
        </g>`);
        if (i < 2) stacks.push(veil(300 - sh - 4, 30, 0.2));
      }
      const surf = Array.from({ length: 7 }, (_, i) => {
        const y = 238 + i * 12;
        return `<path d="M-140 ${F(y, 0)} q 54 ${F(-4 - r() * 4, 1)} 108 0 t 108 0 t 108 0 t 108 0 t 108 0 t 108 0" stroke="#fff" stroke-width="${F(1 + i * 0.5, 1)}" fill="none" opacity="${F(0.44 - i * 0.048, 2)}" filter="url(#${id}${i < 3 ? 'bl2' : 'bl0'})"/>`;
      }).join('');
      scene = `${sun}
        <rect x="-8" y="${F(hz + 14, 0)}" width="416" height="${F(320 - hz - 14, 0)}" fill="url(#${id}g)"/>
        <rect x="-8" y="${F(hz + 10, 0)}" width="416" height="30" fill="${light}" opacity=".18" filter="url(#${id}bl5)"/>
        ${stacks.join('')}${surf}
        <path d="M-6 302 q 100 -11 200 2 t 210 -6 L420 320 L-6 320Z" fill="${near}"/>
        <path d="M-6 302 q 100 -11 200 2 t 210 -6" stroke="${light}" stroke-width="1.6" fill="none" opacity=".36" filter="url(#${id}bl2)"/>`;
      break;
    }
    case 'aurora': {
      /* An aurora is a wide sheet of light with a rippled upper edge and short
         rays hanging below it, not a row of vertical beams. */
      let grads = '';
      const bands = [];
      for (let i = 0; i < 4; i++) {
        const y = 6 + i * 32 + r() * 22;
        const h = 34 + r() * 44;
        const g = `${id}c${i}`;
        grads += `<linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${light}" stop-opacity="${F(0.3 + r() * 0.24, 2)}"/>
          <stop offset=".22" stop-color="${light}" stop-opacity=".22"/>
          <stop offset=".7" stop-color="${light}" stop-opacity=".05"/>
          <stop offset="1" stop-color="${light}" stop-opacity="0"/></linearGradient>`;
        /* the rippled top edge: a few big irregular swells, not a scalloped border */
        let top = `M-24 ${F(y + h, 0)} L-24 ${F(y + 6, 0)}`;
        for (let x = -24; x < 444;) {
          const w = 66 + r() * 96;
          const rise = r() > 0.45 ? -(5 + r() * 22) : 3 + r() * 9;
          top += ` Q${F(x + w * 0.5, 0)} ${F(y + 6 + rise, 0)} ${F(x + w, 0)} ${F(y + 4 + r() * 9, 0)}`;
          x += w;
        }
        bands.push(`<g filter="url(#${id}bl5)" opacity="${F(0.7 + r() * 0.3, 2)}">
          <path d="${top} L444 ${F(y + h, 0)}Z" fill="url(#${g})"/>
        </g>`);
        /* the bright hem along the top of the sheet */
        bands.push(`<path d="${top}" stroke="#eafff6" stroke-width="${F(0.9 + r() * 1.6, 1)}" fill="none" opacity="${F(0.12 + r() * 0.2, 2)}" filter="url(#${id}bl2)"/>`);
        /* short rays hanging below the hem */
        if (i > 0) {
          const rays = [];
          for (let k = 0; k < 12; k++) {
            const rx = r() * 440 - 20;
            const rl = 14 + r() * 46;
            rays.push(`<path d="M${F(rx, 0)} ${F(y + 6, 0)} l${F(r() * 8 - 4, 0)} ${F(rl, 0)}" stroke="${light}" stroke-width="${F(0.7 + r() * 1.4, 1)}" opacity="${F(0.07 + r() * 0.15, 2)}"/>`);
          }
          bands.push(`<g filter="url(#${id}bl2)">${rays.join('')}</g>`);
        }
      }
      const refl = Array.from({ length: 7 }, (_, i) =>
        `<path d="M-140 ${F(266 + i * 9, 0)} q 100 ${F(-4 - r() * 5, 1)} 200 0 t 200 0 t 200 -2" stroke="${light}" stroke-width="${F(1 + r() * 2, 1)}" fill="none" opacity="${F(0.2 - i * 0.026, 3)}" filter="url(#${id}bl2)"/>`).join('');
      const tree = ridgeline(r, 258, 58, 0.9);
      scene = `${sun}${grads}${bands.join('')}
        <g fill="#fff">${Array.from({ length: 30 }, () => `<circle cx="${F(r() * 400, 0)}" cy="${F(r() * 150, 0)}" r="${F(0.5 + r() * 1, 1)}" opacity="${F(0.2 + r() * 0.65, 2)}"/>`).join('')}</g>
        <path d="${tree}" fill="#040a10"/>
        <rect x="-8" y="252" width="416" height="68" fill="#07121b"/>
        ${refl}
        <rect x="-8" y="252" width="416" height="68" fill="url(#${id}v)" opacity=".6"/>`;
      break;
    }
    case 'lake': {
      const d1 = ridgeline(r, 194, 96, 0.95);
      const d2 = ridgeline(r, 222, 54, 0.5);
      const rip = [];
      for (let i = 0; i < 12; i++) {
        const t = i / 11;
        const y = 202 + i * 11;
        const cx = sunX + (r() - 0.5) * (50 + t * 130);
        const w = 16 + t * 86;
        rip.push(`<path d="M${F(cx - w / 2, 0)} ${F(y, 0)} q ${F(w / 4, 0)} ${F(-2.4 - r() * 2.6, 1)} ${F(w / 2, 0)} 0 t ${F(w / 2, 0)} 0"
          stroke="#fff" stroke-width="${F(0.8 + t * 1.5, 1)}" fill="none" opacity="${F(0.36 - t * 0.2, 2)}"/>`);
      }
      scene = `${sun}
        <g filter="url(#${id}bl2)"><path d="${d1}" fill="${far}" opacity=".7"/><path d="${d1}" fill="url(#${id}m)" opacity=".5"/></g>
        ${veil(184, 40, 0.28)}
        <path d="${d2}" fill="${far}"/><path d="${d2}" fill="url(#${id}m)"/>
        <rect x="-8" y="212" width="416" height="108" fill="url(#${id}g)"/>
        <path d="M${F(sunX - 9, 0)} 198 h18 l-${F(5, 0)} 122 h-8Z" fill="${light}" opacity=".2" filter="url(#${id}bl5)"/>
        ${rip.join('')}
        <g opacity=".17">${Array.from({ length: 10 }, () => `<ellipse cx="${F(r() * 400, 0)}" cy="${F(216 + r() * 96, 0)}" rx="${F(20 + r() * 46, 0)}" ry="1.1" fill="${light}"/>`).join('')}</g>`;
      break;
    }
    case 'flower': {
      /* a meadow: dense grass first, then shallow depth of field on the heads */
      const grass = [];
      for (let i = 0; i < 90; i++) {
        const gx = r() * 400, h = 18 + r() * 54;
        grass.push(`<path d="M${F(gx, 0)} 320 q ${F(r() * 8 - 4, 0)} ${F(-h * 0.5, 0)} ${F(r() * 12 - 6, 0)} ${F(-h, 0)}"
          stroke="${near}" stroke-width="${F(0.8 + r(), 1)}" fill="none" opacity="${F(0.3 + r() * 0.5, 2)}"/>`);
      }
      const stems = Array.from({ length: 18 }, () => {
        const sx = r() * 400, h = 90 + r() * 120;
        return `<path d="M${F(sx, 0)} 320 q ${F(r() * 16 - 8, 0)} ${F(-h / 2, 0)} ${F(r() * 12 - 6, 0)} ${F(-h, 0)}"
          stroke="${near}" stroke-width="${F(1.1 + r() * 1.1, 1)}" fill="none" opacity="${F(0.5 + r() * 0.4, 2)}"/>`;
      }).join('');
      const heads = [];
      for (let i = 0; i < 20; i++) {
        const depth = r();
        const fx = r() * 400;
        const fy = 108 + (1 - depth) * 150 + r() * 12;
        const s = 3.4 + depth * 5.4;
        const c = [accent, light, '#fff'][i % 3];
        const petal = (a) => {
          const px = fx + Math.cos(a) * s, py = fy + Math.sin(a) * s;
          return `<ellipse cx="${F(px, 0)}" cy="${F(py, 0)}" rx="${F(s * 0.72, 1)}" ry="${F(s * 0.44, 1)}" fill="${c}" transform="rotate(${F((a * 180) / Math.PI + 90, 0)} ${F(px, 0)} ${F(py, 0)})"/>`;
        };
        heads.push(`<g opacity="${F(0.55 + depth * 0.45, 2)}" filter="url(#${id}${depth > 0.6 ? 'bl2' : 'bl0'})">
          ${Array.from({ length: 6 }, (_, k) => petal((k / 6) * Math.PI * 2)).join('')}
          <circle cx="${F(fx, 0)}" cy="${F(fy, 0)}" r="${F(s * 0.32, 1)}" fill="${light}" opacity=".9"/>
          <circle cx="${F(fx, 0)}" cy="${F(fy, 0)}" r="${F(s * 0.16, 1)}" fill="#b87a24" opacity=".55"/>
        </g>`);
      }
      scene = `${sun}
        <rect x="-8" y="196" width="416" height="124" fill="url(#${id}g)" opacity=".92" filter="url(#${id}bl5)"/>
        ${veil(188, 40, 0.26)}
        <g>${grass.join('')}</g>${stems}${heads.join('')}
        <g opacity=".15">${Array.from({ length: 6 }, () => `<circle cx="${F(20 + r() * 360, 0)}" cy="${F(16 + r() * 30, 0)}" r="${F(3 + r() * 4, 1)}" fill="#fff" filter="url(#${id}bl5)"/>`).join('')}</g>`;
      break;
    }
    case 'field': {
      /* a meadow read from a low camera: short grass, warm light, seed heads */
      const blades = [];
      for (let layer = 0; layer < 3; layer++) {
        const base = [262, 292, 322][layer];
        const hMax = [26, 44, 66][layer];
        const fill = [far, accent, near][layer];
        for (let i = 0; i < [80, 90, 70][layer]; i++) {
          const bx = r() * 400;
          const h = hMax * (0.35 + r() * 0.65);
          const lean = r() * 22 - 11;
          blades.push(`<path d="M${F(bx, 0)} ${F(base, 0)} q ${F(lean * 0.35, 0)} ${F(-h * 0.6, 0)} ${F(lean, 0)} ${F(-h, 0)}"
            stroke="${fill}" stroke-width="${F(0.7 + r() * 1.1, 1)}" fill="none"
            opacity="${F(0.3 + r() * (0.2 + layer * 0.3), 2)}"/>`);
          if (layer > 0 && r() > 0.8) {
            blades.push(`<ellipse cx="${F(bx + lean, 0)}" cy="${F(base - h, 0)}" rx="1.5" ry="${F(2 + r() * 2, 1)}"
              fill="${light}" opacity="${F(0.3 + r() * 0.45, 2)}" transform="rotate(${F(lean * 0.6, 0)} ${F(bx + lean, 0)} ${F(base - h, 0)})"/>`);
          }
        }
      }
      const far4 = ridgeline(r, 214, 34, 0.95);
      scene = `${sun}
        <g filter="url(#${id}bl2)"><path d="${far4}" fill="${far}" opacity=".5"/><path d="${far4}" fill="url(#${id}m)" opacity=".35"/></g>
        ${veil(192, 40, 0.24)}
        <path d="M-6 320 L-6 254 q 100 -10 200 -2 t 210 -5 L420 320Z" fill="${far}" opacity=".6"/>
        <path d="M-6 320 L-6 254 q 100 -10 200 -2 t 210 -5 L420 320Z" fill="url(#${id}m)" opacity=".7"/>
        ${veil(244, 30, 0.12)}
        ${blades.join('')}${shade(200, 316, 200, 6, 0.14)}`;
      break;
    }
    default: {
      /* an abstract: layered washes bleeding into one another, then a grade */
      const washes = [];
      for (let i = 0; i < 12; i++) {
        washes.push(`<circle cx="${F(r() * 400, 0)}" cy="${F(r() * 300, 0)}" r="${F(28 + r() * 100, 0)}" fill="${[far, accent, top, light][i % 4]}"
          opacity="${F(0.13 + r() * 0.24, 2)}" filter="url(#${id}bl${i % 2 ? '10' : '5'})"/>`);
      }
      const edges = Array.from({ length: 5 }, () =>
        `<path d="M-8 ${F(60 + r() * 190, 0)} q 100 ${F(-56 - r() * 56, 0)} 200 ${F(-6 + r() * 12, 0)} t 210 ${F(-8 - r() * 10, 0)}"
          stroke="${light}" stroke-width="${F(0.8 + r() * 2.2, 1)}" fill="none" opacity="${F(0.1 + r() * 0.2, 2)}" filter="url(#${id}bl2)"/>`).join('');
      scene = `${washes.join('')}${edges}
        <rect x="-8" y="238" width="416" height="62" fill="${near}" opacity=".32" filter="url(#${id}bl10)"/>
        ${sun}`;
      break;
    }
  }

  /* The grade: warm where the light is, cool in the shadows, then grain and a
     lens vignette. Those three are what stop it reading as clip art. */
  const filt = [`hue-rotate(${(hue + (edit?.hue || 0)).toFixed(1)}deg)`];
  if (edit) {
    if (edit.light) filt.push(`brightness(${(1 + edit.light).toFixed(3)})`);
    if (edit.color) filt.push(`saturate(${(1 + edit.color).toFixed(3)})`);
    if (edit.bw) filt.push(`grayscale(${edit.bw.toFixed(3)})`);
    if (edit.sepia) filt.push(`sepia(${edit.sepia.toFixed(3)})`);
  }
  /* crop = fractional rect of the 400x300 frame, shown through the viewBox */
  const c = edit?.crop;
  const view = (c && c.w > 0.02 && c.h > 0.02)
    ? `${(c.x * 400).toFixed(1)} ${(c.y * 300).toFixed(1)} ${(c.w * 400).toFixed(1)} ${(c.h * 300).toFixed(1)}`
    : '0 0 400 300';
  /* rotate the painted canvas around its centre, scaled so the rotated frame
     still covers whatever viewBox remains after the crop */
  const deg = ((edit?.rotate || 0) % 360 + 360) % 360;
  let body = `<rect x="-8" y="-8" width="416" height="316" fill="url(#${id}s)"/>
    <g>${clouds}</g>
    <rect x="-8" y="-8" width="416" height="316" fill="url(#${id}gr)" style="mix-blend-mode:soft-light"/>
    <g>${scene}</g>
    <rect x="-8" y="-8" width="416" height="316" fill="url(#${id}v)"/>
    <rect x="-8" y="-8" width="416" height="316" filter="url(#${id}grn)" opacity=".07" style="mix-blend-mode:overlay"/>`;
  if (deg) {
    const vw = c ? c.w * 400 : 400, vh = c ? c.h * 300 : 300;
    const vx = c ? c.x * 400 : 0, vy = c ? c.y * 300 : 0;
    /* rotated canvas is 300x400; scale until it contains the crop rect */
    const s = deg % 180 === 0 ? 1 : Math.max(1,
      (200 - (vw ? vx : 0)) / 150, ((vx + vw) - 200) / 150,
      (150 - vy) / 200, ((vy + vh) - 150) / 200);
    body = `<g transform="translate(200 150) rotate(${deg}) scale(${s.toFixed(4)}) translate(-200 -150)">${body}</g>`;
  }
  return `<svg viewBox="${view}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${kind}"
    style="width:100%;height:100%;display:block;filter:${filt.join(' ')}">
    <defs>${defs}</defs>${body}
  </svg>`;
}
