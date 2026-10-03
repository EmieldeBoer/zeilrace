// ============================================================
//  Simulatie voor lokaal testen: een groep, een baan, boten die hem varen,
//  een startvoorstel met akkoord, en een zeeslag. Alleen tegen een lokale
//  Convex-backend (bunx convex dev met CONVEX_AGENT_MODE=anonymous), nooit
//  tegen een gedeelde of echte deployment.
//
//    bun scripts/simulatie.ts groep [piraat]       nieuwe testgroep met 3 boten (onthouden in .simulatie.json)
//    bun scripts/simulatie.ts baan                 baan uitzetten
//    bun scripts/simulatie.ts race [boten]         start voorstellen, akkoord, varen (standaard 1,2)
//    bun scripts/simulatie.ts akkoord [boten]      akkoord geven op het huidige startvoorstel
//    bun scripts/simulatie.ts zeeslag [boten]      speelveld + zeeslag (zet piratenmodus aan)
//    bun scripts/simulatie.ts reset                live race wissen, boten vrijgeven
//  Boten kies je met hun nummer in de groep, bijvoorbeeld 1,3.
// ============================================================
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const api = anyApi;
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((r) => r.includes("=")).map((r) => {
  const [k, ...v] = r.split("="); return [k.trim(), v.join("=").split("#")[0].trim()];
}));
const url = env.VITE_CONVEX_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url || "")) { console.error(`Alleen voor een lokale backend (nu: ${url}).`); process.exit(1); }
const c = new ConvexHttpClient(url);
const wachten = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Een baan bij Toulon: startlijn, twee boeien, finishlijn (dezelfde als de start)
const M = { lat: 43.0900, lng: 5.9500 };
const dLat = (m: number) => m / 111320, dLng = (m: number) => m / (111320 * Math.cos(M.lat * Math.PI / 180));
const p = (oost: number, noord: number) => ({ lat: +(M.lat + dLat(noord)).toFixed(6), lng: +(M.lng + dLng(oost)).toFixed(6) });
const startLijn = { a: p(-150, 0), b: p(150, 0) };
const boeien = [{ id: "sim1", ...p(0, 700) }, { id: "sim2", ...p(400, 350) }];
const finishLijn = { a: p(-150, -60), b: p(150, -60) };

// ---- De testgroep: de host en elke boot hebben een eigen "toestel" ----
const BESTAND = ".simulatie.json";
const HOST = "simulatie-host-0123456789abcdef0123456789";
const token = (b: string) => `simulatie-toestel-${b}-0123456789abcdef`;
type Sim = { code: string; hostCode: string; groep: string; boten: string[] };
const VLOOT = [
  { model: "Sun Odyssey 389", kleur: "#e6194b", gph: 635, lengte: 10.98 },
  { model: "Sun Odyssey 469", kleur: "#3cb44b", gph: 560, lengte: 13.67 },
  { model: "Sun Odyssey 519", kleur: "#4363d8", gph: 537, lengte: 15.24 },
];

async function groep(piraat: boolean) {
  const { code } = await c.mutation(api.groepen.maak, { token: HOST, naam: "Simulatie", spelerNaam: "Sim-host", piraat, boten: VLOOT });
  await laad(code);
  const sim = haal();
  console.log(`Groep gemaakt (piratenmodus ${piraat ? "aan" : "uit"}).`);
  console.log(`  Meedoen:     ${SITE}/g/${sim.code}`);
  console.log(`  Host worden: ${SITE}/host/${sim.hostCode}`);
}
async function laad(code: string) {
  const o = await c.query(api.groepen.open, { token: HOST, code });
  if (o.soort !== "lid") throw new Error("De simulatiehost is geen lid van deze groep.");
  const boten = (await c.query(api.race.boten, { groep: o.groep.id, token: HOST })).map((b: { boot: string }) => b.boot);
  writeFileSync(BESTAND, JSON.stringify({ code, hostCode: o.groep.hostCode, groep: o.groep.id, boten } satisfies Sim, null, 2));
}
function haal(): Sim {
  if (!existsSync(BESTAND)) { console.error("Nog geen testgroep. Maak er eerst een: bun scripts/simulatie.ts groep"); process.exit(1); }
  return JSON.parse(readFileSync(BESTAND, "utf8"));
}
const sim = process.argv[2] === "groep" ? null : haal();
const SITE = process.env.SITE || "http://localhost:5173";
const G = () => ({ groep: sim!.groep, token: HOST });
const B = (b: string) => ({ groep: sim!.groep, token: token(b), boot: b });

