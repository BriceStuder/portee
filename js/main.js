// Contrôleur : réglages, déroulement du jeu, liaison interface ↔ clavier ↔ MIDI.
import { makeNote, fromMidi, noteName, enharmonic, isRare, noteRange, keyboardRange, LETTERS_FR, LETTERS_EN } from './theory.js';
import { renderStaff, renderSequence, systemHeight } from './staff.js';
import { Keyboard } from './keyboard.js';
import { playNote, click, audioNow, audioLatency } from './audio.js';
import { initMidi } from './midi.js';
import { analyse } from './chords.js';
import { load, save } from './store.js';
import { CLEFS } from './theory.js';

// ---------- constantes de jeu ----------
const ACC_RATIO = 0.35;   // part des notes altérées quand les altérations sont actives
const INF_START = 5;      // mode infini : secondes par note au départ
const INF_MIN = 0.8;      // … plancher
const INF_FACTOR = 0.96;  // … facteur appliqué à chaque bonne réponse
const LIVES = 3;
const OK_DELAY = 450, BAD_DELAY = 1400; // pause (ms) avant la note suivante

const DEFAULTS = {
  activity: 'game', spell: 'sharp', autoClef: true, durations: true, tempo: 80, metre: '4/4', chords: true, wake: true, scroll: true, rests: true, split: 60, dynamics: true,
  clef: 'treble', mode: 'series', seriesLength: 20, time: 5, kb: 'strict',
  names: true, notation: 'fr', accidentals: true, rare: false, range: 2, sound: true, hideKb: true, theme: null,
};
const S = { ...DEFAULTS, ...load('settings', {}) };
// Ancien réglage « portée double » du mode libre : devenu le choix de clé « les deux ».
if ('grand' in S) { if (S.grand && S.activity === 'free') S.clef = 'both'; delete S.grand; }
let stats = load('stats', {});
let best = load('best', {});

const $ = s => document.querySelector(s);
const staffSvg = $('#staff');
const kb = new Keyboard($('#keys'), $('#keysWrap'), m => press(m, 'screen'), m => release(m));
const midi = { supported: true, names: [] };

// ---------- état de la partie ----------
const fresh = () => ({ phase: 'idle', note: null, idx: 0, score: 0, lives: LIVES, speed: INF_START, times: [], missed: [], lock: false, endedAt: 0 });
let G = fresh();
let raf = 0, pending = 0, t0 = 0;

const infinite = () => S.mode === 'infinite';
const free = () => S.activity === 'free';
const fmtSec = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
const clefs = () => S.clef === 'both' ? ['treble', 'bass'] : [S.clef];
const statKey = n => `${n.clef || S.clef}:${n.d}:${n.acc}`;
const bestKey = () => [S.clef, S.kb, S.accidentals, S.rare, S.range].join('|');

// ---------- tirage ----------
function pickNote() {
  const accs = S.accidentals ? [[0, 1 - ACC_RATIO], [1, ACC_RATIO / 2], [-1, ACC_RATIO / 2]] : [[0, 1]];
  const same = (a, b) => S.kb === 'simple' ? a.midi % 12 === b.midi % 12 : a.midi === b.midi;
  const cands = [];
  // Portée double : chaque note est tirée sur l'une des deux clés (une même note peut tomber sur les deux).
  for (const clef of clefs()) for (let d = noteRange(clef, S.range)[0]; d <= noteRange(clef, S.range)[1]; d++) {
    for (const [a, w] of accs) {
      const n = Object.assign(makeNote(d, a), { clef });
      if (!S.rare && isRare(n)) continue;
      if (G.note && same(n, G.note) && n.clef === G.note.clef) continue; // jamais deux fois la même note de suite
      // Révision adaptative : les notes souvent ratées reviennent plus souvent.
      const st = stats[statKey(n)];
      const err = st && st.n >= 2 ? 1 - st.ok / st.n : 0;
      cands.push([n, w * (1 + 3 * err)]);
    }
  }
  let r = Math.random() * cands.reduce((s, c) => s + c[1], 0);
  for (const [n, w] of cands) if ((r -= w) <= 0) return n;
  return cands[cands.length - 1][0];
}

function record(n, ok) {
  const k = statKey(n);
  const st = stats[k] || (stats[k] = { n: 0, ok: 0 });
  st.n++;
  if (ok) st.ok++;
  save('stats', stats);
}

