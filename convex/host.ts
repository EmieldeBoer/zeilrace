// Wat hosts van een groep doen: de baan, correcties, race afronden of wissen, boten
// vrijgeven, het piratenspel en de uitslagen. Een start voorstellen (of intrekken)
// mag elk lid: iedereen die meevaart moet daarna toch akkoord geven.
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import {
  boeiIds, bootenVan, eisGetallen, eisHost, eisLid, eisPunt, fout, haalBoot, nieuweGeneratie, spelVoorSchrijven, tekstInvoer, wisLiveRace,
} from "./lib/db";
import { vBoei, vLijnen, vStartPlan, vUitslagVelden, vVeld, vZeeslagVelden, type StartPlan } from "./lib/validators";

const groepArgs = { groep: v.id("groepen"), token: v.string() };
const MAX_BOEIEN = 40;

// ---- Baan ----
export const baan = mutation({
  args: { ...groepArgs, lines: vLijnen, marks: v.array(vBoei) },
  handler: async (ctx, { groep, token, lines, marks }) => {
    const { groep: g } = await eisHost(ctx, groep, token);
    if (marks.length > MAX_BOEIEN) throw fout(`Hooguit ${MAX_BOEIEN} boeien.`);
    if (marks.some((b) => b.id != null && !/^[A-Za-z0-9-]{1,40}$/.test(b.id))) throw fout("Ongeldige boei.");
    marks.forEach(eisPunt);
    for (const l of [lines.start, lines.finish]) if (l) { eisPunt(l.a); eisPunt(l.b); }
    await ctx.db.patch("groepen", g._id, { lines, marks: marks.map((b) => ({ id: b.id, lat: b.lat, lng: b.lng })) });
  },
});

// ---- Start (elk lid) ----
// Elk lid mag een plan voorstellen: alleen boten van de groep, eindige getallen, twee lusboeien
function controleerPlan(plan: StartPlan, vloot: Set<string>) {
  eisGetallen(plan.gezet, plan.nm, plan.windKn);
  for (const r of [plan.verwacht, plan.vertraging]) if (r) for (const [b, x] of Object.entries(r)) {
    if (!vloot.has(b)) throw fout("Onbekende boot in het startplan.");
    eisGetallen(x);
    if (x < 0 || x > 7 * 24 * 3600e3) throw fout("Ongeldige tijd in het startplan.");
  }
  if (plan.lussen) for (const [b, l] of Object.entries(plan.lussen)) {
    if (!vloot.has(b)) throw fout("Onbekende boot in het startplan.");
    if (l.boeien.length > 2 || l.na.length > 40) throw fout("Ongeldige lus.");
    eisGetallen(l.extraM);
    l.boeien.forEach(eisPunt);
  }
}
export const stelStartVoor = mutation({
  args: { ...groepArgs, t: v.number(), plan: vStartPlan },
  returns: v.number(),
  handler: async (ctx, { groep, token, t, plan }) => {
    const { groep: g } = await eisLid(ctx, groep, token);
    if (g.raceStart != null) throw fout("De start ligt al vast. Rond eerst de race af of reset de live tijden.");
    eisGetallen(t);
    if (t < Date.now() + 60000) throw fout("Die starttijd ligt te dicht bij nu of in het verleden.");
    if (t > Date.now() + 24 * 3600e3) throw fout("Die starttijd ligt te ver weg.");
    controleerPlan(plan, new Set((await bootenVan(ctx, groep)).map((b) => b.boot)));
    const id = Math.floor(Math.random() * 2 ** 52);
    await ctx.db.patch("groepen", g._id, { voorstel: { id, t, plan } });
    for (const b of await bootenVan(ctx, groep)) if (b.akkoord != null) await ctx.db.patch("boten", b._id, { akkoord: undefined });
    return id;
  },
});
export const trekVoorstelIn = mutation({
  args: groepArgs,
  handler: async (ctx, { groep, token }) => {
    const { groep: g } = await eisLid(ctx, groep, token);
    if (g.raceStart != null) throw fout("De start ligt al vast.");
    await ctx.db.patch("groepen", g._id, { voorstel: undefined });
    for (const b of await bootenVan(ctx, groep)) if (b.akkoord != null) await ctx.db.patch("boten", b._id, { akkoord: undefined });
  },
});

