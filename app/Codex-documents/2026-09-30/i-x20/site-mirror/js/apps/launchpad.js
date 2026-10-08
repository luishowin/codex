// Launchpad: the full-screen app grid, blurred wallpaper behind it.
// Only installed apps appear; a long press (or holding Option) enters the
// jiggle mode where App Store apps carry an X that uninstalls them.
import { el, fuzzy, highlight, on } from '../core/util.js';
import { appIcon, glyph } from '../core/icons.js';
import { wallpaperCSS } from '../core/wallpaper.js';
import { state } from '../core/store.js';
import { wm } from '../shell/wm.js';
import { allApps, launch, isInstalled, installableApps, uninstallApp } from '../core/os.js';
import { contextMenu } from '../shell/menus.js';

const PER_ROW = 7;
const PER_PAGE = PER_ROW * 4;

/* an app meta may carry a literal svg icon instead of an icon-set name */
const iconFor = a => String(a?.icon || '').trim().startsWith('<svg') ? a.icon : appIcon(a?.icon || a?.id || 'generic');

const meta = {
  id: 'launchpad', name: 'Launchpad', icon: 'launchpad', dock: true,
  menus: () => [{
    title: 'File', items: () => [
      { label: 'Close', key: '⌘W', action: () => { const w = wm.byApp('launchpad')[0]; w && wm.close(w); } },
    ],
  }],
  launch() {
    const existing = wm.byApp('launchpad')[0];
    if (existing) { wm.show(existing); return existing; }
    const top = 26;
    return wm.open({
      app: 'launchpad', key: 'main', title: 'Launchpad', chrome: false, resizable: false, raw: true,
      width: window.innerWidth, height: window.innerHeight - top, x: 0, y: top,
      build: win => new Launchpad(win).mount(),
      onClose: win => { win._off?.(); win._offApps?.(); win._lp?.close(); },
    });
  },
};

