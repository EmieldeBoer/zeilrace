// ============================================================
//  Uitslagen: rangschikking, ratingcheck, finish of afstand achteraf
//  uit het spoor, en de weergave van een opgeslagen race of zeeslag
//  voor de replay en de export.
// ============================================================
import { BOTEN, FLEET } from "../../convex/lib/config";
import type { Lus, StartPlan, Uitslag, Zeeslag } from "../../convex/lib/validators";
import { afgelegdM, eigenStartVan, gecorrigeerdeTijd, type SpoorPunt } from "./baan";
import { datumKort, formatDuur } from "./format";
import { lijnstukkenKruisen, lijnMidden, heeftLijn, orient, type LatLng } from "./geo";
import { normaliseerSpoor, type SpoorPt } from "./spoor";

export const DNF_PUNTEN = FLEET.length + 1;   // niet gefinisht = aantal boten + 1
export type UitslagRegel = { naam: string; gefinisht?: boolean; elapsed?: number | null; corrected?: number | null; afstand?: number | null };

export function uitslagLijst(res: Uitslag | null | undefined): UitslagRegel[] {
  const u = (res && res.uitslag) || {};
  return FLEET.map((naam) => ({ naam, ...(u[naam] || {}) }));
}
// lijst: [{naam, gefinisht, veld}] → {naam: plaats}
export function rangen(lijst: UitslagRegel[], veld: "corrected" | "elapsed"): Record<string, number> {
  const r: Record<string, number> = {};
  lijst.filter((x) => x.gefinisht && x[veld] != null).sort((a, b) => a[veld]! - b[veld]!)
    .forEach((x, i) => { r[x.naam] = i + 1; });
  return r;
}

// Een opgeslagen spoor als punten met echte tijden
export const sporenAlsPunten = (res: Uitslag, b: string): SpoorPunt[] => {
  const t0 = res.t0 || res.ts;
  return normaliseerSpoor(res.sporen?.[b]).map((p) => ({ lat: p[0], lng: p[1], ts: t0 + p[2] * 1000 }));
};

// ---- Finish achteraf uit het spoor (bijv. als de finishlijn tijdens de race is verlengd) ----
// De eerste kruising van de finishlijn (zoals die in de opgeslagen race staat) na de eigen
// start, met het tijdstip tussen de twee spoorpunten ingeschat. Null als hij er niet over ging.
export function finishUitSpoor(res: Uitslag, b: string): number | null {
  const F = res.baan?.lines?.finish, t = res.tijden?.[b];
  if (!F || !F.a || !t || t.start == null || !res.sporen || !res.sporen[b]) return null;
  const sein = res.gun != null ? res.gun + ((res.modus === "achtervolging" && res.vertraging && res.vertraging[b]) || 0) : t.start;
  const van = Math.max(t.start, sein);
  const pts = sporenAlsPunten(res, b);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].ts <= van || !lijnstukkenKruisen(pts[i - 1], pts[i], F.a, F.b)) continue;
    const a = pts[i - 1], c = pts[i], da = Math.abs(orient(F.a, F.b, a)), dc = Math.abs(orient(F.a, F.b, c));
    return Math.round(a.ts + (c.ts - a.ts) * (da + dc ? da / (da + dc) : 0));
  }
  return null;
}
export type FinishVoorstel = { boot: string; finish: number; elapsed: number; corrected: number; afstand: number };
export function finishVoorstellen(res: Uitslag): FinishVoorstel[] {
  const sp: Partial<StartPlan> = { modus: res.modus || "gelijk", vertraging: res.vertraging };
  const uit: FinishVoorstel[] = [];
  FLEET.forEach((b) => {
    const t = res.tijden?.[b];
    if (!t || t.start == null || t.finish != null) return;
    const f = finishUitSpoor(res, b); if (f == null) return;
    const eigenStart = eigenStartVan(b, t, res.gun, sp)!, elapsed = f - eigenStart;
    const corrected = gecorrigeerdeTijd(b, f, res.gun, sp, eigenStart);
    uit.push({ boot: b, finish: f, elapsed, corrected, afstand: Math.round(afgelegdM(sporenAlsPunten(res, b), Math.max(t.start, eigenStart), f)) });
  });
  return uit;
}
export const kanFinishUitSpoor = (res: Uitslag) =>
  !!res.sporen && FLEET.some((b) => res.tijden?.[b]?.start != null && res.tijden?.[b]?.finish == null);

