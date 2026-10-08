// In-memory filesystem, persisted to localStorage. Shared by Finder, Terminal,
// TextEdit, Desktop, Spotlight and Trash.
import { state, save } from './store.js';
import { emit, uid, baseName, dirName, joinPath, fs_home } from './util.js';

export const HOME = fs_home();
export const TRASH = HOME + '/.Trash';
/* iCloud Drive is its own volume, not a view of Documents */
export const ICLOUD = HOME + '/Library/Mobile Documents/com~apple~CloudDocs';

const now = () => Date.now();
const dir = (name, children = [], extra = {}) => ({ id: uid('d'), name, type: 'dir', kind: 'folder', children, created: now(), modified: now(), ...extra });
const file = (name, kind, content = '', extra = {}) => ({ id: uid('f'), name, type: 'file', kind, content, created: now(), modified: now(), ...extra });

/* ── seed ──────────────────────────────────────────────────────────── */
function seed() {
  const readme = file('Read Me.txt', 'txt',
`Welcome to your Mac.

• Double-click folders to open them in Finder.
• Use Terminal and Finder on the same files.
• Press Command-Space for Spotlight.
• Press F3 for Mission Control.
• Press Command-Tab to switch apps.
• Drag a window to the left or right edge to snap it.

Everything is saved in localStorage, so it stays put after a reload.`);
  const projects = dir('Projects', [
    file('roadmap.txt', 'txt', 'Ship the flagship build.\nMeasure twice. Polish once.'),
  ]);
  const ideas = dir('Ideas', [file('app names.txt', 'txt', 'Sequoia\nSonoma\nVentura\n')]);
  const desktop = dir('Desktop', [
    readme,
    dir('Screenshots', [file('sequoia-wallpaper.png', 'image', '', { palette: 0 })]),
  ], { wallpaper: true });
  const documents = dir('Documents', [file('About this Mac.txt', 'txt', 'MacBook Pro\nmacOS Sequoia 15.1'), projects]);
  const downloads = dir('Downloads', [file('sample.txt', 'txt', 'A file made for testing.\n')]);
  const pictures = dir('Pictures', [
    file('Sequoia.png', 'image', '', { palette: 1 }),
    file('Sonoma.png', 'image', '', { palette: 2 }),
    file('Ventura.png', 'image', '', { palette: 3 }),
  ]);
  const music = dir('Music', [
    file('Daybreak.m4a', 'audio', '', { song: 'daybreak' }),
    file('Night Drive.m4a', 'audio', '', { song: 'night' }),
    file('Tiny Song.m4a', 'audio', '', { song: 'tiny' }),
  ]);
  const movies = dir('Movies', []);
  const publicDir = dir('Public');
  const trash = dir('.Trash', [], { hidden: true });
  const icloud = dir('com~apple~CloudDocs', [
    dir('Desktop', [], { wallpaper: true }),
    dir('Documents', [file('Keynote Presentation.key', 'txt', 'A presentation in iCloud Drive.\n')]),
    file('Family Budget.numbers', 'txt', 'Income, outgoings and the annual summary.\n'),
  ]);
  const library = dir('Library', [dir('Mobile Documents', [icloud])]);
  const home = dir('bunny', [desktop, documents, downloads, pictures, music, movies, publicDir, library, trash], { home: true });

  const applications = dir('Applications', [
    file('Finder.app', 'app', '', { app: 'finder' }),
    file('Launchpad.app', 'app', '', { app: 'launchpad' }),
    file('Safari.app', 'app', '', { app: 'safari' }),
    file('Terminal.app', 'app', '', { app: 'terminal' }),
    file('Notes.app', 'app', '', { app: 'notes' }),
    file('Calculator.app', 'app', '', { app: 'calculator' }),
    file('TextEdit.app', 'app', '', { app: 'textedit' }),
    file('Music.app', 'app', '', { app: 'music' }),
    file('System Settings.app', 'app', '', { app: 'settings' }),
  ]);
  return dir('Macintosh HD', [
    dir('Users', [home]),
    applications,
    dir('System', [dir('Library', [dir('Fonts')])]),
    dir('Library', [dir('Preferences'), dir('Caches')]),
  ], { root: true });
}

export function initFS() {
  if (!state.fs) { state.fs = seed(); save(); }
  return state.fs;
}
export const root = () => state.fs;

