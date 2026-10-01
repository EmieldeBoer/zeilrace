# ⛵ Zeilrace

Live GPS-tracking voor een zeilrace. De telefoons op de boten sturen hun positie door,
en iedereen kijkt live mee op het dashboard. Het is een statische site met Firebase
Realtime Database, gehost op Netlify.

- **Dashboard:** https://marzeille.netlify.app/ (wedstrijdleiding: `/?wl`)
- **Tracker op de boot:** https://marzeille.netlify.app/tracker.html (optioneel `?boot=SO469`)

## Bestanden

| Bestand | Wat het is |
|---|---|
| `index.html` + `dashboard.js` | Het dashboard met de tabs Live, Regels en Uitslagen, plus de wedstrijdleiding (`?wl`) |
| `tracker.html` + `tracker.js` | De telefoonpagina op elke boot: GPS, navigatie, aftelklok en GPS-alarm |
| `shared.js` | Gedeelde logica: inloggen, geometrie, rondingslijnen, wind, planning en geluid |
| `config.js` | Firebase-config, de boten + ORC-ratings en `RACE_ID` |
| `kaartexport.js` | Replay-scène, foto (PNG) en video (MP4/WebM) van een afgeronde race |
| `piraat.js` | Het piratenspel: regels, stand, kogelwolken en de animatie op de kaart |
| `feest.js` | Confetti (goudstukken), vuurwerk en knallend geluid bij de finish |
| `polar.js` | De polars: snelheid per windhoek en windsterkte uit de gezeilde races |
| `verteller.js` | Het scheepsjournaal: elk uur een notitie over de race (alleen op het dashboard, zonder AI) |
| `gedeeld.css` | Gedeelde stijlen |
| `sw.js` | Service worker, alleen voor meldingen (geen caching) |
| `database.rules.json` | Beveiligingsregels van de database. Publiceren met `./publiceer-regels.sh` (of plakken in de Firebase-console) |
| `firebase.json`, `.firebaserc`, `publiceer-regels.sh` | Instellingen en script om de regels vanaf de laptop te publiceren |
| `_headers` | Extra beveiligingsheaders voor Netlify |

---

## Eenmalige Firebase-setup (verplicht na deze update)

Zonder deze stappen toont de app *"Firebase Authentication is nog niet ingesteld"*.

1. **Authentication aanzetten**
   Firebase-console → project `marzeille-474a9` → **Build → Authentication → Get started**.
2. **Inlogmethodes** (tab *Sign-in method*):
   - **Anonymous** → inschakelen. Dit gebruiken alle telefoons en kijkers, zonder wachtwoord.
   - **Email/Password** → inschakelen. Dit gebruikt de wedstrijdleiding.
3. **Account voor de wedstrijdleiding** (tab *Users* → *Add user*): maak een account met
   e-mail en wachtwoord aan. Kopieer daarna de **User UID**.
4. **Dat account admin maken:** Realtime Database → tab *Data* → voeg bij de root toe:
   ```
   admins
     └─ <User UID> : true
   ```
   (Waarde `true` als boolean, niet als tekst.)
