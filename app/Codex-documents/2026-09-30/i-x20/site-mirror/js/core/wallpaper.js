// Original wallpapers: layered SVG gradients and ribbons, no images.
const wave = (d, fill, opacity = 1, blur = 0) =>
  `<path d="${d}" fill="${fill}" opacity="${opacity}"${blur ? ` filter="url(#b${blur})"` : ''}/>`;

const ribbon = (y, amp, thick, color, opacity) => {
  const p = `M-40 ${y} C 300 ${y - amp}, 620 ${y + amp}, 900 ${y - amp * .4} S 1420 ${y + amp}, 1680 ${y - amp * .5}
    L1680 ${y + thick} C 1300 ${y + thick + amp * .6}, 900 ${y + thick - amp}, 520 ${y + thick + amp * .5} S 120 ${y + thick - amp * .4}, -40 ${y + thick} Z`;
  return wave(p, color, opacity);
};

function svgURL(body) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
}
const defs = extra => `<defs>
  <filter id="b20" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="20"/></filter>
  <filter id="b60" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="60"/></filter>
  <filter id="b100" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="100"/></filter>
  ${extra}</defs>`;
const lg = (id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const rg = (id, stops, cx = .5, cy = .4, r = .7) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</radialGradient>`;

const scene = (gradients, body) => svgURL(defs(gradients) + body);

const build = {
  sequoia: () => scene(
    lg('bg', [[0, '#071a3a'], [.45, '#0d3a72'], [1, '#0a1c38']]) + lg('r1', [[0, '#2f9be0'], [.5, '#7fe3ff'], [1, '#1f6fd0']]) +
    lg('r2', [[0, '#8bf0ff'], [1, '#2b6fe8']]) + rg('glow', [[0, '#7fe3ff'], [1, 'rgba(0,0,0,0)']]),
    `<rect width="1600" height="1000" fill="url(#bg)"/>
     <ellipse cx="1150" cy="330" rx="520" ry="360" fill="url(#glow)" opacity=".55" filter="url(#b100)"/>
     ${ribbon(560, 120, 260, 'url(#r1)', .55)}${ribbon(700, 90, 220, 'url(#r2)', .5)}
     ${ribbon(830, 70, 180, '#0a2a5c', .65)}
     <path d="M0 690 C 400 640, 760 760, 1180 700 S1600 620 1600 620 L1600 1000 0 1000z" fill="#061530" opacity=".82"/>
     ${ribbon(430, 60, 10, '#d8f7ff', .35)}`),
  sonoma: () => scene(
    lg('bg', [[0, '#2a0b3d'], [.5, '#7a1f5b'], [1, '#1b0a2e']]) + lg('r1', [[0, '#ff8a5b'], [.5, '#ffd36e'], [1, '#ff5e7a']]) +
    lg('r2', [[0, '#ffe6a8'], [1, '#ff7a5b']]) + rg('sun', [[0, '#fff0c2'], [1, 'rgba(255,120,90,0)']]),
    `<rect width="1600" height="1000" fill="url(#bg)"/>
     <circle cx="800" cy="420" r="240" fill="url(#sun)" filter="url(#b100)" opacity=".85"/>
     ${ribbon(520, 100, 240, 'url(#r1)', .6)}${ribbon(680, 80, 200, 'url(#r2)', .5)}
     ${ribbon(840, 60, 170, '#3a0f36', .6)}
     <path d="M0 720 C 380 680, 900 800, 1600 690 L1600 1000 0 1000z" fill="#22082e" opacity=".8"/>`),
  ventura: () => scene(
    lg('bg', [[0, '#1b0b45'], [.5, '#4c2a9e'], [1, '#120733']]) + lg('r1', [[0, '#8f6bff'], [.5, '#59c8ff'], [1, '#ff77d1']]) +
    lg('r2', [[0, '#59c8ff'], [1, '#7b3ff2']]) + rg('glow', [[0, '#b58cff'], [1, 'rgba(0,0,0,0)']]),
    `<rect width="1600" height="1000" fill="url(#bg)"/>
     <ellipse cx="500" cy="300" rx="520" ry="340" fill="url(#glow)" opacity=".5" filter="url(#b100)"/>
     ${ribbon(480, 130, 250, 'url(#r1)', .5)}${ribbon(650, 100, 220, 'url(#r2)', .45)}
     ${ribbon(820, 80, 180, '#1a0840', .7)}`),
  monterey: () => scene(
    lg('bg', [[0, '#0b1035'], [.5, '#1f3f9c'], [1, '#071028']]) + lg('r1', [[0, '#5ef2d0'], [.5, '#48a9ff'], [1, '#8a5cff']]) +
    rg('glow', [[0, '#7ef0ff'], [1, 'rgba(0,0,0,0)']]),
    `<rect width="1600" height="1000" fill="url(#bg)"/>
     <ellipse cx="1250" cy="720" rx="560" ry="340" fill="url(#glow)" opacity=".5" filter="url(#b100)"/>
     ${ribbon(420, 150, 300, 'url(#r1)', .45)}${ribbon(600, 120, 260, 'url(#r1)', .35)}
     ${ribbon(790, 90, 200, '#0a1338', .7)}
     <path d="M-40 900 C 500 820, 1100 960, 1680 860 L1680 1040 -40 1040z" fill="#060d24"/>`),
  graphite: () => scene(
    lg('bg', [[0, '#0d0f12'], [.5, '#232a31'], [1, '#0b0d10']]) + lg('r1', [[0, '#4b5763'], [.6, '#7d8b98'], [1, '#39434d']]),
    `<rect width="1600" height="1000" fill="url(#bg)"/>
     ${ribbon(540, 90, 220, 'url(#r1)', .5)}${ribbon(720, 70, 200, '#1a1f25', .6)}
     <ellipse cx="700" cy="260" rx="600" ry="260" fill="#9fb2c4" opacity=".12" filter="url(#b100)"/>`),
  sunrise: () => scene(
    lg('bg', [[0, '#2d0a2e'], [.45, '#a52c62'], [.75, '#f2714f'], [1, '#1a0a2a']]) + rg('sun', [[0, '#fff3c4'], [.55, '#ff9a5b'], [1, 'rgba(255,120,80,0)']]) +
    lg('r1', [[0, '#ffd6a5'], [1, '#ff6b8b']]),
    `<rect width="1600" height="1000" fill="url(#bg)"/>
     <circle cx="800" cy="620" r="300" fill="url(#sun)" opacity=".9" filter="url(#b60)"/>
     ${ribbon(700, 70, 180, 'url(#r1)', .5)}${ribbon(860, 50, 150, '#2a0a2c', .7)}`),
};

export const WALLPAPERS = [
  { id: 'sequoia', name: 'Sequoia', css: build.sequoia },
  { id: 'sonoma', name: 'Sonoma', css: build.sonoma },
  { id: 'ventura', name: 'Ventura', css: build.ventura },
  { id: 'monterey', name: 'Monterey', css: build.monterey },
  { id: 'graphite', name: 'Graphite', css: build.graphite },
  { id: 'sunrise', name: 'Sunrise', css: build.sunrise },
];
const cache = new Map();
export function wallpaperCSS(id) {
  const item = WALLPAPERS.find(w => w.id === id) || WALLPAPERS[0];
  if (!cache.has(item.id)) cache.set(item.id, item.css());
  return cache.get(item.id);
}
export const wallpaperName = id => (WALLPAPERS.find(w => w.id === id) || WALLPAPERS[0]).name;
/* the hue "Allow wallpaper tinting in windows" borrows from each scene */
const TINTS = { sequoia: '#1c5fa8', sonoma: '#a84870', ventura: '#5a47c8', monterey: '#3f66c8', graphite: '#3c4650', sunrise: '#c14f70' };
export const wallpaperTint = id => TINTS[id] || TINTS.sequoia;