// ---- Handmatige correctie van een boeironding (ts = null: terugdraaien) ----
export const gerond = mutation({
  args: { ...groepArgs, boot: v.string(), id: v.string(), ts: v.union(v.number(), v.null()) },
  handler: async (ctx, { groep, token, boot, id, ts }) => {
    const { groep: g } = await eisHost(ctx, groep, token);
    eisGetallen(ts);
    const b = await haalBoot(ctx, groep, boot);
    if (ts != null && !boeiIds(g, boot).has(id)) throw fout("Deze boei ligt niet (meer) in de baan.");
    const gerond = { ...b.gerond };
    if (ts == null) delete gerond[id]; else gerond[id] = ts;
    await ctx.db.patch("boten", b._id, { gerond });
  },
});

// ---- Race afronden: de uitslag (door het dashboard opgebouwd) opslaan en de live race wissen ----
const { nr: _nr, ...vUitslagZonderNr } = vUitslagVelden;
void _nr;
export const rondAf = mutation({
  args: { ...groepArgs, res: v.object(vUitslagZonderNr) },
  returns: v.number(),
  handler: async (ctx, { groep, token, res }) => {
    const { groep: g } = await eisHost(ctx, groep, token);
    const laatste = await ctx.db.query("uitslagen").withIndex("by_groep_and_nr", (q) => q.eq("groep", groep)).order("desc").first();
    const nr = (laatste?.nr ?? 0) + 1;
    // de boten zoals ze nu zijn: kleur en rating blijven bij de uitslag, ook als de vloot later verandert
    const boten = Object.fromEntries((await bootenVan(ctx, groep)).map((b) => [b.boot, { model: b.model, kleur: b.kleur, gph: b.gph, lengte: b.lengte }]));
    await ctx.db.insert("uitslagen", { groep, nr, ...res, boten });
    await wisLiveRace(ctx, g);
    return nr;
  },
});
export const wisLive = mutation({
  args: groepArgs,
  handler: async (ctx, { groep, token }) => {
    const { groep: g } = await eisHost(ctx, groep, token);
    await wisLiveRace(ctx, g);
  },
});
export const vrijgeven = mutation({
  args: groepArgs,
  handler: async (ctx, { groep, token }) => {
    await eisHost(ctx, groep, token);
    for (const b of await bootenVan(ctx, groep)) if (b.claim) await ctx.db.patch("boten", b._id, { claim: undefined });
  },
});

// ---- Uitslagen ----
async function uitslag(ctx: MutationCtx, groep: Id<"groepen">, nr: number) {
  const u = await ctx.db.query("uitslagen").withIndex("by_groep_and_nr", (q) => q.eq("groep", groep).eq("nr", nr)).unique();
  if (!u) throw fout(`Race ${nr} bestaat niet.`);
  return u;
}
export const uitslagWis = mutation({
  args: { ...groepArgs, nr: v.number() },
  handler: async (ctx, { groep, token, nr }) => {
    await eisHost(ctx, groep, token);
    await ctx.db.delete("uitslagen", (await uitslag(ctx, groep, nr))._id);
  },
});
export const uitslagNaam = mutation({
  args: { ...groepArgs, nr: v.number(), naam: v.string() },
  handler: async (ctx, { groep, token, nr, naam }) => {
    await eisHost(ctx, groep, token);
    await ctx.db.patch("uitslagen", (await uitslag(ctx, groep, nr))._id, { naam: tekstInvoer(naam, 60) || undefined });
  },
});
// Finish achteraf uit het spoor: tijden en uitslag aanpassen, het bewaarde journaal vervalt
export const uitslagFinish = mutation({
  args: {
    ...groepArgs, nr: v.number(),
    finishes: v.array(v.object({ boot: v.string(), finish: v.number(), elapsed: v.number(), corrected: v.number(), afstand: v.number() })),
  },
  handler: async (ctx, { groep, token, nr, finishes }) => {
    await eisHost(ctx, groep, token);
    const u = await uitslag(ctx, groep, nr);
    const tijden = { ...(u.tijden || {}) }, rijen = { ...u.uitslag };
    for (const f of finishes) {
      eisGetallen(f.finish, f.elapsed, f.corrected, f.afstand);
      if (!tijden[f.boot] || tijden[f.boot].start == null) throw fout("Deze boot was niet gestart in die race.");
      tijden[f.boot] = { ...tijden[f.boot], finish: f.finish };
      rijen[f.boot] = { gefinisht: true, elapsed: f.elapsed, corrected: f.corrected, afstand: f.afstand };
    }
    await ctx.db.patch("uitslagen", u._id, { tijden, uitslag: rijen, journaal: undefined });
  },
});

