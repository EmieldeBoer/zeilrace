// De tracker op de boot: boot claimen, positie, spoor, start/boeien/finish en akkoord.
// Alleen het toestel dat de boot heeft geclaimd, mag voor die boot schrijven.
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { boeiIds, bootenVan, eisClaim, eisGetallen, eisLid, eisPunt, fout, haalBoot, haalSpel, tekstInvoer } from "./lib/db";

const groepArgs = { groep: v.id("groepen"), token: v.string() };
const nietInDeToekomst = (ts: number) => Math.min(ts, Date.now() + 60000);
// Een tijdstip van de telefoon: eindig en niet al te oud (de telefoon kan even offline zijn geweest)
function tijdVanBoot(ts: number) {
  eisGetallen(ts);
  if (ts < Date.now() - 6 * 3600e3) throw fout("Ongeldig tijdstip.");
  return nietInDeToekomst(ts);
}
const MAX_SPOORPUNTEN = 30000;   // per boot per race (ruim 8 uur bij één punt per seconde)

// Boot in gebruik nemen (Start tracking). Gebruikt een ander toestel hem, dan kan
// de bemanning hem overnemen (bijv. bij een andere telefoon): dat toestel stopt dan.
export const claim = mutation({
  args: { ...groepArgs, boot: v.string(), overnemen: v.boolean() },
  returns: v.object({ ok: v.boolean(), door: v.union(v.string(), v.null()) }),
  handler: async (ctx, { groep, token, boot, overnemen }) => {
    const { speler } = await eisLid(ctx, groep, token);
    const b = await haalBoot(ctx, groep, boot);
    if (b.claim && b.claim !== speler._id && !overnemen) {
      const ander = await ctx.db.get("spelers", b.claim);
      return { ok: false, door: ander?.naam ?? null };
    }
    // één boot per toestel: een eerdere claim van dit toestel komt vrij
    for (const x of await bootenVan(ctx, groep)) if (x.claim === speler._id && x.boot !== boot) await ctx.db.patch("boten", x._id, { claim: undefined });
    if (b.claim !== speler._id) await ctx.db.patch("boten", b._id, { claim: speler._id });
    return { ok: true, door: null };
  },
});

// Boot weer vrijgeven (na Stop tracking)
export const loslaten = mutation({
  args: { ...groepArgs, boot: v.string() },
  handler: async (ctx, { groep, token, boot }) => {
    const { boot: b } = await eisClaim(ctx, groep, boot, token);
    await ctx.db.patch("boten", b._id, { claim: undefined });
  },
});

export const naam = mutation({
  args: { ...groepArgs, boot: v.string(), naam: v.string() },
  handler: async (ctx, { groep, token, boot, naam }) => {
    const { boot: b } = await eisClaim(ctx, groep, boot, token);
    const n = tekstInvoer(naam, 24);
    if (n !== (b.naam ?? "")) await ctx.db.patch("boten", b._id, { naam: n || undefined });
  },
});

// Positie (elke ~3 s). spoor = ook een punt in het spoor zetten (tijdens een race of zeeslag).
export const positie = mutation({
  args: {
    ...groepArgs, boot: v.string(), spoor: v.boolean(),
    lat: v.number(), lng: v.number(), ts: v.number(),
    acc: v.optional(v.number()), speed: v.optional(v.number()), heading: v.optional(v.number()),
  },
  handler: async (ctx, { groep, token, boot, spoor, ...p }) => {
    const { groep: g } = await eisClaim(ctx, groep, boot, token);
    eisPunt(p);
    eisGetallen(p.ts, p.acc, p.speed, p.heading);
    const nu = Date.now();
    if (p.ts < nu - 5 * 60e3) return;                             // te oud om nog live te tonen
    const ts = nietInDeToekomst(p.ts);
    const oud = await ctx.db.query("posities").withIndex("by_groep_and_boot", (q) => q.eq("groep", groep).eq("boot", boot)).unique();
    if (oud && nu - (oud.ontvangen ?? 0) < 1000) return;          // niet vaker dan eens per seconde (op de klok van de server)
    // Alleen tijdens een race (er staat een startsein) of een zeeslag een spoorpunt, en niet eindeloos
    const spel = spoor && g.piraat ? await haalSpel(ctx, groep) : null;
    const punten = oud?.spoorGen === g.gen ? oud.spoorPunten ?? 0 : 0;
    const metSpoor = spoor && (g.raceStart != null || spel?.start != null) && punten < MAX_SPOORPUNTEN;
    const rij = { groep, boot, lat: p.lat, lng: p.lng, ts, acc: p.acc, speed: p.speed, heading: p.heading,
      ontvangen: nu, spoorGen: g.gen, spoorPunten: punten + (metSpoor ? 1 : 0) };
    if (oud) await ctx.db.replace("posities", oud._id, rij);
    else await ctx.db.insert("posities", rij);
    if (metSpoor) await ctx.db.insert("spoorpunten", { groep, gen: g.gen, boot, lat: p.lat, lng: p.lng, ts });
  },
});

