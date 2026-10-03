import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vBoei, vLijnen, vPositie, vSpelVelden, vStartPlan, vUitslagVelden, vVoorstel, vZeeslagVelden,
} from "./lib/validators";

// Alles hangt aan raceId (RACE_ID in convex/lib/config.ts).
export default defineSchema({
  // De baan en de start: één document per race. Alleen de wedstrijdleiding schrijft hier.
  wedstrijden: defineTable({
    raceId: v.string(),
    lines: vLijnen,
    marks: v.array(vBoei),
    raceStart: v.optional(v.number()),
    startPlan: v.optional(vStartPlan),
    voorstel: v.optional(vVoorstel),
    // Verandert bij elke reset: oude sporen tellen dan niet meer mee
    gen: v.number(),
  }).index("by_raceId", ["raceId"]),

  // Per boot: wie hem gebruikt (claim = geheim toesteltoken, wordt nooit teruggegeven),
  // teamnaam, tijden, rondingen en het akkoord op het startvoorstel.
  boten: defineTable({
    raceId: v.string(),
    boot: v.string(),
    claim: v.optional(v.string()),
    naam: v.optional(v.string()),
    start: v.optional(v.number()),
    finish: v.optional(v.number()),
    gerond: v.record(v.string(), v.number()),
    akkoord: v.optional(v.number()),
  }).index("by_raceId_and_boot", ["raceId", "boot"]),

  // De laatste positie per boot (wordt elke paar seconden bijgewerkt)
  posities: defineTable({
    raceId: v.string(),
    boot: v.string(),
    ...vPositie.fields,
  }).index("by_raceId_and_boot", ["raceId", "boot"]),

  // Het gevaren spoor: één document per punt, tijdens een race of zeeslag
  spoorpunten: defineTable({
    raceId: v.string(),
    gen: v.number(),
    boot: v.string(),
    lat: v.number(),
    lng: v.number(),
    ts: v.number(),
  }).index("by_raceId_and_gen", ["raceId", "gen"]),

  // Het piratenspel van de race (speelveld, salvo's, straffen, kisten, mijnen)
  spel: defineTable({
    raceId: v.string(),
    ...vSpelVelden,
  }).index("by_raceId", ["raceId"]),

  // Afgeronde races (met sporen voor de replay) en bewaarde zeeslagen
  uitslagen: defineTable({
    raceId: v.string(),
    ...vUitslagVelden,
  }).index("by_raceId_and_nr", ["raceId", "nr"]),
  zeeslagen: defineTable({
    raceId: v.string(),
    ...vZeeslagVelden,
  }).index("by_raceId_and_start", ["raceId", "start"]),

  // Ingelogde wedstrijdleiding (token in de browser, hier met verloopdatum)
  sessies: defineTable({
    token: v.string(),
    verloopt: v.number(),
  }).index("by_token", ["token"]),
});
