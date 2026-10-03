// ============================================================
//  Meetkunde op de kaart: afstanden, peilingen, lijnen kruisen,
//  rondingslijnen van boeien.
// ============================================================
import type { Boei, LatLng, Lijn, Lijnen } from "../../convex/lib/validators";

export type { Boei, LatLng, Lijn, Lijnen };

// --- Kruisen twee lijnstukken elkaar? ---------------------------
// Over korte afstanden behandelen we lat/lng als een plat vlak; dat is ruim nauwkeurig genoeg.
export function orient(a: LatLng, b: LatLng, c: LatLng): number {
  return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
}
function opSegment(a: LatLng, b: LatLng, c: LatLng): boolean {
  return Math.min(a.lng, b.lng) <= c.lng && c.lng <= Math.max(a.lng, b.lng) &&
    Math.min(a.lat, b.lat) <= c.lat && c.lat <= Math.max(a.lat, b.lat);
}
// p1-p2 = spoor van de boot, p3-p4 = de lijn (start, finish, ronding)
export function lijnstukkenKruisen(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): boolean {
  const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && opSegment(p3, p4, p1)) return true;
  if (d2 === 0 && opSegment(p3, p4, p2)) return true;
  if (d3 === 0 && opSegment(p1, p2, p3)) return true;
  if (d4 === 0 && opSegment(p1, p2, p4)) return true;
  return false;
}

