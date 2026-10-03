// ============================================================
//  Zeilrace: configuratie (gedeeld door de site en de server)
// ============================================================

// ------------------------------------------------------------
//  Naam van de huidige race. Alle live gegevens, uitslagen en
//  zeeslagen hangen aan deze naam.
// ------------------------------------------------------------
export const RACE_ID = "frankrijk-2026";

// ------------------------------------------------------------
//  De boten: Dream Yacht Charter, Port Pin Rolland (Côte d'Azur).
//
//  gph = ORC General Purpose Handicap ZONDER spinnaker, in seconden
//  per zeemijl (lager = sneller). Daarmee rekent de app:
//    - verwachte tijd  = gph × afstand (× windfactor)
//    - rating (ToT)    = 600 / gph   (standaard ORC-omrekening)
//    - gecorrigeerd    = verzeilde tijd × rating
//  Herkomst (ORC-certificaten, zie README):
//    SO519: romp = Sun Odyssey 509 → ORC NS 536,3 en 537,0
//    SO469: ORC 512,1 / 534,0 met spinnaker → ~+6% zonder spinnaker
//    SO389: romp = Sun Odyssey 379 → ORC 595,8 met spinnaker (~640 NS),
//           lengteregressie 607, +1% voor de ondiepe kiel (1,52 m)
//
//  schip = het piratenschip op de kaart: type, romplengte en breedte (m).
//  De schepen worden op dezelfde schaal getekend, dus de onderlinge
//  lengteverschillen kloppen. (Breedtes zijn afgerond; alleen voor het plaatje.)
// ------------------------------------------------------------
export type SchipType = "sloep" | "brigantijn" | "fregat";
export type Boot = {
  model: string;
  kleur: string;
  gph: number;
  rating: number;
  schip: { type: SchipType; romp: number; breedte: number };
};

const boten = {
  SO389: { model: "Sun Odyssey 389", kleur: "#e6194b", gph: 635, schip: { type: "sloep", romp: 10.98, breedte: 3.99 } },
  SO469: { model: "Sun Odyssey 469", kleur: "#3cb44b", gph: 560, schip: { type: "brigantijn", romp: 13.67, breedte: 4.49 } },
  SO519: { model: "Sun Odyssey 519", kleur: "#4363d8", gph: 537, schip: { type: "fregat", romp: 15.24, breedte: 4.84 } },
} satisfies Record<string, Omit<Boot, "rating">>;

export const BOTEN: Record<string, Boot> = Object.fromEntries(
  Object.entries(boten).map(([id, b]) => [id, { ...b, rating: 600 / b.gph }]),
);
export const FLEET: string[] = Object.keys(BOTEN);
export const isBoot = (b: string): boolean => Object.prototype.hasOwnProperty.call(BOTEN, b);

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

// ------------------------------------------------------------
//  Bootquotes: uitspraken van aan boord. De verteller verwerkt er
//  af en toe één in het scheepsjournaal. Een regel is een tekst, of
//  { tekst, boot, wie } om te zeggen van welke boot (en van wie) hij komt, bijv.
//    "Wie niet overstag gaat, gaat ten onder.",
//    { tekst: "Dat was toch groen?", boot: "SO389" },
// ------------------------------------------------------------
export type BootQuote = string | { tekst: string; boot?: string; wie?: string };
export const BOOT_QUOTES: BootQuote[] = [
  // Gillepsie
  ...([
    "Onderzeeër: is dat niet gewoon een eiland?",
    "Als er overheen is gepoept, zou je het dan nog houden?",
    "Parel in je buik",
    "Zeilen is voor even, twerken voor het leven",
    { tekst: "Skipper by day, alcoholic by night", wie: "Emiel de Boer" },
    "Sriracha dop",
    "Heb je wel eens een aubergine in je reet gehad?",
    "Kikadewado — kind kan de was doen",
    "Daar kreeg ik een kleine tia van",
    "Wakeboarden is gewoon een combi van twerken en snowboarden",
    "Maak je vaker foto's van je poes?",
    "Home is where the (homo) lulu is",
    "Bipolaire piña colada",
    "Mag ik aan die kan likken?",
    "Straks gaat Dirk ook mee en heeft Milan Casper-shift",
    "Hoge cappu-dichtheid",
    "Moon-paradox: hoe meer je moont, hoe slechter je erin wordt",
    "Moonflip en flashdive",
    "Hee, ik plas niet uit mijn kont",
    "Jari wilde z'n ari laten zien → vallende ster → gecrashte moonflip",
  ] as BootQuote[]).map((q) => Object.assign({ boot: "SO519" }, typeof q === "string" ? { tekst: q } : q)),
];
