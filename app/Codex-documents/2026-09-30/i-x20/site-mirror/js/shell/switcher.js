// Command-Tab application switcher.
import { el } from '../core/util.js';
import { appIcon } from '../core/icons.js';
import { wm } from './wm.js';
import { getApp } from '../core/os.js';

let overlay = null, box = null, list = [], cursor = 0, onCommit = null;

function candidates() {
  const seen = new Map();
  for (const w of wm.windows.slice().sort((a, b) => +b.node.style.zIndex - +a.node.style.zIndex)) {
    if (!seen.has(w.app)) seen.set(w.app, w);
  }
  return Array.from(seen.values());
}
export const isSwitcherOpen = () => !!overlay && overlay.isConnected;
export const switcherCurrent = () => list[cursor]?.app || null;
export function openSwitcher({ commit } = {}) {
  onCommit = commit;
  list = candidates();
  if (!list.length) return false;
  if (overlay && !overlay.isConnected) overlay = null;
  if (!overlay) {
    overlay = el('div.overlay', { id: 'app-switcher', style: { zIndex: 12000 } });
    box = el('div.switch-box');
    overlay.append(box);
    document.getElementById('overlays').append(overlay);
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) cancelSwitcher(); });
  }
  cursor = Math.min(1, list.length - 1);
  paint();
  return true;
}
function paint() {
  box.replaceChildren(...list.map((w, i) => {
    const app = getApp(w.app);
    return el('div.switch-app' + (i === cursor ? '.sel' : ''), {
      dataset: { i },
      onpointerenter: () => { cursor = i; paint(); },
      onclick: () => { cursor = i; commitSwitcher(); },
    },
      el('div.ic', { html: appIcon(app?.icon || w.app) }),
      el('div.n.truncate', { text: app?.name || w.app }),
    );
  }));
}
export function cycleSwitcher(back = false) {
  if (!overlay) openSwitcher();
  if (!list.length) return;
  cursor = back ? (cursor - 1 + list.length) % list.length : (cursor + 1) % list.length;
  paint();
}
/** Q while the switcher is held open quits the highlighted app, like macOS */
export function quitSwitcherApp() {
  const win = list[cursor];
  if (!win) return;
  const appId = win.app;
  import('./menubar.js').then(m => m.quitApp(appId));
  list = list.filter(w => w.app !== appId);
  if (!list.length) { close(); return; }
  cursor = Math.min(cursor, list.length - 1);
  paint();
}
export function commitSwitcher() {
  const win = list[cursor];
  close();
  /* the app may already be gone if Q quit it on the way here */
  if (win && wm.windows.includes(win)) { wm.show(win); onCommit?.(win); }
}
export function cancelSwitcher() { close(); }
function close() {
  overlay?.remove();
  overlay = null; box = null; list = []; onCommit = null;
}