async function claim(b: string) {
  const r = await c.mutation(api.groepen.wordLid, { token: token(b), code: sim!.code, spelerNaam: "Sim " + b });
  if (!r.ok) throw new Error(r.reden);
  const cl = await c.mutation(api.boot.claim, { ...B(b), overnemen: false });
  if (!cl.ok) throw new Error(`${b} is al in gebruik (gebruik eerst: reset)`);
  await c.mutation(api.boot.naam, { ...B(b), naam: "Sim " + b });
}

// Een pad van punten met de tijd waarop je er bent (snelheid in m/s)
function pad(pts: { lat: number; lng: number }[], v: number) {
  const afst = (a: typeof pts[0], b: typeof pts[0]) => Math.hypot((b.lat - a.lat) * 111320, (b.lng - a.lng) * 111320 * Math.cos(M.lat * Math.PI / 180));
  const uit = [{ ...pts[0], s: 0 }];
  for (let i = 1; i < pts.length; i++) uit.push({ ...pts[i], s: uit[i - 1].s + afst(pts[i - 1], pts[i]) / v });
  return uit;
}
function op(pd: ReturnType<typeof pad>, s: number) {
  if (s <= 0) return { ...pd[0], i: 0 };
  for (let i = 1; i < pd.length; i++) if (s <= pd[i].s) {
    const f = (s - pd[i - 1].s) / (pd[i].s - pd[i - 1].s);
    return { lat: pd[i - 1].lat + (pd[i].lat - pd[i - 1].lat) * f, lng: pd[i - 1].lng + (pd[i].lng - pd[i - 1].lng) * f, i: i - 1 };
  }
  return { ...pd[pd.length - 1], i: pd.length - 1 };
}

async function baan() {
  await c.mutation(api.host.baan, { ...G(), lines: { start: startLijn, finish: finishLijn }, marks: boeien });
  console.log("Baan uitgezet bij Toulon: startlijn, 2 boeien, finish.");
}

async function race(boten: string[], alleAkkoord: boolean) {
  await baan();
  for (const b of boten) await claim(b);
  const startOver = 70e3, tStart = Math.ceil((Date.now() + startOver) / 1000) * 1000;
  const id = await c.mutation(api.host.stelStartVoor, { ...G(), t: tStart, plan: { modus: "gelijk", gezet: Date.now() } });
  console.log("Startvoorstel om", new Date(tStart).toLocaleTimeString("nl-NL"));
  for (const b of boten) {
    const r = await c.mutation(api.boot.akkoord, { ...B(b), voorstelId: id });
    console.log(`${b} akkoord${r.vast ? " → start ligt vast" : ""}`);
  }
  if (!alleAkkoord) console.log("De overige boten moeten nog akkoord geven (op de tracker).");
  // Elke boot: vóór de lijn wachten, na het startsein over de lijn, langs de boeien, finish
  const snelheid: Record<string, number> = Object.fromEntries(sim!.boten.map((b, i) => [b, [8.5, 9.5, 10][i] ?? 9]));
  const paden = Object.fromEntries(boten.map((b, k) => {
    const x = -60 + k * 50;
    return [b, pad([p(x, -120), p(x, 20), p(boeien[0].lng > M.lng ? 20 : -20, 760), p(470, 350), p(x, -100)], snelheid[b] || 9)];
  }));
  const vertrek = tStart - 14000;      // 120 m voor de lijn bij ~9 m/s: net na het sein over de lijn
  const status: Record<string, { start?: boolean; boei: number; finish?: boolean }> = Object.fromEntries(boten.map((b) => [b, { boei: 0 }]));
  for (;;) {
    const nu = Date.now(), s = (nu - vertrek) / 1000;
    let klaar = true;
    for (const b of boten) {
      const pd = paden[b], q = op(pd, s), st = status[b];
      const koers = Math.atan2((pd[Math.min(q.i + 1, pd.length - 1)].lng - pd[q.i].lng) * Math.cos(M.lat * Math.PI / 180), pd[Math.min(q.i + 1, pd.length - 1)].lat - pd[q.i].lat) * 180 / Math.PI;
      await c.mutation(api.boot.positie, { ...B(b), spoor: true, lat: q.lat, lng: q.lng, ts: nu, acc: 5,
        speed: s > 0 && !st.finish ? snelheid[b] || 9 : 0, heading: (koers + 360) % 360 });
      if (!st.start && q.i >= 1 && nu >= tStart) { st.start = true; await c.mutation(api.boot.start, { ...B(b), ts: nu }); console.log(b, "over de startlijn"); }
      if (st.start && st.boei === 0 && q.i >= 2) { st.boei = 1; await c.mutation(api.boot.gerond, { ...B(b), id: "sim1", ts: nu }); console.log(b, "boei 1"); }
      if (st.start && st.boei === 1 && q.i >= 3) { st.boei = 2; await c.mutation(api.boot.gerond, { ...B(b), id: "sim2", ts: nu }); console.log(b, "boei 2"); }
      if (st.start && st.boei === 2 && !st.finish && q.i >= 4) { st.finish = true; await c.mutation(api.boot.finish, { ...B(b), ts: nu }); console.log(b, "finish!"); }
      if (!st.finish) klaar = false;
    }
    if (klaar) break;
    await wachten(2000);
  }
  console.log("Alle gesimuleerde boten zijn binnen.");
}

