import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { toegang } from "./lib/db";

const groepArgs = { groep: v.id("groepen"), token: v.string(), paginationOpts: paginationOptsValidator };
const leeg = { page: [], isDone: true, continueCursor: "" };

// Afgeronde races van de groep, oudste eerst (met sporen: de tab Uitslagen maakt er
// replays, polars en journaals van). Per pagina, want een race met sporen is al gauw
// een paar honderd kB: zo blijft elke query ruim binnen de limieten van Convex.
export const races = query({
  args: groepArgs,
  handler: async (ctx, { groep, token, paginationOpts }) => {
    if (!(await toegang(ctx, groep, token))) return leeg;
    const r = await ctx.db.query("uitslagen").withIndex("by_groep_and_nr", (q) => q.eq("groep", groep)).paginate(paginationOpts);
    return { ...r, page: r.page.map(({ _id, _creationTime, groep: _g, ...u }) => { void _id; void _creationTime; void _g; return u; }) };
  },
});

// Bewaarde zeeslagen, oudste eerst
export const zeeslagen = query({
  args: groepArgs,
  handler: async (ctx, { groep, token, paginationOpts }) => {
    if (!(await toegang(ctx, groep, token))) return leeg;
    const r = await ctx.db.query("zeeslagen").withIndex("by_groep_and_start", (q) => q.eq("groep", groep)).paginate(paginationOpts);
    return { ...r, page: r.page.map(({ _id, _creationTime, groep: _g, ...z }) => { void _id; void _creationTime; void _g; return z; }) };
  },
});
