// Clavier de piano SVG : construction, marquage des touches, saisie souris / tactile.
import { isBlack, PC_SHARP_FR, PC_FLAT_FR, PC_SHARP_EN, PC_FLAT_EN } from './theory.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (t, a = {}, txt) => {
  const e = document.createElementNS(NS, t);
  for (const k in a) e.setAttribute(k, a[k]);
  if (txt != null) e.textContent = txt;
  return e;
};
const pick = (notation, fr, en, sep) => notation === 'fr' ? fr : notation === 'en' ? en : fr + sep + en;

export class Keyboard {
  constructor(svg, wrap, onPress) {
    this.svg = svg;
    this.wrap = wrap;
    this.onPress = onPress;
    this.keys = new Map();
    this.simple = false;

    svg.addEventListener('pointerdown', e => {
      const k = e.target.closest('[data-midi]');
      if (!k) return;
      e.preventDefault();
      const m = +k.dataset.midi;
      this.down(m);
      this.onPress(m);
      const up = () => {
        this.up(m);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  /** Construit les touches de lo à hi (numéros MIDI). En mode simple : une octave, 60–71. */
  build({ lo, hi, simple, names, notation }) {
    const svg = this.svg;
    svg.innerHTML = '';
    this.keys.clear();
    this.simple = simple;
    if (simple) [lo, hi] = [60, 71];

    const kw = simple ? 80 : 40, kh = simple ? 160 : 150, bw = kw * 0.58, bh = kh * 0.62;
    const defs = el('defs');
    defs.innerHTML = `
      <linearGradient id="gWhite" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--wk2)"/><stop offset=".12" stop-color="var(--wk1)"/><stop offset="1" stop-color="var(--wk2)"/>
      </linearGradient>
      <linearGradient id="gBlack" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--bk2)"/><stop offset=".85" stop-color="var(--bk1)"/><stop offset="1" stop-color="#55514c"/>
      </linearGradient>`;
    svg.appendChild(defs);

    const both = notation === 'both';
    let wi = 0;
    const blacks = [];
    for (let m = lo; m <= hi; m++) {
      const pc = m % 12;
      if (isBlack(pc)) { blacks.push([m, wi * kw - bw / 2]); continue; }
      const x = wi * kw;
      const r = el('rect', { class: 'wk', x: x + 0.5, y: -4, width: kw - 1, height: kh + 4, rx: simple ? 6 : 4, 'data-midi': m });
      svg.appendChild(r);
      this.keys.set(m, r);
      if (names) {
        const isC = pc === 0;
        const oct = !simple && isC ? String(Math.floor(m / 12) - 1) : '';
        const fr = PC_SHARP_FR[pc] + oct, en = PC_SHARP_EN[pc] + oct;
        const c = 'klabel' + (isC && !simple ? ' c' : '') + (simple ? ' big' : '');
        if (both) {
          svg.appendChild(el('text', { class: c, x: x + kw / 2, y: kh - 12 }, fr));
          svg.appendChild(el('text', { class: c + ' en', x: x + kw / 2, y: kh - (simple ? 32 : 26) }, en));
        } else {
          svg.appendChild(el('text', { class: c, x: x + kw / 2, y: kh - 14 }, pick(notation, fr, en)));
        }
      }
      wi++;
    }
    for (const [m, x] of blacks) {
      const pc = m % 12;
      const r = el('rect', { class: 'bk', x, y: -4, width: bw, height: bh + 4, rx: 3, 'data-midi': m });
      svg.appendChild(r);
      this.keys.set(m, r);
      svg.appendChild(el('rect', { class: 'bk-shine', x: x + 3, y: 0, width: bw - 6, height: bh - 14, rx: 2 }));
      if (names && simple) {
        const sm = both ? ' sm' : '';
        svg.appendChild(el('text', { class: 'blabel' + sm, x: x + bw / 2, y: bh - 30 }, pick(notation, PC_SHARP_FR[pc], PC_SHARP_EN[pc], ' · ')));
        svg.appendChild(el('text', { class: 'blabel' + sm, x: x + bw / 2, y: bh - 14 }, pick(notation, PC_FLAT_FR[pc], PC_FLAT_EN[pc], ' · ')));
      }
    }
    svg.setAttribute('viewBox', `0 0 ${wi * kw} ${kh}`);
    // Sur petit écran, le clavier complet défile horizontalement plutôt que d'avoir des touches minuscules.
    svg.style.minWidth = simple ? '' : `${wi * 26}px`;
    this.wrap.style.setProperty('--kb-ratio', (wi * kw / kh).toFixed(3)); // utilisé pour plafonner la hauteur
    this.wrap.classList.toggle('simple', simple);
    requestAnimationFrame(() => { this.wrap.scrollLeft = (this.wrap.scrollWidth - this.wrap.clientWidth) / 2; });
  }

  key(m) {
    return this.keys.get(this.simple ? 60 + (((m % 12) + 12) % 12) : m);
  }
  mark(m, cls) { this.key(m)?.classList.add(...cls.split(' ')); }
  clearMarks() { this.keys.forEach(k => k.classList.remove('ok', 'bad', 'hint')); }
  down(m) { this.key(m)?.classList.add('down'); }
  up(m) { this.key(m)?.classList.remove('down'); }
}
