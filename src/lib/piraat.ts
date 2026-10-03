// ============================================================
//  Zeilrace — het piratenspel (mini-game, in de stijl van de klassieke
//  breedzijde-zeeslagen). Elke tracker kan het kanon afvuren: een salvo
//  van kogels, haaks op de koers, naar bakboord én stuurboord. Komt een
//  kogel binnen 20 m van een andere boot, dan is het raak.
//  Elke boot heeft 3 levens en 10 salvo's. Wie geraakt is, kan 1 minuut
//  niet schieten. Buiten het speelveld (een cirkel
//  van de wedstrijdleiding) kost elke 20 seconden een leven. Na 10 minuten
//  krimpt het speelveld geleidelijk (zie krimpNaMs e.v.).
//  In het speelveld drijven 3 schatkisten, richting het midden, op plekken die
//  iedereen zelf uitrekent. Elke kist verhuist na 4 minuten naar een nieuwe plek; een
//  gepakte kist komt dan ook terug. Vaar erlangs (binnen 50 m) en je krijgt
//  wat erin zit (zie BUIT in convex/lib/spel.ts; ook de inhoud rekent iedereen zelf uit).
//  Lading (dubbel bereik, breder schot, voorkanon, zeemijn) gebruik je bij je
//  volgende salvo of met de mijnknop; zolang je lading hebt, pak je geen kist.
//  De rest werkt meteen: schild, spookschip, snel herladen, of een boobytrap.
//
//  Gegevens (spel) = { start, eind?, veld: {lat,lng,r},
//    schoten: {boot: {0..9: {ts, lat, lng, koers, groot?, breed?, voor?, raak: {doelboot: true}}}},
//    straf:   {boot: {0..2: ts}},
//    buit:    {kistnr: {boot, ts}},      (wie de kist het eerst pakt)
//    mijnen:  {boot: {0..9: {ts, lat, lng}}},
//    mijnraak: {slachtoffer: {eigenaar-nr: ts}} }   (gemeld door wie erover vaart)
//  De stand wordt door iedereen op dezelfde manier uit die gegevens berekend,
//  en de kogelwolk van een salvo is voor iedereen gelijk (vast zaad = ts).
//  Dit is alleen de rekenkant; de kaartlagen staan in src/kaart/piraatLagen.ts.
// ============================================================
import { FLEET } from "../../convex/lib/config";
import { BUIT, SPEL, type BuitSoort } from "../../convex/lib/spel";
import type { LatLng, Mijn, Schot, SpelData, Veld } from "../../convex/lib/validators";
import { afstandMeter } from "./geo";
import { formatAfstand, formatDuur, formatKlok, klokHM } from "./format";

export type BootStand = {
  boot: string; levens: number; hits: number; gebruikt: number; straf: number; dood: number | null; laatsteSchot: number | null;
  geraakt: number | null; lading: BuitSoort | null; kisten: number; vondst: { soort: BuitSoort; t: number; nr: number } | null;
  schild: boolean; geblokt: number; spookTot: number; snelTot: number; valTot: number; mijnRaak: number;
};
export type GeldigSchot = { id: string; boot: string; schot: Schot; raak: string[]; geblokt: string[] };
export type MijnStaat = { id: string; boot: string; ts: number; lat: number; lng: number; actief: boolean; knal?: number; slachtoffer?: string; geblokt?: boolean };
export type LadingSoort = "bereik" | "breed" | "voor";
export type SpelLog =
  | { t: number; soort: "straf"; b: string; levens: number }
  | { t: number; soort: "kist"; b: string; buit: BuitSoort }
  | { t: number; soort: "mijn"; b: string }
  | { t: number; soort: "mijnraak"; b: string; eigenaar: string; geblokt: boolean; levens: number }
  | { t: number; soort: "schot"; b: string; raak: string[]; geblokt: string[]; levens: Record<string, number>; lading: LadingSoort | null };
