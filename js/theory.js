// Modèle musical : notes, noms, étendues.
// Une note est repérée par son degré diatonique d = octave*7 + lettre (Do=0 … Si=6)
// et une altération acc (-1 bémol, 0, +1 dièse).

export const LETTERS_FR = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
export const LETTERS_EN = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEPS = [0, 2, 4, 5, 7, 9, 11];
const SYM = { '-1': '♭', '0': '', '1': '♯' };

export const PC_SHARP_FR = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
export const PC_FLAT_FR = ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
export const PC_SHARP_EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const PC_FLAT_EN = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const isBlack = pc => [1, 3, 6, 8, 10].includes(pc);

// Ligne du bas et ligne du haut de chaque clé (en degrés diatoniques)
export const CLEFS = {
  treble: { bottom: 4 * 7 + 2, top: 5 * 7 + 3 }, // Mi4 … Fa5
  bass: { bottom: 2 * 7 + 4, top: 3 * 7 + 5 },   // Sol2 … La3
};

export function makeNote(d, acc = 0) {
  const letter = ((d % 7) + 7) % 7;
  const oct = Math.floor(d / 7);
  return { d, letter, oct, acc, midi: 12 * (oct + 1) + STEPS[letter] + acc };
}

// Mi♯, Si♯, Fa♭, Do♭
export const isRare = n =>
  (n.acc === 1 && (n.letter === 2 || n.letter === 6)) ||
  (n.acc === -1 && (n.letter === 3 || n.letter === 0));

// Autre écriture de la même touche (Do♯ ↔ Ré♭), ou null
export function enharmonic(n) {
  if (n.acc === 0) return null;
  const d = n.d + n.acc;
  const nat = makeNote(d, 0);
  const acc = n.midi - nat.midi;
  return Math.abs(acc) <= 1 ? makeNote(d, acc) : null;
}

export function noteName(n, notation, sep = ' / ') {
  const fr = `${LETTERS_FR[n.letter]}${SYM[n.acc]} ${n.oct}`;
  const en = `${LETTERS_EN[n.letter]}${SYM[n.acc]}${n.oct}`;
  return notation === 'fr' ? fr : notation === 'en' ? en : fr + sep + en;
}

// Étendue des notes tirées : ext = 0 (portée + notes juste au-dessus/au-dessous) ou nombre de lignes supplémentaires
export function noteRange(clef, ext) {
  const { bottom, top } = CLEFS[clef];
  return ext ? [bottom - 2 * ext, top + 2 * ext] : [bottom - 1, top + 1];
}

// Touches du clavier « octave stricte » : couvre toutes les notes possibles,
// commence sur un Do ou un Fa et finit sur un Mi ou un Si (bords naturels, sans touche noire coupée).
export function keyboardRange(clef, ext, accidentals) {
  const [lo, hi] = noteRange(clef, ext);
  let a = makeNote(lo, accidentals ? -1 : 0).midi;
  let b = makeNote(hi, accidentals ? 1 : 0).midi;
  while (![0, 5].includes(a % 12)) a--;
  while (![4, 11].includes(b % 12)) b++;
  return [a, b];
}
