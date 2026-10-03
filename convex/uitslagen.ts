import { query } from "./_generated/server";
import { RACE_ID } from "./lib/config";

// Afgeronde races, oudste eerst (met sporen: de tab Uitslagen maakt er replays, polars en journaals van)
export const races = query({
  args: {},
  handler: async (ctx) => {
    const rijen = await ctx.db.query("uitslagen").withIndex("by_raceId_and_nr", (q) => q.eq("raceId", RACE_ID)).take(200);
    return rijen.map(({ _id, _creationTime, raceId, ...u }) => { void _id; void _creationTime; void raceId; return u; });
  },
});

// Bewaarde zeeslagen, oudste eerst
export const zeeslagen = query({
  args: {},
  handler: async (ctx) => {
    const rijen = await ctx.db.query("zeeslagen").withIndex("by_raceId_and_start", (q) => q.eq("raceId", RACE_ID)).take(200);
    return rijen.map(({ _id, _creationTime, raceId, ...z }) => { void _id; void _creationTime; void raceId; return z; });
  },
});
