// ============================================================
//  Zeilrace — de polar van elke boot, opgebouwd uit de gezeilde races
//  Per GPS-punt: snelheid en koers over de grond (gemiddeld over 20 s),
//  de ware wind op dat moment (uurwaarden van Open-Meteo, geïnterpoleerd)
//  → de hoek met de ware wind (TWA) en de windsterkte (TWS).
//  Weggelaten: overstagmomenten (±30 s), stilliggen, vóór de start en na
//  de finish. Per windsterkte (Bft) en windhoek (vakjes van 10°) de
//  snelheid die de boot in 75% van de tijd haalde ('goed gezeild').
//
//  Let op: dit is snelheid over de grond (stroming en drift tellen mee)
//  en modelwind (niet ter plekke gemeten). Hoe meer races, hoe beter.
//  Het diagram zelf: components/uitslagen/PolarDiagram.tsx.
// ============================================================
import type { LatLng, Uitslag, WindUur } from "../../convex/lib/validators";
import { afstandMeter, bft, peiling } from "./geo";
import { normaliseerSpoor, overstagHoeken, snelheidsSpoor } from "./spoor";
import type { Overstag, SpoorPt } from "./spoor";

export type PolarVak = { twa: number; kn: number; n: number };
export type PolarBoot = { vakken: Record<string, Record<string, PolarVak>>; beste: Record<string, PolarVak & { vmg: number }>; n: number };
export type PolarCorrectie = { nr: number; graden: number | null; n: number };

const HOEK_VAK = 10, PERCENTIEL = .75;
export const MIN_METINGEN = 8;
const rad = Math.PI / 180;