export type SpelStand = {
  bezig: boolean; wacht?: boolean; over: number | null; start?: number; veld?: Veld; boten: Record<string, BootStand>; deelnemers: string[];
  volgorde: BootStand[]; geldig: GeldigSchot[]; mijnen: MijnStaat[]; winnaar?: BootStand | null; gelijk?: boolean; log?: SpelLog[];
};
export type Kist = { nr: number; van: number; tot: number; lat: number; lng: number };
export type Kogel = { kant: "sb" | "bb" | "voor"; eind: LatLng; vertraging: number };
export type Journaalregel = { t: number; kop: string; tekst: string };
type KistSpel = { start: number; veld: Veld };
type SchotVorm = Pick<Schot, "ts" | "lat" | "lng" | "koers" | "groot" | "breed" | "voor">;

const M_PER_GRAAD = 111320;
const naarXY = (o: LatLng, p: LatLng) => ({ x: (p.lng - o.lng) * M_PER_GRAAD * Math.cos(o.lat * Math.PI / 180), y: (p.lat - o.lat) * M_PER_GRAAD });
const vanXY = (o: LatLng, x: number, y: number): LatLng => ({ lat: o.lat + y / M_PER_GRAAD, lng: o.lng + x / (M_PER_GRAAD * Math.cos(o.lat * Math.PI / 180)) });
export const richting = (o: LatLng, peil: number, lengte: number): LatLng => { const t = peil * Math.PI / 180; return vanXY(o, Math.sin(t) * lengte, Math.cos(t) * lengte); };

export const bereik = (schot?: { groot?: boolean } | null) => SPEL.bereikM * (schot && schot.groot ? SPEL.kistBereik : 1);
// Lading → vlaggen op het salvo (en terug)
export const SCHOT_VLAG: Partial<Record<BuitSoort, "groot" | "breed" | "voor">> = { bereik: "groot", breed: "breed", voor: "voor" };
const metLading = (schot: SchotVorm) => !!(schot.groot || schot.breed || schot.voor);

