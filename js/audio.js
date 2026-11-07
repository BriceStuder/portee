// Petit synthé « piano » en Web Audio (somme de partiels, attaque franche, décroissance).
let ctx = null, out = null;

function init() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  out = ctx.createGain();
  out.gain.value = 0.6;
  out.connect(comp).connect(ctx.destination);
}

const PARTIALS = [[1, 1], [2, 0.42], [3, 0.2], [4, 0.1], [5, 0.05]];

export function playNote(midi) {
  init();
  if (ctx.state === 'suspended') ctx.resume();
  const f = 440 * 2 ** ((midi - 69) / 12);
  const t = ctx.currentTime;
  const dur = 2.2 - Math.min(1.2, Math.max(0, (midi - 48) / 40)); // les aigus s'éteignent plus vite

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(9000, f * 9), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2), t + dur * 0.6);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  lp.connect(g).connect(out);

  for (const [k, a] of PARTIALS) {
    if (f * k > 12000) break;
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.value = f * k * (1 + 0.0004 * k * k); // légère inharmonicité
    og.gain.value = a;
    o.connect(og).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

export function audioNow() {
  init();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx.currentTime;
}

/** Clic de métronome (plus aigu sur le premier temps), joué à l'instant « when » de l'horloge audio. */
export function click(accent, when) {
  init();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g).connect(out);
  o.start(when);
  o.stop(when + 0.06);
}
