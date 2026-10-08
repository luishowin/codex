// Extra shell commands: the parts of Terminal.app that feel like a real
// system — processes, network, git, editors and the usual UNIX tools.
import * as fs from '../core/fs.js';
import { MACHINE } from '../core/device.js';
import { state } from '../core/store.js';
import { esc, tildify, baseName, dirName } from '../core/util.js';
import { wm } from '../shell/wm.js';

/** "Sat Sep 26 02:05:16 IST 2026" — the exact shape `date` prints on macOS */
export function stamp(d = new Date(), tz) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  const z = tz || (() => { try { return d.toTimeString().match(/\((.*)\)/)[1].split(' ').map(w => w[0]).join('').toUpperCase(); } catch { return 'GMT'; } })();
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${z} ${d.getFullYear()}`;
}

/** turn a shell glob into a RegExp: * ? and [abc] all work */
export function globToRx(pat) {
  let rx = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') { rx += '.*'; continue; }
    if (c === '?') { rx += '.'; continue; }
    if (c === '[') {
      let j = i + 1;
      let neg = '';
      if (pat[j] === '!' || pat[j] === '^') { neg = '^'; j++; }
      if (pat[j] === ']') j++;
      while (j < pat.length && pat[j] !== ']') j++;
      if (j >= pat.length) { rx += '\\['; continue; }
      const inner = pat.slice(i + 1 + (neg ? 1 : 0), j);
      rx += `[${neg}${inner.replace(/([\\\]^])/g, '\\$1')}]`;
      i = j;
      continue;
    }
    rx += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp('^' + rx + '$');
}

/* every command name and its one-line description — help, man -k and
   apropos all read this, so a command without a line does not exist */
export const DESCRIBE = {
  alias: 'define or show aliases', apropos: 'search command descriptions', basename: 'print the last part of a path',
  brew: 'the missing package manager', cal: 'print this month\u2019s calendar', cat: 'print a file',
  cd: 'change directory', clear: 'wipe the scrollback', cp: 'copy a file', curl: 'fetch a URL',
  cut: 'cut columns of a line', date: 'print the date', defaults: 'read and write preferences', df: 'free disk space',
  dirname: 'print the directory part of a path', diskutil: 'disk utility', du: 'disk usage', echo: 'print text',
  env: 'print the environment', exit: 'close the window', export: 'share a variable with commands',
  false: 'fail politely', file: 'identify a file\u2019s type', find: 'find files', finger: 'user information',
  ftp: 'file transfer client', git: 'version control', grep: 'search text', groups: 'the groups you are in',
  head: 'first lines of a file', help: 'this list', history: 'the commands you ran', hostname: 'the machine\u2019s name',
  id: 'your uid and gids', jobs: 'background jobs in this shell', kill: 'signal a process', killall: 'signal by name',
  last: 'recent logins', less: 'page through text', lsof: 'list open files', ls: 'list directory',
  make: 'run a Makefile', man: 'manual pages', mdls: 'metadata about a file', mkdir: 'make a directory',
  more: 'page through text', mv: 'move or rename', nano: 'a gentle text editor', nc: 'netcat', nl: 'number lines',
  node: 'run JavaScript', nodejs: 'run JavaScript', npm: 'node package manager', open: 'open in an app',
  ping: 'bounce a packet off a host', play: 'play music', pmset: 'power management settings', printenv: 'print the environment', printf: 'print formatted',
  ps: 'process table', pwd: 'where you are', python: 'run Python', python3: 'run Python', quit: 'close the window',
  rev: 'reverse lines', rm: 'remove', say: 'speak', scp: 'copy over ssh', sed: 'stream editor', seq: 'print a sequence',
  sleep: 'wait a moment', sort: 'sort lines', ssh: 'remote login', stat: 'file details', sudo: 'run as root',
  sw_vers: 'macOS version', sysctl: 'kernel knobs', sysinfo: 'system details', system_profiler: 'hardware profile',
  tail: 'last lines of a file', tee: 'copy stdin to a file', top: 'live process table', touch: 'make or update a file', tr: 'translate characters',
  traceroute: 'the path packets take', tree: 'draw a directory tree', true: 'succeed', type: 'what is a command',
  unalias: 'remove an alias', uname: 'kernel name', uniq: 'deduplicate lines', unset: 'delete a variable',
  uptime: 'how long it has been up', vim: 'a demanding text editor', vimdiff: 'compare files', w: 'who is logged in',
  wc: 'count lines', which: 'where a command lives', whoami: 'who you are', xargs: 'build command lines', yes: 'yes',
};

/** the page `man` hands a command without a curated one — a real paragraph,
    not a shrug */
const SYNOPSIS = {
  alias: 'alias [name[=value] ...]', apropos: 'apropos keyword', basename: 'basename path [suffix]', cal: 'cal',
  cat: 'cat [file ...]', cd: 'cd [dir]', clear: 'clear', cp: 'cp [-R] source dest', curl: 'curl [-Iis] [-o file] url',
  cut: 'cut -d delim -f fields | -c list [file]', date: 'date [-u]', df: 'df [-h]', dirname: 'dirname path',
  du: 'du [-sh] [path]', echo: 'echo [-ne] [text ...]', env: 'env', export: 'export NAME=value', find: 'find [dir] [-name glob]',
  git: 'git init | status | add | commit | log', grep: 'grep [-ivnclr] pattern [file ...]', head: 'head [-n count | -count] [file]',
  jobs: 'jobs', kill: 'kill [-9] pid', killall: 'killall name', less: 'less [file]', ls: 'ls [-lahrtRF] [path ...]',
  man: 'man [-k] command', mkdir: 'mkdir [-p] dir', mv: 'mv source dest', nano: 'nano [file]', open: 'open [-a app] path | url',
  ping: 'ping [-c count] host', printf: 'printf format [arg ...]', ps: 'ps [aux]', pwd: 'pwd', rm: 'rm [-rf] path ...',
  say: 'say text', sed: 'sed [-i [ext]] script [file]', seq: 'seq [start] end', sleep: 'sleep seconds', sort: 'sort [-rnu] [file]',
  ssh: 'ssh host', sudo: 'sudo command', tail: 'tail [-n count | -count] [-f] [file]', tee: 'tee [-a] file ...',
  top: 'top', tr: 'tr a-z A-Z', tree: 'tree [dir]', unalias: 'unalias name', unset: 'unset name', vim: 'vim [file]',
  wc: 'wc [-lwc] [file]', which: 'which command', xargs: 'xargs [-nN] command', yes: 'yes [text]',
};
function manPage(name) {
  if (MANUAL[name]) return MANUAL[name];
  const d = DESCRIBE[name];
  if (!d) return null;
  return [
    `${name.toUpperCase()}(1)                 General Commands Manual                ${name.toUpperCase()}(1)`,
    '', 'NAME', `       ${name} — ${d}`, '', 'SYNOPSIS', `       ${SYNOPSIS[name] || name + ' [argument ...]'}`,
    '', 'DESCRIPTION', `       ${d.charAt(0).toUpperCase() + d.slice(1)}. This build of ${name} runs against`,
    '       the shared virtual filesystem, so it sees the same files every other',
    '       app sees.', '', 'macOS ' + MACHINE.version,
  ];
}

/* a pager: real scrolling keys, and q gives the terminal back */
export function pager(host, lines, title, t) {
  if (!host) return;
  host.replaceChildren();
  host.classList.add('term-pager');
  const bar = el_('div.pager-bar', { text: title });
  const body = el_('pre.pager-body');
  const hint = el_('div.pager-hint', { text: '↑↓ scroll   space page   q quit' });
  host.append(bar, body, hint);
  body.textContent = lines.join('\n');
  body.scrollTop = 0;
  const close = () => {
    if (!host.isConnected && !t.running) return;
    host.remove();
    window.removeEventListener('keydown', onKey, true);
    t.running = null;
    if (t.modal === 'pager') t.modal = null;
    t.afterAsync();
  };
  const onKey = e => {
    /* the window gets the keys when it is front — the shell input does not
       have to be the focused element for q to leave the pager */
    if (!t.isActive() || wm.focused !== t.win) return;
    const step = 22;
    const page = Math.max(60, body.clientHeight - 20);
    const k = e.key;
    if (k === 'q' || k === 'Q' || k === 'Escape' || (e.ctrlKey && k === 'c')) { close(); e.preventDefault(); return; }
    if (k === ' ' || k === 'PageDown') { body.scrollTop += page; e.preventDefault(); return; }
    if (k === 'PageUp') { body.scrollTop -= page; e.preventDefault(); return; }
    if (k === 'ArrowDown' || k === 'j') { body.scrollTop += step; e.preventDefault(); return; }
    if (k === 'ArrowUp' || k === 'k') { body.scrollTop -= step; e.preventDefault(); return; }
    if (k === 'g' || k === 'Home') { body.scrollTop = 0; e.preventDefault(); return; }
    if (k === 'G' || k === 'End') { body.scrollTop = body.scrollHeight; e.preventDefault(); return; }
    /* flag the keys this pager ate — closing on q clears t.modal before the
       same keydown reaches the shell input, and it must not land there */
    if (e.defaultPrevented) e.__termModalAte = true;
  };
  window.addEventListener('keydown', onKey, true);
  t.modal = 'pager';
  t.running = close;
}
const el_ = (sel, props, ...kids) => {
  const tag = sel.split('.')[0] || 'div';
  const node = document.createElement(tag);
  for (const c of sel.split('.').slice(1)) node.classList.add(c);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const k of kids) node.append(k);
  return node;
};

const pad = (s, n) => String(s).padStart(n, ' ');
const bytes = n => n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(1).replace(/\.0$/, '') + 'K' : (n / 1048576).toFixed(1).replace(/\.0$/, '') + 'M';
const dirBytes = node => {
  if (!node) return 0;
  if (node.type === 'file') return node.content?.length || 0;
  return 64 + (node.children || []).reduce((s, c) => s + dirBytes(c), 0);
};
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* when the fake machine booted — uptime, top and last all read this */
const BOOTED = Date.now();

const MANUAL = {
  ls: ['LS(1)                     General Commands Manual                    LS(1)', '', 'NAME', '       ls — list directory contents', '', 'SYNOPSIS', '       ls [-lahrtRF] [file ...]', '', 'DESCRIPTION', '       For each operand that names a directory, ls displays the names of', '       the files it contains. -l prints permissions, links, owner, size and', '       mtime. -a includes dot files. -R recurses. -t sorts by mtime, -r', '       reverses, -F marks directories, -h prints human sizes.', '', 'macOS ' + MACHINE.version],
  cd: ['CD(1)                     General Commands Manual                    CD(1)', '', 'NAME', '       cd — change the working directory', '', 'SYNOPSIS', '       cd [dir | -]', '', 'DESCRIPTION', '       cd with no argument goes to $HOME. cd - goes back to the directory', '       you came from. A bare name is tried under $CDPATH too.', '', 'macOS ' + MACHINE.version],
  echo: ['ECHO(1)                   General Commands Manual                   ECHO(1)', '', 'NAME', '       echo — write arguments to standard output', '', 'SYNOPSIS', '       echo [-n] [-e] [string ...]', '', 'DESCRIPTION', '       Writes its operands separated by spaces, then a newline. $VARIABLES', '       expand in double quotes and unquoted text; single quotes are literal.', '       -n drops the newline, -e honours \\n \\t \\r escapes.', '', 'macOS ' + MACHINE.version],
  cat: ['CAT(1)                    General Commands Manual                    CAT(1)', '', 'NAME', '       cat — concatenate and print files', '', 'SYNOPSIS', '       cat [file ...]', '', 'DESCRIPTION', '       Prints each file in order. With no file it reads stdin, so a pipe', '       into cat is a pass-through.', '', 'macOS ' + MACHINE.version],
  grep: ['GREP(1)                   General Commands Manual                   GREP(1)', '', 'NAME', '       grep — print lines matching a pattern', '', 'SYNOPSIS', '       grep [-ivnclr] pattern [file ...]', '', 'DESCRIPTION', '       -i ignores case, -v inverts, -n numbers, -c counts, -l lists files,', '       -r recurses into directories.', '', 'macOS ' + MACHINE.version],
  rm: ['RM(1)                     General Commands Manual                    RM(1)', '', 'NAME', '       rm — remove directory entries', '', 'SYNOPSIS', '       rm [-rf] file ...', '', 'DESCRIPTION', '       Removes files; -r recurses, -f never asks. rm of / is refused:', '       even as root, wiping the disk is not a thing this shell does.', '', 'macOS ' + MACHINE.version],
  man: ['MAN(1)                    General Commands Manual                    MAN(1)', '', 'NAME', '       man — format and display the on-line manual pages', '', 'SYNOPSIS', '       man [-k] name', '', 'DESCRIPTION', '       Displays the manual page for a command in a pager. -k searches', '       descriptions, exactly like apropos. q leaves the pager.', '', 'macOS ' + MACHINE.version],
  git: ['GIT(1)                    General Commands Manual                    GIT(1)', '', 'NAME', '       git — the stupid content tracker', '', 'SYNOPSIS', '       git init | status | add | commit | log', '', 'DESCRIPTION', '       A repository is a directory containing .git. status shows untracked', '       and modified files, add stages, commit -m records. Everything is kept', '       in the virtual filesystem, so a repo survives a reload.', '', 'macOS ' + MACHINE.version],
  vim: ['VIM(1)                    General Commands Manual                    VIM(1)', '', 'NAME', '       vim — Vi IMproved, a demanding text editor', '', 'SYNOPSIS', '       vim [file]', '', 'DESCRIPTION', '       Starts in normal mode: i inserts, Esc goes back, dd deletes a line,', '       gg and G jump to top and bottom, x deletes a character, :w writes,', '       :q quits, :wq writes and quits, :q! throws the buffer away.', '', 'macOS ' + MACHINE.version],
  nano: ['NANO(1)                   General Commands Manual                   NANO(1)', '', 'NAME', '       nano — a gentle text editor', '', 'SYNOPSIS', '       nano [file]', '', 'DESCRIPTION', '       Just type. ^O writes the file out, ^X leaves (asking first when the', '       buffer is dirty), and the shortcuts live in the hint bar at the bottom.', '', 'macOS ' + MACHINE.version],
  sudo: ['SUDO(8)                BSD System Manager’s Manual                 SUDO(8)', '', 'NAME', '       sudo — execute a command as another user', '', 'SYNOPSIS', '       sudo command', '', 'DESCRIPTION', '       Asks for your password, then runs the command as root. The password', '       is your username. The machine politely refuses to wipe itself.', '', 'macOS ' + MACHINE.version],
  ping: ['PING(8)                BSD System Manager’s Manual                 PING(8)', '', 'NAME', '       ping — send ICMP ECHO_REQUEST packets to a host', '', 'SYNOPSIS', '       ping [-c count] host', '', 'DESCRIPTION', '       Prints a reply line about once a second until Ctrl+C, then the', '       packet-loss summary. -c stops after that many packets.', '', 'macOS ' + MACHINE.version],
  top: ['TOP(1)                    General Commands Manual                    TOP(1)', '', 'NAME', '       top — display updated information about processes', '', 'SYNOPSIS', '       top [-l samples]', '', 'DESCRIPTION', '       Live rows for every window the shell can see, refreshed about once a', '       second. q leaves. -l prints a single sample and exits.', '', 'macOS ' + MACHINE.version],
  ps: ['PS(1)                     General Commands Manual                    PS(1)', '', 'NAME', '       ps — process status', '', 'SYNOPSIS', '       ps [aux]', '', 'DESCRIPTION', '       Each open window is a process, plus -zsh itself, launchd and the', '       WindowServer. kill and killall act on the pids it prints.', '', 'macOS ' + MACHINE.version],
  sed: ['SED(1)                   General Commands Manual                   SED(1)', '', 'NAME', '       sed — stream editor', '', 'SYNOPSIS', "       sed [-i [ext]] 's/old/new/[g]' [file]", '', 'DESCRIPTION', '       Applies a substitution to every line. -i edits files in place, with', '       an optional backup suffix just like the BSD sed.', '', 'macOS ' + MACHINE.version],
};

/* ── helpers used by several commands ─────────────────────────────────── */
const plainNames = args => args.filter(a => !a.startsWith('-'));
const without = (args, f) => args.filter(a => a !== f);
const nameOf = p => p.split('/').filter(Boolean).pop() || '/';
const dirOf = p => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
const hostOf = url => { try { return new URL(url).hostname; } catch { return url.replace(/^https?:\/\//, '').split('/')[0]; }; };
const flagsOf = args => new Set(args.filter(a => /^-[a-zA-Z]+$/.test(a)).flatMap(a => [...a.slice(1)]));
const flagVal = (args, name) => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-' + name) return args[i + 1];
    if (a.length > 2 && a.startsWith('-' + name)) return a.slice(2);
  }
  return undefined;
};
const BUILTINS = new Set(['cd', 'echo', 'export', 'unset', 'alias', 'unalias', 'history', 'pwd', 'exit', 'quit', 'help', 'true', 'false', 'jobs', 'printf', 'type', 'set', 'clear', 'read', 'test']);
const whichPath = name => BUILTINS.has(name) ? `${name}: shell built-in command` : `/usr/bin/${name}`;
function evalExpr(src) {
  /* console.log inside a -e script writes to the terminal, like a real node */
  const prints = [];
  const origLog = console.log;
  console.log = (...a) => prints.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' '));
  try {
    const fn = new Function(`"use strict";return (${src});`);
    const out = fn();
    return { ok: true, out, prints };
  } catch (err) {
    try {
      const fn = new Function(`"use strict";${src}`);
      const out = fn();
      return { ok: true, out, prints };
    } catch (err2) { return { ok: false, err: `${err2.name}: ${err2.message}`, prints }; }
  } finally {
    console.log = origLog;
  }
}

/* fs helpers for the git that lives in the virtual filesystem */
const walkFiles = (node, base, out = []) => {
  for (const c of node.children || []) {
    const p = base ? `${base}/${c.name}` : c.name;
    out.push({ node: c, path: p });
    if (c.type === 'dir') walkFiles(c, p, out);
  }
  return out;
};
const shortHash = () => Math.random().toString(16).slice(2, 9);

/* macOS cal, same seven-column layout */
function calendar() {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth();
  const title = `${monthNames[m]} ${y}`;
  const lines = [pad(title, Math.floor((20 + title.length) / 2)).trimStart().padStart(0), 'Su Mo Tu We Th Fr Sa'];
  /* centred, honestly */
  lines[0] = ' '.repeat(Math.max(0, Math.floor((20 - title.length) / 2))) + title;
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  let row = '   '.repeat(first);
  for (let dd = 1; dd <= days; dd++) {
    row += String(dd).padStart(2, ' ') + ' ';
    if ((first + dd) % 7 === 0) { lines.push(row.trimEnd()); row = ''; }
  }
  if (row.trim()) lines.push(row.trimEnd());
  /* today is reverse-video, like the real cal */
  const today = d.getDate();
  return lines.map(l => l.replace(new RegExp(`\\b${String(today).padStart(2, ' ')}\\b`), `\x1b[7m${String(today).padStart(2, ' ')}\x1b[0m`));
}

/* ── the table ───────────────────────────────────────────────────────── */
export const EXTRA_COMMANDS = [
  { name: 'env', run(args, ctx, t) {
    for (const [k, v] of t.envList) t.raw(`<span class="cmd">${esc(k)}</span>=${esc(v)}\n`, ctx);
    return 0;
  } },
  { name: 'printenv', run(args, ctx, t) {
    const names = plainNames(args);
    if (!names.length) return EXTRA_COMMANDS.find(c => c.name === 'env').run([], ctx, t);
    let code = 0;
    for (const n of names) {
      if (n in t.vars) ctx.out.push(t.vars[n] + '\n');
      else code = 1;
    }
    return code;
  } },
  { name: 'export', run(args, ctx, t) {
    const names = plainNames(args);
    if (!names.length) {
      for (const [k, v] of t.envList) t.raw(`<span class="dim">export</span> ${esc(k)}=${esc(JSON.stringify(v))}\n`, ctx);
      return 0;
    }
    for (const spec of names) {
      const eq = spec.indexOf('=');
      if (eq < 0) continue;
      t.vars[spec.slice(0, eq)] = spec.slice(eq + 1).replace(/^['"]|['"]$/g, '');
    }
    return 0;
  } },
  { name: 'unset', run(args, ctx, t) {
    for (const name of plainNames(args)) delete t.vars[name];
    return 0;
  } },
  { name: 'alias', run(args, ctx, t) {
    t._aliases = t._aliases || {};
    const names = args.filter(a => !a.startsWith('-'));
    if (!names.length) {
      for (const [k, v] of Object.entries(t._aliases)) t.raw(`<span class="dim">alias</span> ${esc(k)}=${esc(JSON.stringify(v))}\n`, ctx);
      return 0;
    }
    for (const spec of names) {
      const eq = spec.indexOf('=');
      if (eq < 0) { if (t._aliases[spec]) ctx.out.push(`${spec}='${t._aliases[spec]}'\n`); continue; }
      t._aliases[spec.slice(0, eq)] = spec.slice(eq + 1).replace(/^['"]|['"]$/g, '');
    }
    return 0;
  } },
  { name: 'unalias', run(args, ctx, t) {
    t._aliases = t._aliases || {};
    for (const n of plainNames(args)) delete t._aliases[n];
    return 0;
  } },
  { name: 'which', run(args, ctx, t) {
    let code = 0;
    for (const n of plainNames(args)) {
      /* aliases answer first: which knows what the shell would run */
      if (t.aliases[n]) { ctx.out.push(`${n}: aliased to ${t.aliases[n]}\n`); continue; }
      const hit = t.findCommand(n);
      if (!hit) { ctx.err.push(`${n} not found\n`); code = 1; continue; }
      ctx.out.push(whichPath(n) + '\n');
    }
    return code;
  } },
  { name: 'type', run(args, ctx, t) {
    let code = 0;
    for (const n of plainNames(args)) {
      if (t.aliases[n]) { ctx.out.push(`${n} is an alias for ${t.aliases[n]}\n`); continue; }
      const hit = t.findCommand(n);
      if (!hit) { ctx.err.push(`type: ${n} not found\n`); code = 1; continue; }
      if (BUILTINS.has(n)) ctx.out.push(`${n} is a shell builtin\n`);
      else ctx.out.push(`${n} is ${whichPath(n)}\n`);
    }
    return code;
  } },
  { name: 'find', run(args, ctx, t) {
    const names = plainNames(args);
    const dirArg = names[0] || '.';
    const nameIdx = args.findIndex(a => a === '-name' || a === '-iname');
    const typeIdx = args.findIndex(a => a === '-type');
    const pattern = nameIdx >= 0 ? args[nameIdx + 1] : null;
    const insensitive = args.includes('-iname');
    const typeWanted = typeIdx >= 0 ? args[typeIdx + 1] : null;
    const base = fs.resolve(dirArg, t.cwd);
    const node = fs.get(base);
    if (!node) throw new Error(`find: ${dirArg}: No such file or directory`);
    const shown = p => (dirArg === '.' ? './' : dirArg.endsWith('/') ? dirArg : dirArg + '/') + p;
    const rx = pattern ? new RegExp(globToRx(pattern.replace(/^['"]|['"]$/g, '')).source, insensitive ? 'i' : '') : null;
    if (node.type === 'dir') {
      /* find prints the directory itself when it matches */
      if (!rx || rx.test(node.name)) ctx.out.push((dirArg === '.' ? '.' : dirArg.replace(/\/$/, '')) + '\n');
      for (const { node: n, path } of walkFiles(node, '')) {
        if (rx && !rx.test(n.name)) continue;
        if (typeWanted === 'f' && n.type !== 'file') continue;
        if (typeWanted === 'd' && n.type !== 'dir') continue;
        ctx.out.push(shown(path) + '\n');
      }
    } else if (!rx || rx.test(node.name)) ctx.out.push(dirArg + '\n');
    return 0;
  } },
  { name: 'du', run(args, ctx, t) {
    const fl = flagsOf(args);
    const paths = plainNames(args);
    const targets = paths.length ? paths : ['.'];
    for (const a of targets) {
      const p = fs.resolve(a, t.cwd);
      const node = fs.get(p);
      if (!node) { ctx.err.push(`du: ${a}: No such file or directory\n`); continue; }
      ctx.out.push(`${fl.has('h') ? bytes(dirBytes(node)) : Math.ceil(dirBytes(node) / 512)}\t${a}\n`);
    }
    return 0;
  } },
  { name: 'df', run(args, ctx, t) {
    const used = fs.usedBytes();
    const total = 994662584 * 1024;
    if (args.includes('-h') || args.includes('-H')) {
      ctx.out.push('Filesystem      Size   Used  Avail Capacity iused ifree %iused  Mounted on\n');
      ctx.out.push(`/dev/disk3s1   ${(total / 1e9).toFixed(0)}Gi  ${(used / 1e9).toFixed(1)}Gi  ${((total - used) / 1e9).toFixed(0)}Gi     ${Math.max(1, Math.round(used / total * 100))}%  ${(used / 4096).toFixed(0)}k   15M   ${Math.max(1, Math.round(used / total * 100))}%   /\n`);
      return 0;
    }
    ctx.out.push(`Filesystem   512-blocks      Used Available Capacity iused ifree %iused  Mounted on\n/dev/disk3s1  1989325168 ${used >> 9} ${(total - used) >> 9}    ${Math.max(1, Math.round(used / total * 100))}% ${(used / 4096).toFixed(0)}k 15896541    ${Math.max(1, Math.round(used / total * 100))}%   /\n`);
    return 0;
  } },
  { name: 'ps', run(args, ctx, t) {
    const aux = args.includes('aux') || args.includes('-aux') || args.includes('ax') || args.includes('-u');
    const procs = t.processes();
    if (aux) {
      ctx.out.push('USER              PID  %CPU %MEM      VSZ    RSS   TT  STAT STARTED      TIME COMMAND\n');
      for (const p of procs) {
        const started = new Date(BOOTED + p.pid);
        const st = `${String(started.getHours()).padStart(2, '0')}:${String(started.getMinutes()).padStart(2, '0')}${started.getHours() < 12 ? 'AM' : 'PM'}`;
        ctx.out.push(`${(state.settings.userName).padEnd(12)} ${String(p.pid).padStart(5)} ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(4)} ${pad(410000 + p.pid * 40, 8)} ${pad(24000 + p.pid * 8, 7)} ${p.tty.padStart(4)}  ${p.stat.padEnd(4)} ${st.padStart(8)}   0:0${p.pid % 6}.${String(p.pid % 90).padStart(2, '0')} ${p.name}\n`);
      }
      return 0;
    }
    ctx.out.push('  PID TTY           TIME COMMAND\n');
    for (const p of procs.filter(x => x.win || x.self || x.job)) ctx.out.push(`${String(p.pid).padStart(5)} ${p.tty.padEnd(8)} 0:0${p.pid % 6}.${String(p.pid % 90).padStart(2, '0')} ${p.name}\n`);
    return 0;
  } },
  { name: 'top', run(args, ctx, t) {
    const once = args.includes('-l') || args.includes('-s');
    const host = t.openPager();
    const draw = () => {
      const used = fs.usedBytes();
      const load = t.topLoad();
      const rows = t.topRows();
      const widest = Math.max(...rows.map(r => r[1].length));
      const text = [
        `Processes: ${procs().length} total, ${rows.length - 1} running`,
        `Load Avg: ${load}   CPU usage: ${(Math.min(9, 1 + rows.length)).toFixed(1)}% user, ${(Math.min(8, rows.length)).toFixed(1)}% sys`,
        `PhysMem: ${(14 + (used >> 28) % 4)}G used (${(8 + (used >> 26) % 3)}G wired), ${(24 - (14 + (used >> 28) % 4))}G unused`,
        '',
        'PID   COMMAND'.padEnd(widest + 8) + ' %CPU  MEM    STATE',
        ...rows.slice(1).map(r => `${r[0]} ${r[1].padEnd(widest + 6)} ${r[2].padStart(4)}  ${r[3].padStart(5)}  ${r[4]}`),
      ];
      const bodyEl = host.querySelector('.pager-body');
      /* a clear or a closed tab can detach the host between ticks */
      if (!bodyEl) { clearTimeout(t.timer); return; }
      bodyEl.textContent = text.join('\n');
      host.querySelector('.pager-hint').textContent = 'live — updates every second — q quit';
    };
    /* top asks the pager machinery for a host, then draws into it itself */
    const bar = el_('div.pager-bar', { text: 'top' });
    const body = el_('pre.pager-body');
    const hint = el_('div.pager-hint', { text: 'live — updates every second — q quit' });
    host.classList.add('term-pager');
    host.append(bar, body, hint);
    function procs() { return t.processes(); }
    const cleanup = () => {
      clearTimeout(t.timer);
      window.removeEventListener('keydown', onKey, true);
      if (host.isConnected) host.remove();
      t.running = null;
      t.modal = null;
      t.afterAsync();
    };
    const onKey = e => {
      if (!t.isActive() || wm.focused !== t.win) return;
      if (e.key === 'q' || e.key === 'Q' || e.key === 'Escape' || (e.ctrlKey && e.key === 'c')) { cleanup(); e.preventDefault(); e.__termModalAte = true; return; }
      if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); e.__termModalAte = true; }
    };
    draw();
    if (once) { hint.textContent = ''; return 0; }
    window.addEventListener('keydown', onKey, true);
    t.modal = 'top';
    t.running = cleanup;
    const tick = () => { draw(); t.timer = setTimeout(tick, 1000); };
    t.timer = setTimeout(tick, 1000);
    return -1;
  } },
  { name: 'uptime', run(args, ctx, t) {
    const up = Math.floor((Date.now() - BOOTED) / 60000) || 0;
    const now = new Date();
    const hh = now.getHours() % 12 || 12;
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ap = now.getHours() < 12 ? 'AM' : 'PM';
    const span = up < 60 ? `${up} mins` : `${Math.floor(up / 60)}:${String(up % 60).padStart(2, '0')}`;
    ctx.out.push(`${hh}:${mm}${ap}  up ${span}  1 user, load averages: ${t.topLoad()}\n`);
    return 0;
  } },
  { name: 'sw_vers', run(args, ctx) {
    ctx.out.push(`ProductName:\t\t${MACHINE.os}\nProductVersion:\t\t${MACHINE.version}\nBuildVersion:\t\t${MACHINE.build}\n`);
    return 0;
  } },
  { name: 'sysctl', run(args, ctx, t) {
    const kv = { 'kern.osversion': MACHINE.build, 'hw.machine': 'arm64', 'hw.model': MACHINE.chip, 'hw.ncpu': '12', 'hw.memsize': '25769803776', 'kern.hostname': state.settings.hostName };
    const names = plainNames(args);
    if (!names.length) { for (const [k, v] of Object.entries(kv)) ctx.out.push(`${k}: ${v}\n`); return 0; }
    for (const n of names) ctx.out.push(kv[n] ? `${n}: ${kv[n]}\n` : `sysctl: unknown oid '${n}'\n`);
    return 0;
  } },
  { name: 'system_profiler', run(args, ctx, t) {
    ctx.out.push(`Hardware:\n\n    Hardware Overview:\n\n      Model Name: ${state.settings.hostName}\n      Chip: ${MACHINE.chip}\n      Total Number of Cores: 12\n      Memory: ${MACHINE.memory}\n      System Firmware Version: 10151.140.19\n      Serial Number: C02SPACE${(state.settings.userName.length * 7).toString(16).toUpperCase()}\n\n`);
    return 0;
  } },
  { name: 'cal', run(args, ctx) { ctx.out.push(calendar().join('\n') + '\n'); return 0; } },
  { name: 'say', run(args, ctx, t) {
    const text = plainNames(args).join(' ') || args.join(' ');
    if (!text) throw new Error('usage: say something');
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1; u.pitch = 1;
      speechSynthesis.speak(u);
      ctx.out.push('');
    } catch { ctx.err.push('say: speech synthesis is not available here\n'); }
    return 0;
  } },
  { name: 'ping', run(args, ctx, t) {
    const countIdx = args.indexOf('-c');
    const count = countIdx >= 0 ? Number(args[countIdx + 1]) || 4 : Infinity;
    const host = plainNames(args).find(a => a !== String(count));
    if (!host) throw new Error('usage: ping [-c count] host');
    ctx.out.push(`PING ${host} (${host === 'localhost' ? '127.0.0.1' : '17.253.144.10'}): 56 data bytes\n`);
    let seq = 0, got = 0, stopped = false;
    const finish = () => {
      stopped = true;
      clearTimeout(t.timer);
      const loss = seq ? Math.round((seq - got) / seq * 100) : 0;
      t.printText(`--- ${host} ping statistics ---\n${seq} packets transmitted, ${got} packets received, ${loss}.0% packet loss\nround-trip min/avg/max/stddev = 12.4/18.2/42.0/8.1 ms`);
      t.running = null;
      t.afterAsync();
    };
    const tick = () => {
      if (stopped) return;
      if (seq >= count) { finish(); return; }
      seq++;
      got++;
      const ms = (9 + Math.random() * 28).toFixed(3);
      t.printText(`64 bytes from ${host === 'localhost' ? '127.0.0.1' : '17.253.144.10'}: icmp_seq=${seq - 1} ttl=56 time=${ms} ms`);
      t.timer = setTimeout(tick, 700 + Math.random() * 500);
    };
    t.running = finish;
    t.timer = setTimeout(tick, 60);
    return -1;
  } },
  { name: 'curl', run(args, ctx, t) {
    let url = null, saveAs = null, showHead = false, headOnly = false;
    const names = plainNames(args);
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-o') { saveAs = args[i + 1]; continue; }
      if (a === '-O') { saveAs = '@base'; continue; }
      if (a === '-I') { headOnly = true; continue; }
      if (a === '-i' || a === '--include') { showHead = true; continue; }
      if (a === '-s' || a === '--silent' || a === '-v' || a === '-L') continue;
    }
    url = names[names.length - 1];
    if (!url) { ctx.err.push(`curl: try 'curl --help' for more information\n`); return 2; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (saveAs === '@base') { try { saveAs = baseName(new URL(url).pathname) || 'index.html'; } catch { saveAs = 'index.html'; } }
    t.fetchExternal(url, { method: headOnly ? 'HEAD' : 'GET', showHead: showHead || headOnly, headOnly, saveAs });
    return -1;
  } },
  { name: 'nc', run(args, ctx, t) {
    const host = plainNames(args)[0];
    if (!host) throw new Error('usage: nc host port');
    ctx.out.push(`nc: connectx to ${host} port ${plainNames(args)[1] || 80} (tcp) failed: Connection refused\n`);
    return 1;
  } },
  { name: 'sudo', run(args, ctx, t) {
    const rest = plainNames(args);
    if (!rest.length) { ctx.err.push('usage: sudo command\n'); return 1; }
    const line = rest.join(' ');
    /* the first `sudo rm -rf /` earns a warning; asking again runs it, and the
       rm itself still refuses to touch / — root or not, the disk survives */
    const deadly = /(?:^|\s)rm\s+(-[a-zA-Z]+\s+)*\/\s*$/.test(line);
    if (deadly && !t._sudoRmWarned) {
      t._sudoRmWarned = true;
      ctx.out.push(`sudo: running 'rm -rf /' would erase the whole disk.\n`);
      ctx.err.push(`sudo: refusing to run '${line}' this once — run it again if you really mean it\n`);
      return 1;
    }
    /* the password is the username; three wrong guesses and sudo walks away */
    let tries = 0;
    const ask = () => t.askPassword(`[sudo] password for ${t.vars.USER}:`).then(pw => {
      if (pw === null) { t.afterAsync(); return; }   /* ^C or focus lost: hand the prompt back */
      if (pw !== t.vars.USER) {
        tries++;
        if (tries >= 3) { t.printText('sudo: 3 incorrect password attempts', 'err'); t.afterAsync(); return; }
        t.printText('Sorry, try again.');
        ask();
        return;
      }
      t.runQuiet(line);
    });
    ask();
    return -1;
  } },
  { name: 'whoami', run(args, ctx, t) { ctx.out.push(t.vars.USER + '\n'); return 0; } },
  { name: 'id', run(args, ctx, t) {
    const u = t.vars.USER;
    ctx.out.push(`uid=501(${u}) gid=20(staff) groups=20(staff),12(everyone),61(localaccounts),79(_appserverusr),80(admin),81(_appserveradm),701(com.apple.sharepoint.group.1)\n`);
    return 0;
  } },
  { name: 'groups', run(args, ctx, t) { ctx.out.push('staff everyone localaccounts admin\n'); return 0; } },
  { name: 'hostname', run(args, ctx) { ctx.out.push(`${state.settings.hostName.replace(/\s+/g, '-')}.local\n`); return 0; } },
  { name: 'kill', run(args, ctx, t) {
    const pids = plainNames(args).filter(a => /^\d+$/.test(a));
    if (!pids.length) { ctx.err.push('usage: kill pid\n'); return 1; }
    const procs = t.processes();
    let code = 0;
    for (const pid of pids) {
      const proc = procs.find(p => p.pid === Number(pid));
      if (!proc) { ctx.err.push(`kill: ${pid}: No such process\n`); code = 1; continue; }
      if (proc.win) { wm.close(proc.win); ctx.out.push(`\x1b[2mkill: ${proc.name} (${proc.pid}) terminated\x1b[0m\n`); }
      else if (proc.job) { proc.job.stop(); t.dropBackground(proc.job); ctx.out.push(`[1]  + terminated  ${proc.name}\n`); }
      else if (proc.self) { wm.close(t.win); }
      else { ctx.err.push(`kill: ${pid}: Operation not permitted\n`); }
    }
    return code;
  } },
  { name: 'killall', run(args, ctx, t) {
    const name = plainNames(args)[0];
    if (!name) { ctx.err.push('usage: killall name\n'); return 1; }
    const hits = t.processes().filter(p => p.name.toLowerCase() === name.toLowerCase() || p.name.toLowerCase().startsWith(name.toLowerCase()));
    if (!hits.length) { ctx.err.push(`No matching processes belonging to you were found\n`); return 1; }
    for (const p of hits) {
      if (p.win) wm.close(p.win);
      else if (p.job) { p.job.stop(); t.dropBackground(p.job); }
      else if (p.self) wm.close(t.win);
    }
    return 0;
  } },
  { name: 'jobs', run(args, ctx, t) {
    const rows = t.trackedBackground();
    if (!rows.length) return 0;
    rows.forEach((tr, i) => ctx.out.push(`[${i + 1}]  ${i === rows.length - 1 ? '+' : '-'} running    ${tr.cmd}\n`));
    return 0;
  } },
  { name: 'tee', run(args, ctx, t) {
    const append = args.includes('-a');
    const data = ctx.in ?? '';
    for (const f of args.filter(a => !a.startsWith('-'))) {
      const p = fs.resolve(f, t.cwd);
      if (fs.exists(p)) { if (append) fs.appendFile(p, data); else fs.writeFile(p, data); }
      else fs.createFile(dirOf(p), nameOf(p), data);
    }
    ctx.out.push(data);
    return 0;
  } },
  { name: 'uniq', run(args, ctx, t) {
    const fl = flagsOf(args);
    const { text } = t.readInput(plainNames(args), ctx);
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const out = [];
    let count = 1;
    for (let i = 0; i < lines.length; i++) {
      if (i + 1 < lines.length && lines[i] === lines[i + 1]) { count++; continue; }
      if (!fl.has('d') || count > 1) out.push(fl.has('c') ? `${String(count).padStart(4)} ${lines[i]}` : lines[i]);
      count = 1;
    }
    ctx.out.push(out.join('\n') + (out.length ? '\n' : ''));
    return 0;
  } },
  { name: 'cut', run(args, ctx, t) {
    const delim = flagVal(args, 'd') || '\t';
    const field = flagVal(args, 'f');
    const chars = flagVal(args, 'c');
    /* files are the args that are neither flags nor the values flags took */
    const flagArgs = new Set([flagVal(args, 'd'), field, chars].filter(v => v !== undefined));
    const files = plainNames(args).filter(a => !flagArgs.has(a));
    const { text } = t.readInput(files, ctx);
    /* -f2, -f2-4, -f1,3 and -f3- are all legal */
    const pick = spec => i => String(spec).split(',').some(part => {
      const [a, b] = part.split('-').map(Number);
      const lo = (a || 1) - 1;
      const hi = part.includes('-') ? (Number.isNaN(b) ? Infinity : b - 1) : lo;
      return i >= lo && i <= hi;
    });
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const out = lines.map(line => {
      if (chars) {
        const inR = pick(chars);
        return line.split('').filter((_, i) => inR(i)).join('');
      }
      if (field == null) return line;
      const inR = pick(field);
      return line.split(delim).filter((_, i) => inR(i)).join(delim);
    });
    ctx.out.push(out.join('\n') + (out.length ? '\n' : ''));
    return 0;
  } },
  { name: 'tr', run(args, ctx, t) {
    const [from, to] = plainNames(args);
    if (!from) throw new Error('usage: tr a-z A-Z');
    const expandSet = s => {
      /* tr interprets \n \t \r \\ escapes in its SET arguments */
      s = s.replace(/\\([ntr\\])/g, (m, c) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\' }[c]));
      const out = [];
      for (let i = 0; i < s.length; i++) {
        if (s[i + 1] === '-' && s[i + 2] !== undefined) { for (let c = s.charCodeAt(i); c <= s.charCodeAt(i + 2); c++) out.push(String.fromCharCode(c)); i += 2; }
        else out.push(s[i]);
      }
      return out;
    };
    const fromSet = expandSet(from.replace(/^['"]|['"]$/g, ''));
    const toSet = to ? expandSet(to.replace(/^['"]|['"]$/g, '')) : [];
    const del = args.includes('-d');
    const lines = (ctx.in ?? '').split('\n');
    const mapped = lines.map(line => line.split('').map(c => {
      const i = fromSet.indexOf(c);
      if (i < 0) return c;
      if (del) return '';
      return toSet[Math.min(i, toSet.length - 1)] ?? c;
    }).join('')).join('\n');
    ctx.out.push(mapped.endsWith('\n') || ctx.in === '' ? mapped : mapped + '\n');
    return 0;
  } },
  { name: 'sed', run(args, ctx, t) {
    const isScript = a => /^s\W/.test(a) && /^s(.).+\1.*\1[gi]*$/.test(a);
    /* BSD sed: -i takes a mandatory backup extension ('' means none) */
    let inPlace = false, backupExt = null;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-i') {
        inPlace = true;
        const nx = args[i + 1];
        if (nx !== undefined && !nx.startsWith('-') && !isScript(nx)) { backupExt = nx || null; i++; }
        continue;
      }
      if (a.startsWith('-i') && a.length > 2) { inPlace = true; backupExt = a.slice(2); continue; }
      rest.push(a);
    }
    const script = rest.find(isScript);
    const files = rest.filter(a => !a.startsWith('-') && a !== script);
    if (!script) throw new Error('usage: sed [-i] s/a/b/[g] file');
    const m = script.match(/^s(.)(.*)\1(.*)\1([gi]*)$/);
    if (!m) throw new Error(`sed: bad script: ${script}`);
    const [, , pat, rep, gflags] = m;
    let re;
    try { re = new RegExp(pat, gflags.includes('g') ? 'g' : ''); } catch { throw new Error(`sed: bad pattern ${pat}`); }
    const apply = text => text.split('\n').map(l => l.replace(re, rep.replace(/&/g, '$&'))).join('\n');
    if (inPlace) {
      if (!files.length) { ctx.err.push('sed: no input files\n'); return 1; }
      let code = 0;
      for (const f of files) {
        const p = fs.resolve(f, t.cwd);
        if (!fs.get(p)) { ctx.err.push(`sed: ${f}: No such file or directory\n`); code = 1; continue; }
        const orig = fs.readFile(p);
        if (backupExt) { const bp = p + backupExt; if (fs.exists(bp)) fs.writeFile(bp, orig); else fs.createFile(dirOf(bp), nameOf(bp), orig); }
        fs.writeFile(p, apply(orig));
      }
      return code;
    }
    const { text } = files.length ? t.readInput(files, ctx) : { text: ctx.in ?? '' };
    ctx.out.push(apply(text));
    return 0;
  } },
  { name: 'xargs', run(args, ctx, t) {
    const joined = args.find(a => /^-n?\d+$/.test(a));
    const take = joined ? Number(joined.replace(/^-n?/, '')) : 0;
    const rest = args.filter(a => a !== joined);
    const items = (ctx.in || '').split(/\s+/).filter(Boolean);
    const n = take > 0 ? take : items.length || 1;
    if (rest.length) {
      /* with a command, run it once per chunk and splice the output together */
      for (let i = 0; i < items.length; i += n || items.length) {
        const argv = [...rest, ...items.slice(i, i + (n || items.length))];
        const sub = { in: '', out: [], err: [], exit: false, clear: false, tty: false };
        t.execCommand(argv, sub);
        ctx.out.push(...sub.out);
        ctx.err.push(...sub.err);
      }
      return 0;
    }
    const out = [];
    for (let i = 0; i < items.length; i += (n || 4)) out.push(items.slice(i, i + (n || 4)).join(' '));
    ctx.out.push(out.join('\n') + (out.length ? '\n' : ''));
    return 0;
  } },
  { name: 'seq', run(args, ctx) {
    const nums = plainNames(args).map(Number).filter(n => Number.isFinite(n));
    const step = nums.length > 2 ? nums[1] : 1;
    const end = nums.length > 1 ? nums[nums.length - 1] : nums[0];
    const start = nums.length > 1 ? nums[0] : 1;
    const out = [];
    for (let i = start; step > 0 ? i <= end : i >= end; i += step) out.push(i);
    ctx.out.push(out.join('\n') + (out.length ? '\n' : ''));
    return 0;
  } },
  { name: 'yes', run(args, ctx, t) {
    const word = plainNames(args).join(' ') || 'y';
    let n = 0;
    const pump = () => {
      if (!t.running) return;
      let chunk = '';
      for (let i = 0; i < 40; i++) { chunk += word + '\n'; n++; }
      t.printText(chunk);
      if (n > 20000) { t.running = null; t.afterAsync(); return; }
      t.timer = setTimeout(pump, 60);
    };
    t.running = () => { clearTimeout(t.timer); t.running = null; };
    t.timer = setTimeout(pump, 30);
    return -1;
  } },
  { name: 'sleep', run(args, ctx, t) {
    const secs = Number(plainNames(args)[0] || 1);
    t.running = () => { clearTimeout(t.timer); };
    t.timer = setTimeout(() => { t.running = null; t.afterAsync(); }, Math.min(secs, 30) * 1000);
    return -1;
  } },
  { name: 'basename', run(args, ctx) { ctx.out.push(nameOf(plainNames(args)[0] || '/') + '\n'); return 0; } },
  { name: 'dirname', run(args, ctx) { ctx.out.push(dirOf(plainNames(args)[0] || '/') + '\n'); return 0; } },
  { name: 'rev', run(args, ctx, t) {
    const { text } = args.length ? t.readInput(plainNames(args), ctx) : { text: ctx.in ?? '' };
    ctx.out.push(text.split('\n').map(l => [...l].reverse().join('')).join('\n'));
    return 0;
  } },
  { name: 'nl', run(args, ctx, t) {
    const { text } = args.length ? t.readInput(plainNames(args), ctx) : { text: ctx.in ?? '' };
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    ctx.out.push(lines.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n') + (lines.length ? '\n' : ''));
    return 0;
  } },
  { name: 'man', run(args, ctx, t) {
    const names = plainNames(args);
    if (args.includes('-k')) {
      const q = (names[0] || '').toLowerCase();
      const rows = Object.entries(DESCRIBE).filter(([n, d]) => !q || n.includes(q) || d.toLowerCase().includes(q));
      if (!rows.length) { ctx.out.push('nothing appropriate.\n'); return 1; }
      for (const [n, d] of rows) ctx.out.push(`${n}(1) - ${d}\n`);
      return 0;
    }
    const topic = names[0] || 'man';
    const rows = manPage(topic);
    if (!rows) { ctx.err.push(`No manual entry for ${topic}\n`); return 16; }
    /* piped man prints plain text; a real terminal gets the pager */
    if (!ctx.tty) { ctx.out.push(rows.join('\n') + '\n'); return 0; }
    pager(t.openPager(), rows, `${topic}(1)`, t);
    return -1;
  } },
  { name: 'apropos', run(args, ctx, t) {
    return EXTRA_COMMANDS.find(c => c.name === 'man').run(['-k', ...args], ctx, t);
  } },
  { name: 'less', run(args, ctx, t) {
    const { text } = args.length ? t.readInput(plainNames(args), ctx) : { text: ctx.in ?? '' };
    if (!ctx.tty) { ctx.out.push(text); return 0; }
    pager(t.openPager(), text.replace(/\n$/, '').split('\n'), args[0] || 'stdin', t);
    return -1;
  } },
  { name: 'more', run(args, ctx, t) {
    return EXTRA_COMMANDS.find(c => c.name === 'less').run(args, ctx, t);
  } },
  { name: 'nano', run(args, ctx, t) {
    const file = plainNames(args)[0];
    if (!file) { ctx.err.push('nano: needs a file\n'); return 1; }
    return t.editor(file, 'nano');
  } },
  { name: 'vim', run(args, ctx, t) {
    const file = plainNames(args)[0];
    if (!file) { ctx.err.push('vim: needs a file\n'); return 1; }
    return t.editor(file, 'vim');
  } },
  { name: 'node', run(args, ctx, t) {
    if (args.includes('-v') || args.includes('--version')) { ctx.out.push('v22.9.0\n'); return 0; }
    const eIdx = args.indexOf('-e');
    const src = eIdx >= 0 ? args[eIdx + 1] : plainNames(args)[0];
    if (!src) { ctx.out.push('Welcome to Node.js v22.9.0.\nType ".help" for more information.\n> '); return -1; }
    const { ok, out, err, prints = [] } = evalExpr(src.replace(/^['"]|['"]$/g, ''));
    for (const l of prints) ctx.out.push(l + '\n');
    if (!ok) ctx.err.push(`Uncaught ${err}\n`);
    else if (out !== undefined) ctx.out.push((typeof out === 'string' ? out : JSON.stringify(out, null, 2) ?? String(out)) + '\n');
    return ok ? 0 : 1;
  } },
  { name: 'nodejs', run(args, ctx, t) { return EXTRA_COMMANDS.find(c => c.name === 'node').run(args, ctx, t); } },
  { name: 'python3', run(args, ctx, t) {
    const cIdx = args.indexOf('-c');
    const src = cIdx >= 0 ? args[cIdx + 1] : plainNames(args)[0];
    if (!src) { ctx.out.push('Python 3.11.7 (main, Dec  4 2025) on darwin\nType "help" for more information.\n>>> '); return 0; }
    const clean = src.replace(/^['"]|['"]$/g, '');
    const printMatch = clean.match(/^print\((.*)\)$/s);
    const expr = printMatch ? printMatch[1] : clean;
    const { ok, out, err } = evalExpr(expr.replace(/(\d+)\s*\/\s*(\d+)/g, '($1/$2)'));
    if (!ok) { ctx.err.push(`Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\n${/^SyntaxError/.test(err) ? 'SyntaxError' : 'NameError'}: ${err}\n`); return 1; }
    /* python -c only prints what print() prints */
    if (printMatch) ctx.out.push((typeof out === 'string' ? out : String(out)) + '\n');
    return 0;
  } },
  { name: 'python', run(args, ctx, t) { return EXTRA_COMMANDS.find(c => c.name === 'python3').run(args, ctx, t); } },
  { name: 'git', run(args, ctx, t) {
    const sub = args[0];
    /* a repository is a directory containing .git, exactly like the real one.
       The index and history live in .git/db.json so they persist with the
       rest of the filesystem. */
    const dbFile = dir => dir + (dir === '/' ? '' : '/') + '.git/db.json';
    const readRepo = at => {
      try { return JSON.parse(fs.readFile(dbFile(at.dir))); }
      catch { return { branch: 'main', index: {}, commits: [] }; }
    };
    const writeRepo = (at, repo) => fs.writeFile(dbFile(at.dir), JSON.stringify(repo));
    const workTree = dir => {
      const out = {};
      for (const row of walkFiles(fs.get(dir), '')) {
        if (row.path.split('/')[0] === '.git') continue;
        if (row.node.type === 'file') out[row.path] = row.node.content || '';
      }
      return out;
    };
    if (sub === 'init') {
      if (fs.get(fs.resolve('.git', t.cwd))?.type === 'dir') { ctx.out.push(`Reinitialized existing Git repository in ${t.cwd}/.git/\n`); return 0; }
      const gd = t.cwd;
      fs.mkdir(gd, '.git');
      fs.mkdir(gd + '/.git', 'refs');
      fs.mkdir(gd + '/.git/refs', 'heads');
      fs.createFile(gd + '/.git', 'HEAD', 'ref: refs/heads/main\n');
      fs.createFile(gd + '/.git', 'db.json', JSON.stringify({ branch: 'main', index: {}, commits: [] }));
      ctx.out.push(`Initialized empty Git repository in ${t.cwd}/.git/\n`);
      return 0;
    }
    const at = t.gitRepo();
    if (!at) { ctx.err.push('fatal: not a git repository (or any of the parent directories): .git\n'); return 128; }
    const rel = p => p === at.dir ? '' : p.slice(at.dir.length + 1);
    const work = workTree(at.dir);
    if (sub === 'status' || sub === 's' || !sub) {
      const repo = readRepo(at);
      const head = repo.commits[0]?.tree || {};
      const staged = [], unstaged = [], untracked = [];
      const allPaths = [...new Set([...Object.keys(head), ...Object.keys(repo.index), ...Object.keys(work)])].sort();
      for (const p of allPaths) {
        const inHead = p in head, inIdx = p in repo.index, inWork = p in work;
        if (inIdx && (!inHead || repo.index[p] !== head[p])) staged.push(p);
        if (inIdx && inWork && work[p] !== repo.index[p]) unstaged.push(p);
        else if (inHead && inWork && work[p] !== head[p] && !inIdx) unstaged.push(p);
        else if (inHead && !inWork && !inIdx) unstaged.push(p);
        if (!inHead && !inIdx && inWork) untracked.push(p);
      }
      const lines = [`On branch ${repo.branch}`];
      if (!repo.commits.length) lines.push('', 'No commits yet');
      if (staged.length) {
        lines.push('', 'Changes to be committed:', '  (use "git restore --staged <file>..." to unstage)');
        for (const p of staged) lines.push(`\t${p in head ? 'modified' : 'new file'}:   ${p}`);
      }
      if (unstaged.length) {
        lines.push('', 'Changes not staged for commit:', '  (use "git add <file>..." to update what will be committed)');
        for (const p of unstaged) lines.push(`\tmodified:   ${p}`);
      }
      if (untracked.length) {
        lines.push('', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)');
        for (const p of untracked) lines.push(`\t${p}`);
      }
      if (!staged.length && !unstaged.length && !untracked.length) lines.push('', 'nothing to commit, working tree clean');
      else if (!staged.length) lines.push('', untracked.length ? 'nothing added to commit but untracked files present (use "git add" to track)' : 'no changes added to commit (use "git add" and/or "git commit -a")');
      ctx.out.push(lines.join('\n') + '\n');
      return 0;
    }
    if (sub === 'add' || sub === 'stage') {
      const targets = plainNames(args.slice(1));
      if (!targets.length) { ctx.err.push('Nothing specified, nothing added.\n'); return 1; }
      const repo = readRepo(at);
      for (const name of targets) {
        if (name === '.' || name === '-A' || name === '--all') {
          for (const [p, content] of Object.entries(work)) repo.index[p] = content;
          continue;
        }
        const p = fs.resolve(name, t.cwd);
        const node = fs.get(p);
        if (!node) { ctx.err.push(`fatal: pathspec '${name}' did not match any files\n`); return 128; }
        const rp = rel(p);
        if (node.type === 'dir') { for (const row of walkFiles(node, rp)) if (row.node.type === 'file' && !row.path.split('/')[0].includes('.git')) repo.index[row.path] = row.node.content || ''; }
        else repo.index[rp] = node.content || '';
      }
      writeRepo(at, repo);
      return 0;
    }
    if (sub === 'commit') {
      const mIdx = args.findIndex(a => a === '-m' || a === '--message');
      const msg = mIdx >= 0 ? args[mIdx + 1] : null;
      if (!msg) { ctx.err.push('Aborting commit due to empty commit message.\n'); return 1; }
      const repo = readRepo(at);
      const head = repo.commits[0]?.tree || {};
      const changed = Object.keys(repo.index).filter(p => head[p] !== repo.index[p]).length + Object.keys(head).filter(p => !(p in repo.index)).length;
      if (!changed && repo.commits.length) {
        ctx.out.push(`On branch ${repo.branch}\nnothing to commit, working tree clean\n`);
        return 0;
      }
      if (!Object.keys(repo.index).length) { ctx.err.push('On branch ' + repo.branch + '\n\nno changes added to commit\n'); return 1; }
      const hash = shortHash();
      repo.commits.unshift({ hash, msg: msg.replace(/^['"]|['"]$/g, ''), when: Date.now(), tree: { ...repo.index } });
      writeRepo(at, repo);
      const root = repo.commits.length === 1 ? ' (root-commit)' : '';
      ctx.out.push(`[${repo.branch}${root} ${hash}] ${msg.replace(/^['"]|['"]$/g, '')}\n ${changed} file${changed === 1 ? '' : 's'} changed\n`);
      return 0;
    }
    if (sub === 'log') {
      const repo = readRepo(at);
      if (!repo.commits.length) { ctx.out.push(`fatal: your current branch '${repo.branch}' does not have any commits yet\n`); return 128; }
      const lines = [];
      for (const c of repo.commits) {
        lines.push(`commit ${c.hash}${c === repo.commits[0] ? ` (HEAD -> ${repo.branch})` : ''}`,
          `Author: ${t.vars.USER} <${t.vars.USER}@${state.settings.hostName.replace(/\s+/g, '-').toLowerCase()}.local>`,
          `Date:   ${stamp(new Date(c.when))}`, '', `    ${c.msg}`, '');
      }
      if (!ctx.tty) { ctx.out.push(lines.join('\n') + '\n'); return 0; }
      pager(t.openPager(), lines, 'git log', t);
      return -1;
    }
    if (sub === 'diff') { ctx.out.push('diff --git a/work b/work\n'); return 0; }
    if (sub === 'branch') { ctx.out.push(`* ${readRepo(at).branch}\n`); return 0; }
    ctx.err.push(`git: '${sub}' is not a git command. See 'git --help'.\n`);
    return 1;
  } },
  { name: 'brew', run(args, ctx, t) {
    const sub = args[0];
    if (sub === 'install' || sub === 'add') {
      const name = plainNames(args.slice(1))[0];
      if (!name) { ctx.err.push('brew: needs a formula\n'); return 1; }
      const app = t.formulaToApp(name);
      if (app) {
        ctx.out.push(`==> Downloading https://formulae.brew.sh/api/formula/${name}.json\n==> Pouring ${name}--15.1.arm64_sequoia.bottle.tar.gz\n🍺  /Applications/${app.name}.app was successfully installed!\n`);
        t.launchApp(app.id);
        return 0;
      }
      ctx.err.push(`Warning: No available formula with the name "${name}".\n`);
      return 1;
    }
    if (sub === '--version') { ctx.out.push('Homebrew 4.4.3\n'); return 0; }
    ctx.out.push('Example usage:\n  brew install <formula>\n');
    return 0;
  } },
  { name: 'npm', run(args, ctx, t) {
    const sub = args[0];
    if (sub === '--version' || sub === '-v') { ctx.out.push('10.9.0\n'); return 0; }
    if (sub === 'run' || sub === 'test') { ctx.out.push(`> ${plainNames(args.slice(1))[0] || 'start'}\n> node index.js\n\nready in 142ms\n`); return 0; }
    if (sub === 'install' || sub === 'i') { ctx.out.push(`\nadded ${7 + (state.settings.userName.length % 5)} packages in ${(0.4 + Math.random()).toFixed(2)}s\n`); return 0; }
    ctx.out.push('npm <command>\n');
    return 0;
  } },
  { name: 'make', run(args, ctx, t) {
    const mk = fs.get(fs.resolve('Makefile', t.cwd)) || fs.get(fs.resolve('makefile', t.cwd));
    if (!mk) { ctx.err.push(`make: *** No targets specified and no makefile found.  Stop.\n`); return 2; }
    ctx.out.push(`cc -o main main.c\n`);
    return 0;
  } },
  { name: 'ssh', run(args, ctx, t) {
    const host = plainNames(args)[0];
    if (!host) { ctx.err.push('usage: ssh host\n'); return 1; }
    ctx.err.push(`ssh: connect to host ${host.includes('@') ? host.split('@')[1] : host} port 22: Connection refused\n`);
    return 1;
  } },
  { name: 'scp', run(args, ctx, t) {
    const names = plainNames(args);
    const remote = names.find(a => a.includes(':'));
    const host = remote ? remote.split(':')[0].split('@').pop() : 'remote';
    ctx.err.push(`ssh: connect to host ${host} port 22: Connection refused\nlost connection\n`);
    return 1;
  } },
  { name: 'ftp', run(args, ctx, t) {
    const host = plainNames(args)[0];
    if (!host) { ctx.err.push('usage: ftp host\n'); return 1; }
    ctx.err.push(`ftp: Can't connect to \`${host}': Connection refused\nftp: Can't connect or login to host \`${host}'\n`);
    return 1;
  } },
  { name: 'vimdiff', run(args, ctx, t) { ctx.out.push('2 files to edit\n'); return t.editor(plainNames(args)[0] || 'a.txt', 'vim'); } },
  { name: 'mdls', run(args, ctx, t) {
    const file = plainNames(args)[0];
    const p = fs.resolve(file || '.', t.cwd);
    const node = fs.get(p);
    if (!node) { ctx.err.push(`mdls: ${file}: No such file or directory\n`); return 1; }
    ctx.out.push(`kMDItemFSName = "${node.name}"\nkMDItemDisplayName = "${node.name}"\nkMDItemKind        = "${node.type === 'dir' ? 'Folder' : node.kind || 'Document'}"\nkMDItemContentModificationDate = ${new Date(node.modified || Date.now()).toISOString()}\n`);
    return 0;
  } },
  { name: 'stat', run(args, ctx, t) {
    const file = plainNames(args)[0];
    const p = fs.resolve(file || '.', t.cwd);
    const node = fs.get(p);
    if (!node) { ctx.err.push(`stat: ${file}: No such file or directory\n`); return 1; }
    const size = dirBytes(node);
    ctx.out.push(`  File: "${file || '.'}"\n  Size: ${size}\t\tBlocks: ${Math.ceil(size / 512)}\nType: ${node.type === 'dir' ? 'Directory' : 'Regular File'}\n`);
    return 0;
  } },
  { name: 'file', run(args, ctx, t) {
    for (const f of plainNames(args)) {
      const p = fs.resolve(f, t.cwd);
      const node = fs.get(p);
      if (!node) { ctx.out.push(`${f}: cannot open (No such file or directory)\n`); continue; }
      const kind = node.type === 'dir' ? 'directory' : node.kind === 'image' ? 'PNG image data' : node.kind === 'audio' ? 'Audio file' : node.kind === 'app' ? 'MacOS X application bundle' : /^[\x20-\x7e\s]*$/.test(node.content || '') ? 'ASCII text' : 'data';
      ctx.out.push(`${f}: ${kind}\n`);
    }
    return 0;
  } },
  { name: 'defaults', run(args, ctx, t) {
    const sub = args[0];
    if (sub === 'read') { ctx.out.push(`{\n    NSQuitAlwaysKeepsWindows = 0;\n    AppleShowAllExtensions = 1;\n    "com.apple.mouse.scaling" = "1.5";\n}\n`); return 0; }
    ctx.out.push('defaults read|write domain key\n');
    return 0;
  } },
  { name: 'pmset', run(args, ctx) {
    ctx.out.push(`System-wide power settings:\nCurrently in use:\n hibernatemode        0\n sleep                10\n displaysleep         10\n`);
    return 0;
  } },
  { name: 'lsof', run(args, ctx, t) {
    ctx.out.push('COMMAND  PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n');
    for (const [i, p] of t.processes().filter(p => p.win).entries()) ctx.out.push(`${p.name.slice(0, 9).padEnd(8)} ${String(p.pid).padStart(4)} ${t.vars.USER.padEnd(6)} cwd  DIR   1,4        640  ${4400 + i} ${t.cwd}\n`);
    return 0;
  } },
  { name: 'w', run(args, ctx, t) {
    const now = new Date();
    ctx.out.push(`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}  up ${Math.max(1, Math.floor((Date.now() - BOOTED) / 60000))} mins,  1 user, load averages: ${t.topLoad()}\nUSER     TTY      FROM              LOGIN@  IDLE WHAT\n${t.vars.USER.padEnd(8)} console  -                ${fmtLogin(BOOTED)}    -   -zsh\n`);
    return 0;
  } },
  { name: 'last', run(args, ctx, t) {
    ctx.out.push(`${t.vars.USER.padEnd(8)} console                   ${stamp(new Date(BOOTED)).replace(/ IST | GMT /, ' ')}   still logged in\n${t.vars.USER.padEnd(8)} ttys000                   ${stamp(new Date(BOOTED)).replace(/ IST | GMT /, ' ')}   still logged in\n\nwtmp begins ${stamp(new Date(BOOTED))}\n`);
    return 0;
  } },
  { name: 'finger', run(args, ctx, t) {
    ctx.err.push(`finger: ${plainNames(args)[0] || t.vars.USER}: no such user\n`);
    return 1;
  } },
  { name: 'traceroute', run(args, ctx, t) {
    const host = plainNames(args)[0] || 'localhost';
    const lines = [`traceroute to ${host} (17.253.144.10), 64 hops max, 52 byte packets`];
    for (let i = 1; i <= 4; i++) lines.push(` ${i}  ${['192.168.1.1', '10.0.0.1', '172.16.0.1', '17.253.144.10'][i - 1]}  ${(4 + i * 6 + Math.random() * 8).toFixed(2)} ms  ${(4 + i * 6 + Math.random() * 8).toFixed(2)} ms`);
    ctx.out.push(lines.join('\n') + '\n');
    return 0;
  } },
  { name: 'diskutil', run(args, ctx) {
    ctx.out.push(`/dev/disk3 (internal, physical):\n   #:                       TYPE NAME                    SIZE       IDENTIFIER\n   0:      GUID_partition_scheme                        *1.0 TB     disk3\n   1:             Apple_APFS_ISC ⁄                        2.5 GB     disk3s1\n   2:                 Apple_APFS Container disk4         995.0 GB   disk3s2\n`);
    return 0;
  } },
  { name: 'open', run(args, ctx, t) {
    const aIdx = args.indexOf('-a');
    if (aIdx >= 0) {
      const appName = args.slice(aIdx + 1).join(' ');
      const app = t.findInstalledByName(appName);
      if (!app) { ctx.err.push(`The application ${appName} does not exist.\n`); return 1; }
      t.launchApp(app.id);
      return 0;
    }
    const target = plainNames(args)[0];
    if (!target) { ctx.err.push('The file  does not exist.\n'); return 1; }
    if (/^https?:\/\//i.test(target)) { t.openURL(target); return 0; }
    const p = fs.resolve(target, t.cwd);
    const node = fs.get(p);
    if (!node) { ctx.err.push(`The file ${p} does not exist.\n`); return 1; }
    t.revealInApp(p, node);
    return 0;
  } },
];

const fmtLogin = ts => {
  const d = new Date(ts);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
