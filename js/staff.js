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
 * @param {{clef:'treble'|'bass', note?:object|null, state?:''|'ok'|'bad', animate?:boolean}} opts
 */
export function renderStaff(svg, { clef, note = null, state = '', animate = false }) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', '0 0 520 210');
  svg.setAttribute('class', state ? 'state-' + state : '');

  const g = el('g', { class: 'staff' });
  for (let i = 0; i < 5; i++) g.appendChild(el('line', { x1: 16, x2: 504, y1: TOP + i * SP, y2: TOP + i * SP }));
  g.appendChild(el('line', { x1: 16, x2: 16, y1: TOP, y2: BOT }));
  svg.appendChild(g);

  // Positions calées sur la police Noto Music : la ligne de base des clés tombe sur la ligne du bas.
  if (clef === 'treble') svg.appendChild(el('text', { class: 'clef', x: 26, y: BOT + 1, 'font-size': 68 }, '𝄞'));
  else svg.appendChild(el('text', { class: 'clef', x: 30, y: TOP + SP * 3.5, 'font-size': 66 }, '𝄢'));

  if (!note) return;
  const y = BOT - (note.d - CLEFS[clef].bottom) * SP / 2;
  const x = NOTE_X;
  const ng = el('g', { id: 'noteGroup', class: animate ? 'enter' : '' });
  for (let ly = BOT + SP; ly <= y + 0.1; ly += SP) ng.appendChild(el('line', { class: 'ledger', x1: x - 20, x2: x + 20, y1: ly, y2: ly }));
  for (let ly = TOP - SP; ly >= y - 0.1; ly -= SP) ng.appendChild(el('line', { class: 'ledger', x1: x - 20, x2: x + 20, y1: ly, y2: ly }));
  if (note.acc) ng.appendChild(el('text', { class: 'acc', x: x - 34, y, 'font-size': 60, 'text-anchor': 'middle' }, ACC[note.acc]));
  const head = el('g', { class: 'note' });
  head.appendChild(el('ellipse', { cx: x, cy: y, rx: 12.5, ry: 8.2 }));
  head.appendChild(el('ellipse', { class: 'hole', cx: x, cy: y, rx: 5.2, ry: 6.6, transform: `rotate(-35 ${x} ${y})` }));
  ng.appendChild(head);
  svg.appendChild(ng);
}
