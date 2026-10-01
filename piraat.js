// ============================================================
//  Zeilrace — het piratenspel (mini-game, in de stijl van de klassieke
//  breedzijde-zeeslagen). Elke tracker kan het kanon afvuren: een salvo
//  van kogels, haaks op de koers, naar bakboord én stuurboord. Komt een
//  kogel binnen 20 m van een andere boot, dan is het raak.
//  Elke boot heeft 3 levens en 10 salvo's. Wie geraakt is, kan 1 minuut
//  niet schieten. Buiten het speelveld (een cirkel
//  van de wedstrijdleiding) kost elke 20 seconden een leven.
//  In het speelveld drijven 20 schatkisten, op plekken die iedereen zelf
//  uitrekent. Elke kist verhuist na 4 minuten naar een nieuwe plek; een
//  gepakte kist komt dan ook terug. Vaar erlangs (binnen 50 m) en je
//  volgende salvo reikt twee keer zo ver. Je kunt één kist tegelijk hebben.
//
//  Database: races/{race}/spel = { start, eind?, veld: {lat,lng,r},
//    schoten: {boot: {0..9: {ts, lat, lng, koers, groot?, raak: {doelboot: true}}}},
//    straf:   {boot: {0..2: ts}},
//    buit:    {kistnr: {boot, ts}} }   (wie de kist het eerst pakt)
//  De stand wordt door iedereen op dezelfde manier uit die gegevens berekend,
//  en de kogelwolk van een salvo is voor iedereen gelijk (vast zaad = ts).
// ============================================================
const SPEL = {
  levens: 3, schoten: 10, bereikM: 150, raakM: 20, strafMs: 20000,
  herlaadMs: 60000,           // kanon herladen tussen twee salvo's (1 minuut)
  geraaktMs: 60000,           // na een treffer ligt je kanon zo lang stil (1 minuut)
  kogelsPerKant: 10,          // de 'wolk' van kogels per breedzijde
  spreidingGr: 8,             // kogels waaieren ± zoveel graden uit
  kistAantal: 20,             // zoveel schatkisten drijven er tegelijk in het speelveld
  kistDuurMs: 240000,         // na 4 minuten verhuist een kist naar een nieuwe plek
  kistPakM: 50,               // zo dichtbij moet je langs een kist varen (de cirkel om de kist)
  kistBereik: 2               // met een kist reikt je volgende salvo zoveel keer zo ver
};

