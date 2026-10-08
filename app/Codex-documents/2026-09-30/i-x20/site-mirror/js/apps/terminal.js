// Terminal: a zsh-flavoured shell over the shared filesystem — tabs, a real
// parser, pagers, editors and the commands a person actually reaches for.
import { el, esc, tildify, baseName, dirName, joinPath, fmtStamp, on } from '../core/util.js';
import * as fs from '../core/fs.js';
import { wm } from '../shell/wm.js';
import { allApps } from '../core/os.js';
import { MACHINE } from '../core/device.js';
import { state } from '../core/store.js';
import { player, TRACKS } from '../core/audio.js';
import { EXTRA_COMMANDS, DESCRIBE, stamp, globToRx } from './shell-cmds.js';

const meta = {
  id: 'terminal', name: 'Terminal', icon: 'terminal', dock: true,
  menus: () => activeMenus(),
  settingsPane: 'general',
  newWindow: () => openTerminal({ cwd: fs.HOME }),
  launch(opts = {}) { return openTerminal(opts); },
};

/* the window the menu bar is talking about: the front one when it is ours */
const frontWin = () => (wm.focused?.app === 'terminal' ? wm.focused : wm.byApp('terminal')[0]) || null;

function activeMenus() {
  return [
    { title: 'File', items: () => {
      const win = frontWin();
      return [
        { label: 'New Tab', key: '⌘T', action: () => win ? win._tabs.add({ cwd: win._term?.cwd }) : openTerminal({ cwd: fs.HOME }) },
        { label: 'New Window', key: '⌘N', action: () => openTerminal({ cwd: win?._term?.cwd || fs.HOME }) },
        { type: 'sep' },
        /* ⌘W closes the tab; the last tab takes the window with it */
        { label: 'Close Tab', key: '⌘W', action: () => win && win._tabs.closeActive() },
      ];
    } },
    { title: 'Shell', items: () => [
      { label: 'Clear Buffer', key: '⌘K', action: () => frontWin()?._term?.clear() },
    ] },
    { title: 'Edit', items: () => [
      { label: 'Copy', key: '⌘C', action: () => document.execCommand?.('copy') },
      { label: 'Select All', key: '⌘A', action: () => frontWin()?._term?.selectAll() },
    ] },
    { title: 'View', items: () => [
      { label: 'Bigger Text', key: '⌘=', action: () => frontWin()?._term?.bumpFont(1) },
      { label: 'Smaller Text', key: '⌘-', action: () => frontWin()?._term?.bumpFont(-1) },
      { type: 'sep' },
      { label: 'Show Next Tab', key: '⌘⇧]', action: () => frontWin()?._tabs?.next() },
      { label: 'Show Previous Tab', key: '⌘⇧[', action: () => frontWin()?._tabs?.prev() },
    ] },
  ];
}

function openTerminal(opts = {}) {
  return wm.open({
    app: 'terminal', key: opts.key || `win${Date.now().toString(36)}`,
    title: 'Terminal',
    width: 720, height: 460, minWidth: 420, minHeight: 240,
    data: { cwd: opts.cwd || fs.HOME },
    getData: w => ({ cwd: w._term?.cwd }),
    build: w => { w._tabs = new TermTabs(w, opts); },
    onClose: w => w._tabs?.destroy(),
  });
}

const HISTORY_KEY = 'macos.terminal.history';
const loadHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; } };
const saveHistory = h => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-200))); } catch { /* ignore */ } };
/* background jobs are processes: a reload is a reboot, so none survive it */
if (state.termBg?.length) state.termBg = state.termBg.map(b => ({ ...b, alive: false }));

/* ── tokenizer: quotes, escapes, operators, redirects ─────────────────── */
/* A backslash-escaped character is stored as \u0001 + the character, so the
   expander can keep it literal: \$ never becomes a variable, \* never globs. */
export function tokenize(line) {
  const out = [];
  let cur = '', has = false, quote = null;
  const push = () => {
    if (has) { out.push({ t: 'word', v: cur, q: quote }); cur = ''; has = false; quote = null; }
  };
  for (let i = 0; i < line.length;) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) { cur += '\u0001' + line[i + 1]; has = true; i += 2; continue; }
    if (c === "'") {
      /* single quotes are literal: no variables, no globs, nothing */
      i++; quote = "'";
      while (i < line.length && line[i] !== "'") { cur += line[i]; i++; }
      i++; has = true; continue;
    }
    if (c === '"') {
      /* double quotes expand variables, but escapes still protect $ ` " \ */
      i++; quote = '"';
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) { cur += '\u0001' + line[i + 1]; i += 2; continue; }
        cur += line[i]; i++;
      }
      i++; has = true; continue;
    }
    /* $(…) and `…` hold spaces and still make one word; the inner text is
       re-tokenized when the substitution runs */
    if (c === '$' && line[i + 1] === '(') {
      let depth = 1, j = i + 2;
      while (j < line.length && depth) { if (line[j] === '(') depth++; else if (line[j] === ')') depth--; j++; }
      cur += line.slice(i, j); has = true; i = j; continue;
    }
    if (c === '`') {
      const end = line.indexOf('`', i + 1);
      if (end < 0) { cur += c; has = true; i++; continue; }
      cur += line.slice(i, end + 1); has = true; i = end + 1; continue;
    }
    if (/\s/.test(c)) { push(); i++; continue; }
    if (c === '>') { push(); if (line[i + 1] === '>') { out.push({ t: 'redir', v: '>>' }); i += 2; } else { out.push({ t: 'redir', v: '>' }); i += 1; } continue; }
    if (c === '|') { push(); if (line[i + 1] === '|') { out.push({ t: 'op', v: '||' }); i += 2; } else { out.push({ t: 'op', v: '|' }); i += 1; } continue; }
    if (c === '&') { push(); if (line[i + 1] === '&') { out.push({ t: 'op', v: '&&' }); i += 2; } else { out.push({ t: 'op', v: '&' }); i += 1; } continue; }
    if (c === ';') { push(); out.push({ t: 'op', v: ';' }); i += 1; continue; }
    cur += c; has = true; i += 1;
  }
  push();
  return out;
}

/* ── expansion: variables, ~ and globs ─────────────────────────────────── */

/* escaped characters ride through expansion in the private use area, so a
   protected space never splits a word and a protected * never globs */
const protect = c => String.fromCharCode(0xE000 + c.charCodeAt(0));
const unprotect = s => String(s).replace(/[\uE000-\uF8FF]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xE000));

/** every name a command table or the help text knows, for tab completion */
export function commandNames() { return COMMANDS.map(c => c.name); }

/**
 * Expand one word the way a shell does. `quote` comes from the tokenizer:
 * a single-quoted word is literal, a double-quoted one expands variables but
 * not globs, and an unquoted one does both. The return value still carries
 * protected characters — callers unprotect at the end.
 */
export function expandWord(word, vars, opts = {}) {
  const q = word.q;
  const literal = q === "'";
  let s = word.v;
  if (literal) return s;
  s = s.replace(/\u0001(.)/gs, (m, c) => protect(c));
  /* ~ expands at the start of a word and after = or :, like zsh */
  s = s.replace(/~([A-Za-z_][A-Za-z0-9_]*)?(?=$|\/)/g, (m, u, off, str) => {
    if (off !== 0 && str[off - 1] !== '=' && str[off - 1] !== ':') return m;
    if (u) return u === (opts.user || '') ? (opts.home || '') : '/Users/' + u;
    return opts.home || '';
  });
  /* $(…) and `…` run a command and splice in what it printed */
  s = substCmds(s, opts);
  s = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, bare) => {
    const name = braced || bare;
    return name in vars ? vars[name] : '';
  });
  s = s.replace(/\$(\?|#|\$|!|\*|@|-|_|0)/g, (_, d) => {
    if (d === '?') return String(opts.lastCode ?? 0);
    if (d === '#') return String(opts.argCount ?? 0);
    if (d === '$') return String(opts.pid ?? 501);
    if (d === '0') return 'zsh';
    if (d === '*') return (opts.globals || []).join(' ');
    if (d === '!') return String(opts.lastBg ?? 0);
    return '-';
  });
  return s;
}

/** $(…) needs a matched paren, not a regex — nested calls count. */
function substCmds(s, opts) {
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end < 0) { out += s[i]; i++; continue; }
      out += (opts.runCommand ? opts.runCommand(s.slice(i + 1, end)) : '').replace(/\n+$/, '');
      i = end + 1;
      continue;
    }
    if (s[i] === '$' && s[i + 1] === '(') {
      let depth = 1, j = i + 2;
      while (j < s.length && depth) { if (s[j] === '(') depth++; else if (s[j] === ')') depth--; j++; }
      if (depth) { out += s[i]; i++; continue; }
      out += (opts.runCommand ? opts.runCommand(s.slice(i + 2, j - 1)) : '').replace(/\n+$/, '');
      i = j;
      continue;
    }
    out += s[i]; i++;
  }
  return out;
}