/* ── path helpers ──────────────────────────────────────────────────── */
function split(path) { return String(path).split('/').filter(Boolean); }
export function normalize(path) {
  const out = [];
  for (const part of split(path)) {
    if (part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}
/** Resolve a user-entered path against cwd (~, relative, absolute). */
export function resolve(path, cwd = HOME) {
  let p = String(path ?? '').trim();
  if (!p) return normalize(cwd);
  if (p === '~') return HOME;
  if (p.startsWith('~/')) p = HOME + p.slice(1);
  p = p.replace(/^['"]|['"]$/g, '');
  if (!p.startsWith('/')) p = joinPath(cwd, p);
  return normalize(p);
}
export function get(pathOrNode) {
  if (pathOrNode && typeof pathOrNode === 'object') return pathOrNode;
  const parts = split(resolve(pathOrNode));
  let node = state.fs;
  for (const p of parts) {
    if (!node || node.type !== 'dir') return null;
    node = node.children.find(c => c.name === p);
  }
  return node || null;
}
export function parentOf(pathOrNode) {
  const node = get(pathOrNode);
  if (!node) return null;
  if (node === state.fs) return null;
  const p = pathOf(node);
  return get(dirName(p));
}
export function pathOf(node) {
  if (!node) return null;
  const chain = [];
  let cur = node;
  while (cur && cur !== state.fs) { chain.unshift(cur); cur = parentOfNode(cur); }
  return '/' + chain.map(n => n.name).join('/');
}
function parentOfNode(node) {
  return findParent(state.fs, node);
}
function findParent(node, target) {
  if (!node || node.type !== 'dir') return null;
  if (node.children.includes(target)) return node;
  for (const c of node.children) { const found = findParent(c, target); if (found) return found; }
  return null;
}
export function children(nodeOrPath) {
  const node = get(nodeOrPath);
  if (!node || node.type !== 'dir') return [];
  return node.children.filter(c => !c.name.startsWith('.')).sort(sortEntries);
}
export const sortEntries = (a, b) =>
  (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : a.type === 'dir' ? -1 : 1);

export const exists = p => !!get(p);
export const isDir = p => get(p)?.type === 'dir';
export function homeDir() { return state.fs.children.find(c => c.name === 'Users')?.children.find(c => c.home); }
export const desktopDir = () => get(HOME + '/Desktop');
export const desktopPath = () => HOME + '/Desktop';
export const desktopEntries = () => (desktopDir()?.children || []).slice().sort(sortEntries);
export const applicationsDir = () => get('/Applications');
export const trashDir = () => get(TRASH);
export const trashed = () => children(TRASH);

/* ── mutations ─────────────────────────────────────────────────────── */
function changed(path, action, extra = {}) { save(); emit('fs:change', { path, action, ...extra }); }

export function uniqueName(parent, name) {
  const taken = new Set(parent.children.map(c => c.name));
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${stem} ${i}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}
export function mkdir(parentPath, name) {
  const parent = get(parentPath);
  if (!parent || parent.type !== 'dir') throw new Error(`no such directory: ${parentPath}`);
  const finalName = uniqueName(parent, String(name));
  const node = dir(finalName);
  parent.children.push(node);
  parent.modified = now();
  changed(parentPath, 'create', { node });
  return node;
}
export function createFile(parentPath, name, content = '', kind = 'txt', extra = {}) {
  const parent = get(parentPath);
  if (!parent || parent.type !== 'dir') throw new Error(`no such directory: ${parentPath}`);
  const finalName = uniqueName(parent, String(name));
  const node = file(finalName, kind, content, extra);
  parent.children.push(node);
  parent.modified = now();
  changed(parentPath, 'create', { node });
  return node;
}
export function writeFile(path, content) {
  const node = get(path);
  if (!node) throw new Error(`no such file: ${path}`);
  if (node.type === 'dir') throw new Error(`is a directory: ${path}`);
  node.content = content;
  node.modified = now();
  changed(path, 'write', { node });
  return node;
}
export function appendFile(path, content) {
  const node = get(path);
  if (!node) throw new Error(`no such file: ${path}`);
  return writeFile(path, (node.content || '') + content);
}
export function readFile(path) {
  const node = get(path);
  if (!node) throw new Error(`no such file: ${path}`);
  if (node.type === 'dir') throw new Error(`is a directory: ${path}`);
  if (node.kind === 'app') return '';
  return node.content || '';
}
export function rename(path, name) {
  const node = get(path);
  if (!node) throw new Error(`no such file: ${path}`);
  if (node === state.fs) return node;
  const parent = parentOfNode(node);
  const clean = String(name).replace(/[/\\]/g, '').trim();
  if (!clean) return node;
  if (parent) {
    const clash = parent.children.find(c => c !== node && c.name === clean);
    node.name = clash ? uniqueName(parent, clean) : clean;
  } else node.name = clean;
  node.modified = now();
  changed(path, 'rename', { node, newName: node.name });
  return node;
}
export function move(path, newParentPath) {
  const node = get(path);
  const parent = get(newParentPath);
  if (!node) throw new Error(`no such file: ${path}`);
  if (!parent || parent.type !== 'dir') throw new Error(`no such directory: ${newParentPath}`);
  if (node === parent || isAncestor(node, parent)) throw new Error('cannot move a folder into itself');
  const old = parentOfNode(node);
  if (old) old.children = old.children.filter(c => c !== node);
  node.name = uniqueName(parent, node.name);
  parent.children.push(node);
  parent.modified = now();
  changed(newParentPath, 'move', { node, from: path });
  return node;
}
function isAncestor(node, maybeChild) {
  let cur = maybeChild;
  while (cur) { if (cur === node) return true; cur = parentOfNode(cur); }
  return false;
}
export function copy(path, newParentPath) {
  const node = get(path);
  const parent = get(newParentPath);
  if (!node) throw new Error(`no such file: ${path}`);
  if (!parent || parent.type !== 'dir') throw new Error(`no such directory: ${newParentPath}`);
  if (isAncestor(node, parent)) throw new Error('cannot copy a folder into itself');
  const clone = structuredClone(node);
  clone.id = uid(clone.type === 'dir' ? 'd' : 'f');
  clone.created = clone.modified = now();
  if (clone.children) clone.children.forEach(c => { c.id = uid(c.type === 'dir' ? 'd' : 'f'); });
  clone.name = uniqueName(parent, clone.name);
  parent.children.push(clone);
  parent.modified = now();
  changed(newParentPath, 'copy', { node: clone, from: path });
  return clone;
}
export function setTag(path, tag) {
  const node = get(path);
  if (!node) return null;
  node.tag = tag || undefined;
  node.modified = now();
  changed(path, 'tag', { node, tag: node.tag });
  return node;
}

export function trashNode(path) {
  const node = get(path);
  if (!node || node === state.fs) return null;
  if (pathOf(node)?.startsWith(TRASH)) return removePermanent(path);
  const parent = parentOfNode(node);
  const trash = trashDir();
  if (!trash || !parent) return null;
  const original = pathOf(node);
  parent.children = parent.children.filter(c => c !== node);
  node.name = uniqueName(trash, node.name);
  node.trashed = true;
  node.trashedFrom = original;
  trash.children.push(node);
  trash.modified = now();
  changed(TRASH, 'trash', { node });
  return node;
}
export function removePermanent(path) {
  const node = get(path);
  if (!node || node === state.fs) return false;
  const parent = parentOfNode(node);
  if (!parent) return false;
  parent.children = parent.children.filter(c => c !== node);
  changed(path, 'delete', { node });
  return true;
}
export function emptyTrash() {
  const trash = trashDir();
  if (!trash) return 0;
  const n = trash.children.length;
  trash.children = [];
  trash.modified = now();
  changed(TRASH, 'empty', { count: n });
  return n;
}
export function restoreFromTrash(path) {
  const node = get(path);
  if (!node) return null;
  const trash = trashDir();
  const original = node.trashedFrom;
  let target = null;
  if (original) {
    const originalParent = get(dirName(original));
    if (originalParent?.type === 'dir') target = originalParent;
  }
  if (!target) target = desktopDir() || homeDir();
  trash.children = trash.children.filter(c => c !== node);
  node.name = uniqueName(target, node.name);
  node.trashed = false;
  delete node.trashedFrom;
  target.children.push(node);
  changed(pathOf(target), 'restore', { node });
  return node;
}

/* ── queries ───────────────────────────────────────────────────────── */
export function search(query, { trashed: includeTrash = false } = {}) {
  const q = String(query).toLowerCase().trim();
  if (!q) return [];
  const out = [];
  (function walk(node) {
    if (!node || node.type !== 'dir') return;
    for (const child of node.children) {
      if (child.hidden && child.name !== '.Trash') continue;
      if (child.type === 'dir' && child.name === '.Trash' && !includeTrash) continue;
      if (child.name.toLowerCase().includes(q)) out.push({ node: child, path: pathOf(child) });
      if (child.type === 'dir') walk(child);
    }
  })(state.fs);
  return out.slice(0, 200);
}
export function walkAll(includeTrash = false) {
  const out = [];
  (function walk(node) {
    if (!node || node.type !== 'dir') return;
    for (const child of node.children) {
      if (child.name === '.Trash' && !includeTrash) continue;
      out.push(child);
      if (child.type === 'dir') walk(child);
    }
  })(state.fs);
  return out;
}
export function recentlyUsed(limit = 12) {
  return walkAll().filter(n => n.type === 'file').sort((a, b) => b.modified - a.modified).slice(0, limit);
}
export function usedBytes() {
  const seen = new Set();
  let total = 0;
  (function walk(node) {
    if (!node || node.type !== 'dir') return;
    for (const c of node.children) {
      if (c.name === '.Trash') continue;
      if (c.type === 'dir') walk(c);
      else if (c.kind !== 'app') total += new Blob([c.content || '']).size + c.name.length;
    }
  })(state.fs);
  return total;
}
export const nodeName = n => (typeof n === 'string' ? baseName(n) : n?.name || '');
