// Control Center: connectivity, focus, appearance, brightness, sound, now playing.
import { el, $, on, clamp } from '../core/util.js';
import { glyph, appIcon } from '../core/icons.js';
import { state, setSetting } from '../core/store.js';
import { isDark } from './appearance.js';
import { player } from '../core/audio.js';
import { coverArt } from '../core/albumart.js';
import { wm } from './wm.js';

let panel = null, scrim = null, anchorBtn = null;

export function isControlCenterOpen() { return !!panel && panel.isConnected; }
export function closeControlCenter() {
  panel?.remove(); scrim?.remove();
  panel = null; scrim = null;
  anchorBtn?.classList.remove('open');
  anchorBtn = null;
}
export function toggleControlCenter(anchor) {
  if (panel && !panel.isConnected) { panel = null; scrim = null; }
  if (panel) { closeControlCenter(); return; }
  openControlCenter(anchor);
}

const tile = (cls, ...kids) => el(`div.cc-tile${cls ? '.' + cls : ''}`, null, ...kids);
/** isOn must be a pure getter; onToggle performs the change. */
const toggleRow = ({ glyph: g, label, sub, isOn, onToggle, subAfter }) => {
  const dot = el('div.cc-dot', { html: glyph(g) });
  const subEl = el('span', { text: sub });
  const btn = el('button.cc-toggle' + (isOn() ? '.on' : ''), null, dot,
    el('div.lbl', null, el('b', { text: label }), subEl));
  btn.addEventListener('click', () => {
    const next = onToggle();
    btn.classList.toggle('on', next);
    if (subAfter) subEl.textContent = subAfter(next);
  });
  return { btn, dot };
};