/** does this word carry a glob the shell should expand? escapes do not count */
export function hasGlob(word) {
  return word.q !== "'" && /[*?[]/.test(word.v.replace(/\u0001./g, ''));
}

/** every path a glob word matches, sorted the way a shell lists them */
export function globPaths(pattern, cwd, fs_) {
  const slash = pattern.lastIndexOf('/');
  const dirPart = slash < 0 ? '' : pattern.slice(0, slash) || '/';
  const pat = slash < 0 ? pattern : pattern.slice(slash + 1);
  const dir = unprotect(slash < 0 ? cwd : (dirPart === '/' ? '/' : fs_.resolve(dirPart, cwd)));
  const rx = globToRx(pat);
  let names = [];
  try {
    const node = fs_.get(dir);
    if (!node || node.type !== 'dir') return [];
    /* dotfiles only match a glob that asks for them by name, like real globbing */
    names = (pat.startsWith('.') ? node.children : fs_.children(node)).map(n => n.name);
  } catch { return []; }
  return names.filter(n => rx.test(n))
    .sort()
    .map(n => slash < 0 ? n : (dirPart === '/' ? '/' + n : unprotect(dirPart) + '/' + n));
}

/** tokens -> [{ op, chain: [{argv}], redirect, targetTok, bg }] */
export function parseShell(tokens) {
  const jobs = [];
  let job = { op: null, chain: [], redirect: null, targetTok: null, bg: false };
  let argv = [];
  let wantFile = false;
  const endStage = () => { if (argv.length) { job.chain.push({ toks: argv }); argv = []; } };
  for (const tok of tokens) {
    if (tok.t === 'redir') { endStage(); job.redirect = tok.v; wantFile = true; continue; }
    if (tok.t === 'op') {
      if (tok.v === '|') { endStage(); job.redirect = null; wantFile = false; continue; }
      /* a lone & backgrounds the job it terminates */
      if (tok.v === '&') job.bg = true;
      endStage();
      if (job.chain.length) jobs.push(job);
      job = { op: tok.v, chain: [], redirect: null, targetTok: null, bg: false };
      wantFile = false;
      continue;
    }
    if (wantFile) { job.targetTok = tok; wantFile = false; continue; }
    argv.push(tok);
  }
  endStage();
  if (job.chain.length) jobs.push(job);
  return jobs;
}

/* ── output model ─────────────────────────────────────────────────────
   ctx.out is a list of chunks: a string is plain text (escaped, and ANSI
   colours are honoured), an {h: html} chunk is markup a command built on
   purpose. Piping strips markup to its text, so `ls | grep` sees names. */
const chunkText = c => (typeof c === 'string' ? c : String(c.h ?? '').replace(/<[^>]+>/g, '')).replace(/\x1b\[[0-9;]*m/g, '');

const ANSI_CLS = {
  1: 'a-b', 2: 'a-dim', 3: 'a-it', 4: 'a-u', 7: 'a-rev',
  30: 'a-f0', 31: 'a-f1', 32: 'a-f2', 33: 'a-f3', 34: 'a-f4', 35: 'a-f5', 36: 'a-f6', 37: 'a-f7',
  90: 'a-f8', 91: 'a-f9', 92: 'a-fa', 93: 'a-fb', 94: 'a-fc', 95: 'a-fd', 96: 'a-fe', 97: 'a-ff',
};
/** plain text -> html, honouring the common ANSI colour codes */
function ansiHtml(s) {
  if (!s.includes('\x1b')) return esc(s);
  let out = '', open = false;
  const close = () => { if (open) { out += '</span>'; open = false; } };
  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (!m) { out += esc(part); continue; }
    let cls = [];
    const codes = m[1] === '' ? ['0'] : m[1].split(';');
    if (codes.some(c => c === '0')) { close(); cls = []; }
    for (const c of codes) if (ANSI_CLS[c]) cls.push(ANSI_CLS[c]);
    if (cls.length) { close(); out += `<span class="${cls.join(' ')}">`; open = true; }
  }
  close();
  return out;
}

/* ── helpers ────────────────────────────────────────────────────────── */
const has = (args, f) => args.includes(f);
const plain = args => args.filter(a => !a.startsWith('-'));
/** the set of letters in flag words: -lahrt -> {l,a,h,r,t} */
const flagsOf = args => new Set(args.filter(a => /^-[a-zA-Z]+$/.test(a)).flatMap(a => [...a.slice(1)]));
/** `-f 3` and `-f3` both answer 3 */
const flagVal = (args, name) => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-' + name) return args[i + 1];
    if (a.length > 2 && a.startsWith('-' + name)) return a.slice(2);
  }
  return undefined;
};
/** `-n 20 file`, `-20 file` and `head -n20` all mean twenty lines */
function takeCount(args, fallback) {
  const i = args.indexOf('-n');
  if (i >= 0) {
    const n = Number(args[i + 1]);
    return { count: Number.isFinite(n) && n > 0 ? n : fallback, files: args.filter((a, k) => !a.startsWith('-') && k !== i + 1) };
  }
  const joined = args.find(a => /^-n\d+$/.test(a));
  if (joined) {
    const n = Number(joined.slice(2));
    return { count: n > 0 ? n : fallback, files: args.filter(a => a !== joined && !a.startsWith('-')) };
  }
  const short = args.find(a => /^-\d+$/.test(a));
  if (short) {
    const n = Number(short.slice(1));
    return { count: n > 0 ? n : fallback, files: args.filter(a => a !== short) };
  }
  return { count: fallback, files: plain(args) };
}
/** ls -F decoration: folders get a slash, apps get a star */
function classify(node, withMarks) {
  if (!withMarks) return '';
  if (node.type === 'dir') return '/';
  if (node.kind === 'app') return '*';
  return '';
}
const dirSize = node => {
  if (!node) return 64;
  if (node.type === 'file') return new Blob([node.content || '']).size;
  return 64 + (node.children || []).reduce((n, c) => n + 32 + dirSize(c), 0);
};
const hum = n => n < 1024 ? String(n) : (n < 1048576 ? (n / 1024).toFixed(1).replace(/\.0$/, '') + 'K' : (n / 1048576).toFixed(1).replace(/\.0$/, '') + 'M');
function lsDate(ts) {
  const d = new Date(ts), now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const time = `${String(d.getHours()).padStart(2, ' ')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.getFullYear() === now.getFullYear()
    ? `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${time}`
    : `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')}  ${d.getFullYear()}`;
}
/** every file under a node, depth first, as {node, path} rows */
function walkFs(node, base, out = [], depth = 0) {
  for (const c of (node.children || [])) {
    const p = base ? base + '/' + c.name : c.name;
    out.push({ node: c, path: p });
    if (c.type === 'dir' && depth < 12) walkFs(c, p, out, depth + 1);
  }
  return out;
}

/* ── tabs: each one is an independent shell ─────────────────────────── */
class TermTabs {
  constructor(win, opts) {
    this.win = win;
    this.tabs = [];
    this._active = null;
    this.strip = el('div.term-tabs');
    this.panes = el('div.term-panes');
    win.body.classList.add('term-host');
    win.body.append(this.strip, this.panes);
    /* the window's key hook and focus hook talk to whichever tab is front */
    win.onKey = e => (this._active ? this._active.winKey(e) : false);
    win.focusSelf = () => this._active?.input?.focus({ preventScroll: true });
    this.add(opts || {});
  }
  get active() { return this._active; }
  add(opts = {}) {
    const pane = el('div.term-pane');
    const t = new Terminal(this.win, { ...opts, pane }, this);
    t.mount();
    this.panes.append(pane);
    this.tabs.push(t);
    this.select(t);
    return t;
  }
  select(t) {
    if (!t) return;
    this._active = t;
    for (const x of this.tabs) x.pane.classList.toggle('on', x === t);
    this.win._term = t;
    this.renderStrip();
    requestAnimationFrame(() => { t.repaint(); t.input?.focus({ preventScroll: true }); });
  }
  closeActive() { if (this._active) this.close(this._active); }
  close(t) {
    const i = this.tabs.indexOf(t);
    if (i < 0) return;
    if (this.tabs.length === 1) { wm.close(this.win); return; }
    t.destroy();
    t.pane.remove();
    this.tabs.splice(i, 1);
    if (this._active === t) this.select(this.tabs[Math.max(0, i - 1)]);
    else this.renderStrip();
  }
  next() { this.step(1); }
  prev() { this.step(-1); }
  step(dir) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.indexOf(this._active);
    this.select(this.tabs[(i + dir + this.tabs.length) % this.tabs.length]);
  }
  syncTab(t) { if (t === this._active) t.paintTitle(); this.renderStrip(); }
  renderStrip() {
    const many = this.tabs.length > 1;
    this.strip.classList.toggle('on', many);
    if (!many) { this.strip.replaceChildren(); return; }
    this.strip.replaceChildren(
      ...this.tabs.map(t => el('button.term-tab' + (t === this._active ? '.sel' : ''), {
        title: tildify(t.cwd), onclick: () => this.select(t),
      },
        el('span.tt-label', { text: t.tabLabel() }),
        el('span.tt-x', { text: '✕', onclick: e => { e.stopPropagation(); this.close(t); } }))),
      el('button.term-tab-plus', { text: '+', title: 'New Tab (⌘T)', onclick: () => this.add({ cwd: this._active?.cwd }) }));
  }
  destroy() { for (const t of [...this.tabs]) t.destroy(); }
}

/* ── the terminal window ─────────────────────────────────────────────── */
class Terminal {
  constructor(win, opts, tabs) {
    this.win = win;
    this.tabs = tabs || null;
    this.pane = opts.pane || null;
    this._cwd = opts.cwd && fs.get(opts.cwd) ? opts.cwd : fs.HOME;
    this.history = loadHistory();
    this.hIndex = this.history.length;
    this.stash = '';
    this.lastCode = 0;
    /* the environment a login shell starts with. PWD follows the window, so it
       is refreshed rather than stored twice. */
    this.vars = {
      HOME: fs.HOME,
      USER: state.settings.userName,
      LOGNAME: state.settings.userName,
      SHELL: '/bin/zsh',
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'Apple_Terminal',
      PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      PWD: this._cwd,
      _: '/usr/bin/env',
    };
    this._offs = [];   /* fs:change subscriptions, torn down with the tab */
  }
  get cwd() { return this._cwd; }
  set cwd(v) { this._cwd = v; this.vars.PWD = v; this.vars.OLDPWD = this.prevCwd || v; this.syncTab(); }
  get envList() { return Object.entries(this.vars).sort(([a], [b]) => a.localeCompare(b)); }
  get aliases() { return this._aliases || {}; }
  isActive() { return !this.pane || !this.pane.isConnected || this.pane.classList.contains('on'); }
  syncTab() { this.tabs?.syncTab(this); }
  tabLabel() { return this._cwd === fs.HOME ? 'zsh' : baseName(this._cwd); }
  get promptText() {
    /* the default zsh prompt, PROMPT='%n@%m %1~ %#' */
    const short = state.settings.hostName.replace(/\s+/g, '-');
    const last = this._cwd.split('/').filter(Boolean).pop() || '~';
    return `${state.settings.userName}@${short} ${last === 'bunny' ? '~' : last} % `;
  }

