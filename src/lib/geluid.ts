// --- Geluid (Web Audio — gesynthetiseerd, geen bestanden nodig) ---
let audioCtx: AudioContext | null = null;

// De gedeelde AudioContext (na een tik op de pagina mag hij geluid maken)
export function initAudio(): AudioContext | null {
  if (!audioCtx) {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new Ctx();
    } catch { /* geen geluid */ }
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function speel(geluid: () => void) {
  if (!initAudio()) return;
  geluid();
}

// --- Kanonschot (startsignalen) ----------------------------------
// Klap + ontploffing + dreun + punch (voor telefoonspeakers) + echo over
// het water, door verzadiging en een limiter: hard, maar zonder kraken.
let kanonUit: GainNode | null = null, kanonRuis: AudioBuffer | null = null;
function kanonKeten(ac: AudioContext): GainNode {
  if (kanonUit) return kanonUit;
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5); }
  const klip = ac.createWaveShaper(); klip.curve = curve; klip.oversample = "4x";
  const lim = ac.createDynamicsCompressor();
  lim.threshold.value = -8; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.2;
  kanonUit = ac.createGain();
  kanonUit.connect(klip).connect(lim).connect(ac.destination);
  const len = ac.sampleRate * 3;
  kanonRuis = ac.createBuffer(1, len, ac.sampleRate);
  const d = kanonRuis.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return kanonUit;
}
export function kanonschot(zwaar?: boolean) {
  const ac = initAudio(); if (!ac) return;
  const uit = kanonKeten(ac), t0 = ac.currentTime + 0.02, s = zwaar ? 1.25 : 1;
  const omhul = (t: number, piek: number, aanval: number, duur: number) => {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(piek, t + aanval);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duur);
    return g;
  };
  const ruis = (t: number, duur: number) => {
    const b = ac.createBufferSource(); b.buffer = kanonRuis; b.start(t, Math.random() * 0.5); b.stop(t + duur);
    return b;
  };
  const filter = (type: BiquadFilterType, f: number) => { const x = ac.createBiquadFilter(); x.type = type; x.frequency.value = f; return x; };
  const toon = (type: OscillatorType, van: number, naar: number, sweep: number, piek: number, duur: number) => {
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(van, t0); o.frequency.exponentialRampToValueAtTime(naar, t0 + sweep);
    o.connect(omhul(t0, piek, 0.003, duur)).connect(uit); o.start(t0); o.stop(t0 + duur + 0.05);
  };
  // 1. de klap
  ruis(t0, 0.05).connect(filter("highpass", 400)).connect(omhul(t0, 2 * s, 0.0008, 0.045)).connect(uit);
  // 2. de ontploffing: ruis die snel donker wordt en lang narommelt
  const lp = filter("lowpass", 5000);
  lp.frequency.setValueAtTime(5000, t0);
  lp.frequency.exponentialRampToValueAtTime(700, t0 + 0.08);
  lp.frequency.exponentialRampToValueAtTime(90, t0 + 1.8 * s);
  ruis(t0, 2.4).connect(lp).connect(omhul(t0, 1.3 * s, 0.003, 2.1 * s)).connect(uit);
  // 3. de dreun en 4. de punch
  toon("sine", 110, 30, 0.6, 1.6 * s, 0.95);
  toon("triangle", 260, 65, 0.2, 1.0 * s, 0.32);
  // 5. echo's tegen de kust
  [[0.42, 0.45], [0.95, 0.22]].forEach(([dt, v]) => {
    const t = t0 + dt, e = filter("lowpass", 700);
    ruis(t, 0.9).connect(e).connect(omhul(t, v * s, 0.02, 0.85)).connect(uit);
  });
}

