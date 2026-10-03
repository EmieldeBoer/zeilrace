// ============================================================
//  Zeilrace — feest bij de finish: confetti, vuurwerk en geluid
//  Gebruik: Feest.start({ titel, sub })   → knallen maar!
//           Feest.meer()                   → nog meer vuurwerk + confetti
//           Feest.confetti(n)              → alleen een confettiregen
//  Het paneel (titel, sub en de twee knoppen) tekent React: zie
//  useFeestPaneel() en src/components/FeestPaneel.tsx.
// ============================================================
import { useSyncExternalStore } from "react";
import { initAudio } from "./geluid";

// ---------- het paneel (kleine store voor React) ----------
export type FeestPaneelStaat = { open: boolean; titel: string; sub: string };
let paneel: FeestPaneelStaat = { open: false, titel: "", sub: "" };
const luisteraars = new Set<() => void>();
function zetPaneel(p: FeestPaneelStaat) { paneel = p; luisteraars.forEach((l) => l()); }
function abonneer(l: () => void) { luisteraars.add(l); return () => { luisteraars.delete(l); }; }
const leesPaneel = () => paneel;
export function useFeestPaneel(): FeestPaneelStaat {
  return useSyncExternalStore(abonneer, leesPaneel, leesPaneel);
}

type Confetti = { soort: "c"; x: number; y: number; vx: number; vy: number; rot: number; vr: number;
  b: number; h: number; kleur: string; fase: number; munt: boolean };
type Vonk = { soort: "v"; x: number; y: number; vx: number; vy: number; kleur: string; leven: number; max: number; glitter?: boolean };
type Raket = { x: number; y: number; vx: number; vy: number; doel: number; kleur: string; kleur2: string };
type Klok = ReturnType<typeof setTimeout>;

const KLEUREN = ["#ffe08a", "#ff6b6b", "#7ec8ff", "#8ff0b0", "#f0932b", "#e05fd8", "#ffffff", "#4a90e2"];
// confetti = goudstukken, robijnen, smaragden en perkamentsnippers
const SCHAT = ["#f0c75e", "#e2b13c", "#fff1b8", "#c9a24a", "#b3261e", "#2f8f63", "#efe3c6", "#f0c75e"];
const schat = () => SCHAT[Math.floor(Math.random() * SCHAT.length)];
const MINDER = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let cv: HTMLCanvasElement | null = null, g!: CanvasRenderingContext2D, loopt = false, ruis: AudioBuffer | null = null,
  master: GainNode | null = null, reeks: Klok | undefined;
let deeltjes: (Confetti | Vonk)[] = [], raketten: Raket[] = [];
const W = () => innerWidth, H = () => innerHeight;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const kleur = () => KLEUREN[Math.floor(Math.random() * KLEUREN.length)];

// ---------- opbouw ----------
function maak() {
  if (cv) return;
  cv = document.createElement("canvas");
  cv.className = "feest-canvas";
  document.body.appendChild(cv);
  g = cv.getContext("2d")!;
  addEventListener("resize", maat);
  maat();
}
function maat() {
  const r = Math.min(devicePixelRatio || 1, 2);
  cv!.width = W() * r; cv!.height = H() * r;
  g.setTransform(r, 0, 0, r, 0, 0);
}