  /** the real character grid, measured from the font that is actually in use */
  grid() {
    const cs = getComputedStyle(this.wrap);
    const probe = el('span', {
      style: {
        position: 'absolute', visibility: 'hidden', whiteSpace: 'pre',
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing,
      },
    });
    probe.textContent = '0'.repeat(100);
    this.wrap.append(probe);
    const charW = probe.getBoundingClientRect().width / 100 || 7.8;
    probe.remove();
    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const box = this.wrap.getBoundingClientRect();
    /* the font metrics do not change with the window, so keep the last good
       pair: a transient zero-height box must never become a bogus grid */
    if (charW > 1 && lineH > 1) this._metrics = { charW, lineH };
    const m = this._metrics || { charW, lineH };
    if (!box.width || !box.height) return { cols: this._grid?.cols ?? 80, rows: this._grid?.rows ?? 24, ...m };
    this._grid = { cols: Math.max(20, Math.floor(box.width / m.charW)), rows: Math.max(6, Math.floor(box.height / m.lineH)) };
    return { ...this._grid, ...m };
  }

  /** a block that sits where the caret is, and goes hollow when the window is not front */
  paintCaret() {
    if (!this.caret) return;
    const focused = document.activeElement === this.input && this.isActive();
    this.caret.classList.toggle('on', focused);
    this.caret.classList.toggle('hollow', !focused);
    const v = this.input.value;
    const at = this.input.selectionStart ?? v.length;
    const { charW, lineH } = this.grid();
    const before = v.slice(0, at);
    const lines = before.split('\n');
    const col = lines[lines.length - 1].length;
    this.caret.style.left = (col * charW) + 'px';
    this.caret.style.top = ((lines.length - 1) * lineH) + 'px';
    this.caret.style.width = charW + 'px';
    this.caret.style.height = lineH + 'px';
  }

  /** the title and the caret both depend on the measured grid */
  repaint() { requestAnimationFrame(() => { this.paintTitle(); this.paintCaret(); }); }

  /** Ctrl+C: the line is echoed with ^C first, then the job reports itself dead */
  interrupt() {
    this.print(`<span class="pr">${esc(this.promptText)}</span><span class="cmd">${esc(this.input.value)}^C</span>`);
    this.input.value = '';
    this.stopRunning();
    this.paintPrompt();
    this.paintCaret();
  }
  /** whatever owns the terminal — pager, editor, top, a job — this ends it */
  stopRunning() { const r = this.running; this.running = null; try { r?.(); } catch { /* job tore itself down */ } }

