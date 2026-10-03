// ============================================================
//  De race: baan, doelen, tijden met rating, voorspelling,
//  startplannen (gelijk, achtervolging, lussen) en het startvoorstel.
// ============================================================
import { BOTEN, FLEET, LUS_MIN_M } from "../../convex/lib/config";
import type { Boei, LatLng, Lijnen, Lus, StartPlan, Voorstel } from "../../convex/lib/validators";
import { afstandMeter, boeiId, dichtstbijPuntOpLijn, heeftLijn, lijnMidden, peiling, alsBoeien } from "./geo";
import { formatAfstand, formatDuur } from "./format";

export type SpoorPunt = { lat: number; lng: number; ts: number };
export type Tijd = { start?: number | null; finish?: number | null };
export type TijdenMap = Record<string, Tijd>;
export type Gerond = Record<string, number>;
// Een boei in de baan van één boot: met vaste id en label, bij een lusstart ook de lusboeien
export type BaanBoei = Boei & { id: string; nr?: number; label: string; letter?: string; lus?: string };

// --- Volgende doel van een boot --------------------------------
export function doelVanBoot(pos: LatLng, start: number | null | undefined, finish: number | null | undefined,
  gerond: Gerond | null | undefined, lijnen: Lijnen, boeien: (Boei & { label?: string })[]): { label: string; punt: LatLng } | null {
  if (finish != null) return null;
  if (start == null) return heeftLijn(lijnen.start)
    ? { label: "Startlijn", punt: dichtstbijPuntOpLijn(pos, lijnen.start.a, lijnen.start.b) } : null;
  const v = boeien.findIndex((b, i) => (gerond || {})[boeiId(b, i)] == null);
  if (v !== -1) return { label: boeien[v].label || "Boei " + (v + 1), punt: { lat: boeien[v].lat, lng: boeien[v].lng } };
  return heeftLijn(lijnen.finish)
    ? { label: "Finish", punt: dichtstbijPuntOpLijn(pos, lijnen.finish.a, lijnen.finish.b) } : null;
}

// --- VMG (m/s) naar een doelpunt via GPS-koers; null zonder koers -
export function vmgNaarDoel(pos: LatLng, speedMps: number | null | undefined, heading: number | null | undefined, doelPunt: LatLng): number | null {
  if (speedMps == null || heading == null || isNaN(heading)) return null;
  const b = peiling(pos, doelPunt);
  return speedMps * Math.cos((b - heading) * Math.PI / 180);
}

// --- Afgelegde afstand langs een spoor (m) ---------------------
// pts op tijd gesorteerd; telt alleen tussen van en tot (ms).
// Tegen GPS-ruis telt een stap pas na 10 m verplaatsing, en sprongen die
// sneller dan 25 kn zouden zijn (GPS-uitschieters) tellen niet mee.
const SPOOR_MIN_STAP_M = 10, SPOOR_MAX_MPS = 25 / 1.94384;
export function afgelegdM(pts: SpoorPunt[] | null | undefined, van: number | null | undefined, tot?: number | null): number {
  let m = 0, anker: SpoorPunt | null = null;
  for (const p of pts || []) {
    if (van != null && p.ts < van) continue;
    if (tot != null && p.ts > tot) break;
    if (!anker) { anker = p; continue; }
    const d = afstandMeter(anker, p), dt = (p.ts - anker.ts) / 1000;
    if (d < SPOOR_MIN_STAP_M || (dt > 0 && d / dt > SPOOR_MAX_MPS)) continue;
    m += d; anker = p;
  }
  return m;
}

// --- Startplan en startvertraging --------------------------------
export function vertragingVan(startPlan: Partial<StartPlan> | null | undefined, boot: string): number {
  return (startPlan && startPlan.modus === "achtervolging" && startPlan.vertraging && startPlan.vertraging[boot]) || 0;
}

// --- Gecorrigeerde tijd ------------------------------------------
// Verzeild = vanaf de eigen start (het eigen startsein, anders de
// startlijn). Gecorrigeerd:
//   gelijke start   → verzeild × rating
//   achtervolging   → tijd vanaf het eerste startsein (finishvolgorde telt)
//   lusstart        → idem: de rating zit al in de lengte van de lus
export function eigenStartVan(boot: string, t: Tijd | null | undefined, raceStart: number | null | undefined,
  startPlan: Partial<StartPlan> | null | undefined): number | null {
  if (raceStart != null) return raceStart + vertragingVan(startPlan, boot);
  return (t || {}).start ?? null;
}
export const eersteBinnenWint = (raceStart: number | null | undefined, startPlan: Partial<StartPlan> | null | undefined) =>
  raceStart != null && !!startPlan && (startPlan.modus === "achtervolging" || startPlan.modus === "lus");
