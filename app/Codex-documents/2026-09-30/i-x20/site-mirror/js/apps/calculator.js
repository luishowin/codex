// Calculator — the macOS calculator: Basic, Scientific and Programmer pads,
// a history tape, unit conversion, and the running expression above the result.
import { el, beep } from '../core/util.js';
import { wm } from '../shell/wm.js';
import { contextMenu } from '../shell/menus.js';
import { state, setSetting } from '../core/store.js';

const calc = () => wm.byApp('calculator')[0]?._calc;

const meta = {
  id: 'calculator', name: 'Calculator', icon: 'calculator', dock: true,
  menus: () => [
    {
      title: 'File', items: () => [
        { label: 'Close Window', key: '⌘W', action: () => { const w = wm.byApp('calculator')[0]; w && wm.close(w); } },
      ],
    },
    {
      title: 'Edit', items: () => [
        { label: 'Cut', key: '⌘X', action: () => calc()?.cut() },
        { label: 'Copy', key: '⌘C', action: () => calc()?.copy() },
        { label: 'Paste', key: '⌘V', action: () => calc()?.paste() },
        { type: 'sep' },
        { label: 'Clear', key: '⎋', action: () => calc()?.clear() },
      ],
    },
    { title: 'View', items: () => viewItems() },
    { title: 'Convert', items: () => convertItems() },
  ],
  launch(opts) { return openCalc(opts); },
};

function viewItems() {
  const c = calc();
  const mode = c?.mode || state.settings.calcMode || 'basic';
  return [
    { label: 'Basic', key: '⌘1', checked: mode === 'basic', action: () => calc()?.setMode('basic') },
    { label: 'Scientific', key: '⌘2', checked: mode === 'sci', action: () => calc()?.setMode('sci') },
    { label: 'Programmer', key: '⌘3', checked: mode === 'prog', action: () => calc()?.setMode('prog') },
    { type: 'sep' },
    { label: c?.histOn ? 'Hide History' : 'Show History', key: '⇧⌘H', action: () => calc()?.toggleHistory() },
    { label: 'Clear History', disabled: !c?.history?.length, action: () => c?.clearHistory() },
  ];
}
function convertItems() {
  const k = calc()?.convert?.kind || null;
  return [
    { label: 'Length', checked: k === 'length', action: () => calc()?.convertTo('length') },
    { label: 'Temperature', checked: k === 'temp', action: () => calc()?.convertTo('temp') },
    { label: 'Currency', checked: k === 'currency', action: () => calc()?.convertTo('currency') },
    { type: 'sep' },
    { label: 'None', disabled: !k, action: () => calc()?.convertTo(null) },
  ];
}

/* the window is a different shape in each mode, like the real app */
const MODE_SIZE = { basic: [252, 462], sci: [640, 430], prog: [700, 570] };
const HIST_W = 196;

function openCalc(opts = {}) {
  const existing = wm.byApp('calculator')[0];
  if (existing) { wm.show(existing); return existing; }
  /* the mode lives in settings — a saved window record may be older */
  const saved = MODE_SIZE[state.settings.calcMode] ? state.settings.calcMode : null;
  const mode = saved || (MODE_SIZE[opts.mode] ? opts.mode : 'basic');
  const [w, h] = MODE_SIZE[mode];
  return wm.open({
    app: 'calculator', key: 'main', title: 'Calculator', chrome: false, resizable: false,
    width: w, height: h, minWidth: w, minHeight: h,
    getData: win => ({ mode: win._calc?.mode }),
    build: win => new Calculator(win, mode).mount(),
  });
}

const OP_GLYPH = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', 'yroot': 'ʸ√' };
const PAD = [
  { k: 'back', cls: 'fn', svg: 'back' }, { k: 'sign', cls: 'fn', text: '+/−' }, { k: 'pct', cls: 'fn', text: '%' }, { k: '/', cls: 'op', text: '÷' },
  { k: '7', text: '7' }, { k: '8', text: '8' }, { k: '9', text: '9' }, { k: '*', cls: 'op', text: '×' },
  { k: '4', text: '4' }, { k: '5', text: '5' }, { k: '6', text: '6' }, { k: '-', cls: 'op', text: '−' },
  { k: '1', text: '1' }, { k: '2', text: '2' }, { k: '3', text: '3' }, { k: '+', cls: 'op', text: '+' },
  { k: 'mode', cls: 'fn', svg: 'mode' }, { k: '0', text: '0' }, { k: '.', text: '.' }, { k: '=', cls: 'op', text: '=' },
];
/* the Scientific pad's function block: six columns beside the standard pad.
   `a` is the label/key the 2nd key swaps in. */
const SCI_PAD = [
  [{ k: 'open', t: '(' }, { k: 'close', t: ')' }, { k: 'mc', t: 'mc' }, { k: 'm+', t: 'm+' }, { k: 'm-', t: 'm-' }, { k: 'mr', t: 'mr' }],
  [{ k: 'second', t: '2nd' }, { k: 'x2', t: 'x²' }, { k: 'x3', t: 'x³' }, { k: 'pow', t: 'xʸ' }, { k: 'ex', t: 'eˣ' }, { k: 'tenx', t: '10ˣ' }],
  [{ k: 'inv', t: '1/x' }, { k: 'sqrt', t: '²√x' }, { k: 'cbrt', t: '³√x' }, { k: 'yroot', t: 'ʸ√x' }, { k: 'ln', t: 'ln', a: { k: 'log2', t: 'log₂' } }, { k: 'log', t: 'log₁₀', a: { k: 'twox', t: '2ˣ' } }],
  [{ k: 'fact', t: 'x!' }, { k: 'sin', t: 'sin', a: { k: 'asin', t: 'sin⁻¹' } }, { k: 'cos', t: 'cos', a: { k: 'acos', t: 'cos⁻¹' } }, { k: 'tan', t: 'tan', a: { k: 'atan', t: 'tan⁻¹' } }, { k: 'euler', t: 'e' }, { k: 'ee', t: 'EE' }],
  [{ k: 'unit', t: 'Rad' }, { k: 'sinh', t: 'sinh', a: { k: 'asinh', t: 'sinh⁻¹' } }, { k: 'cosh', t: 'cosh', a: { k: 'acosh', t: 'cosh⁻¹' } }, { k: 'tanh', t: 'tanh', a: { k: 'atanh', t: 'tanh⁻¹' } }, { k: 'pi', t: 'π' }, { k: 'rand', t: 'Rand' }],
];
/* the Programmer pad's function block */
const PRO_PAD = [
  [{ k: 'open', t: '(' }, { k: 'close', t: ')' }, { k: 'mc', t: 'mc' }, { k: 'm+', t: 'm+' }, { k: 'm-', t: 'm-' }, { k: 'mr', t: 'mr' }],
  [{ k: 'shl', t: '<<' }, { k: 'shr', t: '>>' }, { k: 'RoL', t: 'RoL' }, { k: 'RoR', t: 'RoR' }, { k: 'X<<Y', t: 'X<<Y' }, { k: 'X>>Y', t: 'X>>Y' }],
  [{ k: 'AND', t: 'AND' }, { k: 'OR', t: 'OR' }, { k: 'XOR', t: 'XOR' }, { k: 'NOR', t: 'NOR' }, { k: 'NOT', t: 'NOT' }, { k: 'mod', t: 'mod' }],
  [{ k: 'NAND', t: 'NAND' }, { k: 'XNOR', t: 'XNOR' }, { k: 'BYTE', t: 'BYTE' }, { k: 'WORD', t: 'WORD' }, { k: 'FF', t: 'FF' }, { k: '00', t: '00' }],
  [{ k: 'A', t: 'A' }, { k: 'B', t: 'B' }, { k: 'C', t: 'C' }, { k: 'D', t: 'D' }, { k: 'E', t: 'E' }, { k: 'F', t: 'F' }],
];
/* precedence for the programmer operators, lowest to highest */
const P_PREC = { 'OR': 1, 'NOR': 1, 'XOR': 2, 'XNOR': 2, 'AND': 3, 'NAND': 3, 'X<<Y': 4, 'X>>Y': 4, '+': 5, '-': 5, '*': 6, '/': 6, 'mod': 6 };
const P_OPS = new Set(Object.keys(P_PREC));
const P_DIGITS = { 16: /^[0-9A-F]$/, 10: /^[0-9]$/, 8: /^[0-7]$/, 2: /^[01]$/ };
const P_MAXLEN = { 16: 16, 10: 20, 8: 22, 2: 64 };
const P_BASES = [[16, 'HEX'], [10, 'DEC'], [8, 'OCT'], [2, 'BIN']];