  /** 'bunny — -zsh — 80×24', recomputed whenever the window changes size */
  paintTitle() {
    if (this.tabs && this.tabs.active !== this) return;
    const g = this.grid();
    this.win.setTitle(`${state.settings.userName} — -zsh — ${g.cols}×${g.rows}`);
  }
  mount() {
    this.output = el('div');
    this.inputLine = el('div.term-line');
    this.input = el('input.term-input', { spellcheck: 'false', autocomplete: 'off' });
    this.input.dataset.focus = '1';
    /* macOS draws its own block cursor; the browser one only draws a ring */
    this.inputLine.append(this.input, this.caret = el('span.term-caret', { 'aria-hidden': 'true' }));
    for (const ev of ['input', 'keyup', 'click', 'select', 'focus', 'blur']) {
      this.input.addEventListener(ev, () => this.paintCaret());
    }
    this.wrap = el('div.term.scroll', null, this.output, this.inputLine);
    (this.pane || this.win.body).append(this.wrap);
    this.win._term = this;
    this.paintPrompt();
    requestAnimationFrame(() => this.repaint());
    /* the window manager moves and resizes with transforms and inline styles,
       so measure the box itself rather than waiting for a window resize event */
    if (window.ResizeObserver) {
      let w0 = 0, h0 = 0;
      this._ro = new ResizeObserver(() => {
        const b = this.wrap.getBoundingClientRect();
        if (Math.abs(b.width - w0) < 1 && Math.abs(b.height - h0) < 1) return;
        w0 = b.width; h0 = b.height;
        this.repaint();
      });
      this._ro.observe(this.wrap);
    }
    this.print('Last login: ' + fmtStamp(Date.now()) + ' on ttys000', 'dim');
    this.print('Type ‘help’ for a list of commands.', 'dim');
    this.input.addEventListener('keydown', e => this.onKey(e));
    this.wrap.addEventListener('pointerup', () => {
      if (!this.running && !String(window.getSelection())) this.input.focus();
    });
    setTimeout(() => { if (this.isActive()) this.input.focus(); }, 60);
  }
  /** plain text into the command output stream */
  out(text, ctx) { ctx.out.push(String(text).endsWith('\n') ? String(text) : String(text) + '\n'); }
  /** markup a command built on purpose — pipes see only its text */
  raw(html, ctx) { ctx.out.push({ h: String(html) }); }
  color(node, name) {
    if (!node) return `<span class="dim">${esc(name)}</span>`;
    if (node.type === 'dir') return `<span class="path">${esc(name)}</span>`;
    if (node.kind === 'app') return `<span class="acc">${esc(name)}</span>`;
    if (node.content) return `<span class="path">${esc(name)}</span>`;
    return esc(name);
  }
  readInput(files, ctx) {
    if (!files.length) return { text: ctx.in ?? '', names: [] };
    let text = '';
    const names = [];
    for (const f of files) {
      const p = fs.resolve(f, this.cwd);
      const node = fs.get(p);
      if (!node) throw new Error(`no such file or directory: ${f}`);
      if (node.type === 'dir') throw new Error(`${f} is a directory`);
      text += fs.readFile(p);
      names.push(node.name);
    }
    return { text, names };
  }
  /** trusted markup, one div per line — the prompt echo and errors use this */
  print(text = '', cls = '') {
    const parts = String(text).split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    for (const chunk of parts) {
      this.output.append(el('div.ln' + (cls ? '.' + cls : ''), { html: cls === 'err' ? esc(chunk) : chunk }));
    }
    this.scroll();
  }
  /** plain text that may carry ANSI colour codes — async jobs print this way */
  printText(text = '', cls = '') {
    const parts = String(text).split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    for (const chunk of parts) {
      this.output.append(el('div.ln' + (cls ? '.' + cls : ''), { html: ansiHtml(chunk) }));
    }
    this.scroll();
  }
  /** a job's collected chunks: plain strings get ANSI handling, {h} stays markup */
  printChunks(chunks, cls = '') {
    const lines = [];
    let cur = '';
    const flush = () => { lines.push(cur); cur = ''; };
    for (const c of chunks) {
      const segs = (typeof c === 'string' ? ansiHtml(c) : String(c.h ?? '')).split('\n');
      segs.forEach((seg, i) => { if (i) flush(); cur += seg; });
    }
    flush();
    if (lines[lines.length - 1] === '') lines.pop();
    for (const html of lines) this.output.append(el('div.ln' + (cls ? '.' + cls : ''), { html }));
    this.scroll();
  }
  scroll() { requestAnimationFrame(() => { this.wrap.scrollTop = this.wrap.scrollHeight; }); }
  clear() {
    /* wiping the scrollback also wipes any pager/editor host inside it —
       a detached modal would keep eating keys forever otherwise */
    if (this.modal) this.stopRunning();
    this.output.replaceChildren();
  }
  /** the size in pixels the text is really drawn at */
  get textSize() { return this.fontSize || parseFloat(getComputedStyle(this.wrap).fontSize) || 12; }
  bumpFont(dir) {
    /* font size is a profile setting: it follows the window, not one tab */
    const next = Math.max(9, Math.min(22, Math.round(this.textSize + dir)));
    for (const t of this.tabs ? this.tabs.tabs : [this]) {
      t.fontSize = next;
      t.wrap.style.fontSize = next + 'px';
      t._metrics = null;
      t._grid = null;
    }
    this.paintTitle();
    this.paintCaret();
  }
  selectAll() {
    const range = document.createRange();
    range.selectNodeContents(this.output);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }
  /** the window-level key hook — the dispatcher calls this last of all */
  winKey(e) {
    /* a pager, top or an editor listens on the window node itself */
    if (this.modal) return false;
    /* ⌘⇧] and ⌘⇧[ cycle tabs. The menu prints the unshifted glyph but the key
       event delivers } and {, so this hook takes both readings. */
    if (e.metaKey && e.shiftKey && (e.key === ']' || e.key === '}')) { this.tabs?.next(); return true; }
    if (e.metaKey && e.shiftKey && (e.key === '[' || e.key === '{')) { this.tabs?.prev(); return true; }
    const claimed = ['Enter', 'Tab', 'ArrowUp', 'ArrowDown'];
    if (e.ctrlKey && 'celukwbrpd'.includes(e.key.toLowerCase())) {
      /* the input does not have to be focused for the shell's own keys */
      this.input.focus({ preventScroll: true });
      this.onKey(e);
      return true;
    }
    if (claimed.includes(e.key)) { this.input.focus({ preventScroll: true }); return true; }
    if (e.key.length === 1 && !e.metaKey) this.input.focus({ preventScroll: true });
    return false;
  }
  onKey(e) {
    e.stopPropagation();
    /* a pager, top or an editor owns the keys it actually eats — its window
       listener marks them, because closing itself can clear this.modal before
       this same event reaches the input. Keys it does not want (like text or
       Return under a pager) still reach the line, the way they always have. */
    if (e.__termModalAte) { e.preventDefault(); return; }
    const k = e.key;
    if (!(e.ctrlKey && k === 'r')) this._srch = null;
    if (k !== 'Tab') this._comp = null;
    if (k === 'Enter') { e.preventDefault(); this.submit(this.input.value); return; }
    if (k === 'Tab') { e.preventDefault(); this.complete(); return; }
    if (k === 'ArrowUp') { e.preventDefault(); this.navHistory(-1); return; }
    if (k === 'ArrowDown') { e.preventDefault(); this.navHistory(1); return; }
    if (e.ctrlKey && k === 'c') { e.preventDefault(); this.interrupt(); return; }
    if (e.ctrlKey && k === 'l') { e.preventDefault(); this.clear(); return; }
    if (e.ctrlKey && k === 'a') { e.preventDefault(); this.input.setSelectionRange(0, 0); return; }
    if (e.ctrlKey && k === 'e') { e.preventDefault(); const n = this.input.value.length; this.input.setSelectionRange(n, n); return; }
    if (e.ctrlKey && k === 'u') { e.preventDefault(); this.input.value = this.input.value.slice(this.input.selectionStart); this.input.setSelectionRange(0, 0); return; }
    if (e.ctrlKey && k === 'k') { e.preventDefault(); this.input.value = this.input.value.slice(0, this.input.selectionStart); return; }
    /* Ctrl+W and Option-Delete both kill the word before the caret */
    if ((e.ctrlKey && k === 'w') || (e.altKey && (k === 'Backspace' || k === 'Delete'))) {
      e.preventDefault();
      const at = this.input.selectionStart;
      const head = this.input.value.slice(0, at).replace(/\s+$/, '');
      const cut = head.replace(/\S+$/, '');
      this.input.value = cut + this.input.value.slice(at);
      this.input.setSelectionRange(cut.length, cut.length);
      return;
    }
    if (e.ctrlKey && k === 'b') { e.preventDefault(); const n = Math.max(0, this.input.selectionStart - 1); this.input.setSelectionRange(n, n); return; }
    if (e.ctrlKey && k === 'f') { e.preventDefault(); const n = Math.min(this.input.value.length, this.input.selectionStart + 1); this.input.setSelectionRange(n, n); return; }
    if (e.ctrlKey && k === 'd') {
      e.preventDefault();
      /* ^D on an empty line is EOF: zsh ends the session, and the tab goes */
      if (!this.input.value.length) {
        this.print(`<span class="pr">${esc(this.promptText)}</span><span class="cmd">exit</span>`);
        this.tabs ? this.tabs.close(this) : wm.close(this.win);
        return;
      }
      const n = this.input.selectionStart;
      this.input.value = this.input.value.slice(0, n) + this.input.value.slice(n + 1);
      this.input.setSelectionRange(n, n);
      return;
    }
    if (e.ctrlKey && k === 'r') { e.preventDefault(); this.searchHistory(); return; }
    if (e.ctrlKey && k === 'p') { e.preventDefault(); this.navHistory(-1); return; }
    if (e.ctrlKey && k === 'n') { e.preventDefault(); this.navHistory(1); return; }
    /* Option-arrows jump by word, like every macOS text field */
    if (e.altKey && (k === 'ArrowLeft' || k === 'ArrowRight')) {
      e.preventDefault();
      const v = this.input.value, at = this.input.selectionStart;
      if (k === 'ArrowLeft') {
        const head = v.slice(0, at).replace(/\s+$/, '').replace(/\S+$/, '');
        this.input.setSelectionRange(head.length, head.length);
      } else {
        const rest = v.slice(at).replace(/^\s*\S+\s*/, '');
        const n = v.length - rest.length;
        this.input.setSelectionRange(n, n);
      }
      return;
    }
  }
  /** Ctrl+R: each press walks one match further back through history */
  searchHistory() {
    if (this._srch) this._srch.skip++;
    else this._srch = { for: this.input.value, skip: 0 };
    const q = this._srch.for;
    const matches = [...this.history].reverse().filter(h => h !== q && h.includes(q));
    const found = matches[this._srch.skip];
    if (found) { this.input.value = found; const n = found.length; this.input.setSelectionRange(n, n); }
  }
  navHistory(dir) {
    if (dir < 0 && this.hIndex === this.history.length) this.stash = this.input.value;
    const next = this.hIndex + dir;
    if (next < 0 || next > this.history.length) return;
    this.hIndex = next;
    this.input.value = next === this.history.length ? this.stash : this.history[next];
    requestAnimationFrame(() => this.input.setSelectionRange(999, 999));
  }
  complete() {
    const value = this.input.value;
    /* a second Tab on an unchanged line cycles the candidates, like zsh */
    if (this._comp && this._comp.value === value) {
      const c = this._comp;
      c.idx = (c.idx + 1) % c.hits.length;
      c.parts[c.parts.length - 1] = c.dirPart + c.hits[c.idx];
      const next = c.parts.join(' ');
      c.value = next;
      this.input.value = next;
      this.input.setSelectionRange(next.length, next.length);
      return;
    }
    const parts = value.split(/\s+/);
    const frag = parts[parts.length - 1] || '';
    if (parts.length <= 1 || (parts.length === 2 && parts[0] === '')) {
      if (!frag) return;
      const names = COMMANDS.map(c => c.name).concat(fs.children(this.cwd).map(n => n.name + (n.type === 'dir' ? '/' : '')));
      return this.offer(names.filter(n => n.startsWith(frag)), frag, parts, '');
    }
    const slash = frag.lastIndexOf('/');
    const dirPart = slash >= 0 ? frag.slice(0, slash + 1) : '';
    const namePart = slash >= 0 ? frag.slice(slash + 1) : frag;
    const resolved = fs.resolve(dirPart || '.', this.cwd);
    const node = fs.get(resolved.startsWith('~') ? fs.HOME + resolved.slice(1) : resolved);
    if (!node || node.type !== 'dir') return;
    const kids = namePart.startsWith('.') ? node.children : node.children.filter(c => !c.name.startsWith('.'));
    this.offer(kids.filter(c => c.name.startsWith(namePart)).map(c => c.name + (c.type === 'dir' ? '/' : '')), namePart, parts, dirPart);
  }
  offer(hits, frag, parts, dirPart) {
    if (!hits.length) return;
    if (hits.length === 1) {
      const name = /[ ()'"]/.test(hits[0]) ? `"${hits[0]}"` : hits[0];
      parts[parts.length - 1] = dirPart + name;
      this.input.value = parts.join(' ');
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
      return;
    }
    const shared = hits.reduce((a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return a.slice(0, i); });
    if (shared.length > frag.length) {
      parts[parts.length - 1] = dirPart + shared;
      this.input.value = parts.join(' ');
      /* once the prefix is shared, the next Tab lists and then cycles */
      this._comp = { hits, idx: -1, dirPart, parts: [...parts], value: this.input.value };
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    } else {
      this.print(`<span class="pr">${esc(this.promptText)}</span><span class="cmd">${esc(this.input.value)}</span>`);
      this.print(hits.map(esc).join('   '));
      this._comp = { hits, idx: -1, dirPart, parts: [...parts], value: this.input.value };
    }
  }
  submit(raw) {
    /* Return always runs the line. If a pager, an editor or a long command still
       owns the terminal, it is stopped first: otherwise the prompt is never
       painted again and the shell stops answering, which no real terminal does. */
    if (this.running) this.stopRunning();
    const line = raw.trim();
    this.print(`<span class="pr">${esc(this.promptText)}</span><span class="cmd">${esc(raw)}</span>`);
    this.input.value = '';
    if (line) {
      if (this.history[this.history.length - 1] !== line) this.history.push(line);
      saveHistory(this.history);
    }
    this.hIndex = this.history.length;
    if (line) this.run(line);
    /* ping, top, a pager and an editor keep the prompt: they hand it back */
    if (!this.running) this.paintPrompt();
  }
  paintPrompt() {
    /* never rebuild the line: that would move the caret mid-typing */
    const pr = this.inputLine.querySelector('.pr');
    if (pr) pr.textContent = this.promptText;
    else this.inputLine.replaceChildren(el('span.pr', { text: this.promptText }), this.input, this.caret);
    const caret = this.input.value.length;
    this.input.setSelectionRange(caret, caret);
    this.input.focus({ preventScroll: true });
  }

  /* ── execution ─────────────────────────────────────────────────────── */
  expOpts() {
    return {
      home: fs.HOME,
      user: this.vars.USER,
      lastCode: this.lastCode ?? 0,
      pid: 501,
      runCommand: inner => {
        /* $(…) runs the whole little pipeline and hands back what it printed */
        let pieces = '';
        let last = 0;
        for (const job of parseShell(tokenize(inner))) {
          if (job.op === '&&' && last !== 0) continue;
          if (job.op === '||' && last === 0) continue;
          let pipe = '';
          let code = 0;
          for (const stage of job.chain) {
            const argv = this.expandTokens(stage.toks).map(x => x.v);
            const c = { in: pipe, out: [], err: [], exit: false, clear: false, tty: false };
            code = this.execCommand(argv, c);
            if (code === -1) code = 0;
            pipe = c.out.map(chunkText).join('');
          }
          last = code;
          pieces += pipe;
        }
        this.lastCode = last;
        return pieces;
      },
    };
  }

  run(line) {
    /* a programmatic run while a job, pager or editor owns the terminal ends
       that first — the shell is never stuck behind a stale modal */
    if (this.running || this.modal) this.stopRunning();
    let last = 0;
    /* the line is split into jobs first, and each job's words are expanded at
       the moment that job runs. That is what makes `ls /nope; echo $?` report
       the failure, and `unset FOO; echo $FOO` report nothing: a shell reads
       the words of a command just before it runs it, not all at once. */
    for (const job of parseShell(tokenize(line))) {
      if (job.op === '&&' && last !== 0) continue;
      if (job.op === '||' && last === 0) continue;
      /* VAR=value in front of a command only lives as long as that command;
         with no command at all, the assignment sticks like a real shell's */
      const saved = {};
      const first = job.chain[0]?.toks || [];
      let head = 0;
      while (head < first.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(first[head].v)) {
        const eq = first[head].v.indexOf('=');
        const k = first[head].v.slice(0, eq);
        const valTok = { t: 'word', v: first[head].v.slice(eq + 1), q: first[head].q };
        saved[k] = this.vars[k];
        this.vars[k] = unprotect(expandWord(valTok, this.vars, this.expOpts()));
        head++;
      }
      let input = '';
      let code = 0;
      let chunks = null;
      let assignOnly = false;
      for (let i = 0; i < job.chain.length; i++) {
        const stage = job.chain[i];
        const argv = this.expandTokens(i === 0 ? stage.toks.slice(head) : stage.toks).map(x => x.v);
        if (!argv.length && head > 0) { assignOnly = true; break; }
        /* only the last stage of an un-redirected job is writing to a terminal */
        const ctx = { in: input, out: [], err: [], exit: false, clear: false, tty: i === job.chain.length - 1 && !job.redirect };
        code = this.execCommand(argv, ctx);
        if (code === -1) code = 0;   /* -1: the job keeps running out of band */
        this.lastCode = code;
        /* print() escapes err chunks itself — push the message raw */
        for (const e of ctx.err) this.print(e.replace(/\n$/, ''), 'err');
        input = ctx.out.map(chunkText).join('');
        chunks = ctx.out;
        if (ctx.clear) this.clear();
        if (ctx.exit) { this.tabs ? this.tabs.close(this) : wm.close(this.win); return; }
        if (this.running) break;    /* an async stage owns the rest of the job */
      }
      const target = job.targetTok ? this.expandTokens([job.targetTok])[0]?.v : null;
      if (job.redirect && target) {
        try {
          const p = fs.resolve(target, this.cwd);
          const existing = fs.get(p);
          if (existing && existing.type !== 'file') throw new Error(`${target} is a directory`);
          if (existing && job.redirect === '>') fs.writeFile(p, input);
          else if (existing) fs.appendFile(p, input);
          else fs.createFile(dirName(p), baseName(p), input);
        } catch (err) { this.print(esc(`zsh: ${err.message}`), 'err'); code = 1; }
      } else if (chunks && chunks.length) {
        this.printChunks(chunks);
      }
      /* `cmd &` hands the still-running job to the background table */
      if (job.bg && this.running) {
        const stop = this.running;
        this.running = null;
        const tr = this.trackBackground(line.trim().replace(/&\s*$/, '').trim());
        const baseStop = tr.stop.bind(tr);
        tr.stop = () => { try { stop(); } catch { /* already gone */ } baseStop(); };
        this.print(`<span class="dim">[${this.trackedBackground().length}] ${tr.pid}</span>`);
      }
      last = code;
      if (!assignOnly) {
        for (const k of Object.keys(saved)) {
          if (saved[k] === undefined) delete this.vars[k];
          else this.vars[k] = saved[k];
        }
      }
    }
    this.lastCode = last;
  }

  /** tokens -> tokens, with variables, ~ and globs resolved */
  expandTokens(tokens) {
    const out = [];
    const done = (v, q) => out.push({ t: 'word', v: unprotect(v), q });
    for (const tok of tokens) {
      if (tok.t !== 'word') { out.push(tok); continue; }
      const text = expandWord(tok, this.vars, this.expOpts());
      /* an unquoted glob that matches becomes one word per match */
      if (hasGlob(tok) && tok.q !== '"') {
        const hits = globPaths(text, this.cwd, fs);
        if (hits.length) { for (const h of hits) done(h, null); continue; }
      }
      /* an unquoted word that came out with spaces in it becomes several words.
         A quoted one never does: "1 +" is one argument, and 'a b' is one word. */
      if (tok.q == null && /\s/.test(text)) {
        for (const part of text.split(/\s+/).filter(Boolean)) done(part, null);
        continue;
      }
      done(text, tok.q);
    }
    return out;
  }
  execCommand(argv, ctx) {
    /* an alias stands in for its target, exactly as a shell alias does */
    if (argv[0] && this.aliases[argv[0]]) {
      const expanded = this.expandTokens(tokenize(this.aliases[argv[0]])).map(x => x.v);
      argv = [...expanded, ...argv.slice(1)];
    }
    const cmd = argv[0] ? COMMANDS.find(c => c.name === argv[0]) : null;
    if (!cmd) { ctx.err.push(`zsh: command not found: ${argv[0]}`); return 127; }
    try { return cmd.run(argv.slice(1), ctx, this) || 0; }
    catch (err) { ctx.err.push(`zsh: ${err.message}`); return 1; }
  }
  findCommand(name) { return COMMANDS.find(c => c.name === name) || null; }

  /* ── things the commands need from the shell around them ──────────── */

  /** the live process table: one row per window, per background job, plus init */
  processes() {
    this._pidMap = this._pidMap || new Map();
    let next = this._pidSeq || 640;
    const rows = [];
    const live = new Set();
    for (const w of wm.windows) {
      live.add(w.id);
      if (!this._pidMap.has(w.id)) this._pidMap.set(w.id, next += 7);
      const app = allApps().find(a => a.id === w.app);
      const i = rows.length;
      rows.push({
        pid: this._pidMap.get(w.id), name: app?.name || w.app, win: w,
        tty: 'ttys00' + (i % 4), cpu: +(((i * 3.1) % 9).toFixed(1)), mem: +(((i * 1.7) % 5 + 1).toFixed(1)),
        stat: i === 0 ? 'Rs' : 'Ss', state: i === 0 ? 'running' : 'sleeping',
      });
    }
    for (const k of [...this._pidMap.keys()]) if (!live.has(k)) this._pidMap.delete(k);
    this._pidSeq = next;
    for (const tr of this.trackedBackground()) rows.push({ pid: tr.pid, name: tr.cmd, job: tr, tty: '??', cpu: 0, mem: 0.1, stat: 'S', state: 'sleeping' });
    rows.push({ pid: 501, name: '-zsh', tty: 'ttys000', cpu: 0, mem: 0.1, stat: 'Ss', state: 'sleeping', self: true });
    rows.push({ pid: 1, name: 'launchd', tty: '??', cpu: 0, mem: 0.2, stat: 'Ss', state: 'sleeping' });
    rows.push({ pid: 88, name: 'WindowServer', tty: '??', cpu: 3.2, mem: 1.4, stat: 'Rs', state: 'running' });
    return rows;
  }
  topLoad() {
    const busy = Math.min(4.9, 1.24 + wm.windows.length * 0.21 + (player.playing ? 0.4 : 0));
    return `${busy.toFixed(2)} ${(busy * 0.92).toFixed(2)} ${(busy * 0.85).toFixed(2)}`;
  }
  topRows() {
    const rows = [['PID', 'COMMAND', '%CPU', 'MEM', 'STATE']];
    for (const p of this.processes().sort((a, b) => b.cpu - a.cpu)) {
      rows.push([String(p.pid).padStart(5), p.name, p.cpu.toFixed(1), p.mem.toFixed(1), p.state || 'sleeping']);
    }
    return rows;
  }
  trackedBackground() { return (state.termBg || []).filter(b => b.alive); }
  dropBackground(tr) { state.termBg = (state.termBg || []).filter(b => b !== tr); }
  trackBackground(cmd) {
    const tr = { cmd, pid: 700 + (state.termBg?.length || 0) * 3, alive: true, stop() { this.alive = false; } };
    state.termBg = [...(state.termBg || []), tr];
    return tr;
  }

  /** a real fetch: the answer lands later, so it prints when it arrives.
      CORS refusals are reported the way curl reports a failed connection. */
  fetchExternal(url, { method = 'GET', showHead = false, headOnly = false, saveAs = null } = {}) {
    const ctrl = new AbortController();
    this.running = () => ctrl.abort();
    fetch(url, { method, mode: 'cors', signal: ctrl.signal })
      .then(async res => {
        let buf = '';
        if (showHead) {
          buf += `HTTP/1.1 ${res.status} ${res.statusText}\n`;
          for (const [k, v] of res.headers) buf += `${k}: ${v}\n`;
          buf += '\n';
        }
        const type = res.headers.get('content-type') || '';
        const body = method === 'GET' && /text|json|html|xml|javascript/.test(type) ? (await res.text()).slice(0, 200000) : '';
        if (saveAs) {
          const p = fs.resolve(saveAs, this.cwd);
          if (fs.exists(p)) fs.writeFile(p, buf + body);
          else fs.createFile(dirName(p), baseName(p), buf + body);
          this.printText(`  % Total    % Received  % Average Speed\n  0  ${body.length}k    0  ${body.length}k    0     0   ${Math.round(body.length / 10)}      0 --:--:-- --:--:-- --:--:--  ${Math.round(body.length / 10)}`);
        } else {
          this.printText(buf + body);
        }
        this.afterAsync();
      })
      .catch(err => {
        if (ctrl.signal.aborted) { this.afterAsync(); return; }
        const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
        const reason = /Failed to fetch|NetworkError|Load failed/i.test(err.message) ? 'Connection refused' : err.message;
        this.printText(`curl: (7) Failed to connect to ${host} port 443 after 0 ms: ${reason}`, 'err');
        this.afterAsync();
      });
  }

  /** the password prompt sudo shows, with the input hidden. Ctrl+C cancels. */
  askPassword(prompt) {
    return new Promise(resolve => {
      const row = el('div.ln', null, el('span', { text: prompt }));
      const input = el('input.term-pass', { type: 'password', 'aria-label': 'Password' });
      row.append(input);
      this.output.append(row);
      this.scroll();
      input.focus();
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        const v = input.value;
        input.remove();
        this.running = null;
        resolve(ok ? v : null);
      };
      input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape' || (e.ctrlKey && e.key === 'c')) { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => setTimeout(() => { if (!done) finish(false); }, 80));
      /* while the password box is up, the shell is busy: Ctrl+C backs out */
      this.running = () => finish(false);
    });
  }