// ---- Wind per uur ophalen (Open-Meteo, modeldata) ----
// → [{ t (ms), kn, richting (° waar hij vandaan komt) }]
type OpenMeteo = { hourly?: { time?: number[]; wind_speed_10m?: (number | null)[]; wind_direction_10m?: (number | null)[] } };
const windCache: Record<string, Promise<WindUur[]> | undefined> = {};
export async function windUren(pos: LatLng, van: number, tot: number): Promise<WindUur[]> {
  const dag = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const sleutel = [pos.lat.toFixed(2), pos.lng.toFixed(2), dag(van), dag(tot)].join("|");
  const bekend = windCache[sleutel];
  if (bekend) return bekend;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(4)}&longitude=${pos.lng.toFixed(4)}` +
    `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timezone=GMT&timeformat=unixtime` +
    `&start_date=${dag(van)}&end_date=${dag(tot)}`;
  const uren = windCache[sleutel] = fetch(url).then((r) => r.json() as Promise<OpenMeteo>).then((j) => {
    const h = j.hourly || {};
    return (h.time || []).map((t, i) => ({ t: t * 1000, kn: (h.wind_speed_10m || [])[i], richting: (h.wind_direction_10m || [])[i] }))
      .filter((w): w is WindUur => w.kn != null && w.richting != null);
  }).catch(() => []);
  return uren;
}
// Wind op tijdstip t: lineair tussen de uren (als vector, zodat 350° → 10° goed gaat)
function windOp(uren: WindUur[], t: number): { kn: number; richting: number } | null {
  if (!uren.length) return null;
  const i = uren.findIndex((w) => w.t > t);
  if (i === -1) return uren[uren.length - 1];
  if (i === 0) return uren[0];
  const a = uren[i - 1], b = uren[i], f = (t - a.t) / (b.t - a.t);
  const vec = (w: WindUur) => ({ x: Math.sin(w.richting * rad) * w.kn, y: Math.cos(w.richting * rad) * w.kn });
  const va = vec(a), vb = vec(b), x = va.x + (vb.x - va.x) * f, y = va.y + (vb.y - va.y) * f;
  return { kn: a.kn + (b.kn - a.kn) * f, richting: (Math.atan2(x, y) / rad + 360) % 360 };
}

// ---- Metingen uit één spoor: [{ tws, twa, kn }] ----
// pts = [[lat, lng, s]] met s = seconden sinds t0; van/tot in s; tacks = overstagmomenten (s)
type Meting = { tws: number; twa: number; kn: number };
function metingen(pts: SpoorPt[], t0: number, van: number, tot: number, uren: WindUur[], tacks: number[]): Meting[] {
  const v = snelheidsSpoor(pts), uit: Meting[] = [];
  for (let i = 0, a = 0, b = 0; i < pts.length; i++) {
    const s = pts[i][2], vi = v[i];
    if (s < van || s > tot || vi == null || vi < .5) continue;
    if (tacks.some((k) => Math.abs(k - s) < 30)) continue;               // midden in een overstag
    while (pts[a][2] < s - 10) a++;
    if (b < i) b = i;
    while (b + 1 < pts.length && pts[b + 1][2] <= s + 10) b++;
    const A = { lat: pts[a][0], lng: pts[a][1] }, B = { lat: pts[b][0], lng: pts[b][1] };
    if (afstandMeter(A, B) < 10) continue;
    const w = windOp(uren, t0 + s * 1000);
    if (!w) continue;
    const cog = peiling(A, B);
    const twa = Math.abs(((cog - w.richting + 540) % 360) - 180);   // 0 = recht in de wind, 180 = voor de wind
    uit.push({ tws: w.kn, twa, kn: vi });
  }
  return uit;
}

// ---- Windrichting bijstellen met de overstagmomenten ----
// Bij een overstag aan de wind ligt de echte wind precies tussen de koers vóór en na.
// De modelwind (grof raster) wijkt lokaal vaak af; de mediaan van die verschillen over
// de race wordt de correctie. Alleen met minstens 3 overstagmomenten die het eens zijn.
const hoekVerschil = (a: number, b: number) => ((b - a + 540) % 360) - 180;          // van a naar b, −180…180
function windCorrectie(overstag: Overstag[], uren: WindUur[], t0: number): { graden: number; n: number } | null {
  const d: number[] = [];
  overstag.forEach((o) => {
    const w = windOp(uren, t0 + o.s * 1000);
    if (!w || o.voor == null) return;
    let mid = (Math.atan2(Math.sin(o.voor * rad) + Math.sin(o.na * rad), Math.cos(o.voor * rad) + Math.cos(o.na * rad)) / rad + 360) % 360;
    if (Math.abs(hoekVerschil(w.richting, mid)) > 90) mid = (mid + 180) % 360;   // gijp: de wind komt van achteren
    d.push(hoekVerschil(w.richting, mid));
  });
  if (d.length < 3) return null;
  d.sort((a, b) => a - b);
  const med = d[Math.floor(d.length / 2)];
  const eens = d.filter((x) => Math.abs(x - med) <= 25).length / d.length;
  return eens >= .6 ? { graden: med, n: d.length } : null;
}

// ---- De polar van alle races samen ----
// races = [{ res, uren }] → { boot: { vakken: {bft: {hoekVak: {kn, n}}}, n, beste: {bft: {twa, kn, vmg}} } }
// Plus per race de windcorrectie: correcties = [{ nr, graden, n }]
export function bouw(races: { res: Uitslag; uren: WindUur[] }[]): { boten: Record<string, PolarBoot>; correcties: PolarCorrectie[] } {
  const ruw: Record<string, Meting[]> = {}, correcties: PolarCorrectie[] = [];
  races.forEach(({ res, uren }) => {
    if (!res.sporen || !res.gun || !uren.length) return;
    const t0 = res.t0 || res.ts, gunS = (res.gun - t0) / 1000;
    const boten = Object.entries(res.sporen).map(([b, sp]) => {
      const pts = normaliseerSpoor(sp), tm = (res.tijden || {})[b] || {};
      if (pts.length < 10) return null;
      const sein = gunS + ((res.modus === "achtervolging" && res.vertraging && res.vertraging[b]) || 0) / 1000;
      const van = Math.max(sein, tm.start != null ? (tm.start - t0) / 1000 : sein);
      const tot = tm.finish != null ? (tm.finish - t0) / 1000 : pts[pts.length - 1][2];
      return { b, pts, van, tot, overstag: overstagHoeken(pts, van, tot) };
    }).filter((x) => x != null);
    // eerst de windrichting bijstellen met de overstagmomenten van alle boten samen
    const corr = windCorrectie(boten.flatMap((x) => x.overstag), uren, t0);
    const gecorrigeerd = corr ? uren.map((w) => Object.assign({}, w, { richting: (w.richting + corr.graden + 360) % 360 })) : uren;
    correcties.push({ nr: res.nr, graden: corr ? corr.graden : null, n: corr ? corr.n : 0 });
    boten.forEach(({ b, pts, van, tot, overstag }) =>
      (ruw[b] = ruw[b] || []).push(...metingen(pts, t0, van, tot, gecorrigeerd, overstag.map((o) => o.s))));
  });
  const uit: Record<string, PolarBoot> = {};
  Object.entries(ruw).forEach(([b, lijst]) => {
    const groepen: Record<string, Record<string, number[]>> = {};
    lijst.forEach((m) => {
      const kracht = bft(m.tws), vak = Math.min(17, Math.floor(m.twa / HOEK_VAK));
      ((groepen[kracht] = groepen[kracht] || {})[vak] = groepen[kracht][vak] || []).push(m.kn);
    });
    const vakken: PolarBoot["vakken"] = {}, beste: PolarBoot["beste"] = {};
    Object.entries(groepen).forEach(([kracht, perVak]) => {
      vakken[kracht] = {};
      Object.entries(perVak).forEach(([vak, kns]) => {
        kns.sort((a, c) => a - c);
        vakken[kracht][vak] = { twa: (+vak + .5) * HOEK_VAK, kn: kns[Math.min(kns.length - 1, Math.floor(kns.length * PERCENTIEL))], n: kns.length };
      });
      // Beste kruishoek: hoogste snelheid richting de wind (VMG), alleen vakken met genoeg metingen
      const aanDeWind = Object.values(vakken[kracht]).filter((x) => x.twa < 90 && x.n >= MIN_METINGEN)
        .map((x) => Object.assign({ vmg: x.kn * Math.cos(x.twa * rad) }, x)).sort((a, c) => c.vmg - a.vmg);
      if (aanDeWind.length) beste[kracht] = aanDeWind[0];
    });
    uit[b] = { vakken, beste, n: lijst.length };
  });
  return { boten: uit, correcties };
}

// ---- Kleuren per windkracht (Bft) voor het polardiagram ----
const KLEUREN: Record<string, string> = { 1: "#7fb3d5", 2: "#2c6fbb", 3: "#2f8f63", 4: "#e8c33a", 5: "#e07b2c", 6: "#c0392b", 7: "#7d1d6f" };
export const kleurVan = (kracht: string | number) => KLEUREN[kracht] || "#555";
