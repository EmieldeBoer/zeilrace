// ============================================================
//  Zeilrace — tracker (telefoon op de boot)
//  Stuurt GPS door, detecteert start/boeien/finish, toont de baan,
//  andere boten, wind, een grote aftelklok en een GPS-alarm.
// ============================================================
const FLEET = Object.keys(BOTEN);
const P = `races/${RACE_ID}`;
const $ = id => document.getElementById(id);

const bootSelect = $('boot'), naamInput = $('naam'), knop = $('knop');
FLEET.forEach(b => {
  const o = document.createElement('option');
  o.value = b; o.textContent = BOTEN[b].model;
  bootSelect.appendChild(o);
});
const vooraf = new URLSearchParams(location.search).get('boot');
if (vooraf && BOTEN[vooraf]) bootSelect.value = vooraf;
const mijnBoot = () => bootSelect.value;

const el = {
  status: $('status'), dot: $('dot'), tekst: $('statustekst'),
  pos: $('pos'), acc: $('acc'), warn: $('warn')
};
function meld(tekst, soort) { el.warn.textContent = tekst; el.warn.className = 'warn' + (soort ? ' ' + soort : ''); }
function tip(tekst) {
  const t = $('tip'); t.textContent = tekst; t.hidden = false;
  clearTimeout(tip.timer); tip.timer = setTimeout(() => { t.hidden = true; }, 3500);
}
function schrijf(belofte) { return belofte.catch(e => meld(dbFoutTekst(e), 'fout')); }

document.addEventListener('pointerdown', initAudio, { once: true });

// ---- Toestand ----
let watchId = null, wakeLock = null, laatsteSchrijf = 0, laatsteFix = 0, timesRef = null;
const SCHRIJF_INTERVAL = 3000;     // max 1x per 3 sec naar de database
let lijnen = {}, raceStart = null, startPlan = null, boeien = [];
let mijnTijden = { start: null, finish: null }, mijnGerond = {}, vorigeRuwe = null, mijnPositie = null;
let volgDoel = null;               // 'eigen' | bootnaam | null
let voorstel = null, akkoordData = {}, bekendVoorstel, laatsteVoorstelT = null;   // startvoorstel van de wedstrijdleiding + akkoord per boot
let mijnKoers = null, koersVan = null;   // koers (graden) voor het kanon
let kNamen = {};
const kNaam = b => (kNamen[b] && String(kNamen[b]).trim()) ? String(kNamen[b]).trim() : BOTEN[b].model;
// Jouw eigen starttijd (bij een achtervolgingsstart later dan het eerste sein)
const mijnStart = () => raceStart != null ? raceStart + vertragingVan(startPlan, mijnBoot()) : null;
// De baan van een boot: bij een lusstart met de eigen lus erin
const baanVan = b => baanVanBoot(boeien, lussenVan(startPlan), b);
const mijnBaan = () => baanVan(mijnBoot());

// =========================================================
//  Kaart: baan, rondingslijnen, alle boten + zoom/volg-knoppen
// =========================================================
const kaart = maakKaart('kaart');
const kMarkers = {}, kSporen = {}, kSpoorPunten = {}, botStatus = {};
let kBaan = [], kGefit = false, doelLijn = null;
maakWindWidget(kaart);
kaartKnoppen(kaart, [
  { id: 'knopVolg', tekst: '🎯', titel: 'Zoom naar mijn boot en volg hem', klik: volgEigenBoot },
  { id: 'knopOverzicht', tekst: '⛶', titel: 'Hele baan tonen', klik: overzicht }
]);
kaart.on('dragstart', () => zetVolg(null));

