// Onderhoud en import (niet vanaf de site aan te roepen; wel met `bunx convex run`)
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { MAX_BOTEN } from "./lib/config";
import { fout, nieuweCode } from "./lib/db";
import { vBoei, vBootSnapshot, vLijnen, vQuote, vUitslagVelden, vZeeslagVelden } from "./lib/validators";

// Sporen van eerdere generaties (na race afronden of resetten) in porties weggooien
export const ruimSporenOp = internalMutation({
  args: { groep: v.id("groepen"), gen: v.number() },
  handler: async (ctx, { groep, gen }) => {
    const oud = await ctx.db.query("spoorpunten")
      .withIndex("by_groep_and_gen", (q) => q.eq("groep", groep).lt("gen", gen))
      .take(1000);
    for (const p of oud) await ctx.db.delete("spoorpunten", p._id);
    if (oud.length === 1000) await ctx.scheduler.runAfter(0, internal.beheer.ruimSporenOp, { groep, gen });
  },
});

// ---- Import van de oude Firebase-site (scripts/importeer-firebase.ts) ----
// Maakt een groep zonder leden. Open daarna de hostlink om er host van te worden.
export const importeerGroep = internalMutation({
  args: {
    naam: v.string(), piraat: v.boolean(),
    boten: v.array(v.object({ boot: v.string(), ...vBootSnapshot.fields })),
    quotes: v.optional(v.array(vQuote)), lines: v.optional(vLijnen), marks: v.optional(v.array(vBoei)),
  },
  returns: v.object({ code: v.string(), hostCode: v.string() }),
  handler: async (ctx, a) => {
    if (!a.boten.length || a.boten.length > MAX_BOTEN) throw fout(`Tussen 1 en ${MAX_BOTEN} boten.`);
    const code = nieuweCode(8), hostCode = nieuweCode(20);
    const groep = await ctx.db.insert("groepen", { naam: a.naam, code, hostCode, piraat: a.piraat, lines: a.lines ?? {}, marks: a.marks ?? [],
      gen: Date.now(), quotes: a.quotes });
    for (const [i, b] of a.boten.entries())
      await ctx.db.insert("boten", { groep, boot: b.boot, model: b.model, kleur: b.kleur, gph: b.gph, lengte: b.lengte, volgorde: i, gerond: {} });
    return { code, hostCode };
  },
});
export const importeerUitslag = internalMutation({
  args: { code: v.string(), uitslag: v.object({ ...vUitslagVelden, boten: v.optional(v.record(v.string(), vBootSnapshot)) }) },
  handler: async (ctx, { code, uitslag }) => {
    const g = await ctx.db.query("groepen").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!g) throw fout("Groep niet gevonden.");
    const al = await ctx.db.query("uitslagen").withIndex("by_groep_and_nr", (q) => q.eq("groep", g._id).eq("nr", uitslag.nr)).first();
    if (al) throw fout(`Race ${uitslag.nr} staat al in deze groep.`);
    await ctx.db.insert("uitslagen", { groep: g._id, ...uitslag });
  },
});
export const importeerZeeslag = internalMutation({
  args: { code: v.string(), zeeslag: v.object(vZeeslagVelden) },
  handler: async (ctx, { code, zeeslag }) => {
    const g = await ctx.db.query("groepen").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!g) throw fout("Groep niet gevonden.");
    const al = await ctx.db.query("zeeslagen").withIndex("by_groep_and_start", (q) => q.eq("groep", g._id).eq("start", zeeslag.start)).first();
    if (al) throw fout("Deze zeeslag staat al in deze groep.");
    await ctx.db.insert("zeeslagen", { groep: g._id, ...zeeslag });
  },
});