  /** run a line as if it were typed: sudo needs this */
  runLine(line) {
    this.print(`<span class="pr">${esc(this.promptText)}</span><span class="cmd">${esc(line)}</span>`);
    if (line) this.run(line);
    if (!this.running) this.paintPrompt();
  }
  /** same, without the echoed prompt line — sudo already showed its prompt */
  runQuiet(line) {
    if (line) this.run(line);
    if (!this.running) this.paintPrompt();
  }

  /** a command that is still going owns the terminal: the prompt waits */
  afterAsync() {
    if (this.running) return;
    this.paintPrompt();
    this.paintCaret();
  }

  /* ── pagers and editors ──────────────────────────────────────────── */
  openPager() {
    /* each pager gets its own node: the terminal can be cleared at any moment,
       and a reused host would end up detached with nobody able to read it */
    const host = el('div.term-pager');
    this.output.append(host);
    this.scroll();
    return host;
  }
  editor(file, flavour) {
    const path = fs.resolve(file, this.cwd);
    const exists = fs.exists(path);
    if (!exists && !flavour) throw new Error(`${file}: No such file or directory`);
    const start = exists ? fs.readFile(path) : '';
    let savedContent = start;
    /* a real editor takes the whole pane, not one line of the scrollback */
    const host = el('div.term-editor');
    const bar = el('div.term-edit-bar');
    const area = el('textarea.term-edit-area', { spellcheck: 'false' });
    area.value = start;
    const hint = el('div.term-edit-hint');
    host.append(bar, area, hint);
    (this.pane || this.output).append(host);
    const save = () => {
      if (fs.exists(path)) fs.writeFile(path, area.value);
      else fs.createFile(dirName(path), baseName(path), area.value);
      savedContent = area.value;
    };
    const dirty = () => area.value !== savedContent;
    const quit = () => {
      if (this._editorClose !== quit) return;
      this._editorClose = null;
      host.remove();
      window.removeEventListener('keydown', onKey, true);
      this.running = null;
      this.modal = null;
      this.afterAsync();
    };
    this._editorClose = quit;
    this.modal = 'editor';
    let mode = flavour === 'vim' ? 'normal' : 'insert';
    let pending = '';
    let nanoAsk = false;
    const setMode = m => {
      mode = m;
      area.readOnly = flavour === 'vim' && m === 'normal';
      bar.textContent = flavour === 'vim'
        ? ` "${tildify(path)}" ${m === 'insert' ? '-- INSERT --' : ''}`
        : `  GNU nano 7.2   ${tildify(path)}`;
    };
    setMode(mode);
    hint.textContent = flavour === 'vim'
      ? 'i insert   Esc command   :w write   :q quit   :wq write and quit   :q! quit without saving'
      : '⌃O write   ⌃X exit   ⌃W search';
    /* the current line's [start, end), for dd and friends */
    const curLine = () => {
      const v = area.value, at = area.selectionStart ?? 0;
      const a = v.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
      let b = v.indexOf('\n', at);
      b = b < 0 ? v.length : b + 1;
      return [a, b];
    };
    const restoreHint = () => {
      hint.textContent = flavour === 'vim'
        ? 'i insert   Esc command   :w write   :q quit   :wq write and quit   :q! quit without saving'
        : '⌃O write   ⌃X exit   ⌃W search';
    };
    const execCmd = v => {
      const verb = v.trim();
      if (verb === 'w' || verb === 'wq' || verb === 'x') {
        save();
        bar.textContent = `"${file}" ${area.value.split('\n').length}L, ${area.value.length}C written`;
      }
      if (verb === 'q' || verb === 'q!' || verb === 'wq' || verb === 'x') {
        if (verb === 'q' && dirty()) { bar.textContent = 'E37: No write since last change (add ! to override)'; return; }
        quit();
      } else if (verb === 'w') { /* written, stay */ }
      else if (verb && !['w', 'wq', 'x', 'q', 'q!'].includes(verb)) {
        bar.textContent = `E492: Not an editor command: ${verb}`;
      }
    };
    let cmdOpen = false;
    const openCmdline = () => {
      cmdOpen = true;
      const cmdIn = el('input.term-edit-cmd', { spellcheck: 'false' });
      hint.replaceChildren(document.createTextNode(':'), cmdIn);
      cmdIn.focus();
      cmdIn.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); const v = cmdIn.value; cmdOpen = false; restoreHint(); area.focus(); execCmd(v); }
        if (e.key === 'Escape') { e.preventDefault(); cmdOpen = false; restoreHint(); area.focus(); }
      });
    };
    const onKey = e => {
      onKeyInner(e);
      /* an eaten key is marked so the shell input ignores this same event
         even when the editor just closed and cleared the modal flag */
      if (e.defaultPrevented) e.__termModalAte = true;
    };
    const onKeyInner = e => {
      if (!this.isActive() || wm.focused !== this.win || cmdOpen) return;
      /* no stopPropagation: the textarea must still get the keys we do not eat */
      if (flavour === 'vim') {
        if (mode === 'normal') {
          const v = area.value;
          const at = area.selectionStart ?? v.length;
          if (e.key === 'Escape') { pending = ''; e.preventDefault(); return; }
          if (pending === 'd') {
            pending = '';
            if (e.key === 'd') {
              const [a, b] = curLine();
              area.value = v.slice(0, a) + v.slice(b);
              area.setSelectionRange(Math.min(a, area.value.length), Math.min(a, area.value.length));
            }
            e.preventDefault(); return;
          }
          if (pending === 'g') {
            pending = '';
            if (e.key === 'g') area.setSelectionRange(0, 0);
            e.preventDefault(); return;
          }
          if (e.key === 'd' || e.key === 'g') { pending = e.key; e.preventDefault(); return; }
          if (e.key === 'i') { setMode('insert'); area.focus(); e.preventDefault(); return; }
          if (e.key === 'a') { setMode('insert'); area.setSelectionRange(Math.min(v.length, at + 1), Math.min(v.length, at + 1)); area.focus(); e.preventDefault(); return; }
          if (e.key === 'A') { setMode('insert'); const eol = v.indexOf('\n', at); const n = eol < 0 ? v.length : eol; area.setSelectionRange(n, n); area.focus(); e.preventDefault(); return; }
          if (e.key === 'o') {
            const eol = v.indexOf('\n', at);
            const n = eol < 0 ? v.length : eol;
            area.value = v.slice(0, n) + '\n' + v.slice(n);
            area.setSelectionRange(n + 1, n + 1);
            setMode('insert'); area.focus(); e.preventDefault(); return;
          }
          if (e.key === 'x') { area.value = v.slice(0, at) + v.slice(at + 1); area.setSelectionRange(at, at); e.preventDefault(); return; }
          if (e.key === 'G') { area.setSelectionRange(v.length, v.length); e.preventDefault(); return; }
          if (e.key === '0' || e.key === '^') { const [a] = curLine(); area.setSelectionRange(a, a); e.preventDefault(); return; }
          if (e.key === '$') { const eol = v.indexOf('\n', at); area.setSelectionRange(eol < 0 ? v.length : eol, eol < 0 ? v.length : eol); e.preventDefault(); return; }
          if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const lines = v.split('\n');
            const pos = v.slice(0, at).split('\n');
            const row = Math.max(0, Math.min(lines.length - 1, pos.length - 1 + ((e.key === 'j' || e.key === 'ArrowDown') ? 1 : -1)));
            const col = Math.min(pos[pos.length - 1].length, lines[row].length);
            const atLine = lines.slice(0, row).join('\n').length + (row ? 1 : 0) + col;
            area.setSelectionRange(atLine, atLine);
            e.preventDefault(); return;
          }
          if (e.key === 'h' || e.key === 'ArrowLeft') { area.setSelectionRange(Math.max(0, at - 1), Math.max(0, at - 1)); e.preventDefault(); return; }
          if (e.key === 'l' || e.key === 'ArrowRight') { area.setSelectionRange(Math.min(v.length, at + 1), Math.min(v.length, at + 1)); e.preventDefault(); return; }
          if (e.key === ':') { openCmdline(); e.preventDefault(); return; }
          if (e.ctrlKey && e.key === 'c') { /* vim does not quit on ^C */ e.preventDefault(); return; }
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) e.preventDefault();
          return;
        }
        /* insert mode: the textarea types, Esc goes back to normal */
        if (e.key === 'Escape') { setMode('normal'); pending = ''; e.preventDefault(); }
        return;
      }
      /* nano */
      if (nanoAsk) {
        e.preventDefault();
        const k = e.key.toLowerCase();
        if (k === 'y') { save(); quit(); }
        else if (k === 'n') { quit(); }
        else { nanoAsk = false; restoreHint(); bar.textContent = `  GNU nano 7.2   ${tildify(path)}`; }
        return;
      }
      if (e.ctrlKey && e.key === 'o') { e.preventDefault(); save(); bar.textContent = `[ Wrote ${area.value.split('\n').length} lines ]`; return; }
      if (e.ctrlKey && e.key === 'x') {
        e.preventDefault();
        if (dirty()) { nanoAsk = true; bar.textContent = 'Save modified buffer (ANSWERING "No" WILL DESTROY CHANGES) ?  y/n'; }
        else quit();
        return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    this.running = quit;
    setTimeout(() => {
      area.focus();
      /* real editors open with the cursor on line one, not at the end */
      area.setSelectionRange(0, 0);
    }, 30);
    return -1;
  }

  /** everything the tab leaves behind when it closes */
  destroy() {
    try { this.stopRunning(); } catch { /* already down */ }
    clearTimeout(this.timer);
    for (const off of this._offs || []) { try { off(); } catch { /* stale */ } }
    this._ro?.disconnect();
  }

  /* ── the app world the commands talk to ──────────────────────────── */
  installedApps() { return allApps().filter(a => a.dock !== undefined); }
  findInstalledByName(name) {
    const want = String(name).toLowerCase().replace(/\.app$/, '');
    return allApps().find(a => a.name.toLowerCase() === want || a.id === want) || null;
  }
  launchApp(id) { import('../core/os.js').then(o => o.launch(id)); }
  formulaToApp(name) {
    const want = String(name).toLowerCase();
    return allApps().find(a => a.id === want || a.name.toLowerCase() === want) || null;
  }
  revealInApp(path, node) {
    import('../core/os.js').then(o => {
      if (node.type === 'dir') { o.launch('finder', { path }); return; }
      if (node.kind === 'app') {
        const id = allApps().find(a => node.name.startsWith(a.name))?.id;
        if (id) { o.launch(id); return; }
      }
      if (node.kind === 'image') { o.launch('photos', { path }); return; }
      if (node.kind === 'audio') { o.launch('music'); return; }
      o.launch('textedit', { path });
    });
  }
  openURL(url) { import('../core/os.js').then(o => o.launch('safari', { url })); }
  /* a repository is a directory containing .git — look up the chain */
  gitRepo() {
    let dir = this.cwd;
    for (;;) {
      const node = fs.get(dir);
      const gd = node?.children?.find(c => c.name === '.git' && c.type === 'dir');
      if (gd) return { dir, git: gd };
      if (dir === '/' || !dir) return null;
      dir = dirName(dir);
    }
  }
}

