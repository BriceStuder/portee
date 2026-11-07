// Rendu SVG de la portée et de la note (ronde).
import { CLEFS } from './theory.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (t, a = {}, txt) => {
  const e = document.createElementNS(NS, t);
  for (const k in a) e.setAttribute(k, a[k]);
  if (txt != null) e.textContent = txt;
  return e;
};

const TOP = 70, SP = 16, BOT = TOP + 4 * SP, NOTE_X = 300;
const ACC = { '1': '♯', '-1': '♭' };

const MID = TOP + 2 * SP;
// Crochet d'une croche, dessiné pour une hampe montante (origine au bout de la hampe).
const FLAG = 'M0 0C1 9 6 13 10 18C14 23 15 30 12 38C14 29 12 24 8 21C5 19 2 18 0 18Z';

/**
 * @param {SVGSVGElement} svg
 * @param {{clef:'treble'|'bass', note?:object|null, notes?:object[], value?:{type:'w'|'h'|'q'|'e'|'s', dot?:boolean}|null, state?:''|'ok'|'bad', animate?:boolean}} opts
 * notes : plusieurs notes empilées (accord, mode libre). Le cadre s'agrandit si des notes sortent du cadre habituel.
 * value : figure de note (ronde par défaut).
 * label : nom d'accord ou d'intervalle, écrit au-dessus des notes.
 */
export function renderStaff(svg, { clef, note = null, notes = null, value = null, label = '', labelKind = 'chord', state = '', animate = false }) {
  const list = (notes || (note ? [note] : [])).slice().sort((a, b) => a.d - b.d || a.acc - b.acc);
  const yOf = n => BOT - (n.d - CLEFS[clef].bottom) * SP / 2;
  let vy = 0, vh = 210, labelY = 0;
  if (list.length) {
    const lo = yOf(list[0]), hi = yOf(list[list.length - 1]);
    const stem = (value?.type || 'w') !== 'w', stemUp = (lo + hi) / 2 >= MID;
    const top = stem && stemUp ? Math.min(hi - 56, MID) : hi - 10;
    labelY = Math.min(TOP - 26, top - 26);
    const yMin = label ? labelY - 30 : top - (stem && stemUp ? 34 : 24);
    const yMax = (stem && !stemUp ? Math.max(lo + 56, MID) : lo) + 24;
    if (yMin < vy) { vh += vy - yMin; vy = yMin; }
    if (yMax > vy + vh) vh = yMax - vy;
  }
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 ${vy} 520 ${vh}`);
  svg.setAttribute('class', state ? 'state-' + state : '');

  const g = el('g', { class: 'staff' });
  for (let i = 0; i < 5; i++) g.appendChild(el('line', { x1: 16, x2: 504, y1: TOP + i * SP, y2: TOP + i * SP }));
  g.appendChild(el('line', { x1: 16, x2: 16, y1: TOP, y2: BOT }));
  svg.appendChild(g);

  // Positions calées sur la police Noto Music : la ligne de base des clés tombe sur la ligne du bas.
  if (clef === 'treble') svg.appendChild(el('text', { class: 'clef', x: 26, y: BOT + 1, 'font-size': 68 }, '𝄞'));
  else svg.appendChild(el('text', { class: 'clef', x: 30, y: TOP + SP * 3.5, 'font-size': 66 }, '𝄢'));

  if (!list.length) return;
  const x = NOTE_X;
  const ng = el('g', { id: 'noteGroup', class: animate ? 'enter' : '' });

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

  const lx1 = x - 20 - (left ? W : 0), lx2 = x + 20 + (right ? W : 0);
  for (let ly = BOT + SP; ly <= yLow + 0.1; ly += SP) ng.appendChild(el('line', { class: 'ledger', x1: lx1, x2: lx2, y1: ly, y2: ly }));
  for (let ly = TOP - SP; ly >= yHigh - 0.1; ly -= SP) ng.appendChild(el('line', { class: 'ledger', x1: lx1, x2: lx2, y1: ly, y2: ly }));

  // Altérations : en colonnes, du haut vers le bas, pour ne pas se chevaucher.
  const ax = x - 34 - (left ? W : 0) + (type === 'w' ? 0 : 3);
  const cols = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (!n.acc) continue;
    let c = 0;
    while ((cols[c] || []).some(d => d - n.d < 6)) c++;
    (cols[c] = cols[c] || []).push(n.d);
    ng.appendChild(el('text', { class: 'acc', x: ax - c * 24, y: yOf(n), 'font-size': 60, 'text-anchor': 'middle' }, ACC[n.acc]));
  }

  const notesG = el('g', { class: 'note' });
  list.forEach((n, i) => {
    const hx = x + shift[i], y = yOf(n);
    if (type === 'w') {
      notesG.appendChild(el('ellipse', { cx: hx, cy: y, rx: 12.5, ry: 8.2 }));
      notesG.appendChild(el('ellipse', { class: 'hole', cx: hx, cy: y, rx: 5.2, ry: 6.6, transform: `rotate(-35 ${hx} ${y})` }));
    } else {
      notesG.appendChild(el('ellipse', { cx: hx, cy: y, rx: 10.2, ry: 7.2, transform: `rotate(-22 ${hx} ${y})` }));
      if (type === 'h') notesG.appendChild(el('ellipse', { class: 'hole', cx: hx, cy: y, rx: 7.6, ry: 3.2, transform: `rotate(-28 ${hx} ${y})` }));
    }
    if (dot) {
      const onLine = (n.d - CLEFS[clef].bottom) % 2 === 0;
      notesG.appendChild(el('circle', { cx: x + (right ? W : 0) + (type === 'w' ? 22 : 18), cy: onLine ? y - SP / 2 : y, r: 3 }));
    }
  });

  if (type !== 'w') {
    const sx = up ? x + 9.4 : x - 9.4;
    const y0 = up ? yLow : yHigh;
    const y1 = up ? Math.min(yHigh - 56, MID) : Math.max(yLow + 56, MID);
    notesG.appendChild(el('rect', { x: sx - 0.9, y: Math.min(y0, y1), width: 1.8, height: Math.abs(y1 - y0) }));
    const flags = type === 'e' ? 1 : type === 's' ? 2 : 0;
    for (let f = 0; f < flags; f++) {
      const fy = up ? y1 + f * 11 : y1 - f * 11;
      notesG.appendChild(el('path', { d: FLAG, transform: `translate(${sx + (up ? 0.9 : -0.9)} ${fy}) scale(1 ${up ? 1 : -1})` }));
    }
  }
  ng.appendChild(notesG);
  if (label) ng.appendChild(el('text', { class: 'chord-label ' + labelKind, x, y: labelY, 'text-anchor': 'middle' }, label));
  svg.appendChild(ng);
}