function zetVolg(doel) {
  volgDoel = doel;
  const k = $('knopVolg'); if (k) k.classList.toggle('actief', doel === 'eigen');
  renderAndereBoten();
}
function eigenPos() {
  if (mijnPositie) return mijnPositie;
  const s = botStatus[mijnBoot()];
  return s && s.lat != null ? { lat: s.lat, lng: s.lng } : null;
}
function volgEigenBoot() {
  const p = eigenPos();
  if (!p) { tip('Nog geen positie van je boot — druk eerst op Start tracking.'); return; }
  zetVolg('eigen');
  kaart.flyTo([p.lat, p.lng], Math.max(kaart.getZoom(), 17), { duration: .8 });
}
function volgBoot(naam) {
  const s = botStatus[naam];
  if (!s || s.lat == null) { tip(`${kNaam(naam)} heeft nog geen positie.`); return; }
  zetVolg(naam);
  kaart.flyTo([s.lat, s.lng], Math.max(kaart.getZoom(), 16), { duration: .8 });
  $('kaart').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function overzicht() {
  zetVolg(null);
  const lagen = [...kBaan, ...Object.values(kMarkers)];
  if (lagen.length) kaart.fitBounds(L.featureGroup(lagen).getBounds(), { padding: [40, 40], maxZoom: 16 });
}
function fitEen() {
  if (kGefit) return;
  const lagen = [...kBaan, ...Object.values(kMarkers)];
  if (!lagen.length) return;
  const b = L.featureGroup(lagen).getBounds();
  if (b.isValid()) { kaart.fitBounds(b, { padding: [40, 40], maxZoom: 16 }); kGefit = true; }
}

function tekenCourse() {
  kBaan.forEach(l => kaart.removeLayer(l));
  kBaan = [];
  ['start', 'finish'].forEach(t => {
    const ln = lijnen[t];
    if (!(ln && ln.a && ln.b)) return;
    tekenStartFinish(kaart, ln, t, kBaan)
      .bindTooltip(t === 'start' ? 'START' : 'FINISH', { permanent: true, direction: 'center', className: 'lijn-label' });
  });
  // Alleen je eigen lus: de lussen van de andere boten doen voor jou niet mee
  const baan = mijnBaan(), kleur = BOTEN[mijnBoot()].kleur;
  tekenRondingslijnen(kaart, baan, lijnen, kBaan);       // in de kleur van de boei: hier moet je overheen om te ronden
  baan.forEach(b => kBaan.push(L.marker([b.lat, b.lng], { icon: b.lus ? lusIcoon(b.letter, kleur) : boeiIcoon(b.nr - 1) })
    .addTo(kaart).bindTooltip(esc(b.label), { direction: 'top', offset: [0, -12] })));
  const route = [];
  if (lijnen.start && lijnen.start.a) { const m = lijnMidden(lijnen.start); route.push([m.lat, m.lng]); }
  baan.forEach(b => route.push([b.lat, b.lng]));
  if (lijnen.finish && lijnen.finish.a) { const m = lijnMidden(lijnen.finish); route.push([m.lat, m.lng]); }
  if (route.length >= 2) kBaan.push(L.polyline(route, { color: '#9fb4cd', weight: 2, dashArray: '3 8', opacity: .8, interactive: false }).addTo(kaart));
  fitEen();
}

// Schepen op de kaart: eigen schip met een gouden gloed, gezonken = wrak
function markeerEigen() {
  const spel = !!(spelStand && spelStand.start);          // zeeslag gestart → piratenschepen
  Object.keys(kMarkers).forEach(n => zetSchipStaat(kMarkers[n], {
    eigen: n === mijnBoot(), spel,
    wrak: !!(spel && spelStand.boten[n].levens <= 0 && spelStand.deelnemers.includes(n)) }));
}
// Label boven het schip: naam, en tijdens de zeeslag de levens (en een buitkist)
function schipLabel(n) {
  const inSpel = spelStand && spelStand.start && spelStand.deelnemers.includes(n);
  return esc(kNaam(n)) + (inSpel ? ' ' + Piraat.levensTekst(spelStand.boten[n]) : '');
}
const vorigePos = {};
function zetMarker(naam, lat, lng, koers) {
  const p = { lat, lng };
  if (koers == null) koers = koersUitBeweging(vorigePos[naam], p);
  if (koers != null || !vorigePos[naam]) vorigePos[naam] = p;
  if (!kMarkers[naam]) {
    kMarkers[naam] = maakSchip([lat, lng], naam)
      .addTo(kaart).bindTooltip(schipLabel(naam), { permanent: true, direction: 'top', className: 'boot-label', offset: schipLabelOffset(naam) });
    markeerEigen();
  } else kMarkers[naam].setLatLng([lat, lng]);
  zetKoers(kMarkers[naam], koers);
  if (koers != null) scheepsKoers[naam] = koers;
  tekenRichtlijnen(naam);
}

// Wind op de plek van je boot (of de startlijn)
function windPlek() {
  if (mijnPositie) return mijnPositie;
  if (lijnen.start && lijnen.start.a) return lijnMidden(lijnen.start);
  const c = kaart.getCenter(); return { lat: c.lat, lng: c.lng };
}
toonWind(windPlek());
setInterval(() => toonWind(windPlek()), 5 * 60 * 1000);

// =========================================================
//  Navigatie naar het volgende doel
// =========================================================
let navVorige = null, mijnSnelheid = null, mijnHeading = null;
const volgendDoel = pos => doelVanBoot(pos, mijnTijden.start, mijnTijden.finish, mijnGerond, lijnen, mijnBaan());
const kleinLabel = l => l.charAt(0).toLowerCase() + l.slice(1);     // 'Lusboei A' → 'lusboei A'
function volgendDoelLabel() {
  if (mijnTijden.finish != null) return null;
  if (mijnTijden.start == null) return 'de startlijn';
  const v = mijnBaan().find(b => mijnGerond[b.id] == null);
  return v ? kleinLabel(v.label) : 'de finish';
}
// Bij elke eigen GPS-positie: snelheid/koers onthouden, lijn naar het doel op de kaart
function updateNav(lat, lng, speedMps, heading, nu) {
  mijnSnelheid = speedMps; mijnHeading = heading;
  const pos = { lat, lng }, doel = volgendDoel(pos);
  navVorige = { pos, ts: nu };
  if (!doel) { if (doelLijn) { kaart.removeLayer(doelLijn); doelLijn = null; } }
  else {
    const pad = [[lat, lng], [doel.punt.lat, doel.punt.lng]];
    if (!doelLijn) doelLijn = L.polyline(pad, { color: '#38d9c8', weight: 3, dashArray: '2 8', interactive: false }).addTo(kaart);
    else doelLijn.setLatLngs(pad);
  }
  renderEigenBoot();
}
function wisNav() {
  mijnSnelheid = mijnHeading = null;
  if (doelLijn) { kaart.removeLayer(doelLijn); doelLijn = null; }
  navVorige = null;
  renderEigenBoot();
}
// Je eigen boot als kaartje, precies zoals de andere boten (zelfde gegevens, zelfde opmaak)
function renderEigenBoot() {
  const b = mijnBoot(), tijden = tijdenNu(), t = tijden[b] || {};
  $('eigenDot').style.background = BOTEN[b].kleur;
  $('eigenNaam').textContent = kNaam(b);
  const eigenNaam = kNaam(b) !== BOTEN[b].model;
  $('eigenType').textContent = (eigenNaam ? BOTEN[b].model + ' · ' : '') + 'rating ' + BOTEN[b].rating.toFixed(3);
  $('eigenStatus').textContent = watchId !== null ? 'jij · live' : 'jij';
  // Precies dezelfde gegevens als de andere telefoons van jouw boot zien: uit de database
  // (elke 3 s bijgewerkt). Alleen zolang daar nog geen positie staat: je eigen GPS.
  const uitDb = botStatus[b] || {};
  const basis = uitDb.lat != null ? uitDb : mijnPositie ? Object.assign({}, uitDb, { lat: mijnPositie.lat, lng: mijnPositie.lng,
    speed: mijnSnelheid, heading: mijnHeading, start: t.start, finish: t.finish, gerond: mijnGerond }) : null;
  const s = basis && Object.assign({}, basis, { afgelegd: afgelegdVan(b, tijden[b]), win: tijdOmTeWinnen(b, tijden, raceStart, startPlan, Date.now()),
    voorspel: voorspellingVan(voorspelRijen, b) });
  const html = bootStatsHtml(bootData(s, lijnen, baanVan(b)));
  if ($('eigenStats').innerHTML !== html) $('eigenStats').innerHTML = html;
}
function updateStartInfo() {
  const box = $('startinfo'), t0 = mijnStart();
  if (t0 == null) { box.hidden = true; return; }
  const modus = startPlan && startPlan.modus;
  const verw = startPlan && startPlan.verwacht && startPlan.verwacht[mijnBoot()];
  const lus = lussenVan(startPlan) && lussenVan(startPlan)[mijnBoot()];
  box.hidden = false;
  box.textContent = `${startNaam(modus)} · jouw start ${formatKlok(t0)}` + (lus ? ` · jouw lus +${formatAfstand(lus.extraM)}` : '') +
    (verw ? ` · verwachte tijd ${formatDuur(verw)}` : '');
}

// =========================================================
//  Grote aftelklok naar JOUW start, met kanonschoten
// =========================================================
let vorigeRem = null;
function updateAftel() {
  const a = $('aftel'), t0 = mijnStart();
  if (t0 == null) { a.hidden = true; vorigeRem = null; return; }
  a.hidden = false;
  const rem = t0 - Date.now();
  if (vorigeRem != null) {
    if (vorigeRem > 300000 && rem <= 300000) speel(GELUID.vijfmin);
    if (vorigeRem > 60000 && rem <= 60000) speel(GELUID.eenmin);
    if (vorigeRem > 0 && rem <= 0) speel(GELUID.start);
  }
  vorigeRem = rem;
  const achter = startPlan && startPlan.modus === 'achtervolging';
  const vert = vertragingVan(startPlan, mijnBoot());
  if (rem > 0) {
    a.className = 'aftel' + (rem <= 60000 ? ' urgent' : '') + (rem <= 10000 ? ' laatste10' : '');
    a.innerHTML = `<div class="lbl">${achter ? 'JOUW START OVER' : 'START OVER'}</div>` +
      `<div class="groot">${formatDuur(rem)}</div><div class="lbl">om ${formatKlok(t0)}` +
      (achter ? ` · ${vert ? 'achtervolging +' + formatDuur(vert) : 'jij start als eerste'}` : '') + '</div>';
  } else {
    a.className = 'aftel gestart';
    const doel = volgendDoelLabel();
    a.innerHTML = `<div class="lbl">GESTART</div><div class="groot">${formatDuur(-rem)}</div>` +
      `<div class="lbl">${doel ? '➜ volgend doel: ' + doel : 'gefinisht 🏁'}</div>`;
  }
}
setInterval(() => { updateAftel(); renderVoorstel(); }, 500);

// =========================================================
//  Startvoorstel: akkoord geven op de starttijd
// =========================================================
// De wedstrijdleiding stelt een starttijd voor. Elke boot geeft hier akkoord (alleen
// de telefoon die de boot heeft geclaimd). Als iedereen akkoord is, ligt de start vast.
function renderVoorstel() {
  const box = $('voorstel');
  if (!voorstel || raceStart != null) { box.hidden = true; return; }
  box.hidden = false;
  const nu = Date.now(), ik = mijnBoot(), plan = voorstel.plan || {};
  const verlopen = voorstel.t <= nu, eens = akkoordVan(voorstel, akkoordData), ikEens = eens.includes(ik);
  const mijnT = voorstel.t + vertragingVan(plan, ik), lus = lussenVan(plan) && lussenVan(plan)[ik];
  $('voorstelTekst').textContent = `${startNaam(plan.modus)} om ${formatKlok(voorstel.t)}` +
    (verlopen ? ' (verlopen)' : ` (over ${formatDuur(voorstel.t - nu)})`) +
    (mijnT !== voorstel.t ? ` · jouw start ${formatKlok(mijnT)}` : '') +
    (lus ? ` · jouw lus +${formatAfstand(lus.extraM)}` : '') + '.';
  const lijst = FLEET.map(b => `<span>${eens.includes(b) ? '✔' : '⏳'} ${esc(kNaam(b))}</span>`).join('');
  if ($('voorstelAkkoord').innerHTML !== lijst) $('voorstelAkkoord').innerHTML = lijst;
  const knop = $('btnAkkoord');
  knop.disabled = ikEens || verlopen || watchId === null;
  knop.textContent = eens.length === FLEET.length ? '✔ Iedereen akkoord: de start wordt vastgelegd…'
    : ikEens ? '✔ Je bent akkoord. Wacht op de rest…'
    : verlopen ? 'Voorstel verlopen: wacht op een nieuw voorstel'
    : watchId === null ? 'Start eerst de tracking om akkoord te geven'
    : '✔ Akkoord met deze starttijd';
}
$('btnAkkoord').addEventListener('click', () => {
  if (!voorstel || watchId === null || voorstel.t <= Date.now()) return;
  initAudio();
  schrijf(db.ref(`${P}/akkoord/${mijnBoot()}`).set(voorstel.id));
});
// Nieuw voorstel binnen (niet bij het openen van de pagina): één glas en trillen
function opVoorstel(v) {
  if (bekendVoorstel !== undefined && v && v.id !== bekendVoorstel && raceStart == null) {
    speel(GELUID.startlijn);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    meld(`📨 Startvoorstel: ${formatKlok(v.t)}. Geef akkoord op het kaartje hieronder.`, 'goed');
  }
  bekendVoorstel = v ? v.id : null;
  if (v) laatsteVoorstelT = v.t;
  voorstel = v; renderVoorstel();
}

// =========================================================
//  Afgelegde afstand en hoeveel tijd je nog hebt om te winnen
// =========================================================
function tijdenNu() {
  const t = {};
  FLEET.forEach(b => { const s = botStatus[b] || {}; t[b] = { start: s.start, finish: s.finish }; });
  t[mijnBoot()] = Object.assign({}, t[mijnBoot()], mijnTijden.start != null ? mijnTijden : {});   // eigen boot: lokaal al actueler
  return t;
}
function afgelegdVan(b, t) { return t.start != null ? afgelegdM(kSpoorPunten[b], t.start, t.finish) : null; }
function updateRaceStats() {
  const tijden = tijdenNu(), nu = Date.now();
  renderEigenBoot();                                   // afgelegd + om te winnen staan in het kaartje
  const w = tijdOmTeWinnen(mijnBoot(), tijden, raceStart, startPlan, nu), info = $('winInfo');
  info.hidden = !w;
  if (w) info.textContent = w.rest == null
    ? 'Met de gecorrigeerde tijd kun je de boten die binnen zijn niet meer inhalen.'
    : `Finish vóór ${formatKlok(w.tot)} om ${w.plek === 1 ? 'te winnen' : 'plek ' + w.plek + ' te halen'} (gecorrigeerde tijd).`;
}
setInterval(updateRaceStats, 1000);

// =========================================================
//  Andere boten (tik = volg op de kaart)
// =========================================================
const abKaartjes = {};
function renderAndereBoten() {
  const lijst = $('andereLijst'), nu = Date.now(), tijden = tijdenNu();
  FLEET.forEach(naam => {
    let k = abKaartjes[naam];
    if (!k) {
      k = document.createElement('button');
      k.type = 'button'; k.className = 'ab-rij';
      k.innerHTML = '<div class="ab-naam"><span class="ab-dot"></span><span class="ab-namen"><span class="ab-tekst"></span>' +
        '<span class="ab-type"></span></span><span class="ab-status"></span></div><div class="ab-stats"></div>';
      k.querySelector('.ab-dot').style.background = BOTEN[naam].kleur;
      k.addEventListener('click', () => volgBoot(naam));
      lijst.appendChild(k); abKaartjes[naam] = k;
    }
    k.hidden = naam === mijnBoot();
    const s = botStatus[naam] || {}, online = s.ts && nu - s.ts < 30000;
    k.classList.toggle('off', !online);
    k.classList.toggle('gekozen', volgDoel === naam);
    k.querySelector('.ab-tekst').textContent = kNaam(naam);
    const eigenNaam = kNaam(naam) !== BOTEN[naam].model;
    k.querySelector('.ab-type').textContent = (eigenNaam ? BOTEN[naam].model + ' · ' : '') + 'rating ' + BOTEN[naam].rating.toFixed(3);
    k.querySelector('.ab-status').textContent = online ? '' : (s.ts ? geleden(nu - s.ts) : 'geen data');
    const extra = { afgelegd: afgelegdVan(naam, tijden[naam]), win: tijdOmTeWinnen(naam, tijden, raceStart, startPlan, nu),
      voorspel: voorspellingVan(voorspelRijen, naam) };
    k.querySelector('.ab-stats').innerHTML = bootStatsHtml(bootData(Object.assign({}, s, extra), lijnen, baanVan(naam)));
  });
}
setInterval(renderAndereBoten, 1000);

// Voorspelde eindstand met rating (tijdens de race), uit dezelfde gegevens als 'Andere boten'
let voorspelHtmlCache = '';
var voorspelRijen = [];     // ook voor 'voorspelde tijd tot finish' in de bootkaarten (var: die worden al eerder getekend)
function renderVoorspelling() {
  const nu = Date.now(), tijden = tijdenNu(), gerond = {}, posities = {};
  FLEET.forEach(b => { const s = botStatus[b] || {}; gerond[b] = s.gerond || {}; if (s.lat != null) posities[b] = s; });
  const rijen = voorspelRijen = raceStart && raceStart <= nu ? voorspelEindstand({ times: tijden, gerond, sporen: kSpoorPunten, posities,
    lijnen, boeien, baanVan, raceStart, startPlan, nu }) : [];
  $('voorspelBlok').hidden = !rijen.length;
  const html = voorspellingHtml(rijen, kNaam, mijnBoot());
  if (html !== voorspelHtmlCache) { $('voorspelling').innerHTML = html; voorspelHtmlCache = html; }
}
setInterval(renderVoorspelling, 2000);

// =========================================================
//  Detectie: startlijn, boeien (rondingslijn), finish
// =========================================================
function checkBoei(huidig, boot) {
  const baan = mijnBaan();
  if (mijnTijden.start == null || mijnTijden.finish != null || !baan.length || !vorigeRuwe) return;
  const v = baan.findIndex(b => mijnGerond[b.id] == null);
  if (v === -1) return;
  const { prev, next } = boeiPrevNext(v, baan, lijnen);
  const marge = Math.min(huidig.acc || 10, RONDINGS_MARGE_MAX_M);
  const lijn = rondingsLijn(baan[v], prev, next, marge, RONDINGS_LIJN_M);
  if (!lijn || !lijnstukkenKruisen(vorigeRuwe, huidig, lijn.a, lijn.b)) return;
  const id = baan[v].id;
  mijnGerond[id] = huidig.ts;
  schrijf(db.ref(`${P}/rounded/${boot}/${id}`).set(huidig.ts));
  speel(GELUID.boei);
  meld(`🟠 ${baan[v].label} gerond om ${formatKlok(huidig.ts)}`, 'goed');
}

// De database is leidend: zo komen handmatige correcties van de
// wedstrijdleiding (boei gerond / teruggedraaid) direct op de boot aan.
function volgGerond(gerond) {
  const baan = mijnBaan();
  const nieuw = baan.filter(b => gerond[b.id] != null && mijnGerond[b.id] == null).map(b => b.label);
  const weg = baan.filter(b => gerond[b.id] == null && mijnGerond[b.id] != null).map(b => kleinLabel(b.label));
  mijnGerond = Object.assign({}, gerond);
  if (nieuw.length) meld(`🟠 ${nieuw.join(', ')} gerond (door de wedstrijdleiding)`, 'goed');
  else if (weg.length) setTimeout(() => {     // niet melden als het een race-reset was (tijden ook weg)
    if (mijnTijden.start != null) meld(`↩️ Wedstrijdleiding: ${weg.join(', ')} moet je nog ronden`, 'fout');
  }, 500);
}

function checkKruising(huidig) {
  const boot = mijnBoot();
  if (!vorigeRuwe) { vorigeRuwe = huidig; return; }
  const A = vorigeRuwe, B = huidig;

  // Startlijn: eerste kruising ná jouw startsein (zonder sein: meteen; niet zolang er een startvoorstel open staat)
  if (lijnen.start && lijnen.start.a && mijnTijden.start == null && !(voorstel && raceStart == null)) {
    const t0 = mijnStart();
    if ((t0 == null || huidig.ts >= t0) && lijnstukkenKruisen(A, B, lijnen.start.a, lijnen.start.b)) {
      mijnTijden.start = huidig.ts;
      schrijf(db.ref(`${P}/times/${boot}/start`).set(huidig.ts));
      speel(GELUID.startlijn);
      meld('✓ Startlijn gepasseerd om ' + formatKlok(huidig.ts), 'goed');
    }
  }
  checkBoei(huidig, boot);

  // Finish: pas na de start én als alle boeien gerond zijn
  const alleGerond = mijnBaan().every(b => mijnGerond[b.id] != null);
  if (lijnen.finish && lijnen.finish.a && mijnTijden.start != null && mijnTijden.finish == null && alleGerond &&
      lijnstukkenKruisen(A, B, lijnen.finish.a, lijnen.finish.b)) {
    mijnTijden.finish = huidig.ts;
    schrijf(db.ref(`${P}/times/${boot}/finish`).set(huidig.ts));
    speel(GELUID.finish);
    meld('🏁 Gefinisht om ' + formatKlok(huidig.ts), 'goed');
    const t0 = mijnStart() != null ? mijnStart() : mijnTijden.start;
    Feest.start({ titel: '🏁 Gefinisht!', sub: `${kNaam(boot)} · verzeild ${formatDuur(huidig.ts - t0)}` });
  }
  vorigeRuwe = huidig;
}

// Auto-reset: wist de wedstrijdleiding de race (times weg), dan wist de
// tracker zijn eigen voortgang zodat de volgende race schoon telt.
function onTimesReset(s) {
  if (s.val() == null && (mijnTijden.start != null || mijnTijden.finish != null)) {
    mijnTijden = { start: null, finish: null };
    mijnGerond = {}; vorigeRuwe = null;
    meld('Nieuwe race — je tijden zijn automatisch gereset.');
  }
}

// =========================================================
//  GPS-alarm + meldingen
// =========================================================
let swReg = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => {});
function meldStatusTekst() {
  $('meldStatus').textContent = !('Notification' in window) ? 'niet ondersteund'
    : ({ granted: 'aan', denied: 'geweigerd', default: 'nog niet gevraagd' }[Notification.permission]);
}
meldStatusTekst();
async function vraagMeldingToestemming() {
  if ('Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (e) {}
  }
  meldStatusTekst();
}
function stuurMelding(titel, tekst) {
  if (document.visibilityState === 'visible') return;       // op het scherm zie je het alarm al
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body: tekst, tag: 'zeilrace-gps', renotify: true, requireInteraction: true, vibrate: [400, 150, 400] };
  if (swReg && swReg.showNotification) swReg.showNotification(titel, opts).catch(() => {});
  else { try { new Notification(titel, opts); } catch (e) {} }
}