class Launchpad {
  constructor(win) { this.win = win; this.query = ''; this.page = 0; this.editing = false; }
  mount() {
    this.win._lp = this;
    this.win.node.classList.add('lp-window');
    this.input = el('input', { placeholder: 'Search', spellcheck: 'false', oninput: e => { this.query = e.target.value; this.page = 0; this.render(); } });
    this.search = el('div.lp-search', null,
      el('span', { html: '<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="7" cy="7" r="5"/><path d="m11 11 3.4 3.4" stroke-linecap="round"/></svg>' }),
      this.input);
    this.grid = el('div.lp-grid');
    this.dots = el('div.lp-dots');
    const bg = el('div.lp-bg', { style: { backgroundImage: wallpaperCSS(state.settings.wallpaper) } });
    this.root = el('div.lp', null, bg, this.search, this.grid, this.dots);
    this.win.body.append(this.root);
    this.render();
    setTimeout(() => this.input.focus(), 40);
    this.win._offApps = on('apps:change', () => this.render());
    this.win.onKey = e => {
      if (e.key === 'Escape') {
        if (this.editing) { this.setEditing(false); return true; }
        wm.close(this.win); return true;
      }
      if (e.key === 'Alt' || e.key === 'Option') { this.setEditing(true); return true; }
      if (e.key === 'ArrowRight') { this.go(1); return true; }
      if (e.key === 'ArrowLeft') { this.go(-1); return true; }
      if (e.key === 'Enter') {
        const first = this.grid.querySelector('.lp-app');
        if (first && !this.editing) first.click();
        return true;
      }
      return false;
    };
    this._keyUp = e => { if (e.key === 'Alt' || e.key === 'Option') this.setEditing(false); };
    window.addEventListener('keyup', this._keyUp);
    this.root.addEventListener('pointerdown', e => {
      /* a press on empty wallpaper space leaves edit mode */
      if (this.editing && !e.target.closest('.lp-app')) this.setEditing(false);
    });
    const outside = e => {
      if (this.win.node.contains(e.target)) return;
      wm.close(this.win);
    };
    setTimeout(() => {
      document.getElementById('desktop').addEventListener('pointerdown', outside);
      document.getElementById('menubar').addEventListener('pointerdown', outside);
      document.getElementById('dock').addEventListener('pointerdown', outside);
      this.win._off = () => {
        document.getElementById('desktop').removeEventListener('pointerdown', outside);
        document.getElementById('menubar').removeEventListener('pointerdown', outside);
        document.getElementById('dock').removeEventListener('pointerdown', outside);
        window.removeEventListener('keyup', this._keyUp);
      };
    }, 30);
  }
  close() { this.win.node.classList.add('lp-closing'); window.removeEventListener('keyup', this._keyUp); }
  setEditing(on) {
    if (this.editing === on) return;
    this.editing = on;
    this.root.classList.toggle('editing', on);
    this.render();
  }
  go(dir) {
    const pages = this.pageCount();
    if (pages < 2) return;
    this.page = (this.page + dir + pages) % pages;
    this.root.classList.add('turning');
    this.render();
  }
  apps() {
    const q = this.query.trim();
    /* Launchpad lists only installed apps, and never itself */
    let apps = allApps().filter(a => !a.hiddenInLaunchpad && a.id !== 'launchpad' && isInstalled(a.id));
    if (q) apps = apps.map(a => ({ a, m: fuzzy(q, a.name) })).filter(x => x.m).sort((x, y) => y.m.score - x.m.score).map(x => x.a);
    return apps;
  }
  pageCount() { return Math.max(1, Math.ceil(this.apps().length / PER_PAGE)); }
  uninstallable(id) { return installableApps().some(a => a.id === id); }
  render() {
    const q = this.query.trim();
    const apps = this.apps();
    const pages = this.pageCount();
    this.page = clampPage(this.page, pages);
    const slice = apps.slice(this.page * PER_PAGE, this.page * PER_PAGE + PER_PAGE);
    this.search.style.display = allApps().length > 6 ? '' : 'none';
    this.grid.replaceChildren(...slice.map(app => {
      const btn = el('button.lp-app' + (this.editing ? '.jiggle' : ''), {
        dataset: { app: app.id },
        onclick: () => {
          /* the click that ends a long-press must not leave edit mode again */
          if (this._suppressClick) { this._suppressClick = false; return; }
          if (this.editing) { this.setEditing(false); return; }
          wm.close(this.win); setTimeout(() => launch(app.id), 40);
        },
        oncontextmenu: e => {
          e.preventDefault();
          contextMenu([
            { label: 'Open', action: () => { wm.close(this.win); setTimeout(() => launch(app.id), 40); } },
            ...(this.uninstallable(app.id) ? [
              { type: 'sep' },
              { label: 'Delete App', danger: true, action: () => this.uninstall(app.id) },
            ] : []),
          ], e.clientX, e.clientY);
        },
      },
        this.editing && this.uninstallable(app.id)
          ? el('span.lp-x', {
              html: glyph('x'), title: `Delete ${app.name}`,
              onclick: e => { e.stopPropagation(); this.uninstall(app.id); },
            })
          : null,
        el('div.ic', { html: iconFor(app) }),
        el('span', { html: q ? highlight(app.name, fuzzy(q, app.name)?.ranges) : app.name }),
      );
      /* a held press shakes the grid, like holding a finger on iOS */
      let hold = null;
      btn.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        hold = setTimeout(() => {
          hold = null;
          this._suppressClick = true;
          this.setEditing(true);
        }, 550);
      });
      const drop = () => { clearTimeout(hold); hold = null; };
      btn.addEventListener('pointerup', drop);
      btn.addEventListener('pointerleave', drop);
      btn.addEventListener('pointercancel', drop);
      return btn;
    }));
    this.dots.replaceChildren(...Array.from({ length: pages }, (_, i) =>
      el('button.lp-dot' + (i === this.page ? '.on' : ''), { title: 'Page ' + (i + 1), onclick: () => { this.page = i; this.render(); } })));
    this.dots.style.display = pages > 1 ? '' : 'none';
  }
  uninstall(id) {
    const app = installableApps().find(a => a.id === id);
    if (!app) return;
    uninstallApp(id);
    /* real Launchpad keeps jiggling until you dismiss it */
    this.render();
  }
}
const clampPage = (p, n) => Math.max(0, Math.min(p, n - 1));
export default meta;