// ---------- geluid (Web Audio, gesynthetiseerd) ----------
// Keten: elke knal → stereo-positie → [droog + galm] → verzadiging → limiter.
// De verzadiging maakt boventonen van de dreun, zodat je die ook op een
// telefoonspeaker hoort; de limiter houdt het hard maar zonder kraken.
let audioCtx!: AudioContext, galmIn: GainNode | null = null;
function zachteKlip(k: number) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}
function impuls(sec: number, verval: number) {      // nagalm van buitenlucht / havenmuren
  const len = Math.floor(audioCtx.sampleRate * sec), b = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, verval);
  }
  return b;
}
function audio() {
  const ac = initAudio();
  if (!ac) return false;
  audioCtx = ac;
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  if (!master) {
    master = audioCtx.createGain(); master.gain.value = 0.9;
    const klip = audioCtx.createWaveShaper(); klip.curve = zachteKlip(2.2); klip.oversample = "4x";
    const lim = audioCtx.createDynamicsCompressor();
    lim.threshold.value = -9; lim.knee.value = 3; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.15;
    master.connect(klip).connect(lim).connect(audioCtx.destination);
    const galm = audioCtx.createConvolver(); galm.buffer = impuls(2.4, 2.8);
    galmIn = audioCtx.createGain(); galmIn.gain.value = 0.32;
    galmIn.connect(galm).connect(klip);
  }
  if (!ruis) {
    const len = audioCtx.sampleRate * 2;
    ruis = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const d = ruis.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return true;
}
function ruisBron(t0: number, duur: number) {
  const s = audioCtx.createBufferSource();
  s.buffer = ruis; s.loop = true; s.start(t0, Math.random() * 1.5); s.stop(t0 + duur);
  return s;
}
function bus(pan: number) {                         // ingang met stereo-positie, droog + galm
  const p = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : audioCtx.createGain();
  if ("pan" in p) p.pan.value = Math.max(-1, Math.min(1, pan || 0));
  p.connect(master!); p.connect(galmIn!);
  return p;
}
function omhulling(t0: number, piek: number, aanval: number, duur: number) {        // snel aan, exponentieel uitsterven
  const gn = audioCtx.createGain();
  gn.gain.setValueAtTime(0.0001, t0);
  gn.gain.exponentialRampToValueAtTime(piek, t0 + aanval);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + duur);
  return gn;
}
function filter(type: BiquadFilterType, freq: number, q?: number) {
  const f = audioCtx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
  return f;
}
function toon(type: OscillatorType, van: number, naar: number, t0: number, sweep: number, piek: number, duur: number, uit: AudioNode) {
  const o = audioCtx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(van, t0); o.frequency.exponentialRampToValueAtTime(naar, t0 + sweep);
  o.connect(omhulling(t0, piek, 0.002, duur)).connect(uit);
  o.start(t0); o.stop(t0 + duur + 0.05);
  return o;
}
function fluit(pan: number) {                       // lancering: plop + sissende staart (geen piepjes)
  if (!audio()) return;
  const t0 = audioCtx.currentTime, uit = bus(pan), duur = rnd(0.75, 1.05);
  toon("sine", 220, 55, t0, 0.07, 0.6, 0.12, uit);                 // mortier-plop
  ruisBron(t0, 0.05).connect(filter("lowpass", 1200)).connect(omhulling(t0, 0.5, 0.001, 0.05)).connect(uit);
  const f = filter("bandpass", 600, 1.4);                          // sissende staart (breed: klinkt als lont, niet als toon)
  f.frequency.setValueAtTime(600, t0); f.frequency.exponentialRampToValueAtTime(3500, t0 + duur);
  const gn = audioCtx.createGain();
  gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(0.3, t0 + 0.1); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + duur);
  ruisBron(t0, duur).connect(f).connect(gn).connect(uit);
}
function knal(sterk: number, pan: number) {         // KNAL: klap + lijf + dreun + punch (+ geknetter)
  if (!audio()) return;
  const t0 = audioCtx.currentTime + 0.005, uit = bus(pan);
  const salute = Math.random() < 0.25;              // af en toe een extra zware kanonslag
  const s = sterk * (salute ? 1.35 : 1);
  // 1. de klap: een paar ms keiharde ruis → de scherpe 'snap'
  ruisBron(t0, 0.03).connect(filter("highpass", 500)).connect(omhulling(t0, 2.2 * s, 0.0008, 0.035)).connect(uit);
  // 2. het lijf: ruis die razendsnel donkerder wordt (ontploffing + rommel)
  const lp = filter("lowpass", 8000, 0.8);
  lp.frequency.setValueAtTime(8000, t0);
  lp.frequency.exponentialRampToValueAtTime(1100, t0 + 0.1);
  lp.frequency.exponentialRampToValueAtTime(160, t0 + (salute ? 1.4 : 0.9));
  ruisBron(t0, 1.6).connect(lp).connect(omhulling(t0, 0.85 * s, 0.002, salute ? 1.3 : 0.9)).connect(uit);
  // 3. de dreun in je buik
  toon("sine", 150, 36, t0, 0.32, 1.5 * s, salute ? 0.8 : 0.55, uit);
  // 4. punch in het middengebied (hoorbaar op telefoonspeakers)
  toon("triangle", 360, 85, t0, 0.12, 0.9 * s, 0.2, uit);
  // 5. echo tegen de kust
  const echoT = t0 + rnd(0.28, 0.45);
  ruisBron(echoT, 0.5).connect(filter("lowpass", 900)).connect(omhulling(echoT, 0.35 * s, 0.01, 0.5)).connect(uit);
  // 6. geknetter (niet bij de kanonslag)
  if (!salute) knetter(t0 + rnd(0.3, 0.55), sterk, pan);
}
function knetter(t0: number, sterk: number, pan: number) {                  // tientallen knisperende mini-knalletjes
  const n = Math.floor(rnd(30, 70));
  for (let i = 0; i < n; i++) {
    const t = t0 + Math.pow(Math.random(), 1.4) * rnd(1.2, 1.9);
    ruisBron(t, 0.015).connect(filter("bandpass", rnd(1800, 6500), 1.1))
      .connect(omhulling(t, rnd(0.3, 0.9) * sterk, 0.0005, rnd(0.004, 0.014)))
      .connect(bus(pan + rnd(-0.5, 0.5)));
  }
}
const panVan = (x: number) => ((x / W()) * 2 - 1) * 0.8;

