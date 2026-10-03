// De wedstrijdleiding: inloggen met het wachtwoord (WL_WACHTWOORD op de
// Convex-deployment) en daarna alles wat alleen de wedstrijdleiding mag:
// baan, startvoorstel, correcties, race afronden, zeeslagen en uitslagen.
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { env, mutation, query } from "./_generated/server";
import { RACE_ID } from "./lib/config";
import {
  alleBoten, bootVoorSchrijven, eisWl, fout, haalRace, nieuweGeneratie, raceVoorSchrijven, spelVoorSchrijven, wisLiveRace,
} from "./lib/db";
import { vBoei, vLijnen, vStartPlan, vUitslagVelden, vVeld, vZeeslagVelden } from "./lib/validators";

const SESSIE_MS = 30 * 24 * HOUR;
const limiet = new RateLimiter(components.rateLimiter, {
  inloggen: { kind: "token bucket", rate: 10, period: 10 * MINUTE, capacity: 10 },
});

// Gelijke-tijdvergelijking, zodat de duur van het vergelijken niets verraadt
function gelijk(a: string, b: string): boolean {
  let x = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) x |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return x === 0;
}
function nieuwToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export const login = mutation({
  args: { wachtwoord: v.string() },
  returns: v.union(v.object({ ok: v.literal(true), token: v.string(), verloopt: v.number() }), v.object({ ok: v.literal(false), reden: v.string() })),
  handler: async (ctx, { wachtwoord }) => {
    const goed = env.WL_WACHTWOORD;
    if (!goed) return { ok: false as const, reden: "Er is nog geen wachtwoord ingesteld: bunx convex env set WL_WACHTWOORD … (zie README)." };
    // Een fout wachtwoord gooit geen fout, anders telt de poging niet mee voor de limiet
    const { ok } = await limiet.limit(ctx, "inloggen");
    if (!ok) return { ok: false as const, reden: "Te veel pogingen. Wacht even en probeer het opnieuw." };
    if (!gelijk(wachtwoord, goed)) return { ok: false as const, reden: "Onjuist wachtwoord." };
    const token = nieuwToken(), verloopt = Date.now() + SESSIE_MS;
    await ctx.db.insert("sessies", { token, verloopt });
    return { ok: true as const, token, verloopt };
  },
});

export const uitloggen = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db.query("sessies").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (s) await ctx.db.delete("sessies", s._id);
  },
});

// Hoort dit token bij een sessie? (de site vergelijkt 'verloopt' zelf met de klok)
export const sessie = query({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ verloopt: v.number() })),
  handler: async (ctx, { token }) => {
    const s = await ctx.db.query("sessies").withIndex("by_token", (q) => q.eq("token", token)).unique();
    return s ? { verloopt: s.verloopt } : null;
  },
});

// ---- Baan ----
export const baan = mutation({
  args: { token: v.string(), lines: vLijnen, marks: v.array(vBoei) },
  handler: async (ctx, { token, lines, marks }) => {
    await eisWl(ctx, token);
    const race = await raceVoorSchrijven(ctx);
    await ctx.db.patch("wedstrijden", race._id, { lines, marks: marks.map((b) => ({ id: b.id, lat: b.lat, lng: b.lng })) });
  },
});

// ---- Start ----
export const stelStartVoor = mutation({
  args: { token: v.string(), t: v.number(), plan: vStartPlan },
  returns: v.number(),
  handler: async (ctx, { token, t, plan }) => {
    await eisWl(ctx, token);
    const race = await raceVoorSchrijven(ctx);
    if (race.raceStart != null) throw fout("De start ligt al vast. Rond eerst de race af of reset de live tijden.");
    if (t < Date.now() + 60000) throw fout("Die starttijd ligt te dicht bij nu of in het verleden.");
    const id = Date.now();
    await ctx.db.patch("wedstrijden", race._id, { voorstel: { id, t, plan } });
    for (const b of await alleBoten(ctx)) if (b.akkoord != null) await ctx.db.patch("boten", b._id, { akkoord: undefined });
    return id;
  },
});
export const trekVoorstelIn = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await eisWl(ctx, token);
    const race = await raceVoorSchrijven(ctx);
    if (race.raceStart != null) throw fout("De start ligt al vast.");
    await ctx.db.patch("wedstrijden", race._id, { voorstel: undefined });
    for (const b of await alleBoten(ctx)) if (b.akkoord != null) await ctx.db.patch("boten", b._id, { akkoord: undefined });
  },
});

// ---- Handmatige correctie van een boeironding (ts = null: terugdraaien) ----
export const gerond = mutation({
  args: { token: v.string(), boot: v.string(), id: v.string(), ts: v.union(v.number(), v.null()) },
  handler: async (ctx, { token, boot, id, ts }) => {
    await eisWl(ctx, token);
    const b = await bootVoorSchrijven(ctx, boot);
    const gerond = { ...b.gerond };
    if (ts == null) delete gerond[id]; else gerond[id] = ts;
    await ctx.db.patch("boten", b._id, { gerond });
  },
});

