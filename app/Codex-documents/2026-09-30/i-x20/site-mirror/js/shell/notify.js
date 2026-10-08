// Notification banners: they time out, can be swiped or clicked away, and
// carry a close button that only shows on hover — like real macOS.
import { state } from '../core/store.js';
import { el, fmtClock, clamp } from '../core/util.js';
import { appIcon, glyph } from '../core/icons.js';
import { getApp, launch } from '../core/os.js';

const host = () => document.getElementById('notifications');
const active = [];

/* every notification lands in Notification Center history, banner or not.
   the import stays dynamic so center.js never has to import this file back */
function record(title, body, opts) {
  if (opts.history === false) return;
  import('./center.js').then(c => c.collect(title, body, opts)).catch(() => {});
}

/* the banner's own chime; sfx is optional and only plays once the user
   has actually touched the page */
async function playAlert() {
  try {
    const sfx = await import('../core/sfx.js');
    sfx.playAlert?.(state.settings.alertSound);
  } catch { /* no sound module, no sound */ }
}

export function notify(title, body, opts = {}) {
  record(title, body, opts);
  const wrap = host();
  if (!wrap) return null;
  /* the master switch, and the choice of what a banner shows */
  if (state.settings.notifications === false) return null;
  /* Focus is on: no banner — the notification waits in Notification Center */
  if (state.settings.focus && !opts.quiet) return null;
  /* 'none' style keeps the log but never interrupts; a per-app style wins */
  const perApp = state.settings.notifStyles?.[opts.app];
  const style = String(perApp || state.settings.notifStyle || 'Banners').toLowerCase();
  if (style === 'none') return null;
  const icon = opts.icon || appIcon(opts.app || 'settings');
  const pv = state.settings.notifPreview;
  const showBody = body && pv !== false && String(pv).toLowerCase() !== 'never';
  const close = el('button.notif-x', { title: 'Close', 'aria-label': 'Close', html: glyph('x') });
  const banner = el('div.notif', { role: 'status' },
    el('div.ic', { html: icon }),
    el('div.tx', null,
      el('div.now', { text: opts.now || fmtClock() }),
      el('b', { text: title }),
      showBody ? el('p', { text: body }) : null,
    ),
    close,
  );
  close.addEventListener('click', e => { e.stopPropagation(); dismiss(banner); });
  banner.addEventListener('click', () => {
    if (banner._swiped) { banner._swiped = false; return; }
    if (opts.onClick) opts.onClick();
    else if (opts.app && getApp(opts.app)) launch(opts.app);
    dismiss(banner);
  });
  wrap.append(banner);
  active.push(banner);
  while (active.length > 4) dismiss(active[0]);
  /* Alerts wait for a click; Banners leave on a timer that hover pauses */
  if (style !== 'alerts') {
    banner._timer = setTimeout(() => dismiss(banner), opts.timeout ?? 5000);
    banner.addEventListener('pointerenter', () => clearTimeout(banner._timer));
    banner.addEventListener('pointerleave', () => {
      banner._timer = setTimeout(() => dismiss(banner), 5000);
    });
  }
  attachSwipe(banner);
  if (navigator.userActivation?.hasBeenActive) playAlert();
  return banner;
}

/** drag a banner sideways to throw it away, like a real one */
function attachSwipe(banner) {
  let x0 = null;
  let dy = 0;
  banner.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    x0 = e.clientX; dy = 0;
    banner.setPointerCapture(e.pointerId);
    banner.style.transition = 'none';
  });
  banner.addEventListener('pointermove', e => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    dy = Math.abs(dx) > Math.abs(dy) ? dy : e.movementY;
    banner.style.transform = `translateX(${clamp(dx, -420, 420)}px)`;
    banner.style.opacity = String(clamp(1 - Math.abs(dx) / 460, .15, 1));
  });
  const end = e => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    banner.style.transition = '';
    if (Math.abs(dx) > 90) {
      banner._swiped = true;
      banner.style.transform = `translateX(${dx > 0 ? 420 : -420}px)`;
      dismiss(banner);
    } else {
      banner.style.transform = '';
      banner.style.opacity = '';
    }
  };
  banner.addEventListener('pointerup', end);
  banner.addEventListener('pointercancel', end);
}

export function dismiss(banner) {
  const i = active.indexOf(banner);
  if (i < 0) return;
  active.splice(i, 1);
  clearTimeout(banner._timer);
  banner.classList.add('out');
  setTimeout(() => banner.remove(), 240);
}

export function dismissAll() { active.slice().forEach(dismiss); }
