// ============================================================
//  Zeilrace — het piratenspel (mini-game, in de stijl van de klassieke
//  breedzijde-zeeslagen). Elke tracker kan het kanon afvuren: een salvo
//  van kogels, haaks op de koers, naar bakboord én stuurboord. Komt een
//  kogel binnen 20 m van een andere boot, dan is het raak.
//  Elke boot heeft 3 levens en 10 salvo's. Wie geraakt is, kan 1 minuut
//  niet schieten. Buiten het speelveld (een cirkel
//  van de wedstrijdleiding) kost elke 20 seconden een leven. Na 10 minuten
//  krimpt het speelveld geleidelijk (zie krimpNaMs e.v.).
//  In het speelveld drijven 3 schatkisten, richting het midden, op plekken die
//  iedereen zelf uitrekent. Elke kist verhuist na 4 minuten naar een nieuwe plek; een
//  gepakte kist komt dan ook terug. Vaar erlangs (binnen 50 m) en je krijgt
//  wat erin zit (zie BUIT hieronder; ook de inhoud rekent iedereen zelf uit).
//  Lading (dubbel bereik, breder schot, voorkanon, zeemijn) gebruik je bij je
//  volgende salvo of met de mijnknop; zolang je lading hebt, pak je geen kist.
//  De rest werkt meteen: schild, spookschip, snel herladen, of een boobytrap.
//
//  Database: races/{race}/spel = { start, eind?, veld: {lat,lng,r},
//    schoten: {boot: {0..9: {ts, lat, lng, koers, groot?, breed?, voor?, raak: {doelboot: true}}}},
//    straf:   {boot: {0..2: ts}},
//    buit:    {kistnr: {boot, ts}},      (wie de kist het eerst pakt)
//    mijnen:  {boot: {0..9: {ts, lat, lng}}},
//    mijnraak: {slachtoffer: {eigenaar-nr: ts}} }   (gemeld door wie erover vaart)
//  De stand wordt door iedereen op dezelfde manier uit die gegevens berekend,
//  en de kogelwolk van een salvo is voor iedereen gelijk (vast zaad = ts).
// ============================================================
const SPEL = {
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
  spookMs: 180000,            // spookschip: zo lang zien de anderen je niet op de kaart (3 minuten)
  snelMs: 300000,             // snel herladen: zo lang herlaad je in de halve tijd (5 minuten)
  valMs: 300000               // boobytrap: zo lang kun je niet schieten (5 minuten)
};
// Wat er in een schatkist kan zitten. kans = relatief gewicht.
// lading: je houdt het vast tot je volgende salvo (of tot je de mijn legt).
const BUIT = {
  bereik: { kans: 3, lading: true, icoon: '🔭', naam: 'dubbel bereik',  tekst: 'Je volgende salvo reikt twee keer zo ver.' },
  breed:  { kans: 3, lading: true, icoon: '↔️', naam: 'breder schot',   tekst: 'Je volgende salvo waaiert extra wijd uit.' },
  voor:   { kans: 2, lading: true, icoon: '⬆️', naam: 'voorkanon',      tekst: 'Je volgende salvo schiet ook recht vooruit.' },
  mijn:   { kans: 2, lading: true, icoon: '💣', naam: 'zeemijn',        tekst: 'Leg hem met de mijnknop. Wie erover vaart, verliest een leven.' },
  schild: { kans: 2, icoon: '🛡️', naam: 'schild',          tekst: 'De volgende treffer kaatst af.' },
  spook:  { kans: 2, icoon: '👻', naam: 'spookschip',      tekst: '3 minuten lang zien de anderen je niet op de kaart.' },
  snel:   { kans: 2, icoon: '⚡', naam: 'snel herladen',   tekst: '5 minuten lang herlaad je in de halve tijd.' },
  val:    { kans: 2, icoon: '🪤', naam: 'boobytrap',       tekst: 'De kist ontplofte: je kanon is 5 minuten onklaar.' }
};