let gpsAlarm = null, alarmTimer = null, alarmStil = false;
function alarmSignaal() {
  speel(GELUID.alarm);
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
}
function zetGpsAlarm(titel, uitleg) {
  if (gpsAlarm === titel) return;
  gpsAlarm = titel; alarmStil = false;
  const a = $('gpsAlarm');
  a.innerHTML = `⚠️ ${esc(titel)}<small>${esc(uitleg)} · tik om het geluid te stoppen</small>`;
  a.hidden = false;
  alarmSignaal();
  clearInterval(alarmTimer);
  alarmTimer = setInterval(() => { if (!alarmStil) alarmSignaal(); }, 10000);
  stuurMelding('Zeilrace: ' + titel, uitleg);
}
function wisGpsAlarm() {
  if (!gpsAlarm) return;
  gpsAlarm = null; $('gpsAlarm').hidden = true; clearInterval(alarmTimer); alarmTimer = null;
  speel(GELUID.hersteld);                            // één scheepsbel: GPS is terug
}
$('gpsAlarm').addEventListener('click', () => { alarmStil = true; });

// GPS-bewaking (her)starten. Na "locatie uit" stopt watchPosition in sommige
// browsers voorgoed; daarom herstarten we hem zolang er geen positie komt.
const GPS_OPTIES = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };
let laatsteHerstart = 0;
function startGps() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onPositie, onFout, GPS_OPTIES);
  laatsteHerstart = Date.now();
}

