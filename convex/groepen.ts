// Groepen: aanmaken, delen en meedoen, en wat de host aan de groep instelt
// (naam, piratenmodus, boten, leden en rollen, uitnodigingslinks).
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { MAX_BOTEN } from "./lib/config";
import {
  bootenVan, eisHost, eisLid, fout, geldigToken, hashToken, nieuweCode, spelerVoorSchrijven, tekstInvoer, toegang, vindSpeler,
} from "./lib/db";

// Per toestel (op de hash van het token, ook als er nog geen speler is) en voor de hele
// site samen: wie steeds een nieuw token verzint, loopt tegen de totale limiet aan.
const limiet = new RateLimiter(components.rateLimiter, {
  groepMaken: { kind: "token bucket", rate: 10, period: HOUR, capacity: 5 },
  groepMakenTotaal: { kind: "token bucket", rate: 300, period: HOUR, capacity: 60, shards: 4 },
  meedoen: { kind: "token bucket", rate: 30, period: 10 * MINUTE, capacity: 15 },
  meedoenTotaal: { kind: "token bucket", rate: 3000, period: 10 * MINUTE, capacity: 600, shards: 8 },
  naam: { kind: "token bucket", rate: 30, period: 10 * MINUTE, capacity: 10 },
});
// Beide limieten tegelijk; false als een van de twee op is
async function binnenLimiet(ctx: MutationCtx, soort: "groepMaken" | "meedoen", token: string) {
  if (!geldigToken(token)) throw fout("Ongeldig toesteltoken. Herlaad de pagina.");
  const totaal = await limiet.limit(ctx, soort === "groepMaken" ? "groepMakenTotaal" : "meedoenTotaal");
  if (!totaal.ok) return false;
  return (await limiet.limit(ctx, soort, { key: await hashToken(token) })).ok;
}
const CODE_LENGTE = 8, HOSTCODE_LENGTE = 20;
const MAX_LEDEN = 60, MAX_GROEPEN_PER_SPELER = 50;

const vBootInvoer = v.object({
  boot: v.optional(v.string()),
  model: v.string(),
  kleur: v.string(),
  gph: v.number(),
  lengte: v.number(),
});
type BootInvoer = { boot?: string; model: string; kleur: string; gph: number; lengte: number };