// ---------- deeltjes ----------
function confetti(n: number) {
  maak();
  n = MINDER ? Math.round(n / 4) : n;
  for (let i = 0; i < n; i++) {
    const links = i % 2 === 0;                      // kanonnen linksonder en rechtsonder
    deeltjes.push({ soort: "c", x: links ? -10 : W() + 10, y: H() * rnd(0.7, 1),
      vx: (links ? 1 : -1) * rnd(4, 13), vy: -rnd(9, 19), rot: rnd(0, 6.3), vr: rnd(-0.3, 0.3),
      b: rnd(6, 11), h: rnd(9, 16), kleur: schat(), fase: rnd(0, 6.3), munt: Math.random() < 0.4 });
  }
  go();
}
function raket() {
  maak();
  const r: Raket = { x: W() * rnd(0.15, 0.85), y: H() + 5, vx: rnd(-1, 1), vy: -rnd(H() * 0.016, H() * 0.021),
    doel: H() * rnd(0.12, 0.42), kleur: kleur(), kleur2: kleur() };
  raketten.push(r);
  fluit(panVan(r.x));
  go();
}
function ontplof(r: Raket) {
  const n = MINDER ? 30 : Math.floor(rnd(80, 130));
  const glitter = Math.random() < 0.4;
  for (let i = 0; i < n; i++) {
    const hoek = (i / n) * Math.PI * 2 + rnd(-0.05, 0.05), snel = rnd(1.5, 6.5);
    const leven = rnd(55, 95);
    deeltjes.push({ soort: "v", x: r.x, y: r.y, vx: Math.cos(hoek) * snel, vy: Math.sin(hoek) * snel,
      kleur: i % 3 === 0 ? r.kleur2 : r.kleur, leven, max: leven, glitter });
  }
  knal(rnd(0.75, 1), panVan(r.x));
}