let verborgenSinds = null, achtergrondGemeld = false;
setInterval(() => {
  if (watchId === null) return;
  const stil = Date.now() - laatsteFix;
  if (stil > 20000) {
    zetGpsAlarm(laatsteGpsFout === 1 ? 'Locatie staat uit of is geweigerd' : 'Geen GPS-signaal meer',
      laatsteGpsFout === 1 ? 'Zet locatie aan en geef deze site toestemming.'
                           : 'Er komt al 20 seconden geen positie binnen. Staat locatie aan?');
    if (Date.now() - laatsteHerstart > 15000) startGps();
  }
  if (verborgenSinds && Date.now() - verborgenSinds > 15000 && !achtergrondGemeld) {
    achtergrondGemeld = true;
    stuurMelding('Zeilrace-tracker staat op de achtergrond', 'Open de app weer, anders wordt je positie mogelijk niet verstuurd.');
  }
}, 5000);

// =========================================================
//  Starten / stoppen (boot claimen, zodat niemand anders jouw
//  boot kan gebruiken)
// =========================================================
function laadNaam() {
  if (!auth.currentUser) return;
  db.ref(`${P}/names/${mijnBoot()}`).get().then(s => { naamInput.value = s.val() || ''; }).catch(() => {});
}
function bewaarNaam() {
  const n = naamInput.value.trim().slice(0, 24);
  const ref = db.ref(`${P}/names/${mijnBoot()}`);
  return n ? ref.set(n) : ref.remove();
}
bootSelect.addEventListener('change', () => { laadNaam(); markeerEigen(); renderAndereBoten(); renderEigenBoot(); updateAftel(); updateStartInfo(); tekenCourse(); });

async function vraagWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {}
}