function controleerBoot(b: BootInvoer) {
  const model = tekstInvoer(b.model, 40);
  if (!model) throw fout("Elke boot heeft een naam nodig.");
  if (!/^#[0-9a-fA-F]{6}$/.test(b.kleur)) throw fout("Ongeldige kleur.");
  if (!(b.gph >= 200 && b.gph <= 2000)) throw fout(`Rating van ${model} klopt niet (tussen 0,3 en 3).`);
  if (!(b.lengte >= 3 && b.lengte <= 40)) throw fout(`Lengte van ${model} klopt niet (3 tot 40 m).`);
  return { model, kleur: b.kleur.toLowerCase(), gph: Math.round(b.gph), lengte: Math.round(b.lengte * 10) / 10 };
}
// Een boot-id dat nog niet in de groep voorkomt
function nieuweBootId(bezet: Set<string>) {
  for (;;) { const id = "b" + nieuweCode(6).toLowerCase(); if (!bezet.has(id)) { bezet.add(id); return id; } }
}
async function unieke(ctx: MutationCtx, veld: "code" | "hostCode", lengte: number) {
  for (;;) {
    const c = nieuweCode(lengte);
    const al = veld === "code"
      ? await ctx.db.query("groepen").withIndex("by_code", (q) => q.eq("code", c)).first()
      : await ctx.db.query("groepen").withIndex("by_hostCode", (q) => q.eq("hostCode", c)).first();
    if (!al) return c;
  }
}
async function zetNaam(ctx: MutationCtx, speler: Doc<"spelers">, naam: string | undefined) {
  const n = naam != null ? tekstInvoer(naam, 30) : undefined;
  if (n && n !== speler.naam) await ctx.db.patch("spelers", speler._id, { naam: n });
}
async function wordLidVan(ctx: MutationCtx, groep: Doc<"groepen">, speler: Doc<"spelers">, rol: "host" | "lid") {
  const al = await ctx.db.query("leden").withIndex("by_groep_and_speler", (q) => q.eq("groep", groep._id).eq("speler", speler._id)).unique();
  if (al) { if (rol === "host" && al.rol !== "host") await ctx.db.patch("leden", al._id, { rol }); return; }
  const aantal = (await ctx.db.query("leden").withIndex("by_groep_and_speler", (q) => q.eq("groep", groep._id)).take(MAX_LEDEN + 1)).length;
  if (aantal >= MAX_LEDEN) throw fout("Deze groep is vol.");
  const mijn = (await ctx.db.query("leden").withIndex("by_speler", (q) => q.eq("speler", speler._id)).take(MAX_GROEPEN_PER_SPELER + 1)).length;
  if (mijn >= MAX_GROEPEN_PER_SPELER) throw fout("Je zit al in heel veel groepen. Verlaat er eerst een.");
  await ctx.db.insert("leden", { groep: groep._id, speler: speler._id, rol });
}

// ---- Een nieuwe groep: wie hem maakt, is host ----
export const maak = mutation({
  args: { token: v.string(), naam: v.string(), spelerNaam: v.optional(v.string()), piraat: v.boolean(), boten: v.array(vBootInvoer) },
  returns: v.object({ code: v.string() }),
  handler: async (ctx, a) => {
    if (!(await binnenLimiet(ctx, "groepMaken", a.token))) throw fout("Je hebt net al een paar groepen gemaakt. Probeer het over een tijdje opnieuw.");
    const naam = tekstInvoer(a.naam, 50);
    if (!naam) throw fout("Geef de groep een naam.");
    if (!a.boten.length) throw fout("Voeg minstens één boot toe.");
    if (a.boten.length > MAX_BOTEN) throw fout(`Hooguit ${MAX_BOTEN} boten per groep.`);
    const boten = a.boten.map(controleerBoot);
    const speler = await spelerVoorSchrijven(ctx, a.token);
    await zetNaam(ctx, speler, a.spelerNaam);
    const code = await unieke(ctx, "code", CODE_LENGTE), hostCode = await unieke(ctx, "hostCode", HOSTCODE_LENGTE);
    const groep = await ctx.db.insert("groepen", { naam, code, hostCode, piraat: a.piraat, door: speler._id, lines: {}, marks: [], gen: Date.now() });
    const g = (await ctx.db.get("groepen", groep))!;
    await wordLidVan(ctx, g, speler, "host");
    const ids = new Set<string>();
    for (const [i, b] of boten.entries())
      await ctx.db.insert("boten", { groep, boot: nieuweBootId(ids), ...b, volgorde: i, gerond: {} });
    return { code };
  },
});

// ---- Voorvertoning bij een uitnodiging (alleen de naam en hoe groot de groep is) ----
export const vind = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length !== CODE_LENGTE) return null;
    const g = await ctx.db.query("groepen").withIndex("by_code", (q) => q.eq("code", c)).unique();
    if (!g) return null;
    const boten = await bootenVan(ctx, g._id);
    return { naam: g.naam, piraat: g.piraat, boten: boten.length };
  },
});

// ---- Meedoen met de code (iedereen met de link) ----
export const wordLid = mutation({
  args: { token: v.string(), code: v.string(), spelerNaam: v.optional(v.string()) },
  returns: v.union(v.object({ ok: v.literal(true), code: v.string() }), v.object({ ok: v.literal(false), reden: v.string() })),
  handler: async (ctx, a) => {
    // een verkeerde code gooit geen fout, anders telt de poging niet mee voor de limiet
    if (!(await binnenLimiet(ctx, "meedoen", a.token))) return { ok: false as const, reden: "Te veel pogingen. Wacht even en probeer het opnieuw." };
    const c = a.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const g = c.length === CODE_LENGTE ? await ctx.db.query("groepen").withIndex("by_code", (q) => q.eq("code", c)).unique() : null;
    if (!g) return { ok: false as const, reden: "Deze code hoort niet bij een groep. Controleer hem of vraag een nieuwe link." };
    const speler = await spelerVoorSchrijven(ctx, a.token);
    await zetNaam(ctx, speler, a.spelerNaam);
    await wordLidVan(ctx, g, speler, "lid");
    return { ok: true as const, code: g.code };
  },
});

// ---- Host worden met de hostlink ----
export const wordHost = mutation({
  args: { token: v.string(), hostCode: v.string(), spelerNaam: v.optional(v.string()) },
  returns: v.union(v.object({ ok: v.literal(true), code: v.string() }), v.object({ ok: v.literal(false), reden: v.string() })),
  handler: async (ctx, a) => {
    if (!(await binnenLimiet(ctx, "meedoen", a.token))) return { ok: false as const, reden: "Te veel pogingen. Wacht even en probeer het opnieuw." };
    const c = a.hostCode.trim().toUpperCase();
    const g = c.length === HOSTCODE_LENGTE ? await ctx.db.query("groepen").withIndex("by_hostCode", (q) => q.eq("hostCode", c)).unique() : null;
    if (!g) return { ok: false as const, reden: "Deze hostlink werkt niet (meer). Vraag een host om een nieuwe." };
    const speler = await spelerVoorSchrijven(ctx, a.token);
    await zetNaam(ctx, speler, a.spelerNaam);
    await wordLidVan(ctx, g, speler, "host");
    return { ok: true as const, code: g.code };
  },
});

