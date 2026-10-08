// Boot the whole system: state, shell, apps, restored windows.
import { watchRangeFills } from './core/util.js';
import { loadPersisted, saveNow, state } from './core/store.js';
import { registerApps, launch, syncApplications } from './core/os.js';
import * as fsNS from './core/fs.js';
import { initFS, children as fsChildren, HOME } from './core/fs.js';
import { initAppearance } from './shell/appearance.js';
import { initMenubar } from './shell/menubar.js';
import { initDock } from './shell/dock.js';
import { initDesktop } from './shell/desktop.js';
import { initShortcuts } from './shell/shortcuts.js';
import { initFinder } from './apps/finder.js';
import { wm, saveAllWindows, expectRestore } from './shell/wm.js';
import { savedWindows } from './core/store.js';
import { boot } from './shell/session.js';
import { notify } from './shell/notify.js';
import { on } from './core/util.js';

import finder from './apps/finder.js';
import launchpad from './apps/launchpad.js';
import safari from './apps/safari.js';
import terminal from './apps/terminal.js';
import notes from './apps/notes.js';
import calculator from './apps/calculator.js';
import textedit from './apps/textedit.js';
import music from './apps/music.js';
import photos from './apps/photos.js';
import settings from './apps/settings.js';
import appstore from './apps/appstore.js';
import about from './apps/about.js';
import preview from './apps/preview.js';
import stickies from './apps/stickies.js';
import clock from './apps/clock.js';
import weather from './apps/weather.js';
import chess from './apps/chess.js';
import reminders from './apps/reminders.js';
import calendar from './apps/calendar.js';

const APPS = [finder, launchpad, safari, notes, terminal, calculator, textedit, music, photos, settings, appstore, about, preview, stickies, clock, weather, chess, reminders, calendar];

function restoreWindows() {
  for (const rec of savedWindows()) {
    try {
      expectRestore(rec);
      const win = launch(rec.app, { ...(rec.data || {}) });
      if (!win) continue;
      if (rec.rect) win.setRect(rec.rect);
      wm.focus(win);
      if (rec.state === 'zoom') wm.applyFull(win);
      else if (rec.state === 'min') wm.minimize(win);
    } catch (err) {
      console.warn(`restore: could not reopen ${rec.app}`, err);
    }
  }
}

function main() {
  const persisted = loadPersisted();
  /* Each piece stands on its own: one that throws must not silently take the
     rest of the shell with it, which is how the keyboard went missing once. */
  const step = (name, fn) => {
    try { fn(); } catch (err) { (window.__bootErrors ||= []).push(name + ': ' + err.message); console.error(`boot: ${name} failed`, err); }
  };
  step('filesystem', initFS);
  step('apps', () => { registerApps(APPS); syncApplications(fsNS); });
  step('appearance', initAppearance);
  step('menubar', initMenubar);
  step('shortcuts', initShortcuts);
  step('dock', initDock);
  step('desktop', initDesktop);
  step('finder', initFinder);
  window.__wm = wm;
  watchRangeFills();

  const firstRun = !persisted;
  const hadWindows = savedWindows().length > 0;

  const afterBoot = () => {
    if (firstRun) {
      launch('finder', { path: '/Users/bunny' });
      setTimeout(() => notify('Welcome to your Mac', 'Finder, Terminal, Notes and more are all here. Press Command-Space to search.', { app: 'finder', timeout: 6500 }), 700);
    } else if (hadWindows) {
      restoreWindows();
    }
  };

  if (!state.settings.booted || firstRun) {
    boot({ fresh: firstRun, onDone: afterBoot });
  } else {
    afterBoot();
  }

  window.addEventListener('beforeunload', () => { saveAllWindows(); saveNow(); });

  /* New files in Downloads "finish downloading" and raise a banner. */
  let knownDownloads = new Set(fsChildren(HOME + '/Downloads').map(n => n.id));
  on('fs:change', ({ path }) => {
    if (path !== HOME + '/Downloads') return;
    const current = fsChildren(HOME + '/Downloads');
    const fresh = current.filter(n => !knownDownloads.has(n.id));
    knownDownloads = new Set(current.map(n => n.id));
    for (const node of fresh) {
      notify('Downloads', `${node.name} finished downloading.`, { app: 'safari', timeout: 5000 });
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
else main();