/** float noise dies here: 0.1 + 0.2 prints 0.3, not 0.30000000000000004 */
const tidy = n => {
  if (!Number.isFinite(n)) return NaN;
  const r = Number(n.toPrecision(15));
  return Object.is(r, -0) ? 0 : r;
};
const raw = tk => parseFloat(tk.v) || 0;

/** evaluate with order of operations; `50 + 10%` is 55, `200 × 10%` is 20 */
function evaluate(tokens) {
  const list = tokens.slice();
  let open = 0;
  for (const t of list) open += t.t === 'open' ? 1 : t.t === 'close' ? -1 : 0;
  while (open-- > 0) list.push({ t: 'close' });   /* an unfinished paren closes itself */
  const v = evalList(list);
  return v === null ? 0 : v;
}
function evalList(list) {
  for (;;) {
    const close = list.findIndex(t => t.t === 'close');
    if (close < 0) break;
    let openAt = -1;
    for (let i = close - 1; i >= 0; i--) if (list[i].t === 'open') { openAt = i; break; }
    if (openAt < 0) { list.splice(close, 1); continue; }   /* a ')' nobody opened */
    const v = evalFlat(list.slice(openAt + 1, close));
    /* an empty pair of parens contributes nothing: `2 × ()` is just `2 ×` */
    if (v === null) list.splice(openAt, close - openAt + 1);
    else list.splice(openAt, close - openAt + 1, { t: 'n', v: String(v) });
  }
  return evalFlat(list);
}
function evalFlat(list) {
  /* a trailing operator with nothing on its right yet: show what is on the left */
  while (list.length && list[list.length - 1].t === 'op') list.pop();
  if (!list.length) return null;
  const stack = [];
  const ops = [];
  for (const tk of list) {
    if (tk.t === 'n') { stack.push({ pct: !!tk.pct, v: raw(tk) }); continue; }
    if (tk.t === 'op') ops.push(tk.v);
  }
  while (ops.length >= stack.length) ops.pop();
  /* powers bind tightest and run right to left: 2^3^2 is 2^(3^2) */
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i] !== '^' && ops[i] !== 'yroot') continue;
    const a = stack[i], b = stack[i + 1];
    const bv = b.pct ? b.v / 100 : b.v;
    const r = ops[i] === '^' ? Math.pow(a.v, bv) : Math.pow(a.v, 1 / bv);
    stack.splice(i, 2, { pct: false, v: tidy(r) });
    ops.splice(i, 1);
  }
  /* × and ÷ next, left to right */
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] !== '*' && ops[i] !== '/') continue;
    const a = stack[i], b = stack[i + 1];
    const bv = b.pct ? b.v / 100 : b.v;
    const r = ops[i] === '*' ? a.v * bv : (bv === 0 ? NaN : a.v / bv);
    stack.splice(i, 2, { pct: false, v: tidy(r) });
    ops.splice(i, 1);
    i--;
  }
  /* then + and −. A percent operand is a hundredth of the running total:
     50 + 10% is 55, and a leading 50% is the operand 0.5 */
  let acc = stack.length ? (stack[0].pct ? stack[0].v / 100 : stack[0].v) : 0;
  for (let i = 0; i < ops.length; i++) {
    const b = stack[i + 1];
    const value = b.pct ? (acc * b.v) / 100 : b.v;
    acc = tidy(ops[i] === '+' ? acc + value : acc - value);
  }
  return tidy(acc);
}

/* programmer arithmetic is integer arithmetic in a fixed word size */
const P_ERR = Symbol('nan');
const pMask = bits => (1n << BigInt(bits)) - 1n;
function pRotate(v, n, bits, dir) {
  const s = Number(n % BigInt(bits));
  if (s === 0) return v;
  const big = BigInt(bits);
  const left = ((v << BigInt(s)) | (v >> (big - BigInt(s)))) & pMask(bits);
  const right = ((v >> BigInt(s)) | (v << (big - BigInt(s)))) & pMask(bits);
  return dir < 0 ? left : right;
}
function pOp(op, a, b, bits) {
  const mask = pMask(bits);
  const big = BigInt(bits);
  switch (op) {
    case '+': return (a + b) & mask;
    case '-': return (a - b) & mask;
    case '*': return (a * b) & mask;
    case '/': if (b === 0n) throw P_ERR; return a / b;
    case 'mod': if (b === 0n) throw P_ERR; return a % b;
    case 'AND': return a & b;
    case 'OR': return a | b;
    case 'XOR': return a ^ b;
    case 'NOR': return ~(a | b) & mask;
    case 'NAND': return ~(a & b) & mask;
    case 'XNOR': return ~(a ^ b) & mask;
    case 'X<<Y': return b >= big ? 0n : (a << b) & mask;
    case 'X>>Y': return b >= big ? 0n : a >> b;
  }
  return 0n;
}
function pEvaluate(tokens, bits) {
  const list = tokens.slice();
  let open = 0;
  for (const t of list) open += t.t === 'open' ? 1 : t.t === 'close' ? -1 : 0;
  while (open-- > 0) list.push({ t: 'close' });
  const v = pList(list, bits);
  return v === null ? 0n : v;
}
function pList(list, bits) {
  for (;;) {
    const close = list.findIndex(t => t.t === 'close');
    if (close < 0) break;
    let openAt = -1;
    for (let i = close - 1; i >= 0; i--) if (list[i].t === 'open') { openAt = i; break; }
    if (openAt < 0) { list.splice(close, 1); continue; }
    const v = pFlat(list.slice(openAt + 1, close), bits);
    /* an empty pair of parens contributes nothing, same as the float pad */
    if (v === null) list.splice(openAt, close - openAt + 1);
    else list.splice(openAt, close - openAt + 1, { t: 'n', v });
  }
  return pFlat(list, bits);
}
function pFlat(list, bits) {
  while (list.length && list[list.length - 1].t === 'op') list.pop();
  if (!list.length) return null;
  const mask = pMask(bits);
  const stack = [], ops = [];
  for (const tk of list) {
    if (tk.t === 'n') stack.push({ pct: !!tk.pct, v: tk.v & mask });
    else if (tk.t === 'op') ops.push(tk.v);
  }
  while (ops.length >= stack.length) ops.pop();
  for (let p = 6; p >= 1; p--) {
    for (let i = 0; i < ops.length; i++) {
      if ((P_PREC[ops[i]] || 0) !== p) continue;
      const a = stack[i], b = stack[i + 1];
      /* a percent operand counts against the running value, like the float pad */
      let bv = b.v;
      if (b.pct) bv = ops[i] === '+' || ops[i] === '-' ? (a.v * b.v) / 100n : b.v / 100n;
      stack.splice(i, 2, { pct: false, v: pOp(ops[i], a.v, bv, bits) & mask });
      ops.splice(i, 1);
      i--;
    }
  }
  return stack.length ? stack[0].v & mask : null;
}
/** reverse the byte order of v inside the given word size */
function pByteSwap(v, bits) {
  const bytes = bits / 8;
  let r = 0n;
  for (let i = 0; i < bytes; i++) r = (r << 8n) | ((v >> BigInt(8 * i)) & 0xffn);
  return r;
}
/** swap the 16-bit words inside the given word size */
function pWordSwap(v, bits) {
  const words = bits / 16;
  let r = 0n;
  for (let i = 0; i < words; i++) r = (r << 16n) | ((v >> BigInt(16 * i)) & 0xffffn);
  return r;
}