// Afgelegde afstand voor races die zonder afstand zijn opgeslagen: achteraf berekend uit
// het bewaarde spoor, van de eigen start (de lijnkruising, maar niet vóór het eigen startsein) tot de finish.
export function afstandUitSpoor(res: Uitslag, b: string): number | null {
  const t = res.tijden?.[b], ruw = res.sporen?.[b];
  if (!t || t.start == null || !ruw) return null;
  const sein = res.gun != null ? res.gun + ((res.modus === "achtervolging" && res.vertraging && res.vertraging[b]) || 0) : null;
  const van = sein != null ? Math.max(t.start, sein) : t.start;
  return afgelegdM(sporenAlsPunten(res, b), van, t.finish);
}

// ---- Ratingcheck: welke rating 'verdiende' elke boot in een afgeronde race? ----
// De rating waarbij alle gefinishte boten precies gelijk waren geëindigd (verdiend ∝
// baanlengte / verzeilde tijd), zo geschaald dat het gemiddelde gelijk blijft aan dat van de huidige ratings.
export const RATING_MIN_RACES = 3;
export function ratingVerdiend(res: Uitslag): Record<string, number> | null {
  const fin = uitslagLijst(res).filter((r) => r.gefinisht && (r.elapsed ?? 0) > 0 && BOTEN[r.naam]);
  if (fin.length < 2) return null;
  const lengte = (b: string) => (res.lengtes && res.lengtes[b]) || 1;      // lusstart: elke boot een eigen baanlengte
  const gemHuidig = fin.reduce((s, r) => s + BOTEN[r.naam].rating, 0) / fin.length;
  const gemSnel = fin.reduce((s, r) => s + lengte(r.naam) / r.elapsed!, 0) / fin.length;
  const uit: Record<string, number> = {};
  fin.forEach((r) => { uit[r.naam] = (lengte(r.naam) / r.elapsed!) / gemSnel * gemHuidig; });
  return uit;
}

// ---- Wind voor de polars ----
// Plek voor de wind: midden van de startlijn, anders het eerste spoorpunt
export function racePlek(res: Uitslag): LatLng | null {
  const l = res.baan?.lines?.start;
  if (heeftLijn(l)) return lijnMidden(l);
  const eerste = Object.values(res.sporen || {}).map(normaliseerSpoor).find((p) => p.length);
  return eerste ? { lat: eerste[0][0], lng: eerste[0][1] } : null;
}
export function raceEinde(res: Uitslag): number {
  const t0 = res.t0 || res.ts;
  const finishes = Object.values(res.tijden || {}).map((t) => t && t.finish).filter((f): f is number => !!f);
  const sporen = Object.values(res.sporen || {}).map(normaliseerSpoor).map((p) => p.length ? t0 + p[p.length - 1][2] * 1000 : 0);
  return Math.max(res.gun || t0, ...finishes, ...sporen);
}

// ---- Replay en export ----
export type ReplaySpoor = { boot: string; kleur: string; naam: string; pts: SpoorPt[]; finishS: number | null; legenda: string };
export type ReplayData = {
  titel: string; klok: (t: number) => string; sporen: ReplaySpoor[];
  baan: Uitslag["baan"] | null; lussen: Record<string, Lus> | null; gunS: number | null;
  t0?: number; zeeslag?: Zeeslag; posTs?: Record<string, number>; naam?: (b: string) => string;
};

