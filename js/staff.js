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

/**
 * @param {SVGSVGElement} svg
 * @param {{clef:'treble'|'bass', note?:object|null, notes?:object[], state?:''|'ok'|'bad', animate?:boolean}} opts
 * notes : plusieurs notes empilées (accord, mode libre). Le cadre s'agrandit si des notes sortent du cadre habituel.
 */
export function renderStaff(svg, { clef, note = null, notes = null, state = '', animate = false }) {
  const list = (notes || (note ? [note] : [])).slice().sort((a, b) => a.d - b.d || a.acc - b.acc);
  const yOf = n => BOT - (n.d - CLEFS[clef].bottom) * SP / 2;
  let vy = 0, vh = 210;
  if (list.length) {
    const yMin = yOf(list[list.length - 1]) - 40, yMax = yOf(list[0]) + 24;
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

  // Têtes : une seconde (ou un unisson) se décale à droite de la tige, comme en gravure.
  const shift = [];
  list.forEach((n, i) => { shift[i] = i > 0 && n.d - list[i - 1].d <= 1 && !shift[i - 1] ? 25 : 0; });
  const anyShift = shift.some(Boolean);

  const yLow = yOf(list[0]), yHigh = yOf(list[list.length - 1]);
  const lx1 = x - 20, lx2 = x + 20 + (anyShift ? 25 : 0);
  for (let ly = BOT + SP; ly <= yLow + 0.1; ly += SP) ng.appendChild(el('line', { class: 'ledger', x1: lx1, x2: lx2, y1: ly, y2: ly }));
  for (let ly = TOP - SP; ly >= yHigh - 0.1; ly -= SP) ng.appendChild(el('line', { class: 'ledger', x1: lx1, x2: lx2, y1: ly, y2: ly }));

  // Altérations : en colonnes, du haut vers le bas, pour ne pas se chevaucher.
  const cols = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (!n.acc) continue;
    let c = 0;
    while ((cols[c] || []).some(d => d - n.d < 6)) c++;
    (cols[c] = cols[c] || []).push(n.d);
    ng.appendChild(el('text', { class: 'acc', x: x - 34 - c * 24, y: yOf(n), 'font-size': 60, 'text-anchor': 'middle' }, ACC[n.acc]));
  }

  list.forEach((n, i) => {
    const hx = x + shift[i], y = yOf(n);
    const head = el('g', { class: 'note' });
    head.appendChild(el('ellipse', { cx: hx, cy: y, rx: 12.5, ry: 8.2 }));
    head.appendChild(el('ellipse', { class: 'hole', cx: hx, cy: y, rx: 5.2, ry: 6.6, transform: `rotate(-35 ${hx} ${y})` }));
    ng.appendChild(head);
  });
  svg.appendChild(ng);
}