/* scientific one-key functions. `deg` flags a function that takes/returns an
   angle so it can be converted when the pad is in degrees. */
const FUNCS = {
  x2: v => v * v, x3: v => v * v * v, inv: v => 1 / v,
  sqrt: v => v < 0 ? NaN : Math.sqrt(v), cbrt: v => Math.cbrt(v),
  fact: v => factorial(v),
  ln: v => v <= 0 ? NaN : Math.log(v), log: v => v <= 0 ? NaN : Math.log10(v), log2: v => v <= 0 ? NaN : Math.log2(v),
  ex: v => Math.exp(v), tenx: v => Math.pow(10, v), twox: v => Math.pow(2, v),
  sin: (v, d) => Math.sin(d ? v * Math.PI / 180 : v), cos: (v, d) => Math.cos(d ? v * Math.PI / 180 : v), tan: (v, d) => Math.tan(d ? v * Math.PI / 180 : v),
  asin: (v, d) => { const r = Math.asin(v); return d ? r * 180 / Math.PI : r; },
  acos: (v, d) => { const r = Math.acos(v); return d ? r * 180 / Math.PI : r; },
  atan: (v, d) => { const r = Math.atan(v); return d ? r * 180 / Math.PI : r; },
  sinh: v => Math.sinh(v), cosh: v => Math.cosh(v), tanh: v => Math.tanh(v),
  asinh: v => Math.asinh(v), acosh: v => Math.acosh(v), atanh: v => Math.atanh(v),
};
const SECOND = { sin: 'asin', cos: 'acos', tan: 'atan', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh', ln: 'log2', log: 'twox' };

function factorial(v) {
  if (!Number.isFinite(v)) return NaN;
  if (v >= 0 && Number.isInteger(v)) {
    if (v > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= v; i++) r *= i;
    return r;
  }
  /* x! on a fraction is the gamma of x+1 */
  const g = gamma(v + 1);
  return g;
}
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function gamma(z) {
  if (Number.isInteger(z) && z <= 0) return NaN;
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) x += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/* unit conversion tables */
const UNITS = {
  length: {
    def: ['km', 'mi'],
    list: [
      ['km', 'Kilometers', 1000], ['m', 'Meters', 1], ['cm', 'Centimeters', .01], ['mm', 'Millimeters', .001],
      ['mi', 'Miles', 1609.344], ['yd', 'Yards', .9144], ['ft', 'Feet', .3048], ['in', 'Inches', .0254], ['nmi', 'Nautical Miles', 1852],
    ],
  },
  temp: { def: ['°C', '°F'], list: [['°C', 'Celsius'], ['°F', 'Fahrenheit'], ['K', 'Kelvin']] },
  currency: {
    def: ['USD', 'EUR'],
    list: [
      ['USD', 'US Dollar', 1], ['EUR', 'Euro', .92], ['GBP', 'British Pound', .79], ['JPY', 'Japanese Yen', 149.6],
      ['CHF', 'Swiss Franc', .88], ['CAD', 'Canadian Dollar', 1.36], ['AUD', 'Australian Dollar', 1.52],
      ['CNY', 'Chinese Yuan', 7.25], ['INR', 'Indian Rupee', 83.2], ['KRW', 'South Korean Won', 1330], ['MXN', 'Mexican Peso', 17.05],
    ],
  },
};
function convertValue(kind, v, from, to) {
  if (kind === 'temp') {
    const c = from === '°C' ? v : from === '°F' ? (v - 32) / 1.8 : v - 273.15;
    return to === '°C' ? c : to === '°F' ? c * 1.8 + 32 : c + 273.15;
  }
  const f = UNITS[kind].list;
  const a = f.find(u => u[0] === from)?.[2], b = f.find(u => u[0] === to)?.[2];
  if (!a || !b) return NaN;
  return v * a / b;
}
const convNum = v => {
  if (!Number.isFinite(v)) return 'Not a number';
  const s = String(Number(v.toPrecision(9)));
  return s.includes('e') ? format(v) : s;
};

class Calculator {
  constructor(win, mode) {
    this.win = win;
    this.mode = mode;
    this.unit = 'rad';
    this.second = false;
    this.mem = 0;
    this.pmem = 0n;
    this.pbase = 16;
    this.pbits = 64;
    this.histOn = false;
    this.history = readHistory();
    this.convert = null;
    this.reset();
  }
  reset() {
    this.repeat = null;
    this.tokens = [];
    this.entry = '0';
    this.pct = false;
    this.fresh = true;
    this.armed = null;
    this.settled = false;
    this.typed = false;
  }
  get mask() { return pMask(this.pbits); }

  /* ── DOM ────────────────────────────────────────────────────────── */
  mount() {
    this.win._calc = this;
    this.win.node.classList.add('dark-chrome');
    /* the traffic lights belong to the body, not a title bar */
    this.lights = el('div.calc-lights');
    this.lights.append(this.win.node.querySelector('.traffic'));
    this.indsEl = el('div.calc-inds');
    this.exprEl = el('div.calc-expr');
    this.valEl = el('div.calc-val', { text: '0' });
    this.display = el('div.calc-display', null, this.indsEl, this.exprEl, this.valEl);
    this.convEl = el('div.calc-conv', { hidden: true });
    this.convFrom = el('button.calc-conv-u');
    this.convTo = el('button.calc-conv-u');
    const swap = el('button.calc-conv-swap', { title: 'Swap units', html: swapGlyph(), onclick: () => this.swapConv() });
    this.convFrom.addEventListener('click', e => this.unitMenu('from', e.currentTarget));
    this.convTo.addEventListener('click', e => this.unitMenu('to', e.currentTarget));
    this.convEl.append(this.convFrom, swap, this.convTo);
    this.baseEl = el('div.calc-bases', { hidden: true });
    this.bitsEl = el('div.calc-bits', { hidden: true });
    this.segEl = el('div.calc-psegs', { hidden: true });
    this.segEl.append(this.wordSeg());
    this.histList = el('div.calc-hist-list');
    this.histEl = el('div.calc-hist', null, this.histList,
      el('button.calc-hist-clear', { text: 'Clear History', onclick: () => this.clearHistory() }));
    this.padsEl = el('div.calc-pads');
    this.body = el('div.calc-body', null, this.display, this.convEl, this.baseEl, this.bitsEl, this.segEl, this.padsEl);
    this.root = el('div.calc', null, this.lights, this.body);
    this.win.body.append(this.root);
    this.win.onKey = e => this.key(e);
    this.buildPads();
    this.updateChrome();
    this.paint();
  }
  buildPads() {
    this.padsEl.replaceChildren();
    this.keys = {};
    this.fkeys = {};
    if (this.mode !== 'basic') {
      const fp = el('div.calc-fpad');
      for (const row of (this.mode === 'sci' ? SCI_PAD : PRO_PAD)) {
        for (const spec of row) {
          const b = el('button.calc-fk', { dataset: { k: spec.k }, onclick: () => this.press(b.dataset.k) });
          b.append(el('span', { text: spec.t || spec.k }));
          this.fkeys[spec.k] = { btn: b, spec };
          fp.append(b);
        }
      }
      this.padsEl.append(fp);
    }
    const pad = el('div.calc-pad');
    for (const key of PAD) {
      const b = el('button.calc-key' + (key.cls ? '.' + key.cls : ''), {
        title: key.title || '',
        dataset: { k: key.k },
        onclick: () => this.press(key.k),
      });
      if (key.svg === 'back') {
        this.backIcon = el('span.calc-back');
        b.append(this.backIcon);
      } else if (key.svg === 'mode') {
        b.append(el('span.calc-mode', { html: modeGlyph() }));
        b.addEventListener('contextmenu', e => {
          e.preventDefault();
          this.modeMenu(e);
        });
      } else {
        b.append(el('span', { text: key.text }));
      }
      this.keys[key.k] = b;
      pad.append(b);
    }
    this.padsEl.append(pad);
  }
  wordSeg() {
    const seg = el('div.seg.calc-wseg');
    for (const bits of [8, 16, 32, 64]) {
      seg.append(el('button', {
        text: String(bits), dataset: { bits },
        onclick: () => this.setBits(bits),
      }));
    }
    return seg;
  }
  updateChrome() {
    this.root.className = 'calc mode-' + this.mode + (this.histOn ? ' has-hist' : '');
    if (this.histOn && !this.histEl.isConnected) this.root.prepend(this.histEl);
    if (!this.histOn && this.histEl.isConnected) this.histEl.remove();
    this.convEl.hidden = !(this.convert && this.mode !== 'prog');
    const prog = this.mode === 'prog';
    this.baseEl.hidden = !prog;
    this.bitsEl.hidden = !prog;
    this.segEl.hidden = !prog;
  }
  fitWindow() {
    const [w, h] = MODE_SIZE[this.mode];
    const width = w + (this.histOn ? HIST_W : 0);
    this.win.minW = Math.min(w, width);
    this.win.minH = h;
    const x = Math.max(4, Math.min(this.win.rect.x, Math.max(4, window.innerWidth - width - 8)));
    const y = Math.max(26, Math.min(this.win.rect.y, Math.max(26, window.innerHeight - h - 90)));
    this.win.setRect({ x, y, w: width, h });
  }
  setMode(mode) {
    if (!MODE_SIZE[mode]) return;
    const prev = this.currentNumber();
    this.mode = mode;
    setSetting('calcMode', mode);
    this.win.setData({ mode });
    this.reset();
    this.convert = null;
    if (prev !== null) this.entry = this.displayValueFor(prev);
    this.buildPads();
    this.updateChrome();
    this.fitWindow();
    this.paint();
  }
  /* the number on screen survives a mode switch, converted to the new base */
  currentNumber() {
    if (this.mode === 'prog') return this.pShownValue();
    const v = parseFloat(this.shown);
    return Number.isFinite(v) ? v : null;
  }
  displayValueFor(v) {
    if (typeof v === 'bigint') {
      if (this.mode === 'prog') return v.toString(this.pbase).toUpperCase();
      return format(Number(v));
    }
    if (this.mode === 'prog') return (BigInt(Math.trunc(v)) & this.mask).toString(this.pbase).toUpperCase();
    return format(v);
  }
  toggleHistory() {
    this.histOn = !this.histOn;
    if (this.histOn) this.renderHist();
    this.updateChrome();
    this.fitWindow();
  }
  renderHist() {
    this.histList.replaceChildren();
    if (!this.history.length) {
      this.histList.append(el('div.calc-hist-empty', { text: 'No History' }));
      return;
    }
    for (const h of this.history) {
      this.histList.append(el('div.calc-hist-line', {
        text: h.t,
        title: 'Double-click to use this result',
        ondblclick: () => this.recall(h),
      }));
    }
  }
  pushHist(exprText, resultText, numeric) {
    this.history.unshift({ t: `${exprText} = ${resultText}`, v: resultText, n: String(numeric) });
    if (this.history.length > 200) this.history.length = 200;
    writeHistory(this.history);
    if (this.histOn) this.renderHist();
  }
  recall(h) {
    const n = this.mode === 'prog' ? BigInt(h.n) : parseFloat(h.n);
    this.derived(this.displayValueFor(n));
    this.win.focusSelf?.();
  }
  clearHistory() {
    this.history = [];
    writeHistory(this.history);
    this.renderHist();
  }

  /* ── input ────────────────────────────────────────────────────────── */
  key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const k = e.key;
    if (this.mode === 'prog') return this.pKey(k);
    if (/^[0-9]$/.test(k)) { this.press(k); return true; }
    if (k === '.' || k === ',') { this.press('.'); return true; }
    if (k === '+') { this.press('+'); return true; }
    if (k === '-') { this.press('-'); return true; }
    if (k === '*' || k === 'x' || k === 'X') { this.press('*'); return true; }
    if (k === '/') { this.press('/'); return true; }
    if (k === '%') { this.press('pct'); return true; }
    if (k === '=' || k === 'Enter') { this.press('='); return true; }
    if (k === 'Escape') { this.clear(); return true; }
    if (k === 'Backspace') { this.press('back'); return true; }
    if (k === 'c' || k === 'C') { this.clear(); return true; }
    if (this.mode === 'sci') {
      if (k === '(' || k === ')') { this.press(k === '(' ? 'open' : 'close'); return true; }
      if (k === '^') { this.press('pow'); return true; }
      if (k === '!') { this.press('fact'); return true; }
      if (k === 'e' || k === 'E') { this.press('ee'); return true; }
      if (k === 'p' || k === 'P') { this.press('pi'); return true; }
    }
    return false;
  }
  press(k) {
    if (this.mode === 'prog') return this.pPress(k);
    if (/^[0-9]$/.test(k)) return this.digit(k);
    if (k === '.') return this.dot();
    if (k === 'back') return this.showAC() ? this.clear() : this.backspace();
    if (k === 'sign') return this.toggleSign();
    if (k === 'pct') return this.percent();
    if (k === '=') return this.equals();
    if (k === 'mode') {
      const r = this.keys.mode.getBoundingClientRect();
      return this.modeMenu({ clientX: r.left + r.width / 2, clientY: r.top - 4 });
    }
    if (['+', '-', '*', '/'].includes(k)) return this.operator(k);
    if (this.mode === 'sci') return this.sciPress(k);
    return beep();
  }
  sciPress(k) {
    if (k === 'open' || k === 'close') return this.paren(k);
    if (k === 'pow') return this.operator('^');
    if (k === 'yroot') return this.operator('yroot');
    if (k === 'ee') return this.eeIn();
    if (k === 'second') { this.second = !this.second; return this.paint(); }
    if (k === 'unit') { this.unit = this.unit === 'rad' ? 'deg' : 'rad'; return this.paint(); }
    if (k === 'mc') { this.mem = 0; return this.paint(); }
    if (k === 'm+') { this.mem = tidy(this.mem + this.displayNumber()); return this.paint(); }
    if (k === 'm-') { this.mem = tidy(this.mem - this.displayNumber()); return this.paint(); }
    if (k === 'mr') return this.recallMem();
    if (k === 'pi') return this.insertConst(Math.PI);
    if (k === 'euler') return this.insertConst(Math.E);
    if (k === 'rand') return this.insertConst(Math.round(Math.random() * 1e9) / 1e9);
    const fn = this.second ? (SECOND[k] || k) : k;
    if (FUNCS[fn]) return this.applyFn(fn);
    return beep();
  }
  showAC() { return this.settled || (this.fresh && !this.tokens.length && this.entry === '0'); }
  /* the entry is a value worth committing even though the next key would
     replace it: what percent and the one-key functions leave behind */
  pendingEntry() { return this.pct || (this.typed && this.entry !== '0' && this.entry !== 'Not a number'); }
  digit(d) {
    this.typed = true;
    if (this.fresh) { this.entry = d; this.fresh = false; this.settled = false; this.pct = false; this.repeat = null; }
    else if (this.entry.includes('e')) {
      /* inside an EE entry the digits grow the exponent */
      let [m, ex] = this.entry.split('e');
      ex = ex === '0' || ex === '-0' ? d : ex + d;
      if (ex.replace('-', '').length > 3) { this.paint(); return; }
      this.entry = m + 'e' + ex;
      this.paint();
      return;
    } else {
      if (this.entry.replace(/[-.]/g, '').length >= 16) { this.paint(); return; }
      this.entry = this.entry === '0' ? d : this.entry + d;
    }
    this.paint();
  }
  dot() {
    this.typed = true;
    if (this.fresh) { this.entry = '0.'; this.fresh = false; this.settled = false; this.pct = false; this.repeat = null; }
    else if (this.entry.includes('e')) { this.paint(); return; }
    else if (!this.entry.includes('.')) this.entry += '.';
    this.paint();
  }
  toggleSign() {
    if (this.entry === 'Not a number') { this.paint(); return; }
    /* nothing typed after the operator: the sign flips the number on screen */
    if (!this.typed && this.tokens.length) return this.derived(format(-this.displayNumber()));
    if (this.entry === '0') { this.paint(); return; }
    this.entry = this.entry.startsWith('-') ? this.entry.slice(1) : '-' + this.entry;
    this.typed = true;
    this.paint();
  }
  percent() {
    this.pct = true;
    this.typed = true;         /* 50% is an operand: 0.5 when it is added */
    this.fresh = true;         /* typing next starts a new number */
    this.paint();
  }
  backspace() {
    let next = this.entry;
    if (next === 'Not a number' || next.length <= 1) next = '0';
    else next = next.slice(0, -1);
    /* an EE entry collapses back to its mantissa when the exponent empties */
    if (next === '-' || /e-?$/.test(next)) next = next.split('e')[0] || '0';
    if (next === '') next = '0';
    this.entry = next;
    this.pct = false;
    this.settled = false;
    if (this.entry === '0' && !this.tokens.length) { this.fresh = true; this.typed = false; }
    this.paint();
  }
  /* the number the user is working on, percent flag aside */
  entryNumber() {
    const v = parseFloat(this.entry);
    return Number.isFinite(v) ? v : 0;
  }
  /* the value on the screen right now: entry, or the running total */
  displayNumber() {
    const v = parseFloat(this.running);
    return Number.isFinite(v) ? v : 0;
  }
  /**
   * Fold what is on screen into the expression. `typed` is the only thing that
   * decides whether there is something to commit: a 0 the user typed is a real
   * operand, and dropping it turned `9 / 0 =` into `9 / =`.
   * A number typed right after `)` or another number multiplies silently.
   */
  commit() {
    if (this.mode === 'prog') return this.pCommit();
    if (!this.typed && !this.pct) { this.entry = '0'; return; }
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.t !== 'op' && last.t !== 'open') this.tokens.push({ t: 'op', v: '*' });
    this.tokens.push({ t: 'n', v: this.entry === 'Not a number' ? '0' : this.entry, pct: this.pct });
    this.entry = '0';
    this.pct = false;
    this.typed = false;
  }
  lastIsOp() { return this.tokens.length > 0 && this.tokens[this.tokens.length - 1].t === 'op'; }
  operator(op) {
    /* a result on screen becomes the left operand of the next chain */
    if (!this.typed && !this.pct && !this.tokens.length && this.fresh && this.entry !== '0' && this.entry !== 'Not a number') this.typed = true;
    this.commit();
    this.repeat = null;
    if (this.lastIsOp()) this.tokens.pop();      /* 2 + 3 +  → replace, like macOS */
    this.tokens.push({ t: 'op', v: op });
    this.fresh = true;
    this.armed = op;
    this.settled = false;
    this.paint();
  }
  paren(k) {
    if (k === 'open') {
      if (this.typed || this.pct) this.commit();
      const last = this.tokens[this.tokens.length - 1];
      if (last && last.t !== 'op' && last.t !== 'open') this.tokens.push({ t: 'op', v: '*' });
      this.tokens.push({ t: 'open' });
      this.entry = '0';
      this.fresh = true;
      this.armed = null;
    } else {
      if (!this.tokens.some(t => t.t === 'open')) { beep(); return; }
      if (this.fresh) { if (this.pendingEntry()) this.commit(); else if (this.lastIsOp()) this.tokens.pop(); }
      else this.commit();
      this.tokens.push({ t: 'close' });
      this.fresh = true;
      this.armed = null;
    }
    this.settled = false;
    this.paint();
  }
  /* a derived value sitting in the entry: it commits like an operand, but the
     next typed digit replaces it — the state sin(9) leaves behind */
  derived(v) {
    this.entry = v;
    this.typed = true;
    this.fresh = true;
    this.settled = false;
    this.pct = false;
    this.repeat = null;
    this.armed = null;
    this.paint();
  }
  applyFn(name) {
    /* the function keys work on the number on screen — the entry while typing,
       the running total mid-expression, the result after = */
    const r = FUNCS[name](this.displayNumber(), this.unit === 'deg');
    if (this.tokens.length) this.tokens = [];
    this.derived(Number.isFinite(r) ? format(r) : 'Not a number');
  }
  insertConst(v) { this.derived(format(v)); }
  eeIn() {
    if (this.entry.includes('e') || this.entry === 'Not a number') return;
    this.entry = (this.fresh || this.entry === '0') ? '1e0' : this.entry + 'e0';
    this.typed = true;
    this.fresh = false;
    this.settled = false;
    this.pct = false;
    this.paint();
  }
  recallMem() { this.derived(format(this.mem)); }
  equals() {
    /* a second = repeats the last operation, exactly like the real Calculator */
    if (this.fresh && this.repeat && !this.tokens.length) {
      const { acc, op, operand } = this.repeat;
      const v = evaluate([{ t: 'n', v: String(acc) }, { t: 'op', v: op }, { t: 'n', v: String(operand) }]);
      this.entry = Number.isFinite(v) ? format(v) : 'Not a number';
      this.repeat = { acc: Number.isFinite(v) ? v : acc, op, operand };
      this.paint();
      return;
    }
    if (this.fresh) {
      /* "2 + =" with nothing typed after the operator is just 2 */
      if (this.pendingEntry()) this.commit();
      else if (this.lastIsOp()) this.tokens.pop();
    } else this.commit();
    const tokens = this.tokens.slice();
    const value = evaluate(tokens);
    /* remember the last two-operand step so "=" can repeat it */
    const lastOp = [...tokens].reverse().find(t => t.t === 'op');
    const lastNum = [...tokens].reverse().find(t => t.t === 'n');
    this.repeat = lastOp && lastNum && Number.isFinite(value)
      ? { acc: value, op: lastOp.v, operand: raw(lastNum) }
      : null;
    const exprText = renderTokens(tokens, 0, true);
    const resultText = Number.isFinite(value) ? format(value) : 'Not a number';
    if (exprText) this.pushHist(exprText, resultText, value);
    this.tokens = [];
    this.entry = resultText;
    this.pct = false;
    this.fresh = true;
    this.armed = null;
    this.settled = true;
    this.paint();
  }
  clear() { this.reset(); this.paint(); }

  /* ── programmer input ─────────────────────────────────────────────── */
  pKey(k) {
    const up = k.toUpperCase();
    if (this.pbase === 16 && /^[A-F]$/.test(up)) { this.press(up); return true; }
    if (/^[0-9]$/.test(k)) { this.press(k); return true; }
    if (k === '+' || k === '-' || k === '*' || k === '/') { this.press(k); return true; }
    if (k === '(' || k === ')') { this.press(k === '(' ? 'open' : 'close'); return true; }
    if (k === 'x' || k === 'X') { this.press('*'); return true; }
    if (k === '&') { this.press('AND'); return true; }
    if (k === '|') { this.press('OR'); return true; }
    if (k === '^') { this.press('XOR'); return true; }
    if (k === '<') { this.press('X<<Y'); return true; }
    if (k === '>') { this.press('X>>Y'); return true; }
    if (k === '=' || k === 'Enter') { this.press('='); return true; }
    if (k === 'Escape') { this.clear(); return true; }
    if (k === 'Backspace') { this.press('back'); return true; }
    if (k === 'c' || k === 'C') { this.clear(); return true; }
    if (k.length === 1) { beep(); return true; }
    return false;
  }
  pPress(k) {
    if (/^[0-9A-F]$/.test(k)) return this.pDigit(k);
    if (k === 'open' || k === 'close') return this.paren(k);
    if (P_OPS.has(k)) return this.pOperator(k);
    if (k === 'back') return this.showAC() ? this.clear() : this.backspace();
    if (k === 'sign') return this.pUnary('neg');
    if (k === 'pct') return this.percent();
    if (k === '=') return this.pEquals();
    if (k === 'mode') {
      const r = this.keys.mode.getBoundingClientRect();
      return this.modeMenu({ clientX: r.left + r.width / 2, clientY: r.top - 4 });
    }
    if (k === 'NOT') return this.pUnary('~');
    if (k === 'shl') return this.pUnary('<<');
    if (k === 'shr') return this.pUnary('>>');
    if (k === 'RoL') return this.pUnary('RoL');
    if (k === 'RoR') return this.pUnary('RoR');
    if (k === 'BYTE') return this.pUnary('BYTE');
    if (k === 'WORD') return this.pUnary('WORD');
    if (k === 'FF' || k === '00') return this.pByte(k);
    if (k === 'mc') { this.pmem = 0n; return this.paint(); }
    if (k === 'm+') { this.pmem = (this.pmem + this.pShownValue()) & this.mask; return this.paint(); }
    if (k === 'm-') { this.pmem = (this.pmem - this.pShownValue()) & this.mask; return this.paint(); }
    if (k === 'mr') return this.pRecallMem();
    if (k === '.') return beep();
    return beep();
  }
  pDigit(d) {
    if (!P_DIGITS[this.pbase].test(d)) return beep();
    this.typed = true;
    if (this.fresh) { this.entry = d; this.fresh = false; this.settled = false; this.pct = false; this.repeat = null; }
    else {
      if (this.entry === 'Not a number') this.entry = '0';
      if (this.entry.replace(/^0+/, '').length >= P_MAXLEN[this.pbase]) { this.paint(); return; }
      this.entry = this.entry === '0' ? d : this.entry + d;
    }
    this.entry = this.entry.replace(/^0+(?=.)/, '');
    this.paint();
  }
  pParse(s) {
    if (!s || s === 'Not a number') return 0n;
    return BigInt((this.pbase === 16 ? '0x' : this.pbase === 8 ? '0o' : this.pbase === 2 ? '0b' : '') + s);
  }
  /* the value currently on screen, masked to the word size */
  pShownValue() {
    if (!this.tokens.length) return this.pParse(this.entry) & this.mask;
    const hasEntry = !this.fresh || this.pct || this.entry !== '0';
    const all = hasEntry ? [...this.tokens, { t: 'n', v: this.pParse(this.entry), pct: this.pct }] : this.tokens;
    try { return pEvaluate(all, this.pbits); } catch { return 0n; }
  }
  pCommit() {
    if (!this.typed && !this.pct) { this.entry = '0'; return; }
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.t !== 'op' && last.t !== 'open') this.tokens.push({ t: 'op', v: '*' });
    this.tokens.push({ t: 'n', v: this.pParse(this.entry), pct: this.pct });
    this.entry = '0';
    this.pct = false;
    this.typed = false;
  }
  pOperator(op) {
    if (!this.typed && !this.pct && !this.tokens.length && this.fresh && this.entry !== '0' && this.entry !== 'Not a number') this.typed = true;
    this.pCommit();
    this.repeat = null;
    if (this.lastIsOp()) this.tokens.pop();
    this.tokens.push({ t: 'op', v: op });
    this.fresh = true;
    this.armed = op;
    this.settled = false;
    this.paint();
  }
  pUnary(u) {
    const v = this.pShownValue() & this.mask;
    const b = BigInt(this.pbits);
    let r;
    if (u === '~') r = ~v & this.mask;
    else if (u === 'neg') r = (-v) & this.mask;
    else if (u === 'BYTE') r = pByteSwap(v, this.pbits);
    else if (u === 'WORD') r = pWordSwap(v, this.pbits);
    else if (u === '<<') r = (v << 1n) & this.mask;
    else if (u === '>>') r = v >> 1n;
    else if (u === 'RoL') r = pRotate(v, 1n, this.pbits, -1);
    else if (u === 'RoR') r = pRotate(v, 1n, this.pbits, 1);
    else r = v;
    if (this.tokens.length) this.tokens = [];
    this.derived(r.toString(this.pbase).toUpperCase());
  }
  pByte(k) {
    /* the FF and 00 keys enter a whole byte at once */
    const s = { 16: k, 10: k === 'FF' ? '255' : '0', 8: k === 'FF' ? '377' : '0', 2: k === 'FF' ? '11111111' : '0' }[this.pbase];
    this.typed = true;
    if (this.fresh) { this.entry = s; this.fresh = false; this.settled = false; this.pct = false; this.repeat = null; }
    else this.entry = (this.entry === '0' || this.entry === 'Not a number') ? s : this.entry + s;
    this.entry = this.entry.replace(/^0+(?=.)/, '');
    this.paint();
  }
  pRecallMem() { this.derived(this.pmem.toString(this.pbase).toUpperCase()); }
  pEquals() {
    if (this.fresh && this.repeat && !this.tokens.length) {
      const { acc, op, operand } = this.repeat;
      let v;
      try { v = pEvaluate([{ t: 'n', v: acc }, { t: 'op', v: op }, { t: 'n', v: operand }], this.pbits); }
      catch { v = null; }
      if (v !== null && v !== undefined) {
        this.entry = v.toString(this.pbase).toUpperCase();
        this.repeat = { acc: v, op, operand };
      } else this.entry = 'Not a number';
      this.paint();
      return;
    }
    if (this.fresh) {
      if (this.pendingEntry()) this.pCommit();
      else if (this.lastIsOp()) this.tokens.pop();
    } else this.pCommit();
    const tokens = this.tokens.slice();
    let value;
    try { value = pEvaluate(tokens, this.pbits); } catch { value = null; }
    const lastOp = [...tokens].reverse().find(t => t.t === 'op');
    const lastNum = [...tokens].reverse().find(t => t.t === 'n');
    this.repeat = lastOp && lastNum && value !== null
      ? { acc: value, op: lastOp.v, operand: lastNum.v }
      : null;
    const exprText = renderTokens(tokens, this.pbase, true);
    const resultText = value === null ? 'Not a number' : value.toString(this.pbase).toUpperCase();
    if (exprText) this.pushHist(exprText, resultText, value === null ? 0n : value);
    this.tokens = [];
    this.entry = resultText;
    this.pct = false;
    this.fresh = true;
    this.armed = null;
    this.settled = true;
    this.paint();
  }
  setBase(base) {
    if (this.pbase === base) return;
    const v = this.pShownValue();
    this.pbase = base;
    this.entry = (v & this.mask).toString(base).toUpperCase();
    this.paint();
  }
  setBits(bits) {
    this.pbits = bits;
    const v = this.pShownValue() & this.mask;
    if (this.tokens.length === 0) this.entry = v.toString(this.pbase).toUpperCase();
    this.paint();
  }
  flipBit(i) {
    const v = (this.pShownValue() ^ (1n << BigInt(i))) & this.mask;
    if (this.tokens.length) this.tokens = [];
    this.derived(v.toString(this.pbase).toUpperCase());
  }

  /* ── convert ──────────────────────────────────────────────────────── */
  convertTo(kind) {
    if (kind === this.convert?.kind) kind = null;
    if (kind && this.mode === 'prog') return beep();
    this.convert = kind ? { kind, from: UNITS[kind].def[0], to: UNITS[kind].def[1] } : null;
    this.updateChrome();
    this.paint();
  }
  swapConv() {
    if (!this.convert) return;
    [this.convert.from, this.convert.to] = [this.convert.to, this.convert.from];
    this.paint();
  }
  unitMenu(side, btn) {
    if (!this.convert) return;
    const r = btn.getBoundingClientRect();
    contextMenu(UNITS[this.convert.kind].list.map(u => ({
      label: u[1],
      checked: this.convert[side] === u[0],
      action: () => { this.convert[side] = u[0]; this.paint(); },
    })), r.left, r.bottom + 4);
  }
  paintConv() {
    if (!this.convert) return;
    const { kind, from, to } = this.convert;
    const src = this.entryNumber();
    const out = convertValue(kind, src, from, to);
    this.convFrom.textContent = `${format(src)} ${from}`;
    this.convTo.textContent = `${convNum(out)} ${to}`;
  }

  /* ── clipboard ────────────────────────────────────────────────────── */
  copy() { navigator.clipboard?.writeText(this.shown).catch(() => { }); }
  cut() { this.copy(); this.clear(); }
  paste() { navigator.clipboard?.readText().then(t => this.pasteText(t)).catch(() => beep()); }
  pasteText(t) {
    const s = String(t || '').trim().replace(/[,\s]/g, '');
    if (this.mode === 'prog') {
      const m = s.replace(/^0x/i, '');
      if (!new RegExp('^' + P_DIGITS[this.pbase].source.slice(1, -1) + '+$', 'i').test(m)) return beep();
      this.entry = (this.pParse(m) & this.mask).toString(this.pbase).toUpperCase();
    } else {
      if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return beep();
      this.derived(format(parseFloat(s)));
      return;
    }
    this.derived(this.entry);
  }

  /* ── display ──────────────────────────────────────────────────────── */
  get running() {
    if (this.mode === 'prog') return this.pRunning();
    if (!this.tokens.length) return this.entry;
    /* the typed number counts even right after %, but not right after an operator */
    const hasEntry = !this.fresh || this.pct || this.entry !== '0';
    const all = hasEntry ? [...this.tokens, { t: 'n', v: this.entry, pct: this.pct }] : this.tokens;
    const v = evaluate(all);
    return Number.isFinite(v) ? format(v) : 'Not a number';
  }
  pRunning() {
    if (!this.tokens.length) return this.entry;
    const hasEntry = !this.fresh || this.pct || this.entry !== '0';
    const all = hasEntry ? [...this.tokens, { t: 'n', v: this.pParse(this.entry), pct: this.pct }] : this.tokens;
    let v;
    try { v = pEvaluate(all, this.pbits); } catch { return 'Not a number'; }
    return v.toString(this.pbase).toUpperCase();
  }
  get shown() { return this.running; }
  get expression() {
    if (!this.tokens.length) return '';
    let out = renderTokens(this.tokens, this.mode === 'prog' ? this.pbase : 0, false);
    if (!this.fresh || this.pct) {
      const e = this.mode === 'prog' ? this.entry : format(this.entry);
      if (out && !out.endsWith(' ')) out += ' ';
      out += e + (this.pct ? '%' : '');
    }
    return out;
  }
  paint() {
    const running = this.running;
    this.valEl.textContent = running;
    /* the digits shrink to fit the window, the way the real display does */
    const len = running.length;
    const size = len <= 9 ? 42 : len <= 12 ? 34 : len <= 16 ? 27 : len <= 22 ? 22 : 17;
    this.valEl.style.fontSize = size + 'px';
    this.exprEl.textContent = this.expression;
    this.exprEl.style.visibility = this.expression ? 'visible' : 'hidden';
    /* real macOS swaps this key between the word AC and the delete symbol */
    if (this.showAC()) { this.backIcon.textContent = 'AC'; this.backIcon.dataset.mode = 'ac'; }
    else { this.backIcon.innerHTML = deleteGlyph(); this.backIcon.dataset.mode = 'back'; }
    for (const op of ['+', '-', '*', '/']) this.keys[op]?.classList.toggle('armed', this.armed === op);
    this.paintInds();
    this.paintPad();
    if (this.convert) this.paintConv();
    if (this.mode === 'prog') { this.paintBits(); this.paintBases(); this.paintSegs(); }
  }
  paintInds() {
    const inds = [];
    if (this.mode === 'sci' && this.unit === 'rad') inds.push('Rad');
    if (this.mem !== 0 || this.pmem !== 0n) inds.push('M');
    this.indsEl.replaceChildren(...inds.map(t => el('span.calc-ind', { text: t })));
  }
  paintPad() {
    if (this.mode === 'sci') {
      for (const [k, ref] of Object.entries(this.fkeys)) {
        const spec = ref.spec;
        let label = spec.t || spec.k;
        if (spec.a) label = this.second ? spec.a.t : spec.t;
        if (k === 'unit') label = this.unit === 'rad' ? 'Rad' : 'Deg';
        ref.btn.firstChild.textContent = label;
        ref.btn.dataset.k = this.second && spec.a ? spec.a.k : spec.k;
        ref.btn.classList.toggle('armed', k === 'second' && this.second);
      }
    }
    if (this.mode === 'prog') {
      const rx = P_DIGITS[this.pbase];
      for (const [k, ref] of Object.entries(this.fkeys)) {
        if (/^[0-9A-F]$/.test(k)) ref.btn.classList.toggle('off', !rx.test(k));
      }
      for (const d of '0123456789') this.keys[d]?.classList.toggle('off', !rx.test(d));
      this.keys['.']?.classList.add('off');
    }
  }
  paintBits() {
    const v = this.pShownValue();
    const cells = [];
    for (let i = this.pbits - 1; i >= 0; i--) {
      const on = (v >> BigInt(i)) & 1n;
      cells.push(el('button.calc-bit' + (on ? '.on' : '') + (i % 4 === 3 && i !== this.pbits - 1 ? '.g' : ''), {
        text: on ? '1' : '0',
        title: `bit ${i}`,
        onclick: () => this.flipBit(i),
      }));
    }
    this.bitsEl.replaceChildren(...cells);
  }
  paintBases() {
    const v = this.pShownValue();
    this.baseEl.replaceChildren(...P_BASES.map(([b, name]) =>
      el('button.calc-base' + (b === this.pbase ? '.on' : ''), {
        dataset: { base: b },
        onclick: () => this.setBase(b),
      },
        el('span.calc-base-name', { text: name }),
        el('span.calc-base-val', { text: v.toString(b).toUpperCase() }))));
  }
  paintSegs() {
    for (const b of this.segEl.querySelectorAll('button')) {
      b.classList.toggle('on', Number(b.dataset.bits) === this.pbits);
    }
  }
  modeMenu(e) {
    contextMenu([
      { label: 'Basic', checked: this.mode === 'basic', action: () => this.setMode('basic') },
      { label: 'Scientific', checked: this.mode === 'sci', action: () => this.setMode('sci') },
      { label: 'Programmer', checked: this.mode === 'prog', action: () => this.setMode('prog') },
      { type: 'sep' },
      { label: this.histOn ? 'Hide History' : 'Show History', action: () => this.toggleHistory() },
    ], e.clientX, e.clientY);
  }
}

