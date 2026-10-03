// ============================================================
//  Uitslagen en zeeslagen van de oude Firebase-site overzetten naar Convex.
//
//    bun scripts/importeer-firebase.ts --ophalen        haalt de race op uit Firebase (alleen lezen)
//    bun scripts/importeer-firebase.ts export.json      of: een JSON-export uit de Firebase-console
//    extra: --baan  zet ook de huidige baan (lijnen en boeien) klaar
//
//  Het script schrijft JSONL-bestanden naar import/ en toont de opdrachten
//  om ze in te lezen (bunx convex import …). Het schrijft zelf niets in Convex
//  en niets in Firebase. Lees elke tabel maar één keer in, anders staan races dubbel.
// ============================================================
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { RACE_ID } from "../convex/lib/config";

const FIREBASE = {
  apiKey: "AIzaSyDdrSzr8E3_MXqDLUq9aEvf2zg-nJi30gs",
  databaseURL: "https://marzeille-474a9-default-rtdb.europe-west1.firebasedatabase.app",
};
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const getal = (x: unknown) => (typeof x === "number" && isFinite(x) ? x : undefined);
const tekst = (x: unknown) => (typeof x === "string" ? x : undefined);
// Firebase maakt van {0:…,1:…} een array (met gaten als null): altijd een lijst of een record maken
const lijst = (x: unknown): unknown[] => (Array.isArray(x) ? x : isObj(x) ? Object.values(x) : []).filter((v) => v != null);
const record = (x: unknown): Obj => {
  if (Array.isArray(x)) return Object.fromEntries(x.map((v, i) => [String(i), v]).filter(([, v]) => v != null));
  return isObj(x) ? Object.fromEntries(Object.entries(x).filter(([, v]) => v != null)) : {};
};
const recordVan = <T>(x: unknown, f: (v: unknown) => T | undefined): Record<string, T> =>
  Object.fromEntries(Object.entries(record(x)).map(([k, v]) => [k, f(v)]).filter(([, v]) => v !== undefined)) as Record<string, T>;
// Alle undefined-velden weg (Convex kent geen undefined)
const schoon = <T extends Obj>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const punt = (p: unknown) => isObj(p) && getal(p.lat) != null && getal(p.lng) != null ? { lat: p.lat as number, lng: p.lng as number } : undefined;
const lijn = (l: unknown) => isObj(l) && punt(l.a) && punt(l.b) ? { a: punt(l.a)!, b: punt(l.b)! } : undefined;
const lijnen = (l: unknown) => (isObj(l) ? schoon({ start: lijn(l.start), finish: lijn(l.finish) }) : {});
const boei = (b: unknown) => isObj(b) && punt(b) ? schoon({ id: tekst(b.id), ...punt(b)!, naam: tekst(b.naam) }) : undefined;
const boeien = (x: unknown) => lijst(x).map(boei).filter(Boolean);
const spoor = (x: unknown) => lijst(x).map((p) => lijst(p).map(Number)).filter((p) => p.length >= 2 && p.every((n) => isFinite(n)))
  .map((p, i) => (p.length >= 3 ? p.slice(0, 3) : [p[0], p[1], i]));
const notities = (x: unknown) => lijst(x).filter(isObj).map((n) => ({ t: getal(n.t) ?? 0, kop: tekst(n.kop) ?? "", tekst: tekst(n.tekst) ?? "" }));
const lus = (l: unknown) => isObj(l) && tekst(l.na) ? { na: l.na as string, extraM: getal(l.extraM) ?? 0, boeien: boeien(l.boeien) } : undefined;
const modus = (m: unknown) => (["gelijk", "achtervolging", "lus"].includes(m as string) ? (m as string) : undefined);

function uitslag(nr: number, r: Obj) {
  const sp = recordVan(r.sporen, (v) => { const s = spoor(v); return s.length ? s : undefined; });
  return schoon({
    raceId: RACE_ID, nr: getal(r.nr) ?? nr, ts: getal(r.ts) ?? 0, naam: tekst(r.naam),
    uitslag: recordVan(r.uitslag, (u) => isObj(u) ? schoon({ gefinisht: !!u.gefinisht, elapsed: getal(u.elapsed),
      corrected: getal(u.corrected), afstand: getal(u.afstand) }) : undefined),
    namen: recordVan(r.namen, tekst),
    modus: modus(r.modus),
    baan: isObj(r.baan) ? { lines: lijnen(r.baan.lines), marks: boeien(r.baan.marks) } : undefined,
    nm: getal(r.nm),
    vertraging: isObj(r.vertraging) ? recordVan(r.vertraging, getal) : undefined,
    lussen: isObj(r.lussen) ? recordVan(r.lussen, lus) : undefined,
    lengtes: isObj(r.lengtes) ? recordVan(r.lengtes, getal) : undefined,
    sporen: Object.keys(sp).length ? sp : undefined,
    t0: getal(r.t0), gun: getal(r.gun),
    tijden: isObj(r.tijden) ? recordVan(r.tijden, (t) => isObj(t) ? schoon({ start: getal(t.start), finish: getal(t.finish) }) : undefined) : undefined,
    rondingen: isObj(r.rondingen) ? recordVan(r.rondingen, (g) => recordVan(g, getal)) : undefined,
    wind: Array.isArray(r.wind) || isObj(r.wind) ? lijst(r.wind).filter(isObj)
      .map((w) => ({ t: getal(w.t) ?? 0, kn: getal(w.kn) ?? 0, richting: getal(w.richting) ?? 0 })) : undefined,
    journaal: r.journaal != null ? notities(r.journaal) : undefined,
  });
}