// ---- Mijn groepen (op dit toestel) ----
export const mijn = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const speler = await vindSpeler(ctx, token);
    if (!speler) return { naam: null, groepen: [] };
    const leden = await ctx.db.query("leden").withIndex("by_speler", (q) => q.eq("speler", speler._id)).take(MAX_GROEPEN_PER_SPELER);
    const groepen = [];
    for (const l of leden) {
      const g = await ctx.db.get("groepen", l.groep);
      if (g) groepen.push({ code: g.code, naam: g.naam, rol: l.rol, piraat: g.piraat, live: g.raceStart != null });
    }
    return { naam: speler.naam ?? null, groepen: groepen.sort((a, b) => a.naam.localeCompare(b.naam)) };
  },
});

// ---- Een groep openen: wie ben ik hier, wie zijn de leden ----
export const open = query({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, { token, code }) => {
    const c = code.trim().toUpperCase();
    const g = await ctx.db.query("groepen").withIndex("by_code", (q) => q.eq("code", c)).unique();
    if (!g) return { soort: "onbekend" as const };
    const t = await toegang(ctx, g._id, token);
    if (!t) return { soort: "geenLid" as const, naam: g.naam, piraat: g.piraat };
    const leden = await ctx.db.query("leden").withIndex("by_groep_and_speler", (q) => q.eq("groep", g._id)).take(MAX_LEDEN);
    const boten = await bootenVan(ctx, g._id);
    const ledenLijst = [];
    for (const l of leden) {
      const s = await ctx.db.get("spelers", l.speler);
      ledenLijst.push({ id: l._id, naam: s?.naam ?? null, rol: l.rol, ikZelf: l.speler === t.speler._id,
        boten: boten.filter((b) => b.claim === l.speler).map((b) => b.boot) });
    }
    return {
      soort: "lid" as const,
      groep: { id: g._id, naam: g.naam, code: g.code, piraat: g.piraat, hostCode: t.lid.rol === "host" ? g.hostCode : null },
      rol: t.lid.rol, mijnNaam: t.speler.naam ?? null,
      leden: ledenLijst.sort((a, b) => (a.rol === b.rol ? (a.naam ?? "").localeCompare(b.naam ?? "") : a.rol === "host" ? -1 : 1)),
    };
  },
});

// ---- Mijn naam (zichtbaar voor de groep) ----
export const mijnNaam = mutation({
  args: { token: v.string(), naam: v.string() },
  handler: async (ctx, { token, naam }) => {
    const speler = await vindSpeler(ctx, token);
    if (!speler) throw fout("Doe eerst mee met een groep.");
    if (!(await limiet.limit(ctx, "naam", { key: speler._id })).ok) throw fout("Even geduld: je hebt je naam net al een paar keer aangepast.");
    await zetNaam(ctx, speler, naam);
  },
});

// ===================== Alleen voor hosts =====================
export const instellingen = mutation({
  args: { token: v.string(), groep: v.id("groepen"), naam: v.optional(v.string()), piraat: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const { groep } = await eisHost(ctx, a.groep, a.token);
    const patch: Partial<Doc<"groepen">> = {};
    if (a.naam != null) {
      const n = tekstInvoer(a.naam, 50);
      if (!n) throw fout("Geef de groep een naam.");
      patch.naam = n;
    }
    if (a.piraat != null) {
      if (!a.piraat) {
        const spel = await ctx.db.query("spel").withIndex("by_groep", (q) => q.eq("groep", groep._id)).unique();
        if (spel?.start != null && spel.eind == null) throw fout("Stop eerst de zeeslag.");
      }
      patch.piraat = a.piraat;
    }
    await ctx.db.patch("groepen", groep._id, patch);
  },
});

// Nieuwe uitnodigingslink: de oude werkt dan niet meer
export const nieuweLink = mutation({
  args: { token: v.string(), groep: v.id("groepen"), welke: v.union(v.literal("lid"), v.literal("host")) },
  returns: v.string(),
  handler: async (ctx, a) => {
    const { groep } = await eisHost(ctx, a.groep, a.token);
    if (a.welke === "lid") {
      const code = await unieke(ctx, "code", CODE_LENGTE);
      await ctx.db.patch("groepen", groep._id, { code });
      return code;
    }
    const hostCode = await unieke(ctx, "hostCode", HOSTCODE_LENGTE);
    await ctx.db.patch("groepen", groep._id, { hostCode });
    return hostCode;
  },
});

