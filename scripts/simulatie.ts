// ============================================================
//  Simulatie voor lokaal testen: een baan, boten die hem varen, een
//  startvoorstel met akkoord, en een zeeslag. Alleen tegen de lokale
//  Convex-backend (bun run dev), nooit tegen de echte race.
//
//    bun scripts/simulatie.ts baan                 baan uitzetten
//    bun scripts/simulatie.ts race [boten]         start voorstellen, akkoord, varen (standaard SO389,SO469)
//    bun scripts/simulatie.ts akkoord [boten]      akkoord geven op het huidige startvoorstel
//    bun scripts/simulatie.ts zeeslag [boten]      speelveld + zeeslag, boten varen rond en schieten
//    bun scripts/simulatie.ts reset                live race wissen, boten vrijgeven
//  Wachtwoord van de wedstrijdleiding: WL_WACHTWOORD (standaard test1234).
// ============================================================
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { readFileSync } from "node:fs";

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

async function wl() {
  const r = await c.mutation(api.wl.login, { wachtwoord: process.env.WL_WACHTWOORD || "test1234" });
  if (!r.ok) throw new Error(r.reden);
  return r.token as string;
}
const token = (b: string) => `simulatie-toestel-${b}-0123456789`;
async function claim(b: string) {
  const r = await c.mutation(api.boot.claim, { boot: b, token: token(b) });
  if (!r.ok) throw new Error(`${b} is al geclaimd (gebruik eerst: reset)`);
  await c.mutation(api.boot.naam, { boot: b, token: token(b), naam: "Sim " + b });
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
  const t = await wl();
  await c.mutation(api.wl.baan, { token: t, lines: { start: startLijn, finish: finishLijn }, marks: boeien });
  console.log("Baan uitgezet bij Toulon: startlijn, 2 boeien, finish.");
}

async function race(boten: string[], alleAkkoord: boolean) {
  const t = await wl();
  await baan();
  for (const b of boten) await claim(b);
  const startOver = 70e3, tStart = Math.ceil((Date.now() + startOver) / 1000) * 1000;
  const id = await c.mutation(api.wl.stelStartVoor, { token: t, t: tStart, plan: { modus: "gelijk", gezet: Date.now() } });
  console.log("Startvoorstel om", new Date(tStart).toLocaleTimeString("nl-NL"));
  for (const b of boten) {
    const r = await c.mutation(api.boot.akkoord, { boot: b, token: token(b), voorstelId: id });
    console.log(`${b} akkoord${r.vast ? " → start ligt vast" : ""}`);
  }
  if (!alleAkkoord) console.log("De overige boten moeten nog akkoord geven (op de tracker).");
  // Elke boot: vóór de lijn wachten, na het startsein over de lijn, langs de boeien, finish
  const snelheid: Record<string, number> = { SO389: 8.5, SO469: 9.5, SO519: 10 };
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
      await c.mutation(api.boot.positie, { boot: b, token: token(b), spoor: true, lat: q.lat, lng: q.lng, ts: nu, acc: 5,
        speed: s > 0 && !st.finish ? snelheid[b] || 9 : 0, heading: (koers + 360) % 360 });
      if (!st.start && q.i >= 1 && nu >= tStart) { st.start = true; await c.mutation(api.boot.start, { boot: b, token: token(b), ts: nu }); console.log(b, "over de startlijn"); }
      if (st.start && st.boei === 0 && q.i >= 2) { st.boei = 1; await c.mutation(api.boot.gerond, { boot: b, token: token(b), id: "sim1", ts: nu }); console.log(b, "boei 1"); }
      if (st.start && st.boei === 1 && q.i >= 3) { st.boei = 2; await c.mutation(api.boot.gerond, { boot: b, token: token(b), id: "sim2", ts: nu }); console.log(b, "boei 2"); }
      if (st.start && st.boei === 2 && !st.finish && q.i >= 4) { st.finish = true; await c.mutation(api.boot.finish, { boot: b, token: token(b), ts: nu }); console.log(b, "finish!"); }
      if (!st.finish) klaar = false;
    }
    if (klaar) break;
    await wachten(2000);
  }
  console.log("Alle gesimuleerde boten zijn binnen.");
}

async function zeeslag(boten: string[]) {
  const t = await wl();
  for (const b of boten) await claim(b).catch(() => {});
  await c.mutation(api.wl.veld, { token: t, veld: { ...M, r: 600 } });
  const start = Date.now() + 15000;
  await c.mutation(api.wl.spelStart, { token: t, start });
  console.log("Zeeslag begint over 15 s");
  const fase: Record<string, number> = Object.fromEntries(boten.map((b, k) => [b, k * 2.1]));
  let nr: Record<string, number> = Object.fromEntries(boten.map((b) => [b, 0]));
  for (let stap = 0; stap < 120; stap++) {
    const nu = Date.now();
    for (const b of boten) {
      const h = fase[b] + stap * 0.02, r = 250;
      const q = p(Math.sin(h) * r, Math.cos(h) * r), koers = ((h * 180 / Math.PI) + 90) % 360;
      await c.mutation(api.boot.positie, { boot: b, token: token(b), spoor: true, lat: q.lat, lng: q.lng, ts: nu, acc: 5, speed: 4, heading: koers });
      if (nu > start + 5000 && stap % 25 === 0 && nr[b] < 10) {
        await c.mutation(api.spel.schot, { boot: b, token: token(b), nr: String(nr[b]++), schot: { ts: nu, lat: q.lat, lng: q.lng, koers: Math.round(koers) % 360 } }).catch((e) => console.log(b, "schot:", e.message));
      }
    }
    await wachten(2000);
  }
  nr = {};
}

async function akkoord(boten: string[]) {
  const baan = await c.query(api.race.baan, {});
  if (!baan.voorstel) { console.log("Er staat geen startvoorstel."); return; }
  for (const b of boten) {
    await claim(b).catch(() => {});
    const r = await c.mutation(api.boot.akkoord, { boot: b, token: token(b), voorstelId: baan.voorstel.id });
    console.log(`${b} akkoord${r.vast ? " → start ligt vast" : ""}`);
  }
}

async function reset() {
  const t = await wl();
  await c.mutation(api.wl.wisLive, { token: t });
  await c.mutation(api.wl.vrijgeven, { token: t });
  await c.mutation(api.wl.spelStop, { token: t, wat: "wissen" });
  console.log("Live race gewist, boten vrijgegeven, zeeslag weg.");
}

const [opdracht, lijst] = process.argv.slice(2);
const boten = (lijst || "SO389,SO469").split(",");
if (opdracht === "baan") await baan();
else if (opdracht === "race") await race(boten, boten.length === 3);
else if (opdracht === "akkoord") await akkoord(boten);
else if (opdracht === "zeeslag") await zeeslag(boten);
else if (opdracht === "reset") await reset();
else console.log("Gebruik: bun scripts/simulatie.ts baan | race [SO389,SO469] | akkoord [SO389,SO469] | zeeslag [SO389,SO469] | reset");