// Over de startlijn: één keer, niet vóór het startsein
export const start = mutation({
  args: { ...groepArgs, boot: v.string(), ts: v.number() },
  handler: async (ctx, { groep, token, boot, ts }) => {
    const { boot: b, groep: g } = await eisClaim(ctx, groep, boot, token);
    if (b.start != null) return;
    // zonder startvoorstel en startsein telt elke doorgang (vrij starten); staat er een voorstel open, dan nog niet
    if (g.raceStart == null && g.voorstel) throw fout("De start ligt nog niet vast.");
    const t = tijdVanBoot(ts);
    if (g.raceStart != null && t < g.raceStart) throw fout("De start telt pas na het startsein.");
    await ctx.db.patch("boten", b._id, { start: t });
  },
});

// Over de finish: één keer, na de start
export const finish = mutation({
  args: { ...groepArgs, boot: v.string(), ts: v.number() },
  handler: async (ctx, { groep, token, boot, ts }) => {
    const { boot: b } = await eisClaim(ctx, groep, boot, token);
    if (b.finish != null) return;
    const t = tijdVanBoot(ts);
    if (b.start == null || t <= b.start) throw fout("Een finish kan pas na de start.");
    await ctx.db.patch("boten", b._id, { finish: t });
  },
});

// Boei gerond (de rondingslijn overgestoken): één keer per boei
export const gerond = mutation({
  args: { ...groepArgs, boot: v.string(), id: v.string(), ts: v.number() },
  handler: async (ctx, { groep, token, boot, id, ts }) => {
    const { boot: b, groep: g } = await eisClaim(ctx, groep, boot, token);
    if (!boeiIds(g, boot).has(id)) throw fout("Deze boei ligt niet (meer) in de baan.");
    if (b.gerond[id] != null) return;
    await ctx.db.patch("boten", b._id, { gerond: { ...b.gerond, [id]: tijdVanBoot(ts) } });
  },
});

// Akkoord met het startvoorstel. Zijn daarmee alle boten die meevaren (die een toestel
// hebben) akkoord, dan ligt de start meteen vast.
export const akkoord = mutation({
  args: { ...groepArgs, boot: v.string(), voorstelId: v.number() },
  returns: v.object({ vast: v.boolean() }),
  handler: async (ctx, { groep, token, boot, voorstelId }) => {
    const { boot: b, groep: g } = await eisClaim(ctx, groep, boot, token);
    const vs = g.voorstel;
    if (!vs || vs.id !== voorstelId) throw fout("Dit startvoorstel geldt niet meer.");
    if (vs.t <= Date.now()) throw fout("Dit startvoorstel is verlopen.");
    if (g.raceStart != null) throw fout("De start ligt al vast.");
    await ctx.db.patch("boten", b._id, { akkoord: voorstelId });
    const boten = await bootenVan(ctx, groep);
    const mee = boten.filter((x) => x.claim);
    if (!mee.every((x) => x.boot === boot || x.akkoord === vs.id)) return { vast: false };
    await ctx.db.patch("groepen", g._id, { raceStart: vs.t, startPlan: vs.plan, voorstel: undefined });
    for (const y of boten) if (y.akkoord != null || y.boot === boot) await ctx.db.patch("boten", y._id, { akkoord: undefined });
    return { vast: true };
  },
});