// De vloot opslaan: bestaande boten bijwerken (op id), nieuwe toevoegen, ontbrekende weghalen
export const bewaarBoten = mutation({
  args: { token: v.string(), groep: v.id("groepen"), boten: v.array(vBootInvoer) },
  handler: async (ctx, a) => {
    const { groep } = await eisHost(ctx, a.groep, a.token);
    if (!a.boten.length) throw fout("Een groep heeft minstens één boot.");
    if (a.boten.length > MAX_BOTEN) throw fout(`Hooguit ${MAX_BOTEN} boten per groep.`);
    const oud = await bootenVan(ctx, groep._id), houden = new Set<string>(), ids = new Set(oud.map((b) => b.boot));
    for (const [i, b] of a.boten.entries()) {
      const schoon = controleerBoot(b), bestaand = b.boot ? oud.find((x) => x.boot === b.boot) : undefined;
      if (bestaand) { houden.add(bestaand.boot); await ctx.db.patch("boten", bestaand._id, { ...schoon, volgorde: i }); }
      else await ctx.db.insert("boten", { groep: groep._id, boot: nieuweBootId(ids), ...schoon, volgorde: i, gerond: {} });
    }
    for (const b of oud) if (!houden.has(b.boot)) {
      if (b.start != null && b.finish == null && groep.raceStart != null) throw fout(`${b.model} vaart nog in de race. Rond eerst de race af.`);
      await ctx.db.delete("boten", b._id);
      const pos = await ctx.db.query("posities").withIndex("by_groep_and_boot", (q) => q.eq("groep", groep._id).eq("boot", b.boot)).unique();
      if (pos) await ctx.db.delete("posities", pos._id);
    }
  },
});

export const zetRol = mutation({
  args: { token: v.string(), groep: v.id("groepen"), lid: v.id("leden"), rol: v.union(v.literal("host"), v.literal("lid")) },
  handler: async (ctx, a) => {
    const { groep } = await eisHost(ctx, a.groep, a.token);
    const lid = await ctx.db.get("leden", a.lid);
    if (!lid || lid.groep !== groep._id) throw fout("Dit lid hoort niet bij de groep.");
    if (a.rol === "lid" && lid.rol === "host") {
      if ((await hosts(ctx, groep._id)) <= 1) throw fout("Er moet minstens één host blijven.");
      await nieuweHostCode(ctx, groep._id);              // anders wordt die met de oude hostlink zo weer host
    }
    await ctx.db.patch("leden", lid._id, { rol: a.rol });
  },
});
export const verwijderLid = mutation({
  args: { token: v.string(), groep: v.id("groepen"), lid: v.id("leden") },
  handler: async (ctx, a) => {
    const { groep } = await eisHost(ctx, a.groep, a.token);
    const lid = await ctx.db.get("leden", a.lid);
    if (!lid || lid.groep !== groep._id) throw fout("Dit lid hoort niet bij de groep.");
    if (lid.rol === "host") {
      if ((await hosts(ctx, groep._id)) <= 1) throw fout("Er moet minstens één host blijven.");
      await nieuweHostCode(ctx, groep._id);
    }
    await verlaatGroep(ctx, groep._id, lid);
  },
});
// Zelf de groep verlaten (de laatste host kan pas weg als er een andere host is)
export const verlaat = mutation({
  args: { token: v.string(), groep: v.id("groepen") },
  handler: async (ctx, a) => {
    const { lid } = await eisLid(ctx, a.groep, a.token);
    const andere = (await ctx.db.query("leden").withIndex("by_groep_and_speler", (q) => q.eq("groep", a.groep)).take(MAX_LEDEN)).length > 1;
    if (lid.rol === "host" && andere && (await hosts(ctx, a.groep)) <= 1) throw fout("Maak eerst iemand anders host.");
    await verlaatGroep(ctx, a.groep, lid);
  },
});
async function nieuweHostCode(ctx: MutationCtx, groep: Id<"groepen">) {
  await ctx.db.patch("groepen", groep, { hostCode: await unieke(ctx, "hostCode", HOSTCODE_LENGTE) });
}
async function hosts(ctx: MutationCtx, groep: Id<"groepen">) {
  return (await ctx.db.query("leden").withIndex("by_groep_and_speler", (q) => q.eq("groep", groep)).take(MAX_LEDEN)).filter((l) => l.rol === "host").length;
}
async function verlaatGroep(ctx: MutationCtx, groep: Id<"groepen">, lid: Doc<"leden">) {
  for (const b of await bootenVan(ctx, groep)) if (b.claim === lid.speler) await ctx.db.patch("boten", b._id, { claim: undefined });
  await ctx.db.delete("leden", lid._id);
}