// ---- Buitkisten: kist nr = ronde × kistAantal + plek ----
// Elke plek begint een nieuwe ronde (nieuwe kist, nieuwe plaats) om de kistDuurMs,
// per plek een beetje verschoven zodat niet alle kisten tegelijk verhuizen.
// De plaats volgt uit start en nr (vast zaad), dus iedereen ziet dezelfde kisten.
const kistVerschuiving = (plek: number) => plek * SPEL.kistDuurMs / SPEL.kistAantal;
// Een kist ligt minstens kistAfstandM van de kisten die er al lagen toen hij verscheen (die
// eerder begonnen en tegelijk in het water liggen). Lukt dat niet binnen het midden, dan zoekt
// hij iets verder naar buiten, en anders de plek die het verst van de rest ligt.
const kistCache = new Map<string, Kist>();
const kistBegin = (spel: KistSpel, nr: number) => spel.start + kistVerschuiving(nr % SPEL.kistAantal) + Math.floor(nr / SPEL.kistAantal) * SPEL.kistDuurMs;
export function kist(spel: KistSpel, nr: number): Kist {
  const v = spel.veld, sleutel = `${spel.start}|${v.lat},${v.lng},${v.r}|${nr}`;
  const bekend = kistCache.get(sleutel);
  if (bekend) return bekend;
  if (kistCache.size > 5000) kistCache.clear();
  const ronde = Math.floor(nr / SPEL.kistAantal);
  const begin = kistBegin(spel, nr), van = ronde ? begin : spel.start, tot = begin + SPEL.kistDuurMs;
  const buren: Kist[] = [];
  for (let q = 0; q < SPEL.kistAantal; q++) for (let rq = Math.max(0, ronde - 1); rq <= ronde; rq++) {
    const nq = rq * SPEL.kistAantal + q, bq = kistBegin(spel, nq), vq = rq ? bq : spel.start;
    if (nq === nr || !(bq < begin || (bq === begin && nq < nr))) continue;     // alleen de kisten van vóór deze
    if (vq < tot && bq + SPEL.kistDuurMs > van) buren.push(kist(spel, nq));
  }
  let s = (Math.floor(spel.start / 1000) + nr * 7919) % 2147483647 || 1;
  const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
  rnd(); rnd();
  // richting het midden (zonder wortel: dichter bij het midden), binnen de cirkel zoals die
  // is als de kist verschijnt (het veld krimpt)
  const rVeld = straal(v, spel.start, van) ?? 0;
  let beste: LatLng | null = null, besteD = -1;
  for (let i = 0; i < 40; i++) {
    const r = rVeld * Math.min(0.85, SPEL.kistMidden + i * 0.01) * rnd(), hoek = rnd() * 360;
    const p = richting(v, hoek, r), d = Math.min(Infinity, ...buren.map((k) => afstandMeter(k, p)));
    if (d > besteD) { beste = p; besteD = d; }
    if (d >= SPEL.kistAfstandM) break;
  }
  const k: Kist = Object.assign({ nr, van, tot }, beste!);
  kistCache.set(sleutel, k);
  return k;
}
// Wat er in kist nr zit (vast zaad, los van de plaats)
export function inhoud(spel: { start: number }, nr: number): BuitSoort {
  let s = (Math.floor(spel.start / 1000) * 31 + nr * 104729 + 12345) % 2147483647 || 1;
  for (let i = 0; i < 3; i++) s = s * 16807 % 2147483647;
  const soorten = Object.keys(BUIT) as BuitSoort[], totaal = soorten.reduce((t, k) => t + BUIT[k].kans, 0);
  let x = s / 2147483647 * totaal;
  for (const k of soorten) { x -= BUIT[k].kans; if (x < 0) return k; }
  return soorten[0];
}
// De kisten die op tijdstip 'nu' in het water liggen en nog niet gepakt zijn
export function kisten(spel: SpelData | null | undefined, nu: number): Kist[] {
  if (!spel || !spel.start || !spel.veld || !spel.veld.r) return [];
  const ks: KistSpel = { start: spel.start, veld: spel.veld };
  const eind = Math.min(nu, spel.eind || Infinity), uit: Kist[] = [];
  if (eind < spel.start) return uit;
  for (let plek = 0; plek < SPEL.kistAantal; plek++) {
    const ronde = Math.max(0, Math.floor((eind - spel.start - kistVerschuiving(plek)) / SPEL.kistDuurMs));
    const nr = ronde * SPEL.kistAantal + plek;
    if (!(spel.buit && spel.buit[nr])) uit.push(kist(ks, nr));
  }
  return uit;
}

// ---- De kogelwolk van een salvo (voor iedereen hetzelfde: zaad = tijdstip) ----
export function kogels(schot: SchotVorm): Kogel[] {
  let s = Math.floor(schot.ts) % 2147483647 || 1;
  const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
  const uit: Kogel[] = [], n = SPEL.kogelsPerKant, spreiding = schot.breed ? SPEL.breedGr : SPEL.spreidingGr;
  const zij = { sb: 90, bb: -90, voor: 0 };
  (["sb", "bb"] as Kogel["kant"][]).concat(schot.voor ? ["voor"] : []).forEach((kant) => {
    for (let i = 0; i < n; i++) {
      const waaier = n > 1 ? -spreiding + 2 * spreiding * i / (n - 1) : 0;
      const peil = schot.koers + zij[kant] + waaier + (rnd() - 0.5) * 3;
      const lengte = bereik(schot) * (0.85 + rnd() * 0.2);
      uit.push({ kant, eind: richting(schot, peil, lengte), vertraging: rnd() * 220 });
    }
  });
  return uit;
}
// Raakt het salvo de boot op 'doel'? (binnen raakM van een kogelbaan)
export function raakt(schot: SchotVorm, doel: LatLng): boolean {
  const d = naarXY(schot, doel);
  if (Math.hypot(d.x, d.y) < 3) return false;                     // dat ben je zelf
  return kogels(schot).some((k) => {
    const e = naarXY(schot, k.eind), l2 = e.x * e.x + e.y * e.y;
    const f = Math.max(0, Math.min(1, (d.x * e.x + d.y * e.y) / l2));
    return Math.hypot(d.x - f * e.x, d.y - f * e.y) <= SPEL.raakM;
  });
}
// De straal van het speelveld op tijdstip t: eerst de volle maat, na krimpNaMs
// gelijkmatig kleiner tot de kleinste maat. Iedereen rekent hetzelfde uit (uit start en t).
export function straal(veld: Veld | null | undefined, start: number | null | undefined, t: number | null | undefined): number | null {
  if (!veld || !veld.r) return null;
  if (!start || t == null) return veld.r;
  const min = Math.min(veld.r, Math.max(SPEL.krimpMinM, veld.r * SPEL.krimpMinDeel));
  const f = Math.max(0, Math.min(1, (t - start - SPEL.krimpNaMs) / SPEL.krimpDuurMs));
  return veld.r - (veld.r - min) * f;
}
// Het speelveld op tijdstip t (met de gekrompen straal)
export const veldOp = (veld: Veld | null | undefined, start: number | null | undefined, t: number | null | undefined) =>
  veld && veld.r ? Object.assign({}, veld, { r: straal(veld, start, t) ?? veld.r }) : veld;
