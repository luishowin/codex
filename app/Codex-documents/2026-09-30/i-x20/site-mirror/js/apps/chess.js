// Chess: a real game — legal moves with castling, en passant and promotion,
// check/checkmate/stalemate detection, a small minimax opponent, a move list,
// captured tray, undo and board flip. The position persists between launches.
import { el } from '../core/util.js';
import { wm } from '../shell/wm.js';
import { state, save } from '../core/store.js';
import { notify } from '../shell/notify.js';

/* the drawn Chess icon: dark tile with a knight silhouette */
const CHESS_ICON = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="chbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf6ec"/><stop offset="1" stop-color="#e9dcc4"/></linearGradient><linearGradient id="chn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b4636"/><stop offset="1" stop-color="#33251b"/></linearGradient></defs><rect x="5" y="5" width="90" height="90" rx="23" fill="url(#chbg)"/><rect x="5.5" y="5.5" width="89" height="89" rx="22.5" fill="none" stroke="#000" stroke-opacity=".13"/><g fill="url(#chn)"><path d="M62 84 60 76c7-3 12-9 12-17 0-4-1.4-8-3.6-11L61 38.6c-.8-1.2-.5-2.8.7-3.6l2.8-1.8c1-.7 1.6-1.8 1.6-3V27c0-1.6-1.3-3-3-3h-2.2c-.9 0-1.7.4-2.3 1L37 44c-4.4 4-6.8 9.4-6.8 15.1V68c0 2.2 1.8 4 4 4h4v6c0 3.3 2.7 6 6 6h14c2.2 0 3.8-2.2 3.8-4.4z"/><rect x="30" y="76" width="40" height="8" rx="2"/></g><circle cx="49" cy="32" r="2.4" fill="#fbf6ec"/></svg>`;

const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
const START = [
  ['bR', 'bN', 'bB', 'bQ', 'bK', 'bB', 'bN', 'bR'],
  ['bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP'],
  [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
  ['wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP'],
  ['wR', 'wN', 'wB', 'wQ', 'wK', 'wB', 'wN', 'wR'],
];
const files = 'abcdefgh';
const sq = (r, c) => files[c] + (8 - r);
const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

/* ── rules ────────────────────────────────────────────────────────────── */
function clone(b) { return b.map(r => r.slice()); }
function kingPos(b, col) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    if (b[r][c] === col + 'K') return [r, c];
  return null;
}
function attacked(b, r, c, by) {
  /* is square r,c attacked by colour `by`? */
  const dir = by === 'w' ? 1 : -1;
  for (const dc of [-1, 1])
    if (inside(r + dir, c + dc) && b[r + dir][c + dc] === by + 'P') return true;
  for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]])
    if (inside(r + dr, c + dc) && b[r + dr][c + dc] === by + 'N') return true;
  for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]])
    if (inside(r + dr, c + dc) && b[r + dr][c + dc] === by + 'K') return true;
  for (const [dr, dc, types] of [
    [-1, 0, 'RQ'], [1, 0, 'RQ'], [0, -1, 'RQ'], [0, 1, 'RQ'],
    [-1, -1, 'BQ'], [-1, 1, 'BQ'], [1, -1, 'BQ'], [1, 1, 'BQ'],
  ]) {
    for (let i = 1; i < 8; i++) {
      const rr = r + dr * i, cc = c + dc * i;
      if (!inside(rr, cc)) break;
      const p = b[rr][cc];
      if (p) { if (p[0] === by && types.includes(p[1])) return true; break; }
    }
  }
  return false;
}
function pseudo(b, r, c, g) {
  /* pseudo-legal moves for the piece on r,c */
  const p = b[r][c]; if (!p) return [];
  const [col, t] = p;
  const out = [];
  const push = (rr, cc, extra) => { if (inside(rr, cc)) { const q = b[rr][cc]; if (!q || q[0] !== col) out.push({ from: [r, c], to: [rr, cc], piece: t, cap: q ? q[1] : 0, ...extra }); } };
  if (t === 'P') {
    const d = col === 'w' ? -1 : 1, home = col === 'w' ? 6 : 1, last = col === 'w' ? 0 : 7;
    if (!b[r + d]?.[c]) {
      push(r + d, c, { promo: r + d === last });
      if (r === home && !b[r + 2 * d][c]) push(r + 2 * d, c, { double: true });
    }
    for (const dc of [-1, 1]) {
      const rr = r + d, cc = c + dc;
      if (!inside(rr, cc)) continue;
      if (b[rr][cc] && b[rr][cc][0] !== col) push(rr, cc, { promo: rr === last });
      if (g.ep && g.ep[0] === rr && g.ep[1] === cc) out.push({ from: [r, c], to: [rr, cc], piece: 'P', cap: 'P', ep: true });
    }
  } else if (t === 'N') {
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) push(r + dr, c + dc);
  } else if (t === 'K') {
    for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) push(r + dr, c + dc);
    const enemy = col === 'w' ? 'b' : 'w';
    const home = col === 'w' ? 7 : 0;
    if (r === home && c === 4 && !attacked(b, home, 4, enemy)) {
      if (g.castle?.[col + 'K'] && !b[home][5] && !b[home][6] && b[home][7] === col + 'R' &&
        !attacked(b, home, 5, enemy) && !attacked(b, home, 6, enemy))
        out.push({ from: [r, c], to: [home, 6], piece: 'K', castle: 'K' });
      if (g.castle?.[col + 'Q'] && !b[home][3] && !b[home][2] && !b[home][1] && b[home][0] === col + 'R' &&
        !attacked(b, home, 3, enemy) && !attacked(b, home, 2, enemy))
        out.push({ from: [r, c], to: [home, 2], piece: 'K', castle: 'Q' });
    }
  } else {
    const dirs = t === 'R' ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
      : t === 'B' ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
        : [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, dc] of dirs)
      for (let i = 1; i < 8; i++) {
        const rr = r + dr * i, cc = c + dc * i;
        if (!inside(rr, cc)) break;
        if (!b[rr][cc]) { out.push({ from: [r, c], to: [rr, cc], piece: t }); continue; }
        if (b[rr][cc][0] !== col) out.push({ from: [r, c], to: [rr, cc], piece: t, cap: b[rr][cc][1] });
        break;
      }
  }
  return out;
}
function apply(b, m, promo) {
  const nb = clone(b);
  const [fr, fc] = m.from, [tr, tc] = m.to;
  const p = nb[fr][fc];
  nb[fr][fc] = 0;
  if (m.ep) nb[fr][tc] = 0;
  nb[tr][tc] = m.promo ? p[0] + (promo || 'Q') : p;
  if (m.castle === 'K') { nb[tr][5] = nb[tr][7]; nb[tr][7] = 0; }
  if (m.castle === 'Q') { nb[tr][3] = nb[tr][0]; nb[tr][0] = 0; }
  return nb;
}
function legalMoves(g, col) {
  const out = [];
  const enemy = col === 'w' ? 'b' : 'w';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = g.board[r][c];
    if (!p || p[0] !== col) continue;
    for (const m of pseudo(g.board, r, c, g)) {
      const nb = apply(g.board, m, m.promo ? 'Q' : undefined);
      const kp = kingPos(nb, col);
      if (kp && !attacked(nb, kp[0], kp[1], enemy)) out.push(m);
    }
  }
  return out;
}
const inCheck = (g, col) => {
  const kp = kingPos(g.board, col);
  return kp && attacked(g.board, kp[0], kp[1], col === 'w' ? 'b' : 'w');
};
const insufficient = b => {
  const rest = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = b[r][c];
    if (p && p[1] !== 'K') rest.push(p[1]);
  }
  return rest.length === 0 || (rest.length === 1 && 'BN'.includes(rest[0]));
};

/* SAN-ish notation */
function san(g, m, promo, mates) {
  if (m.castle === 'K') return 'O-O' + mates;
  if (m.castle === 'Q') return 'O-O-O' + mates;
  let s = '';
  if (m.piece !== 'P') {
    s += m.piece;
    const rivals = legalMoves(g, g.board[m.from[0]][m.from[1]][0])
      .filter(x => x.piece === m.piece && x.to[0] === m.to[0] && x.to[1] === m.to[1] &&
        (x.from[0] !== m.from[0] || x.from[1] !== m.from[1]));
    if (rivals.length) {
      if (!rivals.some(x => x.from[1] === m.from[1])) s += files[m.from[1]];
      else if (!rivals.some(x => x.from[0] === m.from[0])) s += 8 - m.from[0];
      else s += sq(m.from[0], m.from[1]);
    }
  }
  if (m.cap) s += (m.piece === 'P' ? files[m.from[1]] : '') + 'x';
  s += sq(m.to[0], m.to[1]);
  if (m.promo) s += '=' + (promo || 'Q');
  return s + mates;
}

/* ── engine: depth-2 minimax, material + light positional score ───────── */
const PST_P = [0, 5, 10, 20, 20, 10, 5, 0];
function evalB(b) {
  let s = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = b[r][c]; if (!p) continue;
    let v = VAL[p[1]];
    if (p[1] === 'P') v += PST_P[Math.abs(7 - c)] * 0 + (p[0] === 'w' ? (6 - r) * 6 : (r - 1) * 6);
    if (p[1] === 'N' || p[1] === 'B') v += (3.5 - Math.abs(3.5 - r)) * 4 + (3.5 - Math.abs(3.5 - c)) * 4;
    s += p[0] === 'w' ? -v : v;
  }
  return s;
}
function search(g, col, depth, alpha, beta) {
  const moves = legalMoves(g, col);
  if (!moves.length) return inCheck(g, col) ? (col === 'b' ? -100000 - depth : 100000 + depth) : 0;
  if (depth === 0) return evalB(g.board);
  moves.sort((a, b2) => (VAL[b2.cap] || 0) - (VAL[a.cap] || 0));
  let best = col === 'b' ? -Infinity : Infinity;
  const next = col === 'b' ? 'w' : 'b';
  for (const m of moves) {
    const nb = apply(g.board, m, 'Q');
    const ng = { board: nb, castle: nextCastle(g, m), ep: m.double ? [m.from[0] + (col === 'w' ? -1 : 1), m.from[1]] : null };
    const v = search(ng, next, depth - 1, alpha, beta);
    if (col === 'b') { best = Math.max(best, v); alpha = Math.max(alpha, v); }
    else { best = Math.min(best, v); beta = Math.min(beta, v); }
    if (beta <= alpha) break;
  }
  return best;
}
function nextCastle(g, m) {
  const c = { ...g.castle };
  const p = g.board[m.from[0]][m.from[1]];
  if (p?.[1] === 'K') { c[p[0] + 'K'] = false; c[p[0] + 'Q'] = false; }
  if (p?.[1] === 'R') {
    const home = p[0] === 'w' ? 7 : 0;
    if (m.from[0] === home && m.from[1] === 0) c[p[0] + 'Q'] = false;
    if (m.from[0] === home && m.from[1] === 7) c[p[0] + 'K'] = false;
  }
  for (const [sqR, sqC, k] of [[0, 0, 'bQ'], [0, 7, 'bK'], [7, 0, 'wQ'], [7, 7, 'wK']])
    if (m.to[0] === sqR && m.to[1] === sqC) c[k] = false;
  return c;
}
function engineMove(g) {
  const moves = legalMoves(g, 'b');
  if (!moves.length) return null;
  let best = -Infinity, picks = [];
  for (const m of moves) {
    const nb = apply(g.board, m, 'Q');
    const ng = { board: nb, castle: nextCastle(g, m), ep: m.double ? [m.from[0] + 1, m.from[1]] : null };
    const v = search(ng, 'w', 1, -Infinity, Infinity) + (Math.random() * 8 - 4);
    if (v > best + 0.01) { best = v; picks = [m]; }
    else if (Math.abs(v - best) <= 0.01) picks.push(m);
  }
  return picks[Math.floor(Math.random() * picks.length)];
}

/* ── app ──────────────────────────────────────────────────────────────── */
const freshGame = () => ({ board: START.map(r => r.slice()), turn: 'w', castle: { wK: true, wQ: true, bK: true, bQ: true }, ep: null, moves: [], caps: [], over: null, flipped: false });
const loadGame = () => state.settings.chessGame || freshGame();
const persist = g => { state.settings.chessGame = g; save(); };

const meta = {
  id: 'chess', name: 'Chess', icon: CHESS_ICON, dock: false,
  menus: () => {
    const ch = wm.byApp('chess')[0]?._ch;
    return [
      { title: 'Game', items: () => [
        { label: 'New Game', key: '⌘N', action: () => ch?.newGame() },
        { label: 'Take Back Move', key: '⌘Z', disabled: !ch?.g.moves.length, action: () => ch?.undo() },
        { type: 'sep' },
        { label: 'Flip Board', action: () => ch?.flip() },
        { type: 'sep' },
        { label: 'Close', key: '⌘W', action: () => { const w = wm.byApp('chess')[0]; w && wm.close(w); } },
      ] },
    ];
  },
  launch() {
    const existing = wm.byApp('chess').find(w => w.state !== 'min') || wm.byApp('chess')[0];
    if (existing) { wm.show(existing); return existing; }
    return wm.open({
      app: 'chess', key: 'main', title: 'Chess',
      width: 780, height: 560, minWidth: 640, minHeight: 480,
      build: win => new ChessUI(win).mount(),
      onClose: win => win._ch?.unmount(),
    });
  },
};

class ChessUI {
  constructor(win) {
    this.win = win;
    this.g = loadGame();
    this.sel = null;
    this.thinking = false;
    this.promoPick = null;
  }
  mount() {
    this.win._ch = this;
    this.root = el('div.ch-root', null,
      el('div.ch-boardwrap', null, this.board = el('div.ch-board')),
      el('aside.ch-side', null,
        el('div.ch-player.top', { dataset: { side: 'b' } },
          el('b', { text: 'Computer' }), this.capW = el('span.ch-caps')),
        el('div.ch-moves-wrap', null,
          el('div.ch-moves-t', { text: 'Moves' }),
          this.movelist = el('div.ch-moves scroll')),
        this.status = el('div.ch-status'),
        el('div.ch-player.bot', { dataset: { side: 'w' } },
          el('b', { text: 'You' }), this.capB = el('span.ch-caps')),
        el('div.ch-btns', null,
          el('button.ch-btn', { text: 'New Game', onclick: () => this.newGame() }),
          el('button.ch-btn', { text: 'Undo', onclick: () => this.undo() }),
          el('button.ch-btn', { text: 'Flip', onclick: () => this.flip() }))));
    this.win.body.append(this.root);
    this.paint();
    if (this.g.turn === 'b' && !this.g.over) this.engine();
  }
  unmount() { persist(this.g); }

  paint() {
    const g = this.g;
    const b = this.board;
    b.replaceChildren();
    const flip = g.flipped;
    const legal = this.sel ? legalMoves(g, g.turn).filter(m => m.from[0] === this.sel[0] && m.from[1] === this.sel[1]) : [];
    const last = g.moves[g.moves.length - 1]?.m;
    const checkCol = inCheck(g, g.turn) ? g.turn : null;
    const kp = checkCol ? kingPos(g.board, checkCol) : null;
    for (let vr = 0; vr < 8; vr++) for (let vc = 0; vc < 8; vc++) {
      const r = flip ? 7 - vr : vr, c = flip ? 7 - vc : vc;
      const p = g.board[r][c];
      const sqEl = el('div.ch-sq' + ((r + c) % 2 ? '.dk' : '.lt'), { dataset: { r, c } });
      if (this.sel && this.sel[0] === r && this.sel[1] === c) sqEl.classList.add('sel');
      if (last && ((last.from[0] === r && last.from[1] === c) || (last.to[0] === r && last.to[1] === c))) sqEl.classList.add('last');
      if (kp && kp[0] === r && kp[1] === c) sqEl.classList.add('check');
      const hit = legal.find(m => m.to[0] === r && m.to[1] === c);
      if (hit) sqEl.classList.add(hit.cap ? 'cap' : 'dot');
      if (vc === 0) sqEl.append(el('span.ch-rank', { text: String(8 - r) }));
      if (vr === 7) sqEl.append(el('span.ch-file', { text: files[c] }));
      if (p) sqEl.append(el('span.ch-pc.' + p[0], { text: GLYPH[p[1]] }));
      sqEl.addEventListener('click', () => this.tap(r, c));
      b.append(sqEl);
    }
    this.paintSide();
  }
  paintSide() {
    const g = this.g;
    /* captured pieces by colour captured-from */
    const capsW = g.caps.filter(x => x.col === 'w').map(x => x.p);
    const capsB = g.caps.filter(x => x.col === 'b').map(x => x.p);
    const diff = capsW.reduce((s, p) => s + VAL[p], 0) - capsB.reduce((s, p) => s + VAL[p], 0);
    /* the player who has taken more material shows the +n */
    this.capW.textContent = capsW.map(p => GLYPH[p]).join(' ') + (diff > 0 ? ` +${diff / 100}` : '');
    this.capB.textContent = capsB.map(p => GLYPH[p]).join(' ') + (diff < 0 ? ` +${-diff / 100}` : '');
    const rows = [];
    for (let i = 0; i < g.moves.length; i += 2) {
      rows.push(el('div.ch-mv', null,
        el('span.ch-n', { text: `${i / 2 + 1}.` }),
        el('span', { text: g.moves[i].san }),
        el('span', { text: g.moves[i + 1]?.san || '' })));
    }
    this.movelist.replaceChildren(...rows);
    this.movelist.scrollTop = this.movelist.scrollHeight;
    this.status.textContent =
      g.over === 'checkmate' ? (g.turn === 'w' ? 'Checkmate — Computer wins' : 'Checkmate — You win') :
        g.over === 'stalemate' ? 'Stalemate — Draw' :
          g.over === 'material' ? 'Draw — Insufficient Material' :
            inCheck(g, g.turn) ? 'Check' :
              this.thinking ? 'Computer is thinking…' : '';
  }

  tap(r, c) {
    const g = this.g;
    if (g.over || this.thinking || this.promoPick) return;
    if (g.turn !== 'w') return;
    const p = g.board[r][c];
    if (this.sel) {
      const moves = legalMoves(g, 'w').filter(m => m.from[0] === this.sel[0] && m.from[1] === this.sel[1] && m.to[0] === r && m.to[1] === c);
      if (moves.length) {
        const m = moves[0];
        if (m.promo) return this.pickPromo(m);
        return this.doMove(m);
      }
    }
    this.sel = p && p[0] === 'w' ? [r, c] : null;
    this.paint();
  }
  pickPromo(m) {
    const sqEl = this.board.children[(this.g.flipped ? 7 - m.to[0] : m.to[0]) * 8 + (this.g.flipped ? 7 - m.to[1] : m.to[1])];
    const menu = el('div.ch-promo');
    for (const t of ['Q', 'R', 'B', 'N'])
      menu.append(el('button', { text: GLYPH[t], onclick: () => { this.promoPick = null; menu.remove(); this.doMove(m, t); } }));
    this.promoPick = menu;
    sqEl.append(menu);
    menu.addEventListener('mouseleave', () => { if (this.promoPick === menu) { this.promoPick = null; menu.remove(); } });
  }
  doMove(m, promo) {
    const g = this.g;
    const snap = { m, promo, castle: { ...g.castle }, ep: g.ep ? g.ep.slice() : null };
    const capSq = m.ep ? [m.from[0], m.to[1]] : m.to;
    const capPc = g.board[capSq[0]][capSq[1]];
    g.board = apply(g.board, m, promo);
    g.castle = nextCastle(g, m);
    g.ep = m.double ? [(m.from[0] + m.to[0]) / 2, m.from[1]] : null;
    g.turn = g.turn === 'w' ? 'b' : 'w';
    const mate = this.checkEnd(g);
    const s = san({ board: undoBoard(g), castle: snap.castle, ep: snap.ep }, m, promo, mate === 'checkmate' ? '#' : mate === 'check' ? '+' : '');
    g.moves.push({
      m, promo, san: s,
      board: g.board.map(r => r.slice()),
      castleAfter: { ...g.castle },
      epAfter: g.ep ? g.ep.slice() : null,
    });
    if (capPc) g.caps.push({ p: capPc[1], col: capPc[0] });
    this.sel = null;
    persist(g);
    this.paint();
    if (!g.over && g.turn === 'b') this.engine();
  }
  checkEnd(g) {
    const moves = legalMoves(g, g.turn);
    if (!moves.length) { g.over = inCheck(g, g.turn) ? 'checkmate' : 'stalemate'; if (g.over === 'checkmate') notify('Chess', g.turn === 'w' ? 'Checkmate — the computer wins.' : 'Checkmate — you win.', { app: 'chess' }); return g.over; }
    if (insufficient(g.board)) { g.over = 'material'; return g.over; }
    if (inCheck(g, g.turn)) return 'check';
    return '';
  }
  engine() {
    this.thinking = true;
    this.paintSide();
    setTimeout(() => {
      if (!this.win.node.isConnected) return;
      const m = engineMove(this.g);
      this.thinking = false;
      if (m) this.doMove(m, m.promo ? 'Q' : undefined);
      else this.paint();
    }, 320);
  }
  undo() {
    const g = this.g;
    if (!g.moves.length || this.thinking) return;
    /* take back the engine reply and the player's move */
    const n = g.turn === 'w' ? 2 : 1;
    for (let i = 0; i < n && g.moves.length; i++) {
      const rec = g.moves.pop();
      if (rec.m.cap) g.caps.pop();
      if (g.moves.length) {
        const prev = g.moves[g.moves.length - 1];
        g.board = prev.board.map(r => r.slice());
        g.castle = prev.castleAfter;
        g.ep = prev.epAfter;
      } else {
        g.board = START.map(r => r.slice());
        g.castle = { wK: true, wQ: true, bK: true, bQ: true };
        g.ep = null;
      }
      g.turn = g.moves.length % 2 ? 'b' : 'w';
      g.over = null;
    }
    this.sel = null;
    persist(g);
    this.paint();
  }
  flip() { this.g.flipped = !this.g.flipped; persist(this.g); this.paint(); }
  newGame() {
    this.g = freshGame();
    persist(this.g);
    this.sel = null;
    this.paint();
  }
}
/* reconstruct the board before a move for SAN disambiguation */
function undoBoard(g) {
  const prev = g.moves.length ? g.moves[g.moves.length - 1].board : START;
  return prev.map(r => r.slice());
}
export default meta;