// ---- Het piratenspel (alleen in piratenmodus) ----
async function piraatHost(ctx: MutationCtx, groep: Id<"groepen">, token: string): Promise<Doc<"groepen">> {
  const { groep: g } = await eisHost(ctx, groep, token);
  if (!g.piraat) throw fout("Zet eerst de piratenmodus aan (Groep → Instellingen).");
  return g;
}
export const veld = mutation({
  args: { ...groepArgs, veld: v.union(vVeld, v.null()) },
  handler: async (ctx, { groep, token, veld }) => {
    await piraatHost(ctx, groep, token);
    if (veld && !(veld.r > 0 && veld.r <= 100000)) throw fout("Ongeldige straal.");
    if (veld) eisPunt(veld);
    const s = await spelVoorSchrijven(ctx, groep);
    await ctx.db.patch("spel", s._id, { veld: veld ?? undefined });
  },
});
const leegSpel = { eind: undefined, schoten: undefined, straf: undefined, buit: undefined, mijnen: undefined, mijnraak: undefined };
export const spelStart = mutation({
  args: { ...groepArgs, start: v.number() },
  handler: async (ctx, { groep, token, start }) => {
    await piraatHost(ctx, groep, token);
    if (!(start > Date.now() - 60000 && start < Date.now() + 3600e3)) throw fout("Ongeldig begin van de zeeslag.");
    const s = await spelVoorSchrijven(ctx, groep);
    await ctx.db.patch("spel", s._id, { start, ...leegSpel });
  },
});
// Aftellen stoppen (start weg), de zeeslag beëindigen (eind = nu) of de uitslag van het scherm halen
export const spelStop = mutation({
  args: { ...groepArgs, wat: v.union(v.literal("aftellen"), v.literal("einde"), v.literal("wissen")) },
  handler: async (ctx, { groep, token, wat }) => {
    await eisHost(ctx, groep, token);
    const s = await spelVoorSchrijven(ctx, groep);
    if (wat === "aftellen") await ctx.db.patch("spel", s._id, { start: undefined });
    else if (wat === "einde") await ctx.db.patch("spel", s._id, { eind: Date.now() });
    else await ctx.db.patch("spel", s._id, { start: undefined, ...leegSpel });
  },
});
// Een afgelopen zeeslag bewaren (sleutel = het begin). Geen race bezig? Dan waren de
// sporen alleen voor de zeeslag en worden ze opgeruimd.
export const zeeslagOpslaan = mutation({
  args: { ...groepArgs, z: v.object(vZeeslagVelden) },
  returns: v.boolean(),
  handler: async (ctx, { groep, token, z }) => {
    const { groep: g } = await eisHost(ctx, groep, token);
    const al = await ctx.db.query("zeeslagen").withIndex("by_groep_and_start", (q) => q.eq("groep", groep).eq("start", z.start)).first();
    if (al) return false;
    await ctx.db.insert("zeeslagen", { groep, ...z });
    if (g.raceStart == null) await nieuweGeneratie(ctx, g);
    return true;
  },
});
export const zeeslagWis = mutation({
  args: { ...groepArgs, start: v.number() },
  handler: async (ctx, { groep, token, start }) => {
    await eisHost(ctx, groep, token);
    const z = await ctx.db.query("zeeslagen").withIndex("by_groep_and_start", (q) => q.eq("groep", groep).eq("start", start)).first();
    if (z) await ctx.db.delete("zeeslagen", z._id);
  },
});
