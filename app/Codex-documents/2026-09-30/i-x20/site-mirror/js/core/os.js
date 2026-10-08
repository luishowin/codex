// App registry. Apps are registered by main.js so modules never import each other.
const apps = new Map();
export function registerApps(list) { for (const app of list) apps.set(app.id, app); }
export const getApp = id => apps.get(id) || null;
export const allApps = () => Array.from(apps.values());
export const hasApp = id => apps.has(id);
export function appName(id) { return apps.get(id)?.name || 'Finder'; }
export function launch(id, opts = {}) {
  const app = apps.get(id);
  if (!app) { console.warn(`os: unknown app "${id}"`); return null; }
  return app.launch(opts);
}
/** ⌘N always opens a second window, even for single-window apps. */
export function newWindow(id, opts = {}) {
  const app = apps.get(id);
  if (!app) return launch(id, opts);
  if (app.newWindow) return app.newWindow(opts);
  return null;   /* single-window apps simply do nothing, like real macOS */
}
/** ⌘, opens that app's Settings pane, or the app's own settings when it has none. */
export function appSettings(id) {
  const app = apps.get(id);
  if (!app) return null;
  if (app.settingsPane) return launch('settings', { pane: app.settingsPane });
  notify('System Settings', `${app.name} has no settings pane`);
  return null;
}
function notify(title, body) {
  import('../shell/notify.js').then(m => m.notify(title, body));
}

/* ── App Store installs ──────────────────────────────────────────────
   Installable apps ship with the system but only appear once the App
   Store has installed them. `installedApps` persists in settings; the
   /Applications folder mirrors the registry through syncApplications. */
import { state, save } from './store.js';

const INSTALLABLE = ['stickies', 'clock', 'weather', 'chess', 'reminders', 'calendar'];
export const installableApps = () => allApps().filter(a => INSTALLABLE.includes(a.id));
export const isInstalled = id => !INSTALLABLE.includes(id) || (state.settings.installedApps || []).includes(id);
export function installApp(id) {
  if (!INSTALLABLE.includes(id) || isInstalled(id)) return false;
  state.settings.installedApps = [...(state.settings.installedApps || []), id];
  save();
  import('./fs.js').then(fs => {
    const app = getApp(id);
    const dir = fs.get('/Applications');
    if (app && dir && !dir.children.some(c => c.name === app.name + '.app'))
      fs.createFile('/Applications', app.name + '.app', '', 'app', { app: id });
    import('./util.js').then(u => u.emit('apps:change', { id, action: 'install' }));
  });
  return true;
}
export function uninstallApp(id) {
  if (!isInstalled(id)) return false;
  state.settings.installedApps = (state.settings.installedApps || []).filter(a => a !== id);
  save();
  import('./fs.js').then(fs => {
    const app = getApp(id);
    const dir = fs.get('/Applications');
    const entry = app && dir && dir.children.find(c => c.name === app.name + '.app');
    if (entry) fs.trashNode('/Applications/' + entry.name);
    import('./util.js').then(u => u.emit('apps:change', { id, action: 'uninstall' }));
  });
  return true;
}
/* /Applications mirrors the registry: every installed app has a .app entry,
   nothing installable-but-uninstalled does. Runs at boot so existing
   filesystems pick up apps added later. */
export function syncApplications(fs) {
  const dir = fs.get('/Applications');
  if (!dir) return;
  for (const app of allApps()) {
    if (app.id === 'about' || app.id === 'launchpad' || app.id === 'appstore') continue;
    const entry = dir.children.find(c => c.name === app.name + '.app');
    if (isInstalled(app.id)) {
      if (!entry) dir.children.push({ id: 'f' + Math.random().toString(36).slice(2, 9), name: app.name + '.app', type: 'file', kind: 'app', content: '', created: Date.now(), modified: Date.now(), app: app.id });
      else entry.app = app.id;
    } else if (entry) {
      dir.children = dir.children.filter(c => c !== entry);
    }
  }
}