/* ── commands ───────────────────────────────────────────────────────── */
/* `help` is generated from the command table itself: a command that exists
   but is not described would be a command nobody can find. */
const helperLines = () => COMMANDS
  .filter(c => DESCRIBE[c.name])
  .map(c => [c.name, DESCRIBE[c.name]])
  .sort((a, b) => a[0].localeCompare(b[0]));

const SHELL_SYNTAX = [
  ['cmd | cmd', 'pipes'],
  ['cmd && cmd', 'run on success, || on failure'],
  ['cmd > file', 'write output, >> appends'],
  ['cmd &', 'run in the background'],
  ['$NAME', 'a variable, and $? is the last status'],
  ['VAR=x cmd', 'set a variable for one command'],
  ['*  ?  []  ~', 'globs and the home folder'],
  ['"double"', 'expands variables, \'single\' does not'],
];

const sysinfo = (args, ctx, t) => {
  const logo = [
    '                    c.', '                 ,xNMM.', '               .OMMMMo', '               lMM"',
    '     .;loddo:.  .olloddol;.', '   cKMMMMMMMMMMNWMMMMMMMMMM0:', ' .KMMMMMMMMMMMMMMMMMMMMMMMWd.',
    ' XMMMMMMMMMMMMMMMMMMMMMMMX.', ';MMMMMMMMMMMMMMMMMMMMMMMM:', ':MMMMMMMMMMMMMMMMMMMMMMMM:',
    '.MMMMMMMMMMMMMMMMMMMMMMMMX.', ' kMMMMMMMMMMMMMMMMMMMMMMMMWd.', ' "XMMMMMMMMMMMMMMMMMMMMMMMk',
    '  "#XMMMMMMMMMMMMMMMMMMMMMMK.', '    .cooc,.    .,coo:.',
  ];
  const info = [
    `<span class="acc">${esc(state.settings.userName)}@${esc(state.settings.hostName.toLowerCase().replace(/\s+/g, ''))}</span>`,
    '-----------------',
    `<span class="acc">OS:</span> ${esc(MACHINE.os)} ${esc(MACHINE.version)} ${esc(MACHINE.build)}`,
    `<span class="acc">Host:</span> ${esc(state.settings.hostName)}`,
    `<span class="acc">Kernel:</span> ${esc(MACHINE.kernel)}`,
    `<span class="acc">Shell:</span> ${esc(MACHINE.shell)}`,
    `<span class="acc">Resolution:</span> ${window.innerWidth}x${window.innerHeight}`,
    '<span class="acc">DE:</span> Aqua',
    `<span class="acc">CPU:</span> ${esc(MACHINE.chip)}`,
    `<span class="acc">Memory:</span> ${esc(MACHINE.memory)}`,
    `<span class="acc">Disk (/):</span> ${(fs.usedBytes() / 1e9).toFixed(1)} GiB / 994.66 GiB`,
  ];
  const lines = Math.max(logo.length, info.length);
  for (let i = 0; i < lines; i++) t.raw(`<span class="dim">${esc((logo[i] || '').padEnd(36))}</span>${info[i] || ''}\n`, ctx);
  return 0;
};

