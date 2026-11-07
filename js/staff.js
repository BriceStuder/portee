// Rendu SVG de la portée : une note ou un accord (jeu, mode libre), ou une suite de notes et de silences qui défile.
import { CLEFS } from './theory.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (t, a = {}, txt) => {
  const e = document.createElementNS(NS, t);
  for (const k in a) e.setAttribute(k, a[k]);
  if (txt != null) e.textContent = txt;
  return e;
};

const VB_W = 520, TOP = 70, SP = 16, BOT = TOP + 4 * SP, MID = TOP + 2 * SP, NOTE_X = 300;
const ACC = { '1': '♯', '-1': '♭' };
// Crochet d'une croche, dessiné pour une hampe montante (origine au bout de la hampe).
const FLAG = 'M0 0C1 9 6 13 10 18C14 23 15 30 12 38C14 29 12 24 8 21C5 19 2 18 0 18Z';
// Silences (Noto Music, corps REST_F) : glyphe et ligne de base, calculée d'après la boîte du glyphe
// (hauteurs mesurées en fraction du corps) pour le placer comme en gravure.
const REST_F = 54;
const RESTS = {
  w: ['𝄻', TOP + SP + 0.525 * REST_F],  // pause : accrochée sous la 4e ligne
  h: ['𝄼', MID + 0.225 * REST_F],       // demi-pause : posée sur la ligne du milieu
  q: ['𝄽', BOT - 8 + 0.1 * REST_F],     // soupir : de la 4e ligne au bas de la portée
  e: ['𝄾', MID + 0.5 * REST_F],         // demi-soupir : centré sur la ligne du milieu
  s: ['𝄿', MID + 4 + 0.5 * REST_F],     // quart de soupir
};

