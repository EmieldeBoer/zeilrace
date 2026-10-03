// Validators voor alles wat in de database staat. De types die de site
// gebruikt, komen hier ook vandaan (Infer), zodat ze altijd kloppen.
import { v, type Infer } from "convex/values";

export const vLatLng = v.object({ lat: v.number(), lng: v.number() });
export const vLijn = v.object({ a: vLatLng, b: vLatLng });
export const vLijnen = v.object({ start: v.optional(vLijn), finish: v.optional(vLijn) });
// Een boei. id = vaste ID (rondingen hangen daaraan, niet aan het volgnummer).
export const vBoei = v.object({
  id: v.optional(v.string()),
  lat: v.number(),
  lng: v.number(),
  naam: v.optional(v.string()),
});

// Lusstart: per boot een lus van twee boeien na de boei met id `na` (of 'start')
export const vLus = v.object({ na: v.string(), extraM: v.number(), boeien: v.array(vBoei) });
export const vModus = v.union(v.literal("gelijk"), v.literal("achtervolging"), v.literal("lus"));
export const vStartPlan = v.object({
  modus: vModus,
  gezet: v.optional(v.number()),
  nm: v.optional(v.number()),
  verwacht: v.optional(v.record(v.string(), v.number())),
  windKn: v.optional(v.number()),
  vertraging: v.optional(v.record(v.string(), v.number())),
  lussen: v.optional(v.record(v.string(), vLus)),
});
// Startvoorstel van de wedstrijdleiding: plan wordt het startPlan zodra iedereen akkoord is
export const vVoorstel = v.object({ id: v.number(), t: v.number(), plan: vStartPlan });

export const vPositie = v.object({
  lat: v.number(),
  lng: v.number(),
  ts: v.number(),
  acc: v.optional(v.number()),
  speed: v.optional(v.number()),
  heading: v.optional(v.number()),
});

// ---- Het piratenspel ----
export const vVeld = v.object({ lat: v.number(), lng: v.number(), r: v.number() });
export const vSchot = v.object({
  ts: v.number(),
  lat: v.number(),
  lng: v.number(),
  koers: v.number(),
  groot: v.optional(v.boolean()),
  breed: v.optional(v.boolean()),
  voor: v.optional(v.boolean()),
  raak: v.optional(v.record(v.string(), v.boolean())),
});
export const vMijn = v.object({ ts: v.number(), lat: v.number(), lng: v.number() });
export const vKistPak = v.object({ boot: v.string(), ts: v.number() });
export const vSpelVelden = {
  start: v.optional(v.number()),
  eind: v.optional(v.number()),
  veld: v.optional(vVeld),
  schoten: v.optional(v.record(v.string(), v.record(v.string(), vSchot))),     // boot → nr → salvo
  straf: v.optional(v.record(v.string(), v.record(v.string(), v.number()))),   // boot → nr → ts
  buit: v.optional(v.record(v.string(), vKistPak)),                            // kistnr → wie pakte hem
  mijnen: v.optional(v.record(v.string(), v.record(v.string(), vMijn))),       // boot → nr → mijn
  mijnraak: v.optional(v.record(v.string(), v.record(v.string(), v.number()))), // slachtoffer → mijn-id → ts
};
export const vSpel = v.object(vSpelVelden);

// ---- Archief: afgeronde races en zeeslagen ----
const vGetalOfNull = v.optional(v.union(v.number(), v.null()));
export const vUitslagRij = v.object({
  gefinisht: v.boolean(),
  elapsed: vGetalOfNull,
  corrected: vGetalOfNull,
  afstand: vGetalOfNull,
});
export const vNotitie = v.object({ t: v.number(), kop: v.string(), tekst: v.string() });
export const vWindUur = v.object({ t: v.number(), kn: v.number(), richting: v.number() });
// Spoor in het archief: [[lat, lng, seconden sinds t0], ...]
export const vSpoorOpslag = v.array(v.array(v.number()));
export const vTijden = v.object({ start: v.optional(v.number()), finish: v.optional(v.number()) });

export const vUitslagVelden = {
  nr: v.number(),
  ts: v.number(),
  naam: v.optional(v.string()),
  uitslag: v.record(v.string(), vUitslagRij),
  namen: v.optional(v.record(v.string(), v.string())),
  modus: v.optional(vModus),
  baan: v.optional(v.object({ lines: v.optional(vLijnen), marks: v.optional(v.array(vBoei)) })),
  nm: v.optional(v.number()),
  vertraging: v.optional(v.record(v.string(), v.number())),
  lussen: v.optional(v.record(v.string(), vLus)),
  lengtes: v.optional(v.record(v.string(), v.number())),
  sporen: v.optional(v.record(v.string(), vSpoorOpslag)),
  t0: v.optional(v.number()),
  gun: v.optional(v.number()),
  tijden: v.optional(v.record(v.string(), vTijden)),
  rondingen: v.optional(v.record(v.string(), v.record(v.string(), v.number()))),
  wind: v.optional(v.array(vWindUur)),
  journaal: v.optional(v.array(vNotitie)),
};
export const vUitslag = v.object(vUitslagVelden);

export const vStandRij = v.object({
  boot: v.string(),
  levens: v.number(),
  hits: v.number(),
  salvos: v.number(),
  kisten: v.optional(v.number()),
});
export const vZeeslagVelden = {
  start: v.number(),
  ts: v.number(),
  over: v.number(),
  t0: v.number(),
  namen: v.record(v.string(), v.string()),
  deelnemers: v.array(v.string()),
  spel: vSpel,
  stand: v.array(vStandRij),
  winnaar: v.optional(v.union(v.string(), v.null())),
  journaal: v.array(vNotitie),
  sporen: v.optional(v.record(v.string(), vSpoorOpslag)),
};
export const vZeeslag = v.object(vZeeslagVelden);

export type LatLng = Infer<typeof vLatLng>;
export type Lijn = Infer<typeof vLijn>;
export type Lijnen = Infer<typeof vLijnen>;
export type Boei = Infer<typeof vBoei>;
export type Lus = Infer<typeof vLus>;
export type Modus = Infer<typeof vModus>;
export type StartPlan = Infer<typeof vStartPlan>;
export type Voorstel = Infer<typeof vVoorstel>;
export type Positie = Infer<typeof vPositie>;
export type Veld = Infer<typeof vVeld>;
export type Schot = Infer<typeof vSchot>;
export type Mijn = Infer<typeof vMijn>;
export type SpelData = Infer<typeof vSpel>;
export type UitslagRij = Infer<typeof vUitslagRij>;
export type Notitie = Infer<typeof vNotitie>;
export type WindUur = Infer<typeof vWindUur>;
export type Tijden = Infer<typeof vTijden>;
export type Uitslag = Infer<typeof vUitslag>;
export type Zeeslag = Infer<typeof vZeeslag>;
export type StandRij = Infer<typeof vStandRij>;
