// Wat de site leest van de live race van een groep. Alleen voor leden: wie geen lid
// is, krijgt null terug (en de site toont dan het meedoen-scherm).
import { v } from "convex/values";
import { query } from "./_generated/server";
import { bootenVan, haalSpel, toegang } from "./lib/db";

const groepArgs = { groep: v.id("groepen"), token: v.string() };

// De baan, de start en het startvoorstel
export const baan = query({
  args: groepArgs,
  handler: async (ctx, { groep, token }) => {
    const t = await toegang(ctx, groep, token);
    if (!t) return null;
    const g = t.groep;
    return { lines: g.lines, marks: g.marks, raceStart: g.raceStart ?? null, startPlan: g.startPlan ?? null,
      voorstel: g.voorstel ?? null, gen: g.gen, quotes: g.quotes ?? [] };
  },
});

// De vloot: wat de host instelde en de live toestand per boot. Wie de boot gebruikt,
// staat er als naam bij (en vanMij voor het eigen toestel); de toestel-id's blijven op de server.
export const boten = query({
  args: groepArgs,
  handler: async (ctx, { groep, token }) => {
    const t = await toegang(ctx, groep, token);
    if (!t) return null;
    const namen = new Map<string, string | null>();
    const uit = [];
    for (const b of await bootenVan(ctx, groep)) {
      let claimNaam: string | null = null;
      if (b.claim) {
        if (!namen.has(b.claim)) namen.set(b.claim, (await ctx.db.get("spelers", b.claim))?.naam ?? null);
        claimNaam = namen.get(b.claim) ?? "iemand";
      }
      uit.push({ boot: b.boot, model: b.model, kleur: b.kleur, gph: b.gph, lengte: b.lengte,
        naam: b.naam ?? null, start: b.start ?? null, finish: b.finish ?? null, gerond: b.gerond, akkoord: b.akkoord ?? null,
        geclaimd: !!b.claim, vanMij: b.claim === t.speler._id, claimNaam });
    }
    return uit;
  },
});

// De laatste positie van elke boot
export const posities = query({
  args: groepArgs,
  handler: async (ctx, { groep, token }) => {
    if (!(await toegang(ctx, groep, token))) return null;
    const rijen = await ctx.db.query("posities").withIndex("by_groep_and_boot", (q) => q.eq("groep", groep)).take(50);
    const uit: Record<string, { lat: number; lng: number; ts: number; acc?: number; speed?: number; heading?: number }> = {};
    for (const p of rijen) uit[p.boot] = { lat: p.lat, lng: p.lng, ts: p.ts, acc: p.acc, speed: p.speed, heading: p.heading };
    return uit;
  },
});

// Het piratenspel (alleen in piratenmodus)
export const spel = query({
  args: groepArgs,
  handler: async (ctx, { groep, token }) => {
    const t = await toegang(ctx, groep, token);
    if (!t || !t.groep.piraat) return null;
    const s = await haalSpel(ctx, groep);
    if (!s) return null;
    const { _id, _creationTime, groep: _g, ...data } = s;
    void _id; void _creationTime; void _g;
    return data;
  },
});

// ---- Sporen ----
// Een spoorpunt gaat als [boot, lat, lng, ts, aanmaaktijd] over de lijn (compact).
// Eerst haalt de site alle punten op in pagina's, daarna alleen wat er nieuw bijkomt.
const spoorTupel = v.array(v.union(v.string(), v.number()));
export const sporenPagina = query({
  args: { ...groepArgs, gen: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ punten: v.array(spoorTupel), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { groep, token, gen, cursor }) => {
    if (!(await toegang(ctx, groep, token))) return { punten: [], isDone: true, continueCursor: "" };
    const r = await ctx.db.query("spoorpunten")
      .withIndex("by_groep_and_gen", (q) => q.eq("groep", groep).eq("gen", gen))
      .paginate({ numItems: 4000, cursor });
    return { punten: r.page.map((p) => [p.boot, p.lat, p.lng, p.ts, p._creationTime]), isDone: r.isDone, continueCursor: r.continueCursor };
  },
});
export const sporenSinds = query({
  args: { ...groepArgs, gen: v.number(), na: v.number() },
  returns: v.array(spoorTupel),
  handler: async (ctx, { groep, token, gen, na }) => {
    if (!(await toegang(ctx, groep, token))) return [];
    const rijen = await ctx.db.query("spoorpunten")
      .withIndex("by_groep_and_gen", (q) => q.eq("groep", groep).eq("gen", gen).gt("_creationTime", na))
      .take(4000);
    return rijen.map((p) => [p.boot, p.lat, p.lng, p.ts, p._creationTime]);
  },
});
