// --- Piratenschepen als kaartsymbool (bovenaanzicht, draaien mee met de koers) ---
// Drie modellen, op dezelfde schaal getekend (in meters), zodat de onderlinge
// lengteverschillen van de echte boten kloppen (BOTEN[..].schip in de config).
//   sloep      — 1 mast met fok, 2 kanonnen per kant
//   brigantijn — 2 masten met fok, klein achterdek, 3 kanonnen per kant
//   fregat     — 3 masten, hoog achterkasteel met raampjes, 4 kanonnen per kant
import { BOTEN, type SchipType } from "../../convex/lib/config";

export const SCHIP_PX_PER_M = 4;                  // schaal op de kaart
const SCHIP_TYPES: Record<SchipType, { masten: number[]; zeilB: number[]; kanonnen: number; kasteel: number; fok: boolean; spiegel: number }> = {
  sloep: { masten: [-0.03], zeilB: [1.5], kanonnen: 2, kasteel: 0, fok: true, spiegel: 0.28 },
  brigantijn: { masten: [-0.2, 0.12], zeilB: [1.3, 1.5], kanonnen: 3, kasteel: 0.17, fok: true, spiegel: 0.36 },
  fregat: { masten: [-0.27, -0.02, 0.22], zeilB: [1.25, 1.55, 1.3], kanonnen: 4, kasteel: 0.26, fok: false, spiegel: 0.42 },
};
export type SchipStijl = "kaart" | "piraat";
type Deel = { d: string; fill?: string; stroke?: string; lw?: number; schaduw?: boolean };
type Onderdelen = { delen: Deel[]; links: number; boven: number; onder: number };