export const binnenVeld = (veld: Veld | null | undefined, pos: LatLng) => !veld || afstandMeter(veld, pos) <= veld.r;

// ---- De stand: alle salvo's en strafpunten op tijdvolgorde afspelen ----
// posTs = { boot: tijd van de laatste positie } → wie doet er mee.
// Ligt het begin nog in de toekomst, dan wordt er afgeteld: wacht = true, nog niet bezig.
type Gebeurtenis =
  | { soort: "schot"; b: string; t: number; s: Schot; id: string }
  | { soort: "straf"; b: string; t: number }
  | { soort: "kist"; b: string; t: number; nr: number }
  | { soort: "mijn"; b: string; t: number; m: Mijn; id: string }
  | { soort: "mijnraak"; b: string; t: number; id: string };
export function stand(spel: SpelData | null | undefined, posTs: Record<string, number | undefined>, nu = Date.now()): SpelStand {
  const boten: Record<string, BootStand> = {};
  FLEET.forEach((b) => { boten[b] = { boot: b, levens: SPEL.levens, hits: 0, gebruikt: 0, straf: 0, dood: null, laatsteSchot: null,
    geraakt: null, lading: null, kisten: 0, vondst: null, schild: false, geblokt: 0, spookTot: 0, snelTot: 0, valTot: 0, mijnRaak: 0 }; });
  if (!spel || !spel.start) return { bezig: false, over: null, boten, deelnemers: [], volgorde: [], geldig: [], mijnen: [], veld: spel ? spel.veld : undefined };
  if (nu < spel.start) return { bezig: false, wacht: true, over: null, start: spel.start, veld: spel.veld, boten,
    deelnemers: [], volgorde: [], geldig: [], mijnen: [] };
  const start = spel.start;
  const ev: Gebeurtenis[] = [];
  Object.entries(spel.schoten || {}).forEach(([b, l]) => Object.entries(l || {}).forEach(([nr, s]) =>
    s && s.ts != null && ev.push({ soort: "schot", b, t: s.ts, s, id: b + "/" + nr })));
  Object.entries(spel.straf || {}).forEach(([b, l]) => Object.values(l || {}).forEach((t) =>
    t != null && ev.push({ soort: "straf", b, t })));
  Object.entries(spel.buit || {}).forEach(([nr, k]) =>
    k && k.boot && k.ts != null && ev.push({ soort: "kist", b: k.boot, t: k.ts, nr: +nr }));
  Object.entries(spel.mijnen || {}).forEach(([b, l]) => Object.entries(l || {}).forEach(([nr, m]) =>
    m && m.ts != null && ev.push({ soort: "mijn", b, t: m.ts, m, id: b + "-" + nr })));
  Object.entries(spel.mijnraak || {}).forEach(([b, l]) => Object.entries(l || {}).forEach(([id, t]) =>
    t != null && ev.push({ soort: "mijnraak", b, t, id })));
  ev.sort((a, c) => a.t - c.t);
  const deelnemers = FLEET.filter((b) => (posTs[b] || 0) >= start || ev.some((e) => e.b === b));
  const levend = () => deelnemers.filter((b) => boten[b].levens > 0);
  const klaar = () => {
    const l = levend();
    if (!deelnemers.length) return false;
    if (!l.length) return true;                                      // niemand meer over
    if (deelnemers.length >= 2 && l.length <= 1) return true;        // één schip blijft drijven
    return l.every((b) => boten[b].gebruikt >= SPEL.schoten);        // alle kogels zijn op
  };
  let over: number | null = null;
  const geldig: GeldigSchot[] = [], mijnen: MijnStaat[] = [];
  const log: SpelLog[] = [];        // wat er gebeurde, op tijdvolgorde (voor het scheepsjournaal)
  // Een treffer (kogel of mijn) op boot d: het schild vangt hem op, anders een leven minder
  const treffer = (d: string, t: number) => {
    const doel = boten[d];
    if (doel.schild) { doel.schild = false; doel.geblokt++; return false; }
    doel.levens--; doel.geraakt = t; if (!doel.levens) doel.dood = t;
    return true;
  };
  for (const e of ev) {
    if (over || (spel.eind && e.t > spel.eind)) break;
    const ik = boten[e.b];
    if (!ik || ik.levens <= 0) continue;                             // een wrak schiet niet meer
    if (e.soort === "straf") {
      ik.levens--; ik.straf++;
      if (!ik.levens) ik.dood = e.t;
      log.push({ t: e.t, soort: "straf", b: e.b, levens: ik.levens });
    } else if (e.soort === "kist") {
      // telt als de kist toen in het water lag (10 s speling voor een trage verbinding)
      const k = spel.veld ? kist({ start, veld: spel.veld }, e.nr) : null;
      if (!k || ik.lading || e.t < k.van || e.t > k.tot + 10000) continue;
      const soort = inhoud({ start }, e.nr);
      log.push({ t: e.t, soort: "kist", b: e.b, buit: soort });
      ik.kisten++; ik.vondst = { soort, t: e.t, nr: e.nr };
      if (BUIT[soort].lading) ik.lading = soort;
      else if (soort === "schild") ik.schild = true;
      else if (soort === "spook") ik.spookTot = e.t + SPEL.spookMs;
      else if (soort === "snel") ik.snelTot = e.t + SPEL.snelMs;
      else if (soort === "val") ik.valTot = e.t + SPEL.valMs;
    } else if (e.soort === "mijn") {
      if (ik.lading !== "mijn") continue;                            // alleen met een mijn uit een kist
      ik.lading = null;
      mijnen.push({ id: e.id, boot: e.b, ts: e.t, lat: e.m.lat, lng: e.m.lng, actief: true });
      log.push({ t: e.t, soort: "mijn", b: e.b });
    } else if (e.soort === "mijnraak") {
      const m = mijnen.find((m) => m.id === e.id);
      if (!m || !m.actief || m.boot === e.b || e.t < m.ts) continue;
      m.actief = false; m.knal = e.t; m.slachtoffer = e.b;
      const gat = treffer(e.b, e.t);
      m.geblokt = !gat;
      if (gat) { ik.mijnRaak++; boten[m.boot].hits++; }
      log.push({ t: e.t, soort: "mijnraak", b: e.b, eigenaar: m.boot, geblokt: !gat, levens: ik.levens });
    } else {
      if (ik.gebruikt >= SPEL.schoten) continue;
      if (ik.geraakt != null && e.t < ik.geraakt + SPEL.geraaktMs) continue;   // net geraakt: het kanon ligt stil
      if (e.t < ik.valTot) continue;                                 // boobytrap: het kanon is onklaar
      ik.gebruikt++; ik.laatsteSchot = e.t;
      if (metLading(e.s) && ik.lading !== "mijn") ik.lading = null;  // de lading is verschoten
      const raak: string[] = [], geblokt: string[] = [];
      Object.keys(e.s.raak || {}).filter((d) => boten[d] && d !== e.b && boten[d].levens > 0)
        .forEach((d) => { if (treffer(d, e.t)) { raak.push(d); ik.hits++; } else geblokt.push(d); });
      geldig.push({ id: e.id, boot: e.b, schot: e.s, raak, geblokt });
      log.push({ t: e.t, soort: "schot", b: e.b, raak, geblokt, levens: Object.fromEntries(raak.map((d) => [d, boten[d].levens])),
        lading: e.s.groot ? "bereik" : e.s.breed ? "breed" : e.s.voor ? "voor" : null });
    }
    if (klaar()) over = e.t;
  }
  if (!over && spel.eind) over = spel.eind;
  const rest = (b: BootStand) => SPEL.schoten - b.gebruikt;
  const volgorde = deelnemers.map((b) => boten[b])
    .sort((a, c) => c.levens - a.levens || c.hits - a.hits || rest(c) - rest(a));
  const [w, t] = volgorde;
  const gelijk = !!(w && t && w.levens === t.levens && w.hits === t.hits && rest(w) === rest(t));
  return { bezig: !over, over, start: spel.start, veld: spel.veld, boten, deelnemers, volgorde, geldig, mijnen,
           winnaar: over && w ? w : null, gelijk, log };
}

