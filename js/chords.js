// Reconnaissance des accords et des intervalles à partir des touches jouées (numéros MIDI).
import { PC_SHARP_FR, PC_FLAT_FR, PC_SHARP_EN, PC_FLAT_EN } from './theory.js';

// [intervalles depuis la fondamentale, suffixe du symbole, nom en toutes lettres]
// L'ordre sert à départager plusieurs lectures possibles du même ensemble de notes.
const CHORDS = [
  [[0, 4, 7], '', 'majeur'],
  [[0, 3, 7], 'm', 'mineur'],
  [[0, 3, 6], 'dim', 'diminué'],
  [[0, 4, 8], 'aug', 'augmenté'],
  [[0, 4, 7, 10], '7', 'septième de dominante'],
  [[0, 4, 7, 11], 'maj7', 'septième majeure'],
  [[0, 3, 7, 10], 'm7', 'mineur septième'],
  [[0, 3, 6, 10], 'm7♭5', 'demi-diminué'],
  [[0, 3, 6, 9], 'dim7', 'septième diminuée'],
  [[0, 3, 7, 11], 'm(maj7)', 'mineur septième majeure'],
  [[0, 5, 7], 'sus4', 'quarte suspendue'],
  [[0, 2, 7], 'sus2', 'seconde suspendue'],
  [[0, 4, 7, 9], '6', 'sixte'],
  [[0, 3, 7, 9], 'm6', 'mineur sixte'],
  [[0, 5, 7, 10], '7sus4', 'septième quarte suspendue'],
  [[0, 4, 8, 10], '7♯5', 'septième quinte augmentée'],
  [[0, 4, 6, 10], '7♭5', 'septième quinte diminuée'],
  [[0, 2, 4, 7], 'add9', 'neuvième ajoutée'],
  [[0, 2, 3, 7], 'm(add9)', 'mineur neuvième ajoutée'],
  [[0, 2, 4, 7, 10], '9', 'neuvième'],
  [[0, 2, 4, 7, 11], 'maj9', 'neuvième majeure'],
  [[0, 2, 3, 7, 10], 'm9', 'mineur neuvième'],
  [[0, 1, 4, 7, 10], '7♭9', 'septième neuvième mineure'],
  [[0, 2, 4, 7, 9], '6/9', 'sixte neuvième'],
  // Quinte omise, fréquent au piano
  [[0, 4, 10], '7', 'septième de dominante, sans quinte'],
  [[0, 3, 10], 'm7', 'mineur septième, sans quinte'],
  [[0, 4, 11], 'maj7', 'septième majeure, sans quinte'],
  [[0, 2, 4, 10], '9', 'neuvième, sans quinte'],
];

const INTERVALS = ['unisson', 'seconde mineure', 'seconde majeure', 'tierce mineure', 'tierce majeure', 'quarte juste',
  'triton', 'quinte juste', 'sixte mineure', 'sixte majeure', 'septième mineure', 'septième majeure', 'octave'];

const INVERSIONS = { 3: '1er renversement', 4: '1er renversement', 6: '2e renversement', 7: '2e renversement', 8: '2e renversement',
  9: '3e renversement', 10: '3e renversement', 11: '3e renversement' };

const pcName = (pc, notation, spell) => {
  const fr = (spell === 'flat' ? PC_FLAT_FR : PC_SHARP_FR)[pc], en = (spell === 'flat' ? PC_FLAT_EN : PC_SHARP_EN)[pc];
  return { fr, en };
};

function symbol(root, suffix, bass, notation, spell) {
  const r = pcName(root, notation, spell), b = bass == null ? null : pcName(bass, notation, spell);
  // En français, une espace sépare le nom de la note du suffixe pour rester lisible (« La m7 », « Do 7 »).
  const fr = r.fr + (suffix ? ' ' + suffix : '') + (b ? '/' + b.fr : '');
  const en = r.en + suffix + (b ? '/' + b.en : '');
  return notation === 'fr' ? fr : notation === 'en' ? en : `${fr}  ·  ${en}`;
}

/**
 * @param {number[]} midis touches jouées
 * @returns {{kind:'chord'|'interval', label:string, desc:string}|null}
 */
export function analyse(midis, notation = 'fr', spell = 'sharp') {
  const sorted = [...new Set(midis)].sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const pcs = [...new Set(sorted.map(m => m % 12))];
  const bass = sorted[0] % 12;

  if (pcs.length === 1) {
    const n = (sorted[sorted.length - 1] - sorted[0]) / 12;
    return { kind: 'interval', label: n === 1 ? 'Octave' : `${n} octaves`, desc: '' };
  }
  if (pcs.length === 2) {
    // Intervalle entre la basse et la plus grave des notes de l'autre hauteur (les doublures à l'octave sont ignorées).
    const top = sorted.find(m => m % 12 !== bass);
    const span = top - sorted[0], oct = Math.floor(span / 12), name = INTERVALS[span % 12];
    return { kind: 'interval', label: name[0].toUpperCase() + name.slice(1), desc: oct ? `+ ${oct} octave${oct > 1 ? 's' : ''}` : '' };
  }

  let best = null;
  for (const root of pcs) {
    const set = pcs.map(p => (p - root + 12) % 12).sort((a, b) => a - b).join(',');
    const i = CHORDS.findIndex(c => c[0].join(',') === set);
    if (i < 0) continue;
    // Priorité à la lecture dont la fondamentale est à la basse, puis à l'ordre de la liste.
    const score = (root === bass ? 0 : 100) + i;
    if (!best || score < best.score) best = { root, i, score };
  }
  if (!best) return null;
  const [, suffix, name] = CHORDS[best.i];
  const inv = best.root === bass ? '' : INVERSIONS[(bass - best.root + 12) % 12] || 'basse ' + pcName(bass, notation, spell).fr;
  return {
    kind: 'chord',
    label: symbol(best.root, suffix, best.root === bass ? null : bass, notation, spell),
    desc: [name, inv].filter(Boolean).join(', '),
  };
}
