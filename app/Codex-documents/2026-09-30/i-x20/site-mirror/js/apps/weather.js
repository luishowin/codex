// Weather: live forecasts from Open-Meteo — hero sky, hourly strip, ten-day
// list and detail cards. Offline it shows the last good data or a clean card.
import { el } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { state, save } from '../core/store.js';
import { contextMenu } from '../shell/menus.js';

/* the drawn Weather icon: blue sky, sun, one cloud */
const WEATHER_ICON = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="wxbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3aa6e8"/><stop offset="1" stop-color="#1d62c4"/></linearGradient><radialGradient id="wxsun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe98a"/><stop offset="1" stop-color="#ffc23e"/></radialGradient><linearGradient id="wxcl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfe0f0"/></linearGradient></defs><rect x="5" y="5" width="90" height="90" rx="23" fill="url(#wxbg)"/><rect x="5.5" y="5.5" width="89" height="89" rx="22.5" fill="none" stroke="#000" stroke-opacity=".13"/><g stroke="#ffd75e" stroke-width="3.4" stroke-linecap="round">${[...Array(8)].map((_, i) => { const a = i * Math.PI / 4; return `<line x1="${38 + Math.cos(a) * 16}" y1="${40 + Math.sin(a) * 16}" x2="${38 + Math.cos(a) * 21}" y2="${40 + Math.sin(a) * 21}"/>`; }).join('')}</g><circle cx="38" cy="40" r="13" fill="url(#wxsun)"/><g><circle cx="48" cy="58" r="13" fill="url(#wxcl)"/><circle cx="62" cy="54" r="16" fill="url(#wxcl)"/><circle cx="74" cy="60" r="11" fill="url(#wxcl)"/><rect x="44" y="58" width="38" height="13" rx="6.5" fill="url(#wxcl)"/></g></svg>`;

/* weather_code → label, drawn glyph, sky gradient */
const WMO = [
  [[0], ['Clear Sky', 'sun', ['#2f6fd0', '#8fd0ff'], ['#0a1a38', '#12305c']]],
  [[1], ['Mainly Clear', 'sun', ['#3573c8', '#9cc8e8'], ['#0d1f3a', '#173a63']]],
  [[2], ['Partly Cloudy', 'partly', ['#52719e', '#b0c4d8'], ['#131f30', '#2c3e54']]],
  [[3], ['Overcast', 'cloud', ['#5b6e84', '#9fb0bf'], ['#1a2330', '#33404f']]],
  [[45, 48], ['Fog', 'fog', ['#6a7684', '#a8b4bf'], ['#1d232b', '#37414e']]],
  [[51, 53, 55, 56, 57], ['Drizzle', 'drizzle', ['#4a6076', '#8ca3b8'], ['#151e29', '#2b3a4c']]],
  [[61, 63, 65, 66, 67, 80, 81, 82], ['Rain', 'rain', ['#2c4258', '#587494'], ['#0c1420', '#22324a']]],
  [[71, 73, 75, 77, 85, 86], ['Snow', 'snow', ['#7a92ac', '#c6d6e4'], ['#22303f', '#44586e']]],
  [[95, 96, 99], ['Thunderstorm', 'storm', ['#1d2434', '#3d4a66'], ['#0a0e18', '#1c2638']]],
];
const cond = code => WMO.find(([codes]) => codes.includes(code))?.[1] || ['Cloudy', 'cloud', ['#5b6e84', '#9fb0bf'], ['#1a2330', '#33404f']];
const isNightAt = d => { const h = d.getHours(); return h < 6 || h >= 20; };

const wxGlyph = name => {
  const g = {
    sun: `<circle cx="10" cy="10" r="4.4" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${[...Array(8)].map((_, i) => { const a = i * Math.PI / 4; return `<line x1="${10 + Math.cos(a) * 7}" y1="${10 + Math.sin(a) * 7}" x2="${10 + Math.cos(a) * 9.4}" y2="${10 + Math.sin(a) * 9.4}"/>`; }).join('')}</g>`,
    partly: `<circle cx="7.4" cy="7" r="3.4" fill="currentColor"/><path d="M5.8 16.4a4.6 4.6 0 0 1 .7-9.1 5.4 5.4 0 0 1 10.4-1.2A4 4 0 0 1 16.4 14z" fill="currentColor" opacity=".85"/>`,
    cloud: `<path d="M4.6 15.8a4.2 4.2 0 0 1 .7-8.3A5.2 5.2 0 0 1 15 6.3a3.8 3.8 0 0 1 2.4 6.9z" fill="currentColor"/>`,
    fog: `<g stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M2.5 6.5h15M2.5 10h15M4.5 13.5h11"/></g>`,
    drizzle: `<path d="M4.6 11.8a4.2 4.2 0 0 1 .7-8.3A5.2 5.2 0 0 1 15 2.3a3.8 3.8 0 0 1 2.4 6.9z" fill="currentColor"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 14.4v2.4M10 15.2v2.4M14 14.4v2.4"/></g>`,
    rain: `<path d="M4.6 11.2a4.2 4.2 0 0 1 .7-8.3A5.2 5.2 0 0 1 15 1.7a3.8 3.8 0 0 1 2.4 6.9z" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5.4 13.8 4.6 17M9.8 13.8 9 17.8M14.2 13.8 13.4 17"/></g>`,
    snow: `<path d="M4.6 11.2a4.2 4.2 0 0 1 .7-8.3A5.2 5.2 0 0 1 15 1.7a3.8 3.8 0 0 1 2.4 6.9z" fill="currentColor"/><g fill="currentColor"><circle cx="5.6" cy="14.6" r="1.3"/><circle cx="10" cy="16.6" r="1.3"/><circle cx="14.4" cy="14.6" r="1.3"/></g>`,
    storm: `<path d="M4.6 10.6a4.2 4.2 0 0 1 .7-8.3A5.2 5.2 0 0 1 15 1.1a3.8 3.8 0 0 1 2.4 6.9z" fill="currentColor"/><path d="M9.6 11h3l-1.4 3h2.4l-4.4 5 1-3.4H8.2z" fill="currentColor"/>`,
  }[name] || '';
  return `<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${g}</svg>`;
};