/** render a token list to the expression line; `closeAll` finishes open parens */
function renderTokens(tokens, base, closeAll) {
  let out = '';
  let open = 0;
  for (const t of tokens) {
    if (t.t === 'op') {
      if (out && !out.endsWith('(')) out = out.trimEnd() + ' ';
      out += (OP_GLYPH[t.v] || t.v) + ' ';
    } else if (t.t === 'open') { out += '('; open++; }
    else if (t.t === 'close') { out = out.trimEnd() + ') '; open--; }
    else {
      out += (base ? t.v.toString(base).toUpperCase() : format(t.v)) + (t.pct ? '%' : '');
    }
  }
  out = out.trimEnd();
  if (closeAll) while (open-- > 0) out += ')';
  return out;
}

/** macOS prints plain digits — no grouping — and moves to an exponent once
    the number outgrows the display */
function format(n) {
  const v = typeof n === 'string' ? (parseFloat(n) || 0) : n;
  if (!Number.isFinite(v)) return 'Not a number';
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e16 || abs < 1e-6)) {
    const [m, e] = v.toExponential(9).split('e');
    return `${m.replace(/\.?0+$/, '')}e${Number(e)}`;
  }
  const s = String(tidy(v));
  if (!s.includes('e')) return s;
  const [m, e] = s.split('e');
  return `${m}e${Number(e)}`;
}

/* history survives a reload; it is a tape, not just a session scratchpad */
function readHistory() {
  try {
    const h = JSON.parse(localStorage.getItem('calc.hist') || '[]');
    return Array.isArray(h) ? h : [];
  } catch { return []; }
}
function writeHistory(h) {
  try { localStorage.setItem('calc.hist', JSON.stringify(h)); } catch { /* full or private */ }
}

/** delete.left: the left-pointing tag with an × inside, as macOS draws it */
const deleteGlyph = () => `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6.1 3.3h7.2v9.4H6.1L1.9 8Z"/>
  <path d="M8.9 6.4 11.4 8.9M11.4 6.4 8.9 8.9" stroke-width="1.2"/>
</svg>`;
const modeGlyph = () => `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4.5h4M2.5 8h4M2.5 11.5h4"/><circle cx="11" cy="4.5" r="1.4"/><circle cx="11" cy="8" r="1.4"/><circle cx="11" cy="11.5" r="1.4"/></svg>`;
const swapGlyph = () => `<svg class="glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h9M13 6l-2.5-2.5M13 6l-2.5 2.5M12 10H3M3 10l2.5-2.5M3 10l2.5 2.5"/></svg>`;

export default meta;
