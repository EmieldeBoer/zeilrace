import { v } from "convex/values";
import { query } from "./_generated/server";
import { alleBoten, haalRace, haalSpel } from "./lib/db";
import { RACE_ID } from "./lib/config";

// De baan, de start en het startvoorstel
export const baan = query({
  args: {},
  handler: async (ctx) => {
    const r = await haalRace(ctx);
    return {
      lines: r?.lines ?? {},
      marks: r?.marks ?? [],
      raceStart: r?.raceStart ?? null,
      startPlan: r?.startPlan ?? null,
      voorstel: r?.voorstel ?? null,
      gen: r?.gen ?? 0,
    };
  },
});

// Per boot: teamnaam, tijden, rondingen, akkoord en of hij in gebruik is
// (het toesteltoken zelf blijft geheim)
export const boten = query({
  args: {},
  handler: async (ctx) => {
    const uit: Record<string, {
      naam: string | null; start: number | null; finish: number | null;
      gerond: Record<string, number>; akkoord: number | null; geclaimd: boolean;
    }> = {};
    for (const b of await alleBoten(ctx)) {
      uit[b.boot] = { naam: b.naam ?? null, start: b.start ?? null, finish: b.finish ?? null,
        gerond: b.gerond, akkoord: b.akkoord ?? null, geclaimd: !!b.claim };
    }
    return uit;
  },
});

// De laatste positie van elke boot
export const posities = query({
  args: {},
  handler: async (ctx) => {
    const rijen = await ctx.db.query("posities").withIndex("by_raceId_and_boot", (q) => q.eq("raceId", RACE_ID)).take(50);
    const uit: Record<string, { lat: number; lng: number; ts: number; acc?: number; speed?: number; heading?: number }> = {};
    for (const p of rijen) uit[p.boot] = { lat: p.lat, lng: p.lng, ts: p.ts, acc: p.acc, speed: p.speed, heading: p.heading };
    return uit;
  },
});

// Het piratenspel
export const spel = query({
  args: {},
  handler: async (ctx) => {
    const s = await haalSpel(ctx);
    if (!s) return null;
    const { _id, _creationTime, raceId, ...data } = s;
    void _id; void _creationTime; void raceId;
    return data;
  },
});

// ---- Sporen ----
// Een spoorpunt gaat als [boot, lat, lng, ts, aanmaaktijd] over de lijn (compact).
// Eerst haalt de site alle punten op in pagina's, daarna alleen wat er nieuw bijkomt.
const spoorTupel = v.array(v.union(v.string(), v.number()));
export const sporenPagina = query({
  args: { gen: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ punten: v.array(spoorTupel), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { gen, cursor }) => {
    const r = await ctx.db.query("spoorpunten")
      .withIndex("by_raceId_and_gen", (q) => q.eq("raceId", RACE_ID).eq("gen", gen))
      .paginate({ numItems: 4000, cursor });
    return { punten: r.page.map((p) => [p.boot, p.lat, p.lng, p.ts, p._creationTime]), isDone: r.isDone, continueCursor: r.continueCursor };
  },
});
export const sporenSinds = query({
  args: { gen: v.number(), na: v.number() },
  returns: v.array(spoorTupel),
  handler: async (ctx, { gen, na }) => {
    const rijen = await ctx.db.query("spoorpunten")
      .withIndex("by_raceId_and_gen", (q) => q.eq("raceId", RACE_ID).eq("gen", gen).gt("_creationTime", na))
      .take(4000);
    return rijen.map((p) => [p.boot, p.lat, p.lng, p.ts, p._creationTime]);
  },
});