// ---- Scheepsjournaal van een zeeslag (uit de opgeslagen gegevens) ----
// posTs: wie deed er mee (zie stand). Notities bij de start, elke treffer, mijn of straf,
// en het einde. Missers, kisten en gelegde mijnen tussendoor komen samen in de volgende notitie.
// → [{ t, kop, tekst }] (oud → nieuw)
export function journaal(spel: SpelData | null | undefined, naam: (b: string) => string, posTs: Record<string, number | undefined>): Journaalregel[] {
  const st = stand(spel, posTs, Infinity);
  if (!st.start) return [];
  const start = st.start, stLog = st.log || [];
  let zaad = Math.floor(start / 1000) % 2147483647 || 1;
  const kies = <T>(l: T[]): T => l[(zaad = zaad * 16807 % 2147483647) % l.length];
  const lijst = (a: string[]) => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " en " + a[a.length - 1];
  const nog = (n: number) => n > 0 ? `nog ${harten(n)}` : null;
  const zinkt = (d: string) => kies([`${naam(d)} zinkt naar de kelder van Davy Jones! ☠️`, `${naam(d)} gaat kopje onder — een wrak op de bodem van de zee. ☠️`]);
  type Tussendoor = { mis: number; kisten: BuitSoort[]; mijnen: number };
  const uit: Journaalregel[] = [], tussendoor: Record<string, Tussendoor> = {};          // per boot: { mis, kisten: [buit], mijnen }
  const opsparen = (b: string, wat: "mis" | "kist" | "mijnen", x?: BuitSoort) => { const t = tussendoor[b] = tussendoor[b] || { mis: 0, kisten: [], mijnen: 0 };
    if (wat === "kist") t.kisten.push(x!); else t[wat]++; };
  const intussen = () => {
    const zinnen = Object.entries(tussendoor).map(([b, t]) => {
      const d: string[] = [];
      if (t.mis) d.push(t.mis === 1 ? "vuurde een salvo in het water" : `vuurde ${t.mis} salvo's in het water`);
      if (t.kisten.length) d.push(`viste ${lijst(t.kisten.map((k) => `${BUIT[k].icoon} ${BUIT[k].naam}`))} uit ${t.kisten.length === 1 ? "een schatkist" : t.kisten.length + " schatkisten"}`);
      if (t.mijnen) d.push(t.mijnen === 1 ? "legde een zeemijn" : `legde ${t.mijnen} zeemijnen`);
      return d.length ? `${naam(b)} ${lijst(d)}` : "";
    }).filter(Boolean);
    Object.keys(tussendoor).forEach((b) => delete tussendoor[b]);
    return zinnen.length ? ` Intussen: ${zinnen.join("; ")}.` : "";
  };
  const noteer = (t: number, kop: string, tekst: string) => uit.push({ t, kop: `${klokHM(t)} · ${kop}`, tekst: tekst + intussen() });

  const namen = st.deelnemers.map(naam);
  uit.push({ t: start, kop: `${klokHM(start)} · de zeeslag begint`, tekst:
    kies(["Boem! Het kanon bulderde: de zeeslag is begonnen.", "Arr, de vlag met de doodskop gaat in top: de zeeslag is begonnen!"]) +
    (namen.length ? ` Op het water: ${lijst(namen)}, elk met ${SPEL.levens} levens en ${SPEL.schoten} salvo's.` : "") +
    (st.veld && st.veld.r ? ` Het speelveld is een cirkel met een straal van ${formatAfstand(st.veld.r)}; wie erbuiten vaart, verliest elke ${SPEL.strafMs / 1000} seconden een leven.` : "") });

  // het moment dat het speelveld begint te krimpen (als de zeeslag dan nog woedt)
  const krimpT = start + SPEL.krimpNaMs, gebeurtenissen: (SpelLog | { t: number; soort: "krimp" })[] = [...stLog];
  if (st.veld && st.veld.r && (st.over || Infinity) > krimpT) gebeurtenissen.push({ t: krimpT, soort: "krimp" });
  gebeurtenissen.sort((a, c) => a.t - c.t).forEach((e) => {
    if (e.soort === "krimp") {
      const veld = st.veld!, min = straal(veld, start, Infinity) ?? veld.r;
      return noteer(e.t, "het speelveld krimpt", kies(["Arr, de zee trekt zich samen!", "De kaart wordt kleiner, mateys!"]) +
        ` Het speelveld krimpt in ${SPEL.krimpDuurMs / 60000} minuten van ${formatAfstand(veld.r)} naar ${formatAfstand(min)} straal. Wie niet meekrimpt, ligt er zo buiten.`);
    }
    const ik = naam(e.b);
    if (e.soort === "kist") return opsparen(e.b, "kist", e.buit);
    if (e.soort === "mijn") return opsparen(e.b, "mijnen");
    if (e.soort === "schot" && !e.raak.length && !e.geblokt.length) return opsparen(e.b, "mis");
    if (e.soort === "schot") {
      const lading = e.lading ? ` (met ${BUIT[e.lading].icoon} ${BUIT[e.lading].naam})` : "";
      const zinnen: string[] = [];
      if (e.raak.length) zinnen.push(kies([`💥 ${ik} vuurt een volle breedzijde af${lading} en raakt ${lijst(e.raak.map(naam))}!`,
        `💥 Kanonnen bulderen: ${ik} treft ${lijst(e.raak.map(naam))}${lading}.`, `💥 Raak! De kogels van ${ik}${lading} slaan in bij ${lijst(e.raak.map(naam))}.`]));
      e.raak.forEach((d) => zinnen.push(e.levens[d] > 0 ? `${naam(d)} heeft ${nog(e.levens[d])}.` : zinkt(d)));
      e.geblokt.forEach((d) => zinnen.push(`🛡️ Het schild van ${naam(d)} vangt de kogels van ${ik} op.`));
      noteer(e.t, e.raak.length ? `${ik} raakt ${lijst(e.raak.map(naam))}` : `${ik} schiet op een schild`, zinnen.join(" "));
    } else if (e.soort === "mijnraak") {
      noteer(e.t, `${ik} op een zeemijn`, `💣 ${ik} vaart op de zeemijn van ${naam(e.eigenaar)}!` +
        (e.geblokt ? ` Het schild vangt de klap op. 🛡️` : " " + (e.levens > 0 ? `${ik} heeft ${nog(e.levens)}.` : zinkt(e.b))));
    } else if (e.soort === "straf") {
      noteer(e.t, `${ik} buiten het speelveld`, `${ik} dreef buiten het speelveld en verliest een leven. ` +
        (e.levens > 0 ? `${ik} heeft ${nog(e.levens)}.` : zinkt(e.b)));
    }
  });

  if (st.over) {
    const rest = (b: BootStand) => SPEL.schoten - b.gebruikt;
    noteer(st.over, "einde van de zeeslag", statusTekst(st, naam) + (st.volgorde.length ? " Eindstand: " + st.volgorde.map((b, i) =>
      `${i + 1}. ${naam(b.boot)} — ${b.levens ? harten(b.levens) : "☠️ gezonken"}, ${b.hits}× raak, ${rest(b)} salvo's over`).join("; ") + "." : ""));
  } else {
    const t = Math.max(start, ...stLog.map((e) => e.t));
    const extra = intussen();
    if (extra) uit.push({ t, kop: `${klokHM(t)} · de zeeslag woedt nog`, tekst: extra.trim() });
  }
  return uit;
}
export const harten = (n: number) => "❤️".repeat(Math.max(0, n)) + "🖤".repeat(Math.max(0, SPEL.levens - n));
// Levens, met een schild en 💰 als het schip lading uit een kist heeft (welke, ziet alleen de eigenaar)
export const levensTekst = (b: BootStand) => harten(b.levens) + (b.levens > 0 ? (b.schild ? " 🛡️" : "") + (b.lading ? " 💰" : "") : "");
// Wat een schip nu bij zich heeft en wat er loopt (voor de eigen statusregel)
export function effectenTekst(b: BootStand, nu: number): string {
  const uit: string[] = [], klok = (ms: number) => formatDuur(Math.ceil(ms / 1000) * 1000);
  if (b.lading) uit.push(`${BUIT[b.lading].icoon} ${BUIT[b.lading].naam}`);
  if (b.schild) uit.push("🛡️ schild");
  if (b.spookTot > nu) uit.push(`👻 spookschip ${klok(b.spookTot - nu)}`);
  if (b.snelTot > nu) uit.push(`⚡ snel herladen ${klok(b.snelTot - nu)}`);
  if (b.valTot > nu) uit.push(`🪤 boobytrap ${klok(b.valTot - nu)}`);
  return uit.join(" · ");
}
// Herlaadtijd na het laatste salvo (gehalveerd als dat salvo viel tijdens 'snel herladen')
export const herlaadDuur = (b: BootStand | null | undefined, t: number) => SPEL.herlaadMs / (b && t < b.snelTot ? 2 : 1);
export const spook = (b: BootStand | null | undefined, nu: number) => !!(b && b.levens > 0 && b.spookTot > nu);