async function zeeslag(boten: string[]) {
  await c.mutation(api.groepen.instellingen, { ...G(), piraat: true });
  for (const b of boten) await claim(b).catch(() => {});
  await c.mutation(api.host.veld, { ...G(), veld: { ...M, r: 600 } });
  const start = Date.now() + 15000;
  await c.mutation(api.host.spelStart, { ...G(), start });
  console.log("Zeeslag begint over 15 s");
  const fase: Record<string, number> = Object.fromEntries(boten.map((b, k) => [b, k * 2.1]));
  let nr: Record<string, number> = Object.fromEntries(boten.map((b) => [b, 0]));
  for (let stap = 0; stap < 120; stap++) {
    const nu = Date.now();
    for (const b of boten) {
      const h = fase[b] + stap * 0.02, r = 250;
      const q = p(Math.sin(h) * r, Math.cos(h) * r), koers = ((h * 180 / Math.PI) + 90) % 360;
      await c.mutation(api.boot.positie, { ...B(b), spoor: true, lat: q.lat, lng: q.lng, ts: nu, acc: 5, speed: 4, heading: koers });
      if (nu > start + 5000 && stap % 25 === 0 && nr[b] < 10) {
        await c.mutation(api.spel.schot, { ...B(b), nr: String(nr[b]++), schot: { ts: nu, lat: q.lat, lng: q.lng, koers: Math.round(koers) % 360 } }).catch((e) => console.log(b, "schot:", e.message));
      }
    }
    await wachten(2000);
  }
  nr = {};
}

async function akkoord(boten: string[]) {
  const baan = await c.query(api.race.baan, G());
  if (!baan.voorstel) { console.log("Er staat geen startvoorstel."); return; }
  for (const b of boten) {
    await claim(b).catch(() => {});
    const r = await c.mutation(api.boot.akkoord, { ...B(b), voorstelId: baan.voorstel.id });
    console.log(`${b} akkoord${r.vast ? " → start ligt vast" : ""}`);
  }
}

async function reset() {
  await c.mutation(api.host.wisLive, G());
  await c.mutation(api.host.vrijgeven, G());
  await c.mutation(api.host.spelStop, { ...G(), wat: "wissen" });
  console.log("Live race gewist, boten vrijgegeven, zeeslag weg.");
}

const [opdracht, lijst] = process.argv.slice(2);
const boten = sim ? (lijst || "1,2").split(",").map((n) => sim.boten[+n - 1]).filter(Boolean) : [];
if (opdracht === "groep") await groep(lijst === "piraat");
else if (opdracht === "baan") await baan();
else if (opdracht === "race") await race(boten, boten.length === 3);
else if (opdracht === "akkoord") await akkoord(boten);
else if (opdracht === "zeeslag") await zeeslag(boten);
else if (opdracht === "reset") await reset();
else console.log("Gebruik: bun scripts/simulatie.ts groep [piraat] | baan | race [1,2] | akkoord [1,2] | zeeslag [1,2] | reset");