function drawBase(svg, clef, vy, vh, w = VB_W) {
  const x2 = w - 16;
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 ${vy} ${w} ${vh}`);
  const g = el('g', { class: 'staff' });
  for (let i = 0; i < 5; i++) g.appendChild(el('line', { x1: 16, x2, y1: TOP + i * SP, y2: TOP + i * SP }));
  g.appendChild(el('line', { x1: 16, x2: 16, y1: TOP, y2: BOT }));
  svg.appendChild(g);
  // Positions calées sur la police Noto Music : la ligne de base des clés tombe sur la ligne du bas.
  if (clef === 'treble') svg.appendChild(el('text', { class: 'clef', x: 26, y: BOT + 1, 'font-size': 68 }, '𝄞'));
  else svg.appendChild(el('text', { class: 'clef', x: 30, y: TOP + SP * 3.5, 'font-size': 66 }, '𝄢'));
}

/** Géométrie d'un accord (ou d'une note) : sens de la hampe, décalages, étendue verticale et horizontale. */
function layout(notes, value, clef) {
  const list = notes.slice().sort((a, b) => a.d - b.d || a.acc - b.acc);
  const yOf = n => BOT - (n.d - CLEFS[clef].bottom) * SP / 2;
  const type = value?.type || 'w', dot = !!value?.dot;
  const yLow = yOf(list[0]), yHigh = yOf(list[list.length - 1]);
  // Hampe vers le bas si les notes sont plutôt au-dessus de la ligne du milieu.
  const up = type === 'w' ? true : (yLow + yHigh) / 2 >= MID;
  // Têtes : une seconde (ou un unisson) se décale de l'autre côté de la hampe, comme en gravure.
  const W = type === 'w' ? 25 : 20;
  const shift = list.map(() => 0);
  if (up) list.forEach((n, i) => { if (i > 0 && n.d - list[i - 1].d <= 1 && !shift[i - 1]) shift[i] = W; });
  else for (let i = list.length - 2; i >= 0; i--) if (list[i + 1].d - list[i].d <= 1 && !shift[i + 1]) shift[i] = -W;
  const right = shift.some(v => v > 0), left = shift.some(v => v < 0);
  // Altérations : en colonnes, du haut vers le bas, pour ne pas se chevaucher.
  const cols = [], accs = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (!n.acc) continue;
    let c = 0;
    while ((cols[c] || []).some(d => d - n.d < 6)) c++;
    (cols[c] = cols[c] || []).push(n.d);
    accs.push([n, c]);
  }
  const stem = type !== 'w';
  const stemEnd = up ? Math.min(yHigh - 56, MID) : Math.max(yLow + 56, MID);
  const flags = type === 'e' ? 1 : type === 's' ? 2 : 0;
  return {
    list, yOf, type, dot, up, W, shift, right, left, accs, stem, stemEnd, flags, clef,
    top: stem && up ? stemEnd : yHigh - 10,
    bottom: stem && !up ? stemEnd : yLow + 10,
    // Place occupée à gauche et à droite du centre de la note
    wl: 16 + (left ? W : 0) + (cols.length ? 20 + cols.length * 24 : 0),
    wr: 16 + (right ? W : 0) + (dot ? 14 : 0) + (flags && up ? 12 : 0),
  };
}

function drawChord(parent, L, x) {
  const { list, yOf, type, dot, up, W, shift, right, left } = L;
  const yLow = yOf(list[0]), yHigh = yOf(list[list.length - 1]);
  const lx1 = x - 20 - (left ? W : 0), lx2 = x + 20 + (right ? W : 0);
  for (let ly = BOT + SP; ly <= yLow + 0.1; ly += SP) parent.appendChild(el('line', { class: 'ledger', x1: lx1, x2: lx2, y1: ly, y2: ly }));
  for (let ly = TOP - SP; ly >= yHigh - 0.1; ly -= SP) parent.appendChild(el('line', { class: 'ledger', x1: lx1, x2: lx2, y1: ly, y2: ly }));

  const ax = x - 34 - (left ? W : 0) + (type === 'w' ? 0 : 3);
  for (const [n, c] of L.accs) parent.appendChild(el('text', { class: 'acc', x: ax - c * 24, y: yOf(n), 'font-size': 60, 'text-anchor': 'middle' }, ACC[n.acc]));

  const g = el('g', { class: 'note' });
  list.forEach((n, i) => {
    const hx = x + shift[i], y = yOf(n);
    if (type === 'w') {
      g.appendChild(el('ellipse', { cx: hx, cy: y, rx: 12.5, ry: 8.2 }));
      g.appendChild(el('ellipse', { class: 'hole', cx: hx, cy: y, rx: 5.2, ry: 6.6, transform: `rotate(-35 ${hx} ${y})` }));
    } else {
      g.appendChild(el('ellipse', { cx: hx, cy: y, rx: 10.2, ry: 7.2, transform: `rotate(-22 ${hx} ${y})` }));
      if (type === 'h') g.appendChild(el('ellipse', { class: 'hole', cx: hx, cy: y, rx: 7.6, ry: 3.2, transform: `rotate(-28 ${hx} ${y})` }));
    }
    if (dot) {
      const onLine = (n.d - CLEFS[L.clef].bottom) % 2 === 0;
      g.appendChild(el('circle', { cx: x + (right ? W : 0) + (type === 'w' ? 22 : 18), cy: onLine ? y - SP / 2 : y, r: 3 }));
    }
  });
  if (L.stem) {
    const sx = up ? x + 9.4 : x - 9.4;
    const y0 = up ? yLow : yHigh, y1 = L.stemEnd;
    g.appendChild(el('rect', { x: sx - 0.9, y: Math.min(y0, y1), width: 1.8, height: Math.abs(y1 - y0) }));
    for (let f = 0; f < L.flags; f++) {
      const fy = up ? y1 + f * 11 : y1 - f * 11;
      g.appendChild(el('path', { d: FLAG, transform: `translate(${sx + (up ? 0.9 : -0.9)} ${fy}) scale(1 ${up ? 1 : -1})` }));
    }
  }
  parent.appendChild(g);
}

function drawRest(parent, value, x) {
  const [glyph, y] = RESTS[value.type];
  const g = el('g', { class: 'rest' });
  g.appendChild(el('text', { x, y, 'font-size': REST_F, 'text-anchor': 'middle' }, glyph));
  if (value.dot) g.appendChild(el('circle', { cx: x + (value.type === 'w' || value.type === 'h' ? 20 : 14), cy: MID - SP / 2, r: 3 }));
  parent.appendChild(g);
}

/**
 * Une note ou un accord, au centre de la portée.
 * @param {SVGSVGElement} svg
 * @param {{clef:'treble'|'bass', note?:object|null, notes?:object[], value?:{type:'w'|'h'|'q'|'e'|'s', dot?:boolean}|null,
 *          label?:string, labelKind?:'chord'|'interval', state?:''|'ok'|'bad', animate?:boolean}} opts
 * notes : plusieurs notes empilées (accord). value : figure de note (ronde par défaut).
 * label : nom d'accord ou d'intervalle, écrit au-dessus. Le cadre s'agrandit si des notes en sortent.
 */
export function renderStaff(svg, { clef, note = null, notes = null, value = null, label = '', labelKind = 'chord', state = '', animate = false }) {
  const list = notes || (note ? [note] : []);
  const L = list.length ? layout(list, value, clef) : null;
  let vy = 0, vh = 210, labelY = 0;
  if (L) {
    labelY = Math.min(TOP - 26, L.top - 16);
    const yMin = label ? labelY - 30 : L.top - 24;
    const yMax = L.bottom + 14;
    if (yMin < vy) { vh += vy - yMin; vy = yMin; }
    if (yMax > vy + vh) vh = yMax - vy;
  }
  drawBase(svg, clef, vy, vh);
  delete svg._seqOffset;
  svg.setAttribute('class', state ? 'state-' + state : '');
  if (!L) return;
  const ng = el('g', { id: 'noteGroup', class: animate ? 'enter' : '' });
  drawChord(ng, L, NOTE_X);
  if (label) ng.appendChild(el('text', { class: 'chord-label ' + labelKind, x: NOTE_X, y: labelY, 'text-anchor': 'middle' }, label));
  svg.appendChild(ng);
}

const SEQ_X0 = 112, GAP = 22;

/**
 * Suite de notes et de silences qui défile vers la gauche : la dernière reste visible à droite.
 * @param {SVGSVGElement} svg
 * @param {{clef:'treble'|'bass', events:{rest?:boolean, notes?:object[], value?:object|null, label?:string, live?:boolean}[], width?:number}} opts
 * width : largeur du cadre (plus large que d'habitude sur un écran en paysage, pour voir plus de notes).
 */
export function renderSequence(svg, { clef, events, width = VB_W }) {
  const SEQ_RIGHT = width - 40;
  // Placement horizontal : chaque élément prend la place de ses altérations, points, crochets et de son nom d'accord.
  let x = SEQ_X0, prevR = 0;
  const items = events.map((e, i) => {
    const L = e.rest ? null : layout(e.notes, e.value, clef);
    const lw = e.label ? e.label.length * 4.6 + 4 : 0; // demi-largeur approximative du nom d'accord
    const wl = Math.max(L ? L.wl : 14, lw), wr = Math.max(L ? L.wr : (e.value?.dot ? 24 : 14), lw);
    if (i) x += prevR + GAP + wl;
    prevR = wr;
    return { e, L, x };
  });
  const last = items[items.length - 1];
  const offset = last ? Math.min(0, SEQ_RIGHT - last.x) : 0;
  const visible = items.filter(it => it.x + offset > SEQ_X0 - 80);

  // Cadre vertical : on l'agrandit pour les notes visibles qui sortent de la portée.
  let top = TOP - 24, bottom = BOT + 14;
  for (const it of visible) if (it.L) { top = Math.min(top, it.L.top - 6); bottom = Math.max(bottom, it.L.bottom + 4); }
  const hasLabel = visible.some(it => it.e.label);
  const labelY = Math.min(TOP - 26, top - 10);
  let vy = 0, vh = 210;
  const yMin = hasLabel ? labelY - 30 : top - 18, yMax = bottom + 10;
  if (yMin < vy) { vh += vy - yMin; vy = yMin; }
  if (yMax > vy + vh) vh = yMax - vy;
  drawBase(svg, clef, vy, vh, width);
  svg.setAttribute('class', 'seq');

  // Les éléments qui partent à gauche s'effacent en fondu avant d'atteindre la clé.
  const defs = el('defs');
  defs.innerHTML = `<linearGradient id="seqFade" gradientUnits="userSpaceOnUse" x1="${SEQ_X0 - 60}" x2="${SEQ_X0 - 10}" y1="0" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
    <mask id="seqMask" maskUnits="userSpaceOnUse" x="0" y="${vy}" width="${width}" height="${vh}">
      <rect x="${SEQ_X0 - 60}" y="${vy}" width="${width}" height="${vh}" fill="url(#seqFade)"/></mask>`;
  svg.appendChild(defs);
  const clip = el('g', { mask: 'url(#seqMask)' });
  const g = el('g', { class: 'seq-notes' });
  for (const { e, L, x: ex } of visible) {
    const eg = el('g', { class: e.live ? 'live' : '' });
    if (e.rest) drawRest(eg, e.value, ex);
    else drawChord(eg, L, ex);
    if (e.label) eg.appendChild(el('text', { class: 'chord-label small', x: ex, y: labelY, 'text-anchor': 'middle' }, e.label));
    g.appendChild(eg);
  }
  clip.appendChild(g);
  svg.appendChild(clip);

  // Défilement en douceur : on part de l'ancien décalage et on glisse vers le nouveau.
  const prev = svg._seqOffset ?? offset;
  svg._seqOffset = offset;
  g.style.transform = `translateX(${prev}px)`;
  if (prev !== offset) {
    requestAnimationFrame(() => {
      g.style.transition = 'transform .28s cubic-bezier(.3,.7,.4,1)';
      g.style.transform = `translateX(${offset}px)`;
    });
  } else g.style.transform = `translateX(${offset}px)`;
}

/** À appeler quand on quitte l'affichage en suite (le prochain rendu repart sans animation). */
export function resetSequence(svg) { delete svg._seqOffset; }