// ---- Overzicht van wat er in een schatkist kan zitten, met de kans (uit BUIT) ----
// (vroeger buitHtml; de weergave zit nu in React)
export type BuitRegel = { soort: BuitSoort; icoon: string; naam: string; tekst: string; lading: boolean; pct: number };
export function buitOverzicht(): BuitRegel[] {
  const totaal = Object.values(BUIT).reduce((t, b) => t + b.kans, 0);
  return (Object.keys(BUIT) as BuitSoort[]).map((soort) => {
    const b = BUIT[soort];
    return { soort, icoon: b.icoon, naam: b.naam, tekst: b.tekst, lading: !!b.lading, pct: Math.round(b.kans / totaal * 100) };
  });
}
export function statusTekst(st: SpelStand, naam: (b: string) => string): string {
  if (!st.start) return "";
  if (st.wacht) return `De kanonnen worden geladen: de zeeslag begint om ${formatKlok(st.start)}.`;
  if (st.bezig) {
    const r = straal(st.veld, st.start, Date.now());
    return `De zeeslag woedt sinds ${klokHM(st.start)}.` + (st.veld && r != null && r < st.veld.r
      ? ` Het speelveld krimpt: straal nu ${formatAfstand(r)}.`
      : st.veld && st.veld.r ? ` Om ${klokHM(st.start + SPEL.krimpNaMs)} begint het speelveld te krimpen.` : "");
  }
  if (!st.winnaar) return "De zeeslag is voorbij.";
  return st.gelijk ? "De zeeslag is voorbij — onbeslist! Gelijke stand aan kop."
    : `De zeeslag is voorbij. ${naam(st.winnaar.boot)} is de schrik van de zeven zeeën! 🏴‍☠️`;
}