// Een opgeslagen race in de vorm die de replay en de video nodig hebben
export function raceWeergave(res: Uitslag, naamVan: (b: string) => string): ReplayData | null {
  if (!res.sporen) return null;
  const lijst = uitslagLijst(res), rMet = rangen(lijst, "corrected");
  const nm = (b: string) => res.namen?.[b] || naamVan(b);
  // De replay loopt van hooguit 15 minuten vóór het startschot tot de finish van
  // de laatste boot. Daarbuiten (naar het startgebied varen, terug naar de haven)
  // wordt weggeknipt; de tijd telt opnieuw vanaf het beginmoment.
  const opname0 = res.t0 || res.ts;
  const knip = res.gun ? Math.max(0, (res.gun - opname0) / 1000 - 15 * 60) : 0;
  const t0 = opname0 + knip * 1000;
  const gunS = res.gun ? (res.gun - t0) / 1000 : null;
  const metSpoor = FLEET.filter((b) => res.sporen![b]);
  const finishes = metSpoor.map((b) => res.tijden?.[b]?.finish);
  const eindS = metSpoor.length && finishes.every((f) => f != null)
    ? (Math.max(...(finishes as number[])) - t0) / 1000 : Infinity;     // niet iedereen binnen: tot het eind van de opname
  const bijgeknipt = (v: unknown): SpoorPt[] => {
    let pts = normaliseerSpoor(v).map((p): SpoorPt => [p[0], p[1], p[2] - knip]);
    const i = pts.findIndex((p) => p[2] >= 0);
    if (i === -1) pts = pts.length ? [[pts[pts.length - 1][0], pts[pts.length - 1][1], 0]] : [];
    else if (i > 0) pts = ([[pts[i - 1][0], pts[i - 1][1], 0]] as SpoorPt[]).concat(pts.slice(i));   // positie op het beginmoment
    const j = pts.findIndex((p) => p[2] > eindS);
    if (j > 0) pts = pts.slice(0, j).concat([[pts[j - 1][0], pts[j - 1][1], eindS]]);  // stop bij de laatste finish
    else if (j === 0) pts = [[pts[0][0], pts[0][1], Math.max(0, eindS)]];
    return pts;
  };
  const sporen = metSpoor
    .sort((a, b) => (rMet[a] || 99) - (rMet[b] || 99))
    .map((b): ReplaySpoor => {
      const u = res.uitslag?.[b];
      const fin = res.tijden?.[b]?.finish;
      return { boot: b, kleur: BOTEN[b].kleur, naam: nm(b), pts: bijgeknipt(res.sporen![b]),
        finishS: fin ? (fin - t0) / 1000 : null,
        legenda: u?.gefinisht ? `${rMet[b]}. ${nm(b)} — ${formatDuur(u.elapsed)} (gecorr. ${formatDuur(u.corrected)})` : `${nm(b)} — DNF` };
    });
  const klok = (t: number) => {
    const s = new Date(t0 + t * 1000).toLocaleTimeString("nl-NL", { hour12: false });
    if (gunS == null) return s;
    const r = t - gunS;
    return `${s} · racetijd ${r < 0 ? "−" + formatDuur(-r * 1000) : formatDuur(r * 1000)}`;
  };
  return { titel: `Race ${res.nr}${res.naam ? ": " + res.naam : ""}`, klok, sporen, baan: res.baan ?? null, lussen: res.lussen || null, gunS };
}

// Een opgeslagen zeeslag in dezelfde vorm (plus de spelgegevens voor kogels, kisten en mijnen)
export function zeeslagWeergave(z: Zeeslag, naamVan: (b: string) => string): ReplayData | null {
  if (!z.sporen) return null;
  const nm = (b: string) => z.namen?.[b] || naamVan(b);
  const t0 = z.t0, gunS = (z.start - t0) / 1000;
  const sporen = FLEET.filter((b) => z.sporen![b]).map((b): ReplaySpoor => ({ boot: b, kleur: BOTEN[b].kleur, naam: nm(b),
    pts: normaliseerSpoor(z.sporen![b]), finishS: null, legenda: nm(b) }));
  const klok = (t: number) => {
    const s = new Date(t0 + t * 1000).toLocaleTimeString("nl-NL", { hour12: false }), r = t - gunS;
    return `${s} · zeeslag ${r < 0 ? "−" + formatDuur(-r * 1000) : formatDuur(r * 1000)}`;
  };
  const posTs: Record<string, number> = {};
  (z.deelnemers.length ? z.deelnemers : Object.keys(z.sporen)).forEach((b) => { posTs[b] = z.start; });
  return { titel: `🏴‍☠️ Zeeslag ${datumKort(z.start)}`, klok, sporen, baan: null, lussen: null, gunS, t0, zeeslag: z, posTs, naam: nm };
}

// Diep alle null- en undefined-velden uit objecten halen (Convex kent geen undefined,
// en optionele velden mogen niet null zijn). Arrays blijven zoals ze zijn.
export function zonderLeeg<T>(x: T): T {
  if (Array.isArray(x)) return x.map(zonderLeeg) as T;
  if (x && typeof x === "object") {
    const uit: Record<string, unknown> = {};
    Object.entries(x as Record<string, unknown>).forEach(([k, v]) => { if (v != null) uit[k] = zonderLeeg(v); });
    return uit as T;
  }
  return x;
}