export function gecorrigeerdeTijd(boot: string, eind: number, raceStart: number | null | undefined,
  startPlan: Partial<StartPlan> | null | undefined, eigenStart: number): number {
  return eersteBinnenWint(raceStart, startPlan) ? eind - raceStart! : (eind - eigenStart) * BOTEN[boot].rating;
}

// --- Hoeveel tijd heeft een boot nog om te winnen? --------------
// Kijkt naar de boten die al binnen zijn: vóór welk klokmoment moet deze
// boot finishen om hun gecorrigeerde tijd te verslaan? Geeft de beste plek
// die nog haalbaar is: { plek, tot (klok, ms), rest (ms) }. Kan hij geen
// enkele binnengekomen boot meer verslaan: { plek: 1, tot: null, rest: null }.
// Null als de boot niet onderweg is of nog niemand binnen is.
export type WinKans = { plek: number; tot: number | null; rest: number | null };
export function tijdOmTeWinnen(boot: string, times: TijdenMap, raceStart: number | null | undefined,
  startPlan: Partial<StartPlan> | null | undefined, nu: number): WinKans | null {
  const t = times[boot] || {};
  const eigenStart = eigenStartVan(boot, t, raceStart, startPlan);
  if (t.start == null || t.finish != null || eigenStart == null) return null;
  const binnen = FLEET.filter((b) => b !== boot && times[b] && times[b].start != null && times[b].finish != null)
    .map((b) => gecorrigeerdeTijd(b, times[b].finish!, raceStart, startPlan, eigenStartVan(b, times[b], raceStart, startPlan)!))
    .filter((c) => c != null && !isNaN(c)).sort((a, b) => a - b);
  if (!binnen.length) return null;
  for (let i = 0; i < binnen.length; i++) {
    const tot = eersteBinnenWint(raceStart, startPlan) ? raceStart! + binnen[i] : eigenStart + binnen[i] / BOTEN[boot].rating;
    if (tot > nu) return { plek: i + 1, tot, rest: tot - nu };
  }
  return { plek: 1, tot: null, rest: null };
}
export const winLabel = (w: WinKans) => w.plek === 1 || w.rest == null ? "Om te winnen" : `Voor plek ${w.plek}`;
export const winWaarde = (w: WinKans) => w.rest == null ? "te laat" : formatDuur(w.rest);

// --- Voorspelde eindstand (met rating) ---------------------------
// Resterende baan (m) vanaf pos: naar het volgende doel, dan langs de nog te
// ronden boeien naar het midden van de finish. gerond = {boeiId: ts}.
export function resterendeBaan(pos: LatLng, gestart: boolean, gerond: Gerond | null | undefined, lijnen: Lijnen,
  boeien: (Boei & { id?: string })[]): number | null {
  if (!heeftLijn(lijnen.finish)) return null;
  const reeks: LatLng[] = [];
  if (!gestart) {                                           // eerst nog naar de startlijn, dan alle boeien
    if (heeftLijn(lijnen.start)) reeks.push(dichtstbijPuntOpLijn(pos, lijnen.start.a, lijnen.start.b));
    boeien.forEach((b) => reeks.push(b));
  } else {                                                  // de boeien vanaf de eerste nog niet geronde
    const v = boeien.findIndex((b, i) => (gerond || {})[boeiId(b, i)] == null);
    if (v !== -1) boeien.slice(v).forEach((b) => reeks.push(b));
  }
  // de finish: het dichtstbijzijnde punt als dat het volgende doel is, anders het midden
  reeks.push(reeks.length ? lijnMidden(lijnen.finish) : dichtstbijPuntOpLijn(pos, lijnen.finish.a, lijnen.finish.b));
  let m = afstandMeter(pos, reeks[0]);
  for (let i = 1; i < reeks.length; i++) m += afstandMeter(reeks[i - 1], reeks[i]);
  return m;
}
// Laatste spoorpunt op of vóór tijdstip t (pts op tijd gesorteerd)
export function spoorPuntOp(pts: SpoorPunt[] | null | undefined, t: number): SpoorPunt | null {
  if (!pts || !pts.length || pts[0].ts > t) return null;
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m].ts <= t) lo = m; else hi = m - 1; }
  return pts[lo];
}