// ---------- minuteur ----------
function startTimer(sec) {
  cancelAnimationFrame(raf);
  t0 = performance.now();
  const bar = $('#timerBar');
  bar.classList.remove('low');
  bar.style.transform = 'scaleX(1)';
  $('#timer').classList.toggle('off', !sec);
  if (!sec) return;
  const limit = sec * 1000;
  const tick = now => {
    const f = Math.max(0, 1 - (now - t0) / limit);
    bar.style.transform = `scaleX(${f})`;
    bar.classList.toggle('low', f < 0.25);
    if (f <= 0) { resolve(false, null); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
const stopTimer = () => cancelAnimationFrame(raf);

// Portée du jeu : une clé, ou les deux (la note sur la portée de sa clé).
function drawGame(n = null, opts = {}) {
  if (S.clef !== 'both') { renderStaff(staffSvg, { clef: S.clef, note: n, ...opts }); return; }
  const staves = ['treble', 'bass'].map(clef => ({ clef, notes: n && n.clef === clef ? [n] : [] }));
  renderStaff(staffSvg, { staves, width: staffWidth(2), ...opts });
}

// ---------- déroulement ----------
function start() {
  clearTimeout(pending);
  G = fresh();
  G.phase = 'playing';
  $('#overlay').classList.add('hide');
  renderLives();
  nextNote();
}

function nextNote() {
  G.lock = false;
  kb.clearMarks();
  G.note = pickNote();
  drawGame(G.note, { animate: true });
  setFeedback('');
  hud();
  startTimer(infinite() ? G.speed : S.time);
}

function press(m, src, vel = 0) {
  if (src !== 'midi' && S.sound) playNote(m); // le piano MIDI produit déjà son propre son
  if (free()) { freeOn(m, vel); return; }
  if ($('#drawer').classList.contains('open')) return;
  if (G.phase === 'playing') { if (!G.lock) evaluate(m); }
  else if (G.phase === 'idle') start();
  else if (G.phase === 'ended' && performance.now() - G.endedAt > 1500) start();
}

function evaluate(m) {
  const n = G.note;
  const ok = S.kb === 'simple' ? m % 12 === n.midi % 12 : m === n.midi;
  resolve(ok, m);
}

/** ok : bonne réponse ; pressed : touche jouée, ou null si le temps est écoulé */
function resolve(ok, pressed) {
  stopTimer();
  G.lock = true;
  const n = G.note;
  const dt = performance.now() - t0;
  record(n, ok);
  const name = noteName(n, S.notation);
  if (ok) {
    G.score++;
    G.times.push(dt);
    kb.mark(pressed, 'ok');
    if (infinite()) G.speed = Math.max(INF_MIN, G.speed * INF_FACTOR);
    setFeedback('ok', `${name} — juste !`, fmtSec(dt));
  } else {
    G.missed.push(n);
    if (pressed != null) kb.mark(pressed, 'bad');
    kb.mark(n.midi, 'ok hint');
    if (infinite()) { G.lives--; renderLives(true); }
    const alt = enharmonic(n);
    setFeedback('bad', pressed == null ? `Temps écoulé — c'était ${name}` : `C'était ${name}`, alt ? `(ou ${noteName(alt, S.notation)})` : '');
  }
  drawGame(n, { state: ok ? 'ok' : 'bad' });
  G.idx++;
  hud();
  const over = infinite() ? G.lives <= 0 : G.idx >= S.seriesLength;
  pending = setTimeout(over ? end : nextNote, ok ? OK_DELAY : BAD_DELAY);
}

function end() {
  G.phase = 'ended';
  G.endedAt = performance.now();
  stopTimer();
  kb.clearMarks();
  drawGame();
  setFeedback('');
  $('#timer').classList.add('off');

  const avg = G.times.length ? G.times.reduce((a, b) => a + b, 0) / G.times.length : 0;
  let html;
  if (infinite()) {
    const k = bestKey(), prev = best[k] || 0;
    const rec = G.score > prev;
    if (rec) { best[k] = G.score; save('best', best); }
    html = `<div class="big">${G.score}</div>
      <div class="meta"><span>Vitesse atteinte <b>${fmtSec(G.speed * 1000)}</b> par note</span>
      ${G.times.length ? `<span>Temps moyen <b>${fmtSec(avg)}</b></span>` : ''}</div>
      <div class="${rec && prev ? 'record' : 'meta'}">${rec && prev ? 'Nouveau record !' : `Record : <b>${Math.max(prev, G.score)}</b>`}</div>`;
  } else {
    const pct = Math.round(100 * G.score / S.seriesLength);
    html = `<div class="big">${G.score}<small> / ${S.seriesLength}</small></div>
      <div class="meta"><span>Réussite <b>${pct} %</b></span>${G.times.length ? `<span>Temps moyen <b>${fmtSec(avg)}</b></span>` : ''}</div>`;
  }
  const missed = [...new Map(G.missed.map(n => [n.midi + ':' + n.d, n])).values()];
  if (missed.length) html += `<div class="hint">À revoir</div><div class="chips">${missed.map(n => `<span class="chip">${noteName(n, S.notation)}</span>`).join('')}</div>`;
  html += `<button class="btn" id="againBtn">↻ Rejouer</button><div class="hint">Espace, ou une touche du piano</div>`;
  showOverlay(html);
  $('#againBtn').onclick = start;
}

function stopGame() {
  metroStop();
  clearTimeout(pending);
  stopTimer();
  G = fresh();
  kb.clearMarks();
  drawGame();
  setFeedback('');
  $('#timer').classList.add('off');
  const desc = infinite()
    ? `Mode infini : le temps diminue à chaque bonne réponse · ${LIVES} vies`
    : `Série de ${S.seriesLength} notes${S.time ? ` · ${S.time} s par note` : ''}`;
  showOverlay(`<h3>Prêt ?</h3><div class="meta">${desc}</div>
    <button class="btn" id="goBtn">▶ Commencer</button><div class="hint">Espace, ou une touche du piano</div>`);
  $('#goBtn').onclick = start;
  hud();
  renderLives();
}

// ---------- mode libre : la portée affiche ce qui est joué ----------
// Les notes attaquées presque en même temps (moins de GROUP_MS d'écart) forment un accord ; une note jouée plus tard
// ouvre un nouvel élément, même si un accord est encore tenu (main gauche qui tient, main droite qui joue).
// Portée double : chaque main a sa propre voix (rythme, silences), sur sa portée. Sinon une seule voix.
// En mode « à la suite », chaque élément (et chaque silence) s'ajoute à une petite partition qui défile.
const GROUP_MS = 90;
const voice = () => ({ held: new Set(), cur: null, chord: null, lastOff: 0, seq: [] });
const FREE = { voices: {}, layout: '', clef: 'treble', raf: 0, last: null };
const SEQ_MAX = 64;     // éléments gardés en mémoire par voix
const REST_MIN = 0.3;   // en temps : un silence plus court est un simple lever de doigt (legato imparfait)

// Figures de note, en temps (noires). La durée tenue est arrondie à la figure la plus proche.
const VALUES = [
  { type: 's', beats: 0.25, name: 'double croche' },
  { type: 'e', beats: 0.5, name: 'croche' },
  { type: 'e', dot: true, beats: 0.75, name: 'croche pointée' },
  { type: 'q', beats: 1, name: 'noire' },
  { type: 'q', dot: true, beats: 1.5, name: 'noire pointée' },
  { type: 'h', beats: 2, name: 'blanche' },
  { type: 'h', dot: true, beats: 3, name: 'blanche pointée' },
  { type: 'w', beats: 4, name: 'ronde' },
];
const toBeats = ms => ms / 60000 * S.tempo;
// Pendant l'appui : la figure grandit au fil du temps (dernière figure atteinte).
const liveValue = b => VALUES.filter(v => v.beats <= b).pop() || VALUES[0];
// À la fin : figure la plus proche (à l'échelle logarithmique, comme l'oreille).
const nearestValue = b => VALUES.reduce((a, v) => Math.abs(Math.log2(v.beats / b)) < Math.abs(Math.log2(a.beats / b)) ? v : a);

const grand = () => S.clef === 'both';

// Nuances d'après la force de frappe (vélocité MIDI 1–127), avec les glyphes de la police Noto Music.
// Le clavier à l'écran n'a pas de vélocité : pas de nuance.
// Seuils abaissés pour le toucher du Kawai ES60, qui envoie des vélocités plutôt basses.
const DYNAMICS = [[16, 'ppp', '𝆏𝆏𝆏'], [30, 'pp', '𝆏𝆏'], [44, 'p', '𝆏'], [60, 'mp', '𝆐𝆏'], [78, 'mf', '𝆐𝆑'], [96, 'f', '𝆑'], [114, 'ff', '𝆑𝆑'], [128, 'fff', '𝆑𝆑𝆑']];
const dynOf = vel => {
  if (!S.dynamics || !vel) return null;
  const [, name, sym] = DYNAMICS.find(d => vel < d[0]);
  return { name, sym };
};
const voiceOf = m => grand() ? (m < S.split ? 'bass' : 'treble') : 'all';
const voiceList = () => Object.values(FREE.voices);

function resetVoices() {
  FREE.layout = grand() ? 'grand' : 'single';
  FREE.voices = grand() ? { treble: voice(), bass: voice() } : { all: voice() };
  FREE.last = null;
  clearInterval(FREE.raf);
  FREE.raf = 0;
}

// Fin d'un élément : à son relâchement, ou à l'attaque suivante de la même voix si on le tient encore.
function endEvent(e, now) {
  e.live = false;
  if (e.session === METRO.session) e.qOff = qOf(now);
  if (S.durations) e.value = nearestValue(toBeats(now - e.t));
}

function freeOn(m, vel = 0) {
  const now = performance.now(), v = FREE.voices[voiceOf(m)];
  let cur = v.cur, attack = false;
  if (!cur || !cur.live || now - cur.t > GROUP_MS) {
    if (cur?.live) endEvent(cur, now);
    // Silence depuis que la voix s'est tue (au plus une pause, même après une longue attente)
    if (S.durations && S.rests && !v.held.size && v.seq.length && v.lastOff) {
      const gap = toBeats(now - v.lastOff);
      if (gap >= REST_MIN) v.seq.push({ rest: true, t: v.lastOff, value: nearestValue(Math.min(gap, 4)) });
    }
    cur = v.cur = { midis: [], t: now, value: S.durations ? VALUES[0] : null, vel: 0, live: true };
    if (measured()) Object.assign(cur, { q: qOf(now), session: METRO.session });
    v.seq.push(cur);
    if (v.seq.length > SEQ_MAX) v.seq.splice(0, v.seq.length - SEQ_MAX);
    attack = true;
  }
  v.held.add(m);
  if (!cur.midis.includes(m)) cur.midis.push(m);
  cur.vel = Math.max(cur.vel, vel); // accord : la note la plus forte donne la nuance
  if (cur.midis.length >= 2) v.chord = cur;
  FREE.last = cur;
  if (S.durations && !FREE.raf) FREE.raf = setInterval(growValue, 30);
  renderFree(attack && cur.midis.length === 1);
}

function growValue() {
  const now = performance.now();
  let changed = false, any = false;
  for (const v of voiceList()) {
    const c = v.cur;
    if (!c?.live) continue;
    any = true;
    const val = liveValue(toBeats(now - c.t));
    if (val !== c.value) { c.value = val; changed = true; }
  }
  // Partition mesurée : la note tenue s'allonge à chaque double croche de la grille.
  if (any && measured()) {
    const k = Math.floor(qOf(now) / GRID);
    if (k !== FREE.qk) { FREE.qk = k; changed = true; }
  }
  if (!any) { clearInterval(FREE.raf); FREE.raf = 0; }
  if (changed) renderFree(false);
}

function release(m) {
  if (!free()) return;
  const v = FREE.voices[voiceOf(m)];
  if (!v?.held.delete(m)) return;
  const now = performance.now();
  if (!v.held.size) v.lastOff = now;
  if (v.cur?.live && !v.cur.midis.some(x => v.held.has(x))) endEvent(v.cur, now);
  renderFree(false);
}

function clearSeq() {
  for (const v of voiceList()) { v.seq = []; v.lastOff = 0; if (!v.held.size) v.cur = v.chord = null; }
  if (!voiceList().some(v => v.cur)) FREE.last = null;
  renderFree(false);
}

// Nombre maximal de lignes supplémentaires qu'exigent les notes dans une clé.
const ledgers = (clef, notes) => Math.max(...notes.map(n => {
  const p = n.d - CLEFS[clef].bottom;
  return p < 0 ? Math.floor(-p / 2) : Math.floor(Math.max(0, p - 8) / 2);
}));

// Ce qu'affiche une voix hors défilement : la dernière attaque, plus les notes encore tenues d'avant (en grisé).
function sounding(v) {
  if (!v.cur) return [];
  const held = [...v.held].filter(m => !v.cur.midis.includes(m));
  return [...v.cur.midis.map(m => fromMidi(m, S.spell)), ...held.map(m => Object.assign(fromMidi(m, S.spell), { held: true }))];
}

// Notes attaquées ensemble (toutes voix confondues) à l'instant t.
const attackedAt = t => voiceList().flatMap(v => v.seq.filter(e => !e.rest && Math.abs(e.t - t) <= GROUP_MS).flatMap(e => e.midis));

// Accord à nommer : celui qu'on vient de plaquer ; sinon un accord encore tenu (une mélodie jouée par-dessus ne le change pas).
function harmony() {
  if (!S.chords || !FREE.last) return null;
  const now = attackedAt(FREE.last.t);
  if (now.length >= 2) return { midis: now, held: false };
  const held = voiceList().flatMap(v => v.chord && v.chord.midis.some(m => v.held.has(m)) ? v.chord.midis : []);
  return held.length >= 2 ? { midis: held, held: true } : null;
}

// Hauteur disponible pour la portée : la zone centrale, moins le minuteur, le message et l'en-tête de la feuille.
function svgRoom() {
  const main = $('main'), cs = getComputedStyle(main), gap = parseFloat(cs.rowGap) || 0;
  const others = [...main.children].filter(c => !c.classList.contains('sheet') && c.offsetParent);
  return main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - gap * others.length
    - others.reduce((s, c) => s + c.offsetHeight, 0) - $('.sheet-head').offsetHeight - 2;
}

// Largeur du cadre de la portée. Une portée double, plus haute, s'élargit sur grand écran pour ne pas pousser le clavier.
// S'il manque de la hauteur (téléphone en paysage, tablette), la portée garde la hauteur disponible et le cadre
// s'allonge pour remplir la largeur : plus de notes visibles au lieu de bandes vides sur les côtés.
function staffWidth(n) {
  const w = staffSvg.clientWidth, H = systemHeight(n);
  if (!w) return 520;
  const base = n > 1 ? Math.min(916, Math.max(520, Math.round(w * 0.9))) : 520;
  const room = svgRoom();
  if (room > 40 && w * H / base > room) return Math.max(base, Math.round(w / room * H));
  return base;
}

function renderFree(animate) {
  if (FREE.layout !== (grand() ? 'grand' : 'single')) resetVoices();
  const V = FREE.voices, last = FREE.last;
  if (!grand() && S.autoClef) {
    const notes = sounding(V.all);
    if (notes.length) {
      const other = FREE.clef === 'treble' ? 'bass' : 'treble';
      // On change de clé dès 2 lignes supplémentaires si l'autre clé fait mieux (Do4 garde la clé en cours).
      const cur = ledgers(FREE.clef, notes);
      if (cur >= 2 && ledgers(other, notes) < cur) { FREE.clef = other; syncHeader(); }
    }
  }
  const order = grand() ? [['treble', V.treble], ['bass', V.bass]] : [[FREE.clef, V.all]];
  const h = harmony();
  const chord = h ? analyse(h.midis, S.notation, S.spell) : null;
  const n = order.length;
  if (S.scroll) {
    // Noms d'accords courts au-dessus de la partition (une seule notation pour gagner de la place)
    const nota = S.notation === 'both' ? 'fr' : S.notation;
    const label = e => S.chords ? (a => a?.kind === 'chord' ? a.label : '')(analyse(attackedAt(e.t), nota, S.spell)) : '';
    if (measured()) {
      const { staves, bars } = measuredScore(order, label);
      renderSequence(staffSvg, { staves, bars, width: staffWidth(n), group: 10 });
    } else {
    // Comme sur une partition, la nuance n'est écrite que lorsqu'elle change.
    const staves = order.map(([clef, v]) => {
      let prev = '';
      return {
        clef,
        events: v.seq.map(e => {
          if (e.rest) return e;
          const d = dynOf(e.vel)?.sym || '', dyn = d !== prev ? d : '';
          if (d) prev = d;
          return { t: e.t, notes: e.midis.map(m => fromMidi(m, S.spell)), value: S.durations ? e.value : null, live: e.live, label: label(e), dyn };
        }),
      };
    });
    renderSequence(staffSvg, { staves, width: staffWidth(n), group: GROUP_MS });
    }
  } else {
    const staves = order.map(([clef, v]) => ({ clef, notes: sounding(v), value: S.durations ? v.cur?.value : null, dyn: dynOf(v.cur?.vel)?.sym }));
    renderStaff(staffSvg, { staves, width: staffWidth(n), label: chord?.label, labelKind: chord?.kind, animate });
  }
  $('#clearSeq').hidden = !(S.scroll && voiceList().some(v => v.seq.length));
  if (last) {
    const names = attackedAt(last.t).sort((a, b) => a - b).map(m => noteName(fromMidi(m, S.spell), S.notation));
    const sub = [h?.held ? chord?.label : '', chord?.desc, S.durations ? last.value?.name : '', dynOf(last.vel)?.name].filter(Boolean).join(' · ');
    setFeedback('', names.join(' · '), sub);
  } else setFeedback('hint', grand() ? 'Jouez : chaque main a sa portée' : 'Jouez une note : elle s\'affiche sur la portée');
}

// ---------- métronome (mode libre) ----------
// Programmation sur l'horloge audio, plus régulière que les minuteurs JavaScript.
const METRO = { on: false, next: 0, beat: 0, timer: 0, origin: 0, session: 0 };
// Mesures : n clics par mesure ; en 6/8 le métronome bat les croches (2 par noire), avec un appui sur la 4e.
const METRES = {
  '2/4': { n: 2, sub: 1 },
  '3/4': { n: 3, sub: 1 },
  '4/4': { n: 4, sub: 1 },
  '5/4': { n: 5, sub: 1 },
  '6/8': { n: 6, sub: 2, mid: 3 },
};
const metre = () => METRES[S.metre] || METRES['4/4'];

// ---------- partition mesurée : notes calées sur le métronome ----------
// Quand le métronome tourne (partition qui défile, durées affichées), chaque note est placée dans la grille des temps,
// arrondie à la double croche, avec barres de mesure et liaisons pour les notes qui passent d'une mesure à l'autre.
const GRID = 0.25; // double croche, en noires
const measured = () => free() && METRO.on && S.scroll && S.durations;
// Position (en noires depuis le départ du métronome) d'un instant de l'horloge de la page.
const qOf = t => (t - METRO.origin) / 60000 * S.tempo;
// Recale l'origine de la grille sur le prochain clic programmé (horloge audio → horloge de la page), en tenant compte
// du retard de la sortie audio : on joue sur le clic qu'on entend. À refaire au départ et à chaque changement
// de tempo ou de mesure ; entre-temps la grille avance avec l'horloge de la page, plus régulière que l'horloge audio.
function metroResync() {
  const heard = performance.now() + (METRO.next - audioNow() + audioLatency()) * 1000;
  METRO.origin = heard - METRO.beat / metre().sub * 60000 / S.tempo;
}
const snap = q => Math.round(q / GRID) * GRID;

// Découpe [a, b) en figures : coupée aux barres de mesure, chaque morceau décomposé en figures (de la plus longue).
function split(a, b, bar) {
  const out = [];
  while (b - a > 1e-6) {
    const segEnd = Math.min(b, (Math.floor(a / bar + 1e-6) + 1) * bar);
    while (segEnd - a > 1e-6) {
      const v = VALUES.filter(v => v.beats <= segEnd - a + 1e-6).pop() || VALUES[0];
      out.push({ q: a, value: v });
      a += v.beats;
    }
  }
  return out;
}

function measuredScore(order, label) {
  const M = metre(), bar = M.n / M.sub, now = performance.now();
  const lists = order.map(([, v]) => v.seq.filter(e => !e.rest && e.session === METRO.session)
    .map(e => ({ e, on: snap(e.q), off: snap(e.live || e.qOff == null ? qOf(now) : e.qOff) })));
  const all = lists.flat();
  if (!all.length) return { staves: order.map(([clef]) => ({ clef, events: [] })), bars: [] };
  // La partition commence au début de la mesure de la première note, la même pour les deux mains.
  const start = Math.floor(Math.min(...all.map(x => x.on)) / bar + 1e-6) * bar;
  let end = start;
  const staves = order.map(([clef], i) => {
    const L = lists[i].sort((a, b) => a.on - b.on), events = [];
    // Une voix joue une chose à la fois : une note s'arrête au plus tard quand la suivante commence.
    L.forEach((x, k) => { if (k) x.on = Math.max(x.on, L[k - 1].on + GRID); });
    L.forEach((x, k) => { if (k < L.length - 1) x.off = Math.min(x.off, L[k + 1].on); x.off = Math.max(x.off, x.on + GRID); });
    let pos = start, prevDyn = '';
    for (const x of L) {
      for (const p of split(pos, x.on, bar)) events.push({ rest: true, t: p.q * 1000, value: p.value });
      const d = dynOf(x.e.vel)?.sym || '', dyn = d !== prevDyn ? d : '';
      if (d) prevDyn = d;
      const ps = split(x.on, x.off, bar);
      ps.forEach((p, j) => events.push({
        t: p.q * 1000, notes: x.e.midis.map(m => fromMidi(m, S.spell)), value: p.value, live: x.e.live,
        tie: j < ps.length - 1, label: j ? '' : label(x.e), dyn: j ? '' : dyn,
      }));
      pos = x.off;
    }
    end = Math.max(end, pos);
    return { clef, events };
  });
  const bars = [];
  for (let b = start + bar; b <= end + 1e-6; b += bar) bars.push(b * 1000);
  return { staves, bars };
}

function metroSchedule() {
  while (METRO.next < audioNow() + 0.12) {
    const M = metre(), pos = METRO.beat % M.n, when = METRO.next;
    const level = pos === 0 ? 2 : pos === M.mid ? 1 : 0;
    click(level, when);
    setTimeout(() => flashBeat(level === 2), Math.max(0, (when - audioNow()) * 1000));
    METRO.next += 60 / S.tempo / M.sub;
    METRO.beat++;
  }
}
function metroStart() {
  if (METRO.on) return;
  METRO.on = true;
  METRO.beat = 0;
  METRO.session++; // nouvelle prise : la partition mesurée repart de zéro
  METRO.next = audioNow() + 0.08;
  metroResync();
  metroSchedule();
  METRO.timer = setInterval(metroSchedule, 25);
  renderMetro();
}
function metroStop() {
  if (!METRO.on) return;
  METRO.on = false;
  clearInterval(METRO.timer);
  renderMetro();
  if (free()) renderFree(false); // retour à la partition libre
}
function flashBeat(accent) {
  if (!METRO.on) return;
  const d = $('#metroBtn .dot');
  d.classList.remove('tick', 'accent');
  void d.offsetWidth; // relance l'animation
  d.classList.add('tick');
  d.classList.toggle('accent', accent);
}
function renderMetro() {
  const b = $('#metroBtn'), box = $('#metroBox');
  const show = free() && S.durations;
  if (!show) metroStop();
  box.hidden = !show;
  box.classList.toggle('on', METRO.on);
  b.setAttribute('aria-pressed', METRO.on);
  b.querySelector('.txt').textContent = `= ${S.tempo}`;
  $('#metreBtn').textContent = S.metre;
  $('#metreBtn').setAttribute('aria-label', `Mesure ${S.metre}, changer`);
  b.setAttribute('aria-label', `Métronome, noire = ${S.tempo}`);
  b.title = METRO.on ? 'Arrêter le métronome' : 'Lancer le métronome';
}

function enterFree() {
  if (!S.scroll || FREE.layout !== (grand() ? 'grand' : 'single')) resetVoices();
  clearTimeout(pending);
  stopTimer();
  G = fresh();
  kb.clearMarks();
  FREE.clef = S.clef === 'both' ? 'treble' : S.clef;
  $('#overlay').classList.add('hide');
  $('#timer').classList.add('off');
  hud();
  renderLives();
  renderFree(false);
}

// ---------- affichage ----------
function showOverlay(html) {
  const o = $('#overlay');
  o.innerHTML = html;
  o.classList.remove('hide');
}

function setFeedback(kind, text = '', sub = '') {
  const f = $('#feedback');
  f.className = 'feedback ' + kind;
  f.innerHTML = text ? `${text}${sub ? `<span class="sub">${sub}</span>` : ''}` : '';
}

function hud() {
  document.querySelectorAll('header .stat').forEach(e => { e.hidden = free(); });
  if (infinite()) {
    $('#stat1v').textContent = fmtSec(G.speed * 1000);
    $('#stat1l').textContent = `Niveau ${Math.floor(G.score / 5) + 1}`;
    $('#stat2l').textContent = 'Score';
  } else {
    $('#stat1v').textContent = `${G.idx}/${S.seriesLength}`;
    $('#stat1l').textContent = 'Notes';
    $('#stat2l').textContent = 'Justes';
  }
  $('#stat2v').textContent = G.score;
}

function renderLives(lostOne = false) {
  const l = $('#lives');
  l.hidden = !infinite() || free();
  l.innerHTML = Array.from({ length: LIVES }, (_, i) =>
    `<span class="${i < G.lives ? '' : 'off'}${lostOne && i === G.lives ? ' lost' : ''}">♥</span>`).join('');
}

function renderHead() {
  if (free()) {
    $('#headMode').textContent = 'Jeu libre';
    $('#headTags').textContent = S.spell === 'flat' ? 'Touches noires en bémols' : 'Touches noires en dièses';
    return;
  }
  $('#headMode').textContent = infinite() ? 'Mode infini' : `Série · ${S.seriesLength} notes`;
  const tags = [S.accidentals ? 'Altérations' : 'Sans altérations', S.kb === 'simple' ? '1 octave' : 'Octave stricte'];
  $('#headTags').textContent = tags.join(' · ');
}

function buildKeyboard() {
  const rs = clefs().map(c => keyboardRange(c, S.range, S.accidentals));
  const lo = Math.min(...rs.map(r => r[0])), hi = Math.max(...rs.map(r => r[1]));
  kb.build({ lo, hi, simple: S.kb === 'simple', names: S.names, notation: S.notation });
  const oct = m => Math.floor(m / 12) - 1;
  const nm = m => (S.notation === 'en' ? LETTERS_EN : LETTERS_FR)[[0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][m % 12]];
  $('#rangeLbl').textContent = S.kb === 'simple' ? '1 octave' : `${nm(lo)}${oct(lo)} – ${nm(hi)}${oct(hi)}`;
}

// ---------- réglages ----------
const game = s => s.activity === 'game';
const CONTROLS = [
  { key: 'activity', label: 'Activité', opts: [['game', 'Jeu'], ['free', 'Libre']],
    hint: s => s.activity === 'free' ? 'La portée affiche simplement les notes jouées' : 'Une note s\'affiche : jouez-la' },
  { key: 'spell', label: 'Touches noires', opts: [['sharp', 'Dièses ♯'], ['flat', 'Bémols ♭']], show: s => !game(s) },
  { key: 'split', label: 'Partage des mains : clé de sol à partir de', show: s => !game(s) && s.clef === 'both',
    hint: () => 'Portée double (𝄞𝄢 en haut) : chaque main a sa portée et son rythme',
    opts: s => [[55, 'Sol3', 'G3'], [60, 'Do4', 'C4'], [64, 'Mi4', 'E4']].map(([v, fr, en]) => [v, s.notation === 'en' ? en : fr]) },
  { key: 'autoClef', label: 'Changer de clé automatiquement', toggle: true, show: s => !game(s) && s.clef !== 'both' },
  { key: 'scroll', label: 'Notes à la suite (partition qui défile)', toggle: true, show: s => !game(s) },
  { key: 'rests', label: 'Silences entre les notes', toggle: true, show: s => !game(s) && s.scroll && s.durations },
  { key: 'chords', label: 'Nommer les accords et les intervalles', toggle: true, show: s => !game(s) },
  { key: 'dynamics', label: 'Nuances (p, mf, f…) d\'après la force de frappe', toggle: true, show: s => !game(s),
    hint: s => s.dynamics ? 'Avec le piano MIDI seulement : le clavier à l\'écran n\'a pas de force de frappe' : '' },
  { key: 'durations', label: 'Durée des notes (ronde, blanche, noire…)', toggle: true, show: s => !game(s),
    hint: s => s.durations ? 'Tempo et métronome : boutons « − ♩ = 80 + » en haut' : '' },
  { key: 'metre', label: 'Mesure du métronome', opts: [['2/4', '2/4'], ['3/4', '3/4'], ['4/4', '4/4'], ['5/4', '5/4'], ['6/8', '6/8']],
    show: s => !game(s) && s.durations, hint: s => s.metre === '6/8' ? 'Le métronome bat les croches, avec un appui sur la 1re et la 4e' : '' },

  { key: 'mode', label: 'Mode de jeu', opts: [['series', 'Série'], ['infinite', 'Infini']], show: game,
    hint: s => s.mode === 'infinite' ? `Le temps par note diminue à chaque bonne réponse · ${LIVES} vies` : '' },
  { key: 'seriesLength', label: 'Longueur de série', opts: [[10, '10'], [20, '20'], [50, '50']], show: s => game(s) && s.mode === 'series' },
  { key: 'time', label: 'Temps par note', opts: [[0, '∞'], [10, '10 s'], [5, '5 s'], [3, '3 s'], [2, '2 s']], show: s => game(s) && s.mode === 'series' },
  { key: 'kb', label: 'Clavier', opts: [['strict', 'Octave stricte'], ['simple', '1 octave']],
    hint: s => s.kb === 'simple' ? 'Seul le nom de la note compte, quelle que soit l\'octave' : 'Il faut jouer la note à la bonne hauteur' },
  { key: 'names', label: 'Noms sur les touches', toggle: true },
  { key: 'notation', label: 'Notation', opts: [['fr', 'Do Ré Mi'], ['en', 'C D E'], ['both', 'Les deux']] },
  { key: 'accidentals', label: 'Altérations ♯ ♭', toggle: true, show: game },
  { key: 'rare', label: 'Cas rares (Mi♯, Si♯, Fa♭, Do♭)', toggle: true, show: s => game(s) && s.accidentals },
  { key: 'range', label: 'Étendue', opts: [[0, 'Portée'], [2, '+2 lignes'], [3, '+3 lignes']] },
  { key: 'sound', label: 'Son du clavier à l\'écran', toggle: true },
  { key: 'wake', label: 'Empêcher la mise en veille de l\'écran', toggle: true, show: () => 'wakeLock' in navigator },
  { key: 'hideKb', label: 'Masquer le clavier quand un piano MIDI est branché', toggle: true },
];

function renderControls() {
  const box = $('#controls');
  box.innerHTML = '';
  for (const c of CONTROLS) {
    if (c.show && !c.show(S)) continue;
    const row = document.createElement('div');
    if (c.toggle) {
      row.className = 'row switch';
      row.innerHTML = `<span class="lbl">${c.label}</span><button class="tg ${S[c.key] ? 'on' : ''}" role="switch" aria-checked="${!!S[c.key]}" aria-label="${c.label}"></button>`;
      row.querySelector('button').onclick = () => set(c.key, !S[c.key]);
    } else {
      row.className = 'row';
      const hint = c.hint?.(S);
      const opts = typeof c.opts === 'function' ? c.opts(S) : c.opts;
      row.innerHTML = `<div class="lbl">${c.label}</div><span class="seg">${opts.map(([v, t], i) =>
        `<button class="${S[c.key] === v ? 'on' : ''}" data-i="${i}">${t}</button>`).join('')}</span>
        ${hint ? `<div class="hint-t">${hint}</div>` : ''}`;
      row.querySelectorAll('button').forEach(b => { b.onclick = () => set(c.key, opts[+b.dataset.i][0]); });
    }
    box.appendChild(row);
  }
}

function renderStats() {
  $('#statsClef').textContent = { treble: '· clé de sol', bass: '· clé de fa', both: '· clés de sol et de fa' }[S.clef];
  const rows = Object.entries(stats)
    .filter(([k, v]) => clefs().includes(k.split(':')[0]) && v.n >= 3)
    .map(([k, v]) => { const [c, d, a] = k.split(':'); return { n: makeNote(+d, +a), clef: c, rate: v.ok / v.n, cnt: v.n }; })
    .filter(r => r.rate < 1)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 8);
  $('#statsList').innerHTML = rows.length
    ? rows.map(r => `<div class="statline"><span>${noteName(r.n, S.notation === 'both' ? 'fr' : S.notation)}${S.clef === 'both' ? ` <span class="g">${r.clef === 'treble' ? '𝄞' : '𝄢'}</span>` : ''}</span>
        <span class="bar"><i style="width:${Math.round(r.rate * 100)}%"></i></span><span class="pct">${Math.round(r.rate * 100)} %</span></div>`).join('')
    : '<div class="hint-t">Pas encore assez de données : jouez quelques séries.</div>';
}

function renderMidi() {
  const pill = $('#midiPill'), row = $('#midiRow');
  const on = midi.names.length > 0;
  pill.hidden = !midi.supported;
  pill.classList.toggle('on', on);
  pill.querySelector('.txt').textContent = on ? 'Piano connecté' : 'Pas de piano MIDI';
  pill.title = midi.names.join(', ');
  row.innerHTML = !midi.supported ? 'Ce navigateur ne gère pas le Web MIDI (utilisez Chrome ou Edge).'
    : midi.denied ? 'Accès MIDI refusé par le navigateur.'
    : on ? `<span class="dot on" style="display:inline-block;margin-right:6px"></span>${midi.names.join(', ')}`
    : 'Aucun piano détecté. Branchez le câble USB : il est reconnu automatiquement.';
  applyKbVisibility();
}

// Avec un piano MIDI branché, le clavier à l'écran peut être masqué : la partition prend alors toute la place.
function applyKbVisibility() {
  const hide = S.hideKb && midi.names.length > 0;
  $('.piano').hidden = hide;
  document.body.classList.toggle('no-kb', hide);
}

function syncHeader() {
  const clef = free() && !grand() ? FREE.clef : S.clef;
  document.querySelectorAll('#clefSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === clef));
  document.querySelectorAll('#actSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.activity));
}

function set(key, val) {
  S[key] = val;
  save('settings', S);
  refreshAll();
}

function refreshAll() {
  applyWake();
  syncHeader();
  renderControls();
  renderStats();
  renderHead();
  buildKeyboard();
  applyKbVisibility();
  if (free()) enterFree(); else stopGame();
  renderMetro();
}

// ---------- écran toujours allumé (Wake Lock) ----------
// Le verrou est relâché par le navigateur quand l'appli passe en arrière-plan : on le redemande au retour.
let wakeLock = null;
async function applyWake() {
  if (!('wakeLock' in navigator)) return;
  if (!S.wake) { wakeLock?.release().catch(() => {}); wakeLock = null; return; }
  if (wakeLock && !wakeLock.released) return;
  if (document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch { wakeLock = null; } // refusé (économie d'énergie…) : on réessaiera au prochain geste
}
document.addEventListener('visibilitychange', applyWake);
window.addEventListener('pointerdown', () => { if (S.wake && (!wakeLock || wakeLock.released)) applyWake(); }, { capture: true });

function applyTheme() {
  const t = S.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#141518' : '#ece6d9';
}

// ---------- événements ----------
$('#clefSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.v !== S.clef) set('clef', b.dataset.v);
  else if (free() && !grand() && FREE.clef !== S.clef) enterFree();
});
$('#clearSeq').onclick = clearSeq;
// Mesure : chaque appui passe à la suivante. Le métronome repart sur un premier temps.
function setMetre(m) {
  S.metre = m;
  save('settings', S);
  METRO.beat = 0;
  METRO.session++;
  if (METRO.on) metroResync();
  renderMetro();
  if (free()) renderFree(false);
}
$('#metreBtn').onclick = () => {
  const keys = Object.keys(METRES);
  setMetre(keys[(keys.indexOf(S.metre) + 1) % keys.length]);
};
// Rotation, fenêtre redimensionnée, clavier masqué : la partition se recalcule à la place disponible.
let resizeT = 0;
new ResizeObserver(() => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (free()) renderFree(false);
    else if (S.clef === 'both' && G.phase !== 'ended') drawGame(G.phase === 'playing' ? G.note : null);
  }, 150);
}).observe($('main'));
$('#metroBtn').onclick = () => (METRO.on ? metroStop : metroStart)();
// Tempo : − / + de 1 en 1. En maintenant appuyé, ça défile, puis passe de 5 en 5 après un moment.
const TEMPO_MIN = 30, TEMPO_MAX = 240;
function stepTempo(dir, step = 1) {
  const base = step > 1 ? (dir > 0 ? Math.floor(S.tempo / step) * step : Math.ceil(S.tempo / step) * step) : S.tempo;
  const t = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, base + dir * step));
  if (t === S.tempo) return;
  // La grille garde la position déjà jouée et repart au nouveau tempo depuis le prochain clic.
  S.tempo = t;
  save('settings', S);
  if (METRO.on) metroResync();
  renderMetro();
}
for (const [id, dir] of [['#tempoDown', -1], ['#tempoUp', 1]]) {
  const btn = $(id);
  let rep = 0;
  const stop = () => { clearTimeout(rep); clearInterval(rep); };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    stepTempo(dir);
    stop();
    let n = 0;
    rep = setTimeout(() => { rep = setInterval(() => stepTempo(dir, ++n > 15 ? 5 : 1), 90); }, 400);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, stop));
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); stepTempo(dir); } });
}
$('#actSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && b.dataset.v !== S.activity) set('activity', b.dataset.v);
});
$('#themeBtn').onclick = () => {
  S.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  save('settings', S);
  applyTheme();
};
// Plein écran (API Fullscreen). Masqué si non disponible ou si l'appli installée est déjà en plein écran.
const fsBtn = $('#fsBtn');
const fsAvailable = document.fullscreenEnabled && !matchMedia('(display-mode: fullscreen)').matches;
fsBtn.hidden = !fsAvailable;
const syncFs = () => document.body.classList.toggle('is-fs', !!document.fullscreenElement);
fsBtn.onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
};
document.addEventListener('fullscreenchange', syncFs);
syncFs();

