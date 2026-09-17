# ⛵ Zeilrace dashboard

Live GPS-tracking + dashboard voor een zeilrace. Telefoons op de boten sturen hun
positie door; iedereen kan op de website live meekijken.

**Status:** Fase 1 (MVP) — live posities + sporen op de kaart.
Volgt nog: start/finish-tijden + scorebord (Fase 2), route + windslider (Fase 3).

## Bestanden

| Bestand | Wat het is |
|---|---|
| `index.html`  | Het **dashboard** — kaart met alle boten. Dit deel je met publiek. |
| `tracker.html`| De **telefoonpagina** op elke boot die GPS doorstuurt. |
| `config.js`   | Firebase-gegevens + de boten + ratings. **Hier vul je je project in.** |

---

## Eenmalige setup (± 10 min)

### 1. Firebase-project maken
1. Ga naar https://console.firebase.google.com en log in met je Google-account.
2. Klik **Project toevoegen**, geef het een naam (bv. `zeilrace`). Google Analytics mag uit.

### 2. Realtime Database aanzetten
1. Linkermenu → **Build → Realtime Database** → **Database maken**.
2. Kies locatie **europe-west1** (Europa).
3. Start in **testmodus** (voor nu open — we scherpen dit later aan). Klik gereed.
4. Kopieer de database-URL bovenaan (ziet eruit als
   `https://zeilrace-default-rtdb.europe-west1.firebasedatabase.app`).

### 3. Web-app registreren en config kopiëren
1. Tandwiel (linksboven) → **Projectinstellingen** → tab **Algemeen**.
2. Onder *Je apps* → klik het **web-icoon `</>`**. Geef een bijnaam, klik registreren.
3. Je krijgt een `firebaseConfig = { ... }` blok te zien. Kopieer die waarden.
4. Open `config.js` en plak de waarden op de juiste plek. Zet ook de juiste
   `databaseURL` (uit stap 2.4).

> De `apiKey` in een web-app is **niet geheim** — die hoort in de front-end.
> De beveiliging regelen we via database-regels (zie onderaan), niet via de key.

### 4. Boten en race instellen
In `config.js`:
- Pas `BOTEN` aan (namen, kleuren; ratings mogen 1.0 blijven voor de Valk-test).
- `RACE_ID` staat op `test-valk-25juli`. Later zet je die op bv. `frankrijk-2026`.

---

## Uitproberen op je eigen computer

Omdat de pagina's `config.js` inladen, moet je ze via een klein webservertje openen
(niet met dubbelklik als `file://`). In deze map:

```
# met Python (staat vaak al op je pc):
python -m http.server 8000
```

Open dan http://localhost:8000/index.html (dashboard) en
http://localhost:8000/tracker.html (tracker).

> GPS in de browser werkt alleen op `localhost` of via **https**. Op je telefoon
> heb je dus straks een https-adres nodig → daarom hosten we het (hieronder).

---

## Online zetten (zodat de telefoons op het water erbij kunnen)

De simpelste weg is **Firebase Hosting** (zit al bij je project):

```
npm install -g firebase-tools
firebase login
firebase init hosting      # kies je project; public map = deze map; geen SPA-rewrite
firebase deploy
```

Je krijgt dan een `https://JOUW-PROJECT.web.app` adres.
- Dashboard: `https://JOUW-PROJECT.web.app/`
- Tracker op de boot: `https://JOUW-PROJECT.web.app/tracker.html?boot=Valk1`

(Alternatief zonder Firebase Hosting: Netlify of GitHub Pages. Vraag me gerust.)

---

## Gebruik op de racedag

1. Elke boot opent de **tracker-URL** met de juiste `?boot=`-naam.
2. Boot kiezen → **Start tracking** → locatietoestemming geven.
3. Telefoon aan de oplader, scherm aan laten. De pagina stuurt elke ~3 sec de positie.
4. Iedereen kijkt live mee op het **dashboard**.

---

## Beveiliging vóór de echte race (belangrijk)

De testmodus-regels laten iedereen schrijven. Vóór de race in Frankrijk zetten we
strengere regels in (bv. alleen schrijven naar de bekende bootnamen, of een
race-wachtwoord). Zeg het als we bij Fase 2 zijn, dan regel ik de regels mee.