export type VoorspelInvoer = {
  times: TijdenMap;
  gerond: Record<string, Gerond>;
  sporen: Record<string, SpoorPunt[]>;
  posities: Record<string, LatLng>;
  lijnen: Lijnen;
  boeien: Boei[];
  baanVan?: (b: string) => BaanBoei[];
  raceStart: number | null;
  startPlan: StartPlan | null;
  nu: number;
};
export type VoorspelRij = {
  boot: string; status: "binnen" | "onderweg"; finish: number; rest: number; totaal: number; gecorr: number; zeker: boolean;
};
// Voorspelling per boot: binnen (echte tijd) of onderweg (verwacht). Het tempo is de
// voortgang langs de baan (dus inclusief kruisen): half het gemiddelde sinds de start,
// half dat van het laatste kwartier.
//   → rijen op volgorde; rest = tijd tot de finish (ms), totaal = verzeilde tijd vanaf de eigen start (ms)
export function voorspelEindstand(d: VoorspelInvoer): VoorspelRij[] {
  const rijen: VoorspelRij[] = [];
  FLEET.forEach((b) => {
    // de baan van déze boot (bij een lusstart met de eigen lus erin) en de lengte ervan
    const baan = d.baanVan ? d.baanVan(b) : d.boeien;
    const totaal = heeftLijn(d.lijnen.start) ? resterendeBaan(lijnMidden(d.lijnen.start), false, {}, d.lijnen, baan) : null;
    const t = d.times[b] || {}, eigenStart = eigenStartVan(b, t, d.raceStart, d.startPlan);
    if (t.start == null || eigenStart == null) return;                       // nog niet gestart: geen voorspelling
    if (t.finish != null) {
      rijen.push({ boot: b, status: "binnen", finish: t.finish, rest: 0, totaal: t.finish - eigenStart,
        gecorr: gecorrigeerdeTijd(b, t.finish, d.raceStart, d.startPlan, eigenStart), zeker: true });
      return;
    }
    const pos = d.posities[b]; if (!pos) return;
    const gerond = d.gerond[b] || {};
    const rest = resterendeBaan(pos, true, gerond, d.lijnen, baan);
    if (rest == null) return;
    const vanStart = Math.max(t.start, eigenStart), sinds = (d.nu - vanStart) / 1000;
    const gemiddeld = totaal != null && sinds > 120 ? (totaal - rest) / sinds : null;   // m/s langs de baan
    let recent: number | null = null;
    const toen = spoorPuntOp(d.sporen[b], d.nu - 15 * 60e3);
    if (toen && toen.ts >= vanStart) {
      const gerondToen: Gerond = {};
      Object.entries(gerond).forEach(([id, ts]) => { if (ts <= toen.ts) gerondToen[id] = ts; });
      const restToen = resterendeBaan(toen, true, gerondToen, d.lijnen, baan);
      if (restToen != null) recent = (restToen - rest) / ((d.nu - toen.ts) / 1000);
    }
    const tempo = gemiddeld != null && gemiddeld > .1 && recent != null && recent > .1 ? (gemiddeld + recent) / 2
      : gemiddeld != null && gemiddeld > .1 ? gemiddeld : recent != null && recent > .1 ? recent : null;
    if (!tempo) return;
    const finish = d.nu + rest / tempo * 1000;
    rijen.push({ boot: b, status: "onderweg", finish, rest: finish - d.nu, totaal: finish - eigenStart,
      gecorr: gecorrigeerdeTijd(b, finish, d.raceStart, d.startPlan, eigenStart), zeker: false });
  });
  return rijen.sort((a, c) => a.gecorr - c.gecorr);
}
// De voorspelling van boot b uit de rijen van voorspelEindstand (null = onbekend of al binnen)
export const voorspellingVan = (rijen: VoorspelRij[] | null | undefined, b: string) =>
  (rijen || []).find((x) => x.boot === b && !x.zeker) || null;

