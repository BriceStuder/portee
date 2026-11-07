// Contrôleur : réglages, déroulement du jeu, liaison interface ↔ clavier ↔ MIDI.
import { makeNote, fromMidi, noteName, enharmonic, isRare, noteRange, keyboardRange, LETTERS_FR, LETTERS_EN } from './theory.js';
import { renderStaff } from './staff.js';
import { Keyboard } from './keyboard.js';
import { playNote, click, audioNow } from './audio.js';
import { initMidi } from './midi.js';
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
  activity: 'game', spell: 'sharp', autoClef: true, durations: true, tempo: 80,
  clef: 'treble', mode: 'series', seriesLength: 20, time: 5, kb: 'strict',
  names: true, notation: 'fr', accidentals: true, rare: false, range: 2, sound: true, hideKb: true, theme: null,
};
const S = { ...DEFAULTS, ...load('settings', {}) };
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
const statKey = n => `${S.clef}:${n.d}:${n.acc}`;
const bestKey = () => [S.clef, S.kb, S.accidentals, S.rare, S.range].join('|');

// ---------- tirage ----------
function pickNote() {
  const [lo, hi] = noteRange(S.clef, S.range);
  const accs = S.accidentals ? [[0, 1 - ACC_RATIO], [1, ACC_RATIO / 2], [-1, ACC_RATIO / 2]] : [[0, 1]];
  const same = (a, b) => S.kb === 'simple' ? a.midi % 12 === b.midi % 12 : a.midi === b.midi;
  const cands = [];
  for (let d = lo; d <= hi; d++) {
    for (const [a, w] of accs) {
      const n = makeNote(d, a);
      if (!S.rare && isRare(n)) continue;
      if (G.note && same(n, G.note)) continue; // jamais deux fois la même touche de suite
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
  renderStaff(staffSvg, { clef: S.clef, note: G.note, animate: true });
  setFeedback('');
  hud();
  startTimer(infinite() ? G.speed : S.time);
}

function press(m, src) {
  if (src !== 'midi' && S.sound) playNote(m); // le piano MIDI produit déjà son propre son
  if (free()) { freeOn(m); return; }
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
  renderStaff(staffSvg, { clef: S.clef, note: n, state: ok ? 'ok' : 'bad' });
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
  renderStaff(staffSvg, { clef: S.clef });
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
  renderStaff(staffSvg, { clef: S.clef });
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
// Les notes jouées ensemble (accord) restent affichées jusqu'à la prochaine attaque après relâchement.
const FREE = { held: new Set(), shown: [], clef: 'treble', t0: 0, value: null, raf: 0 };

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
const heldBeats = () => (performance.now() - FREE.t0) / 60000 * S.tempo;
// Pendant l'appui : la figure grandit au fil du temps (dernière figure atteinte).
const liveValue = b => VALUES.filter(v => v.beats <= b).pop() || VALUES[0];
// Au relâchement : figure la plus proche (à l'échelle logarithmique, comme l'oreille).
const nearestValue = b => VALUES.reduce((a, v) => Math.abs(Math.log2(v.beats / b)) < Math.abs(Math.log2(a.beats / b)) ? v : a);

function freeOn(m) {
  const fresh = FREE.held.size === 0;
  if (fresh) {
    FREE.shown = [];
    FREE.t0 = performance.now();
    FREE.value = S.durations ? VALUES[0] : null;
    clearInterval(FREE.raf);
    if (S.durations) FREE.raf = setInterval(growValue, 30);
  }
  FREE.held.add(m);
  if (!FREE.shown.includes(m)) FREE.shown.push(m);
  renderFree(fresh);
}

function growValue() {
  const v = liveValue(heldBeats());
  if (v !== FREE.value) { FREE.value = v; renderFree(false); }
}

function release(m) {
  if (!FREE.held.delete(m) || FREE.held.size || !free() || !S.durations || !FREE.value) return;
  clearInterval(FREE.raf);
  FREE.value = nearestValue(heldBeats());
  renderFree(false);
}

// Nombre maximal de lignes supplémentaires qu'exigent les notes dans une clé.
const ledgers = (clef, notes) => Math.max(...notes.map(n => {
  const p = n.d - CLEFS[clef].bottom;
  return p < 0 ? Math.floor(-p / 2) : Math.floor(Math.max(0, p - 8) / 2);
}));

function renderFree(animate) {
  const notes = FREE.shown.map(m => fromMidi(m, S.spell));
  if (S.autoClef && notes.length) {
    const other = FREE.clef === 'treble' ? 'bass' : 'treble';
    // On change de clé dès 2 lignes supplémentaires si l'autre clé fait mieux (Do4 garde la clé en cours).
    const cur = ledgers(FREE.clef, notes);
    if (cur >= 2 && ledgers(other, notes) < cur) { FREE.clef = other; syncHeader(); }
  }
  const value = S.durations ? FREE.value : null;
  renderStaff(staffSvg, { clef: FREE.clef, notes, value, animate });
  if (notes.length) setFeedback('', notes.slice().sort((a, b) => a.midi - b.midi).map(n => noteName(n, S.notation)).join(' · '), value?.name || '');
  else setFeedback('hint', 'Jouez une note : elle s\'affiche sur la portée');
}

// ---------- métronome (mode libre) ----------
// Programmation sur l'horloge audio, plus régulière que les minuteurs JavaScript.
const METRO = { on: false, next: 0, beat: 0, timer: 0 };

function metroSchedule() {
  while (METRO.next < audioNow() + 0.12) {
    const accent = METRO.beat % 4 === 0, when = METRO.next;
    click(accent, when);
    setTimeout(() => flashBeat(accent), Math.max(0, (when - audioNow()) * 1000));
    METRO.next += 60 / S.tempo;
    METRO.beat++;
  }
}
function metroStart() {
  if (METRO.on) return;
  METRO.on = true;
  METRO.beat = 0;
  METRO.next = audioNow() + 0.08;
  metroSchedule();
  METRO.timer = setInterval(metroSchedule, 25);
  renderMetro();
}
function metroStop() {
  if (!METRO.on) return;
  METRO.on = false;
  clearInterval(METRO.timer);
  renderMetro();
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
  const b = $('#metroBtn');
  const show = free() && S.durations;
  if (!show) metroStop();
  b.hidden = !show;
  b.classList.toggle('on', METRO.on);
  b.setAttribute('aria-pressed', METRO.on);
  b.querySelector('.txt').textContent = `= ${S.tempo}`;
  b.setAttribute('aria-label', `Métronome, noire = ${S.tempo}`);
  b.title = METRO.on ? 'Arrêter le métronome' : 'Lancer le métronome';
}

function enterFree() {
  clearTimeout(pending);
  stopTimer();
  G = fresh();
  kb.clearMarks();
  FREE.clef = S.clef;
  if (!S.durations) FREE.value = null;
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
  const [lo, hi] = keyboardRange(S.clef, S.range, S.accidentals);
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
  { key: 'autoClef', label: 'Changer de clé automatiquement', toggle: true, show: s => !game(s) },
  { key: 'durations', label: 'Durée des notes (ronde, blanche, noire…)', toggle: true, show: s => !game(s) },
  { key: 'tempo', label: 'Tempo (noires par minute)', opts: [[60, '60'], [72, '72'], [80, '80'], [100, '100'], [120, '120']],
    show: s => !game(s) && s.durations, hint: () => 'Le bouton « ♩ = tempo » en haut lance le métronome' },
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
      row.innerHTML = `<div class="lbl">${c.label}</div><span class="seg">${c.opts.map(([v, t]) =>
        `<button class="${S[c.key] === v ? 'on' : ''}" data-i="${c.opts.findIndex(o => o[0] === v)}">${t}</button>`).join('')}</span>
        ${hint ? `<div class="hint-t">${hint}</div>` : ''}`;
      row.querySelectorAll('button').forEach(b => { b.onclick = () => set(c.key, c.opts[+b.dataset.i][0]); });
    }
    box.appendChild(row);
  }
}

function renderStats() {
  $('#statsClef').textContent = S.clef === 'treble' ? '· clé de sol' : '· clé de fa';
  const rows = Object.entries(stats)
    .filter(([k, v]) => k.startsWith(S.clef + ':') && v.n >= 3)
    .map(([k, v]) => { const [, d, a] = k.split(':').map(Number); return { n: makeNote(d, a), rate: v.ok / v.n, cnt: v.n }; })
    .filter(r => r.rate < 1)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 8);
  $('#statsList').innerHTML = rows.length
    ? rows.map(r => `<div class="statline"><span>${noteName(r.n, S.notation === 'both' ? 'fr' : S.notation)}</span>
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
  const clef = free() ? FREE.clef : S.clef;
  document.querySelectorAll('#clefSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === clef));
  document.querySelectorAll('#actSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.activity));
}

function set(key, val) {
  S[key] = val;
  save('settings', S);
  refreshAll();
}

function refreshAll() {
  syncHeader();
  renderControls();
  renderStats();
  renderHead();
  buildKeyboard();
  applyKbVisibility();
  if (free()) enterFree(); else stopGame();
  renderMetro();
}

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
  else if (free() && FREE.clef !== S.clef) enterFree();
});
$('#metroBtn').onclick = () => (METRO.on ? metroStop : metroStart)();
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
  onNoteOn: n => { kb.down(n); press(n, 'midi'); },
  onNoteOff: n => { kb.up(n); release(n); },
  onStatus: s => { Object.assign(midi, { names: [], denied: false }, s); renderMidi(); },
});

// ---------- démarrage ----------
applyTheme();
renderMidi();
refreshAll();
document.fonts?.ready.then(() => { if (free()) renderFree(false); else if (G.phase !== 'playing') renderStaff(staffSvg, { clef: S.clef }); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
