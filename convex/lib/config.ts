// ============================================================
//  Zeilrace: vaste instellingen (gedeeld door de site en de server)
//  De boten zelf stelt elke groep in; zie convex/groepen.ts.
// ============================================================
import type { BootSnapshot } from "./validators";

// ------------------------------------------------------------
//  Een boot zoals de rekenregels hem zien.
//  gph = seconden per zeemijl (lager = sneller). Daarmee rekent de app:
//    - verwachte tijd  = gph × afstand (× windfactor)
//    - rating (ToT)    = 600 / gph   (standaard ORC-omrekening)
//    - gecorrigeerd    = verzeilde tijd × rating
//  schip = het scheepje op de kaart: type en maat volgen uit de lengte.
// ------------------------------------------------------------
export type SchipType = "sloep" | "brigantijn" | "fregat";
export type Boot = {
  model: string;
  kleur: string;
  gph: number;
  rating: number;
  schip: { type: SchipType; romp: number; breedte: number };
};

export const MAX_BOTEN = 12;
// Goed te onderscheiden kleuren, ook in de zon (de eerste worden het eerst gebruikt)
export const BOOT_KLEUREN = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#00a6a6",
  "#d4a017", "#f032e6", "#7a4b1f", "#000075", "#808000", "#9a6324"];
export const ratingNaarGph = (rating: number) => Math.round(600 / rating);
export const gphNaarRating = (gph: number) => 600 / gph;

export function bootUit(s: BootSnapshot): Boot {
  const romp = Math.max(4, Math.min(40, s.lengte || 12));
  const type: SchipType = romp < 12 ? "sloep" : romp < 14.5 ? "brigantijn" : "fregat";
  return { model: s.model, kleur: s.kleur, gph: s.gph, rating: gphNaarRating(s.gph), schip: { type, romp, breedte: +(romp * 0.32).toFixed(2) } };
}

// ------------------------------------------------------------
//  De vloot van de groep die nu open is (alleen in de browser).
//  BOTEN bevat ook boten uit oude uitslagen (voor kleur en rating);
//  FLEET is de huidige vloot, op volgorde.
// ------------------------------------------------------------
export const BOTEN: Record<string, Boot> = {};
export const FLEET: string[] = [];
export function zetVloot(lijst: (BootSnapshot & { boot: string })[]) {
  Object.keys(BOTEN).forEach((k) => delete BOTEN[k]);
  FLEET.length = 0;
  lijst.forEach((b) => { BOTEN[b.boot] = bootUit(b); FLEET.push(b.boot); });
}
// Een berekening over een andere vloot (bijv. de boten van een oude uitslag).
// Synchroon: FLEET is daarna weer zoals hij was.
export function metVloot<T>(ids: string[], fn: () => T): T {
  const oud = [...FLEET];
  FLEET.length = 0; FLEET.push(...ids.filter((b) => BOTEN[b]));
  try { return fn(); } finally { FLEET.length = 0; FLEET.push(...oud); }
}
// Boten uit oude uitslagen erbij (alleen als ze er nog niet zijn)
export function registreerBoten(snap: Record<string, BootSnapshot> | undefined) {
  Object.entries(snap || {}).forEach(([id, b]) => { if (!BOTEN[id]) BOTEN[id] = bootUit(b); });
}

// ------------------------------------------------------------
//  Boei ronden = de "rondingslijn" oversteken. Die lijn loopt vanaf
//  de boei naar buiten, langs de bissectrice van de hoek
//  vorige-punt → boei → volgende-punt (dus naar de buitenbocht).
//  RONDINGS_LIJN_M = hoe ver die lijn naar buiten reikt (m). Ruim
//  gekozen (10 km) zodat ook heel wijde rondingen op groot water tellen.
// ------------------------------------------------------------
export const RONDINGS_LIJN_M = 10000;

// ------------------------------------------------------------
//  Foutmarge voor heel strak ronden: de lijn wordt met de GPS-
//  nauwkeurigheid van dat moment iets naar binnen verlengd, zodat een
//  strakke ronding ook telt. Dit is de bovengrens op die marge (m).
// ------------------------------------------------------------
export const RONDINGS_MARGE_MAX_M = 25;

// ------------------------------------------------------------
//  Lusstart (start C): iedereen start tegelijk en elke boot vaart
//  een eigen lus van twee extra boeien, zo lang dat de verwachte
//  tijden gelijk worden. Ook de langzaamste boot vaart een lus, zodat
//  iedereen even vaak moet ronden. LUS_MIN_M = de extra afstand van
//  die kleinste lus (m); de andere lussen worden langer.
// ------------------------------------------------------------
export const LUS_MIN_M = 300;