// --- Live data van een boot (snelheid, VMG, doel, afstand, tijd) -
// Optioneel: afgelegd (m, sinds de start), win (uit tijdOmTeWinnen) en
// voorspel (de rij van deze boot uit voorspelEindstand).
export type BootInvoer = {
  lat?: number; lng?: number; speed?: number | null; heading?: number | null;
  start?: number | null; finish?: number | null; gerond?: Gerond;
  afgelegd?: number | null; win?: WinKans | null; voorspel?: VoorspelRij | null;
};
export type BootWeergave =
  | { status: "geen" }
  | { status: "finish" | "ok"; spd: string; vmg?: string; vmgNeg?: boolean; doel?: string; afst?: string;
      afgelegd: string | null; win: WinKans | null; eta: string; eind: string; eindGecorr: string };
export function bootData(s: BootInvoer | null | undefined, lijnen: Lijnen, boeien: (Boei & { label?: string })[]): BootWeergave {
  if (!s || s.lat == null || s.lng == null) return { status: "geen" };
  const kn = (v: number) => (v * 1.94384).toFixed(1) + " kn";
  const spd = s.speed != null ? kn(s.speed) : "—";
  const v = s.voorspel, ca = (x: number | undefined) => v && x != null ? "≈ " + formatDuur(x) : "—";
  const extra = { afgelegd: s.afgelegd != null ? formatAfstand(s.afgelegd) : null, win: s.win || null,
    eta: ca(v?.rest), eind: ca(v?.totaal), eindGecorr: ca(v?.gecorr) };
  if (s.finish != null) return { status: "finish", spd, ...extra };
  const pos = { lat: s.lat, lng: s.lng };
  const doel = doelVanBoot(pos, s.start, s.finish, s.gerond, lijnen, boeien);
  if (!doel) return { status: "ok", spd, vmg: "—", doel: "—", afst: "—", ...extra };
  const dist = afstandMeter(pos, doel.punt);
  const vmg = vmgNaarDoel(pos, s.speed, s.heading, doel.punt);
  return {
    status: "ok", spd,
    vmg: vmg != null ? kn(vmg) : "—", vmgNeg: vmg != null && vmg < 0,
    doel: doel.label, afst: formatAfstand(dist), ...extra,
  };
}

// --- Baanplanning ----------------------------------------------
// Lengte van de baan in zeemijl: startlijn-midden → boeien → finish-midden
export function baanLengteNm(lijnen: Lijnen, boeien: LatLng[]): number | null {
  const pts: LatLng[] = [];
  if (heeftLijn(lijnen.start)) pts.push(lijnMidden(lijnen.start));
  boeien.forEach((b) => pts.push(b));
  if (heeftLijn(lijnen.finish)) pts.push(lijnMidden(lijnen.finish));
  if (pts.length < 2) return null;
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += afstandMeter(pts[i - 1], pts[i]);
  return m / 1852;
}
// Ruwe windcorrectie op de GPH-tijden. GPH is een gemiddelde over
// windsterktes (≈ 12 kn); bij weinig wind duurt alles flink langer.
export function windFactor(kn: number | null | undefined): number {
  if (kn == null || isNaN(kn)) return 1;
  const p = [[0, 2.0], [5, 1.6], [8, 1.25], [12, 1.0], [16, 0.9], [20, 0.85], [99, 0.85]];
  for (let i = 1; i < p.length; i++) if (kn <= p[i][0]) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i];
    return y0 + (y1 - y0) * (kn - x0) / (x1 - x0);
  }
  return 0.85;
}
// Verwachte tijd (ms) per boot, en de startvertraging voor een
// achtervolgingsstart: de langzaamste start eerst, de rest schuift op
// zodat iedereen (in theorie) tegelijk finisht.
export type Plan = { nm: number; windKn: number | null; factor: number; verwacht: Record<string, number>; vertraging: Record<string, number> };
export function maakPlan(nm: number, windKn: number | null | undefined): Plan {
  const f = windFactor(windKn);
  const verwacht: Record<string, number> = {}, vertraging: Record<string, number> = {};
  FLEET.forEach((b) => { verwacht[b] = Math.round(BOTEN[b].gph * nm * f) * 1000; });
  const traagst = Math.max(...Object.values(verwacht));
  FLEET.forEach((b) => { vertraging[b] = traagst - verwacht[b]; });
  return { nm, windKn: windKn == null ? null : windKn, factor: f, verwacht, vertraging };
}

