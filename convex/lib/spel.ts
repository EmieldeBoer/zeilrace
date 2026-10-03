// ============================================================
//  Zeilrace: instellingen van het piratenspel (gedeeld door de
//  site en de server). De regels zelf staan in src/lib/piraat.ts.
// ============================================================
export const SPEL = {
  levens: 3, schoten: 10, bereikM: 150, raakM: 20, strafMs: 20000,
  aftelMs: 5 * 60000,         // aftellen van de startknop tot het begin van de zeeslag (5 minuten)
  veldStandaardM: 919,        // standaardstraal van het speelveld (m)
  krimpNaMs: 10 * 60000,      // na 10 minuten begint het speelveld te krimpen…
  krimpDuurMs: 20 * 60000,    // …en in 20 minuten gaat het geleidelijk naar de kleinste maat:
  krimpMinDeel: 0.25,         // een kwart van de straal,
  krimpMinM: 150,             // maar nooit kleiner dan 150 m
  herlaadMs: 60000,           // kanon herladen tussen twee salvo's (1 minuut)
  geraaktMs: 60000,           // na een treffer ligt je kanon zo lang stil (1 minuut)
  kogelsPerKant: 10,          // de 'wolk' van kogels per breedzijde
  spreidingGr: 8,             // kogels waaieren ± zoveel graden uit
  kistAantal: 3,              // zoveel schatkisten drijven er tegelijk in het speelveld
  kistMidden: 0.5,            // ze liggen in het binnenste deel van het veld (deel van de straal), dichter naar het midden
  kistAfstandM: 155,          // kisten liggen minstens zo ver uit elkaar: ≈ 1 minuut varen bij 5 knopen
  kistDuurMs: 240000,         // na 4 minuten verhuist een kist naar een nieuwe plek
  kistPakM: 50,               // zo dichtbij moet je langs een kist varen (de cirkel om de kist)
  kistBereik: 2,              // met 'dubbel bereik' reikt je volgende salvo zoveel keer zo ver
  breedGr: 30,                // 'breder schot': de kogels waaieren ± zoveel graden uit
  mijnM: 25,                  // wie zo dichtbij een zeemijn van een ander komt, verliest een leven
  maxMijnen: 10,              // zoveel mijnen kan één schip hooguit leggen
  spookMs: 180000,            // spookschip: zo lang zien de anderen je niet op de kaart (3 minuten)
  snelMs: 300000,             // snel herladen: zo lang herlaad je in de halve tijd (5 minuten)
  valMs: 300000,              // boobytrap: zo lang kun je niet schieten (5 minuten)
};

// Wat er in een schatkist kan zitten. kans = relatief gewicht.
// lading: je houdt het vast tot je volgende salvo (of tot je de mijn legt).
export type BuitSoort = "bereik" | "breed" | "voor" | "mijn" | "schild" | "spook" | "snel" | "val";
export type Buit = { kans: number; lading?: boolean; icoon: string; naam: string; tekst: string };
export const BUIT: Record<BuitSoort, Buit> = {
  bereik: { kans: 3, lading: true, icoon: "🔭", naam: "dubbel bereik", tekst: "Je volgende salvo reikt twee keer zo ver." },
  breed: { kans: 3, lading: true, icoon: "↔️", naam: "breder schot", tekst: "Je volgende salvo waaiert extra wijd uit." },
  voor: { kans: 2, lading: true, icoon: "⬆️", naam: "voorkanon", tekst: "Je volgende salvo schiet ook recht vooruit." },
  mijn: { kans: 2, lading: true, icoon: "💣", naam: "zeemijn", tekst: "Leg hem met de mijnknop. Wie erover vaart, verliest een leven." },
  schild: { kans: 2, icoon: "🛡️", naam: "schild", tekst: "De volgende treffer kaatst af." },
  spook: { kans: 2, icoon: "👻", naam: "spookschip", tekst: "3 minuten lang zien de anderen je niet op de kaart." },
  snel: { kans: 2, icoon: "⚡", naam: "snel herladen", tekst: "5 minuten lang herlaad je in de halve tijd." },
  val: { kans: 2, icoon: "🪤", naam: "boobytrap", tekst: "De kist ontplofte: je kanon is 5 minuten onklaar." },
};
