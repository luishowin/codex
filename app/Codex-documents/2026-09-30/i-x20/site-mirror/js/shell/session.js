// Session lifecycle: boot animation, lock screen, sleep, restart, shut down.
import { $, el, fmtClock, DAY_NAMES, MONTH_NAMES } from '../core/util.js';
import { appleLogo, powerLogo } from '../core/icons.js';
import { wallpaperCSS } from '../core/wallpaper.js';
import { state, setSetting } from '../core/store.js';
import { emit } from '../core/util.js';
import * as sfx from '../core/sfx.js';

let booting = false;
let sessionScreen = false;
let lockKeyHandler = null;
export const sessionActive = () => sessionScreen || booting;

export function boot({ fresh = false, onDone } = {}) {
  if (booting) return;
  booting = true;
  sessionScreen = true;
  /* the chime needs a gesture on a cold load; the boot screen's own click or
     keydown counts, so it sounds when the sequence is skipped or finished */
  let chimed = false;
  const chime = () => { if (!chimed && state.settings.startupSound !== false) { chimed = true; sfx.bootChime(); } };
  const node = $('#boot');
  node.hidden = false;
  node.classList.remove('fade');
  const bar = el('div.bar', null, el('i'));
  const inner = el('div.boot-inner', null,
    el('div.logo', { html: appleLogo() }),
    bar,
    el('div.skip', { text: 'Click or press any key to skip' }),
  );
  node.replaceChildren(inner);
  const fill = bar.firstChild;
  let progress = 0;
  const started = performance.now();
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(timer);
    progress = 100; fill.style.width = '100%';
    document.removeEventListener('keydown', skip, true);
    document.removeEventListener('pointerdown', skip, true);
    setTimeout(() => {
      node.classList.add('fade');
      setTimeout(() => {
        node.hidden = true; node.replaceChildren();
        booting = false;
        sessionScreen = false;
        setSetting('booted', true);
        emit('boot:done', { fresh });
        onDone?.();
      }, 430);
    }, 220);
  };
  const skip = e => { if (booting) { e.preventDefault(); chime(); finish(); } };
  const timer = setInterval(() => {
    const t = performance.now() - started;
    const target = Math.min(96, 8 + t / 16);
    progress += (target - progress) * .25;
    fill.style.width = progress + '%';
    if (t > 1500) finish();
  }, 50);
  setTimeout(() => { document.addEventListener('keydown', skip, true); document.addEventListener('pointerdown', skip, true); }, 350);
  return finish;
}

export function isBooting() { return booting; }

/* The lock screen accepts whatever password is typed — this Mac has one user
   and no directory service — but an empty Return is rejected with the shake,
   exactly like a wrong password on real hardware. */
export function lock() {
  const node = $('#lock');
  node.hidden = false;
  node.style.opacity = '';
  sessionScreen = true;
  const time = el('div.time');
  const date = el('div.date');
  const field = el('input.field', { type: 'password', placeholder: 'Enter Password', autocomplete: 'off', 'aria-label': 'Password' });
  const hint = el('div.hint', { text: state.settings.lockMessage || 'Press Return to unlock' });
  const bg = el('div.lock-bg', { style: { backgroundImage: wallpaperCSS(state.settings.wallpaper) } });
  const veil = el('div.lock-veil');
  const panel = el('div.lock-in', null,
    time, date,
    el('div.user', null,
      el('div.avatar', { text: (state.settings.userName || 'B')[0].toUpperCase() }),
      el('div', { text: state.settings.userName || 'bunny' })),
    field, hint,
  );
  node.replaceChildren(bg, veil, panel);
  const tick = () => {
    const d = new Date();
    time.textContent = fmtClock(d);
    date.textContent = `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  setTimeout(() => field.focus(), 260);

  if (lockKeyHandler) document.removeEventListener('keydown', lockKeyHandler, true);
  let closed = false;
  const unlock = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    document.removeEventListener('keydown', onDocKey, true);
    lockKeyHandler = null;
    sessionScreen = false;
    node.style.transition = 'opacity .35s';
    node.style.opacity = '0';
    setTimeout(() => { node.hidden = true; node.style.opacity = ''; node.style.transition = ''; }, 360);
  };
  const refuse = () => {
    field.classList.remove('shake');
    void field.offsetWidth;
    field.classList.add('shake');
    field.value = '';
    field.placeholder = 'Enter Password';
    hint.textContent = 'Enter a password to unlock this Mac';
  };
  /* a hash stored by Settings means the password is checked, not just non-empty */
  const hash = s => { let h = 5381; for (const c of String(s)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return 'h' + h.toString(36); };
  const expected = state.settings.pwHash;
  field.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const ok = expected ? hash(field.value) === expected : !!field.value.trim();
      ok ? unlock() : refuse();
    }
    else if (e.key === 'Escape') { e.preventDefault(); unlock(); }
  });
  /* Escape unlocks even when the field has lost focus */
  const onDocKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); unlock(); }
  };
  lockKeyHandler = onDocKey;
  document.addEventListener('keydown', onDocKey, true);
  node.addEventListener('pointerdown', e => { if (e.target === bg || e.target === veil) field.focus(); });
}

/* Sleep: the screen goes dark, and the next keypress or click brings up the
   lock screen — not a bare desktop — the way a real Mac wakes. */
export function sleep() {
  sessionScreen = true;
  const veil = el('div.overlay', { style: { zIndex: 15000, background: '#000', cursor: 'pointer' } });
  document.getElementById('screen').append(veil);
  const wake = () => {
    document.removeEventListener('keydown', wake, true);
    lock();
    veil.remove();
  };
  setTimeout(() => {
    document.addEventListener('keydown', wake, true);
    veil.addEventListener('pointerdown', wake);
  }, 350);
}

export function restart() {
  const screen = document.getElementById('screen');
  screen.style.transition = 'opacity .3s';
  screen.style.opacity = '0';
  setTimeout(() => { screen.style.opacity = ''; screen.style.transition = ''; boot({}); }, 320);
}

export function shutdown() {
  const node = $('#power');
  node.hidden = false;
  sessionScreen = true;
  const btn = el('button', { html: powerLogo(), title: 'Power On' });
  node.replaceChildren(el('div.pw', null, el('div.logo', { html: appleLogo() }), btn));
  btn.addEventListener('click', () => {
    node.hidden = true;
    sessionScreen = false;
    boot({});
  });
}