// --- Afstand tussen twee punten in meters (haversine) ----------
export function afstandMeter(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// --- Midden van een lijn {a,b} ---------------------------------
export function lijnMidden(ln: Lijn): LatLng {
  return { lat: (ln.a.lat + ln.b.lat) / 2, lng: (ln.a.lng + ln.b.lng) / 2 };
}
export const heeftLijn = (ln: Lijn | null | undefined): ln is Lijn => !!(ln && ln.a && ln.b);

// --- Boeien altijd als nette array ------------------------------
export function alsBoeien(v: unknown): Boei[] {
  const lijst = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [];
  return (lijst as Boei[]).filter((b) => b && b.lat != null);
}
// Vaste ID van een boei. Rondingen hangen aan deze ID (niet aan het
// volgnummer), zodat boeien toevoegen/weghalen tijdens een race geen
// al geronde boeien door elkaar haalt. Oude boeien zonder id: volgnummer.
export function boeiId(b: { id?: string } | null | undefined, i: number): string {
  return (b && b.id) || String(i);
}

// --- Vorige en volgende punt van boei i in de baan -------------
// prev/next = de omliggende boei, of de start-/finishlijn (midden).
export function boeiPrevNext(i: number, boeien: LatLng[], lijnen: Lijnen): { prev: LatLng | null; next: LatLng | null } {
  const prev = i > 0 ? boeien[i - 1] : (heeftLijn(lijnen.start) ? lijnMidden(lijnen.start) : null);
  const next = i < boeien.length - 1 ? boeien[i + 1] : (heeftLijn(lijnen.finish) ? lijnMidden(lijnen.finish) : null);
  return { prev, next };
}

// --- Rondingslijn van een boei ---------------------------------
// Lijn vanaf de boei naar buiten, langs de bissectrice van de hoek
// prev-boei-next. Oversteken = boei gerond. 'marginM' verlengt de lijn
// iets naar binnen (GPS-marge) zodat een strakke ronding ook telt.
// Geeft {a,b,dwars} (lat/lng) terug, of null zonder vorig én volgend punt.
// Is er geen duidelijke bocht (bijna rechtdoor, of alleen een vorig of
// volgend punt), dan wordt het een DWARSE lijn door de boei, haaks op de
// koers: aan welke kant je de boei ook passeert, het telt (dwars: true).
export function rondingsLijn(boei: LatLng, prev: LatLng | null, next: LatLng | null, marginM: number, reikM: number):
  (Lijn & { dwars: boolean }) | null {
  if (!prev && !next) return null;
  const latR = boei.lat * Math.PI / 180;
  const mx = (p: LatLng) => ({ x: (p.lng - boei.lng) * 111000 * Math.cos(latR), y: (p.lat - boei.lat) * 111000 });
  const norm = (a: { x: number; y: number }) => { const L = Math.hypot(a.x, a.y); return L ? { x: a.x / L, y: a.y / L } : { x: 0, y: 0 }; };
  const naarLatLng = (dx: number, dy: number) => ({ lat: boei.lat + dy / 111000, lng: boei.lng + dx / (111000 * Math.cos(latR)) });
  const u = prev ? norm(mx(prev)) : { x: 0, y: 0 };   // richting naar waar je vandaan komt
  const w = next ? norm(mx(next)) : { x: 0, y: 0 };   // richting naar waar je heen gaat
  const bx = u.x + w.x, by = u.y + w.y;
  const L = Math.hypot(bx, by);
  if (!prev || !next || L < 0.15) {
    // Koersrichting door de boei (van prev naar next) → lijn haaks daarop
    const k = norm({ x: w.x - u.x, y: w.y - u.y });
    if (!k.x && !k.y) return null;
    const px = -k.y, py = k.x;
    return { a: naarLatLng(-px * reikM, -py * reikM), b: naarLatLng(px * reikM, py * reikM), dwars: true };
  }
  const ox = -bx / L, oy = -by / L;          // buitenwaartse bissectrice (eenheidsvector)
  return {
    a: naarLatLng(-ox * marginM, -oy * marginM),   // iets naar binnen (marge)
    b: naarLatLng(ox * reikM, oy * reikM),         // ver naar buiten
    dwars: false,
  };
}

// --- Peiling (bearing) van 'from' naar 'to' in graden (0=N) -----
export function peiling(from: LatLng, to: LatLng): number {
  const f1 = from.lat * Math.PI / 180, f2 = to.lat * Math.PI / 180;
  const dl = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// --- Dichtstbijzijnde punt op lijnstuk a-b t.o.v. p ------------
export function dichtstbijPuntOpLijn(p: LatLng, a: LatLng, b: LatLng): LatLng {
  const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.lng - ax) * dx + (p.lat - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { lat: ay + t * dy, lng: ax + t * dx };
}

// Koers uit twee posities (als de GPS geen koers geeft): alleen bij genoeg verplaatsing
export function koersUitBeweging(vorige: LatLng | null | undefined, nu: LatLng, minM = 6): number | null {
  return vorige && afstandMeter(vorige, nu) >= minM ? peiling(vorige, nu) : null;
}

// Het tweede punt van een start- of finishlijn snapt: vanaf a naar een van de acht
// windstreken, met een lengte in stappen van LIJN_STAP_ZM (minstens één stap).
// → { punt, streek: 'NO', zm: 0.5 }
export const WINDSTREKEN_8 = ["N", "NO", "O", "ZO", "Z", "ZW", "W", "NW"];
export const LIJN_STAP_ZM = 0.5;
export function snapLijnPunt(a: LatLng, p: LatLng): { punt: LatLng; streek: string; zm: number } {
  const ky = 6371000 * Math.PI / 180, kx = ky * Math.cos(a.lat * Math.PI / 180);   // m per graad (zoals afstandMeter)
  const dx = (p.lng - a.lng) * kx, dy = (p.lat - a.lat) * ky;
  const i = ((Math.round(Math.atan2(dx, dy) / (Math.PI / 4)) % 8) + 8) % 8, hoek = i * Math.PI / 4;
  const zm = Math.max(1, Math.round(Math.hypot(dx, dy) / 1852 / LIJN_STAP_ZM)) * LIJN_STAP_ZM, m = zm * 1852;
  return {
    streek: WINDSTREKEN_8[i], zm,
    punt: { lat: +(a.lat + Math.cos(hoek) * m / ky).toFixed(6), lng: +(a.lng + Math.sin(hoek) * m / kx).toFixed(6) },
  };
}

// --- Windrichting en windkracht ---------------------------------
export function kompas(deg: number): string {
  const r = ["N", "NNO", "NO", "ONO", "O", "OZO", "ZO", "ZZO", "Z", "ZZW", "ZW", "WZW", "W", "WNW", "NW", "NNW"];
  return r[Math.round(deg / 22.5) % 16];
}
// Knopen → Beaufort (ondergrenzen in knopen voor 1 t/m 12 Bft)
const BFT_GRENZEN = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
export function bft(kn: number): number {
  const k = Math.round(kn);
  return BFT_GRENZEN.filter((g) => k >= g).length;
}
