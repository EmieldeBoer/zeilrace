// ============================================================
//  Zeilrace — configuratie
// ============================================================
//  Firebase-gegevens (Projectinstellingen → Je apps → SDK-setup).
//  De apiKey van een web-app is niet geheim: de database wordt
//  beschermd door inloggen + de regels in database.rules.json.
// ------------------------------------------------------------
const firebaseConfig = {
  apiKey:            "AIzaSyDdrSzr8E3_MXqDLUq9aEvf2zg-nJi30gs",
  authDomain:        "marzeille-474a9.firebaseapp.com",
  databaseURL:       "https://marzeille-474a9-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "marzeille-474a9",
  storageBucket:     "marzeille-474a9.firebasestorage.app",
  messagingSenderId: "321029877479",
  appId:             "1:321029877479:web:7b0ab0356fdc5f9049fc42"
};

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
const BOTEN = {
  SO389: { model: "Sun Odyssey 389", kleur: "#e6194b", gph: 635, schip: { type: 'sloep',      romp: 10.98, breedte: 3.99 } },
  SO469: { model: "Sun Odyssey 469", kleur: "#3cb44b", gph: 560, schip: { type: 'brigantijn', romp: 13.67, breedte: 4.49 } },
  SO519: { model: "Sun Odyssey 519", kleur: "#4363d8", gph: 537, schip: { type: 'fregat',     romp: 15.24, breedte: 4.84 } }
};
Object.values(BOTEN).forEach(b => { b.rating = 600 / b.gph; });

// ------------------------------------------------------------
//  Naam van de huidige race (map in de database).
// ------------------------------------------------------------
const RACE_ID = "frankrijk-2026";

// ------------------------------------------------------------
//  Boei ronden = de "rondingslijn" oversteken. Die lijn loopt vanaf
//  de boei naar buiten, langs de bissectrice van de hoek
//  vorige-punt → boei → volgende-punt (dus naar de buitenbocht).
//  RONDINGS_LIJN_M = hoe ver die lijn naar buiten reikt (m). Ruim
//  gekozen (10 km) zodat ook heel wijde rondingen op groot water tellen.
// ------------------------------------------------------------
const RONDINGS_LIJN_M = 10000;

// ------------------------------------------------------------
//  Foutmarge voor heel strak ronden: de lijn wordt met de GPS-
//  nauwkeurigheid van dat moment iets naar binnen verlengd, zodat een
//  strakke ronding ook telt. Dit is de bovengrens op die marge (m).
// ------------------------------------------------------------
const RONDINGS_MARGE_MAX_M = 25;

// ------------------------------------------------------------
//  Lusstart (start C): iedereen start tegelijk en elke boot vaart
//  een eigen lus van twee extra boeien, zo lang dat de verwachte
//  tijden gelijk worden. Ook de langzaamste boot vaart een lus, zodat
//  iedereen even vaak moet ronden. LUS_MIN_M = de extra afstand van
//  die kleinste lus (m); de andere lussen worden langer.
// ------------------------------------------------------------
const LUS_MIN_M = 300;

// ------------------------------------------------------------
//  Bootquotes: uitspraken van aan boord. De verteller verwerkt er
//  af en toe één in het scheepsjournaal. Een regel is een tekst, of
//  { tekst, boot, wie } om te zeggen van welke boot (en van wie) hij komt, bijv.
//    "Wie niet overstag gaat, gaat ten onder.",
//    { tekst: "Dat was toch groen?", boot: "SO389" },
// ------------------------------------------------------------
const BOOT_QUOTES = [
  // Gillepsie
  ...[
    'Onderzeeër: is dat niet gewoon een eiland?',
    'Als er overheen is gepoept, zou je het dan nog houden?',
    'Parel in je buik',
    'Zeilen is voor even, twerken voor het leven',
    { tekst: 'Skipper by day, alcoholic by night', wie: 'Emiel de Boer' },
    'Sriracha dop',
    'Heb je wel eens een aubergine in je reet gehad?',
    'Kikadewado — kind kan de was doen',
    'Daar kreeg ik een kleine tia van',
    'Wakeboarden is gewoon een combi van twerken en snowboarden',
    "Maak je vaker foto's van je poes?",
    'Home is where the (homo) lulu is',
    'Bipolaire piña colada',
    'Mag ik aan die kan likken?',
    'Straks gaat Dirk ook mee en heeft Milan Casper-shift',
    'Hoge cappu-dichtheid',
    'Moon-paradox: hoe meer je moont, hoe slechter je erin wordt',
    'Moonflip en flashdive',
    'Hee, ik plas niet uit mijn kont',
    'Jari wilde z\'n ari laten zien → vallende ster → gecrashte moonflip',
  ].map(q => Object.assign({ boot: 'SO519' }, typeof q === 'string' ? { tekst: q } : q)),
];

// Firebase initialiseren (wordt door beide pagina's gebruikt)
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
