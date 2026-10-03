# ⛵ Zeilrace

Live GPS-tracking voor een zeilrace. De telefoons op de boten sturen hun positie door, en iedereen kijkt live mee op het
dashboard. De site is gebouwd met React, TypeScript en shadcn/ui, de database en de serverlogica draaien op Convex, en de
site staat op Vercel.

| Pagina | Wat het is |
|---|---|
| `/` | Het dashboard met de tabs Live, Regels en Uitslagen |
| `/?wl` | Het dashboard met de wedstrijdleiding (inloggen met het wachtwoord) |
| `/tracker` | De telefoonpagina op elke boot (optioneel `?boot=SO469`). Het oude adres `/tracker.html` werkt ook. |

## Hoe het in elkaar zit

| Map of bestand | Wat erin staat |
|---|---|
| `convex/lib/config.ts` | De boten met hun ORC-rating, het race-id, de rondingslijnen, de lusstart en de bootquotes |
| `convex/lib/spel.ts` | Instellingen van het piratenspel en wat er in de schatkisten zit |
| `convex/schema.ts` | De tabellen in Convex |
| `convex/boot.ts`, `convex/spel.ts` | Wat een tracker mag schrijven: positie, spoor, start, rondingen, finish, akkoord, salvo's, kisten en mijnen |
| `convex/wl.ts` | Inloggen en alles wat alleen de wedstrijdleiding mag |
| `convex/race.ts`, `convex/uitslagen.ts` | Wat de site leest |
| `src/pages/Dashboard.tsx`, `src/pages/dashboard/` | Het dashboard: Live, wedstrijdleiding, journaal, planning, regels, uitslagen en replay |
| `src/pages/Tracker.tsx`, `src/pages/tracker/` | De tracker: GPS, detectie van start, boeien en finish, het kanon en het kompas |
| `src/lib/` | De rekenregels: baan en rating (`baan.ts`), meetkunde (`geo.ts`), piratenspel (`piraat.ts`), verteller, polars, export, geluid en feest |
| `src/kaart/` | Leaflet: de kaart, de schepen, de baan en de lagen van het piratenspel |
| `src/components/ui/` | De shadcn-componenten. Het piratenthema zit in `src/index.css`. |
| `scripts/` | De simulatie voor lokaal testen en het overzetten vanuit Firebase |

**Beveiliging.** Elke telefoon maakt een geheim toesteltoken aan en bewaart dat in de browser. Met *Start tracking* claimt
de telefoon een boot. Daarna accepteert de server alleen van dat toestel schrijfacties voor die boot. *Boten vrijgeven*
bij de wedstrijdleiding haalt alle claims weg. De wedstrijdleiding logt in met het wachtwoord in de omgevingsvariabele
`WL_WACHTWOORD` op de Convex-deployment. De server geeft dan een sessie van 30 dagen terug, en na 10 foute pogingen in
10 minuten wacht hij. De regels die vroeger in `database.rules.json` stonden, controleren de mutaties in `convex/` nu zelf:

- Start- en finishtijden en boeironden kunnen maar één keer worden gezet.
- Een starttijd ligt pas vast als alle boten akkoord zijn met het voorstel. Daarna kan niemand hem nog wijzigen,
  ook de wedstrijdleiding niet (alleen wissen met *Race afronden* of *Live tijden resetten*).
- Alleen de wedstrijdleiding mag de baan, het startvoorstel, het speelveld en de uitslagen wijzigen.

## Lokaal draaien

