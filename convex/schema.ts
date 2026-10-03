import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vBoei, vBootSnapshot, vLijnen, vPositie, vQuote, vSpelVelden, vStartPlan, vUitslagVelden, vVoorstel, vZeeslagVelden,
} from "./lib/validators";

// Alles hangt aan een groep. Wie de link van een groep heeft, kan lid worden;
// leden zien de live race en kunnen een boot claimen. Hosts beheren de groep.
export default defineSchema({
  // Een toestel (browser). We bewaren alleen de hash van het geheime token.
  spelers: defineTable({
    tokenHash: v.string(),
    naam: v.optional(v.string()),
  }).index("by_tokenHash", ["tokenHash"]),

  // Een groep: de uitnodigingscodes, de instellingen, de baan en de live start
  groepen: defineTable({
    naam: v.string(),
    code: v.string(),          // uitnodiging voor leden (8 tekens, ook zo in te typen)
    hostCode: v.string(),      // uitnodiging voor hosts (lang, alleen als link)
    piraat: v.boolean(),       // piratenmodus: piratenthema en de zeeslag
    door: v.optional(v.id("spelers")),
    lines: vLijnen,
    marks: v.array(vBoei),
    raceStart: v.optional(v.number()),
    startPlan: v.optional(vStartPlan),
    voorstel: v.optional(vVoorstel),
    // Verandert bij elke reset: oude sporen tellen dan niet meer mee
    gen: v.number(),
    quotes: v.optional(v.array(vQuote)),
  }).index("by_code", ["code"]).index("by_hostCode", ["hostCode"]),

  leden: defineTable({
    groep: v.id("groepen"),
    speler: v.id("spelers"),
    rol: v.union(v.literal("host"), v.literal("lid")),
  }).index("by_groep_and_speler", ["groep", "speler"]).index("by_speler", ["speler"]),

  // De boten van een groep: wat de host instelt (naam, kleur, rating, lengte) en de
  // live toestand (wie hem gebruikt, teamnaam, tijden, rondingen, akkoord)
  boten: defineTable({
    groep: v.id("groepen"),
    boot: v.string(),          // vaste id binnen de groep, bijv. "b7k2"
    model: v.string(),
    kleur: v.string(),
    gph: v.number(),
    lengte: v.number(),
    volgorde: v.number(),
    naam: v.optional(v.string()),
    claim: v.optional(v.id("spelers")),
    start: v.optional(v.number()),
    finish: v.optional(v.number()),
    gerond: v.record(v.string(), v.number()),
    akkoord: v.optional(v.number()),
  }).index("by_groep_and_boot", ["groep", "boot"]),

  // De laatste positie per boot (wordt elke paar seconden bijgewerkt)
  posities: defineTable({
    groep: v.id("groepen"),
    boot: v.string(),
    ...vPositie.fields,
    ontvangen: v.optional(v.number()),     // servertijd van de laatste positie (voor de afremming)
    spoorGen: v.optional(v.number()),      // zoveel spoorpunten heeft deze boot in generatie spoorGen
    spoorPunten: v.optional(v.number()),
  }).index("by_groep_and_boot", ["groep", "boot"]),

  // Het gevaren spoor: één document per punt, tijdens een race of zeeslag
  spoorpunten: defineTable({
    groep: v.id("groepen"),
    gen: v.number(),
    boot: v.string(),
    lat: v.number(),
    lng: v.number(),
    ts: v.number(),
  }).index("by_groep_and_gen", ["groep", "gen"]),

  // Het piratenspel (speelveld, salvo's, straffen, kisten, mijnen)
  spel: defineTable({
    groep: v.id("groepen"),
    ...vSpelVelden,
  }).index("by_groep", ["groep"]),

  // Afgeronde races (met sporen voor de replay) en bewaarde zeeslagen.
  // boten = de boten zoals ze toen waren (kleur, rating), ook als ze later weg zijn.
  uitslagen: defineTable({
    groep: v.id("groepen"),
    ...vUitslagVelden,
    boten: v.optional(v.record(v.string(), vBootSnapshot)),
  }).index("by_groep_and_nr", ["groep", "nr"]),
  zeeslagen: defineTable({
    groep: v.id("groepen"),
    ...vZeeslagVelden,
  }).index("by_groep_and_start", ["groep", "start"]),
});
