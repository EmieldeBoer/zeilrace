import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { RACE_ID, isBoot } from "./config";

export const fout = (tekst: string) => new ConvexError(tekst);

// --- De race (baan, start) -------------------------------------
export async function haalRace(ctx: QueryCtx): Promise<Doc<"wedstrijden"> | null> {
  return ctx.db.query("wedstrijden").withIndex("by_raceId", (q) => q.eq("raceId", RACE_ID)).unique();
}
export async function raceVoorSchrijven(ctx: MutationCtx): Promise<Doc<"wedstrijden">> {
  const r = await haalRace(ctx);
  if (r) return r;
  const id = await ctx.db.insert("wedstrijden", { raceId: RACE_ID, lines: {}, marks: [], gen: Date.now() });
  return (await ctx.db.get("wedstrijden", id))!;
}

// --- Boten -------------------------------------------------------
export async function haalBoot(ctx: QueryCtx, boot: string): Promise<Doc<"boten"> | null> {
  return ctx.db.query("boten").withIndex("by_raceId_and_boot", (q) => q.eq("raceId", RACE_ID).eq("boot", boot)).unique();
}
export async function bootVoorSchrijven(ctx: MutationCtx, boot: string): Promise<Doc<"boten">> {
  if (!isBoot(boot)) throw fout(`Onbekende boot: ${boot}`);
  const b = await haalBoot(ctx, boot);
  if (b) return b;
  const id = await ctx.db.insert("boten", { raceId: RACE_ID, boot, gerond: {} });
  return (await ctx.db.get("boten", id))!;
}
export async function alleBoten(ctx: QueryCtx): Promise<Doc<"boten">[]> {
  return ctx.db.query("boten").withIndex("by_raceId_and_boot", (q) => q.eq("raceId", RACE_ID)).take(50);
}

// Een telefoon mag alleen schrijven voor de boot die hij heeft geclaimd
// (Start tracking). token = het geheime toesteltoken uit de browser.
export async function eisClaim(ctx: MutationCtx, boot: string, token: string): Promise<Doc<"boten">> {
  const b = await bootVoorSchrijven(ctx, boot);
  if (!token || b.claim !== token)
    throw fout(`Deze telefoon heeft ${boot} niet (meer) in gebruik. Druk opnieuw op Start tracking.`);
  return b;
}

// --- Het piratenspel ---------------------------------------------
export async function haalSpel(ctx: QueryCtx): Promise<Doc<"spel"> | null> {
  return ctx.db.query("spel").withIndex("by_raceId", (q) => q.eq("raceId", RACE_ID)).unique();
}
export async function spelVoorSchrijven(ctx: MutationCtx): Promise<Doc<"spel">> {
  const s = await haalSpel(ctx);
  if (s) return s;
  const id = await ctx.db.insert("spel", { raceId: RACE_ID });
  return (await ctx.db.get("spel", id))!;
}

// --- De wedstrijdleiding -----------------------------------------
export async function geldigeSessie(ctx: QueryCtx, token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const s = await ctx.db.query("sessies").withIndex("by_token", (q) => q.eq("token", token)).unique();
  return !!s && s.verloopt > Date.now();
}
export async function eisWl(ctx: MutationCtx, token: string): Promise<void> {
  if (!(await geldigeSessie(ctx, token))) throw fout("Niet ingelogd als wedstrijdleiding (of de sessie is verlopen). Log opnieuw in.");
}

// Live race wissen: tijden, rondingen, startsein, voorstel en (via gen) de sporen.
// De baan en de claims blijven staan.
export async function wisLiveRace(ctx: MutationCtx): Promise<void> {
  const race = await raceVoorSchrijven(ctx);
  for (const b of await alleBoten(ctx))
    await ctx.db.patch("boten", b._id, { start: undefined, finish: undefined, gerond: {}, akkoord: undefined });
  await ctx.db.patch("wedstrijden", race._id, { raceStart: undefined, startPlan: undefined, voorstel: undefined });
  await nieuweGeneratie(ctx);
}
// Nieuwe generatie: de sporen van nu tellen niet meer en worden op de achtergrond opgeruimd
export async function nieuweGeneratie(ctx: MutationCtx): Promise<void> {
  const race = await raceVoorSchrijven(ctx);
  const gen = Math.max(Date.now(), race.gen + 1);
  await ctx.db.patch("wedstrijden", race._id, { gen });
  await ctx.scheduler.runAfter(0, internal.beheer.ruimSporenOp, { gen });
}