async function start() {
  if (!('geolocation' in navigator)) { meld('Deze telefoon/browser ondersteunt geen GPS.', 'fout'); return; }
  initAudio();
  vraagMeldingToestemming();
  const user = auth.currentUser;
  if (!user) { meld('Nog geen verbinding met de server — controleer internet en probeer opnieuw.', 'fout'); return; }
  const boot = mijnBoot();
  knop.disabled = true;
  try {
    const res = await db.ref(`${P}/claims/${boot}`)
      .transaction(cur => (cur == null || cur === user.uid) ? user.uid : undefined);
    if (!res.committed) {
      meld(`${BOTEN[boot].model} is al in gebruik op een ander toestel. Kies je eigen boot, of vraag de ` +
        'wedstrijdleiding om "Boten vrijgeven".', 'fout');
      return;
    }
    mijnTijden = Object.assign({ start: null, finish: null }, (await db.ref(`${P}/times/${boot}`).get()).val() || {});
    mijnGerond = (await db.ref(`${P}/rounded/${boot}`).get()).val() || {};
    await bewaarNaam();
  } catch (e) {
    meld(dbFoutTekst(e), 'fout');
    return;
  } finally {
    knop.disabled = false;
  }
  timesRef = db.ref(`${P}/times/${boot}`);
  timesRef.on('value', onTimesReset);
  vorigeRuwe = null; laatsteFix = Date.now();
  bootSelect.disabled = true; naamInput.disabled = true;
  $('setup').hidden = true; $('sub').hidden = true;
  setTimeout(() => kaart.invalidateSize(), 250);
  knop.textContent = '■ Stop tracking'; knop.className = 'stop';
  el.status.classList.add('live'); el.dot.classList.add('on');
  el.tekst.textContent = 'Live — ' + kNaam(boot);
  meld('Tracking gestart. Houd deze pagina open.', 'goed');
  await vraagWakeLock();
  startGps();
}

function stop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
  if (timesRef) { timesRef.off('value', onTimesReset); timesRef = null; }
  wisNav(); wisGpsAlarm();
  bootSelect.disabled = false; naamInput.disabled = false;
  $('setup').hidden = false; $('sub').hidden = false;
  setTimeout(() => kaart.invalidateSize(), 250);
  knop.textContent = '▶︎ Start tracking'; knop.className = 'start';
  el.status.classList.remove('live'); el.dot.classList.remove('on');
  el.tekst.textContent = 'Gestopt';
  meld('');
}

function onPositie(p) {
  const { latitude, longitude, accuracy, speed, heading } = p.coords;
  const nu = Date.now();
  laatsteFix = nu; laatsteGpsFout = null;
  wisGpsAlarm();
  mijnPositie = { lat: latitude, lng: longitude };
  el.pos.textContent = latitude.toFixed(5) + ', ' + longitude.toFixed(5);
  el.acc.textContent = Math.round(accuracy) + ' m';
  const spd = (speed != null && !isNaN(speed)) ? speed : null;
  const hdg = (heading != null && !isNaN(heading)) ? heading : null;
  // Koers onthouden voor het kanon: uit de GPS, anders uit de laatste 8+ meter vaart
  if (hdg != null && spd != null && spd > 0.4) mijnKoers = hdg;
  if (!koersVan) koersVan = mijnPositie;
  else if (afstandMeter(koersVan, mijnPositie) > 8) {
    if (hdg == null || spd == null || spd <= 0.4) mijnKoers = peiling(koersVan, mijnPositie);
    koersVan = mijnPositie;
  }

  checkKruising({ lat: latitude, lng: longitude, ts: nu, acc: accuracy });
  updateNav(latitude, longitude, spd, hdg, nu);
  zetMarker(mijnBoot(), latitude, longitude, mijnKoers);
  if (volgDoel === 'eigen') kaart.panTo([latitude, longitude], { animate: true, duration: .5 });

  if (nu - laatsteSchrijf < SCHRIJF_INTERVAL) return;       // throttle (alleen DB-schrijven)
  laatsteSchrijf = nu;
  const data = { lat: latitude, lng: longitude, ts: nu, acc: accuracy };
  if (spd != null) data.speed = spd;
  if (hdg != null) data.heading = hdg;
  // Positie altijd (live stip); spoor alleen tijdens een race (er staat een startsein)
  schrijf(db.ref(`${P}/positions/${mijnBoot()}`).set(data));
  if (raceStart != null) schrijf(db.ref(`${P}/tracks/${mijnBoot()}`).push({ lat: latitude, lng: longitude, ts: nu }));
}

// Losse GPS-fouten (Android meldt die soms tussen goede posities door) geven
// géén alarm meer: de waakhond slaat pas alarm na 20 s zonder positie.
// Alleen geweigerde toestemming zonder recente positie meldt meteen.
let laatsteGpsFout = null;
function onFout(err) {
  laatsteGpsFout = err.code;
  if (err.code === 1 && Date.now() - laatsteFix > 5000)
    zetGpsAlarm('Locatie staat uit of is geweigerd', 'Zet locatie aan en geef deze site toestemming.');
}

knop.addEventListener('click', () => watchId === null ? start() : stop());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    verborgenSinds = null; achtergrondGemeld = false;
    if (watchId !== null && !wakeLock) vraagWakeLock();
  } else if (watchId !== null) verborgenSinds = Date.now();
});

// =========================================================
//  Data koppelen (pas na inloggen — de database vereist dat)
// =========================================================
function koppelData() {
  luister(`${P}/lines`, 'value', s => { lijnen = s.val() || {}; tekenCourse(); });
  luister(`${P}/marks`, 'value', s => { boeien = alsBoeien(s.val()); tekenCourse(); });
  luister(`${P}/raceStart`, 'value', s => {
    const nieuw = s.val() || null;
    if (nieuw && raceStart == null && nieuw === laatsteVoorstelT)          // net vastgelegd na ieders akkoord
      meld(`🔒 Iedereen akkoord: de start ligt vast om ${formatKlok(nieuw)}.`, 'goed');
    raceStart = nieuw; vorigeRem = null; updateAftel(); updateStartInfo(); renderVoorstel();
  });
  luister(`${P}/voorstel`, 'value', s => opVoorstel(s.val() || null));
  luister(`${P}/akkoord`, 'value', s => { akkoordData = s.val() || {}; renderVoorstel(); });
  luister(`${P}/startPlan`, 'value', s => { startPlan = s.val() || null; vorigeRem = null; updateAftel(); updateStartInfo(); tekenCourse(); });
  luister(`${P}/names`, 'value', s => {
    kNamen = s.val() || {};
    Object.keys(kMarkers).forEach(n => kMarkers[n].setTooltipContent(schipLabel(n)));
    renderAndereBoten();
  });
  FLEET.forEach(naam => {
    kSporen[naam] = L.polyline([], { color: BOTEN[naam].kleur, weight: 3, opacity: .75, interactive: false }).addTo(kaart);
    kSpoorPunten[naam] = [];
    luister(`${P}/tracks/${naam}`, 'child_added', snap => {
      const d = snap.val();
      if (d && d.lat != null) kSporen[naam].addLatLng([d.lat, d.lng]);
      if (d && d.lat != null && d.ts != null) {
        const pts = kSpoorPunten[naam];
        pts.push(d);
        if (pts.length > 1 && pts[pts.length - 2].ts > d.ts) pts.sort((a, b) => a.ts - b.ts);
      }
    });
    luister(`${P}/times/${naam}`, 'value', s => {
      const t = s.val() || {};
      botStatus[naam] = Object.assign(botStatus[naam] || {}, { start: t.start, finish: t.finish });
    });
    luister(`${P}/rounded/${naam}`, 'value', s => {
      const gerond = s.val() || {};
      botStatus[naam] = Object.assign(botStatus[naam] || {}, { gerond });
      if (naam === mijnBoot() && watchId !== null) volgGerond(gerond);
    });
    luister(`${P}/positions/${naam}`, 'value', snap => {
      const d = snap.val(); if (!d) return;
      botStatus[naam] = Object.assign(botStatus[naam] || {}, { lat: d.lat, lng: d.lng, speed: d.speed, heading: d.heading, ts: d.ts });
      if (!(naam === mijnBoot() && mijnPositie))                                   // eigen boot: lokaal al actueler
        zetMarker(naam, d.lat, d.lng, d.heading != null && d.speed > 0.4 ? d.heading : null);
      if (volgDoel === naam) kaart.panTo([d.lat, d.lng], { animate: true });
      fitEen();
    });
  });
  // Sporen wissen als een race wordt afgerond/gereset (gen verandert)
  let vorigeGen;
  luister(`${P}/gen`, 'value', s => {
    const g = s.val();
    if (vorigeGen !== undefined && g !== vorigeGen) {
      Object.values(kSporen).forEach(p => p.setLatLngs([]));
      FLEET.forEach(b => { kSpoorPunten[b] = []; });
    }
    vorigeGen = g;
  });
  koppelSpel();
  laadNaam();
}