const places = () => state.settings.weatherPlaces || [{ name: 'San Francisco', lat: 37.77, lon: -122.42 }];
const writePlaces = p => { state.settings.weatherPlaces = p; save(); };
const cache = () => state.settings.weatherCache || {};
const writeCache = c => { state.settings.weatherCache = c; save(); };

const apiURL = p =>
  `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
  `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code` +
  `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=10`;

const meta = {
  id: 'weather', name: 'Weather', icon: WEATHER_ICON, dock: false,
  menus: () => {
    const wx = wm.byApp('weather')[0]?._wx;
    return [
      { title: 'File', items: () => [
        { label: 'Add Location', key: '⌘N', action: () => wx?.addPlaceSheet() },
        { type: 'sep' },
        { label: 'Close', key: '⌘W', action: () => { const w = wm.byApp('weather')[0]; w && wm.close(w); } },
      ] },
    ];
  },
  launch() {
    const existing = wm.byApp('weather').find(w => w.state !== 'min') || wm.byApp('weather')[0];
    if (existing) { wm.show(existing); return existing; }
    return wm.open({
      app: 'weather', key: 'main', title: 'Weather',
      width: 720, height: 620, minWidth: 480, minHeight: 460,
      build: win => new Weather(win).mount(),
      onClose: win => win._wx?.unmount(),
    });
  },
};

class Weather {
  constructor(win) {
    this.win = win;
    this.idx = Math.max(0, state.settings.weatherIdx || 0);
    this.data = null;
    this.stale = false;
    this.err = false;
  }
  get place() { return places()[Math.min(this.idx, places().length - 1)]; }
  mount() {
    this.win._wx = this;
    this.body = el('div.wx-body scroll');
    this.win.body.append(this.body);
    this.win.tbRight.replaceChildren(
      el('button.tb-btn', { html: glyph('list'), title: 'Locations', onclick: e => this.placesMenu(e) }),
      el('button.tb-btn', { html: glyph('plus'), title: 'Add Location (⌘N)', onclick: () => this.addPlaceSheet() }),
    );
    this.load();
  }
  unmount() { this.abort?.abort(); }

  async load() {
    const p = this.place;
    this.renderLoading();
    this.abort = new AbortController();
    const timer = setTimeout(() => this.abort.abort(), 7000);
    try {
      const r = await fetch(apiURL(p), { signal: this.abort.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error('forecast ' + r.status);
      const data = await r.json();
      this.data = data;
      this.stale = false;
      this.err = false;
      writeCache({ ...cache(), [p.name]: { data, at: Date.now() } });
    } catch {
      clearTimeout(timer);
      const hit = cache()[p.name];
      if (hit) { this.data = hit.data; this.stale = true; this.err = false; }
      else { this.data = null; this.err = true; }
    }
    this.render();
  }

  renderLoading() {
    this.body.dataset.sky = 'day-clear';
    this.body.replaceChildren(el('div.wx-load', null, el('div.wx-spin'), el('span', { text: `Loading ${this.place.name}…` })));
  }

  render() {
    const b = this.body;
    b.replaceChildren();
    if (this.err) {
      b.dataset.sky = 'day-cloud';
      b.append(el('div.wx-unavail', null,
        el('div.wx-uico', { html: wxGlyph('cloud') }),
        el('b', { text: 'Weather Unavailable' }),
        el('p', { text: `Could not reach the forecast for ${this.place.name}.` }),
        el('button.as-pill.fill', { text: 'Try Again', onclick: () => this.load() })));
      return;
    }
    const d = this.data; if (!d) return;
    const [label, gname, dayG, nightG] = cond(d.current?.weather_code ?? 2);
    const localNow = new Date();
    const isN = isNightAt(localNow);
    const sky = isN ? nightG : dayG;
    b.dataset.sky = (isN ? 'n' : 'd') + '-' + gname;
    b.style.background = `linear-gradient(180deg, ${sky[0]}, ${sky[1]})`;
    const cur = d.current;
    const temp = Math.round(cur.temperature_2m);
    const hi = Math.round(d.daily.temperature_2m_max[0]);
    const lo = Math.round(d.daily.temperature_2m_min[0]);

    /* location row + hero */
    const locRow = el('button.wx-loc', {
      onclick: e => this.placesMenu(e),
    }, el('span.wx-lname', { text: this.place.name }), el('span.wx-lchev', { html: glyph('chevD') }));
    b.append(locRow,
      el('div.wx-hero', null,
        el('div.wx-temp', { text: `${temp}°` }),
        el('div.wx-cond', null, el('span.wx-cico', { html: wxGlyph(gname) }), el('span', { text: label })),
        el('div.wx-hl', { text: `H:${hi}°  L:${lo}°` }),
        this.stale ? el('div.wx-stale', { text: 'Last updated earlier' }) : null));

    /* hourly strip */
    const hours = [];
    const times = d.hourly.time.map(t => new Date(t));
    const start = times.findIndex(t => t >= localNow);
    for (let i = Math.max(0, start - 1); i < Math.min(times.length, start + 23); i++) {
      const t = times[i];
      hours.push(el('div.wx-h', null,
        el('span.wx-ht', { text: i === Math.max(0, start - 1) ? 'Now' : `${t.getHours() % 12 || 12}${t.getHours() >= 12 ? 'PM' : 'AM'}` }),
        el('span.wx-hi', { html: wxGlyph(cond(d.hourly.weather_code[i])[1]) }),
        el('span.wx-hd', { text: `${Math.round(d.hourly.temperature_2m[i])}°` })));
    }
    b.append(el('div.wx-card', null,
      el('div.wx-card-t', { text: 'Hourly Forecast' }),
      el('div.wx-hourly', null, ...hours)));

    /* daily list */
    const days = el('div.wx-days');
    const loAll = Math.min(...d.daily.temperature_2m_min), hiAll = Math.max(...d.daily.temperature_2m_max);
    d.daily.time.forEach((t, i) => {
      const day = new Date(t + 'T12:00');
      const lo = Math.round(d.daily.temperature_2m_min[i]), hi = Math.round(d.daily.temperature_2m_max[i]);
      const pc = d.daily.precipitation_probability_max?.[i];
      const a = (lo - loAll) / Math.max(1, hiAll - loAll), wd = (hi - lo) / Math.max(1, hiAll - loAll);
      days.append(el('div.wx-day', null,
        el('span.wx-dn', { text: i === 0 ? 'Today' : day.toLocaleDateString('en-US', { weekday: 'short' }) }),
        el('span.wx-di', { html: wxGlyph(cond(d.daily.weather_code[i])[1]) }),
        el('span.wx-dp', { text: pc > 20 ? `${pc}%` : '' }),
        el('span.wx-dl', { text: `${lo}°` }),
        el('span.wx-dbar', null, el('i', { style: { left: a * 100 + '%', width: Math.max(8, wd * 100) + '%' } })),
        el('span.wx-dh', { text: `${hi}°` })));
    });
    b.append(el('div.wx-card', null, el('div.wx-card-t', { text: '10-Day Forecast' }), days));

    /* detail cards */
    const feels = feelsLike(cur.temperature_2m, cur.relative_humidity_2m, cur.wind_speed_10m);
    const uv = uvGuess(d.current.weather_code, localNow.getHours());
    const cards = [
      ['Feels Like', `${Math.round(feels)}°`, feels > cur.temperature_2m + 2 ? 'Humidity is making it feel warmer' : feels < cur.temperature_2m - 2 ? 'Wind is making it feel cooler' : 'Similar to the actual temperature'],
      ['Humidity', `${Math.round(cur.relative_humidity_2m)}%`, cur.relative_humidity_2m > 70 ? 'High humidity' : cur.relative_humidity_2m < 30 ? 'Dry air' : 'Comfortable'],
      ['Wind', `${Math.round(cur.wind_speed_10m)} km/h`, cur.wind_speed_10m > 40 ? 'Windy' : cur.wind_speed_10m > 20 ? 'Breezy' : 'Light winds'],
      ['UV Index', uv.label, uv.note],
    ];
    b.append(el('div.wx-cards', null, ...cards.map(([t, v, s]) =>
      el('div.wx-card.sm', null, el('div.wx-card-t', { text: t }), el('div.wx-cv', { text: v }), el('div.wx-cs', { text: s })))));
  }

  placesMenu(e) {
    const items = places().map((p, i) => ({
      label: p.name, checked: i === this.idx,
      action: () => { this.idx = i; state.settings.weatherIdx = i; save(); this.load(); },
    }));
    items.push({ type: 'sep' });
    items.push({ label: 'Add Location…', action: () => this.addPlaceSheet() });
    if (places().length > 1) items.push({ label: `Remove ${this.place.name}`, danger: true, action: () => {
      const list = places().filter((_, i) => i !== this.idx);
      writePlaces(list);
      this.idx = 0; state.settings.weatherIdx = 0; save();
      this.load();
    } });
    contextMenu(items, e.clientX, e.clientY);
  }

  addPlaceSheet() {
    const input = el('input.ck-in', { placeholder: 'Search for a city', spellcheck: 'false' });
    const list = el('div.ck-addlist scroll');
    let timer = null;
    const draw = async () => {
      const q = input.value.trim();
      if (q.length < 2) { list.replaceChildren(el('div.ck-none', { text: 'Type a city name' })); return; }
      list.replaceChildren(el('div.ck-none', { text: 'Searching…' }));
      try {
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5`);
        const j = await r.json();
        const hits = j.results || [];
        list.replaceChildren(...hits.map(h => el('button.ck-addrow', {
          onclick: () => {
            const name = h.name + (h.country_code ? '' : '');
            writePlaces([...places(), { name: h.name, lat: h.latitude, lon: h.longitude }]);
            this.idx = places().length - 1;
            state.settings.weatherIdx = this.idx; save();
            this.closeSheet(); this.load();
          },
        }, el('span', { text: `${h.name}${h.admin1 ? ', ' + h.admin1 : ''}` }),
          el('span.ck-arow-t', { text: h.country || '' }))));
        if (!hits.length) list.replaceChildren(el('div.ck-none', { text: 'No cities found' }));
      } catch {
        list.replaceChildren(el('div.ck-none', { text: 'Search needs a connection' }));
      }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 280); });
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') this.closeSheet(); });
    this.openSheet(el('div.ck-sheet', null,
      el('b', { text: 'Add a Location' }), input, list));
    setTimeout(() => input.focus(), 30);
  }
  openSheet(node) {
    this.closeSheet();
    const dim = el('div.ck-dim', { onclick: e => { if (e.target === dim) this.closeSheet(); } }, node);
    this.sheet = dim;
    this.win.body.append(dim);
  }
  closeSheet() { this.sheet?.remove(); this.sheet = null; }
}

function feelsLike(t, rh, wind) {
  if (t <= 10 && wind > 4.8) return t + 0.33 * Math.sqrt(wind * 0.6214) * (t - 33) / 10 + t * 0.0216 * wind ** 0.16;
  if (t >= 26 && rh > 40) return t + 0.05 * (rh - 40) * (t - 26) / 10 * 1.8;
  return t;
}
function uvGuess(code, hour) {
  if (hour < 7 || hour > 19) return { label: '0', note: 'Low — it is night' };
  const [label] = cond(code);
  const clear = /Clear|Mainly/.test(label) ? 1 : /Partly/.test(label) ? .6 : .3;
  const mid = Math.max(0, 1 - Math.abs(hour - 13) / 7);
  const v = Math.round(11 * clear * mid);
  return { label: String(v), note: v >= 8 ? 'Very high — cover up' : v >= 5 ? 'Moderate — sunscreen helps' : 'Low' };
}
export default meta;