// ---- Race afronden: de uitslag (door het dashboard opgebouwd) opslaan en de live race wissen ----
const { nr: _nr, ...vUitslagZonderNr } = vUitslagVelden;
void _nr;
export const rondAf = mutation({
  args: { token: v.string(), res: v.object(vUitslagZonderNr) },
  returns: v.number(),
  handler: async (ctx, { token, res }) => {
    await eisWl(ctx, token);
    const laatste = await ctx.db.query("uitslagen").withIndex("by_raceId_and_nr", (q) => q.eq("raceId", RACE_ID)).order("desc").first();
    const nr = (laatste?.nr ?? 0) + 1;
    await ctx.db.insert("uitslagen", { raceId: RACE_ID, nr, ...res });
    await wisLiveRace(ctx);
    return nr;
  },
});
export const wisLive = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await eisWl(ctx, token);
    await wisLiveRace(ctx);
  },
});
export const vrijgeven = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await eisWl(ctx, token);
    for (const b of await alleBoten(ctx)) if (b.claim) await ctx.db.patch("boten", b._id, { claim: undefined });
  },
});

// ---- Uitslagen ----
async function uitslag(ctx: Parameters<typeof eisWl>[0], nr: number) {
  const u = await ctx.db.query("uitslagen").withIndex("by_raceId_and_nr", (q) => q.eq("raceId", RACE_ID).eq("nr", nr)).unique();
  if (!u) throw fout(`Race ${nr} bestaat niet.`);
  return u;
}
export const uitslagWis = mutation({
  args: { token: v.string(), nr: v.number() },
  handler: async (ctx, { token, nr }) => {
    await eisWl(ctx, token);
    await ctx.db.delete("uitslagen", (await uitslag(ctx, nr))._id);
  },
});
export const uitslagNaam = mutation({
  args: { token: v.string(), nr: v.number(), naam: v.string() },
  handler: async (ctx, { token, nr, naam }) => {
    await eisWl(ctx, token);
    await ctx.db.patch("uitslagen", (await uitslag(ctx, nr))._id, { naam: naam.trim().slice(0, 60) || undefined });
  },
});
// Finish achteraf uit het spoor: tijden en uitslag aanpassen, het bewaarde journaal vervalt
export const uitslagFinish = mutation({
  args: {
    token: v.string(), nr: v.number(),
    finishes: v.array(v.object({ boot: v.string(), finish: v.number(), elapsed: v.number(), corrected: v.number(), afstand: v.number() })),
  },
  handler: async (ctx, { token, nr, finishes }) => {
    await eisWl(ctx, token);
    const u = await uitslag(ctx, nr);
    const tijden = { ...(u.tijden || {}) }, rijen = { ...u.uitslag };
    for (const f of finishes) {
      tijden[f.boot] = { ...(tijden[f.boot] || {}), finish: f.finish };
      rijen[f.boot] = { gefinisht: true, elapsed: f.elapsed, corrected: f.corrected, afstand: f.afstand };
    }
    await ctx.db.patch("uitslagen", u._id, { tijden, uitslag: rijen, journaal: undefined });
  },
});

// ---- Het piratenspel ----
export const veld = mutation({
  args: { token: v.string(), veld: v.union(vVeld, v.null()) },
  handler: async (ctx, { token, veld }) => {
    await eisWl(ctx, token);
    if (veld && !(veld.r > 0 && veld.r <= 100000)) throw fout("Ongeldige straal.");
    const s = await spelVoorSchrijven(ctx);
    await ctx.db.patch("spel", s._id, { veld: veld ?? undefined });
  },
});
const leegSpel = { eind: undefined, schoten: undefined, straf: undefined, buit: undefined, mijnen: undefined, mijnraak: undefined };
export const spelStart = mutation({
  args: { token: v.string(), start: v.number() },
  handler: async (ctx, { token, start }) => {
    await eisWl(ctx, token);
    const s = await spelVoorSchrijven(ctx);
    await ctx.db.patch("spel", s._id, { start, ...leegSpel });
  },
});
// Aftellen stoppen (start weg), de zeeslag beëindigen (eind = nu) of de uitslag van het scherm halen
export const spelStop = mutation({
  args: { token: v.string(), wat: v.union(v.literal("aftellen"), v.literal("einde"), v.literal("wissen")) },
  handler: async (ctx, { token, wat }) => {
    await eisWl(ctx, token);
    const s = await spelVoorSchrijven(ctx);
    if (wat === "aftellen") await ctx.db.patch("spel", s._id, { start: undefined });
    else if (wat === "einde") await ctx.db.patch("spel", s._id, { eind: Date.now() });
    else await ctx.db.patch("spel", s._id, { start: undefined, ...leegSpel });
  },
});
// Een afgelopen zeeslag bewaren (sleutel = het begin). Geen race bezig? Dan waren de
// sporen alleen voor de zeeslag en worden ze opgeruimd.
export const zeeslagOpslaan = mutation({
  args: { token: v.string(), z: v.object(vZeeslagVelden) },
  returns: v.boolean(),
  handler: async (ctx, { token, z }) => {
    await eisWl(ctx, token);
    const al = await ctx.db.query("zeeslagen").withIndex("by_raceId_and_start", (q) => q.eq("raceId", RACE_ID).eq("start", z.start)).first();
    if (al) return false;
    await ctx.db.insert("zeeslagen", { raceId: RACE_ID, ...z });
    const race = await haalRace(ctx);
    if (race && race.raceStart == null) await nieuweGeneratie(ctx);
    return true;
  },
});
export const zeeslagWis = mutation({
  args: { token: v.string(), start: v.number() },
  handler: async (ctx, { token, start }) => {
    await eisWl(ctx, token);
    const z = await ctx.db.query("zeeslagen").withIndex("by_raceId_and_start", (q) => q.eq("raceId", RACE_ID).eq("start", start)).first();
    if (z) await ctx.db.delete("zeeslagen", z._id);
  },
});