5. **Regels publiceren:** zie [Regels publiceren](#regels-publiceren) hieronder.
6. **Domein toestaan:** Authentication → *Settings* → *Authorized domains* → voeg
   `marzeille.netlify.app` toe (`localhost` staat er standaard al).

Na deze stappen geldt:

- Kijkers kunnen alleen **lezen**.
- Een telefoon kan alleen schrijven naar de boot die hij heeft **geclaimd**.
- Start- en finishtijden en boeironden kunnen maar één keer worden gezet.
- De starttijd ligt pas vast als alle boten akkoord zijn met het voorstel. Daarna kan niemand hem nog wijzigen,
  ook de wedstrijdleiding niet (alleen wissen met *Race afronden* of *Live tijden resetten*).
- Alleen de wedstrijdleiding mag de baan, het startsein en de uitslagen wijzigen.

> De `apiKey` in `config.js` is niet geheim; die hoort in een web-app. De beveiliging
> zit in de regels en de login. Zet **nooit** een AI- of andere betaalde API-key in deze site.

---

## De boten en hun rating

| Boot | ORC GPH (s/zm) | Rating (ToT = 600/GPH) | Bron |
|---|---|---|---|
| Sun Odyssey 389 | 635 | 0.945 | **Schatting**: geen actief certificaat gevonden. Afgeleid van zusterromp SO 379, lengteregressie over Sun Odyssey-certificaten en een correctie voor de ondiepe kiel. |
| Sun Odyssey 469 | 560 | 1.071 | Actieve ORC-certificaten (met spinnaker), omgerekend naar zeilen zonder spinnaker (+6–8 %) |
| Sun Odyssey 519 | 537 | 1.117 | Zusterromp SO 509 (actieve ORC-certificaten) |

GPH is het aantal seconden per zeemijl. Hoe lager, hoe sneller de boot. Het zijn
charterboten met onbekende zeilen en lading, dus de ratings zijn een redelijke schatting,
geen officieel certificaat. Aanpassen kan in `config.js` (`gph`).

**Uitslagen** tellen bij een gelijke start met rating: gecorrigeerde tijd = verzeilde tijd × rating (Time-on-Time).
Bij een achtervolgings- of lusstart zit de rating al in de start of de baan: daar wint wie het eerst binnen is.
Per race staat de verzeilde tijd er ter informatie bij, en een uitklapbaar **📜 Scheepsjournaal**
(bewaard bij het afronden; bij oudere races achteraf opgemaakt uit de sporen).

**⚖️ Ratingcheck** (tab Uitslagen): per race de rating waarmee elke boot precies gelijk was geëindigd,
geschaald op dezelfde gemiddelde rating, plus het gemiddelde over alle races. Bij een lusstart rekent hij met de
baanlengte van elke boot. Vanaf 3 races per boot
geeft hij een advies voor `config.js`. Bemanning, starts en het soort baan tellen mee: beoordeel dus
meerdere races met verschillende omstandigheden.

**Startopties** (tab 🏁 Race van de wedstrijdleiding):
- **A · Gelijke start:** iedereen tegelijk weg. De rating corrigeert achteraf.
- **B · Achtervolgingsstart:** de langzaamste boot start eerst. De anderen starten later,
  met het verschil in verwachte tijd. Wie het eerst finisht, wint.
- **C · Lusstart:** iedereen tegelijk weg. Elke boot krijgt automatisch een eigen lus: twee extra
  boeien (A en B) naast een rak. De boot vaart langs de lus naar A, keert terug naar B en vaart
  dan verder, een kleine α. De lus maakt de baan per boot zo veel langer dat GPH × baanlengte voor
  iedereen gelijk is. Wie het eerst finisht, wint.
  - Ook de langzaamste boot vaart een lus (`LUS_MIN_M` in `config.js`, standaard 300 m), zodat iedereen even vaak rondt.
  - Alle lussen liggen in het midden van het langste rak en delen boei A: die ligt voor iedereen op dezelfde plek.
    Alleen boei B verschilt: hoe sneller de boot, hoe verder B terug ligt.
  - Omdat de lus heen en terug langs het rak loopt, kost hij bij elke windrichting ongeveer even veel.
  - Passen de lussen niet goed op de baan, dan waarschuwt de baanplanning. Maak dan de raken langer.
  - De lussen worden bij het startsein vastgelegd. De tracker toont alleen je eigen lus; het dashboard toont ze allemaal in de bootkleur.

  **Let op:** publiceer na deze update de nieuwe `database.rules.json`, anders weigert de database de lusstart.

De verwachte tijd is GPH × baanlengte × windfactor. De windfactor komt uit de actuele
wind van Open-Meteo, weergegeven in Beaufort.

---

## Gebruik op de racedag

**Wedstrijdleiding** (`/?wl`, inloggen met e-mail en wachtwoord):
1. Zet de start- en finishlijn en de boeien uit. Bij een lijn is het eerste punt vrij; het tweede snapt naar
   een van de acht windstreken (N, NO, O, …) en een lengte van 0,5, 1, 1,5 … zm. Wijzigingen zijn eerst een **concept**
   (geel op de kaart). Pas na **✓ Bevestigen** zien de boten ze. Zo voeg je tijdens de
   race niet per ongeluk een boei toe, maar kun je de baan wel bewust aanpassen,
   bijvoorbeeld bij een windshift.
2. Kies in de tab **🏁 Race** een **starttijd** (de app stelt het eerste 5-minutenmoment minstens 10 minuten vooruit voor)
   en stel een start voor: **Start A: gelijk**, **Start B: achtervolging** of **Start C: lussen**.
   De verwachte tijden en vertragingen staan in de baanplanning.
3. Elke boot krijgt het voorstel op de tracker (met één glas van de scheepsbel) en tikt **✔ Akkoord**. Dat kan alleen
   de telefoon die de boot heeft geclaimd, dus eerst *Start tracking*. Zodra alle boten akkoord zijn, legt het dashboard
   van de wedstrijdleiding de start vast 🔒. Houd dat dashboard dus open tot het zover is.
   - Een voorstel dat niet op tijd door iedereen is goedgekeurd, verloopt. Stel dan een nieuwe tijd voor.
   - Een nieuw voorstel vervangt het oude; iedereen moet dan opnieuw akkoord geven. *✖ Startvoorstel intrekken* haalt het weg.
   - Zolang er een voorstel open staat, telt het passeren van de startlijn nog niet.
4. Na de race: **Race afronden & opslaan**. De uitslag, de baan en de sporen worden
   bewaard. In de tab *Uitslagen* staat per race een **▶ Replay** met een tijdslider,
   afspelen, **🎬 Video** (MP4 of WebM) en **🖼 Foto**.

**Boeironden:**
- Bij elke boei hoort een onzichtbare rondingslijn aan de buitenkant van de bocht. Wie die oversteekt, heeft de boei gerond.
- Ligt een boei vrijwel op een rechte lijn, dan loopt de lijn dwars door de boei en telt passeren aan elke kant.
- Mist een telefoon een ronding, dan kan de wedstrijdleiding die via *🛠 Boeironding handmatig corrigeren*
  goedkeuren of terugdraaien. De tracker neemt dat direct over.

**Scheepsjournaal:**
- Elk uur na het startsein schrijft de verteller een paar zinnen: koploper, achterstand, inhalen, gerondde boeien,
  snelste boot en wind. Na de eerste finish ook de stand met de rating en wie nog kan winnen (en of dat haalbaar is).
- Extra notities komen bij de eerste boot over de startlijn, de eerste finish, de eerste ronding van elke boei en
  een wisseling aan kop (maximaal één zo'n notitie per half uur; start en finish gaan voor). Valt een gebeurtenis
  samen met een uurnotitie, dan worden ze één notitie.
- De slotnotitie geeft de uitslag op het water én met de rating, ook als de race wordt afgerond terwijl er nog
  boten varen. Boten die niet uitvaren, blijven buiten het verhaal.
- De verteller praat als een piraat (arr, matey, schatkisten en -kaarten). Om de paar notities volgt een
  piratenversierzin of een quote van aan boord uit `BOOT_QUOTES` in `config.js` (een tekst, of `{ tekst, boot, wie }`).

**🔮 Voorspelde eindstand** (tijdens de race, op het dashboard en de tracker): per boot de tijd tot de finish (met de
verwachte kloktijd), de totale verzeilde tijd en de gecorrigeerde totale tijd, gesorteerd op die laatste. De tijd tot de
finish is de resterende baan (naar het volgende doel en langs de nog te ronden boeien naar de finish, bij een lusstart de
eigen baan) gedeeld door het tempo langs de baan: half het gemiddelde sinds de start, half dat van het laatste kwartier.
Boten die binnen zijn staan er met hun echte tijd (🏁). Dezelfde voorspelling staat onder **Voorspelling** in de
bootkaarten: tijd tot finish, eindtijd (verzeilde tijd) en eindtijd met rating.

**🏁 Finish uit spoor** (tab Uitslagen, alleen wedstrijdleiding): voor een opgeslagen race met een boot zonder finish
(bijv. als de finishlijn tijdens de race is verlengd) haalt de knop de eerste kruising van de finishlijn uit het spoor,
toont het voorstel en past na bevestiging de tijden, de uitslag en het journaal aan.

**Kaart:** schaalbalk in zeemijl rechtsonder; de rondingslijn van elke boei staat over de volle lengte (10 km) op de
kaart, in de kleur van de boei.

**🧭 Polars** (tab Uitslagen): per boot de snelheid per windhoek en windsterkte (Bft), opgebouwd uit alle gezeilde
races, met de beste kruishoek (hoogste VMG). Per GPS-punt de snelheid en koers over de grond (gemiddeld over 20 s)
tegen de ware wind van Open-Meteo (uurwaarden; bij nieuwe races bij het afronden bewaard in de uitslag). De
windrichting van het model wordt per race bijgesteld met de overstagmomenten: bij kruisen ligt de echte wind midden
tussen de koersen vóór en na een overstag. Weggelaten: overstagmomenten, stilliggen, vóór de start en na de finish.
Per vakje de snelheid die de boot in 75% van de tijd haalde. Snelheid over de grond en modelwind: een indicatie die
beter wordt met elke race.

**Snelheid in kleur** (in de replay: *🌈 Snelheid in kleur*): het gevaren spoor kleurt van blauw (langzaam) via geel
naar rood (snel), met de bootkleur als rand eronder. De snelheid is gemiddeld over 20 s; de schaal past zich aan de
race aan (de langzaamste tot de snelste 10%), met een kleurbalk in knopen.

**Overstaghoeken** (in de replay: *⤢ Overstaghoeken tonen*): bij elk overstagmoment de hoek op de kaart en per boot
het gemiddelde in de legenda. Een overstag is een blijvende koerswijziging van minstens 55° met een stabiele koers
ervoor en erna. Zonder winddata is een gijp daar niet van te onderscheiden.
- Met `?wl` staat er een testknop om meteen een notitie over dit moment te maken. Die blijft alleen lokaal.
- Iedereen die het dashboard opent, ziet dezelfde notities, ook die van eerdere uren.

**Op de boot** (tracker):
- De eerste keer verschijnt een kompas (later weer te openen via 🧭 naast de titel). Waar het naar
  wijst, moeten de zeilers zelf ontdekken 😉
1. Kies je boot, vul eventueel een teamnaam in en druk op **Start tracking**.
   Geef toestemming voor locatie en meldingen.
2. Telefoon aan de lader en de pagina open laten (het scherm blijft aan).
3. Bovenin staat een grote aftelklok naar **jouw** start. De knop 🎯 volgt je eigen boot;
   tik op een andere boot om die te volgen.

**🏴‍☠️ Het piratenspel** (zeeslag tussen de races door):
1. De wedstrijdleiding opent *🏴‍☠️ Piratenspel* en kiest **⭕ Speelveld tekenen**: tik het midden en dan de rand van de cirkel.
2. **🏴‍☠️ Start zeeslag** geeft alle schepen 3 levens en 10 salvo's.
3. Op de tracker vuurt **💥 Vuur het kanon!** een breedzijde af, haaks op de koers en naar beide kanten: 10 kogels per kant,
   150 m ver. Een kogel binnen 20 m van een ander schip is raak. Na elk salvo moet het kanon 1 minuut herladen.
   Wie geraakt wordt, kan daarna 1 minuut niet schieten.
4. Buiten de cirkel kost elke 20 seconden een leven.
5. Het spel is voorbij als er nog maar één schip drijft of als het kruit op is. Winnaar: de meeste levens, dan de meeste treffers,
   dan de meeste salvo's over.
6. **⏹ Stop** beëindigt de zeeslag. Nog een keer drukken haalt de uitslag van het scherm.
   Zolang er geen zeeslag gestart is, zie je niets van het spel: geen scorebord, geen regelkaartje en geen speelveld
   (behalve voor de wedstrijdleiding). De boten zijn dan eenvoudige scheepjes in kaartstijl; tijdens de zeeslag worden
   het piratenschepen (sloep, brigantijn, fregat, op schaal van de echte romplengte).
Instellingen (bereik, levens, herladen) staan bovenaan `piraat.js`. **Let op:** publiceer na deze update de nieuwe
`database.rules.json`, anders weigert de database de schoten.

**Signalen** (tik één keer op de pagina, anders mag de telefoon geen geluid maken):
- **Aftellen:** een kanonschot op 5 minuten, op 1 minuut en bij de start (het zwaarste schot).
- **Startlijn over:** één slag op de scheepsbel. **Boei gerond:** twee glazen (ding-ding).
- **Finish:** de bootsmansfluit. **GPS weg of boot offline:** de misthoorn. **GPS weer terug:** één zachte bel.

**Afgelegd** (op het dashboard, de tracker en in de uitslag): de afstand die een boot heeft gevaren vanaf het
passeren van de startlijn tot de finish, gemeten langs het GPS-spoor. Tegen GPS-ruis telt een stap pas na 10 m
verplaatsing, en sprongen die sneller dan 25 kn zouden zijn, tellen niet mee.

**Om te winnen:** zodra er een boot binnen is, zie je bij elke boot die nog vaart hoeveel tijd hij nog heeft om die
boot op gecorrigeerde tijd te verslaan (met de rating). Op de tracker staat ook het klokmoment waarvoor je binnen
moet zijn. Lukt winnen niet meer, dan staat er hoeveel tijd je nog hebt voor de volgende plek, of *te laat*.
Bij een achtervolgings- of lusstart wint wie het eerst binnen is, dus daar is het na de eerste finish meteen *te laat*.

**Afstanden** staan in zeemijl (zm). De replay loopt van hooguit 15 minuten vóór het startschot tot de finish van de laatste boot.

**Meldingen als de GPS uitvalt:**
- Zolang de trackerpagina open is: de misthoorn, trillen en een rode balk als er
  20 seconden geen GPS-fix is of als locatie wordt geweigerd. Losse GPS-haperingen geven geen alarm.
  Zonder positie herstart de app de GPS elke 15 seconden, en zodra er weer een positie is, stopt het alarm.
- Zit de pagina op de achtergrond, dan komt er een systeemmelding.
- De wedstrijdleiding krijgt een alarm als een boot offline gaat.
- Op de **iPhone** werken meldingen alleen als de site via *Deel → Zet op beginscherm*
  als app is toegevoegd.
- Een melding sturen naar een telefoon waarop de pagina helemaal **gesloten** is, kan
  niet zonder een push-server (Firebase Cloud Functions, betaald Blaze-plan).

---

## Lokaal testen

```
python -m http.server 8000 --bind 127.0.0.1
```
Open daarna http://127.0.0.1:8000/index.html en http://127.0.0.1:8000/tracker.html.
GPS werkt alleen via `localhost`/`127.0.0.1` of via https.

## Regels publiceren

Na elke wijziging in `database.rules.json` moeten de regels opnieuw naar Firebase.

**Met het script** (Node.js nodig):
1. Eenmalig inloggen: `npx firebase-tools login`. Er opent een browser; log in met een Google-account
   dat toegang heeft tot het project `marzeille-474a9`.
2. Publiceren: `./publiceer-regels.sh`

**Met de hand:** Firebase-console → Realtime Database → tab *Rules* → plak de inhoud van
`database.rules.json` → **Publish**.

Beide manieren vervangen alle regels door die in het bestand. Wijzig de regels dus alleen in het bestand,
niet in de console.

## Online zetten (Netlify)

Netlify → site *marzeille* → **Deploys** → sleep de hele projectmap in het vak.
Het bestand `_headers` wordt automatisch meegenomen.

## Backlog
- AI-radiocommentaar: een lokaal Python-script, waarbij de API-key op de eigen laptop
  blijft en nooit in de site komt.
