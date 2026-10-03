// Onderhoud op de achtergrond (niet vanaf de site aan te roepen)
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { RACE_ID } from "./lib/config";

// Sporen van eerdere generaties (na race afronden of resetten) in porties weggooien
export const ruimSporenOp = internalMutation({
  args: { gen: v.number() },
  handler: async (ctx, { gen }) => {
    const oud = await ctx.db.query("spoorpunten")
      .withIndex("by_raceId_and_gen", (q) => q.eq("raceId", RACE_ID).lt("gen", gen))
      .take(1000);
    for (const p of oud) await ctx.db.delete("spoorpunten", p._id);
    if (oud.length === 1000) await ctx.scheduler.runAfter(0, internal.beheer.ruimSporenOp, { gen });
  },
});

// Verlopen sessies van de wedstrijdleiding opruimen
export const ruimSessiesOp = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const s of await ctx.db.query("sessies").take(500))
      if (s.verloopt < Date.now()) await ctx.db.delete("sessies", s._id);
  },
});