export function openControlCenter(anchor) {
  anchorBtn = anchor || null;
  anchorBtn?.classList.add('open');
  const s = state.settings;

  const onOff = v => (v ? 'On' : 'Off');
  const wifi = toggleRow({
    glyph: 'wifi', label: 'Wi-Fi', sub: s.wifi ? (s.wifiNetwork || 'HomeNet') : 'Off',
    isOn: () => state.settings.wifi,
    onToggle: () => { setSetting('wifi', !state.settings.wifi); return state.settings.wifi; },
    subAfter: v => (v ? (state.settings.wifiNetwork || 'HomeNet') : 'Off'),
  });
  const bt = toggleRow({
    glyph: 'bluetooth', label: 'Bluetooth', sub: onOff(s.bluetooth),
    isOn: () => state.settings.bluetooth,
    onToggle: () => { setSetting('bluetooth', !state.settings.bluetooth); return state.settings.bluetooth; },
    subAfter: onOff,
  });
  const drop = toggleRow({
    glyph: 'airdrop', label: 'AirDrop', sub: s.airdrop,
    isOn: () => state.settings.airdrop !== 'Off',
    onToggle: () => {
      const order = ['Everyone', 'Contacts Only', 'Off'];
      setSetting('airdrop', order[(order.indexOf(state.settings.airdrop) + 1) % order.length]);
      return state.settings.airdrop !== 'Off';
    },
    subAfter: () => state.settings.airdrop,
  });
  const connectivity = tile('wide', wifi.btn, bt.btn, drop.btn);

  const focus = toggleRow({
    glyph: 'moon', label: 'Focus', sub: onOff(s.focus),
    isOn: () => state.settings.focus,
    onToggle: () => { setSetting('focus', !state.settings.focus); return state.settings.focus; },
    subAfter: onOff,
  });
  const stageBtn = el('button.cc-toggle.cc-square' + (wm.isStageOn() ? '.on' : ''), { title: 'Stage Manager', onclick: () => { const on = wm.toggleStage(); stageBtn.classList.toggle('on', on); } },
    el('div.cc-dot', { html: glyph('columns') }), el('span.cc-cap', { text: 'Stage Manager' }));
  const mirror = el('button.cc-toggle.cc-square', { title: 'Screen Mirroring', onclick: () => notifyMirror() },
    el('div.cc-dot', { html: glyph('display') }), el('span.cc-cap', { text: 'Screen Mirroring' }));
  const rightCol = el('div.cc-col', null, tile('', focus.btn), el('div.cc-grid.mini', null, tile('cc-square', stageBtn), tile('cc-square', mirror)));

  const appearanceSwitch = el('div.switch' + (isDark() ? '.on' : ''));
  const appearance = tile('wide', el('button.cc-toggle', {
    style: { width: '100%' },
    onclick: () => {
      setSetting('appearance', isDark() ? 'light' : 'dark');
      appearanceSwitch.classList.toggle('on');
    },
  }, el('div.cc-dot', { html: glyph('sun') }),
    el('div.lbl', null, el('b', { text: 'Dark Mode' }), el('span', { text: 'Switch appearance' })),
    el('div', { style: { marginLeft: 'auto' } }, appearanceSwitch)));

  const brightness = el('input.range', {
    type: 'range', min: '0.2', max: '1', step: '0.01', value: String(s.brightness),
    'aria-label': 'Display brightness',
    oninput: e => setSetting('brightness', Number(e.target.value)),
  });
  const display = tile('wide', el('div.cc-cap.head', { text: 'Display' }), el('div.cc-slider', null, el('span', { html: glyph('sun') }), brightness));

  const volume = el('input.range', {
    type: 'range', min: '0', max: '1', step: '0.01', value: String(s.volume),
    'aria-label': 'Sound volume',
    oninput: e => { setSetting('volume', Number(e.target.value)); player.setVolume(Number(e.target.value)); },
  });
  const sound = tile('wide', el('div.cc-cap.head', { text: 'Sound' }), el('div.cc-slider', null, el('span', { html: glyph('volume') }), volume,
    el('button.tb-btn', { html: glyph('volume'), title: 'Mute', onclick: () => { setSetting('volume', 0); player.setVolume(0); volume.value = '0'; } })));

  const media = buildMedia();

  panel = el('div.glass', { id: 'control-center', role: 'dialog', 'aria-label': 'Control Center' },
    el('div.cc-grid', null, connectivity, rightCol),
    el('div', { style: { height: '9px' } }),
    appearance,
    el('div', { style: { height: '9px' } }),
    display, el('div', { style: { height: '9px' } }), sound,
    media,
  );
  scrim = el('div.overlay', { style: { zIndex: 10900 } });
  scrim.addEventListener('pointerdown', closeControlCenter);
  document.getElementById('overlays').append(scrim, panel);
  refreshMedia();
}

function buildMedia() {
  const t = player.track;
  const meta = el('div.meta', null, el('b', { text: t.title }), el('span', { text: t.artist }));
  const play = el('button', { html: glyph(player.playing ? 'pause' : 'play'), title: 'Play or pause', onclick: () => { player.toggle(); refreshMedia(); } });
  const next = el('button', { html: glyph('next'), title: 'Next', onclick: () => { player.next(); refreshMedia(); } });
  const row = el('div.cc-media', null,
    el('div.art', { html: coverArt(t.album, t.title, t.artist) }),
    meta, el('div.cc-play', null, play, next),
  );
  row._play = play;
  return row;
}
function refreshMedia() {
  if (!panel) return;
  const row = panel.querySelector('.cc-media');
  if (!row) return;
  const t = player.track;
  row.querySelector('b').textContent = t.title;
  row.querySelector('.meta span').textContent = t.artist;
  row.querySelector('.art').innerHTML = coverArt(t.album, t.title, t.artist);
  row._play.innerHTML = glyph(player.playing ? 'pause' : 'play');
}
function notifyMirror() {
  import('./notify.js').then(({ notify }) => notify('Screen Mirroring', 'No external displays are connected'));
}

on('music:change', refreshMedia);