// --- Nautische signalen: scheepsbel, bootsmansfluit, misthoorn ---
// Schone keten (geen verzadiging, wel een limiter), los van de kanonnen.
let schoonUit: GainNode | null = null;
function schoon(ac: AudioContext): GainNode {
  if (schoonUit) return schoonUit;
  const lim = ac.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.25;
  schoonUit = ac.createGain(); schoonUit.gain.value = 0.9;
  schoonUit.connect(lim).connect(ac.destination);
  return schoonUit;
}
function omhulling(ac: AudioContext, t: number, piek: number, aanval: number, duur: number) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(piek, t + aanval);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duur);
  return g;
}
// Scheepsbel: klokdeeltonen (niet-harmonisch) die elk in hun eigen tempo uitsterven
function belslag(ac: AudioContext, t: number, vol: number) {
  const uit = schoon(ac), f = 880;
  [[0.5, 0.35, 3.2], [1, 1, 2.4], [1.19, 0.55, 1.9], [1.5, 0.45, 1.6], [2, 0.6, 1.3],
   [2.52, 0.3, 0.9], [3.01, 0.22, 0.7], [4.16, 0.14, 0.45], [5.43, 0.08, 0.3]].forEach(([r, a, duur]) => {
    const o = ac.createOscillator(); o.type = "sine";
    o.frequency.value = f * r * (1 + (Math.random() - 0.5) * 0.002);
    o.connect(omhulling(ac, t, a * vol, 0.002, duur)).connect(uit);
    o.start(t); o.stop(t + duur + 0.05);
  });
  // de tik van de klepel
  const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = 3400;
  o.connect(omhulling(ac, t, 0.25 * vol, 0.0005, 0.03)).connect(uit); o.start(t); o.stop(t + 0.05);
}
export function scheepsbel(glazen: number, vol = 0.32) {      // 'glazen' in paren: ding-ding · ding-ding
  const ac = initAudio(); if (!ac) return;
  let t = ac.currentTime + 0.02;
  for (let i = 0; i < glazen; i++) { belslag(ac, t, vol); t += i % 2 === 0 ? 0.32 : 0.85; }
}
// Bootsmansfluit: hoge fluittoon die opzwelt, vasthoudt, trillert en wegzakt
export function bootsmansfluit() {
  const ac = initAudio(); if (!ac) return;
  const uit = schoon(ac), t0 = ac.currentTime + 0.02;
  const o = ac.createOscillator(); o.type = "sine";
  const f = o.frequency;
  f.setValueAtTime(1500, t0); f.exponentialRampToValueAtTime(2350, t0 + 0.45);
  f.setValueAtTime(2350, t0 + 1.2); f.exponentialRampToValueAtTime(1700, t0 + 1.6);
  f.setValueAtTime(1700, t0 + 1.62); f.exponentialRampToValueAtTime(2350, t0 + 1.75);
  f.setValueAtTime(2350, t0 + 1.95); f.exponentialRampToValueAtTime(1300, t0 + 2.35);
  const vib = ac.createOscillator(), vg = ac.createGain();   // de 'rol' van de fluit
  vib.frequency.value = 23; vg.gain.setValueAtTime(8, t0); vg.gain.setValueAtTime(70, t0 + 0.9); vg.gain.setValueAtTime(10, t0 + 1.2);
  vib.connect(vg).connect(f);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.42, t0 + 0.2);
  g.gain.setValueAtTime(0.42, t0 + 2.1); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
  o.connect(g).connect(uit);
  o.start(t0); o.stop(t0 + 2.45); vib.start(t0); vib.stop(t0 + 2.45);
}
// Misthoorn: lage, brede hoorn (zaagtand + koor, gefilterd), 'stoten' lange stoten
export function misthoorn(stoten = 2) {
  const ac = initAudio(); if (!ac) return;
  const uit = schoon(ac);
  let t = ac.currentTime + 0.02;
  for (let s = 0; s < stoten; s++) {
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 3;
    lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1500, t + 0.25);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.18);
    g.gain.setValueAtTime(0.5, t + 1.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.65);
    lp.connect(g).connect(uit);
    ([[196, "sawtooth", 0.5], [196 * 1.006, "sawtooth", 0.4], [98, "square", 0.25], [294, "sawtooth", 0.15]] as const).forEach(([fr, type, a]) => {
      const o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(fr * 0.94, t); o.frequency.exponentialRampToValueAtTime(fr, t + 0.2);
      const og = ac.createGain(); og.gain.value = a;
      o.connect(og).connect(lp); o.start(t); o.stop(t + 1.7);
    });
    t += 2.1;
  }
}

export const GELUID = {
  vijfmin: () => kanonschot(),               // 5 minuten voor de start
  eenmin: () => kanonschot(),                // 1 minuut voor de start
  start: () => kanonschot(true),             // startsein: het zwaarste schot
  startlijn: () => scheepsbel(1),            // over de startlijn: één glas
  boei: () => scheepsbel(2),                 // boei gerond: twee glazen
  finish: () => bootsmansfluit(),            // finish: alle hens aan dek!
  alarm: () => misthoorn(2),                 // GPS weg / boot offline: de misthoorn
  hersteld: () => scheepsbel(1, 0.2),        // GPS weer terug: één zachte bel
};

// Kanonschoten bij het aftellen naar een begin (5 min, 1 min en het begin zelf).
// vorige/rem = resterende ms bij de vorige en bij deze tik. Net op de knop gedrukt
// (eerste tik binnen 5 s na het 5-minutenmoment)? Dan klinkt het 5-minutenschot ook.
export function aftelSchoten(vorige: number | null, rem: number | null) {
  if (rem == null) return;
  if (vorige == null) { if (rem <= 300000 && rem > 295000) speel(GELUID.vijfmin); return; }
  if (vorige > 300000 && rem <= 300000) speel(GELUID.vijfmin);
  if (vorige > 60000 && rem <= 60000) speel(GELUID.eenmin);
  if (vorige > 0 && rem <= 0) speel(GELUID.start);
}