// ---------- animatie ----------
function go() { if (!loopt) { loopt = true; requestAnimationFrame(frame); } }
function frame() {
  // vervaag het vorige beeld (geeft sporen), op een doorzichtige canvas
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.fillRect(0, 0, W(), H());
  g.globalCompositeOperation = "lighter";

  raketten = raketten.filter((r) => {
    r.x += r.vx; r.y += r.vy; r.vy *= 0.985;
    g.fillStyle = "#fff4c2";
    g.beginPath(); g.arc(r.x, r.y, 2.6, 0, 7); g.fill();
    deeltjes.push({ soort: "v", x: r.x, y: r.y + 4, vx: rnd(-0.4, 0.4), vy: rnd(0.5, 1.5), kleur: "#ffcf70", leven: 18, max: 18 });
    if (r.y <= r.doel || r.vy > -1.5) { ontplof(r); return false; }
    return true;
  });

  deeltjes = deeltjes.filter((d) => {
    if (d.soort === "c") {
      d.vy += 0.32; d.vx *= 0.985; d.vy *= 0.985; d.fase += 0.12;
      d.x += d.vx + Math.sin(d.fase) * 0.9; d.y += d.vy; d.rot += d.vr;
      g.globalCompositeOperation = "source-over";
      g.save(); g.translate(d.x, d.y); g.rotate(d.rot); g.scale(1, Math.cos(d.fase));
      if (d.munt) {                                   // gouden dubloen met rand
        g.fillStyle = "#e2b13c"; g.beginPath(); g.arc(0, 0, d.h * 0.55, 0, 7); g.fill();
        g.strokeStyle = "#8a6418"; g.lineWidth = 1.5; g.stroke();
        g.fillStyle = "#fff1b8"; g.beginPath(); g.arc(-d.h * 0.15, -d.h * 0.15, d.h * 0.18, 0, 7); g.fill();
      } else { g.fillStyle = d.kleur; g.fillRect(-d.b / 2, -d.h / 2, d.b, d.h); }
      g.restore();
      g.globalCompositeOperation = "lighter";
      return d.y < H() + 40;
    }
    d.vx *= 0.975; d.vy = d.vy * 0.975 + 0.06; d.x += d.vx; d.y += d.vy; d.leven--;
    const a = Math.max(0, d.leven / d.max);
    if (d.glitter && Math.random() < 0.35) return d.leven > 0;
    g.globalAlpha = a;
    g.fillStyle = d.kleur;
    g.beginPath(); g.arc(d.x, d.y, 2.2, 0, 7); g.fill();
    g.globalAlpha = 1;
    return d.leven > 0;
  });
  if (deeltjes.length > 2500) deeltjes.splice(0, deeltjes.length - 2500);

  if (deeltjes.length || raketten.length) requestAnimationFrame(frame);
  else { loopt = false; g.clearRect(0, 0, W(), H()); }
}

// ---------- publiek ----------
let wachtrij: Klok[] = [];
function salvo(aantal: number, over: number) {
  for (let i = 0; i < aantal; i++) wachtrij.push(setTimeout(raket, i * (over / aantal) + rnd(0, 250)));
}
function start(o?: { titel?: string; sub?: string }) {
  maak();
  zetPaneel({ open: true, titel: (o && o.titel) || "🏁 Gefinisht!", sub: (o && o.sub) || "" });
  kanonnen();
  confetti(160);
  salvo(6, 2600);
  clearTimeout(reeks);
  reeks = setTimeout(() => { if (paneel.open) { confetti(90); salvo(4, 2000); } }, 3200);
}
function kanonnen() {                               // de confettikanonnen vuren: links, dan rechts
  knal(1, -0.8);
  wachtrij.push(setTimeout(() => knal(1, 0.8), 220));
}
function meer() {
  kanonnen();
  confetti(220);
  salvo(8, 1800);
}
function stop() {
  if (paneel.open) zetPaneel({ ...paneel, open: false });
  clearTimeout(reeks);
  wachtrij.forEach((t) => clearTimeout(t)); wachtrij = [];
  raketten = [];
}
export const Feest = { start, meer, stop, confetti };