const openDrawer = open => {
  $('#drawer').classList.toggle('open', open);
  $('#scrim').classList.toggle('open', open);
  if (open) { renderStats(); if (G.phase === 'playing') stopGame(); }
};
$('#gearBtn').onclick = () => openDrawer(true);
$('#closeBtn').onclick = () => openDrawer(false);
$('#scrim').onclick = () => openDrawer(false);
$('#resetStats').onclick = () => {
  if (!confirm('Effacer toutes les statistiques et les records ?')) return;
  stats = {}; best = {};
  save('stats', stats); save('best', best);
  renderStats();
};

// Clavier d'ordinateur (position physique des touches, donc valable en AZERTY comme en QWERTY)
const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12 };
const held = new Set();
window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Escape') { openDrawer(false); return; }
  if ($('#drawer').classList.contains('open')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!free() && G.phase !== 'playing') start();
    return;
  }
  if (S.kb !== 'simple' || !(e.code in KEYMAP) || e.repeat || held.has(e.code)) return;
  held.add(e.code);
  const m = 60 + KEYMAP[e.code];
  kb.down(m);
  press(m, 'kbd');
});
window.addEventListener('keyup', e => {
  if (!held.delete(e.code)) return;
  kb.up(60 + KEYMAP[e.code]);
  release(60 + KEYMAP[e.code]);
});

initMidi({
  onNoteOn: (n, v) => { kb.down(n); press(n, 'midi', v); },
  onNoteOff: n => { kb.up(n); release(n); },
  onStatus: s => { Object.assign(midi, { names: [], denied: false }, s); renderMidi(); },
});

// ---------- démarrage ----------
applyTheme();
renderMidi();
refreshAll();
document.fonts?.ready.then(() => { if (free()) renderFree(false); else if (G.phase !== 'playing') drawGame(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