function spel(s: unknown) {
  if (!isObj(s)) return {};
  const perBoot = <T>(x: unknown, f: (v: unknown) => T | undefined) => recordVan(x, (l) => recordVan(l, f));
  const schot = (v: unknown) => isObj(v) && getal(v.ts) != null ? schoon({ ts: v.ts as number, lat: getal(v.lat) ?? 0, lng: getal(v.lng) ?? 0,
    koers: getal(v.koers) ?? 0, groot: v.groot ? true : undefined, breed: v.breed ? true : undefined, voor: v.voor ? true : undefined,
    raak: isObj(v.raak) ? recordVan(v.raak, (x) => (x ? true : undefined)) : undefined }) : undefined;
  return schoon({
    start: getal(s.start), eind: getal(s.eind),
    veld: isObj(s.veld) && getal(s.veld.r) ? { ...punt(s.veld)!, r: s.veld.r as number } : undefined,
    schoten: s.schoten ? perBoot(s.schoten, schot) : undefined,
    straf: s.straf ? perBoot(s.straf, getal) : undefined,
    buit: s.buit ? recordVan(s.buit, (k) => isObj(k) && tekst(k.boot) && getal(k.ts) != null ? { boot: k.boot as string, ts: k.ts as number } : undefined) : undefined,
    mijnen: s.mijnen ? perBoot(s.mijnen, (m) => isObj(m) && getal(m.ts) != null && punt(m) ? { ts: m.ts as number, ...punt(m)! } : undefined) : undefined,
    mijnraak: s.mijnraak ? perBoot(s.mijnraak, getal) : undefined,
  });
}

function zeeslag(start: number, z: Obj) {
  const sp = recordVan(z.sporen, (v) => { const s = spoor(v); return s.length ? s : undefined; });
  return schoon({
    raceId: RACE_ID, start: getal(z.start) ?? start, ts: getal(z.ts) ?? start, over: getal(z.over) ?? start, t0: getal(z.t0) ?? start,
    namen: recordVan(z.namen, tekst), deelnemers: lijst(z.deelnemers).filter((x): x is string => typeof x === "string"),
    spel: spel(z.spel),
    stand: lijst(z.stand).filter(isObj).map((r) => schoon({ boot: tekst(r.boot) ?? "", levens: getal(r.levens) ?? 0, hits: getal(r.hits) ?? 0,
      salvos: getal(r.salvos) ?? 0, kisten: getal(r.kisten) })),
    winnaar: tekst(z.winnaar),
    journaal: notities(z.journaal),
    sporen: Object.keys(sp).length ? sp : undefined,
  });
}

async function ophalen(): Promise<Obj> {
  const login = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) })).json();
  if (!login.idToken) throw new Error("Anoniem inloggen bij Firebase mislukt: " + JSON.stringify(login.error || login));
  const r = await fetch(`${FIREBASE.databaseURL}/races/${RACE_ID}.json?auth=${login.idToken}`);
  if (!r.ok) throw new Error(`Firebase gaf ${r.status}: ${await r.text()}`);
  return (await r.json()) || {};
}

const args = process.argv.slice(2);
const bron = args.find((a) => !a.startsWith("--"));
if (!bron && !args.includes("--ophalen")) {
  console.log("Gebruik: bun scripts/importeer-firebase.ts --ophalen   of   bun scripts/importeer-firebase.ts export.json   [--baan]");
  process.exit(1);
}
let data: Obj = bron ? JSON.parse(readFileSync(bron, "utf8")) : await ophalen();
// Een export van de hele database, of alleen van races/<race>
if (isObj(data.races) && isObj((data.races as Obj)[RACE_ID])) data = (data.races as Obj)[RACE_ID] as Obj;

const uitslagen = Object.entries(record(data.results)).filter(([, r]) => isObj(r)).map(([nr, r]) => uitslag(+nr, r as Obj));
const zeeslagen = Object.entries(record(data.zeeslagen)).filter(([, z]) => isObj(z)).map(([s, z]) => zeeslag(+s, z as Obj));
mkdirSync("import", { recursive: true });
const jsonl = (rijen: unknown[]) => rijen.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync("import/uitslagen.jsonl", jsonl(uitslagen));
writeFileSync("import/zeeslagen.jsonl", jsonl(zeeslagen));
console.log(`${uitslagen.length} race(s): ${uitslagen.map((u) => u.nr + (u.naam ? ` (${u.naam})` : "")).join(", ") || "geen"}`);
console.log(`${zeeslagen.length} zeeslag(en)`);
const opdrachten = [
  "bunx convex import --table uitslagen --append import/uitslagen.jsonl",
  "bunx convex import --table zeeslagen --append import/zeeslagen.jsonl",
];
if (args.includes("--baan")) {
  writeFileSync("import/wedstrijden.jsonl", jsonl([{ raceId: RACE_ID, lines: lijnen(data.lines), marks: boeien(data.marks), gen: Date.now() }]));
  opdrachten.push("bunx convex import --table wedstrijden --replace import/wedstrijden.jsonl   (vervangt de huidige baan)");
}
console.log("\nInlezen in de deployment uit .env.local (voeg --prod toe voor productie):\n" + opdrachten.map((o) => "  " + o).join("\n"));
