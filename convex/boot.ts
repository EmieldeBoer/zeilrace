// De tracker op de boot: boot claimen, positie, spoor, start/boeien/finish en akkoord.
// Elke schrijfactie draagt het geheime toesteltoken mee; alleen de telefoon die de
// boot heeft geclaimd mag voor die boot schrijven (zoals de oude databaseregels).
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { FLEET, RACE_ID } from "./lib/config";
import { alleBoten, bootVoorSchrijven, eisClaim, fout, haalRace, haalSpel, raceVoorSchrijven } from "./lib/db";

const vToken = v.string();
const geldigToken = (t: string) => t.length >= 16 && t.length <= 100;
const nietInDeToekomst = (ts: number) => Math.min(ts, Date.now() + 60000);

// Boot in gebruik nemen (Start tracking). Lukt alleen als niemand anders hem heeft.
export const claim = mutation({
  args: { boot: v.string(), token: vToken },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { boot, token }) => {
    if (!geldigToken(token)) throw fout("Ongeldig toesteltoken.");
    const b = await bootVoorSchrijven(ctx, boot);
    if (b.claim && b.claim !== token) return { ok: false };
    if (b.claim !== token) await ctx.db.patch("boten", b._id, { claim: token });
    return { ok: true };
  },
});

export const naam = mutation({
  args: { boot: v.string(), token: vToken, naam: v.string() },
  handler: async (ctx, { boot, token, naam }) => {
    const b = await eisClaim(ctx, boot, token);
    const n = naam.trim().slice(0, 24);
    await ctx.db.patch("boten", b._id, { naam: n || undefined });
  },
});

// Positie (elke ~3 s). spoor = ook een punt in het spoor zetten (tijdens een race of zeeslag).
export const positie = mutation({
  args: {
    boot: v.string(), token: vToken, spoor: v.boolean(),
    lat: v.number(), lng: v.number(), ts: v.number(),
    acc: v.optional(v.number()), speed: v.optional(v.number()), heading: v.optional(v.number()),
  },
  handler: async (ctx, { boot, token, spoor, ...p }) => {
    await eisClaim(ctx, boot, token);
    if (!(p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180)) throw fout("Ongeldige positie.");
    const ts = nietInDeToekomst(p.ts);
    const oud = await ctx.db.query("posities").withIndex("by_raceId_and_boot", (q) => q.eq("raceId", RACE_ID).eq("boot", boot)).unique();
    const rij = { raceId: RACE_ID, boot, lat: p.lat, lng: p.lng, ts, acc: p.acc, speed: p.speed, heading: p.heading };
    if (oud) await ctx.db.replace("posities", oud._id, rij);
    else await ctx.db.insert("posities", rij);
    if (!spoor) return;
    // Alleen tijdens een race (er staat een startsein) of een zeeslag
    const race = await haalRace(ctx), spel = await haalSpel(ctx);
    if (!race || (race.raceStart == null && spel?.start == null)) return;
    await ctx.db.insert("spoorpunten", { raceId: RACE_ID, gen: race.gen, boot, lat: p.lat, lng: p.lng, ts });
  },
});

// Over de startlijn: één keer, niet vóór het startsein
export const start = mutation({
  args: { boot: v.string(), token: vToken, ts: v.number() },
  handler: async (ctx, { boot, token, ts }) => {
    const b = await eisClaim(ctx, boot, token);
    if (b.start != null) return;
    const race = await haalRace(ctx);
    if (race?.raceStart != null && ts < race.raceStart) throw fout("De start telt pas na het startsein.");
    await ctx.db.patch("boten", b._id, { start: nietInDeToekomst(ts) });
  },
});

// Over de finish: één keer, na de start
export const finish = mutation({
  args: { boot: v.string(), token: vToken, ts: v.number() },
  handler: async (ctx, { boot, token, ts }) => {
    const b = await eisClaim(ctx, boot, token);
    if (b.finish != null) return;
    if (b.start == null || ts <= b.start) throw fout("Een finish kan pas na de start.");
    await ctx.db.patch("boten", b._id, { finish: nietInDeToekomst(ts) });
  },
});

// Boei gerond (de rondingslijn overgestoken): één keer per boei
export const gerond = mutation({
  args: { boot: v.string(), token: vToken, id: v.string(), ts: v.number() },
  handler: async (ctx, { boot, token, id, ts }) => {
    const b = await eisClaim(ctx, boot, token);
    if (!id || id.length > 40 || id.startsWith("$") || id.startsWith("_")) throw fout("Ongeldige boei.");
    if (b.gerond[id] != null) return;
    await ctx.db.patch("boten", b._id, { gerond: { ...b.gerond, [id]: nietInDeToekomst(ts) } });
  },
});

// Akkoord met het startvoorstel. Is daarmee iedereen akkoord, dan ligt de start meteen vast.
export const akkoord = mutation({
  args: { boot: v.string(), token: vToken, voorstelId: v.number() },
  returns: v.object({ vast: v.boolean() }),
  handler: async (ctx, { boot, token, voorstelId }) => {
    const b = await eisClaim(ctx, boot, token);
    const race = await raceVoorSchrijven(ctx);
    const vs = race.voorstel;
    if (!vs || vs.id !== voorstelId) throw fout("Dit startvoorstel geldt niet meer.");
    if (vs.t <= Date.now()) throw fout("Dit startvoorstel is verlopen.");
    if (race.raceStart != null) throw fout("De start ligt al vast.");
    await ctx.db.patch("boten", b._id, { akkoord: voorstelId });
    const boten = await alleBoten(ctx);
    const eens = FLEET.filter((x) => x === boot || boten.find((y) => y.boot === x)?.akkoord === vs.id);
    if (eens.length < FLEET.length) return { vast: false };
    await ctx.db.patch("wedstrijden", race._id, { raceStart: vs.t, startPlan: vs.plan, voorstel: undefined });
    for (const y of boten) await ctx.db.patch("boten", y._id, { akkoord: undefined });
    return { vast: true };
  },
});
