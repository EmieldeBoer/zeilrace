// ============================================================
//  Zeilrace — Firebase configuratie
// ============================================================
//  Vul hieronder de gegevens van JOUW Firebase-project in.
//  Je vindt ze in de Firebase Console:
//    Project instellingen (tandwiel)  ->  Je apps  ->  SDK-setup
//  Zie README.md voor de stap-voor-stap uitleg.
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
//  De boten die meedoen. Naam + kleur op de kaart + ratingfactor.
//  Voor de Valk-test staan alle ratings op 1.0 (one-design).
//  Voor Frankrijk: vul de echte handicap in (bv. 0.95, 1.03, ...).
// ------------------------------------------------------------
const BOTEN = {
  Valk1: { kleur: "#e6194b", rating: 1.0 },
  Valk2: { kleur: "#3cb44b", rating: 1.0 },
  Valk3: { kleur: "#4363d8", rating: 1.0 }
};

// ------------------------------------------------------------
//  Naam van de huidige race (map in de database).
//  Handig: 'test-valk-25juli' nu, later 'frankrijk-2026'.
// ------------------------------------------------------------
const RACE_ID = "test-valk-25juli";

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

// Firebase initialiseren (wordt door beide pagina's gebruikt)
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
