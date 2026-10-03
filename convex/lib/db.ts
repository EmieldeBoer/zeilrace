// Toegang en gedeelde databasehulpjes.
//
// Elk toestel heeft een geheim token (in de browser). De server bewaart alleen de
// SHA-256-hash ervan in `spelers`. Elke functie krijgt het token mee en zoekt zelf
// uit wie dat is en wat die in de groep mag: lid (meekijken, een boot claimen,
// een start voorstellen) of host (de groep, de baan en de uitslagen beheren).
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const fout = (tekst: string) => new ConvexError(tekst);

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("");
}
export const geldigToken = (t: string) => typeof t === "string" && t.length >= 32 && t.length <= 128;

export async function vindSpeler(ctx: QueryCtx, token: string): Promise<Doc<"spelers"> | null> {
  if (!geldigToken(token)) return null;
  const tokenHash = await hashToken(token);
  return ctx.db.query("spelers").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).unique();
}
export async function spelerVoorSchrijven(ctx: MutationCtx, token: string): Promise<Doc<"spelers">> {
  if (!geldigToken(token)) throw fout("Ongeldig toesteltoken. Herlaad de pagina.");
  const s = await vindSpeler(ctx, token);
  if (s) return s;
  const id = await ctx.db.insert("spelers", { tokenHash: await hashToken(token) });
  return (await ctx.db.get("spelers", id))!;
}

export type Toegang = { speler: Doc<"spelers">; lid: Doc<"leden">; groep: Doc<"groepen"> };
// Voor queries: null als het toestel geen lid is (de site toont dan 'meedoen')
export async function toegang(ctx: QueryCtx, groep: Id<"groepen">, token: string): Promise<Toegang | null> {
  const speler = await vindSpeler(ctx, token);
  if (!speler) return null;
  const lid = await ctx.db.query("leden").withIndex("by_groep_and_speler", (q) => q.eq("groep", groep).eq("speler", speler._id)).unique();
  if (!lid) return null;
  const g = await ctx.db.get("groepen", groep);
  return g ? { speler, lid, groep: g } : null;
}
export async function eisLid(ctx: QueryCtx, groep: Id<"groepen">, token: string): Promise<Toegang> {
  const t = await toegang(ctx, groep, token);
  if (!t) throw fout("Je bent (nog) geen lid van deze groep. Open de uitnodigingslink opnieuw.");
  return t;
}
export async function eisHost(ctx: QueryCtx, groep: Id<"groepen">, token: string): Promise<Toegang> {
  const t = await eisLid(ctx, groep, token);
  if (t.lid.rol !== "host") throw fout("Alleen een host van de groep mag dit.");
  return t;
}

// --- Boten -------------------------------------------------------
export async function bootenVan(ctx: QueryCtx, groep: Id<"groepen">): Promise<Doc<"boten">[]> {
  const b = await ctx.db.query("boten").withIndex("by_groep_and_boot", (q) => q.eq("groep", groep)).take(50);
  return b.sort((x, y) => x.volgorde - y.volgorde);
}
export async function haalBoot(ctx: QueryCtx, groep: Id<"groepen">, boot: string): Promise<Doc<"boten">> {
  const b = await ctx.db.query("boten").withIndex("by_groep_and_boot", (q) => q.eq("groep", groep).eq("boot", boot)).unique();
  if (!b) throw fout("Deze boot bestaat niet (meer) in de groep.");
  return b;
}
// Een toestel mag alleen schrijven voor de boot die het heeft geclaimd (Start tracking)
export async function eisClaim(ctx: MutationCtx, groep: Id<"groepen">, boot: string, token: string) {
  const t = await eisLid(ctx, groep, token);
  const b = await haalBoot(ctx, groep, boot);
  if (b.claim !== t.speler._id) throw fout("Deze boot is niet (meer) aan jouw toestel gekoppeld. Druk opnieuw op Start tracking.");
  return { ...t, boot: b };
}

// --- Het piratenspel ---------------------------------------------
export async function haalSpel(ctx: QueryCtx, groep: Id<"groepen">): Promise<Doc<"spel"> | null> {
  return ctx.db.query("spel").withIndex("by_groep", (q) => q.eq("groep", groep)).unique();
}
export async function spelVoorSchrijven(ctx: MutationCtx, groep: Id<"groepen">): Promise<Doc<"spel">> {
  const s = await haalSpel(ctx, groep);
  if (s) return s;
  const id = await ctx.db.insert("spel", { groep });
  return (await ctx.db.get("spel", id))!;
}

// Live race wissen: tijden, rondingen, startsein, voorstel en (via gen) de sporen.
// De baan en de claims blijven staan.
export async function wisLiveRace(ctx: MutationCtx, groep: Doc<"groepen">): Promise<void> {
  for (const b of await bootenVan(ctx, groep._id))
    await ctx.db.patch("boten", b._id, { start: undefined, finish: undefined, gerond: {}, akkoord: undefined });
  await ctx.db.patch("groepen", groep._id, { raceStart: undefined, startPlan: undefined, voorstel: undefined });
  await nieuweGeneratie(ctx, groep);
}
// Nieuwe generatie: de sporen van nu tellen niet meer en worden op de achtergrond opgeruimd
export async function nieuweGeneratie(ctx: MutationCtx, groep: Doc<"groepen">): Promise<void> {
  const gen = Math.max(Date.now(), groep.gen + 1);
  await ctx.db.patch("groepen", groep._id, { gen });
  await ctx.scheduler.runAfter(0, internal.beheer.ruimSporenOp, { groep: groep._id, gen });
}

// Willekeurige code uit een alfabet zonder verwarrende tekens (geen 0/O, 1/I/L)
const ALFABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function nieuweCode(lengte: number): string {
  let uit = "";
  while (uit.length < lengte) {
    const b = new Uint8Array(lengte * 2);
    crypto.getRandomValues(b);
    // alleen waarden onder 248 (= 8 × 31) gebruiken: elke letter even vaak
    for (const x of b) if (x < 248 && uit.length < lengte) uit += ALFABET[x % ALFABET.length];
  }
  return uit;
}
// Getallen van buiten: NaN en Infinity komen door elke vergelijking heen en zouden een
// tijd die maar één keer gezet kan worden voorgoed kapot maken
export function eisGetallen(...n: (number | null | undefined)[]) {
  if (n.some((x) => x != null && !Number.isFinite(x))) throw fout("Ongeldig getal.");
}
export function eisPunt(p: { lat: number; lng: number }) {
  if (!(p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180)) throw fout("Ongeldige positie.");
}
// De ids waaronder een boot een boei kan ronden: de boeien van de baan en zijn eigen lus
// (zelfde ids als boeiId en baanVanBoot op de site)
export function boeiIds(g: Doc<"groepen">, boot: string): Set<string> {
  const ids = new Set(g.marks.map((b, i) => b.id || String(i)));
  g.startPlan?.lussen?.[boot]?.boeien.forEach((b, i) => ids.add(b.id || `lus-${boot}-${"ab"[i]}`));
  return ids;
}
export const tekstInvoer = (t: string, max: number) => t.replace(/\s+/g, " ").trim().slice(0, max);