Je hebt [Bun](https://bun.sh) nodig.

```
bun install
bun run dev
```

`bun run dev` start Vite (http://localhost:5173) en `convex dev` samen. Die laatste gebruikt de deployment uit
`.env.local`. Wil je testen zonder Convex-account, start dan een lokale backend:

```
CONVEX_AGENT_MODE=anonymous bunx convex dev
```

Zet daarna het wachtwoord van de wedstrijdleiding op die deployment:

```
bunx convex env set WL_WACHTWOORD jouw-wachtwoord
```

GPS werkt in de browser alleen op `localhost` of via https.

**Simulatie.** Tegen een lokale backend kun je een race naspelen zonder boot (het script weigert elke andere deployment):

```
bun scripts/simulatie.ts baan                    # baan bij Toulon uitzetten
bun scripts/simulatie.ts race SO389,SO469        # start voorstellen, akkoord geven en de baan varen
bun scripts/simulatie.ts akkoord SO389,SO469     # akkoord op het huidige startvoorstel
bun scripts/simulatie.ts zeeslag SO389,SO469     # speelveld, zeeslag en salvo's
bun scripts/simulatie.ts reset                   # live race wissen en boten vrijgeven
```

Het script logt in met `WL_WACHTWOORD` (standaard `test1234`).

## Online zetten

**Convex.**
1. Koppel de map aan je Convex-project met `bunx convex dev` (log in en kies het project).
2. Zet `WL_WACHTWOORD` op de productie-deployment: `bunx convex env set WL_WACHTWOORD … --prod`.
3. Maak in het Convex-dashboard (Settings → Deploy keys) een production deploy key aan.

**Vercel.**
1. Importeer de repository op https://vercel.com. Vercel leest `vercel.json`: installeren met Bun en bouwen met
   `bunx convex deploy --cmd 'bun run build'`. Dat zet eerst de Convex-functies op productie en bouwt daarna de site.
2. Zet in Vercel de omgevingsvariabele `CONVEX_DEPLOY_KEY` op de deploy key. `VITE_CONVEX_URL` vult Convex zelf in tijdens de build.
3. Deploy. `vercel.json` zet ook de beveiligingsheaders (die stonden eerst in `_headers` voor Netlify), met een
   Content-Security-Policy die alleen Convex, Open-Meteo en de kaarttegels van OpenStreetMap toelaat.

**Uitslagen overzetten vanuit Firebase.** Het script haalt de race op uit de oude Firebase-database (alleen lezen,
anoniem, net als een kijker) of leest een JSON-export uit de Firebase-console. Het schrijft JSONL-bestanden naar
`import/` en toont de opdrachten om ze in te lezen:

```
bun scripts/importeer-firebase.ts --ophalen          # of: bun scripts/importeer-firebase.ts export.json
bunx convex import --table uitslagen --append import/uitslagen.jsonl --prod
bunx convex import --table zeeslagen --append import/zeeslagen.jsonl --prod
```

Lees elke tabel maar één keer in, anders staan de races dubbel. Met `--baan` zet het script ook de huidige baan klaar.

## De boten en hun rating

| Boot | ORC GPH (s/zm) | Rating (ToT = 600/GPH) | Bron |
|---|---|---|---|
| Sun Odyssey 389 | 635 | 0.945 | **Schatting**: geen actief certificaat gevonden. Afgeleid van zusterromp SO 379, lengteregressie over Sun Odyssey-certificaten en een correctie voor de ondiepe kiel. |
| Sun Odyssey 469 | 560 | 1.071 | Actieve ORC-certificaten (met spinnaker), omgerekend naar zeilen zonder spinnaker (+6–8 %) |
| Sun Odyssey 519 | 537 | 1.117 | Zusterromp SO 509 (actieve ORC-certificaten) |

GPH is het aantal seconden per zeemijl. Hoe lager, hoe sneller de boot. Het zijn
charterboten met onbekende zeilen en lading, dus de ratings zijn een redelijke schatting,
geen officieel certificaat. Aanpassen kan in `convex/lib/config.ts` (`gph`).

**Uitslagen** tellen bij een gelijke start met rating: gecorrigeerde tijd = verzeilde tijd × rating (Time-on-Time).
Bij een achtervolgings- of lusstart zit de rating al in de start of de baan: daar wint wie het eerst binnen is.
Per race staat de verzeilde tijd er ter informatie bij, en een uitklapbaar **📜 Scheepsjournaal**
(bewaard bij het afronden; bij oudere races achteraf opgemaakt uit de sporen).

**⚖️ Ratingcheck** (tab Uitslagen): per race de rating waarmee elke boot precies gelijk was geëindigd,
geschaald op dezelfde gemiddelde rating, plus het gemiddelde over alle races. Bij een lusstart rekent hij met de
baanlengte van elke boot. Vanaf 3 races per boot
geeft hij een advies voor `convex/lib/config.ts`. Bemanning, starts en het soort baan tellen mee: beoordeel dus
meerdere races met verschillende omstandigheden.

**Startopties** (tab 🏁 Race van de wedstrijdleiding):
- **A · Gelijke start:** iedereen tegelijk weg. De rating corrigeert achteraf.
- **B · Achtervolgingsstart:** de langzaamste boot start eerst. De anderen starten later,
  met het verschil in verwachte tijd. Wie het eerst finisht, wint.
- **C · Lusstart:** iedereen tegelijk weg. Elke boot krijgt automatisch een eigen lus: twee extra
  boeien (A en B) naast een rak. De boot vaart langs de lus naar A, keert terug naar B en vaart
  dan verder, een kleine α. De lus maakt de baan per boot zo veel langer dat GPH × baanlengte voor
  iedereen gelijk is. Wie het eerst finisht, wint.
  - Ook de langzaamste boot vaart een lus (`LUS_MIN_M` in `convex/lib/config.ts`, standaard 300 m), zodat iedereen even vaak rondt.
  - Alle lussen liggen in het midden van het langste rak en delen boei A: die ligt voor iedereen op dezelfde plek.
    Alleen boei B verschilt: hoe sneller de boot, hoe verder B terug ligt.
  - Omdat de lus heen en terug langs het rak loopt, kost hij bij elke windrichting ongeveer even veel.
  - Passen de lussen niet goed op de baan, dan waarschuwt de baanplanning. Maak dan de raken langer.
  - De lussen worden bij het startsein vastgelegd. De tracker toont alleen je eigen lus; het dashboard toont ze allemaal in de bootkleur.

De verwachte tijd is GPH × baanlengte × windfactor. De windfactor komt uit de actuele
wind van Open-Meteo, weergegeven in Beaufort.

---

## Gebruik op de racedag

**Wedstrijdleiding** (`/?wl`, inloggen met het wachtwoord van de wedstrijdleiding):
1. Zet de start- en finishlijn en de boeien uit. Bij een lijn is het eerste punt vrij; het tweede snapt naar
   een van de acht windstreken (N, NO, O, …) en een lengte van 0,5, 1, 1,5 … zm. Wijzigingen zijn eerst een **concept**
   (geel op de kaart). Pas na **✓ Bevestigen** zien de boten ze. Zo voeg je tijdens de
   race niet per ongeluk een boei toe, maar kun je de baan wel bewust aanpassen,
   bijvoorbeeld bij een windshift.
2. Kies in de tab **🏁 Race** een **starttijd** (de app stelt het eerste 5-minutenmoment minstens 10 minuten vooruit voor)
   en stel een start voor: **Start A: gelijk**, **Start B: achtervolging** of **Start C: lussen**.
   De verwachte tijden en vertragingen staan in de baanplanning.
3. Elke boot krijgt het voorstel op de tracker (met één glas van de scheepsbel) en tikt **✔ Akkoord**. Dat kan alleen
   de telefoon die de boot heeft geclaimd, dus eerst *Start tracking*. Zodra de laatste boot akkoord geeft, legt de server
   de start meteen vast 🔒. Het dashboard van de wedstrijdleiding hoeft daarvoor niet open te staan.
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
  piratenversierzin of een quote van aan boord uit `BOOT_QUOTES` in `convex/lib/config.ts` (een tekst, of `{ tekst, boot, wie }`).

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
1. De wedstrijdleiding opent *🏴‍☠️ Piratenspel* en kiest **⭕ Speelveld tekenen**: tik het midden. Standaard wordt het een
   cirkel van 919 m straal (`veldStandaardM`); kies *Annuleren* om zelf de rand te tikken.
2. **🏴‍☠️ Start zeeslag** telt 5 minuten af, met dezelfde grote aftelklok en kanonschoten (5 min, 1 min, start) als de race.
   Daarna heeft elk schip 3 levens en 10 salvo's. Tijdens het aftellen en de zeeslag slaan de trackers hun spoor op.
3. Op de tracker vuurt **💥 Vuur het kanon!** een breedzijde af, haaks op de koers en naar beide kanten: 10 kogels per kant,
   150 m ver. Een kogel binnen 20 m van een ander schip is raak. Na elk salvo moet het kanon 1 minuut herladen.
   Wie geraakt wordt, kan daarna 1 minuut niet schieten.
4. Richting het midden van het speelveld drijven 3 schatkisten, minstens 155 m (≈ 1 minuut varen) uit elkaar.
   Op het dashboard staat tijdens de zeeslag een overzicht van wat erin kan zitten. Elke kist verhuist na 4 minuten naar een nieuwe plek, en een gepakte kist
   komt dan ook terug. Vaar binnen de gele cirkel om de kist (50 m) en je krijgt wat erin zit. Dat zie je pas als je hem hebt:
   - **Lading** (je houdt het vast tot je het gebruikt; zolang pak je geen nieuwe kist, en je krijgt 💰 achter de levens):
     🔭 *dubbel bereik* (volgende salvo 300 m), ↔️ *breder schot* (volgende salvo waaiert ± 30° uit),
     ⬆️ *voorkanon* (volgende salvo schiet ook recht vooruit) en 💣 *zeemijn* (leg hem met *Leg een zeemijn*;
     wie er later binnen 25 m langs vaart, verliest een leven, jijzelf niet; alleen jij en de wedstrijdleiding zien hem).
   - **Meteen:** 🛡️ *schild* (de volgende treffer kaatst af), 👻 *spookschip* (3 minuten zien de anderen je schip niet
     op de kaart, ook niet op het dashboard), ⚡ *snel herladen* (5 minuten lang 30 seconden herladen) en
     🪤 *boobytrap* (je kanon is 5 minuten onklaar).
5. Buiten de cirkel kost elke 20 seconden een leven. Na 10 minuten krimpt de cirkel: in 20 minuten gaat hij geleidelijk naar
   een kwart van de straal (minstens 150 m). Op de tracker klinkt dan drie keer de scheepsbel.
6. Het spel is voorbij als er nog maar één schip drijft of als het kruit op is. Winnaar: de meeste levens, dan de meeste treffers,
   dan de meeste salvo's over.
7. **⏹ Stop** beëindigt de zeeslag. Nog een keer drukken haalt de uitslag van het scherm.
   Het speelveld (de rode cirkel) en de schootslijnen zijn voor iedereen te zien zolang het speelveld er staat;
   **🗑 Speelveld weg** haalt het weg. Voor een zeeslag kan de wedstrijdleiding de start- en finishlijn weghalen met
   **🗑 Start- en finishlijn weg** (tab Baan; via het concept, dus pas na bevestigen). Het scorebord zie je alleen tijdens
   en na een zeeslag. De regels staan altijd in de tab Regels, onder *De Piratencode*. De boten zijn dan eenvoudige scheepjes in kaartstijl; tijdens de zeeslag worden
   het piratenschepen (sloep, brigantijn, fregat, op schaal van de echte romplengte).
8. **Bewaard bij Uitslagen:** zodra de zeeslag voorbij is, slaat het dashboard van een ingelogde wedstrijdleider hem op
   (ook vóór een nieuwe zeeslag of het wissen van de uitslag). Onder *🏴‍☠️ Zeeslagen* staan dan de eindstand, een
   **▶ Replay** (sporen, krimpend speelveld, schatkisten, mijnen, een rookwolkje bij elk salvo en vliegende kogels tijdens
   het afspelen, met de levens per schip) en een **📜 Scheepsjournaal**. Zonder race worden de sporen daarna gewist.
Instellingen (bereik, levens, herladen, aftellen, krimpen, schatkisten en wat erin zit) staan in `convex/lib/spel.ts`.

**Afstand tot een andere boot** (tracker): tik op een andere boot, op de kaart of in de lijst. Er komt een stippellijn vanaf
je eigen boot met de afstand en de richting. Nog een keer tikken haalt hem weg.

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
Met 📏 rechtsboven op de kaart (tracker, dashboard en replay) meet je afstanden: tik punten op de kaart en je ziet per stuk
de afstand en de koers, en vanaf het derde punt ook het totaal. Nog een keer op 📏 stopt het meten en wist de lijn.

**Meldingen als de GPS uitvalt:**
- Zolang de trackerpagina open is: de misthoorn, trillen en een rode balk als er
  20 seconden geen GPS-fix is of als locatie wordt geweigerd. Losse GPS-haperingen geven geen alarm.
  Zonder positie herstart de app de GPS elke 15 seconden, en zodra er weer een positie is, stopt het alarm.
- Zit de pagina op de achtergrond, dan komt er een systeemmelding.
- De wedstrijdleiding krijgt een alarm als een boot offline gaat.
- Op de **iPhone** werken meldingen alleen als de site via *Deel → Zet op beginscherm*
  als app is toegevoegd.
- Een melding sturen naar een telefoon waarop de pagina helemaal **gesloten** is, kan
  niet zonder een push-server; die is er (nog) niet.

---

## Backlog
- AI-radiocommentaar: een lokaal Python-script, waarbij de API-key op de eigen laptop
  blijft en nooit in de site komt.
