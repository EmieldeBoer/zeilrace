// Het piratenspel vanaf de tracker: salvo's, straffen buiten het speelveld,
// zeemijnen leggen en raken, schatkisten pakken. Alles alleen tijdens een
// lopende zeeslag en alleen voor de eigen (geclaimde) boot.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { isBoot } from "./lib/config";
import { eisClaim, fout, spelVoorSchrijven } from "./lib/db";
import { SPEL } from "./lib/spel";
import { vSchot } from "./lib/validators";

async function lopendSpel(ctx: MutationCtx, boot: string, token: string): Promise<Doc<"spel"> & { start: number }> {
  await eisClaim(ctx, boot, token);
  const s = await spelVoorSchrijven(ctx);
  if (s.start == null || s.eind != null) throw fout("Er is geen zeeslag bezig.");
  return s as Doc<"spel"> & { start: number };
}
const nummer = (nr: string, max: number) => {
  if (!/^[0-9]{1,6}$/.test(nr) || +nr >= max) throw fout("Ongeldig volgnummer.");
};
const tijdstip = (ts: number, start: number) => {
  if (!(ts >= start && ts <= Date.now() + 60000)) throw fout("Ongeldig tijdstip.");
};

export const schot = mutation({
  args: { boot: v.string(), token: v.string(), nr: v.string(), schot: vSchot },
  handler: async (ctx, { boot, token, nr, schot }) => {
    const s = await lopendSpel(ctx, boot, token);
    nummer(nr, SPEL.schoten);
    tijdstip(schot.ts, s.start);
    if (!(schot.koers >= 0 && schot.koers < 360)) throw fout("Ongeldige koers.");
    if (Object.keys(schot.raak || {}).some((d) => d === boot || !isBoot(d))) throw fout("Ongeldig doel.");
    const schoten = s.schoten || {}, eigen = schoten[boot] || {};
    if (eigen[nr]) throw fout("Dit salvo is al afgevuurd.");
    await ctx.db.patch("spel", s._id, { schoten: { ...schoten, [boot]: { ...eigen, [nr]: schot } } });
  },
});

export const straf = mutation({
  args: { boot: v.string(), token: v.string(), nr: v.string(), ts: v.number() },
  handler: async (ctx, { boot, token, nr, ts }) => {
    const s = await lopendSpel(ctx, boot, token);
    nummer(nr, SPEL.levens);
    tijdstip(ts, s.start);
    const straf = s.straf || {}, eigen = straf[boot] || {};
    if (eigen[nr] != null) return;
    await ctx.db.patch("spel", s._id, { straf: { ...straf, [boot]: { ...eigen, [nr]: ts } } });
  },
});

export const mijn = mutation({
  args: { boot: v.string(), token: v.string(), nr: v.string(), mijn: v.object({ ts: v.number(), lat: v.number(), lng: v.number() }) },
  handler: async (ctx, { boot, token, nr, mijn }) => {
    const s = await lopendSpel(ctx, boot, token);
    nummer(nr, SPEL.maxMijnen);
    tijdstip(mijn.ts, s.start);
    const mijnen = s.mijnen || {}, eigen = mijnen[boot] || {};
    if (eigen[nr]) throw fout("Op deze plek ligt al een mijn van jou.");
    await ctx.db.patch("spel", s._id, { mijnen: { ...mijnen, [boot]: { ...eigen, [nr]: mijn } } });
  },
});

// Over de mijn van een ander gevaren (meldt de tracker van het slachtoffer zelf)
export const mijnraak = mutation({
  args: { boot: v.string(), token: v.string(), mijnId: v.string(), ts: v.number() },
  handler: async (ctx, { boot, token, mijnId, ts }) => {
    const s = await lopendSpel(ctx, boot, token);
    if (!/^[A-Za-z0-9]{1,30}-[0-9]{1,3}$/.test(mijnId)) throw fout("Ongeldige mijn.");
    tijdstip(ts, s.start);
    const raak = s.mijnraak || {}, eigen = raak[boot] || {};
    if (eigen[mijnId] != null) return;
    await ctx.db.patch("spel", s._id, { mijnraak: { ...raak, [boot]: { ...eigen, [mijnId]: ts } } });
  },
});

// Een schatkist pakken: wie hem het eerst in de database zet, heeft hem
export const kist = mutation({
  args: { boot: v.string(), token: v.string(), nr: v.number(), ts: v.number() },
  returns: v.object({ gepakt: v.boolean() }),
  handler: async (ctx, { boot, token, nr, ts }) => {
    const s = await lopendSpel(ctx, boot, token);
    if (!s.veld) throw fout("Er is geen speelveld.");
    if (!Number.isInteger(nr) || nr < 0 || nr > 999999) throw fout("Ongeldige kist.");
    tijdstip(ts, s.start);
    const buit = s.buit || {};
    if (buit[String(nr)]) return { gepakt: false };
    await ctx.db.patch("spel", s._id, { buit: { ...buit, [String(nr)]: { boot, ts } } });
    return { gepakt: true };
  },
});