const Piraat = (() => {
  const M_PER_GRAAD = 111320;
  const naarXY = (o, p) => ({ x: (p.lng - o.lng) * M_PER_GRAAD * Math.cos(o.lat * Math.PI / 180), y: (p.lat - o.lat) * M_PER_GRAAD });
  const vanXY = (o, x, y) => ({ lat: o.lat + y / M_PER_GRAAD, lng: o.lng + x / (M_PER_GRAAD * Math.cos(o.lat * Math.PI / 180)) });
  const richting = (o, peil, lengte) => { const t = peil * Math.PI / 180; return vanXY(o, Math.sin(t) * lengte, Math.cos(t) * lengte); };

  const bereik = schot => SPEL.bereikM * (schot && schot.groot ? SPEL.kistBereik : 1);
  // Lading → vlaggen op het salvo (en terug)
  const SCHOT_VLAG = { bereik: 'groot', breed: 'breed', voor: 'voor' };
  const metLading = schot => !!(schot.groot || schot.breed || schot.voor);

  // ---- Buitkisten: kist nr = ronde × kistAantal + plek ----
  // Elke plek begint een nieuwe ronde (nieuwe kist, nieuwe plaats) om de kistDuurMs,
  // per plek een beetje verschoven zodat niet alle kisten tegelijk verhuizen.
  // De plaats volgt uit start en nr (vast zaad), dus iedereen ziet dezelfde kisten.
  const kistVerschuiving = plek => plek * SPEL.kistDuurMs / SPEL.kistAantal;
  // Een kist ligt minstens kistAfstandM van de kisten die er al lagen toen hij verscheen (die
  // eerder begonnen en tegelijk in het water liggen). Lukt dat niet binnen het midden, dan zoekt
  // hij iets verder naar buiten, en anders de plek die het verst van de rest ligt.
  const kistCache = new Map();
  const kistBegin = (spel, nr) => spel.start + kistVerschuiving(nr % SPEL.kistAantal) + Math.floor(nr / SPEL.kistAantal) * SPEL.kistDuurMs;
  function kist(spel, nr) {
    const v = spel.veld, sleutel = `${spel.start}|${v.lat},${v.lng},${v.r}|${nr}`;
    if (kistCache.has(sleutel)) return kistCache.get(sleutel);
    if (kistCache.size > 5000) kistCache.clear();
    const plek = nr % SPEL.kistAantal, ronde = Math.floor(nr / SPEL.kistAantal);
    const begin = kistBegin(spel, nr), van = ronde ? begin : spel.start, tot = begin + SPEL.kistDuurMs;
    const buren = [];
    for (let q = 0; q < SPEL.kistAantal; q++) for (let rq = Math.max(0, ronde - 1); rq <= ronde; rq++) {
      const nq = rq * SPEL.kistAantal + q, bq = kistBegin(spel, nq), vq = rq ? bq : spel.start;
      if (nq === nr || !(bq < begin || (bq === begin && nq < nr))) continue;     // alleen de kisten van vóór deze
      if (vq < tot && bq + SPEL.kistDuurMs > van) buren.push(kist(spel, nq));
    }
    let s = (Math.floor(spel.start / 1000) + nr * 7919) % 2147483647 || 1;
    const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
    rnd(); rnd();
    // richting het midden (zonder wortel: dichter bij het midden), binnen de cirkel zoals die
    // is als de kist verschijnt (het veld krimpt)
    const rVeld = straal(v, spel.start, van);
    let beste = null, besteD = -1;
    for (let i = 0; i < 40; i++) {
      const r = rVeld * Math.min(0.85, SPEL.kistMidden + i * 0.01) * rnd(), hoek = rnd() * 360;
      const p = richting(v, hoek, r), d = Math.min(Infinity, ...buren.map(k => afstandMeter(k, p)));
      if (d > besteD) { beste = p; besteD = d; }
      if (d >= SPEL.kistAfstandM) break;
    }
    const k = Object.assign({ nr, van, tot }, beste);
    kistCache.set(sleutel, k);
    return k;
  }
  // Wat er in kist nr zit (vast zaad, los van de plaats)
  function inhoud(spel, nr) {
    let s = (Math.floor(spel.start / 1000) * 31 + nr * 104729 + 12345) % 2147483647 || 1;
    for (let i = 0; i < 3; i++) s = s * 16807 % 2147483647;
    const soorten = Object.keys(BUIT), totaal = soorten.reduce((t, k) => t + BUIT[k].kans, 0);
    let x = s / 2147483647 * totaal;
    for (const k of soorten) { x -= BUIT[k].kans; if (x < 0) return k; }
    return soorten[0];
  }
  // De kisten die op tijdstip 'nu' in het water liggen en nog niet gepakt zijn
  function kisten(spel, nu) {
    if (!spel || !spel.start || !spel.veld || !spel.veld.r) return [];
    const eind = Math.min(nu, spel.eind || Infinity), uit = [];
    if (eind < spel.start) return uit;
    for (let plek = 0; plek < SPEL.kistAantal; plek++) {
      const ronde = Math.max(0, Math.floor((eind - spel.start - kistVerschuiving(plek)) / SPEL.kistDuurMs));
      const nr = ronde * SPEL.kistAantal + plek;
      if (!(spel.buit && spel.buit[nr])) uit.push(kist(spel, nr));
    }
    return uit;
  }

  // ---- De kogelwolk van een salvo (voor iedereen hetzelfde: zaad = tijdstip) ----
  function kogels(schot) {
    let s = Math.floor(schot.ts) % 2147483647 || 1;
    const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
    const uit = [], n = SPEL.kogelsPerKant, spreiding = schot.breed ? SPEL.breedGr : SPEL.spreidingGr;
    const zij = { sb: 90, bb: -90, voor: 0 };
    ['sb', 'bb'].concat(schot.voor ? ['voor'] : []).forEach(kant => {
      for (let i = 0; i < n; i++) {
        const waaier = n > 1 ? -spreiding + 2 * spreiding * i / (n - 1) : 0;
        const peil = schot.koers + zij[kant] + waaier + (rnd() - 0.5) * 3;
        const lengte = bereik(schot) * (0.85 + rnd() * 0.2);
        uit.push({ kant, eind: richting(schot, peil, lengte), vertraging: rnd() * 220 });
      }
    });
    return uit;
  }
  // Raakt het salvo de boot op 'doel'? (binnen raakM van een kogelbaan)
  function raakt(schot, doel) {
    const d = naarXY(schot, doel);
    if (Math.hypot(d.x, d.y) < 3) return false;                     // dat ben je zelf
    return kogels(schot).some(k => {
      const e = naarXY(schot, k.eind), l2 = e.x * e.x + e.y * e.y;
      const f = Math.max(0, Math.min(1, (d.x * e.x + d.y * e.y) / l2));
      return Math.hypot(d.x - f * e.x, d.y - f * e.y) <= SPEL.raakM;
    });
  }
  // De straal van het speelveld op tijdstip t: eerst de volle maat, na krimpNaMs
  // gelijkmatig kleiner tot de kleinste maat. Iedereen rekent hetzelfde uit (uit start en t).
  function straal(veld, start, t) {
    if (!veld || !veld.r) return null;
    if (!start || t == null) return veld.r;
    const min = Math.min(veld.r, Math.max(SPEL.krimpMinM, veld.r * SPEL.krimpMinDeel));
    const f = Math.max(0, Math.min(1, (t - start - SPEL.krimpNaMs) / SPEL.krimpDuurMs));
    return veld.r - (veld.r - min) * f;
  }
  // Het speelveld op tijdstip t (met de gekrompen straal)
  const veldOp = (veld, start, t) => veld && veld.r ? Object.assign({}, veld, { r: straal(veld, start, t) }) : veld;
  const binnenVeld = (veld, pos) => !veld || afstandMeter(veld, pos) <= veld.r;

  // ---- De stand: alle salvo's en strafpunten op tijdvolgorde afspelen ----
  // posTs = { boot: tijd van de laatste positie } → wie doet er mee.
  // Ligt het begin nog in de toekomst, dan wordt er afgeteld: wacht = true, nog niet bezig.
  function stand(spel, posTs, nu = Date.now()) {
    const boten = {};
    FLEET.forEach(b => { boten[b] = { boot: b, levens: SPEL.levens, hits: 0, gebruikt: 0, straf: 0, dood: null, laatsteSchot: null,
      geraakt: null, lading: null, kisten: 0, vondst: null, schild: false, geblokt: 0, spookTot: 0, snelTot: 0, valTot: 0, mijnRaak: 0 }; });
    if (!spel || !spel.start) return { bezig: false, over: null, boten, deelnemers: [], volgorde: [], geldig: [], mijnen: [], veld: spel && spel.veld };
    if (nu < spel.start) return { bezig: false, wacht: true, over: null, start: spel.start, veld: spel.veld, boten,
      deelnemers: [], volgorde: [], geldig: [], mijnen: [] };
    const ev = [];
    Object.entries(spel.schoten || {}).forEach(([b, l]) => Object.entries(l || {}).forEach(([nr, s]) =>
      s && s.ts != null && ev.push({ soort: 'schot', b, t: s.ts, s, id: b + '/' + nr })));
    Object.entries(spel.straf || {}).forEach(([b, l]) => Object.values(l || {}).forEach(t =>
      t != null && ev.push({ soort: 'straf', b, t })));
    Object.entries(spel.buit || {}).forEach(([nr, k]) =>
      k && k.boot && k.ts != null && ev.push({ soort: 'kist', b: k.boot, t: k.ts, nr: +nr }));
    Object.entries(spel.mijnen || {}).forEach(([b, l]) => Object.entries(l || {}).forEach(([nr, m]) =>
      m && m.ts != null && ev.push({ soort: 'mijn', b, t: m.ts, m, id: b + '-' + nr })));
    Object.entries(spel.mijnraak || {}).forEach(([b, l]) => Object.entries(l || {}).forEach(([id, t]) =>
      t != null && ev.push({ soort: 'mijnraak', b, t, id })));
    ev.sort((a, c) => a.t - c.t);
    const deelnemers = FLEET.filter(b => (posTs[b] || 0) >= spel.start || ev.some(e => e.b === b));
    const levend = () => deelnemers.filter(b => boten[b].levens > 0);
    const klaar = () => {
      const l = levend();
      if (!deelnemers.length) return false;
      if (!l.length) return true;                                      // niemand meer over
      if (deelnemers.length >= 2 && l.length <= 1) return true;        // één schip blijft drijven
      return l.every(b => boten[b].gebruikt >= SPEL.schoten);          // alle kogels zijn op
    };
    let over = null;
    const geldig = [], mijnen = [];
    const log = [];        // wat er gebeurde, op tijdvolgorde (voor het scheepsjournaal)
    // Een treffer (kogel of mijn) op boot d: het schild vangt hem op, anders een leven minder
    const treffer = (d, t) => {
      const doel = boten[d];
      if (doel.schild) { doel.schild = false; doel.geblokt++; return false; }
      doel.levens--; doel.geraakt = t; if (!doel.levens) doel.dood = t;
      return true;
    };
    for (const e of ev) {
      if (over || (spel.eind && e.t > spel.eind)) break;
      const ik = boten[e.b];
      if (!ik || ik.levens <= 0) continue;                             // een wrak schiet niet meer
      if (e.soort === 'straf') {
        ik.levens--; ik.straf++;
        if (!ik.levens) ik.dood = e.t;
        log.push({ t: e.t, soort: 'straf', b: e.b, levens: ik.levens });
      } else if (e.soort === 'kist') {
        // telt als de kist toen in het water lag (10 s speling voor een trage verbinding)
        const k = spel.veld ? kist(spel, e.nr) : null;
        if (!k || ik.lading || e.t < k.van || e.t > k.tot + 10000) continue;
        const soort = inhoud(spel, e.nr);
        log.push({ t: e.t, soort: 'kist', b: e.b, buit: soort });
        ik.kisten++; ik.vondst = { soort, t: e.t, nr: e.nr };
        if (BUIT[soort].lading) ik.lading = soort;
        else if (soort === 'schild') ik.schild = true;
        else if (soort === 'spook') ik.spookTot = e.t + SPEL.spookMs;
        else if (soort === 'snel') ik.snelTot = e.t + SPEL.snelMs;
        else if (soort === 'val') ik.valTot = e.t + SPEL.valMs;
      } else if (e.soort === 'mijn') {
        if (ik.lading !== 'mijn') continue;                            // alleen met een mijn uit een kist
        ik.lading = null;
        mijnen.push({ id: e.id, boot: e.b, ts: e.t, lat: e.m.lat, lng: e.m.lng, actief: true });
        log.push({ t: e.t, soort: 'mijn', b: e.b });
      } else if (e.soort === 'mijnraak') {
        const m = mijnen.find(m => m.id === e.id);
        if (!m || !m.actief || m.boot === e.b || e.t < m.ts) continue;
        m.actief = false; m.knal = e.t; m.slachtoffer = e.b;
        const gat = treffer(e.b, e.t);
        m.geblokt = !gat;
        if (gat) { ik.mijnRaak++; boten[m.boot].hits++; }
        log.push({ t: e.t, soort: 'mijnraak', b: e.b, eigenaar: m.boot, geblokt: !gat, levens: ik.levens });
      } else {
        if (ik.gebruikt >= SPEL.schoten) continue;
        if (ik.geraakt != null && e.t < ik.geraakt + SPEL.geraaktMs) continue;   // net geraakt: het kanon ligt stil
        if (e.t < ik.valTot) continue;                                 // boobytrap: het kanon is onklaar
        ik.gebruikt++; ik.laatsteSchot = e.t;
        if (metLading(e.s) && ik.lading !== 'mijn') ik.lading = null;  // de lading is verschoten
        const raak = [], geblokt = [];
        Object.keys(e.s.raak || {}).filter(d => boten[d] && d !== e.b && boten[d].levens > 0)
          .forEach(d => { if (treffer(d, e.t)) { raak.push(d); ik.hits++; } else geblokt.push(d); });
        geldig.push({ id: e.id, boot: e.b, schot: e.s, raak, geblokt });
        log.push({ t: e.t, soort: 'schot', b: e.b, raak, geblokt, levens: Object.fromEntries(raak.map(d => [d, boten[d].levens])),
          lading: e.s.groot ? 'bereik' : e.s.breed ? 'breed' : e.s.voor ? 'voor' : null });
      }
      if (klaar()) over = e.t;
    }
    if (!over && spel.eind) over = spel.eind;
    const rest = b => SPEL.schoten - b.gebruikt;
    const volgorde = deelnemers.map(b => boten[b])
      .sort((a, c) => c.levens - a.levens || c.hits - a.hits || rest(c) - rest(a));
    const [w, t] = volgorde;
    const gelijk = !!(w && t && w.levens === t.levens && w.hits === t.hits && rest(w) === rest(t));
    return { bezig: !over, over, start: spel.start, veld: spel.veld, boten, deelnemers, volgorde, geldig, mijnen,
             winnaar: over && w ? w : null, gelijk, log };
  }

  // ---- Scheepsjournaal van een zeeslag (uit de opgeslagen gegevens) ----
  // posTs: wie deed er mee (zie stand). Notities bij de start, elke treffer, mijn of straf,
  // en het einde. Missers, kisten en gelegde mijnen tussendoor komen samen in de volgende notitie.
  // → [{ t, kop, tekst }] (oud → nieuw)
  function journaal(spel, naam, posTs) {
    const st = stand(spel, posTs, Infinity);
    if (!st.start) return [];
    let zaad = Math.floor(st.start / 1000) % 2147483647 || 1;
    const kies = l => l[(zaad = zaad * 16807 % 2147483647) % l.length];
    const lijst = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' en ' + a[a.length - 1];
    const nog = n => n > 0 ? `nog ${harten(n)}` : null;
    const zinkt = d => kies([`${naam(d)} zinkt naar de kelder van Davy Jones! ☠️`, `${naam(d)} gaat kopje onder — een wrak op de bodem van de zee. ☠️`]);
    const uit = [], tussendoor = {};          // per boot: { mis, kisten: [buit], mijnen }
    const opsparen = (b, wat, x) => { const t = tussendoor[b] = tussendoor[b] || { mis: 0, kisten: [], mijnen: 0 };
      if (wat === 'kist') t.kisten.push(x); else t[wat]++; };
    const intussen = () => {
      const zinnen = Object.entries(tussendoor).map(([b, t]) => {
        const d = [];
        if (t.mis) d.push(t.mis === 1 ? 'vuurde een salvo in het water' : `vuurde ${t.mis} salvo's in het water`);
        if (t.kisten.length) d.push(`viste ${lijst(t.kisten.map(k => `${BUIT[k].icoon} ${BUIT[k].naam}`))} uit ${t.kisten.length === 1 ? 'een schatkist' : t.kisten.length + ' schatkisten'}`);
        if (t.mijnen) d.push(t.mijnen === 1 ? 'legde een zeemijn' : `legde ${t.mijnen} zeemijnen`);
        return d.length ? `${naam(b)} ${lijst(d)}` : '';
      }).filter(Boolean);
      Object.keys(tussendoor).forEach(b => delete tussendoor[b]);
      return zinnen.length ? ` Intussen: ${zinnen.join('; ')}.` : '';
    };
    const noteer = (t, kop, tekst) => uit.push({ t, kop: `${klokHM(t)} · ${kop}`, tekst: tekst + intussen() });

    const namen = st.deelnemers.map(naam);
    uit.push({ t: st.start, kop: `${klokHM(st.start)} · de zeeslag begint`, tekst:
      kies(['Boem! Het kanon bulderde: de zeeslag is begonnen.', 'Arr, de vlag met de doodskop gaat in top: de zeeslag is begonnen!']) +
      (namen.length ? ` Op het water: ${lijst(namen)}, elk met ${SPEL.levens} levens en ${SPEL.schoten} salvo's.` : '') +
      (st.veld && st.veld.r ? ` Het speelveld is een cirkel met een straal van ${formatAfstand(st.veld.r)}; wie erbuiten vaart, verliest elke ${SPEL.strafMs / 1000} seconden een leven.` : '') });

    // het moment dat het speelveld begint te krimpen (als de zeeslag dan nog woedt)
    const krimpT = st.start + SPEL.krimpNaMs, gebeurtenissen = [...st.log];
    if (st.veld && st.veld.r && (st.over || Infinity) > krimpT) gebeurtenissen.push({ t: krimpT, soort: 'krimp' });
    gebeurtenissen.sort((a, c) => a.t - c.t).forEach(e => {
      if (e.soort === 'krimp') {
        const min = straal(st.veld, st.start, Infinity);
        return noteer(e.t, 'het speelveld krimpt', kies(['Arr, de zee trekt zich samen!', 'De kaart wordt kleiner, mateys!']) +
          ` Het speelveld krimpt in ${SPEL.krimpDuurMs / 60000} minuten van ${formatAfstand(st.veld.r)} naar ${formatAfstand(min)} straal. Wie niet meekrimpt, ligt er zo buiten.`);
      }
      const ik = naam(e.b);
      if (e.soort === 'kist') return opsparen(e.b, 'kist', e.buit);
      if (e.soort === 'mijn') return opsparen(e.b, 'mijnen');
      if (e.soort === 'schot' && !e.raak.length && !e.geblokt.length) return opsparen(e.b, 'mis');
      if (e.soort === 'schot') {
        const lading = e.lading ? ` (met ${BUIT[e.lading].icoon} ${BUIT[e.lading].naam})` : '';
        const zinnen = [];
        if (e.raak.length) zinnen.push(kies([`💥 ${ik} vuurt een volle breedzijde af${lading} en raakt ${lijst(e.raak.map(naam))}!`,
          `💥 Kanonnen bulderen: ${ik} treft ${lijst(e.raak.map(naam))}${lading}.`, `💥 Raak! De kogels van ${ik}${lading} slaan in bij ${lijst(e.raak.map(naam))}.`]));
        e.raak.forEach(d => zinnen.push(e.levens[d] > 0 ? `${naam(d)} heeft ${nog(e.levens[d])}.` : zinkt(d)));
        e.geblokt.forEach(d => zinnen.push(`🛡️ Het schild van ${naam(d)} vangt de kogels van ${ik} op.`));
        noteer(e.t, e.raak.length ? `${ik} raakt ${lijst(e.raak.map(naam))}` : `${ik} schiet op een schild`, zinnen.join(' '));
      } else if (e.soort === 'mijnraak') {
        noteer(e.t, `${ik} op een zeemijn`, `💣 ${ik} vaart op de zeemijn van ${naam(e.eigenaar)}!` +
          (e.geblokt ? ` Het schild vangt de klap op. 🛡️` : ' ' + (e.levens > 0 ? `${ik} heeft ${nog(e.levens)}.` : zinkt(e.b))));
      } else if (e.soort === 'straf') {
        noteer(e.t, `${ik} buiten het speelveld`, `${ik} dreef buiten het speelveld en verliest een leven. ` +
          (e.levens > 0 ? `${ik} heeft ${nog(e.levens)}.` : zinkt(e.b)));
      }
    });

    if (st.over) {
      const rest = b => SPEL.schoten - b.gebruikt;
      noteer(st.over, 'einde van de zeeslag', statusTekst(st, naam) + (st.volgorde.length ? ' Eindstand: ' + st.volgorde.map((b, i) =>
        `${i + 1}. ${naam(b.boot)} — ${b.levens ? harten(b.levens) : '☠️ gezonken'}, ${b.hits}× raak, ${rest(b)} salvo's over`).join('; ') + '.' : ''));
    } else {
      const t = Math.max(st.start, ...st.log.map(e => e.t));
      const extra = intussen();
      if (extra) uit.push({ t, kop: `${klokHM(t)} · de zeeslag woedt nog`, tekst: extra.trim() });
    }
    return uit;
  }
  const harten = n => '❤️'.repeat(Math.max(0, n)) + '🖤'.repeat(Math.max(0, SPEL.levens - n));
  // Levens, met een schild en 💰 als het schip lading uit een kist heeft (welke, ziet alleen de eigenaar)
  const levensTekst = b => harten(b.levens) + (b.levens > 0 ? (b.schild ? ' 🛡️' : '') + (b.lading ? ' 💰' : '') : '');
  // Wat een schip nu bij zich heeft en wat er loopt (voor de eigen statusregel)
  function effectenTekst(b, nu) {
    const uit = [], klok = ms => formatDuur(Math.ceil(ms / 1000) * 1000);
    if (b.lading) uit.push(`${BUIT[b.lading].icoon} ${BUIT[b.lading].naam}`);
    if (b.schild) uit.push('🛡️ schild');
    if (b.spookTot > nu) uit.push(`👻 spookschip ${klok(b.spookTot - nu)}`);
    if (b.snelTot > nu) uit.push(`⚡ snel herladen ${klok(b.snelTot - nu)}`);
    if (b.valTot > nu) uit.push(`🪤 boobytrap ${klok(b.valTot - nu)}`);
    return uit.join(' · ');
  }
  // Herlaadtijd na het laatste salvo (gehalveerd als dat salvo viel tijdens 'snel herladen')
  const herlaadDuur = (b, t) => SPEL.herlaadMs / (b && t < b.snelTot ? 2 : 1);
  const spook = (b, nu) => !!(b && b.levens > 0 && b.spookTot > nu);

  // ---- Scorebord ----
  function scoreHtml(st, naam, eigen) {
    if (!st.deelnemers.length) return '<div class="spel-leeg">Nog geen schepen op het water.</div>';
    return '<table class="spel-tabel"><thead><tr><th>Schip</th><th>Levens</th><th class="tijd">Raak</th><th class="tijd">Salvo\'s</th></tr></thead><tbody>' +
      st.volgorde.map((b, i) => `<tr class="${b.levens ? '' : 'wrak'}${b.boot === eigen ? ' eigen' : ''}">` +
        `<td class="boot-cel">${st.over && i === 0 && !st.gelijk ? '👑 ' : ''}<span class="dot" style="background:${BOTEN[b.boot].kleur}"></span>${esc(naam(b.boot))}</td>` +
        `<td>${b.levens ? levensTekst(b) : '☠️ gezonken'}</td><td class="tijd">${b.hits}</td>` +
        `<td class="tijd">${SPEL.schoten - b.gebruikt}</td></tr>`).join('') + '</tbody></table>';
  }
  // Overzicht van wat er in een schatkist kan zitten, met de kans (uit BUIT)
  function buitHtml() {
    const totaal = Object.values(BUIT).reduce((t, b) => t + b.kans, 0);
    return '<ul class="buit-lijst">' + Object.values(BUIT).map(b =>
      `<li><div class="buit-kop"><span>${b.icoon} ${esc(b.naam)}</span><span class="buit-kans">${Math.round(b.kans / totaal * 100)}%</span></div>` +
      `<div class="buit-tekst">${esc(b.tekst)}${b.lading ? ' <i>Bewaar je tot je hem gebruikt.</i>' : ''}</div></li>`).join('') + '</ul>';
  }
  function statusTekst(st, naam) {
    if (!st.start) return '';
    if (st.wacht) return `De kanonnen worden geladen: de zeeslag begint om ${formatKlok(st.start)}.`;
    if (st.bezig) {
      const r = straal(st.veld, st.start, Date.now());
      return `De zeeslag woedt sinds ${klokHM(st.start)}.` + (st.veld && r < st.veld.r
        ? ` Het speelveld krimpt: straal nu ${formatAfstand(r)}.`
        : st.veld && st.veld.r ? ` Om ${klokHM(st.start + SPEL.krimpNaMs)} begint het speelveld te krimpen.` : '');
    }
    if (!st.winnaar) return 'De zeeslag is voorbij.';
    return st.gelijk ? 'De zeeslag is voorbij — onbeslist! Gelijke stand aan kop.'
      : `De zeeslag is voorbij. ${naam(st.winnaar.boot)} is de schrik van de zeven zeeën! 🏴‍☠️`;
  }

  // ---- Kaart: speelveld, richtlijnen en vliegende kanonskogels ----
  function veldLaag(kaart, veld, oud) {
    if (oud) kaart.removeLayer(oud);
    if (!veld || !veld.r) return null;
    return L.circle([veld.lat, veld.lng], { radius: veld.r, color: '#8b1e12', weight: 3, dashArray: '10 8',
      fillColor: '#8b1e12', fillOpacity: 0.04, interactive: false }).addTo(kaart);
  }
  // Stippellijnen: de randen van de waaier waarbinnen de breedzijde valt (geen middenlijn)
  // lading = wat het schip uit een kist heeft: langere, wijdere of extra (vooruit) lijnen
  function richtlijnen(kaart, pos, koers, oud, eigen, lading) {
    if (oud) kaart.removeLayer(oud);
    if (!pos || koers == null) return null;
    const g = L.layerGroup(), kleur = eigen ? '#8b1e12' : '#2b1b0d';
    const spreiding = lading === 'breed' ? SPEL.breedGr : SPEL.spreidingGr, lengte = bereik({ groot: lading === 'bereik' });
    [90, -90].concat(lading === 'voor' ? [0] : []).forEach(zij => [-spreiding, spreiding].forEach(w => {
      const r = richting(pos, koers + zij + w, lengte);
      L.polyline([[pos.lat, pos.lng], [r.lat, r.lng]], { color: kleur, weight: eigen ? 2 : 1.5, dashArray: '2 6',
        opacity: eigen ? .85 : .45, interactive: false }).addTo(g);
    }));
    return g.addTo(kaart);
  }
  function wolkje(kaart, p, straal, kleur, duur) {           // kruitdamp of een plons
    const c = L.circleMarker([p.lat, p.lng], { radius: straal, stroke: false, fillColor: kleur, fillOpacity: .8, interactive: false }).addTo(kaart);
    const t0 = performance.now();
    (function stap(nu) {
      const f = Math.min(1, (nu - t0) / duur);
      c.setRadius(straal * (1 + f * 1.8)); c.setStyle({ fillOpacity: .8 * (1 - f) });
      if (f < 1) requestAnimationFrame(stap); else kaart.removeLayer(c);
    })(t0);
  }
  function ontploffing(kaart, p, teken = '💥') {
    const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="kanon-raak">${teken}</div>`, iconSize: [44, 44] }), interactive: false }).addTo(kaart);
    setTimeout(() => kaart.removeLayer(m), 2600);
  }
  // Zeemijnen op de kaart (alleen voor de eigenaar en de wedstrijdleiding)
  function mijnLagen(kaart, lijst, oud) {
    if (oud) kaart.removeLayer(oud);
    if (!lijst.length) return null;
    const g = L.layerGroup();
    lijst.forEach(m => {
      L.circle([m.lat, m.lng], { radius: SPEL.mijnM, color: '#2b1b0d', weight: 1.5, dashArray: '2 5', fillColor: '#2b1b0d',
        fillOpacity: 0.08, interactive: false }).addTo(g);
      L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', html: '<div class="zeemijn">💣</div>', iconSize: [26, 26] }),
        interactive: false, keyboard: false }).addTo(g);
    });
    return g.addTo(kaart);
  }
  // Een open schatkist met goud (SVG, 34 × 30 px)
  const SCHATKIST = '<svg viewBox="0 0 32 28" width="34" height="30" aria-hidden="true">' +
    '<path d="M4 13 L6.5 3 H25.5 L28 13 Z" fill="#6e3a16" stroke="#2b1b0d" stroke-width="1.4" stroke-linejoin="round"/>' +   // open deksel
    '<path d="M8.5 3.5 L7.5 13 M23.5 3.5 L24.5 13" stroke="#d9a93a" stroke-width="2"/>' +                                   // beslag op het deksel
    '<path d="M4 14.5 Q7 8.5 11 11 Q15 6.5 19 10 Q24 7 28 14.5 Z" fill="#f2c94c" stroke="#a87b12" stroke-width="1"/>' +       // het goud
    '<circle cx="11" cy="10.5" r="1.6" fill="#fff3b0"/><circle cx="20" cy="9.5" r="1.3" fill="#fff3b0"/>' +                 // glinstering
    '<rect x="3" y="13" width="26" height="12.5" rx="1.5" fill="#9a5520" stroke="#2b1b0d" stroke-width="1.4"/>' +             // de kist
    '<path d="M3.7 19.2 H28.3" stroke="#5e3311" stroke-width="1"/>' +
    '<rect x="7" y="13" width="3" height="12.5" fill="#d9a93a"/><rect x="22" y="13" width="3" height="12.5" fill="#d9a93a"/>' +
    '<rect x="13.5" y="15" width="5" height="6" rx="1" fill="#f3d36b" stroke="#2b1b0d" stroke-width="1"/>' +                // slot
    '<circle cx="16" cy="17.6" r=".9" fill="#2b1b0d"/></svg>';
  // Schatkisten op de kaart, elk met de cirkel waarbinnen je hem pakt (kistPakM).
  // Alleen de kisten die erbij komen of weg zijn, worden bijgewerkt.
  // De animatie zit op een binnenste div: Leaflet zet de marker zelf op zijn plek met transform.
  // Elke kist dobbert in een eigen ritme (verschoven animatie).
  function kistLagen(kaart, lijst, oud) {
    const laag = oud || { groep: L.layerGroup().addTo(kaart), markers: {} }, nu = new Set(lijst.map(k => String(k.nr)));
    Object.keys(laag.markers).forEach(nr => { if (!nu.has(nr)) { laag.groep.removeLayer(laag.markers[nr]); delete laag.markers[nr]; } });
    lijst.forEach(k => {
      if (laag.markers[k.nr]) return;
      const html = `<div class="buitkist" style="animation-delay:-${(k.nr * 0.37 % 2.4).toFixed(2)}s">${SCHATKIST}</div>`;
      laag.markers[k.nr] = L.layerGroup([
        L.circle([k.lat, k.lng], { radius: SPEL.kistPakM, color: '#b8860b', weight: 2, dashArray: '4 6',
          fillColor: '#f0c75e', fillOpacity: 0.15, interactive: false }),
        L.marker([k.lat, k.lng], { icon: L.divIcon({ className: '', html, iconSize: [34, 30] }), interactive: false, keyboard: false })
      ]).addTo(laag.groep);
    });
    return laag;
  }
  // Een salvo afspelen. doelPos(boot) → huidige positie van een geraakte boot.
  function animeer(kaart, schot, raak, doelPos, geblokt = []) {
    const van = [schot.lat, schot.lng], duur = 1200;
    // kruitdamp aan beide kanten van het schip
    [90, -90].forEach(z => wolkje(kaart, richting(schot, schot.koers + z, 10), 9, '#e6dcc6', 1400));
    kogels(schot).forEach(k => {                        // alleen de vliegende kogels, zonder spoor erachter
      const bol = L.circleMarker(van, { radius: 3, color: '#000', weight: 1, fillColor: '#161616', fillOpacity: 1, interactive: false });
      setTimeout(() => {
        bol.addTo(kaart);
        const t0 = performance.now();
        (function stap(nu) {
          const f = Math.min(1, (nu - t0) / duur);
          bol.setLatLng([schot.lat + (k.eind.lat - schot.lat) * f, schot.lng + (k.eind.lng - schot.lng) * f]);
          if (f < 1) { requestAnimationFrame(stap); return; }
          kaart.removeLayer(bol); wolkje(kaart, k.eind, 4, '#bfe3ff', 900);
        })(t0);
      }, k.vertraging);
    });
    setTimeout(() => {
      raak.forEach(b => { const p = doelPos(b); if (p) ontploffing(kaart, p); });
      geblokt.forEach(b => { const p = doelPos(b); if (p) ontploffing(kaart, p, '🛡️'); });   // het schild ving hem op
    }, duur * 0.7);
  }

  return { kogels, raakt, binnenVeld, straal, veldOp, stand, journaal, buitHtml, harten, levensTekst, effectenTekst, herlaadDuur, spook, scoreHtml, statusTekst,
           veldLaag, richtlijnen, animeer, ontploffing, kisten, kistLagen, inhoud, bereik, mijnLagen, SCHOT_VLAG };
})();
