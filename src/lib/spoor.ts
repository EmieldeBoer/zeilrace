// ============================================================
//  Opgeslagen sporen (replay, export, polars): positie op tijd t,
//  overstagmomenten, snelheid langs het spoor.
// ============================================================
import { afstandMeter, peiling } from "./geo";

// Spoor = [[lat, lng, s], ...] met s = seconden sinds het begin van de opname.
export type SpoorPt = [number, number, number];

// Oude sporen zonder tijd krijgen hun volgnummer als tijd.
export function normaliseerSpoor(v: unknown): SpoorPt[] {
  const lijst = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [];
  const pts = (lijst as unknown[][]).map((p, i): SpoorPt =>
    [Number(p[0]), Number(p[1]), p[2] != null ? Number(p[2]) : i]);
  return pts.filter((p) => !isNaN(p[0]) && !isNaN(p[1])).sort((a, b) => a[2] - b[2]);
}

// Positie op tijd t (lineair tussen twee punten); null vóór het eerste punt
export function positieOp(pts: SpoorPt[], t: number): { lat: number; lng: number; i: number } | null {
  if (!pts.length || t < pts[0][2]) return null;
  if (t >= pts[pts.length - 1][2]) return { lat: pts[pts.length - 1][0], lng: pts[pts.length - 1][1], i: pts.length - 1 };
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][2] <= t) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], f = b[2] > a[2] ? (t - a[2]) / (b[2] - a[2]) : 0;
  return { lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, i: lo };
}

// Overstagmomenten in een spoor tussen van en tot (s): een blijvende
// koerswijziging van minstens 55°, met een stabiele koers in de minuut ervoor én erna
// (zo tellen GPS-ruis en een korte zwieper niet mee).
// Zonder winddata is een gijp niet van een overstag te onderscheiden; aan de wind
// (kruisen) zijn het vrijwel altijd overstagmomenten.
export type Overstag = { lat: number; lng: number; s: number; hoek: number; voor: number; na: number };
export function overstagHoeken(pts: SpoorPt[], van = -Infinity, tot = Infinity): Overstag[] {
  const p = pts.filter((q) => q[2] >= van - 90 && q[2] <= tot + 90);
  if (p.length < 10) return [];
  // koers over de grond tussen punten die minstens 20 m uit elkaar liggen
  const koersen: { s: number; k: number; lat: number; lng: number }[] = [];
  for (let a = 0, i = 1; i < p.length; i++) {
    const A = { lat: p[a][0], lng: p[a][1] }, B = { lat: p[i][0], lng: p[i][1] };
    if (afstandMeter(A, B) >= 20) { koersen.push({ s: (p[a][2] + p[i][2]) / 2, k: peiling(A, B), lat: A.lat, lng: A.lng }); a = i; }
  }
  const rad = Math.PI / 180;
  const gemiddeld = (lo: number, hi: number) => {     // gemiddelde koers + hoe stabiel (R: 1 = recht)
    let x = 0, y = 0, n = 0;
    koersen.forEach((c) => { if (c.s >= lo && c.s <= hi) { x += Math.cos(c.k * rad); y += Math.sin(c.k * rad); n++; } });
    return n < 2 ? null : { k: (Math.atan2(y, x) / rad + 360) % 360, R: Math.hypot(x, y) / n };
  };
  const verschil = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180);
  const uit: Overstag[] = [];
  koersen.forEach((c) => {
    if (c.s < van || c.s > tot) return;
    const voor = gemiddeld(c.s - 75, c.s - 12), na = gemiddeld(c.s + 12, c.s + 75);
    if (!voor || !na || voor.R < 0.9 || na.R < 0.9) return;
    const hoek = verschil(voor.k, na.k);
    if (hoek < 55) return;
    const vorige = uit[uit.length - 1];            // binnen een minuut: hetzelfde overstagmoment
    if (vorige && c.s - vorige.s < 60) {
      if (hoek > vorige.hoek) Object.assign(vorige, { lat: c.lat, lng: c.lng, hoek, voor: voor.k, na: na.k });
    } else uit.push({ lat: c.lat, lng: c.lng, s: c.s, hoek, voor: voor.k, na: na.k });   // voor/na: koers vóór en na (°)
  });
  return uit.map((k) => Object.assign(k, { hoek: Math.round(k.hoek) }));
}

// Snelheid (kn) bij elk punt van een spoor, gemiddeld over ±venster
// seconden (tegen GPS-ruis). Null waar te weinig punten zijn.
export function snelheidsSpoor(pts: SpoorPt[], venster = 10): (number | null)[] {
  const v: (number | null)[] = new Array(pts.length).fill(null);
  for (let i = 0, a = 0, b = 0; i < pts.length; i++) {
    while (pts[a][2] < pts[i][2] - venster) a++;
    if (b < i) b = i;
    while (b + 1 < pts.length && pts[b + 1][2] <= pts[i][2] + venster) b++;
    const dt = pts[b][2] - pts[a][2];
    if (dt >= 5) v[i] = afstandMeter({ lat: pts[a][0], lng: pts[a][1] }, { lat: pts[b][0], lng: pts[b][1] }) / dt * 1.94384;
  }
  return v;
}
// Kleur bij een snelheid op schaal 0 (langzaam, blauw) … 1 (snel, rood)
export function snelheidKleur(f: number): string {
  const stops: [number, number[]][] = [[0, [44, 111, 187]], [.25, [63, 167, 201]], [.5, [232, 195, 58]], [.75, [224, 123, 44]], [1, [192, 57, 43]]];
  f = Math.max(0, Math.min(1, f));
  let i = 0; while (i < stops.length - 2 && f > stops[i + 1][0]) i++;
  const [f0, c0] = stops[i], [f1, c1] = stops[i + 1], r = (f - f0) / (f1 - f0);
  return "rgb(" + c0.map((c, k) => Math.round(c + (c1[k] - c) * r)).join(",") + ")";
}