// --- Lusstart: iedereen tegelijk weg, elke boot een eigen lus ---
// Een lus is een paar boeien naast een rak: boei A ligt verderop (voor
// iedereen dezelfde), boei B per boot iets terug. De boot vaart langs de lus naar A, keert terug naar B en gaat
// dan verder naar het volgende punt: een kleine α. Omdat de lus heen en
// terug langs het rak loopt, kost hij bij elke windrichting ongeveer even
// veel. Elke lus maakt de baan precies zo veel langer dat gph × baanlengte
// voor iedereen gelijk is: in theorie finisht de hele vloot tegelijk.
const LUS_RUIMTE_M = 100;          // vrije ruimte rond een lus langs het rak (m)
export const lussenVan = (sp: Partial<StartPlan> | null | undefined): Record<string, Lus> | null =>
  (sp && sp.modus === "lus" && sp.lussen) || null;

// --- Startvoorstel: de wedstrijdleiding stelt een starttijd voor, elke boot geeft akkoord ---
// akkoord = { boot: voorstel.id }. Pas als alle boten akkoord zijn, wordt het raceStart + startPlan.
export const akkoordVan = (voorstel: Voorstel | null | undefined, akkoord: Record<string, number | undefined> | null | undefined) =>
  FLEET.filter((b) => voorstel && akkoord && akkoord[b] === voorstel.id);
export const iedereenAkkoord = (voorstel: Voorstel | null | undefined, akkoord: Record<string, number | undefined>) =>
  !!voorstel && akkoordVan(voorstel, akkoord).length === FLEET.length;
export const startNaam = (modus: string | null | undefined) =>
  ({ achtervolging: "Achtervolgingsstart", lus: "Lusstart" } as Record<string, string>)[modus || ""] || "Gelijke start";

// Baan van één boot: de gewone boeien (met vaste id en label), bij een
// lusstart met de eigen lus erin. lus.na = id van de boei vóór het rak, of 'start'.
export function baanVanBoot(boeien: Boei[], lussen: Record<string, Lus> | null | undefined, boot: string): BaanBoei[] {
  const baan: BaanBoei[] = boeien.map((b, i) => ({ ...b, id: boeiId(b, i), nr: i + 1, label: "Boei " + (i + 1) }));
  const lus = lussen && lussen[boot];
  if (!lus) return baan;
  let na = lus.na === "start" ? 0 : baan.findIndex((b) => b.id === lus.na) + 1;
  if (na === 0 && lus.na !== "start") na = baan.length;          // die boei is weg: de lus vlak voor de finish
  baan.splice(na, 0, ...alsBoeien(lus.boeien).map((b, i) =>
    ({ ...b, id: b.id || `lus-${boot}-${"ab"[i]}`, letter: "AB"[i], label: "Lusboei " + "AB"[i], lus: boot })));
  return baan;
}
// De lus van een boot als lijn: vorige punt → A → B → volgende punt (om te tekenen)
export function lusPad(boeien: Boei[], lijnen: Lijnen, lussen: Record<string, Lus> | null | undefined, boot: string): (LatLng & Partial<BaanBoei>)[] | null {
  const baan = baanVanBoot(boeien, lussen, boot), i = baan.findIndex((b) => b.lus);
  if (i === -1 || !baan[i + 1]) return null;
  const prev = i > 0 ? baan[i - 1] : (heeftLijn(lijnen.start) ? lijnMidden(lijnen.start) : null);
  const next = i + 1 < baan.length - 1 ? baan[i + 2] : (heeftLijn(lijnen.finish) ? lijnMidden(lijnen.finish) : null);
  return [prev, baan[i], baan[i + 1], next].filter((p): p is LatLng & Partial<BaanBoei> => !!p);
}