// Onderdelen van het schip als SVG-paden in meters (boeg naar boven = −y).
// Dezelfde paden worden op de kaart (SVG) en in de export (canvas) getekend.
// stijl 'kaart'  = eenvoudig scheepje zoals op een oude zeekaart (tijdens de race)
// stijl 'piraat' = het uitgebreide piratenschip (tijdens het piratenspel)
export function schipOnderdelen(boot: string, stijl: SchipStijl = "piraat"): Onderdelen {
  const cfg = (BOTEN[boot] && BOTEN[boot].schip) || { type: "brigantijn" as SchipType, romp: 13, breedte: 4.4 };
  const T = SCHIP_TYPES[cfg.type] || SCHIP_TYPES.brigantijn, kleur = (BOTEN[boot] && BOTEN[boot].kleur) || "#888";
  const L = cfg.romp, hL = L / 2, b = cfg.breedte / 2, s = b * T.spiegel;
  const f = (n: number) => +n.toFixed(2);
  const romp = (k: number) => {
    const h = hL * k, w = b * k, t = s * k;
    return `M0 ${f(-h)} C${f(w * .95)} ${f(-h * .62)} ${f(w * 1.05)} ${f(-h * .15)} ${f(w)} ${f(h * .25)} ` +
      `C${f(w * .98)} ${f(h * .6)} ${f(t * 1.25)} ${f(h * .93)} ${f(t)} ${f(h)} L${f(-t)} ${f(h)} ` +
      `C${f(-t * 1.25)} ${f(h * .93)} ${f(-w * .98)} ${f(h * .6)} ${f(-w)} ${f(h * .25)} ` +
      `C${f(-w * 1.05)} ${f(-h * .15)} ${f(-w * .95)} ${f(-h * .62)} 0 ${f(-h)}Z`;
  };
  const cirkel = (y: number, r: number) => `M${f(-r)} ${f(y)} a${r} ${r} 0 1 0 ${f(2 * r)} 0 a${r} ${r} 0 1 0 ${f(-2 * r)} 0`;
  const kader = { links: b + 1.2, boven: hL + L * .14, onder: hL + .6 };
  if (stijl === "kaart") {
    // Inkt op perkament: romp in de bootkleur, mast + giek, en een zog achter het schip
    const inkt = "#2b1b0d";
    return { delen: [
      { d: `M${f(-s * .8)} ${f(hL + .3)} Q${f(-b * .9)} ${f(hL + L * .07)} ${f(-b * 1.1)} ${f(hL + .55)}` +
           ` M${f(s * .8)} ${f(hL + .3)} Q${f(b * .9)} ${f(hL + L * .07)} ${f(b * 1.1)} ${f(hL + .55)}`, stroke: inkt, lw: .22 },  // zog
      { d: romp(1), fill: kleur, stroke: inkt, lw: .5, schaduw: true },                                           // romp
      { d: romp(.62), fill: "none", stroke: "rgba(255,248,230,.65)", lw: .25 },                                   // dekrand
      { d: `M0 ${f(L * -.08)} L0 ${f(hL * .78)}`, stroke: inkt, lw: .3 },                                         // giek
      { d: cirkel(L * -.08, .45), fill: inkt },                                                                    // mast
      { d: `M0 ${f(-hL + .4)} L0 ${f(-hL - L * .08)}`, stroke: inkt, lw: .3 },                                     // boegspriet
    ], ...kader };
  }
  const d: Deel[] = [];
  d.push({ d: `M0 ${f(-hL + .3)} L0 ${f(-hL - L * .12)}`, stroke: "#3b2a18", lw: .35 });                 // boegspriet
  d.push({ d: romp(1), fill: "#5a3418", stroke: "#1f140a", lw: .4, schaduw: true });                     // romp
  d.push({ d: romp(.84), fill: "#a8753f" });                                                             // dek
  d.push({ d: `M${f(-b * .35)} ${f(-hL * .5)} V${f(hL * .8)} M0 ${f(-hL * .75)} V${f(hL * .84)} M${f(b * .35)} ${f(-hL * .5)} V${f(hL * .8)}`,
    stroke: "#7d5328", lw: .12 });                                                                       // planken
  if (T.kasteel) {                                                                                       // achterdek / -kasteel
    const y0 = hL - L * T.kasteel;
    d.push({ d: `M${f(-b * .8)} ${f(y0)} H${f(b * .8)} L${f(s * .95)} ${f(hL * .97)} H${f(-s * .95)}Z`, fill: "#7a4a22", stroke: "#1f140a", lw: .2 });
    d.push({ d: `M${f(-b * .62)} ${f(y0 + .3)} H${f(b * .62)}`, stroke: "#c9a24a", lw: .18 });
    if (cfg.type === "fregat")
      d.push({ d: [-.55, 0, .55].map((x) => `M${f(s * x - .25)} ${f(hL * .9)} h.5 v.4 h-.5Z`).join(" "), fill: "#f0c75e" });
  }
  for (let i = 0; i < T.kanonnen; i++) {                                                                 // kanonnen
    const y = -hL * .3 + (T.kanonnen > 1 ? i * hL * .75 / (T.kanonnen - 1) : 0), w = b * 1.02;
    d.push({ d: `M${f(w - .3)} ${f(y - .28)} h.6 v.56 h-.6Z M${f(-w + .3)} ${f(y - .28)} h-.6 v.56 h.6Z`, fill: "#161616" });
  }
  if (T.fok) {                                                                                           // fok
    const my = L * T.masten[0];
    d.push({ d: `M0 ${f(-hL - L * .1)} L${f(b * .45)} ${f(my - .4)} L0 ${f(my - .4)}Z`, fill: "#f4ead3", stroke: "#8a6a3a", lw: .12 });
  }
  T.masten.forEach((m, i) => {                                                                           // zeilen + masten
    const y = L * m, w = b * T.zeilB[i], dp = 1.1;
    d.push({ d: `M${f(-w)} ${f(y)} Q0 ${f(y + dp * 1.6)} ${f(w)} ${f(y)} L${f(w * .92)} ${f(y + dp)} Q0 ${f(y + dp * 2.4)} ${f(-w * .92)} ${f(y + dp)}Z`,
      fill: "#f4ead3", stroke: "#8a6a3a", lw: .14 });
    d.push({ d: `M${f(-w * .8)} ${f(y + dp * .62)} Q0 ${f(y + dp * 1.95)} ${f(w * .8)} ${f(y + dp * .62)}`, stroke: kleur, lw: .32 });
    d.push({ d: cirkel(y + .2, .35), fill: "#3b2a18" });
  });
  const gm = L * T.masten[Math.floor(T.masten.length / 2)];                                               // wimpel
  d.push({ d: `M0 ${f(gm)} L0 ${f(gm - 2.1)} L${f(b * .9)} ${f(gm - 1.6)} L0 ${f(gm - 1.1)}`, fill: kleur, stroke: "#1f140a", lw: .12 });
  // kader (m) rond het midden van de romp: links/rechts, boven (boegspriet) en onder
  return { delen: d, ...kader };
}
// pixelmaat + ankerpunt (midden van de romp) op de kaart
export function schipMaat(boot: string, stijl: SchipStijl = "piraat") {
  const s = schipOnderdelen(boot, stijl), px = SCHIP_PX_PER_M;
  return { b: Math.round(2 * s.links * px), h: Math.round((s.boven + s.onder) * px),
    ax: Math.round(s.links * px), ay: Math.round(s.boven * px), s };
}
export function schipSvg(boot: string, stijl: SchipStijl = "piraat"): string {
  const { b, h, s } = schipMaat(boot, stijl);
  const pad = (p: Deel) => `<path d="${p.d}" fill="${p.fill || "none"}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.lw}" stroke-linecap="round"` : ""}/>`;
  return `<svg class="schip-svg ${stijl}" viewBox="${-s.links} ${-s.boven} ${2 * s.links} ${s.boven + s.onder}" width="${b}" height="${h}" aria-hidden="true">` +
    s.delen.map(pad).join("") + "</svg>";
}
// Voor het canvas (export-video/foto): hetzelfde schip, pxPerM pixels per meter
export function tekenSchipCanvas(c: CanvasRenderingContext2D, x: number, y: number, koers: number | null | undefined,
  boot: string, pxPerM: number, stijl: SchipStijl = "kaart") {
  const s = schipOnderdelen(boot, stijl);
  c.save(); c.translate(x, y); c.rotate((koers || 0) * Math.PI / 180); c.scale(pxPerM, pxPerM);
  c.lineCap = "round"; c.lineJoin = "round";
  s.delen.forEach((p) => {
    const pad = new Path2D(p.d);
    if (p.schaduw) { c.shadowColor = "rgba(0,0,0,.55)"; c.shadowBlur = 4; c.shadowOffsetY = 2; }
    if (p.fill) { c.fillStyle = p.fill; c.fill(pad); }
    c.shadowColor = "transparent";
    if (p.stroke) { c.strokeStyle = p.stroke; c.lineWidth = p.lw!; c.stroke(pad); }
  });
  c.restore();
}
export const schipLabelOffset = (boot: string): [number, number] => [0, -schipMaat(boot).ay + 4];