metAuth(koppelData, e => meldFout(authFoutTekst(e)));
renderAndereBoten();
updateAftel();

// =========================================================
//  Het kompas dat niet naar het noorden wijst, maar naar datgene wat je
//  het liefste wilt: je volgende doel (startlijn, boei, finish).
//  Met een kompassensor draait de windroos mee met de echte richtingen.
// =========================================================
const Kompas = (() => {
  // Bewust zonder uitleg in beeld: de zeiler moet zelf uitvinden waar het naar wijst.
  const overlay = $('kompas'), roos = $('kompasRoos'), naald = $('kompasNaald');
  let hier = null, hoek = 0, roosHoek = 0, animatie = null, zoekFase = Math.random() * 6;
  let geopend = 0, gevraagd = false, anker = null, vorigeGps = null;

  // streepjes op de windroos (elke 10°, langer per 30°)
  const streep = $('kompasStreepjes');
  for (let d = 0; d < 360; d += 10) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const lang = d % 30 === 0 ? 8 : 4;
    l.setAttribute('y1', -86); l.setAttribute('y2', -86 + lang); l.setAttribute('transform', `rotate(${d})`);
    streep.appendChild(l);
  }

  // Het doel: je volgende doel (startlijn → boeien op volgorde → finish)
  function doel() {
    if (!hier) return null;
    const d = volgendDoel(hier);
    return d ? d.punt : null;
  }
  const verschil = (a, b) => ((b - a + 540) % 360) - 180;       // kortste hoekverschil

  function frame() {
    if (overlay.hidden) { animatie = null; return; }
    if (mijnPositie) hier = mijnPositie;
    // De vorige GPS-positie: het punt waar je minstens 10 m geleden was
    if (hier) {
      if (!anker) anker = hier;
      else if (afstandMeter(anker, hier) >= 10) { vorigeGps = anker; anker = hier; }
    }
    const d = doel(), t = performance.now() / 1000, koers = richting();
    let naar;
    if (d && hier) {
      const peil = peiling(hier, d);
      naar = peil - (koers != null ? koers : 0);
      // een eigenwijs kompas: het trilt en twijfelt een beetje
      naar += Math.sin(t * 2.3) * 3 + Math.sin(t * 5.1) * 1.5;
    } else {
      zoekFase += 0.016;
      naar = hoek + 6 + Math.sin(zoekFase * 1.7) * 14;             // draait zoekend rond
    }
    hoek += verschil(hoek, naar) * 0.08;
    // Het 'noorden' van de windroos wijst naar je vorige GPS-positie (zonder die: het echte noorden)
    const noord = vorigeGps && hier ? peiling(hier, vorigeGps) : 0;
    roosHoek += verschil(roosHoek, noord - (koers != null ? koers : 0)) * 0.15;
    // Nog geen kompasdata na 2 s, terwijl de browser om toestemming vraagt? Dan de knop tonen
    if (sensorKoers == null && !gevraagd && vraagtToestemming() && performance.now() - geopend > 2000) $('kompasActiveer').hidden = false;
    naald.setAttribute('transform', `rotate(${hoek.toFixed(2)})`);
    roos.setAttribute('transform', `rotate(${roosHoek.toFixed(2)})`);
    animatie = requestAnimationFrame(frame);
  }

  // ---- Richting van de telefoon ----
  // 1. de kompassensor via de oriëntatie-berichten (iPhone: webkitCompassHeading;
  //    Android: absolute alpha)
  // 2. de kompassensor via de Sensor-API van Chrome (AbsoluteOrientationSensor)
  // 3. valt dat allemaal weg: de GPS-koers van de boot (werkt als je vaart)
  let sensorKoers = null, sensorTijd = 0;
  const diag = { abs: 0, rel: 0, laatste: '—', toestemming: '—', sensorApi: '—' };   // voor ?kompastest
  function zetSensorKoers(h, bron) {
    sensorKoers = (h + 360) % 360; sensorTijd = Date.now(); diag.bron = bron;
    $('kompasActiveer').hidden = true;                 // sensor werkt: knop niet meer nodig
  }
  function opOrientatie(e) {
    if (e.type === 'deviceorientationabsolute') diag.abs++; else diag.rel++;
    diag.laatste = `${e.type === 'deviceorientationabsolute' ? 'abs' : 'rel'} α=${e.alpha == null ? '—' : Math.round(e.alpha)} ` +
      `absolute=${e.absolute}${e.webkitCompassHeading != null ? ' wch=' + Math.round(e.webkitCompassHeading) : ''}`;
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;   // iPhone
    else if (e.absolute && typeof e.alpha === 'number' && !isNaN(e.alpha)) h = 360 - e.alpha;                      // Android
    if (h == null) return;
    const scherm = (screen.orientation && screen.orientation.angle) || 0;
    zetSensorKoers(h + scherm, 'oriëntatie');
  }
  // Chrome op Android: de Sensor-API geeft de absolute stand als quaternion
  let sensorApi = null;
  function startSensorApi() {
    if (sensorApi || !('AbsoluteOrientationSensor' in window)) { if (!sensorApi) diag.sensorApi = 'niet aanwezig'; return; }
    try {
      sensorApi = new AbsoluteOrientationSensor({ frequency: 20, referenceFrame: 'screen' });
      sensorApi.addEventListener('reading', () => {
        const [x, y, z, w] = sensorApi.quaternion;
        const gier = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 180 / Math.PI;   // draaiing om de verticaal
        diag.sensorApi = 'meet ' + Math.round((360 - gier) % 360) + '°';
        if (sensorKoers == null || diag.bron !== 'oriëntatie' || Date.now() - sensorTijd > 1000) zetSensorKoers(360 - gier, 'sensor-api');
      });
      sensorApi.addEventListener('error', e => { diag.sensorApi = 'fout: ' + (e.error && e.error.name); });
      sensorApi.start(); diag.sensorApi = 'gestart';
    } catch (e) { diag.sensorApi = 'fout: ' + e.name; sensorApi = null; }
  }
  function richting() {
    if (sensorKoers != null && Date.now() - sensorTijd < 3000) return sensorKoers;
    return watchId !== null && mijnKoers != null ? mijnKoers : null;
  }
  // Meteen luisteren naar beide soorten berichten: browsers die geen toestemming
  // vragen leveren dan direct; de rest na de tik op 'Activeer het kompas'.
  let luistert = false;
  function luisterSensor() {
    if (!luistert) {
      luistert = true;
      addEventListener('deviceorientationabsolute', opOrientatie);
      addEventListener('deviceorientation', opOrientatie);
    }
    startSensorApi();
  }
  const vraagtToestemming = () => !!(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function');
  $('kompasActiveer').addEventListener('click', async () => {
    $('kompasActiveer').hidden = true;                 // na één tik weg (ook bij weigeren)
    gevraagd = true;
    luisterSensor();
    // Chrome (Android) wil 'true' voor het kompas zelf (magnetometer); Safari negeert het argument
    try { diag.toestemming = await DeviceOrientationEvent.requestPermission(true); }
    catch (e) {
      try { diag.toestemming = await DeviceOrientationEvent.requestPermission(); }
      catch (e2) { diag.toestemming = 'fout: ' + e2.name; }
    }
    sensorApi = null; startSensorApi();                // na toestemming de Sensor-API opnieuw proberen
  });
  // Testmodus (?kompastest): laat zien wat de telefoon doorgeeft
  const testRegel = new URLSearchParams(location.search).has('kompastest') ? document.createElement('pre') : null;
  if (testRegel) {
    testRegel.style.cssText = 'font:12px/1.35 monospace;white-space:pre-wrap;text-align:left;background:#fff8;padding:6px;margin:8px 0 0;border-radius:4px';
    $('kompasSluit').before(testRegel);
    setInterval(() => {
      if (overlay.hidden) return;
      const r = richting();
      testRegel.textContent =
        `veilig: ${isSecureContext} · vraagt toestemming: ${vraagtToestemming()} · toestemming: ${diag.toestemming}\n` +
        `berichten abs: ${diag.abs} · rel: ${diag.rel}\nlaatste: ${diag.laatste}\n` +
        `sensor-api: ${diag.sensorApi}\nbron: ${sensorKoers != null && Date.now() - sensorTijd < 3000 ? diag.bron : (r != null ? 'gps' : 'geen')}` +
        ` · richting: ${r == null ? '—' : Math.round(r) + '°'}\n${navigator.userAgent.match(/Chrome\/[\d.]+/) || ''}`;
    }, 400);
  }

  function open() {
    overlay.hidden = false;
    luisterSensor();
    geopend = performance.now();
    // De knop pas als er na 2 s nog geen kompasdata is en de browser om toestemming vraagt (zie frame)
    $('kompasActiveer').hidden = true;
    if (mijnPositie) hier = mijnPositie;
    if ('geolocation' in navigator)
      navigator.geolocation.getCurrentPosition(p => { hier = { lat: p.coords.latitude, lng: p.coords.longitude }; },
        () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    if (!animatie) animatie = requestAnimationFrame(frame);
  }
  function sluit() {
    overlay.hidden = true;
    try { localStorage.setItem('zeilrace-kompas', '1'); } catch (e) {}
  }
  $('kompasSluit').addEventListener('click', sluit);
  $('kompasKnop').addEventListener('click', open);

  let gezien = false;
  try { gezien = localStorage.getItem('zeilrace-kompas') === '1'; } catch (e) {}
  if (!gezien) open();
  return { open, sluit };
})();

// =========================================================
//  Het piratenspel: vuur het kanon! (regels en stand: piraat.js)
// =========================================================
let spelData = null, spelStand = null, spelVeldLaag = null, spelVeldSleutel = '', bekendeSchoten = null;
let herladenTot = 0, buitenSinds = null, vorigeMij = null, vorigBezig = null, scoreCache = '';
let kistLaag = null, kistSleutel = '', kistBezig = false;
const kistMislukt = new Set();   // kisten waarvan het pakken door de database geweigerd werd: niet elke seconde opnieuw
const scheepsKoers = {}, richtLagen = {}, labelCache = {};

function posTijden() {
  const t = {};
  FLEET.forEach(b => { if (botStatus[b] && botStatus[b].ts) t[b] = botStatus[b].ts; });
  if (watchId !== null && laatsteFix) t[mijnBoot()] = Math.max(t[mijnBoot()] || 0, laatsteFix);
  return t;
}
function schipPos(b) {
  if (b === mijnBoot() && mijnPositie) return mijnPositie;
  const s = botStatus[b];
  return s && s.lat != null ? { lat: s.lat, lng: s.lng } : null;
}
function tekenRichtlijnen(b) {
  const st = spelStand;
  const actief = st && st.bezig && st.deelnemers.includes(b) && st.boten[b].levens > 0;
  if (actief) richtLagen[b] = Piraat.richtlijnen(kaart, schipPos(b), scheepsKoers[b], richtLagen[b], b === mijnBoot(), st.boten[b].kist);
  else if (richtLagen[b]) { kaart.removeLayer(richtLagen[b]); richtLagen[b] = null; }
}
function vrijNummer(lijst, max) {
  const l = lijst || {};
  for (let i = 0; i < max; i++) if (l[i] == null) return i;
  return null;
}
function kanonSalvo() { kanonschot(); setTimeout(() => kanonschot(), 150); }
// Klaar met herladen: 1 minuut na je laatste salvo (uit de database, dus ook na herladen van de pagina)
const herlaadKlaar = mij => Math.max(herladenTot, (mij && mij.laatsteSchot || 0) + SPEL.herlaadMs);
// Na een treffer ligt je kanon 1 minuut stil
const geraaktKlaar = mij => (mij && mij.geraakt || 0) + SPEL.geraaktMs;

async function vuur() {
  initAudio();
  const st = spelStand, ik = mijnBoot();
  if (!st || !st.bezig) return;
  if (watchId === null) { tip('Start eerst de tracking — dan weet het kanon waar je schip ligt.'); return; }
  const mij = st.boten[ik];
  if (mij.levens <= 0) { tip('Je schip is gezonken… ☠️'); return; }
  if (Date.now() < herlaadKlaar(mij) || Date.now() < geraaktKlaar(mij)) return;
  const nr = vrijNummer(spelData && spelData.schoten && spelData.schoten[ik], SPEL.schoten);
  if (nr == null || mij.gebruikt >= SPEL.schoten) { tip('Je kruit is op!'); return; }
  if (!mijnPositie || mijnKoers == null) { tip('Vaar eerst een stukje: het kanon moet weten waar je boeg wijst.'); return; }
  const schot = { ts: Date.now(), lat: +mijnPositie.lat.toFixed(6), lng: +mijnPositie.lng.toFixed(6), koers: Math.round(mijnKoers) % 360 };
  if (mij.kist) schot.groot = true;                     // met een buitkist: dubbel bereik
  // Raak? Met de laatst bekende posities van de andere (levende) schepen
  const raak = {};
  st.deelnemers.forEach(b => {
    const s = botStatus[b];
    if (b === ik || st.boten[b].levens <= 0 || !s || s.lat == null || Date.now() - s.ts > 20000) return;
    if (Piraat.raakt(schot, s)) raak[b] = true;
  });
  if (Object.keys(raak).length) schot.raak = raak;
  herladenTot = Date.now() + SPEL.herlaadMs;
  if (navigator.vibrate) navigator.vibrate(120);
  try { await db.ref(`${P}/spel/schoten/${ik}/${nr}`).set(schot); }
  catch (e) { herladenTot = 0; meld(dbFoutTekst(e), 'fout'); }
  if (schot.raak) meld(`🎯 Raak! ${Object.keys(schot.raak).map(kNaam).join(' en ')} ${Object.keys(schot.raak).length > 1 ? 'zijn' : 'is'} geraakt!`, 'goed');
  else if (schot.groot) meld(`📦 Je zware salvo vloog ${Piraat.bereik(schot)} m ver, maar raakte niets.`);
  renderSpel();
}
$('btnVuur').addEventListener('click', vuur);

// Buiten het speelveld: elke 20 seconden een leven kwijt
function controleerVeld() {
  const st = spelStand, box = $('spelVeld'), ik = mijnBoot();
  const meedoen = st && st.bezig && st.veld && watchId !== null && mijnPositie &&
    st.deelnemers.includes(ik) && st.boten[ik].levens > 0;
  if (!meedoen || Piraat.binnenVeld(st.veld, mijnPositie)) { buitenSinds = null; box.hidden = true; return; }
  const nu = Date.now();
  if (!buitenSinds) buitenSinds = nu;
  const rest = SPEL.strafMs - (nu - buitenSinds);
  box.hidden = false;
  box.textContent = `⚠️ Buiten het speelveld! Keer om — over ${Math.max(0, Math.ceil(rest / 1000))} s kost het een leven.`;
  if (rest > 0) return;
  buitenSinds = nu;
  const nr = vrijNummer(spelData && spelData.straf && spelData.straf[ik], SPEL.levens);
  if (nr == null) return;
  schrijf(db.ref(`${P}/spel/straf/${ik}/${nr}`).set(nu));
  speel(GELUID.alarm);
  if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
}

// Buitkisten: vaar er binnen 25 m langs en je volgende salvo reikt twee keer zo ver.
// Wie de kist het eerst in de database zet, heeft hem (transactie).
function controleerKist() {
  const st = spelStand, ik = mijnBoot();
  if (kistBezig || !st || !st.bezig || watchId === null || !mijnPositie || !st.deelnemers.includes(ik)) return;
  const mij = st.boten[ik];
  if (mij.levens <= 0 || mij.kist) return;                       // één kist tegelijk
  const k = Piraat.kisten(spelData, Date.now()).find(k => !kistMislukt.has(st.start + '/' + k.nr) && afstandMeter(k, mijnPositie) <= SPEL.kistPakM);
  if (!k) return;
  kistBezig = true;
  db.ref(`${P}/spel/buit/${k.nr}`).transaction(nu => nu ? undefined : { boot: ik, ts: Date.now() })
    .then(r => {
      if (!r.committed) return;
      meld(`📦 Buit binnen! Je volgende salvo reikt twee keer zo ver (${Piraat.bereik({ groot: true })} m).`, 'goed');
      scheepsbel(1);
      if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
    })
    .catch(e => { kistMislukt.add(st.start + '/' + k.nr); meld(dbFoutTekst(e), 'fout'); })
    .finally(() => { kistBezig = false; });
}
function tekenKisten(st) {
  const lijst = st.bezig ? Piraat.kisten(spelData, Date.now()) : [];
  const sleutel = lijst.map(k => k.nr).join(',');
  if (sleutel !== kistSleutel) { kistLaag = Piraat.kistLagen(kaart, lijst, kistLaag); kistSleutel = sleutel; }
}

function renderSpel() {
  const st = spelStand = Piraat.stand(spelData, posTijden());
  const paneel = $('spelPaneel'), ik = mijnBoot();
  // speelveld op de kaart (alleen opnieuw tekenen als het verandert)
  const sleutel = st.start && st.veld ? JSON.stringify(st.veld) : '';
  if (sleutel !== spelVeldSleutel) { spelVeldLaag = Piraat.veldLaag(kaart, sleutel ? st.veld : null, spelVeldLaag); spelVeldSleutel = sleutel; }
  // labels (levens) en wrakken
  Object.keys(kMarkers).forEach(n => { const l = schipLabel(n); if (labelCache[n] !== l) { kMarkers[n].setTooltipContent(l); labelCache[n] = l; } });
  markeerEigen();
  FLEET.forEach(tekenRichtlijnen);
  tekenKisten(st);
  if (!st.start) { paneel.hidden = true; return; }
  paneel.hidden = false;
  $('spelStatus').textContent = Piraat.statusTekst(st, kNaam);
  const mij = st.boten[ik], knop = $('btnVuur'), herlaad = Math.max(0, herlaadKlaar(mij) - Date.now());
  const stil = Math.max(0, geraaktKlaar(mij) - Date.now());
  const wacht = ms => formatDuur(Math.ceil(ms / 1000) * 1000);
  $('spelMijn').textContent = watchId === null ? 'Start de tracking om mee te vechten.'
    : `${kNaam(ik)}: ${Piraat.levensTekst(mij)} · ${SPEL.schoten - mij.gebruikt} salvo's · ${mij.hits} raak`;
  knop.disabled = !st.bezig || watchId === null || mij.levens <= 0 || mij.gebruikt >= SPEL.schoten || herlaad > 0 || stil > 0;
  knop.textContent = !st.bezig ? '⚓ De zeeslag is voorbij' : mij.levens <= 0 ? '☠️ Gezonken'
    : mij.gebruikt >= SPEL.schoten ? '🪣 Het kruit is op'
    : stil > 0 ? `💫 Geraakt! Kanon ligt stil… ${wacht(Math.max(stil, herlaad))}`
    : herlaad > 0 ? `⏳ Herladen… ${wacht(herlaad)}`
    : mij.kist ? `💥 Vuur het kanon! (📦 ${Piraat.bereik({ groot: true })} m)` : '💥 Vuur het kanon!';
  const html = Piraat.scoreHtml(st, kNaam, ik);
  if (html !== scoreCache) { $('spelStand').innerHTML = html; scoreCache = html; }

  // Geraakt? (alleen melden als het tijdens deze sessie gebeurt)
  if (vorigeMij && vorigeMij.start === st.start && st.deelnemers.includes(ik)) {
    if (mij.levens < vorigeMij.levens) {
      const doorVeld = mij.straf > vorigeMij.straf;
      meld(mij.levens <= 0 ? '☠️ Je schip is gezonken! Het spel is voor jou voorbij.'
        : doorVeld ? `⚠️ Buiten het speelveld: een leven kwijt. Nog ${mij.levens}.` : `💥 Geraakt! Nog ${mij.levens} ${mij.levens === 1 ? 'leven' : 'levens'}. Je kanon ligt 1 minuut stil.`, 'fout');
      if (!doorVeld && navigator.vibrate) navigator.vibrate([200, 80, 200, 80, 400]);
    }
  }
  vorigeMij = { start: st.start, levens: mij.levens, straf: mij.straf };
  // Einde van de zeeslag (alleen als je hem zag eindigen)
  if (vorigBezig && vorigBezig.start === st.start && vorigBezig.bezig && !st.bezig && st.winnaar) {
    const ikWin = st.winnaar.boot === ik && !st.gelijk;
    Feest.start({ titel: ikWin ? '🏴‍☠️ Jij wint de zeeslag!' : '🏴‍☠️ De zeeslag is voorbij',
      sub: st.gelijk ? 'Onbeslist — gelijke stand aan kop.' : `${kNaam(st.winnaar.boot)} is de schrik van de zeven zeeën!` });
  }
  vorigBezig = { start: st.start, bezig: st.bezig };
}

function koppelSpel() {
  luister(`${P}/spel`, 'value', s => {
    spelData = s.val();
    const st = Piraat.stand(spelData, posTijden());
    const ids = new Set(st.geldig.map(g => g.id));
    // Nieuwe salvo's laten vliegen (niet de oude bij het openen van de pagina)
    if (bekendeSchoten) st.geldig.forEach(g => {
      if (bekendeSchoten.has(g.id) || Date.now() - g.schot.ts > 20000) return;
      Piraat.animeer(kaart, g.schot, g.raak, schipPos);
      kanonSalvo();
    });
    bekendeSchoten = ids;
    renderSpel();
  });
}
setInterval(() => { if (spelData) { controleerVeld(); renderSpel(); controleerKist(); } }, 1000);
