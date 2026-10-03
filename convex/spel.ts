// Het piratenspel vanaf de tracker: salvo's, straffen buiten het speelveld,
// zeemijnen leggen en raken, schatkisten pakken. Alleen in piratenmodus, tijdens
// een lopende zeeslag en alleen voor de eigen (geclaimde) boot.
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { bootenVan, eisClaim, eisPunt, fout, spelVoorSchrijven } from "./lib/db";
import { SPEL } from "./lib/spel";
import { vSchot } from "./lib/validators";

const groepArgs = { groep: v.id("groepen"), token: v.string() };
async function lopendSpel(ctx: MutationCtx, groep: Id<"groepen">, boot: string, token: string): Promise<Doc<"spel"> & { start: number }> {
  const { groep: g } = await eisClaim(ctx, groep, boot, token);
  if (!g.piraat) throw fout("De piratenmodus staat uit in deze groep.");
  const s = await spelVoorSchrijven(ctx, groep);
  if (s.start == null || s.eind != null) throw fout("Er is geen zeeslag bezig.");
  return s as Doc<"spel"> & { start: number };
}
const nummer = (nr: string, max: number) => {
  if (!/^[0-9]{1,6}$/.test(nr) || +nr >= max) throw fout("Ongeldig volgnummer.");
};
const tijdstip = (ts: number, start: number) => {
  if (!(ts >= start && ts <= Date.now() + 60000)) throw fout("Ongeldig tijdstip.");
};
// Wanneer kist nr in het water ligt (zelfde rekensom als kistBegin in src/lib/piraat.ts)
const kistBegin = (start: number, nr: number) =>
  start + (nr % SPEL.kistAantal) * SPEL.kistDuurMs / SPEL.kistAantal + Math.floor(nr / SPEL.kistAantal) * SPEL.kistDuurMs;

export const schot = mutation({
  args: { ...groepArgs, boot: v.string(), nr: v.string(), schot: vSchot },
  handler: async (ctx, { groep, boot, token, nr, schot }) => {
    const s = await lopendSpel(ctx, groep, boot, token);
    nummer(nr, SPEL.schoten);
    tijdstip(schot.ts, s.start);
    eisPunt(schot);
    if (!(schot.koers >= 0 && schot.koers < 360)) throw fout("Ongeldige koers.");
    const vloot = new Set((await bootenVan(ctx, groep)).map((b) => b.boot));
    if (Object.keys(schot.raak || {}).some((d) => d === boot || !vloot.has(d))) throw fout("Ongeldig doel.");
    const schoten = s.schoten || {}, eigen = schoten[boot] || {};
    if (eigen[nr]) throw fout("Dit salvo is al afgevuurd.");
    await ctx.db.patch("spel", s._id, { schoten: { ...schoten, [boot]: { ...eigen, [nr]: schot } } });
  },
});

export const straf = mutation({
  args: { ...groepArgs, boot: v.string(), nr: v.string(), ts: v.number() },
  handler: async (ctx, { groep, boot, token, nr, ts }) => {
    const s = await lopendSpel(ctx, groep, boot, token);
    nummer(nr, SPEL.levens);
    tijdstip(ts, s.start);
    const straf = s.straf || {}, eigen = straf[boot] || {};
    if (eigen[nr] != null) return;
    await ctx.db.patch("spel", s._id, { straf: { ...straf, [boot]: { ...eigen, [nr]: ts } } });
  },
});

export const mijn = mutation({
  args: { ...groepArgs, boot: v.string(), nr: v.string(), mijn: v.object({ ts: v.number(), lat: v.number(), lng: v.number() }) },
  handler: async (ctx, { groep, boot, token, nr, mijn }) => {
    const s = await lopendSpel(ctx, groep, boot, token);
    nummer(nr, SPEL.maxMijnen);
    tijdstip(mijn.ts, s.start);
    eisPunt(mijn);
    const mijnen = s.mijnen || {}, eigen = mijnen[boot] || {};
    if (eigen[nr]) throw fout("Op deze plek ligt al een mijn van jou.");
    await ctx.db.patch("spel", s._id, { mijnen: { ...mijnen, [boot]: { ...eigen, [nr]: mijn } } });
  },
});

// Over de mijn van een ander gevaren (meldt de tracker van het slachtoffer zelf)
export const mijnraak = mutation({
  args: { ...groepArgs, boot: v.string(), mijnId: v.string(), ts: v.number() },
  handler: async (ctx, { groep, boot, token, mijnId, ts }) => {
    const s = await lopendSpel(ctx, groep, boot, token);
    // id = eigenaar-nr: alleen een mijn die echt ligt, van een ander schip
    const m = /^([A-Za-z0-9]{1,30})-([0-9]{1,3})$/.exec(mijnId);
    if (!m || m[1] === boot || !s.mijnen?.[m[1]]?.[m[2]]) throw fout("Ongeldige mijn.");
    tijdstip(ts, s.start);
    const raak = s.mijnraak || {}, eigen = raak[boot] || {};
    if (eigen[mijnId] != null) return;
    await ctx.db.patch("spel", s._id, { mijnraak: { ...raak, [boot]: { ...eigen, [mijnId]: ts } } });
  },
});

// Een schatkist pakken: wie hem het eerst in de database zet, heeft hem
export const kist = mutation({
  args: { ...groepArgs, boot: v.string(), nr: v.number(), ts: v.number() },
  returns: v.object({ gepakt: v.boolean() }),
  handler: async (ctx, { groep, boot, token, nr, ts }) => {
    const s = await lopendSpel(ctx, groep, boot, token);
    if (!s.veld) throw fout("Er is geen speelveld.");
    if (!Number.isInteger(nr) || nr < 0 || nr > 999999) throw fout("Ongeldige kist.");
    // alleen een kist die nu in het water ligt (met een minuut speling)
    const van = kistBegin(s.start, nr), nu = Date.now();
    if (van > nu + 60000 || van + SPEL.kistDuurMs < nu - 60000) throw fout("Deze kist ligt er niet (meer).");
    tijdstip(ts, s.start);
    const buit = s.buit || {};
    if (buit[String(nr)]) return { gepakt: false };
    await ctx.db.patch("spel", s._id, { buit: { ...buit, [String(nr)]: { boot, ts } } });
    return { gepakt: true };
  },
});