// Lussen op het rak P → N (lengte L) met één gezamenlijke boei A: die ligt op
// xA meter langs het rak en h meter links ervan. Elke boot keert bij A om en
// vaart evenwijdig aan het rak terug naar de eigen boei B; hoe verder B terug
// ligt, hoe langer de omweg. Zoekt per boot de plek van B waarbij de omweg
// precies extraM meter is. Geeft { a, b: {boot: punt}, xB: {boot: m} }.
function lussenOpRak(P: LatLng, N: LatLng, xA: number, h: number, extra: Record<string, number>) {
  const kx = 111000 * Math.cos(P.lat * Math.PI / 180), ky = 111000;
  const dx = (N.lng - P.lng) * kx, dy = (N.lat - P.lat) * ky, L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L;                                  // langs het rak; links ervan is (−uy, ux)
  const opRak = (x: number) => ({ lat: +(P.lat + (uy * x + ux * h) / ky).toFixed(6), lng: +(P.lng + (ux * x - uy * h) / kx).toFixed(6) });
  // omweg P → A → B → N ten opzichte van P → N; daalt als B dichter bij A ligt
  const omweg = (xB: number) => Math.hypot(xA, h) + (xA - xB) + Math.hypot(L - xB, h) - L;
  const b: Record<string, LatLng> = {}, xB: Record<string, number> = {};
  Object.entries(extra).forEach(([boot, extraM]) => {
    let lo = xA - extraM, hi = xA;                                 // omweg(xA − extraM) ≥ extraM
    for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (omweg(m) > extraM) lo = m; else hi = m; }
    xB[boot] = Math.min(xA - 20, lo); b[boot] = opRak(xB[boot]);
  });
  return { a: opRak(xA), b, xB };
}

// Lussen voor de hele vloot. De langzaamste boot krijgt LUS_MIN_M extra, de
// rest zo veel meer dat gph × baanlengte gelijk is. Alle lussen liggen op het
// langste rak en delen boei A; alleen boei B ligt per boot ergens anders. Het
// geheel (van A tot de verste B) ligt in het midden van het rak.
// Geeft { lussen, extra: {boot: m}, lengte: {boot: zm}, past } of null zonder complete baan.
export type LusPlan = { lussen: Record<string, Lus>; extra: Record<string, number>; lengte: Record<string, number>; past: boolean };
export function maakLusPlan(lijnen: Lijnen, boeien: Boei[]): LusPlan | null {
  if (!(heeftLijn(lijnen.start) && heeftLijn(lijnen.finish))) return null;
  const pts: LatLng[] = [lijnMidden(lijnen.start), ...boeien, lijnMidden(lijnen.finish)];
  const raken: { P: LatLng; N: LatLng; L: number; na: string }[] = [];
  let basisM = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = afstandMeter(pts[i - 1], pts[i]);
    basisM += L;
    if (L > 1) raken.push({ P: pts[i - 1], N: pts[i], L, na: i === 1 ? "start" : boeiId(boeien[i - 2], i - 2) });
  }
  if (!raken.length) return null;
  const traagst = Math.max(...Object.values(BOTEN).map((b) => b.gph));
  const extra: Record<string, number> = {}, lengte: Record<string, number> = {};
  FLEET.forEach((b) => {
    extra[b] = Math.round(traagst / BOTEN[b].gph * (basisM + LUS_MIN_M) - basisM);
    lengte[b] = (basisM + extra[b]) / 1852;
  });
  const r = raken.reduce((best, x) => x.L > best.L ? x : best);
  // A zo dat het midden tussen A en de verste B op het midden van het rak valt (de
  // lengte van de lussen hangt licht af van de plek: een paar keer bijstellen), maar
  // nooit dichter dan LUS_RUIMTE_M bij het eind. Zijwaarts zo ver als de langste lus vraagt.
  const h = Math.min(250, Math.max(60, Math.max(...Object.values(extra)) / 8));
  let xA = r.L / 2;
  for (let k = 0; k < 4; k++) {
    const plan = lussenOpRak(r.P, r.N, xA, h, extra);
    const span = xA - Math.min(...Object.values(plan.xB));
    xA = Math.min(r.L - LUS_RUIMTE_M, r.L / 2 + span / 2);
  }
  const { a, b, xB } = lussenOpRak(r.P, r.N, xA, h, extra);
  const lussen: Record<string, Lus> = {};
  let past = xA > LUS_RUIMTE_M;
  FLEET.forEach((boot) => {
    if (xB[boot] < LUS_RUIMTE_M) past = false;                     // B ligt te dicht bij (of vóór) het begin van het rak
    lussen[boot] = { na: r.na, extraM: extra[boot],
      boeien: [{ id: `lus-${boot}-a`, ...a }, { id: `lus-${boot}-b`, ...b[boot] }] };
  });
  return { lussen, extra, lengte, past };
}