const COMMANDS = [
  ...EXTRA_COMMANDS,
  { name: 'help', run(args, ctx, t) {
    for (const [c, d] of helperLines()) t.raw(`<span class="cmd">${esc(c.padEnd(22))}</span><span class="dim">${esc(d)}</span>\n`, ctx);
    t.raw('\n', ctx);
    for (const [c, d] of SHELL_SYNTAX) t.raw(`<span class="cmd">${esc(c.padEnd(22))}</span><span class="dim">${esc(d)}</span>\n`, ctx);
    t.raw('\n<span class="dim">man <command> explains one of them.</span>\n', ctx);
    return 0;
  } },
  { name: 'pwd', run(args, ctx, t) { ctx.out.push(t.cwd + '\n'); return 0; } },
  { name: 'ls', run(args, ctx, t) {
    const fl = flagsOf(args);
    const long = fl.has('l'), all = fl.has('a'), human = fl.has('h'), byTime = fl.has('t'), rev = fl.has('r'), rec = fl.has('R');
    const operands = plain(args);
    const names = operands.length ? operands : ['.'];
    let code = 0;
    /* real ls prints the file operands first, then the directories it heads */
    const fileOps = [], dirOps = [];
    for (const a of names) {
      const node = fs.get(fs.resolve(a, t.cwd));
      if (!node) { ctx.err.push(`no such file or directory: ${a}\n`); code = 1; continue; }
      (node.type === 'dir' ? dirOps : fileOps).push([a, node]);
    }
    const listOne = (label, node) => {
      let items = all ? [...node.children].sort(fs.sortEntries) : fs.children(node);
      if (byTime) items = items.slice().sort((a, b) => (b.modified || 0) - (a.modified || 0));
      if (rev) items = items.slice().reverse();
      if (long) {
        const rows = [];
        if (all) {
          const parent = fs.get(dirName(fs.pathOf(node) || '/'));
          rows.push({ name: '.', dir: true, node, links: items.length + 2 });
          rows.push({ name: '..', dir: true, node: parent, links: parent ? parent.children.filter(c => !c.name.startsWith('.')).length + 2 : 2 });
        }
        for (const c of items) rows.push({ name: c.name, dir: c.type === 'dir', node: c });
        const total = rows.reduce((sum, r) => sum + Math.ceil(dirSize(r.node) / 512), 0);
        t.raw(`total ${total}\n`, ctx);
        for (const r of rows) {
          const size = human ? hum(dirSize(r.node)).padStart(5) : String(dirSize(r.node)).padStart(5);
          const links = r.links ?? 1;
          t.raw(`<span class="dim">${r.dir ? 'drwxr-xr-x' : '-rw-r--r--'}</span>  ` +
            `<span class="dim">${String(links).padStart(2)} ${esc(state.settings.userName).padEnd(6)} staff</span>  ` +
            `<span class="dim">${size}</span> <span class="dim">${lsDate(r.node?.modified || Date.now())}</span>  ` +
            t.color(r.node, r.name + classify(r.node, fl.has('F'))) + '\n', ctx);
        }
      } else {
        const shown = (all ? [{ name: '.', type: 'dir' }, { name: '..', type: 'dir' }, ...items] : items);
        const labels = shown.map(c => c.name + classify(c, fl.has('F')));
        if (!labels.length) return;
        if (!ctx.tty) { for (const n of labels) ctx.out.push(n + '\n'); return; }
        const cols = Math.max(40, Math.floor((t.win.rect.w - 30) / 8.2));
        const width = Math.min(28, Math.max(...labels.map(n => n.length)) + 3);
        const perRow = Math.max(1, Math.floor(cols / width));
        let line = '';
        labels.forEach((n, i) => {
          line += n.padEnd(width);
          if ((i + 1) % perRow === 0) { ctx.out.push(line.trimEnd() + '\n'); line = ''; }
        });
        if (line.trim()) ctx.out.push(line.trimEnd() + '\n');
      }
      if (rec) {
        for (const c of items) {
          if (c.type !== 'dir') continue;
          const sub = `${label === '/' ? '' : label + '/'}${c.name}`;
          ctx.out.push(`\n${sub}:\n`);
          listOne(sub, c);
        }
      }
    };
    for (const [a] of fileOps) ctx.out.push(a + '\n');
    const headed = dirOps.length > 1 || (dirOps.length === 1 && fileOps.length) || rec;
    dirOps.forEach(([a, node], i) => {
      if (headed) ctx.out.push(`${fileOps.length || i ? '\n' : ''}${a}:\n`);
      else if (i) ctx.out.push('\n');
      listOne(a, node);
    });
    return code;
  } },
  { name: 'cd', run(args, ctx, t) {
    const arg = args[0] || '~';
    if (arg === '-') {
      if (!t.prevCwd) throw new Error('cd: OLDPWD not set');
      const to = t.prevCwd;
      t.prevCwd = t.cwd;
      t.cwd = to;
      ctx.out.push(t.cwd + '\n');
      return 0;
    }
    let p = fs.resolve(arg, t.cwd);
    let node = fs.get(p);
    /* CDPATH lets a bare `cd name` find directories elsewhere, like zsh */
    if ((!node || node.type !== 'dir') && t.vars.CDPATH && !arg.startsWith('/') && !arg.startsWith('.')) {
      for (const base of t.vars.CDPATH.split(':').filter(Boolean)) {
        const cand = fs.get(fs.resolve(arg, base));
        if (cand?.type === 'dir') { node = cand; p = fs.pathOf(cand); break; }
      }
    }
    if (!node) throw new Error(`no such file or directory: ${arg}`);
    if (node.type !== 'dir') throw new Error(`not a directory: ${arg}`);
    t.prevCwd = t.cwd;
    t.cwd = fs.pathOf(node) || '/';
    return 0;
  } },
  { name: 'mkdir', run(args, ctx, t) {
    const names = plain(args);
    if (!names.length) throw new Error('usage: mkdir [-p] name');
    for (const name of names) {
      const p = name.includes('/') ? fs.resolve(name, t.cwd) : joinPath(t.cwd, name);
      if (fs.get(p)) {
        if (has(args, '-p')) continue;
        throw new Error(`mkdir: ${name}: File exists`);
      }
      const parent = dirName(p);
      if (!fs.get(parent)) {
        if (!has(args, '-p')) throw new Error(`no such file or directory: ${parent}`);
        let built = '';
        for (const part of p.split('/').filter(Boolean)) {
          built += '/' + part;
          if (!fs.get(built)) fs.mkdir(dirName(built), baseName(built));
        }
        continue;
      }
      fs.mkdir(parent, baseName(p));
    }
    return 0;
  } },
  { name: 'touch', run(args, ctx, t) {
    if (!args.length) throw new Error('usage: touch file…');
    for (const name of plain(args)) {
      const p = fs.resolve(name, t.cwd);
      if (fs.get(p)) fs.writeFile(p, fs.readFile(p));
      else fs.createFile(dirName(p), baseName(p), '');
    }
    return 0;
  } },
  { name: 'rm', run(args, ctx, t) {
    if (!args.length) throw new Error('usage: rm [-rf] path…');
    const recursive = args.some(a => a.startsWith('-') && a.includes('r'));
    /* SIP-style protection: the disk and its system roots survive even a
       successful sudo */
    const protectedRoots = new Set(['/', '/System', '/Users', '/Applications', '/Library', '/bin', '/sbin', '/usr', '/private', '/dev', '/cores', '/opt', '/var', '/etc', '/tmp', '/home', '/net', '/Network', '/Volumes']);
    for (const name of plain(args)) {
      const p = fs.resolve(name, t.cwd);
      const node = fs.get(p);
      if (!node) { if (args.some(a => a.startsWith('-') && a.includes('f'))) continue; throw new Error(`no such file or directory: ${name}`); }
      if (protectedRoots.has(p)) { ctx.err.push(`rm: ${name}: ${p === '/' ? '"/" may not be removed' : 'Operation not permitted'}\n`); continue; }
      if (node.type === 'dir' && !recursive) throw new Error(`${name} is a directory`);
      fs.removePermanent(p);
    }
    return 0;
  } },
  { name: 'mv', run(args, ctx, t) {
    const paths = plain(args);
    if (paths.length < 2) throw new Error('usage: mv source destination');
    const src = fs.resolve(paths[0], t.cwd);
    if (!fs.get(src)) throw new Error(`no such file or directory: ${paths[0]}`);
    const dst = fs.resolve(paths[1], t.cwd);
    if (fs.get(dst)?.type === 'dir') { fs.move(src, dst); return 0; }
    const parent = dirName(dst);
    if (!fs.get(parent)) throw new Error(`no such directory: ${parent}`);
    const moved = fs.move(src, parent);
    fs.rename(fs.pathOf(moved), baseName(dst));
    return 0;
  } },
  { name: 'cp', run(args, ctx, t) {
    const paths = plain(args);
    if (paths.length < 2) throw new Error('usage: cp source destination');
    const src = fs.resolve(paths[0], t.cwd);
    const srcNode = fs.get(src);
    if (!srcNode) throw new Error(`no such file or directory: ${paths[0]}`);
    const recursive = args.some(a => /^-[a-zA-Z]*[rRa]/.test(a));
    if (srcNode.type === 'dir' && !recursive) { ctx.err.push(`cp: ${paths[0]} is a directory (not copied).\n`); return 1; }
    let dst = fs.resolve(paths[1], t.cwd);
    if (fs.get(dst)?.type === 'dir') dst = joinPath(dst, baseName(src));
    const clone = fs.copy(src, dirName(dst));
    if (baseName(dst) !== clone.name) fs.rename(fs.pathOf(clone), baseName(dst));
    return 0;
  } },
  { name: 'cat', run(args, ctx, t) {
    const { text } = t.readInput(plain(args), ctx);
    ctx.out.push(text);
    return 0;
  } },
  { name: 'echo', run(args, ctx) {
    const a = [...args];
    const fl = new Set();
    while (a.length && /^-[neE]+$/.test(a[0])) { for (const c of a[0].slice(1)) fl.add(c); a.shift(); }
    let text = a.join(' ');
    /* zsh's echo interprets \n \t \r unless -E says otherwise */
    if (!fl.has('E')) text = text.replace(/\\([ntr\\])/g, (m, c) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\' }[c]));
    ctx.out.push(text + (fl.has('n') ? '' : '\n'));
    return 0;
  } },
  { name: 'printf', run(args, ctx) {
    let format = args[0] || '';
    const values = args.slice(1);
    let i = 0;
    format = format.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/%[sd]/g, () => values[i++] ?? '');
    ctx.out.push(format);
    return 0;
  } },
  { name: 'wc', run(args, ctx, t) {
    const fl = flagsOf(args);
    const { text, names } = t.readInput(plain(args), ctx);
    const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
    const words = text.split(/\s+/).filter(Boolean).length;
    const bytes = new Blob([text]).size;
    /* BSD wc right-aligns every column in 8 characters */
    const label = fl.has('l') && !fl.has('w') && !fl.has('c') ? String(lines).padStart(8)
      : fl.has('w') && !fl.has('l') && !fl.has('c') ? String(words).padStart(8)
      : fl.has('c') || fl.has('m') ? String(bytes).padStart(8)
      : `${String(lines).padStart(8)}${String(words).padStart(8)}${String(bytes).padStart(8)}`;
    /* combined flags print each column in l-w-c order, like the real wc */
    const multi = ['l', 'w', 'c'].filter(f => fl.has(f));
    const out = multi.length > 1
      ? `${String(lines).padStart(8)}${String(words).padStart(8)}${String(bytes).padStart(8)}`
      : label;
    ctx.out.push(`${out}${names.length ? ' ' + names.join(' ') : ''}\n`);
    return 0;
  } },
  { name: 'grep', run(args, ctx, t) {
    const fl = flagsOf(args);
    const rest = plain(args);
    if (!rest.length) throw new Error('usage: grep [-ivnclr] pattern [file…]');
    const [pattern, ...files] = rest;
    let re;
    try { re = new RegExp(pattern, fl.has('i') ? 'i' : ''); }
    catch { re = { test: line => line.includes(pattern) }; }
    const units = [];
    if (!files.length) units.push({ path: null, text: ctx.in ?? '' });
    else for (const f of files) {
      const p = fs.resolve(f, t.cwd);
      const node = fs.get(p);
      if (!node) { ctx.err.push(`grep: ${f}: No such file or directory\n`); continue; }
      if (node.type === 'dir') {
        if (!fl.has('r')) { ctx.err.push(`grep: ${f}: Is a directory\n`); continue; }
        for (const row of walkFs(node, f)) if (row.node.type !== 'dir') units.push({ path: row.path, text: row.node.content || '' });
      } else units.push({ path: files.length > 1 || fl.has('r') ? f : null, text: fs.readFile(p) });
    }
    let hits = 0;
    for (const u of units) {
      const lines = u.text.split('\n');
      let unitHit = 0;
      lines.forEach((line, i) => {
        if (i === lines.length - 1 && line === '') return;
        const matched = re.test(line);
        if (matched === fl.has('v')) return;
        unitHit++;
        if (!fl.has('c') && !fl.has('l')) ctx.out.push((u.path ? u.path + ':' : '') + (fl.has('n') ? `${i + 1}:` : '') + line + '\n');
      });
      if (fl.has('l') && unitHit) ctx.out.push((u.path || '(standard input)') + '\n');
      /* grep -c reports one count per file operand */
      if (fl.has('c')) ctx.out.push((u.path ? u.path + ':' : '') + unitHit + '\n');
      hits += unitHit;
    }
    return hits ? 0 : 1;
  } },
  { name: 'head', run(args, ctx, t) {
    const { count, files } = takeCount(args, 10);
    const { text } = t.readInput(files, ctx);
    /* a file of N lines prints N lines, not N and a blank one */
    const lines = text.replace(/\n$/, '').split('\n');
    ctx.out.push(lines.slice(0, count).join('\n') + '\n');
    return 0;
  } },
  { name: 'tail', run(args, ctx, t) {
    const follow = args.some(a => a === '-f' || a === '--follow') || flagsOf(args).has('f');
    const { count, files } = takeCount(args, 10);
    const { text } = t.readInput(files, ctx);
    const lines = text.replace(/\n$/, '').split('\n');
    ctx.out.push(lines.slice(Math.max(0, lines.length - count)).join('\n') + '\n');
    if (follow) {
      /* tail -f lives on fs:change: a write to the file shows up in the window */
      const p = fs.resolve(files[0] || '.', t.cwd);
      let seen = text.length;
      const off = on('fs:change', ({ path }) => {
        if (path !== p) return;
        try {
          const now = fs.readFile(p);
          if (now.length < seen) { seen = now.length; return; }
          if (now.length > seen) { t.printText(now.slice(seen)); seen = now.length; }
        } catch { /* file vanished */ }
      });
      t._offs.push(off);
      t.running = () => off();
      return -1;
    }
    return 0;
  } },
  { name: 'sort', run(args, ctx, t) {
    const fl = flagsOf(args);
    const { text } = t.readInput(plain(args), ctx);
    let lines = text.split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.sort(fl.has('n') ? (a, b) => parseFloat(a) - parseFloat(b) : (a, b) => a.localeCompare(b));
    if (fl.has('r')) lines.reverse();
    if (fl.has('u')) lines = [...new Set(lines)];
    ctx.out.push(lines.join('\n') + (lines.length ? '\n' : ''));
    return 0;
  } },
  { name: 'true', run() { return 0; } },
  { name: 'false', run() { return 1; } },
  { name: 'clear', run(args, ctx) { ctx.clear = true; return 0; } },
  { name: 'date', run(args, ctx) {
    const now = new Date();
    if (args.includes('-u')) {
      const u = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
      ctx.out.push(stamp(u, 'UTC') + '\n');
      return 0;
    }
    if (args.includes('-R')) { ctx.out.push(now.toString() + '\n'); return 0; }
    ctx.out.push(stamp() + '\n');
    return 0;
  } },
  { name: 'uname', run(args, ctx) {
    ctx.out.push(has(args, '-a') ? `Darwin ${state.settings.hostName.replace(/\s+/g, '-')}.local 24.1.0 Darwin Kernel Version 24.1.0 arm64\n` : 'Darwin\n');
    return 0;
  } },
  { name: 'history', run(args, ctx, t) {
    t.history.forEach((h, i) => ctx.out.push(String(i + 1).padStart(4) + '  ' + h + '\n'));
    return 0;
  } },
  { name: 'tree', run(args, ctx, t) {
    const root = fs.resolve(args[0] || '.', t.cwd);
    const node = fs.get(root);
    if (!node) throw new Error(`no such directory: ${args[0]}`);
    t.raw(esc(tildify(root)) + '\n', ctx);
    let dirs = 0, files = 0;
    const walk = (n, prefix) => {
      (n.children || []).forEach((c, i) => {
        const isLast = i === n.children.length - 1;
        t.raw(`<span class="dim">${esc(prefix + (isLast ? '└── ' : '├── '))}</span>${esc(c.name)}\n`, ctx);
        if (c.type === 'dir') { dirs++; walk(c, prefix + (isLast ? '    ' : '│   ')); } else files++;
      });
    };
    walk(node, '');
    t.raw(`<span class="dim">${dirs} directories, ${files} files</span>\n`, ctx);
    return 0;
  } },
  { name: 'sysinfo', run: sysinfo },
  { name: 'play', run(args, ctx, t) {
    if (!args.length) {
      player.toggle();
      ctx.out.push(player.playing ? `♪ ${player.track.title}\n` : 'paused\n');
      return 0;
    }
    const i = TRACKS.findIndex(tr => tr.title.toLowerCase().startsWith(args[0].toLowerCase()));
    if (i < 0) throw new Error(`no track named ${args[0]}`);
    player.select(i); player.play();
    ctx.out.push(`♪ ${player.track.title} — ${player.track.artist}\n`);
    return 0;
  } },
  { name: 'exit', run(args, ctx) { ctx.exit = true; return 0; } },
  { name: 'quit', run(args, ctx) { ctx.exit = true; return 0; } },
];

export default meta;