const Piraat = (() => {
  const M_PER_GRAAD = 111320;
  const naarXY = (o, p) => ({ x: (p.lng - o.lng) * M_PER_GRAAD * Math.cos(o.lat * Math.PI / 180), y: (p.lat - o.lat) * M_PER_GRAAD });
  const vanXY = (o, x, y) => ({ lat: o.lat + y / M_PER_GRAAD, lng: o.lng + x / (M_PER_GRAAD * Math.cos(o.lat * Math.PI / 180)) });
  const richting = (o, peil, lengte) => { const t = peil * Math.PI / 180; return vanXY(o, Math.sin(t) * lengte, Math.cos(t) * lengte); };

  const bereik = schot => SPEL.bereikM * (schot && schot.groot ? SPEL.kistBereik : 1);

  // ---- Buitkisten: kist nr = ronde × kistAantal + plek ----
  // Elke plek begint een nieuwe ronde (nieuwe kist, nieuwe plaats) om de kistDuurMs,
  // per plek een beetje verschoven zodat niet alle kisten tegelijk verhuizen.
  // De plaats volgt uit start en nr (vast zaad), dus iedereen ziet dezelfde kisten.
  const kistVerschuiving = plek => plek * SPEL.kistDuurMs / SPEL.kistAantal;
  function kist(spel, nr) {
    const plek = nr % SPEL.kistAantal, ronde = Math.floor(nr / SPEL.kistAantal);
    const begin = spel.start + kistVerschuiving(plek) + ronde * SPEL.kistDuurMs;
    const v = spel.veld, van = ronde ? begin : spel.start;
    let s = (Math.floor(spel.start / 1000) + nr * 7919) % 2147483647 || 1;
    const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
    rnd(); rnd();
    const r = v.r * 0.85 * Math.sqrt(rnd()), hoek = rnd() * 360;   // gelijkmatig verdeeld over de cirkel
    return Object.assign({ nr, van, tot: begin + SPEL.kistDuurMs }, richting(v, hoek, r));
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
    const uit = [], n = SPEL.kogelsPerKant;
    ['sb', 'bb'].forEach(kant => {
      for (let i = 0; i < n; i++) {
        const waaier = n > 1 ? -SPEL.spreidingGr + 2 * SPEL.spreidingGr * i / (n - 1) : 0;
        const peil = schot.koers + (kant === 'sb' ? 90 : -90) + waaier + (rnd() - 0.5) * 3;
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
  const binnenVeld = (veld, pos) => !veld || afstandMeter(veld, pos) <= veld.r;

  // ---- De stand: alle salvo's en strafpunten op tijdvolgorde afspelen ----
  // posTs = { boot: tijd van de laatste positie } → wie doet er mee.
  function stand(spel, posTs) {
    const boten = {};
    FLEET.forEach(b => { boten[b] = { boot: b, levens: SPEL.levens, hits: 0, gebruikt: 0, straf: 0, dood: null, laatsteSchot: null, geraakt: null, kist: false, kisten: 0 }; });
    if (!spel || !spel.start) return { bezig: false, over: null, boten, deelnemers: [], volgorde: [], geldig: [], veld: spel && spel.veld };
    const ev = [];
    Object.entries(spel.schoten || {}).forEach(([b, l]) => Object.entries(l || {}).forEach(([nr, s]) =>
      s && s.ts != null && ev.push({ soort: 'schot', b, t: s.ts, s, id: b + '/' + nr })));
    Object.entries(spel.straf || {}).forEach(([b, l]) => Object.values(l || {}).forEach(t =>
      t != null && ev.push({ soort: 'straf', b, t })));
    Object.entries(spel.buit || {}).forEach(([nr, k]) =>
      k && k.boot && k.ts != null && ev.push({ soort: 'kist', b: k.boot, t: k.ts, nr: +nr }));
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
    const geldig = [];
    for (const e of ev) {
      if (over || (spel.eind && e.t > spel.eind)) break;
      const ik = boten[e.b];
      if (!ik || ik.levens <= 0) continue;                             // een wrak schiet niet meer
      if (e.soort === 'straf') {
        ik.levens--; ik.straf++;
        if (!ik.levens) ik.dood = e.t;
      } else if (e.soort === 'kist') {
        // telt als de kist toen in het water lag (10 s speling voor een trage verbinding)
        const k = spel.veld ? kist(spel, e.nr) : null;
        if (k && !ik.kist && e.t >= k.van && e.t <= k.tot + 10000) { ik.kist = true; ik.kisten++; }
      } else {
        if (ik.gebruikt >= SPEL.schoten) continue;
        if (ik.geraakt != null && e.t < ik.geraakt + SPEL.geraaktMs) continue;   // net geraakt: het kanon ligt stil
        ik.gebruikt++; ik.laatsteSchot = e.t;
        if (e.s.groot) ik.kist = false;                                // de kist is verschoten
        const raak = Object.keys(e.s.raak || {}).filter(d => boten[d] && d !== e.b && boten[d].levens > 0);
        raak.forEach(d => { boten[d].levens--; boten[d].geraakt = e.t; ik.hits++; if (!boten[d].levens) boten[d].dood = e.t; });
        geldig.push({ id: e.id, boot: e.b, schot: e.s, raak });
      }
      if (klaar()) over = e.t;
    }
    if (!over && spel.eind) over = spel.eind;
    const rest = b => SPEL.schoten - b.gebruikt;
    const volgorde = deelnemers.map(b => boten[b])
      .sort((a, c) => c.levens - a.levens || c.hits - a.hits || rest(c) - rest(a));
    const [w, t] = volgorde;
    const gelijk = !!(w && t && w.levens === t.levens && w.hits === t.hits && rest(w) === rest(t));
    return { bezig: !over, over, start: spel.start, veld: spel.veld, boten, deelnemers, volgorde, geldig,
             winnaar: over && w ? w : null, gelijk };
  }
  const harten = n => '❤️'.repeat(Math.max(0, n)) + '🖤'.repeat(Math.max(0, SPEL.levens - n));
  // Levens, en een kist als het volgende salvo extra ver reikt
  const levensTekst = b => harten(b.levens) + (b.kist && b.levens > 0 ? ' 💰' : '');

  // ---- Scorebord ----
  function scoreHtml(st, naam, eigen) {
    if (!st.deelnemers.length) return '<div class="spel-leeg">Nog geen schepen op het water.</div>';
    return '<table class="spel-tabel"><thead><tr><th>Schip</th><th>Levens</th><th class="tijd">Raak</th><th class="tijd">Salvo\'s</th></tr></thead><tbody>' +
      st.volgorde.map((b, i) => `<tr class="${b.levens ? '' : 'wrak'}${b.boot === eigen ? ' eigen' : ''}">` +
        `<td class="boot-cel">${st.over && i === 0 && !st.gelijk ? '👑 ' : ''}<span class="dot" style="background:${BOTEN[b.boot].kleur}"></span>${esc(naam(b.boot))}</td>` +
        `<td>${b.levens ? levensTekst(b) : '☠️ gezonken'}</td><td class="tijd">${b.hits}</td>` +
        `<td class="tijd">${SPEL.schoten - b.gebruikt}</td></tr>`).join('') + '</tbody></table>';
  }
  function statusTekst(st, naam) {
    if (!st.start) return '';
    if (st.bezig) return `De zeeslag woedt sinds ${klokHM(st.start)}.`;
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
  function richtlijnen(kaart, pos, koers, oud, eigen, groot) {
    if (oud) kaart.removeLayer(oud);
    if (!pos || koers == null) return null;
    const g = L.layerGroup(), kleur = eigen ? '#8b1e12' : '#2b1b0d';
    [90, -90].forEach(zij => [-SPEL.spreidingGr, SPEL.spreidingGr].forEach(w => {
      const r = richting(pos, koers + zij + w, bereik({ groot }));
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
  function ontploffing(kaart, p) {
    const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="kanon-raak">💥</div>', iconSize: [44, 44] }), interactive: false }).addTo(kaart);
    setTimeout(() => kaart.removeLayer(m), 2600);
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
  function animeer(kaart, schot, raak, doelPos) {
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
    setTimeout(() => raak.forEach(b => { const p = doelPos(b); if (p) ontploffing(kaart, p); }), duur * 0.7);
  }

  return { kogels, raakt, binnenVeld, stand, harten, levensTekst, scoreHtml, statusTekst, veldLaag, richtlijnen, animeer,
           kisten, kistLagen, bereik };
})();
