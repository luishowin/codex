// About This Mac.
import { MACHINE } from '../core/device.js';
import { el } from '../core/util.js';
import { glyph } from '../core/icons.js';
import { wm } from '../shell/wm.js';
import { state } from '../core/store.js';
import { launch } from '../core/os.js';

/** the machine, drawn: a 14-inch MacBook Pro, open, seen from the front */
function macbookSVG() {
  return `<svg viewBox="0 0 220 140" role="img" aria-label="MacBook Pro" style="width:100%;height:auto;display:block">
    <defs>
      <linearGradient id="mb-lid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3c3c40"/><stop offset=".06" stop-color="#1b1b1e"/>
        <stop offset=".92" stop-color="#101013"/><stop offset="1" stop-color="#2a2a2e"/>
      </linearGradient>
      <linearGradient id="mb-screen" x1="0" y1="0" x2=".4" y2="1">
        <stop offset="0" stop-color="#1d3a63"/><stop offset=".45" stop-color="#2f6ea8"/>
        <stop offset=".8" stop-color="#8fc4e8"/><stop offset="1" stop-color="#d9ecf7"/>
      </linearGradient>
      <linearGradient id="mb-base" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d8d8dc"/><stop offset=".5" stop-color="#b6b6bc"/>
        <stop offset="1" stop-color="#8e8e95"/>
      </linearGradient>
    </defs>
    <!-- lid -->
    <rect x="26" y="8" width="168" height="106" rx="7" fill="url(#mb-lid)"/>
    <rect x="31" y="13" width="158" height="96" rx="3" fill="url(#mb-screen)"/>
    <path d="M31 74 q40 -34 79 -6 t79 10 v31 H31z" fill="#1d4a7a" opacity=".45"/>
    <circle cx="150" cy="34" r="7" fill="#fdf6d8" opacity=".8"/>
    <!-- base -->
    <path d="M14 114 h192 l-8 8 a4 4 0 0 1-3 1.6 H25 a4 4 0 0 1-3-1.6z" fill="url(#mb-base)"/>
    <rect x="88" y="116" width="44" height="2" rx="1" fill="#8a8a90"/>
  </svg>`;
}

const meta = {
  id: 'about', name: 'About This Mac', icon: 'settings', dock: false, hiddenInLaunchpad: true,
  menus: () => [{
    title: 'File', items: () => [
      { label: 'Close', key: '⌘W', action: () => { const w = wm.byApp('about')[0]; w && wm.close(w); } },
    ],
  }],
  launch() {
    const existing = wm.byApp('about')[0];
    if (existing) { wm.show(existing); return existing; }
    return wm.open({
      app: 'about', key: 'main', title: 'About This Mac',
      width: 440, height: 560, resizable: false, minWidth: 440, minHeight: 560,
      build: win => {
        win.body.append(el('div.about', null,
          el('div.hero', { html: macbookSVG() }),
          el('h1', { text: MACHINE.model }),
          el('div.ver', { text: MACHINE.size }),
          el('dl', null,
            el('dt', { text: 'Chip' }), el('dd', { text: MACHINE.chip }),
            el('dt', { text: 'Memory' }), el('dd', { text: MACHINE.memory }),
            el('dt', { text: 'Startup disk' }), el('dd', { text: MACHINE.disk }),
            el('dt', { text: 'Display' }), el('dd', { text: `Built-in Liquid Retina XDR Display` }),
            el('dt', { text: 'Serial number' }), el('dd', { text: MACHINE.serial }),
          ),
          el('div.ver2', { text: `${MACHINE.os} ${MACHINE.version}` }),
          el('div.foot', null,
            el('button.btn', { text: 'More Info…', onclick: () => { wm.close(win); launch('settings', { pane: 'general' }); } }),
            el('div.reg', { text: 'Regulatory Certification' }),
            el('div.copy', { text: '\u2122 and \u00a9 1983\u20132024 Apple Inc. All Rights Reserved.' }),
          ),
        ));
      },
    });
  },
};
export default meta;
