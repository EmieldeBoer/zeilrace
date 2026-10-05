// ============================================================
//  Zeilrace — dashboard
//  Publiek: kaart, live data per boot, regels, uitslagen.
//  Wedstrijdleiding: open met ?wl en log in met een e-mail-account
//  dat in /admins staat (zie README).
// ============================================================
const FLEET = Object.keys(BOTEN);
const WL_MODUS = new URLSearchParams(location.search).has('wl');
const P = `races/${RACE_ID}`;
const DNF_PUNTEN = FLEET.length + 1;   // niet gefinisht = aantal boten + 1

let timesData = {}, raceStart = null, startPlan = null, boeien = [], lijnData = {};
let rondingData = {}, resultsData = {}, namen = {};
let voorstel = null, akkoordData = {};   // startvoorstel van de wedstrijdleiding + akkoord per boot
const posData = {}, laatsteTs = {}, markers = {}, sporen = {};
let admin = false, geselecteerd = null, windKn = null, windRichting = null, eersteFix = true;
const spoorPunten = {};   // per boot [{lat,lng,ts}] — voor het scheepsjournaal
let journaalVuil = true, journaalHtml = '', journaalGemaakt = 0;
// Baan aanpassen gaat via een concept: pas na "Bevestigen" gaat het live.
let concept = null, instelModus = null, tijdPunten = [], tijdMarkers = [];

const el = id => document.getElementById(id);
const tabActief = id => el(id).classList.contains('actief');
const naamVan = b => (namen[b] && String(namen[b]).trim()) ? String(namen[b]).trim() : BOTEN[b].model;
const dotHtml = b => `<span class="dot" style="background:${BOTEN[b].kleur}"></span>`;
const nieuwId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
// De baan van een boot: bij een lusstart met de eigen lus erin
const baanVan = b => baanVanBoot(boeien, lussenVan(startPlan), b);


// =========================================================
//  Kaart
// =========================================================
const kaart = maakKaart('kaart');
const baanLagen = [];   // start/finish, boeien, route, rondingslijnen
const windWidget = maakWindWidget(kaart);
// de windwidget wijkt uit naar een andere hoek als er een schip onder ligt
setInterval(() => wijkUit(kaart, windWidget, FLEET.map(b => markers[b] && kaart.hasLayer(markers[b]) && markers[b].getLatLng())), 1000);
kaartKnoppen(kaart, [{ id: 'knopOverzicht', tekst: '⛶', titel: 'Hele baan tonen', klik: overzicht }, meetKnop('knopMeet', () => meetlat)]);
const meetlat = maakMeetlat(kaart, 'knopMeet');
kaart.on('dragstart', () => { if (geselecteerd) { geselecteerd = null; verversLijst(); } });

function overzicht() {
  geselecteerd = null; verversLijst();
  const lagen = [...baanLagen, ...Object.values(markers)];
  if (lagen.length) kaart.fitBounds(L.featureGroup(lagen).getBounds(), { padding: [40, 40], maxZoom: 16 });
}

function windPlek() {
  const b = huidigeBaan();
  if (b.lines.start && b.lines.start.a) return lijnMidden(b.lines.start);
  for (const n of FLEET) if (posData[n]) return posData[n];
  const c = kaart.getCenter(); return { lat: c.lat, lng: c.lng };
}
async function verversWind() {
  const w = await toonWind(windPlek());
  if (w) { windKn = w.kn; windRichting = w.richting; renderPlanning(); }
}
verversWind();
setInterval(verversWind, 5 * 60 * 1000);

// =========================================================
//  Tabbladen
// =========================================================
function toonTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('actief', t.id === id));
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('actief', b.dataset.tab === id));
  if (id === 'tabLive') setTimeout(() => kaart.invalidateSize(), 30);
  if (id === 'tabUitslagen') renderUitslagen();
}
document.querySelectorAll('#tabbar button').forEach(b => b.addEventListener('click', () => toonTab(b.dataset.tab)));

// Paasei in de regels: het verstopte anker
el('paasei').addEventListener('click', e => {
  e.preventDefault();
  el('kadoOverlay').hidden = false;
  speel(GELUID.finish);
  Feest.confetti(200);
});
el('kadoSluit').addEventListener('click', () => { el('kadoOverlay').hidden = true; });
el('kadoOverlay').addEventListener('click', e => { if (e.target === el('kadoOverlay')) el('kadoOverlay').hidden = true; });

// =========================================================
//  Boten — live kaartjes (tik = volg op de kaart)
// =========================================================
const kaartjes = {};
function verversLijst() {
  const lijst = el('botenlijst'), nu = Date.now();
  FLEET.forEach(naam => {
    let k = kaartjes[naam];
    if (!k) {
      k = document.createElement('button');
      k.type = 'button'; k.className = 'boot';
      k.innerHTML = '<div class="boot-top"><span class="kleur"></span><span class="namen"><span class="naam"></span>' +
        '<span class="model"></span></span><span class="meta"></span></div><div class="stats-plek"></div>';
      k.querySelector('.kleur').style.background = BOTEN[naam].kleur;
      k.addEventListener('click', () => selecteerBoot(naam));
      lijst.appendChild(k); kaartjes[naam] = k;
    }
    const ts = laatsteTs[naam], online = ts && nu - ts < 30000;
    const t = timesData[naam] || {};
    const s = Object.assign({}, posData[naam], { start: t.start, finish: t.finish, gerond: rondingData[naam],
      afgelegd: t.start != null ? afgelegdM(spoorPunten[naam], t.start, t.finish) : null,
      win: tijdOmTeWinnen(naam, timesData, raceStart, startPlan, nu), voorspel: voorspellingVan(voorspelRijen, naam) });
    const eigenNaam = naamVan(naam) !== BOTEN[naam].model;
    k.classList.toggle('offline', !online);
    k.classList.toggle('gekozen', geselecteerd === naam);
    k.setAttribute('aria-pressed', String(geselecteerd === naam));
    k.querySelector('.naam').textContent = naamVan(naam);
    k.querySelector('.model').textContent = (eigenNaam ? BOTEN[naam].model + ' · ' : '') + 'rating ' + BOTEN[naam].rating.toFixed(3);
    const meta = k.querySelector('.meta');
    meta.textContent = online ? 'LIVE' : (ts ? geleden(nu - ts) : 'geen data');
    meta.classList.toggle('live', !!online);
    k.querySelector('.stats-plek').innerHTML = bootStatsHtml(bootData(s, lijnData, baanVan(naam)));
    if (markers[naam]) zetSchipStaat(markers[naam], { gekozen: geselecteerd === naam, wrak: isWrak(naam),
      spel: !!(spelStand && spelStand.start), spook: spookStaat(naam) });   // zeeslag gestart → piratenschepen
    if (sporen[naam]) sporen[naam].setStyle({ opacity: spookStaat(naam) === 'weg' ? 0 : .75 });
  });
}

function selecteerBoot(naam, vanKaart) {
  if (geselecteerd === naam && !vanKaart) { geselecteerd = null; verversLijst(); return; }
  geselecteerd = naam; verversLijst();
  const d = posData[naam];
  if (!d || d.lat == null) return;
  kaart.flyTo([d.lat, d.lng], Math.max(kaart.getZoom(), 16), { duration: .8 });
  if (!vanKaart && window.matchMedia('(max-width: 820px)').matches)
    el('kaartwrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =========================================================
//  Tijden: verzeild (zonder rating) en gecorrigeerd (met rating)
// =========================================================
// Verzeild = vanaf de eigen start (bij een achtervolgingsstart dus
// later voor snellere boten). Gecorrigeerd: zie gecorrigeerdeTijd (shared.js).
function berekenUitslag(times) {
  const nu = Date.now();
  return FLEET.map(naam => {
    const t = times[naam] || {};
    const eigenStart = eigenStartVan(naam, t, raceStart, startPlan);
    let elapsed = null, corrected = null, gefinisht = false, onderweg = false;
    if (t.start != null && eigenStart != null) {
      gefinisht = t.finish != null; onderweg = !gefinisht;
      const eind = gefinisht ? t.finish : nu;
      elapsed = eind - eigenStart;
      corrected = gecorrigeerdeTijd(naam, eind, raceStart, startPlan, eigenStart);
    }
    return { naam, gefinisht, onderweg, elapsed, corrected };
  });
}
// Vuurwerk zodra een boot binnenkomt (niet voor finishes die er al waren bij het laden)
let bekendeFinishes = null;
function vierNieuweFinishes() {
  const nu = new Set(FLEET.filter(b => timesData[b] && timesData[b].finish != null));
  if (bekendeFinishes) nu.forEach(b => {
    if (bekendeFinishes.has(b)) return;
    const r = berekenUitslag(timesData).find(x => x.naam === b);
    Feest.start({ titel: `🏁 ${naamVan(b)} is binnen!`,
      sub: r && r.elapsed != null ? `Verzeild ${formatDuur(r.elapsed)} · gecorrigeerd ${formatDuur(r.corrected)}` : '' });
  });
  bekendeFinishes = nu;
}

function rangen(lijst, veld) {           // lijst: [{naam, gefinisht, veld}] → {naam: plaats}
  const r = {};
  lijst.filter(x => x.gefinisht && x[veld] != null).sort((a, b) => a[veld] - b[veld])
    .forEach((x, i) => { r[x.naam] = i + 1; });
  return r;
}

// =========================================================
//  Uitslagen: klassement op gecorrigeerde tijd (met rating)
// =========================================================
function uitslagLijst(res) {
  const u = (res && res.uitslag) || {};
  return FLEET.map(naam => Object.assign({ naam }, u[naam] || {}));
}
function klassementHtml(titel, sub, nummers, veld) {
  const punten = {}, totaal = {};
  FLEET.forEach(b => { punten[b] = {}; totaal[b] = 0; });
  nummers.forEach(nr => {
    const r = rangen(uitslagLijst(resultsData[nr]), veld);
    FLEET.forEach(b => { punten[b][nr] = r[b] || DNF_PUNTEN; totaal[b] += punten[b][nr]; });
  });
  const volgorde = [...FLEET].sort((a, b) => {
    if (totaal[a] !== totaal[b]) return totaal[a] - totaal[b];
    for (let k = nummers.length - 1; k >= 0; k--) {        // gelijkspel: laatste race beslist
      const nr = nummers[k];
      if (punten[a][nr] !== punten[b][nr]) return punten[a][nr] - punten[b][nr];
    }
    return 0;
  });
  let h = `<div class="u-tabel"><h3>${titel}</h3><div class="sub">${sub}</div><div class="tabelscroll"><table>` +
    '<thead><tr><th class="pos">#</th><th>Boot</th>' + nummers.map(nr => `<th class="pos">R${nr}</th>`).join('') +
    '<th class="pos">Totaal</th></tr></thead><tbody>';
  volgorde.forEach((b, i) => {
    h += `<tr${i === 0 ? ' class="winnaar"' : ''}><td class="pos">${i + 1}</td>` +
      `<td class="boot-cel">${dotHtml(b)}${esc(naamVan(b))}</td>` +
      nummers.map(nr => `<td class="pos">${punten[b][nr]}</td>`).join('') + `<td class="pos"><b>${totaal[b]}</b></td></tr>`;
  });
  return h + '</tbody></table></div></div>';
}
function raceHtml(nr) {
  const res = resultsData[nr], lijst = uitslagLijst(res);
  const rMet = rangen(lijst, 'corrected');
  const nm = b => (res.namen && res.namen[b]) || naamVan(b);
  lijst.sort((a, b) => (rMet[a.naam] || 99) - (rMet[b.naam] || 99));
  const wanneer = res.ts ? new Date(res.ts).toLocaleString('nl-NL',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const modus = startNaam(res.modus).toLowerCase();
  const knoppen = (res.sporen ? `<button class="race-knop afspelen" data-nr="${nr}">▶ Replay</button>` : '') +
    (admin ? `<button class="race-knop hernoem" data-nr="${nr}">✏️ Naam</button>` +
             (res.sporen && Object.keys(BOTEN).some(b => res.tijden && res.tijden[b] && res.tijden[b].start != null && res.tijden[b].finish == null)
               ? `<button class="race-knop finishfix" data-nr="${nr}" title="Finish van boten zonder finish uit hun spoor halen">🏁 Finish uit spoor</button>` : '') +
             `<button class="race-knop wis" data-nr="${nr}" title="Verwijder deze race">🗑</button>` : '');
  let h = `<div class="u-tabel"><h3>Race ${nr}${res.naam ? ': ' + esc(res.naam) : ''} ${knoppen}</h3>` +
    `<div class="sub">${wanneer} · ${modus}${res.nm ? ' · ' + Number(res.nm).toFixed(1) + ' zeemijl' : ''}</div>` +
    '<div class="tabelscroll"><table><thead><tr><th class="pos">#</th><th>Boot</th><th class="tijd">Verzeild</th>' +
    '<th class="tijd">Gecorr.</th><th class="tijd">Afgelegd</th></tr></thead><tbody>';
  lijst.forEach(r => {
    h += `<tr${rMet[r.naam] === 1 ? ' class="winnaar"' : ''}><td class="pos">${rMet[r.naam] || '–'}</td>` +
      `<td class="boot-cel">${dotHtml(r.naam)}${esc(nm(r.naam))}</td>` +
      `<td class="tijd">${r.gefinisht ? formatDuur(r.elapsed) : 'DNF'}</td>` +
      `<td class="tijd">${r.gefinisht ? formatDuur(r.corrected) : '—'}</td>` +
      `<td class="tijd">${(a => a != null ? formatAfstand(a) : '—')(r.afstand != null ? r.afstand : afstandUitSpoor(res, r.naam))}</td></tr>`;
  });
  return h + '</tbody></table></div>' + journaalUitslagHtml(res, nm) + '</div>';
}
// ---- Een opgeslagen zeeslag: eindstand, replay en scheepsjournaal ----
function zeeslagHtml(key) {
  const z = zeeslagenData[key], nm = b => (z.namen && z.namen[b]) || naamVan(b);
  const wanneer = new Date(z.start).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const duur = z.over ? ' · ' + formatDuur(z.over - z.start) : '';
  const knoppen = (z.sporen ? `<button class="race-knop afspelen" data-zeeslag="${key}">▶ Replay</button>` : '') +
    (admin ? `<button class="race-knop wis" data-zeeslag="${key}" title="Verwijder deze zeeslag">🗑</button>` : '');
  const rijen = (z.stand || []).map((r, i) => `<tr${i === 0 && z.winnaar ? ' class="winnaar"' : ''}><td class="pos">${i + 1}</td>` +
    `<td class="boot-cel">${dotHtml(r.boot)}${esc(nm(r.boot))}</td><td>${r.levens ? Piraat.harten(r.levens) : '☠️ gezonken'}</td>` +
    `<td class="tijd">${r.hits}</td><td class="tijd">${r.salvos}</td></tr>`).join('');
  const notities = Array.isArray(z.journaal) ? z.journaal : Object.values(z.journaal || {});
  const journaal = notities.length ? '<details class="journaal-uitslag"><summary>📜 Scheepsjournaal</summary><div class="journaal">' +
    [...notities].reverse().map(n => `<div class="journaal-item"><div class="journaal-kop">${esc(n.kop)}</div>` +
      `<div class="journaal-tekst">${esc(n.tekst)}</div></div>`).join('') + '</div></details>' : '';
  return `<div class="u-tabel"><h3>🏴‍☠️ Zeeslag ${knoppen}</h3><div class="sub">${wanneer}${duur}` +
    `${z.sporen ? '' : ' · geen sporen opgeslagen (geen replay)'}</div>` +
    (rijen ? '<div class="tabelscroll"><table><thead><tr><th class="pos">#</th><th>Schip</th><th>Levens</th>' +
      `<th class="tijd">Raak</th><th class="tijd">Salvo's over</th></tr></thead><tbody>${rijen}</tbody></table></div>` : '') +
    journaal + '</div>';
}
// Leaderboard over alle bewaarde zeeslagen: overwinningen, dan treffers, dan het minst gezonken
function zeeslagLeaderboardHtml(keys) {
  const tel = {};
  FLEET.forEach(b => { tel[b] = { boot: b, slagen: 0, winst: 0, raak: 0, gezonken: 0, kisten: 0, levens: 0 }; });
  keys.forEach(k => {
    const z = zeeslagenData[k];
    (z.stand || []).forEach(r => {
      const t = tel[r.boot]; if (!t) return;
      t.slagen++; t.raak += r.hits || 0; t.kisten += r.kisten || 0; t.levens += r.levens || 0;
      if (!r.levens) t.gezonken++;
    });
    if (z.winnaar && tel[z.winnaar]) tel[z.winnaar].winst++;
  });
  const lijst = Object.values(tel).filter(t => t.slagen)
    .sort((a, c) => c.winst - a.winst || c.raak - a.raak || a.gezonken - c.gezonken || c.levens - a.levens);
  if (!lijst.length) return '';
  const rijen = lijst.map((t, i) => `<tr${i === 0 && t.winst ? ' class="winnaar"' : ''}><td class="pos">${i + 1}</td>` +
    `<td class="boot-cel">${dotHtml(t.boot)}${esc(naamVan(t.boot))}</td><td class="pos">${t.slagen}</td>` +
    `<td class="pos"><b>${t.winst}</b></td><td class="pos">${t.raak}</td><td class="pos">${t.gezonken}</td><td class="pos">${t.kisten}</td></tr>`).join('');
  return '<div class="u-tabel"><h3>🏴‍☠️ Leaderboard — de schrik van de zeven zeeën</h3>' +
    `<div class="sub">Over ${keys.length} zeeslag${keys.length === 1 ? '' : 'en'} · eerst de meeste overwinningen, dan de meeste treffers, dan het minst gezonken</div>` +
    '<div class="tabelscroll"><table><thead><tr><th class="pos">#</th><th>Schip</th><th class="pos" title="Zeeslagen">⚔️</th>' +
    '<th class="pos" title="Gewonnen">🏆</th><th class="pos" title="Treffers">💥</th><th class="pos" title="Gezonken">☠️</th>' +
    `<th class="pos" title="Schatkisten">📦</th></tr></thead><tbody>${rijen}</tbody></table></div></div>`;
}
function zeeslagenHtml() {
  const keys = Object.keys(zeeslagenData).filter(k => zeeslagenData[k]).sort((a, b) => b - a);
  return keys.length ? '<h2 class="u-kop">🏴‍☠️ Zeeslagen</h2>' + zeeslagLeaderboardHtml(keys) + keys.map(zeeslagHtml).join('') : '';
}
// ---- Finish achteraf uit het spoor (bijv. als de finishlijn tijdens de race is verlengd) ----
// De eerste kruising van de finishlijn (zoals die in de opgeslagen race staat) na de eigen
// start, met het tijdstip tussen de twee spoorpunten ingeschat. Null als hij er niet over ging.
function finishUitSpoor(res, b) {
  const F = res.baan && res.baan.lines && res.baan.lines.finish, t = res.tijden && res.tijden[b];
  if (!F || !F.a || !t || t.start == null || !res.sporen || !res.sporen[b]) return null;
  const t0 = res.t0 || res.ts;
  const sein = res.gun != null ? res.gun + ((res.modus === 'achtervolging' && res.vertraging && res.vertraging[b]) || 0) : t.start;
  const van = Math.max(t.start, sein);
  const pts = normaliseerSpoor(res.sporen[b]).map(p => ({ lat: p[0], lng: p[1], ts: t0 + p[2] * 1000 }));
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].ts <= van || !lijnstukkenKruisen(pts[i - 1], pts[i], F.a, F.b)) continue;
    const a = pts[i - 1], c = pts[i], da = Math.abs(_orient(F.a, F.b, a)), dc = Math.abs(_orient(F.a, F.b, c));
    return Math.round(a.ts + (c.ts - a.ts) * (da + dc ? da / (da + dc) : 0));
  }
  return null;
}
async function corrigeerFinishUitSpoor(nr) {
  const res = resultsData[nr]; if (!res) return;
  const sp = { modus: res.modus || 'gelijk', vertraging: res.vertraging || null };
  const t0 = res.t0 || res.ts, voorstel = [];
  Object.keys(BOTEN).forEach(b => {
    const t = res.tijden && res.tijden[b];
    if (!t || t.start == null || t.finish != null) return;
    const f = finishUitSpoor(res, b); if (f == null) return;
    const eigenStart = eigenStartVan(b, t, res.gun, sp), elapsed = f - eigenStart;
    const corrected = gecorrigeerdeTijd(b, f, res.gun, sp, eigenStart);
    const pts = normaliseerSpoor(res.sporen[b]).map(p => ({ lat: p[0], lng: p[1], ts: t0 + p[2] * 1000 }));
    voorstel.push({ b, f, elapsed, corrected, afstand: Math.round(afgelegdM(pts, Math.max(t.start, eigenStart), f)) });
  });
  const nm = b => (res.namen && res.namen[b]) || naamVan(b);
  if (!voorstel.length) { alert('Geen boot zonder finish die volgens zijn spoor over de finishlijn van deze race ging.'); return; }
  if (!confirm(`Race ${nr}: finish uit het spoor halen (over de finishlijn zoals die aan het eind van de race lag)?\n\n` +
    voorstel.map(v => `${nm(v.b)}: finish ${formatKlok(v.f)} → verzeild ${formatDuur(v.elapsed)}, gecorrigeerd ${formatDuur(v.corrected)}`).join('\n') +
    '\n\nHet tijdstip is tussen twee spoorpunten ingeschat (enkele seconden nauwkeurig). ' +
    'Het bewaarde journaal wordt vervangen door een journaal uit de sporen met de nieuwe uitslag.')) return;
  const upd = { journaal: null };
  voorstel.forEach(v => {
    upd[`tijden/${v.b}/finish`] = v.f;
    upd[`uitslag/${v.b}`] = { gefinisht: true, elapsed: v.elapsed, corrected: v.corrected, afstand: v.afstand };
  });
  try {
    await db.ref(`${P}/results/${nr}`).update(upd);
    toonWlStatus(`Race ${nr} gecorrigeerd: ${voorstel.map(v => nm(v.b)).join(', ')} alsnog gefinisht.`);
  } catch (e) { alert('Opslaan mislukt: ' + dbFoutTekst(e)); }
}

// Afgelegde afstand voor races die zonder afstand zijn opgeslagen (van vóór die
// functie): achteraf berekend uit het bewaarde spoor, van de eigen start (de
// lijnkruising, maar niet vóór het eigen startsein) tot de finish.
function afstandUitSpoor(res, b) {
  const t = res.tijden && res.tijden[b], ruw = res.sporen && res.sporen[b];
  if (!t || t.start == null || !ruw) return null;
  const t0 = res.t0 || res.ts;
  const sein = res.gun != null ? res.gun + ((res.modus === 'achtervolging' && res.vertraging && res.vertraging[b]) || 0) : null;
  const van = sein != null ? Math.max(t.start, sein) : t.start;
  const pts = normaliseerSpoor(ruw).map(p => ({ lat: p[0], lng: p[1], ts: t0 + p[2] * 1000 }));
  return afgelegdM(pts, van, t.finish);
}

// =========================================================
//  Ratingcheck: welke rating 'verdiende' elke boot in de afgeronde races?
// =========================================================
// Per race: de rating waarbij alle gefinishte boten precies gelijk waren geëindigd
// (verdiend ∝ baanlengte / verzeilde tijd), zo geschaald dat het gemiddelde gelijk blijft
// aan dat van de huidige ratings. Over de races: het geometrisch gemiddelde van
// verdiend / huidig per boot. Advies pas vanaf RATING_MIN_RACES races.
const RATING_MIN_RACES = 3;
function ratingVerdiend(res) {
  const fin = uitslagLijst(res).filter(r => r.gefinisht && r.elapsed > 0 && BOTEN[r.naam]);
  if (fin.length < 2) return null;
  const lengte = b => (res.lengtes && res.lengtes[b]) || 1;      // lusstart: elke boot een eigen baanlengte
  const gemHuidig = fin.reduce((s, r) => s + BOTEN[r.naam].rating, 0) / fin.length;
  const gemSnel = fin.reduce((s, r) => s + lengte(r.naam) / r.elapsed, 0) / fin.length;
  const uit = {};
  fin.forEach(r => { uit[r.naam] = (lengte(r.naam) / r.elapsed) / gemSnel * gemHuidig; });
  return uit;
}
function ratingCheckHtml(nummers) {
  const perRace = nummers.map(nr => ({ nr, v: ratingVerdiend(resultsData[nr]) })).filter(x => x.v);
  if (!perRace.length) return '';
  const pct = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
  const boten = FLEET.filter(b => perRace.some(x => x.v[b] != null));
  const samen = {};
  boten.forEach(b => {
    const verh = perRace.map(x => x.v[b]).filter(v => v != null).map(v => v / BOTEN[b].rating);
    const geo = Math.exp(verh.reduce((s, v) => s + Math.log(v), 0) / verh.length);
    samen[b] = { n: verh.length, verdiend: BOTEN[b].rating * geo, afwijking: geo - 1 };
  });
  const advies = boten.some(b => samen[b].n >= RATING_MIN_RACES);
  let h = '<div class="u-tabel"><h3>⚖️ Ratingcheck</h3><div class="sub">Welke rating had elke boot nodig gehad om precies ' +
    'gelijk te eindigen? Gemiddeld over de afgeronde races, met dezelfde gemiddelde rating als nu. ' +
    (advies ? '' : `<b>Indicatie — nog te weinig races voor een advies</b> (vanaf ${RATING_MIN_RACES} per boot).`) + '</div>' +
    '<div class="tabelscroll"><table><thead><tr><th>Boot</th><th class="tijd">Nu</th>' +
    perRace.map(x => `<th class="tijd">R${x.nr}</th>`).join('') +
    '<th class="tijd">Gemiddeld</th><th class="tijd">Verschil</th></tr></thead><tbody>';
  boten.forEach(b => {
    const s = samen[b];
    h += `<tr><td class="boot-cel">${dotHtml(b)}${esc(naamVan(b))}</td><td class="tijd">${BOTEN[b].rating.toFixed(3)}</td>` +
      perRace.map(x => `<td class="tijd">${x.v[b] != null ? x.v[b].toFixed(3) : '—'}</td>`).join('') +
      `<td class="tijd"><b>${s.verdiend.toFixed(3)}</b></td>` +
      `<td class="tijd${Math.abs(s.afwijking) >= 0.03 ? ' rating-opvallend' : ''}">${pct(s.afwijking)}</td></tr>`;
  });
  h += '</tbody></table></div>';
  if (advies) {
    const lijst = boten.filter(b => samen[b].n >= RATING_MIN_RACES && Math.abs(samen[b].afwijking) >= 0.02)
      .map(b => `${esc(naamVan(b))}: ${BOTEN[b].rating.toFixed(3)} → <b>${samen[b].verdiend.toFixed(3)}</b>`);
    h += `<div class="sub" style="margin-top:8px">${lijst.length ? 'Advies (in <code>config.js</code>, via de GPH): ' + lijst.join(' · ')
      : 'De ratings kloppen goed: geen boot wijkt 2% of meer af.'}</div>`;
  }
  return h + '<div class="sub">Let op: bemanning, starts en het soort baan (kruisen, ruime wind) tellen hier ook mee. ' +
    'Beoordeel liever meerdere races met verschillende omstandigheden.</div></div>';
}

// =========================================================
//  Polars: de snelheid van elke boot per windhoek en windsterkte (polar.js)
// =========================================================
let polarCache = null, polarBoot = null;
// Plek voor de wind: midden van de startlijn, anders het eerste spoorpunt
function racePlek(res) {
  const l = res.baan && res.baan.lines && res.baan.lines.start;
  if (l && l.a) return lijnMidden(l);
  const eerste = Object.values(res.sporen || {}).map(normaliseerSpoor).find(p => p.length);
  return eerste ? { lat: eerste[0][0], lng: eerste[0][1] } : null;
}
function raceEinde(res) {
  const t0 = res.t0 || res.ts;
  const finishes = Object.values(res.tijden || {}).map(t => t && t.finish).filter(Boolean);
  const sporen = Object.values(res.sporen || {}).map(normaliseerSpoor).map(p => p.length ? t0 + p[p.length - 1][2] * 1000 : 0);
  return Math.max(res.gun || t0, ...finishes, ...sporen);
}
async function laadPolars(nummers) {
  const vak = el('polarSectie'); if (!vak) return;
  const bruikbaar = nummers.filter(nr => resultsData[nr] && resultsData[nr].sporen && resultsData[nr].gun);
  const sleutel = bruikbaar.map(nr => nr + ':' + resultsData[nr].ts).join(',');
  if (!bruikbaar.length) { vak.remove(); return; }
  if (!polarCache || polarCache.sleutel !== sleutel) {
    vak.innerHTML = '<h3>🧭 Polars</h3><div class="sub">Wind ophalen en polars opbouwen…</div>';
    const races = await Promise.all(bruikbaar.map(async nr => {
      const res = resultsData[nr], plek = racePlek(res);
      const uren = Array.isArray(res.wind) && res.wind.length ? res.wind
        : plek ? await Polar.windUren(plek, res.gun - 3600e3, raceEinde(res) + 3600e3) : [];
      return { res, uren };
    }));
    const polars = Polar.bouw(races);
    polarCache = { sleutel, data: polars.boten, correcties: polars.correcties, races: races.filter(r => r.uren.length).length };
  }
  const nu = el('polarSectie'); if (!nu) return;                      // intussen opnieuw getekend
  toonPolars(nu, polarCache);
}
function toonPolars(vak, cache) {
  const boten = FLEET.filter(b => cache.data[b] && cache.data[b].n);
  if (!boten.length) { vak.innerHTML = '<h3>🧭 Polars</h3><div class="sub">Nog geen bruikbare metingen (geen wind of sporen gevonden).</div>'; return; }
  if (!boten.includes(polarBoot)) polarBoot = boten[0];
  const p = cache.data[polarBoot];
  const maxKn = Math.max(...boten.flatMap(b => Object.values(cache.data[b].vakken).flatMap(v => Object.values(v).map(x => x.kn))));
  const krachten = Object.keys(p.vakken).sort((a, b) => a - b);
  vak.innerHTML = '<h3>🧭 Polars</h3>' +
    `<div class="sub">Snelheid per windhoek en windsterkte, opgebouwd uit ${cache.races} gezeilde race${cache.races === 1 ? '' : 's'}. ` +
    'Snelheid over de grond en modelwind (Open-Meteo): een indicatie die beter wordt met elke race.</div>' +
    '<div class="polar-boten">' + boten.map(b => `<button type="button" class="race-knop polar-kies${b === polarBoot ? ' actief' : ''}" ` +
      `data-boot="${b}">${dotHtml(b)}${esc(naamVan(b))}</button>`).join('') + '</div>' +
    `<div class="polar-kaart">${Polar.svg(p, maxKn)}</div>` +
    '<div class="polar-legenda">' + krachten.map(k => {
      const n = Object.values(p.vakken[k]).reduce((s, x) => s + x.n, 0);
      return `<span><i style="background:${Polar.kleurVan(k)}"></i>${k} Bft <small>(${n} metingen)</small></span>`;
    }).join('') + '</div>' +
    '<div class="sub">' + (krachten.filter(k => p.beste[k]).map(k => { const x = p.beste[k];
      return `<b>${k} Bft</b>: beste kruishoek ${Math.round(x.twa)}° bij ${x.kn.toFixed(1)} kn (VMG ${x.vmg.toFixed(1)} kn)`; }).join(' · ')
      || 'Nog te weinig metingen aan de wind voor een beste kruishoek.') +
    `. Vage punten: minder dan ${Polar.MIN_METINGEN} metingen.</div>` +
    '<div class="sub">Windrichting: ' + ((cache.correcties || []).map(c => c.graden == null
      ? `race ${c.nr} zoals het model (te weinig overstagmomenten om bij te stellen)`
      : `race ${c.nr} bijgesteld met ${c.graden > 0 ? '+' : '−'}${Math.abs(Math.round(c.graden))}° uit ${c.n} overstagmomenten`).join(' · ')) +
    '. De echte wind ligt bij kruisen midden tussen de koersen vóór en na een overstag.</div>';
}
el('uitslagenInhoud').addEventListener('click', e => {
  const k = e.target.closest('.polar-kies'); if (!k || !polarCache) return;
  polarBoot = k.dataset.boot; toonPolars(el('polarSectie'), polarCache);
});

// Het scheepsjournaal bij een afgeronde race (bewaard, of achteraf opnieuw gemaakt)
function journaalUitslagHtml(res, nm) {
  let j;
  try { j = Verteller.uitArchief(res, nm); } catch (e) { return ''; }
  if (!j.notities.length) return '';
  return '<details class="journaal-uitslag"><summary>📜 Scheepsjournaal' +
    (j.achteraf ? ' <small>(achteraf opgemaakt uit de sporen)</small>' : '') + '</summary><div class="journaal">' +
    [...j.notities].reverse().map(n => `<div class="journaal-item"><div class="journaal-kop">${esc(n.kop)}</div>` +
      `<div class="journaal-tekst">${esc(n.tekst)}</div></div>`).join('') + '</div></details>';
}
function renderUitslagen() {
  const houder = el('uitslagenInhoud');
  const nummers = Object.keys(resultsData).map(Number).filter(n => resultsData[n]).sort((a, b) => a - b);
  if (!nummers.length) {
    houder.innerHTML = '<div class="leeg">Nog geen races afgerond. De wedstrijdleiding rondt een race af via ' +
      '"Race afronden &amp; opslaan" (Live-tab met ?wl).</div>' + zeeslagenHtml();
    return;
  }
  // klassement en races eerst, dan de zeeslagen; de analyses (ratingcheck en polars) onderaan
  houder.innerHTML =
    klassementHtml('Klassement', `Op gecorrigeerde tijd (met rating) · low-point · niet gefinisht = ${DNF_PUNTEN} punten`, nummers, 'corrected') +
    [...nummers].reverse().map(raceHtml).join('') +
    zeeslagenHtml() +
    ratingCheckHtml(nummers) +
    '<div class="u-tabel" id="polarSectie"></div>';
  laadPolars(nummers);
}
el('uitslagenInhoud').addEventListener('click', e => {
  const k = e.target.closest('.race-knop'); if (!k) return;
  const zs = k.dataset.zeeslag;
  if (zs) {                                                   // knoppen van een zeeslag
    if (k.classList.contains('afspelen')) openZeeslagReplay(zs);
    else if (admin && k.classList.contains('wis') && confirm('Deze zeeslag definitief verwijderen?'))
      db.ref(`${P}/zeeslagen/${zs}`).remove().catch(err => meldFout(dbFoutTekst(err)));
    return;
  }
  const nr = k.dataset.nr;
  if (k.classList.contains('afspelen')) { openReplay(nr); return; }
  if (!admin) return;
  if (k.classList.contains('finishfix')) { corrigeerFinishUitSpoor(nr); return; }
  if (k.classList.contains('wis')) {
    if (confirm(`Race ${nr} definitief verwijderen uit de uitslagen?`))
      db.ref(`${P}/results/${nr}`).remove().catch(err => meldFout(dbFoutTekst(err)));
  } else if (k.classList.contains('hernoem')) {
    const naam = prompt(`Naam voor race ${nr} (leeg = geen naam):`, (resultsData[nr] && resultsData[nr].naam) || '');
    if (naam !== null) db.ref(`${P}/results/${nr}/naam`).set(naam.trim().slice(0, 60) || null)
      .catch(err => meldFout(dbFoutTekst(err)));
  }
});

// =========================================================
//  Replay van een afgeronde race: tijdslider, afspelen, video, foto
// =========================================================
// Zet een opgeslagen race om naar wat de replay en de video nodig hebben
function raceWeergave(nr) {
  const res = resultsData[nr];
  if (!res || !res.sporen) return null;
  const lijst = uitslagLijst(res), rMet = rangen(lijst, 'corrected');
  const nm = b => (res.namen && res.namen[b]) || naamVan(b);
  // De replay loopt van 5 minuten vóór het startschot tot de finish van de laatste
  // boot die binnenkwam. Daarbuiten (naar het startgebied varen, terug naar de haven,
  // boten die niet finishten na die tijd) wordt weggeknipt; de tijd telt vanaf het beginmoment.
  const opname0 = res.t0 || res.ts;
  const knip = res.gun ? Math.max(0, (res.gun - opname0) / 1000 - 5 * 60) : 0;
  const t0 = opname0 + knip * 1000;
  const gunS = res.gun ? (res.gun - t0) / 1000 : null;
  const finishes = FLEET.filter(b => res.sporen[b]).map(b => res.tijden && res.tijden[b] && res.tijden[b].finish).filter(f => f != null);
  const eindS = finishes.length ? (Math.max(...finishes) - t0) / 1000 : Infinity;   // niemand binnen: tot het eind van de opname
  const bijgeknipt = v => {
    let pts = zonderUitschieters(normaliseerSpoor(v)).map(p => [p[0], p[1], p[2] - knip]);
    const i = pts.findIndex(p => p[2] >= 0);
    if (i === -1) pts = pts.length ? [[pts[pts.length - 1][0], pts[pts.length - 1][1], 0]] : [];
    else if (i > 0) pts = [[pts[i - 1][0], pts[i - 1][1], 0]].concat(pts.slice(i));   // positie op het beginmoment
    const j = pts.findIndex(p => p[2] > eindS);
    if (j > 0) pts = pts.slice(0, j).concat([[pts[j - 1][0], pts[j - 1][1], eindS]]);  // stop bij de laatste finish
    else if (j === 0) pts = [[pts[0][0], pts[0][1], Math.max(0, eindS)]];
    return pts;
  };
  const sporen = FLEET.filter(b => res.sporen[b])
    .sort((a, b) => (rMet[a] || 99) - (rMet[b] || 99))
    .map(b => {
      const u = (res.uitslag || {})[b] || {};
      const fin = res.tijden && res.tijden[b] && res.tijden[b].finish;
      return { boot: b, kleur: BOTEN[b].kleur, naam: nm(b), pts: bijgeknipt(res.sporen[b]),
        finishS: fin ? (fin - t0) / 1000 : null,
        legenda: u.gefinisht ? `${rMet[b]}. ${nm(b)} — ${formatDuur(u.elapsed)} (gecorr. ${formatDuur(u.corrected)})`
                             : `${nm(b)} — DNF` };
    });
  const klok = t => {
    const s = new Date(t0 + t * 1000).toLocaleTimeString('nl-NL', { hour12: false });
    if (gunS == null) return s;
    const r = t - gunS;
    return `${s} · racetijd ${r < 0 ? '−' + formatDuur(-r * 1000) : formatDuur(r * 1000)}`;
  };
  // Doelovergangen voor de camera: elke start, elke boeironding en elke finish (replay-seconden).
  // Rondingen uit de bewaarde rondingstijden, anders het moment dat de boot het dichtst langs de boei voer.
  const lijnenR = (res.baan && res.baan.lines) || {}, marksR = alsBoeien(res.baan && res.baan.marks), doelen = [];
  const lijnVak = l => L.latLngBounds([[l.a.lat, l.a.lng], [l.b.lat, l.b.lng]]);
  sporen.forEach(sp => {
    const b = sp.boot, tt = (res.tijden && res.tijden[b]) || {};
    if (tt.start && lijnenR.start && lijnenR.start.a) doelen.push({ s: (Math.max(tt.start, res.gun || 0) - t0) / 1000, vak: lijnVak(lijnenR.start) });
    if (tt.finish && lijnenR.finish && lijnenR.finish.a) doelen.push({ s: (tt.finish - t0) / 1000, vak: lijnVak(lijnenR.finish) });
    baanVanBoot(marksR, res.lussen || null, b).forEach(bo => {
      const ts = res.rondingen && res.rondingen[b] && res.rondingen[b][bo.id];
      let s = ts ? (ts - t0) / 1000 : null;
      if (s == null) {
        let dichtst = 150;
        sp.pts.forEach(p => { const d = afstandMeter({ lat: p[0], lng: p[1] }, bo); if (d < dichtst) { dichtst = d; s = p[2]; } });
      }
      if (s != null) doelen.push({ s, vak: L.latLng(bo.lat, bo.lng).toBounds(300) });
    });
  });
  doelen.sort((a, c) => a.s - c.s);
  return { titel: `Race ${nr}${res.naam ? ': ' + res.naam : ''}`, klok, sporen, baan: res.baan, lussen: res.lussen || null, gunS, t0, doelen,
    // wind per uur: bewaard bij het afronden, anders achteraf ophalen (Open-Meteo)
    windUren: () => res.wind ? Promise.resolve(res.wind)
      : racePlek(res) && res.gun ? Polar.windUren(racePlek(res), res.gun - 3600e3, raceEinde(res) + 3600e3) : Promise.resolve([]) };
}

// Zet een opgeslagen zeeslag om naar dezelfde vorm (plus de spelgegevens voor kogels, kisten en mijnen)
function zeeslagWeergave(key) {
  const z = zeeslagenData[key];
  if (!z || !z.sporen) return null;
  const nm = b => (z.namen && z.namen[b]) || naamVan(b);
  const t0 = z.t0, gunS = (z.start - t0) / 1000;
  const sporen = FLEET.filter(b => z.sporen[b]).map(b => ({ boot: b, kleur: BOTEN[b].kleur, naam: nm(b),
    pts: zonderUitschieters(normaliseerSpoor(z.sporen[b])), finishS: null, legenda: nm(b) }));
  const klok = t => {
    const s = new Date(t0 + t * 1000).toLocaleTimeString('nl-NL', { hour12: false }), r = t - gunS;
    return `${s} · zeeslag ${r < 0 ? '−' + formatDuur(-r * 1000) : formatDuur(r * 1000)}`;
  };
  const posTs = {};
  (z.deelnemers || Object.keys(z.sporen)).forEach(b => { posTs[b] = z.start; });
  const wanneer = new Date(z.start).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const plek = (z.spel && z.spel.veld) || (sporen[0] && { lat: sporen[0].pts[0][0], lng: sporen[0].pts[0][1] });
  return { titel: `🏴‍☠️ Zeeslag ${wanneer}`, klok, sporen, baan: null, lussen: null, gunS, t0, zeeslag: z, posTs, naam: nm,
    windUren: () => plek ? Polar.windUren(plek, z.start - 3600e3, (z.over || z.start) + 3600e3) : Promise.resolve([]) };
}

let rp = null;   // replay-toestand
const REPLAY_SCHAAL = 0.5;   // schepen in de replay half zo groot als live, zodat het spoor zichtbaar blijft
function openReplay(nr) { const data = raceWeergave(nr); if (data) toonReplay(data, 'race-' + nr); }
function openZeeslagReplay(key) { const data = zeeslagWeergave(key); if (data) toonReplay(data, 'zeeslag-' + key); }
function toonReplay(data, nr) {
  el('replay').hidden = false;
  el('replayTitel').textContent = data.titel;
  if (!rp) {
    rp = { kaart: maakKaart('replayKaart'), lagen: [], snelheid: 60, duurS: 30 };
    rp.kaart.options.zoomSnap = 0;             // traploos zoomen: het speelveld vult de kaart, en het inzoomen loopt vloeiend
    rp.kaart._fadeAnimated = false;            // tegels meteen helemaal zichtbaar (ook in een opname)
    // de wind van dat moment (linksonder, zoals op de live kaart)
    const wind = L.control({ position: 'bottomleft' });
    wind.onAdd = () => {
      const d = L.DomUtil.create('div', 'windwidget');
      d.innerHTML = '<div class="windpijl" title="wijst mee met de wind">↑</div><div><div class="kop">Wind</div>' +
        '<div class="spd">– Bft</div><div class="windsub">laden…</div></div>';
      rp.windEl = d; return d;
    };
    wind.addTo(rp.kaart);
    rp.windCtl = wind;
    // de legenda van 'snelheid in kleur' staat op de kaart zelf (linksonder)
    const schaal = L.control({ position: 'bottomleft' });
    schaal.onAdd = () => { const d = L.DomUtil.create('div', ''); d.appendChild(el('snelheidSchaal')); return d; };
    schaal.addTo(rp.kaart);
    rp.kaart.on('dragstart', () => {});
    kaartKnoppen(rp.kaart, [meetKnop('knopMeetReplay', () => rp.meetlat)]);
    rp.meetlat = maakMeetlat(rp.kaart, 'knopMeetReplay');
  }
  pauzeReplay();
  vluchtId++;                                    // een lopende zoomvlucht van de vorige replay stoppen
  rp.lagen.forEach(l => rp.kaart.removeLayer(l));
  if (rp.zs) Object.values(rp.zs.richt || {}).forEach(l => l && rp.kaart.removeLayer(l));   // kanonbereik van de vorige zeeslag
  rp.lagen = []; rp.nr = nr; rp.data = data;
  rp.warp = null;                                // tabel voor de 30 s-stand: per replay opnieuw
  rp.camDoel = null; rp.camKlaar = null;         // camera van de race-replay: begint met de hele baan
  // wind per uur ophalen; de windwidget volgt de replaytijd
  rp.windUren = null;
  rp.windEl.querySelector('.windsub').textContent = 'laden…';
  data.windUren().then(u => { if (rp.data !== data) return; rp.windUren = u || []; zetReplayWind(rp.t); }).catch(() => {});
  const lines = (data.baan && data.baan.lines) || {}, marks = alsBoeien(data.baan && data.baan.marks);
  ['start', 'finish'].forEach(t => {
    const ln = lines[t]; if (!(ln && ln.a)) return;
    tekenStartFinish(rp.kaart, ln, t, rp.lagen, { interactive: false });
  });
  marks.forEach((b, i) => rp.lagen.push(L.marker([b.lat, b.lng], { icon: boeiIcoon(i), interactive: false }).addTo(rp.kaart)));
  tekenLussen(rp.kaart, marks, lines, data.lussen, rp.lagen, b => (data.sporen.find(s => s.boot === b) || {}).naam || naamVan(b));
  // Zeeslag: het speelveld; kisten, mijnen en salvo's worden per tijdstip bijgewerkt
  rp.zs = null;
  if (data.zeeslag) {
    const veld = Piraat.veldLaag(rp.kaart, data.zeeslag.spel && data.zeeslag.spel.veld, null);
    if (veld) rp.lagen.push(veld);
    rp.zs = { veld, kistLaag: null, kistSleutel: '', mijnLaag: null, mijnSleutel: '', vorigMs: null, salvo: {}, richt: {} };
    // alle geldige salvo's (in replay-seconden): daar remt de replay af en zoomt hij in
    const zsp = data.zeeslag.spel || {};
    rp.zs.salvoTijden = Piraat.stand(Object.assign({}, zsp, { eind: data.zeeslag.over || zsp.eind }), data.posTs, Infinity)
      .geldig.map(g => ({ s: (g.schot.ts - data.t0) / 1000, g }));
  }
  rp.boten = data.sporen.map(s => {
    const lijn = L.polyline([], { color: s.kleur, weight: 4, opacity: .9, interactive: false }).addTo(rp.kaart);
    const stip = maakSchip([0, 0], s.boot, REPLAY_SCHAAL)
      .bindTooltip(esc(s.naam), { permanent: true, direction: 'top', className: 'boot-label', offset: schipLabelOffset(s.boot, REPLAY_SCHAAL) });
    if (data.zeeslag) zetSchipStaat(stip, { spel: true });          // zeeslag: piratenschepen
    rp.lagen.push(lijn, stip);
    return { s, lijn, stip };
  });
  rp.eind = Math.max(0, ...data.sporen.map(s => s.pts.length ? s.pts[s.pts.length - 1][2] : 0));
  // zeeslag: minstens tot 10 s na het einde, zodat het laatste salvo (en de klap) ook te zien is,
  // ook als de sporen net daarvoor ophouden (de schepen blijven dan op hun laatste plek)
  if (data.zeeslag && data.zeeslag.over) rp.eind = Math.max(rp.eind, (data.zeeslag.over - data.t0) / 1000 + 10);
  // Overstagmomenten per boot (van het startschot tot de eigen finish); labels pas tonen met de schakelaar
  rp.overstag = data.sporen.map(s => ({ s, lijst: overstagHoeken(s.pts, data.gunS != null ? data.gunS : 0,
    s.finishS != null ? s.finishS : Infinity).map(o => Object.assign(o, { marker: null })) }));
  rp.kleur = null;                                    // snelheidsspoor: pas opbouwen als de schakelaar aan gaat
  const slider = el('replaySlider');
  slider.max = Math.ceil(rp.eind); slider.value = 0;
  setTimeout(() => { rp.kaart.invalidateSize(); replayBeginBeeld(); }, 60);
  zetReplayTijd(data.gunS != null ? Math.max(0, data.gunS - 30) : 0);
}
// Het beginbeeld van de replay: zeeslag het hele speelveld, race alle sporen
function replayBeginBeeld() {
  if (rp.data.zeeslag) rp.kaart.fitBounds(speelveldVak(), { padding: [20, 20], animate: false });
  else {
    const alle = rp.data.sporen.flatMap(s => s.pts.map(p => [p[0], p[1]]));
    if (alle.length) rp.kaart.fitBounds(alle, { padding: [30, 30], maxZoom: 16, animate: false });
  }
}
// Koers op een punt in het spoor: richting vanaf een eerder punt dat minstens 8 m terug ligt
function koersInSpoor(pts, p) {
  const hier = { lat: p.lat, lng: p.lng };
  for (let j = p.i; j >= Math.max(0, p.i - 15); j--) {
    const k = koersUitBeweging({ lat: pts[j][0], lng: pts[j][1] }, hier, 8);
    if (k != null) return k;
  }
  return null;
}
// Snelheidsspoor: stukjes spoor per kleurklasse (blauw = langzaam … rood = snel). De schaal
// past zich aan de race aan: van de langzaamste tot de snelste 10% tijdens de race.
const SNELHEID_KLASSEN = 10;
function bouwSnelheidsSpoor() {
  const van = rp.data.gunS != null ? rp.data.gunS : 0;
  const perBoot = rp.data.sporen.map(s => ({ s, v: snelheidsSpoor(s.pts) }));
  const alle = [];
  perBoot.forEach(({ s, v }) => v.forEach((x, i) => {
    if (x != null && s.pts[i][2] >= van && (s.finishS == null || s.pts[i][2] <= s.finishS)) alle.push(x);
  }));
  alle.sort((a, b) => a - b);
  const lo = alle.length ? alle[Math.floor(alle.length * .1)] : 0, hi = alle.length ? alle[Math.floor(alle.length * .9)] : 1;
  const klasse = x => Math.max(0, Math.min(SNELHEID_KLASSEN - 1, Math.floor((x - lo) / Math.max(.1, hi - lo) * SNELHEID_KLASSEN)));
  rp.kleur = { lo, hi, boten: perBoot.map(({ s, v }) => {
    const stukken = [];
    let huidig = null;
    for (let i = 1; i < s.pts.length; i++) {
      const sv = v[i] != null && v[i - 1] != null ? (v[i] + v[i - 1]) / 2 : (v[i] != null ? v[i] : v[i - 1]);
      const k = sv == null ? null : klasse(sv);
      if (!huidig || huidig.k !== k) { huidig = { k, i0: i - 1, i1: i, stand: 'uit' }; stukken.push(huidig); }
      else huidig.i1 = i;
    }
    stukken.forEach(st => {
      st.laag = L.polyline([], { color: st.k == null ? '#8e7550' : snelheidKleur((st.k + .5) / SNELHEID_KLASSEN),
        weight: 4, opacity: 1, interactive: false });
      rp.lagen.push(st.laag);
    });
    return { s, stukken };
  }) };
}
function tekenSnelheidsSpoor(t, aan) {
  if (aan && !rp.kleur) bouwSnelheidsSpoor();
  el('snelheidSchaal').hidden = !aan;
  if (aan) { el('schaalMin').textContent = rp.kleur.lo.toFixed(1) + ' kn'; el('schaalMax').textContent = rp.kleur.hi.toFixed(1) + ' kn'; }
  if (!rp.kleur) return;
  rp.kleur.boten.forEach(({ s, stukken }) => {
    const p = aan ? positieOp(s.pts, t) : null;
    stukken.forEach(st => {
      const stand = !p || s.pts[st.i0][2] > t ? 'uit' : st.i1 <= p.i ? 'vol' : 'deel';
      if (stand === 'uit') { if (st.stand !== 'uit') { rp.kaart.removeLayer(st.laag); st.stand = 'uit'; } return; }
      if (stand === 'vol' && st.stand === 'vol') return;          // al helemaal getekend
      const ll = s.pts.slice(st.i0, Math.min(st.i1, p.i) + 1).map(q => [q[0], q[1]]);
      if (stand === 'deel') ll.push([p.lat, p.lng]);
      st.laag.setLatLngs(ll);
      if (st.stand === 'uit') st.laag.addTo(rp.kaart);
      st.stand = stand;
    });
  });
}
// Wind op replaytijd t (uit de uurgegevens), zoals de windwidget van de live kaart
const replayWindOp = t => rp.windUren && rp.windUren.length ? Polar.windOp(rp.windUren, rp.data.t0 + t * 1000) : null;
function zetReplayWind(t) {
  if (!rp.windUren) return;
  const w = replayWindOp(t), d = rp.windEl;
  d.classList.toggle('fout', !w);
  d.querySelector('.spd').textContent = w ? bft(w.kn) + ' Bft' : '– Bft';
  d.querySelector('.windsub').textContent = w ? `uit ${kompas(w.richting)} (${Math.round(w.richting)}°)` : 'wind onbekend';
  if (w) d.querySelector('.windpijl').style.transform = `rotate(${w.richting + 180}deg)`;   // wijst met de wind mee
}
function zetReplayTijd(t) {
  rp.t = t;
  zetReplayWind(t);
  // windwidget uit de weg als er een schip onder komt (hooguit 3× per seconde kijken)
  const nuEcht = performance.now();
  if (!rp.wijkTijd || nuEcht - rp.wijkTijd > 300) {
    rp.wijkTijd = nuEcht;
    wijkUit(rp.kaart, rp.windCtl, rp.boten.filter(x => rp.kaart.hasLayer(x.stip)).map(x => x.stip.getLatLng()));
  }
  el('replaySlider').value = t;
  const kleurAan = el('replaySnelheidKleur').checked;
  rp.boten.forEach(({ s, lijn, stip }) => {
    const p = positieOp(s.pts, t);
    if (!p) { lijn.setLatLngs([]); if (rp.kaart.hasLayer(stip)) rp.kaart.removeLayer(stip); return; }
    lijn.setLatLngs(s.pts.slice(0, p.i + 1).map(q => [q[0], q[1]]).concat([[p.lat, p.lng]]));
    // met snelheidskleuren wordt de bootkleur een brede rand onder het gekleurde spoor
    lijn.setStyle(kleurAan ? { weight: 9, opacity: .8 } : { weight: 4, opacity: .9 });
    stip.setLatLng([p.lat, p.lng]);
    if (!rp.kaart.hasLayer(stip)) stip.addTo(rp.kaart);
    zetKoers(stip, koersOp(s.pts, t, stip._koers));                 // rustige koers, zonder GPS-gewiebel
  });
  tekenSnelheidsSpoor(t, kleurAan);
  el('replayKlok').textContent = rp.data.klok(t);
  // Overstaghoeken: een label bij elk overstagmoment dat op tijdstip t al geweest is
  const toon = el('replayOverstag').checked;
  (rp.overstag || []).forEach(({ s, lijst }) => lijst.forEach(o => {
    const zichtbaar = toon && o.s <= t;
    if (zichtbaar && !o.marker) {
      o.marker = L.marker([o.lat, o.lng], { interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'overstag-label', html: `<span style="border-color:${s.kleur}">${o.hoek}°</span>`, iconSize: [0, 0] }) });
      rp.lagen.push(o.marker);
    }
    if (o.marker) { if (zichtbaar && !rp.kaart.hasLayer(o.marker)) o.marker.addTo(rp.kaart);
                    if (!zichtbaar && rp.kaart.hasLayer(o.marker)) rp.kaart.removeLayer(o.marker); }
  }));
  const overstagTekst = b => {
    const o = toon && (rp.overstag || []).find(x => x.s.boot === b);
    if (!o || !o.lijst.length) return '';
    const gem = Math.round(o.lijst.reduce((a, x) => a + x.hoek, 0) / o.lijst.length);
    return ` · overstag gem. ${gem}° (${o.lijst.length}×)`;
  };
  if (rp.zs) { zetZeeslagTijd(t); return; }
  el('replayLegenda').innerHTML = rp.data.sporen.map(s =>
    `<div>${dotHtml(s.boot)}${s.finishS != null && t >= s.finishS ? '🏁 ' : ''}${esc(s.legenda)}${overstagTekst(s.boot)}</div>`).join('');
}
// Positie van boot b op tijdstip ms in de replay (null als er dan geen spoor is)
function replayPosOp(b, ms) {
  const d = rp.data, s = d.sporen.find(x => x.boot === b), p = s && positieOp(s.pts, (ms - d.t0) / 1000);
  return p ? { lat: p.lat, lng: p.lng } : null;
}
// Zeeslag in de replay op tijdstip t: de stand van dat moment (levens, raak, salvo's), de kisten
// die toen in het water lagen, de mijnen, en een rookwolkje op elke plek waar een salvo viel.
// Tijdens het afspelen vliegen de kogels zoals live.
function zetZeeslagTijd(t) {
  const d = rp.data, z = d.zeeslag, spel = z.spel || {}, nuMs = d.t0 + t * 1000, zs = rp.zs;
  const st = Piraat.stand(Object.assign({}, spel, { eind: Math.min(spel.eind || Infinity, nuMs, z.over || Infinity) }), d.posTs, Infinity);
  if (zs.veld) zs.veld.setRadius(Piraat.straal(spel.veld, z.start, Math.min(nuMs, z.over || Infinity)));   // het krimpende speelveld
  const posOp = replayPosOp;
  // kisten: alleen die op dit moment in het water lagen en nog niet gepakt waren
  const buit = {};
  Object.entries(spel.buit || {}).forEach(([nr, k]) => { if (k && k.ts <= nuMs) buit[nr] = k; });
  const kisten = nuMs >= z.start ? Piraat.kisten(Object.assign({}, spel, { buit, eind: z.over || spel.eind }), nuMs) : [];
  const kSleutel = kisten.map(k => k.nr).join(',');
  if (kSleutel !== zs.kistSleutel) {
    zs.kistLaag = Piraat.kistLagen(rp.kaart, kisten, zs.kistLaag); zs.kistSleutel = kSleutel;
    if (!rp.lagen.includes(zs.kistLaag.groep)) rp.lagen.push(zs.kistLaag.groep);
  }
  const mijnen = st.mijnen.filter(m => m.actief), mSleutel = mijnen.map(m => m.id).join(',');
  if (mSleutel !== zs.mijnSleutel) {
    zs.mijnLaag = Piraat.mijnLagen(rp.kaart, mijnen, zs.mijnLaag); zs.mijnSleutel = mSleutel;
    if (zs.mijnLaag) rp.lagen.push(zs.mijnLaag);
  }
  // salvo's: een rookwolkje (met wie, en wie er geraakt werd) vanaf het moment van schieten
  st.geldig.forEach(g => {
    if (zs.salvo[g.id]) return;
    const raak = g.raak.length ? ` en raakt ${g.raak.map(d.naam).join(' en ')}` : g.geblokt.length ? ' op een schild' : ' (mis)';
    zs.salvo[g.id] = L.circleMarker([g.schot.lat, g.schot.lng], { radius: g.raak.length ? 7 : 5, color: BOTEN[g.boot].kleur, weight: 3,
      fillColor: g.raak.length ? '#8b1e12' : '#e6dcc6', fillOpacity: .9 }).bindTooltip(`${klokHM(g.schot.ts)} · ${esc(d.naam(g.boot))} vuurt${esc(raak)}`);
    rp.lagen.push(zs.salvo[g.id]);
  });
  Object.entries(zs.salvo).forEach(([id, m]) => {
    const zichtbaar = st.geldig.some(g => g.id === id);
    if (zichtbaar && !rp.kaart.hasLayer(m)) m.addTo(rp.kaart);
    if (!zichtbaar && rp.kaart.hasLayer(m)) rp.kaart.removeLayer(m);
  });
  // afspelen: de kogels laten vliegen van salvo's die sinds de vorige stap vielen
  if (rp.speelt && zs.vorigMs != null && nuMs > zs.vorigMs)
    st.geldig.filter(g => g.schot.ts > zs.vorigMs && g.schot.ts <= nuMs)
      .forEach(g => { Piraat.animeer(rp.kaart, g.schot, g.raak, b => posOp(b, g.schot.ts), g.geblokt); speel(() => kanonschot()); });
  zs.vorigMs = nuMs;
  // gezonken schepen worden een wrak; het label boven het schip toont de levens (zoals live)
  rp.boten.forEach(x => {
    const b = st.boten[x.s.boot];
    zetSchipStaat(x.stip, { spel: true, wrak: b.levens <= 0 });
    const herlaad = nuMs >= z.start ? Piraat.herlaadTekst(b, nuMs) : '';
    const label = `${esc(x.s.naam)} ${b.levens > 0 ? Piraat.levensTekst(b) : '☠️'}${herlaad ? ' ' + herlaad : ''}`;
    if (x.label !== label) { x.stip.setTooltipContent(label); x.label = label; }
  });
  // het bereik van de kanonnen (zoals live), hooguit 10× per seconde opnieuw getekend
  const nuEcht = performance.now();
  if (!rp.speelt || !zs.richtTijd || nuEcht - zs.richtTijd > 100) {
    zs.richtTijd = nuEcht;
    rp.boten.forEach(x => {
      const b = st.boten[x.s.boot], p = x.stip.getLatLng(), zicht = rp.kaart.hasLayer(x.stip) && b.levens > 0 && nuMs >= z.start;
      zs.richt[x.s.boot] = zicht ? Piraat.richtlijnen(rp.kaart, { lat: p.lat, lng: p.lng }, x.stip._koers, zs.richt[x.s.boot], false, b.lading)
        : (zs.richt[x.s.boot] && rp.kaart.removeLayer(zs.richt[x.s.boot]), null);
    });
  }
  // legenda: de stand op dit moment
  const rest = b => SPEL.schoten - b.gebruikt;
  el('replayLegenda').innerHTML = d.sporen.map(s => {
    const b = st.boten[s.boot];
    return `<div>${dotHtml(s.boot)}${esc(s.naam)} — ${b.levens ? Piraat.levensTekst(b) : '☠️ gezonken'} · ${b.hits}× raak · ${rest(b)} salvo's</div>`;
  }).join('') + (z.over && nuMs >= z.over ? `<div><b>${esc(Piraat.statusTekst(st, d.naam))}</b></div>` : '');
}
el('replayOverstag').addEventListener('change', () => { if (rp) zetReplayTijd(rp.t); });
el('replaySnelheidKleur').addEventListener('change', () => { if (rp) zetReplayTijd(rp.t); });
// ---- Zeeslag-replay: rond elk salvo vertragen tot echte tijd en inzoomen op de actie ----
// Van SALVO_VOOR s vóór tot SALVO_NA s na een salvo loopt de replay op 1× (de kogels vliegen
// in echte tijd); daarbuiten loopt de snelheid geleidelijk op naar de gekozen snelheid
// (1 + SALVO_REM × seconden buiten dat venster), dus afremmen en optrekken gaan vloeiend.
const SALVO_VOOR = 3, SALVO_NA = 2, SALVO_REM = 2, SALVO_UITZOOM = 8;   // de kogels vliegen 1,2 s
function salvoAfstand(t) {                   // seconden buiten het venster van het dichtstbijzijnde salvo (0 = erin)
  let beste = { d: Infinity, salvo: null };
  (rp.zs && rp.zs.salvoTijden || []).forEach(x => {
    const d = t < x.s - SALVO_VOOR ? x.s - SALVO_VOOR - t : t > x.s + SALVO_NA ? t - x.s - SALVO_NA : 0;
    if (d < beste.d) beste = { d, salvo: x };
  });
  return beste;
}
const replaySnelheidOp = t => rp.zs ? Math.max(1, Math.min(rp.snelheid, 1 + SALVO_REM * salvoAfstand(t).d)) : rp.snelheid;
// Vloeiend naar een vak zoomen: zacht op gang komen en zacht afremmen (easeInOut). Het is één
// rechte zoom rond een vast draaipunt: het punt dat aan het begin en aan het eind op dezelfde
// plek op het scherm staat, blijft tijdens de hele beweging staan. Zo zoomt de kaart in één keer
// naar het doel, zonder eerst op een ander punt in te zoomen en dan te schuiven.
// Het doel (midden en zoom) wordt vooraf in één keer bepaald. Een nieuwe vlucht onderbreekt de vorige.
let vluchtId = 0;
function vliegZacht(kaart, vak, duur, maxZoom = 17, rand = 30) {
  const id = ++vluchtId, t0 = performance.now();
  const vanZ = kaart.getZoom(), naarZ = Math.min(maxZoom, kaart.getBoundsZoom(vak, false, L.point(rand, rand).multiplyBy(2)));
  const c0 = kaart.project(kaart.getCenter(), 0), c1 = kaart.project(vak.getCenter(), 0);   // wereldpixels op zoom 0
  const s0 = Math.pow(2, -vanZ), s1 = Math.pow(2, -naarZ);                                 // wereldpixels per schermpixel
  const zacht = f => f < .5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
  // Zoals Leaflets eigen flyTo: met _move per beeld blijven de kaarttegels staan (ze worden
  // geschaald tot de scherpere geladen zijn). setView per beeld wist alle tegels telkens,
  // en dan zie je tijdens het zoomen alleen de (gele) achtergrond van de kaart.
  kaart.stop(); kaart._moveStart(true, false);
  (function stap(nu) {
    if (id !== vluchtId) { kaart._moveEnd(true); return; }
    const f = Math.min(1, (nu - t0) / duur), e = zacht(f), z = vanZ + (naarZ - vanZ) * e, s = Math.pow(2, -z);
    // midden zo dat de beweging een zuivere zoom rond het draaipunt is (bij gelijke zoom: gewoon schuiven)
    const deel = Math.abs(s0 - s1) > 1e-12 ? (s0 - s) / (s0 - s1) : e;
    const c = L.point(c0.x + (c1.x - c0.x) * deel, c0.y + (c1.y - c0.y) * deel);
    kaart._move(kaart.unproject(c, 0), z, { flyTo: true });
    if (f < 1) requestAnimationFrame(stap); else kaart._moveEnd(true);
  })(t0);
}
// Het hele speelveld in beeld (plus de sporen, als iemand erbuiten voer)
function speelveldVak() {
  const v = rp.data.zeeslag && rp.data.zeeslag.spel && rp.data.zeeslag.spel.veld;
  const vak = v && v.r ? L.latLng(v.lat, v.lng).toBounds(v.r * 2) : null;
  return vak || L.latLngBounds(rp.data.sporen.flatMap(s => s.pts.map(p => [p[0], p[1]])));
}
// Inzoomen op de schutter (met het bereik van zijn kanon) en wie hij raakt; daarna weer het hele speelveld
function actieZoom(t) {
  const zs = rp.zs, { d, salvo } = salvoAfstand(t);
  if (d <= 4 && salvo && zs.zoomSalvo !== salvo) {           // al tijdens het afremmen beginnen met inzoomen
    zs.terugBeeld = true;
    zs.zoomSalvo = salvo;
    const g = salvo.g, vak = L.latLng(g.schot.lat, g.schot.lng).toBounds(Piraat.bereik(g.schot) * 2.3);
    g.raak.concat(g.geblokt).forEach(b => { const p = replayPosOp(b, g.schot.ts); if (p) vak.extend([p.lat, p.lng]); });
    vliegZacht(rp.kaart, vak, 1600, 17, 30);
  } else if (d > SALVO_UITZOOM && zs.terugBeeld) {
    vliegZacht(rp.kaart, speelveldVak(), 1800, 18, 20);
    zs.terugBeeld = null; zs.zoomSalvo = null;
  }
}
// ---- '⏱ 30 s' / '⏱ 1 min': de hele replay in precies die tijd (rp.duurS) ----
// Elk stukje replaytijd krijgt echte tijd naar verhouding van hoe traag het normaal (op 60×)
// zou lopen: bij een zeeslag krijgen de salvo's dus relatief meer tijd, bij een race loopt het
// gelijkmatig. Tabel: G[i] = opgetelde 'traagheid' tot replaytijd i × DERTIG_STAP.
const DERTIG_STAP = 0.5;
function dertigTabel() {
  if (rp.warp && rp.warp.eind === rp.eind) return rp.warp;
  const G = [0], n = Math.ceil(rp.eind / DERTIG_STAP);
  const traag = t => 1 / (rp.zs ? Math.max(1, Math.min(60, 1 + SALVO_REM * salvoAfstand(t).d)) : 60);
  for (let i = 1; i <= n; i++) G.push(G[i - 1] + traag((i - .5) * DERTIG_STAP) * DERTIG_STAP);
  return (rp.warp = { eind: rp.eind, G, totaal: G[n] });
}
// replaytijd t → echte seconden vanaf het begin (0…30), en terug
function dertigEcht(t) {
  const w = dertigTabel(), x = Math.min(t, rp.eind) / DERTIG_STAP, i = Math.min(w.G.length - 2, Math.floor(x));
  return (w.G[i] + (w.G[i + 1] - w.G[i]) * (x - i)) / w.totaal * rp.duurS;
}
function dertigTijd(echt) {
  const w = dertigTabel(), doel = Math.max(0, Math.min(1, echt / rp.duurS)) * w.totaal;
  let lo = 0, hi = w.G.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (w.G[m] <= doel) lo = m; else hi = m; }
  const f = w.G[hi] > w.G[lo] ? (doel - w.G[lo]) / (w.G[hi] - w.G[lo]) : 0;
  return Math.min(rp.eind, (lo + f) * DERTIG_STAP);
}
// ---- Race-replay: de camera zoomt in bij elke doelovergang en uit naar de hele baan ----
// Venster rond een overgang: minstens een minuut racetijd, en bij hoge snelheid zo lang dat het
// ongeveer 2,5 s echte tijd in beeld is. Overgangen op dezelfde plek (de hele start) blijven één shot.
function heleBaanVak() {
  const d = rp.data, l = (d.baan && d.baan.lines) || {}, vak = L.latLngBounds([]);
  d.sporen.forEach(s => s.pts.forEach(p => vak.extend([p[0], p[1]])));
  ['start', 'finish'].forEach(t => { if (l[t] && l[t].a) vak.extend([[l[t].a.lat, l[t].a.lng], [l[t].b.lat, l[t].b.lng]]); });
  alsBoeien(d.baan && d.baan.marks).forEach(b => vak.extend([b.lat, b.lng]));
  return vak;
}
function cameraRace(t) {
  const d = rp.data;
  if (!d.doelen || !d.doelen.length) return;
  const v = rp.dertig ? rp.eind / rp.duurS : rp.snelheid, W = Math.max(60, 2.5 * v);
  let doel = null, best = Infinity;
  d.doelen.forEach(x => { const a = Math.abs(t - x.s); if (a < best) { best = a; doel = x; } });
  if (rp.camDoel) {
    // Ingezoomd: kijk ~2,5 s echte tijd vooruit. Zou een boot dan buiten het zoombeeld varen, of is het
    // zoommoment voorbij, dan nu uitzoomen (dat duurt 1,8 s: klaar voordat iemand het scherm uit vaart).
    const vooruit = Math.min(rp.eind, t + 2.5 * v), binnen = rp.camVak.pad(-0.04);
    const eruit = d.sporen.some(s => { const p = positieOp(s.pts, vooruit); return p && !binnen.contains([p.lat, p.lng]); });
    if (eruit || t > rp.camTot) {
      rp.camKlaar = { vak: rp.camDoel.vak, tot: rp.camTot };            // dit moment niet nog een keer inzoomen
      rp.camDoel = null;
      vliegZacht(rp.kaart, heleBaanVak(), 1800, 16, 30);
    }
    return;
  }
  if (best > W) return;
  if (rp.camKlaar && rp.camKlaar.vak.equals(doel.vak) && t <= rp.camKlaar.tot) return;
  rp.camDoel = doel;
  // in één keer het goede beeld: het doel plus álle boten, over het hele zoommoment (zodat
  // niemand uit beeld vaart en er halverwege niet opnieuw gezoomd hoeft te worden)
  const vak = L.latLngBounds(doel.vak.getSouthWest(), doel.vak.getNorthEast());
  const groep = d.doelen.filter(x => x.vak.equals(doel.vak) && Math.abs(x.s - doel.s) <= 3 * W);   // bijv. alle starts
  const van = Math.min(...groep.map(x => x.s)) - W, tot = Math.max(...groep.map(x => x.s)) + W;
  d.sporen.forEach(s => {
    for (let i = 0; i <= 10; i++) { const p = positieOp(s.pts, van + (tot - van) * i / 10); if (p) vak.extend([p.lat, p.lng]); }
  });
  rp.camVak = vak; rp.camTot = tot;
  vliegZacht(rp.kaart, vak, 1500, 16, 40);
}
function speelReplay() {
  if (rp.speelt) { pauzeReplay(); return; }
  if (rp.t >= rp.eind) zetReplayTijd(0);
  rp.speelt = true;
  el('replayPlay').textContent = '⏸ Pauze';
  let vorig = performance.now();
  const echt0 = rp.dertig ? dertigEcht(rp.t) : 0, begin = vorig;     // 30 s-stand: verder vanaf hier
  const stap = nu => {
    if (!rp.speelt) return;
    const snelheid = rp.dertig ? null : replaySnelheidOp(rp.t);
    const t = rp.dertig ? dertigTijd(echt0 + (nu - begin) / 1000)
      : Math.min(rp.eind, rp.t + (nu - vorig) / 1000 * snelheid);
    vorig = nu;
    zetReplayTijd(t);
    const camera = el('replayCamera').checked;
    if (!rp.zs && camera) cameraRace(t);
    if (rp.zs) {
      if (camera) actieZoom(t);
      if (snelheid != null && snelheid < rp.snelheid) el('replayKlok').textContent += ` · ⏱ ${Math.round(snelheid)}×`;
    }
    if (t >= rp.eind) pauzeReplay(); else requestAnimationFrame(stap);
  };
  requestAnimationFrame(stap);
}
function pauzeReplay() {
  if (!rp) return;
  rp.speelt = false;
  el('replayPlay').textContent = '▶ Afspelen';
}
el('replaySlider').addEventListener('input', e => { pauzeReplay(); rp.camKlaar = null; zetReplayTijd(Number(e.target.value)); });
el('replayPlay').addEventListener('click', speelReplay);
// '30s' / '60s' = de hele replay duurt precies 30 seconden of een minuut (zie dertigTijd); anders een vaste snelheid
el('replaySnelheid').addEventListener('change', e => {
  rp.dertig = /s$/.test(e.target.value);
  if (rp.dertig) rp.duurS = parseInt(e.target.value, 10);
  else rp.snelheid = Number(e.target.value);
  if (rp.speelt) { pauzeReplay(); speelReplay(); }               // meteen in de nieuwe stand verder
});
el('replaySluit').addEventListener('click', () => { pauzeReplay(); el('replay').hidden = true; });
// =========================================================
//  Foto, video en GIF van de replay: precies zoals ▶ Afspelen
// =========================================================
// Tijdens de opname krijgt de replaykaart een vaste maat (achter een 'opname'-scherm) en speelt
// de replay met dezelfde snelheid, camera, animaties en schakelaars als Afspelen, maar op een
// eigen klok: elk beeld klopt, ook als het tekenen langer duurt dan een beeld. Per beeld komen
// de titel en de klok boven de kaart, de kaart zelf (tekenLeafletKaart) en de legenda eronder.
const OPNAME_KOP = 80, OPNAME_REGEL = 30;
function opnameMaat(M) {
  const regels = Math.max(el('replayLegenda').children.length, rp.data.sporen.length + (rp.data.zeeslag ? 1 : 0));
  return { W: M, H: OPNAME_KOP + M + regels * OPNAME_REGEL + 20 };
}
async function tekenOpname(c, M) {
  const W = c.canvas.width, H = c.canvas.height;
  c.save();
  c.fillStyle = '#1a120b'; c.fillRect(0, 0, W, H);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.letterSpacing = '0px';
  c.fillStyle = '#f0c75e'; c.font = `${Math.round(OPNAME_KOP * .44)}px "Pirata One", Georgia, serif`;
  c.fillText(rp.data.titel, 20, OPNAME_KOP * .5);
  c.fillStyle = '#bfae88'; c.font = `bold ${Math.round(OPNAME_KOP * .2)}px Cinzel, Georgia, serif`;
  c.fillText(el('replayKlok').textContent, 22, OPNAME_KOP * .86);
  c.fillStyle = '#c9a24a'; c.fillRect(0, OPNAME_KOP - 3, W, 3);
  await tekenLeafletKaart(c, rp.kaart, 0, OPNAME_KOP, M);
  c.fillStyle = '#c9a24a'; c.fillRect(0, OPNAME_KOP + M, W, 3);
  // de legenda, zoals onder de replay (met de bolletjes in de bootkleur)
  c.font = '20px "EB Garamond", Georgia, serif'; c.textBaseline = 'middle';
  [...el('replayLegenda').children].forEach((d, i) => {
    const y = OPNAME_KOP + M + 22 + i * OPNAME_REGEL, dot = d.querySelector('.dot');
    let x = 22;
    if (dot) { c.beginPath(); c.arc(x + 6, y, 6, 0, 2 * Math.PI); c.fillStyle = getComputedStyle(dot).backgroundColor; c.fill(); x += 20; }
    c.fillStyle = '#efe3c6'; c.fillText(d.textContent.replace(/\s+/g, ' ').trim(), x, y);
  });
  c.restore();
}
// Wacht tot de kaarttegels van het huidige beeld binnen zijn (hooguit 3 s)
async function tegelsKlaar(wacht) {
  for (let i = 0; i < 120; i++) {
    if (!rp.kaart.getPane('tilePane').querySelector('img.leaflet-tile:not(.leaflet-tile-loaded)')) return;
    await wacht(25);
  }
}
// De kaart even op maat M zetten (achter het opnamescherm). behoud: hetzelfde stuk kaart in beeld houden.
function opnameStart(M, behoud) {
  const kaartEl = el('replayKaart'), k = rp.kaart, oud = { stijl: kaartEl.getAttribute('style'), c: k.getCenter(), z: k.getZoom(), w: k.getSize().x };
  const scherm = document.createElement('div');
  scherm.className = 'opname-scherm';
  scherm.innerHTML = '<div>⏺ Opname…<br><span></span></div>';
  document.body.appendChild(scherm);
  kaartEl.style.cssText = `position:fixed;left:0;top:0;width:${M}px;height:${M}px;flex:none;z-index:2600`;
  kaartEl.classList.add('opname');
  k.invalidateSize(false);
  if (behoud) k.setView(oud.c, oud.z + Math.log2(M / oud.w), { animate: false });
  return {
    tekst: t => { scherm.querySelector('span').textContent = t; },
    klaar: () => {
      scherm.remove();
      kaartEl.classList.remove('opname');
      if (oud.stijl == null) kaartEl.removeAttribute('style'); else kaartEl.setAttribute('style', oud.stijl);
      k.invalidateSize(false);
      k.setView(oud.c, oud.z, { animate: false });
    }
  };
}
// De replay vanaf het begin afspelen op een eigen klok; per beeld opBeeld(i, laatste, wacht).
// requestAnimationFrame, setTimeout en performance.now volgen tijdens de opname die klok
// (de camera, de vliegende kogels en de ontploffingen lopen daarop); geluid staat uit.
async function speelOp(fps, opBeeld, voortgang) {
  const echt = { raf: window.requestAnimationFrame, nu: performance.now, st: window.setTimeout, ct: window.clearTimeout, speel: window.speel };
  const wacht = ms => new Promise(r => echt.st.call(window, r, ms));
  let klok = echt.nu.call(performance), raf = [], timers = [], volg = 1;
  rp.camDoel = null; rp.camKlaar = null; vluchtId++;
  if (rp.zs) { rp.zs.zoomSalvo = null; rp.zs.terugBeeld = null; rp.zs.vorigMs = null; }
  replayBeginBeeld(); zetReplayTijd(0);
  try {
    window.requestAnimationFrame = cb => { raf.push(cb); return raf.length; };
    performance.now = () => klok;
    window.setTimeout = (cb, ms, ...a) => { const id = volg++; timers.push({ id, t: klok + (+ms || 0), cb: () => { if (typeof cb === 'function') cb(...a); } }); return id; };
    window.clearTimeout = id => { timers = timers.filter(x => x.id !== id); };
    window.speel = () => {};
    speelReplay();
    for (let i = 0; ; i++) {
      klok += 1000 / fps;
      timers.sort((a, b) => a.t - b.t);
      while (timers.length && timers[0].t <= klok) timers.shift().cb();
      const nu = raf; raf = []; nu.forEach(cb => cb(klok));
      await tegelsKlaar(wacht);
      const laatste = !rp.speelt;
      await opBeeld(i, laatste, wacht);
      if (voortgang) voortgang(Math.min(1, rp.t / rp.eind));
      if (laatste) break;
    }
  } finally {
    window.requestAnimationFrame = echt.raf; window.setTimeout = echt.st; window.clearTimeout = echt.ct; window.speel = echt.speel;
    delete performance.now;                                          // terug naar de echte (van het prototype)
    pauzeReplay();
  }
}
// Hoe lang het afspelen (in echte seconden) zou duren met de huidige snelheid
function afspeelDuur() {
  if (rp.dertig) return rp.duurS;
  let s = 0;
  for (let t = 0; t < rp.eind; t += 0.5) s += 0.5 / replaySnelheidOp(t);
  return s;
}
const opnameNaam = ext => `zeilrace-${RACE_ID}-${rp.nr}.${ext}`;

el('replayFoto').addEventListener('click', async () => {
  const k = el('replayFoto'), M = 1200; pauzeReplay(); k.disabled = true; k.textContent = '⏳ Foto…';
  const opname = opnameStart(M, true);
  try {
    await tegelsKlaar(ms => new Promise(r => setTimeout(r, ms)));
    const { W, H } = opnameMaat(M), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    await tekenOpname(cv.getContext('2d'), M);
    downloadBlob(await new Promise(r => cv.toBlob(r, 'image/png')), opnameNaam('png'));
  } catch (e) { meldFout('Foto maken mislukt: ' + e.message); }
  finally { opname.klaar(); k.disabled = false; k.textContent = '🖼 Foto'; }
});
el('replayGif').addEventListener('click', async () => {
  const k = el('replayGif'), M = 560, duur = afspeelDuur();
  if (duur > 75 && !confirm(`Met deze snelheid duurt de GIF ${Math.round(duur)} seconden en wordt hij groot. ` +
    'Kies bij de snelheid ⏱ 30 s of ⏱ 1 min voor een kortere GIF. Toch doorgaan?')) return;
  pauzeReplay(); k.disabled = true;
  const fps = Math.max(4, Math.min(10, Math.round(200 / duur)));      // hooguit ~200 beelden (bestand blijft hanteerbaar)
  const opname = opnameStart(M, false);
  try {
    const { W, H } = opnameMaat(M), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true });
    const vaste = [[26, 18, 11], [240, 199, 94], [239, 227, 198], [191, 174, 136], [201, 162, 74], [139, 30, 18], [0, 0, 0], [255, 255, 255]]
      .concat(Object.values(BOTEN).map(b => hexNaarRgb(b.kleur)), [0, .25, .5, .75, 1].map(f => snelheidKleur(f).match(/\d+/g).map(Number)));
    let gif = null;
    await speelOp(fps, async (i, laatste) => {
      await tekenOpname(c, M);
      const px = c.getImageData(0, 0, W, H).data;
      if (!gif) gif = new GifSchrijver(W, H, px, vaste);
      gif.beeld(px, laatste ? 300 : Math.round(100 / fps));            // eindbeeld 3 s laten staan
    }, f => { const p = Math.round(f * 100) + '%'; k.textContent = '🎞 ' + p; opname.tekst(p); });
    if (gif) downloadBlob(gif.blob(), opnameNaam('gif'));
  } catch (e) { meldFout('GIF maken mislukt: ' + e.message); }
  finally { opname.klaar(); k.disabled = false; k.textContent = '🎞 GIF'; }
});
el('replayVideo').addEventListener('click', async () => {
  const k = el('replayVideo'), mime = videoFormaat(), M = 1080, fps = 25;
  if (!mime) { alert('Deze browser kan geen video opnemen. Probeer Chrome, Edge of Safari.'); return; }
  pauzeReplay(); k.disabled = true;
  const opname = opnameStart(M, false);
  try {
    const { W, H } = opnameMaat(M), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    await tekenOpname(c, M);
    // De recorder staat op pauze terwijl een beeld getekend wordt, en neemt elk beeld daarna precies
    // 1/fps seconde op: zo duurt de video altijd even lang als het afspelen, hoe snel de computer ook is.
    const stroom = cv.captureStream(0), spoor = stroom.getVideoTracks()[0];
    const rec = new MediaRecorder(stroom, { mimeType: mime, videoBitsPerSecond: 8e6 }), stukken = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) stukken.push(e.data); };
    const gestopt = new Promise(r => { rec.onstop = r; });
    rec.start(500); rec.pause();
    await speelOp(fps, async (i, laatste, wacht) => {
      await tekenOpname(c, M);
      rec.resume(); spoor.requestFrame();
      await wacht(laatste ? 1500 : 1000 / fps);                     // eindbeeld 1,5 s laten staan
      rec.pause();
    }, f => { const p = Math.round(f * 100) + '%'; k.textContent = '🎬 ' + p; opname.tekst(p); });
    rec.resume();
    rec.stop(); await gestopt;
    downloadBlob(new Blob(stukken, { type: mime.split(';')[0] }), opnameNaam(mime.includes('mp4') ? 'mp4' : 'webm'));
  } catch (e) { meldFout('Video maken mislukt: ' + e.message); }
  finally { opname.klaar(); k.disabled = false; k.textContent = '🎬 Video'; }
});

// =========================================================
//  Baan tekenen (gepubliceerd, of het concept van de wedstrijdleiding)
// =========================================================
function huidigeBaan() { return concept || { lines: lijnData, marks: boeien }; }

// Lussen van een lusstart: per boot een lijn in de bootkleur door de eigen lus, met de boeien A en B.
// voorbeeld = nog niet gestart: vaag getekend, zodat de wedstrijdleiding kan zien waar de lussen komen.
function tekenLussen(k, marks, lines, lussen, lagen, naam, voorbeeld) {
  if (!lussen) return;
  FLEET.forEach(b => {
    const pad = lusPad(marks, lines, lussen, b);
    if (!pad) return;
    lagen.push(L.polyline(pad.map(p => [p.lat, p.lng]),
      { color: BOTEN[b].kleur, weight: 2, dashArray: '2 6', opacity: voorbeeld ? .45 : .9, interactive: false }).addTo(k));
    pad.filter(p => p.lus).forEach(p => lagen.push(L.marker([p.lat, p.lng], { icon: lusIcoon(p.letter, BOTEN[b].kleur), opacity: voorbeeld ? .55 : 1 })
      .addTo(k).bindTooltip(esc(`${voorbeeld ? 'Voorbeeld · ' : ''}${p.label} · ${naam(b)}`), { direction: 'top', offset: [0, -11] })));
  });
}

function tekenBaan() {
  baanLagen.forEach(l => kaart.removeLayer(l));
  baanLagen.length = 0;
  const { lines, marks } = huidigeBaan();
  const isConcept = !!concept;
  ['start', 'finish'].forEach(t => {
    const ln = lines[t];
    if (!(ln && ln.a && ln.b)) return;
    // bij een gesnapte lijn in het concept ook de windstreek en de lengte (ook zichtbaar op een telefoon)
    const s = isConcept ? snapLijnPunt(ln.a, ln.b) : null;
    const maat = s && afstandMeter(s.punt, ln.b) < 2 ? ` · ${s.streek} ${zmTekst(s.zm)}` : '';
    tekenStartFinish(kaart, ln, t, baanLagen, { weight: isConcept ? 5 : 4, dashArray: isConcept ? '3 7' : '7 7' })
      .bindTooltip((isConcept ? '✎ ' : '') + (t === 'start' ? 'START' : 'FINISH') + maat,
        { permanent: true, direction: 'center', className: 'lijn-label' });
  });
  const lussen = lussenVan(startPlan);
  if (admin) {                                                        // alleen voor de wedstrijdleiding
    tekenRondingslijnen(kaart, marks, lines, baanLagen);
    if (lussen) FLEET.forEach(b =>
      tekenRondingslijnen(kaart, baanVanBoot(marks, lussen, b), lines, baanLagen, BOTEN[b].kleur, x => x.lus));
  }
  tekenLussen(kaart, marks, lines, lussen, baanLagen, naamVan);
  // Wedstrijdleiding in de tab Race: laat zien waar de lussen van start C zouden komen (ze worden bij het startsein vastgelegd)
  if (!lussen && admin && WL_MODUS && wlTab === 'race') {
    const lp = maakLusPlan(lines, marks);
    if (lp) tekenLussen(kaart, marks, lines, lp.lussen, baanLagen, naamVan, true);
  }
  marks.forEach((b, i) => {
    const m = L.marker([b.lat, b.lng], { icon: boeiIcoon(i, isConcept), draggable: isConcept && instelModus !== 'weg' })
      .addTo(kaart).bindTooltip(esc(b.naam || 'Boei ' + (i + 1)), { direction: 'top', offset: [0, -12] });
    if (isConcept) {
      m.on('dragend', e => {
        const ll = e.target.getLatLng();
        concept.marks[i] = Object.assign({}, concept.marks[i], { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) });
        conceptGewijzigd(`Boei ${i + 1} verplaatst (concept).`);
      });
      m.on('click', () => {
        if (instelModus !== 'weg') return;
        concept.marks.splice(i, 1);
        conceptGewijzigd(`Boei ${i + 1} weggehaald (concept). Tik nog een boei, of druk op de knop om te stoppen.`);
      });
    }
    baanLagen.push(m);
  });
  const route = [];
  if (lines.start && lines.start.a) { const m = lijnMidden(lines.start); route.push([m.lat, m.lng]); }
  marks.forEach(b => route.push([b.lat, b.lng]));
  if (lines.finish && lines.finish.a) { const m = lijnMidden(lines.finish); route.push([m.lat, m.lng]); }
  if (route.length >= 2) baanLagen.push(L.polyline(route,
    { color: isConcept ? '#ffe08a' : '#9fb4cd', weight: 2, dashArray: '3 8', opacity: .85, interactive: false }).addTo(kaart));
}

// =========================================================
//  Baanplanning: verwachte tijd per boot + drie startopties
// =========================================================
function renderPlanning() {
  const sectie = el('planningSectie'), box = el('planning');
  const baan = huidigeBaan();
  const nm = baanLengteNm(baan.lines, baan.marks);
  const isWL = WL_MODUS && admin;
  if (nm == null && !isWL && !raceStart && !voorstel) { sectie.hidden = true; return; }
  sectie.hidden = false;
  let h = '';
  if (raceStart) {
    const lussen = lussenVan(startPlan);
    const regels = FLEET.map(b => ({ b, t: raceStart + vertragingVan(startPlan, b) })).sort((x, y) => x.t - y.t)
      .map(x => `${dotHtml(x.b)}${esc(naamVan(x.b))} — ${formatKlok(x.t)}` +
        (lussen && lussen[x.b] ? ` · lus +${formatAfstand(lussen[x.b].extraM)}` : '')).join('<br>');
    h += `<div class="optie"><b>🔒 ${startNaam(startPlan && startPlan.modus)} vastgelegd</b><br>${regels}</div>`;
  } else if (voorstel) {
    const eens = akkoordVan(voorstel, akkoordData), verlopen = voorstel.t <= Date.now();
    h += `<div class="optie"><b>📨 Startvoorstel: ${startNaam(voorstel.plan && voorstel.plan.modus).toLowerCase()} om ` +
      `${formatKlok(voorstel.t)}</b>${verlopen ? ' <span class="waarschuwing">verlopen</span>' : ''}<br>` +
      FLEET.map(b => `${dotHtml(b)}${esc(naamVan(b))}: ${eens.includes(b) ? '✔ akkoord' : '⏳ nog niet'}`).join('<br>') + '</div>';
  }
  if (nm == null) {
    h += '<div class="sub">Zet een startlijn, boeien en een finishlijn om de verwachte tijd per boot te zien.</div>';
  } else {
    const plan = maakPlan(nm, windKn), lus = maakLusPlan(baan.lines, baan.marks);
    const volg = [...FLEET].sort((a, b) => plan.verwacht[a] - plan.verwacht[b]);
    h += `<div class="kop">${concept ? '✎ Concept-baan' : 'Baan'}: ${nm.toFixed(1)} zeemijl · ` +
      `${baan.marks.length} ${baan.marks.length === 1 ? 'boei' : 'boeien'}</div>` +
      `<div class="sub">Verwachte tijden ${windKn != null ? `bij ${bft(windKn)} Bft wind` : 'bij gemiddelde wind'}` +
      ' — schatting op basis van de ORC-rating.</div>' +
      '<div class="tabelscroll"><table><thead><tr><th>Boot</th><th class="tijd">Rating</th><th class="tijd">Verwacht</th>' +
      '<th class="tijd">Achterv.</th><th class="tijd">Lus</th></tr></thead><tbody>' +
      volg.map(b => `<tr><td class="boot-cel">${dotHtml(b)}${esc(naamVan(b))}</td>` +
        `<td class="tijd">${BOTEN[b].rating.toFixed(3)}</td><td class="tijd">${formatDuur(plan.verwacht[b])}</td>` +
        `<td class="tijd">${plan.vertraging[b] ? '+' + formatDuur(plan.vertraging[b]) : 'eerst'}</td>` +
        `<td class="tijd">${lus ? '+' + formatAfstand(lus.extra[b]) : '—'}</td></tr>`).join('') +
      '</tbody></table></div>' +
      '<div class="sub">Achterv. = startvertraging bij start B. Lus = extra afstand bij start C (lusstart).' +
      (lus && !lus.past ? ' <span class="waarschuwing">De lussen passen niet goed op deze baan: maak de raken langer.</span>' : '') + '</div>';
  }
  box.innerHTML = h;
  // Startknoppen staan bij de wedstrijdleiding (tab Race); hier alleen hun toestand bijwerken
  const vast = !!raceStart;
  el('btnSeinGelijk').disabled = !!concept || vast;
  el('btnSeinAchter').disabled = !!concept || vast || nm == null;
  el('btnSeinLus').disabled = !!concept || vast || nm == null;
  el('startTijd').disabled = vast;
  el('btnVoorstelWeg').hidden = vast || !voorstel;
  if (!vast && !startTijdGekozen) el('startTijd').value = klokHM(voorgesteldeStartTijd());
  el('startUitleg').innerHTML = vast ? '🔒 De start ligt vast en verandert niet meer. Een nieuwe start kan pas na ' +
      '<b>Race afronden</b> of <b>Live tijden resetten</b>.'
    : concept ? '<span class="waarschuwing">Bevestig eerst de concept-baan voordat je een start voorstelt.</span>'
    : voorstel ? 'Wacht tot alle boten op hun tracker akkoord hebben gegeven; dan ligt de start vast. Houd deze pagina open: ' +
      'hij legt de start vast. Een nieuw voorstel vervangt het oude, en dan moet iedereen opnieuw akkoord geven.'
    : nm == null ? 'Start A kan altijd. Voor start B (achtervolging) en C (lussen) is een complete baan nodig: startlijn, boeien en finish.'
    : 'Kies een starttijd en stel een start voor. Elke boot moet op de tracker akkoord geven; daarna ligt de start vast. ' +
      'Verwachte tijden, vertragingen en lussen staan in de <b>baanplanning</b>.';
}
el('btnSeinGelijk').onclick = () => stelStartVoor('gelijk');
el('btnSeinAchter').onclick = () => stelStartVoor('achtervolging');
el('btnSeinLus').onclick = () => stelStartVoor('lus');
el('btnVoorstelWeg').onclick = () => {
  if (!admin || raceStart || !voorstel || !confirm('Het startvoorstel intrekken?')) return;
  db.ref(P).update({ voorstel: null, akkoord: null })
    .then(() => toonWlStatus('Startvoorstel ingetrokken.')).catch(e => toonWlStatus('Mislukt: ' + dbFoutTekst(e)));
};

// Voorgestelde starttijd: het eerste 5-minutenmoment minstens 10 minuten vanaf nu,
// zodat de boten de tijd hebben om akkoord te geven
const MIN_VOORSTEL_MS = 2 * 60 * 1000;      // een voorstel ligt minstens 2 minuten in de toekomst
let startTijdGekozen = false;               // zelf een tijd ingevuld? dan niet meer overschrijven
function voorgesteldeStartTijd() {
  const stap = 5 * 60 * 1000;
  return Math.ceil((Date.now() + 2 * stap) / stap) * stap;
}
el('startTijd').addEventListener('input', () => { startTijdGekozen = !!el('startTijd').value; });
function gekozenStartTijd() {
  const [u, m] = (el('startTijd').value || '').split(':').map(Number);
  if (isNaN(u) || isNaN(m)) return null;
  const d = new Date(); d.setHours(u, m, 0, 0);
  return d.getTime();
}

// De wedstrijdleiding stelt een start voor; de boten geven op de tracker akkoord
function stelStartVoor(modus) {
  if (!admin) return;
  if (concept) { toonWlStatus('Bevestig eerst de baan.'); return; }
  if (raceStart) { toonWlStatus('De start ligt al vast. Rond eerst de race af of reset de live tijden.'); return; }
  const nm = baanLengteNm(lijnData, boeien);
  if (modus !== 'gelijk' && nm == null) { toonWlStatus(`Voor een ${startNaam(modus).toLowerCase()} is een complete baan nodig.`); return; }
  const t = gekozenStartTijd();
  if (t == null) { toonWlStatus('Kies eerst een starttijd.'); return; }
  if (t < Date.now() + MIN_VOORSTEL_MS) { toonWlStatus('Die starttijd ligt te dicht bij nu of in het verleden: kies een tijd minstens 2 minuten vooruit.'); return; }
  if (voorstel && !confirm('Er staat al een startvoorstel. Vervangen? Iedereen moet dan opnieuw akkoord geven.')) return;
  const plan = nm != null ? maakPlan(nm, windKn) : null;
  const lus = modus === 'lus' ? maakLusPlan(lijnData, boeien) : null;
  if (modus === 'lus' && !lus) { toonWlStatus('Voor een lusstart is een complete baan nodig.'); return; }
  const vert = modus === 'achtervolging' ? plan.vertraging : {};
  const regels = FLEET.map(b => ({ b, t: t + (vert[b] || 0) })).sort((x, y) => x.t - y.t)
    .map(x => `  ${naamVan(x.b)}: ${formatKlok(x.t)}` + (lus ? ` · lus +${formatAfstand(lus.extra[x.b])}` : '')).join('\n');
  if (!confirm(`${startNaam(modus)} voorstellen?\n\n${regels}\n\n` +
    (lus ? 'Iedereen start tegelijk en vaart een eigen lus van twee extra boeien. Wie het eerst finisht, wint.\n' +
      (lus.past ? '' : '⚠️ De lussen passen niet goed op deze baan (het langste rak is te kort voor de grootste lus).\n') + '\n' : '') +
    'Elke boot moet op de tracker akkoord geven. Pas als iedereen akkoord is, ligt de start vast; daarna verandert hij niet meer.')) return;
  const sp = { modus, gezet: Date.now() };
  if (plan) {
    sp.nm = +plan.nm.toFixed(3);
    sp.verwacht = plan.verwacht;
    if (plan.windKn != null) sp.windKn = Math.round(plan.windKn * 10) / 10;
  }
  if (modus === 'achtervolging') sp.vertraging = vert;
  if (lus) {
    sp.lussen = lus.lussen;
    sp.verwacht = {};
    FLEET.forEach(b => { sp.verwacht[b] = Math.round(BOTEN[b].gph * lus.lengte[b] * plan.factor) * 1000; });
  }
  db.ref(P).update({ voorstel: { id: Date.now(), t, plan: sp }, akkoord: null })
    .then(() => toonWlStatus(`📨 Startvoorstel verstuurd: ${formatKlok(t)}. Wacht op akkoord van alle boten.`))
    .catch(e => toonWlStatus('Mislukt: ' + dbFoutTekst(e)));
}

// Iedereen akkoord? Dan legt het dashboard van de wedstrijdleiding de start vast.
// De databaseregels staan daarna geen andere starttijd meer toe.
let bezigMetVastleggen = false;
function probeerVastleggen() {
  if (!admin || raceStart || bezigMetVastleggen || !iedereenAkkoord(voorstel, akkoordData) || voorstel.t <= Date.now()) return;
  bezigMetVastleggen = true;
  const t = voorstel.t;
  db.ref(P).update({ raceStart: t, startPlan: voorstel.plan, voorstel: null, akkoord: null })
    .then(() => { startTijdGekozen = false; toonWlStatus(`🔒 Iedereen akkoord: de start ligt vast om ${formatKlok(t)}.`); })
    .catch(e => { if (!raceStart) toonWlStatus('Vastleggen mislukt: ' + dbFoutTekst(e)); })
    .finally(() => { bezigMetVastleggen = false; });
}

// =========================================================
//  Grote aftelklok over de kaart
// =========================================================
const vorigeRemPer = {};
function startMomenten() {
  return FLEET.map(b => ({ b, t: raceStart + vertragingVan(startPlan, b) })).sort((x, y) => x.t - y.t);
}
let vorigeSpelRem = null;
function updateAftel() {
  const box = el('aftelGroot');
  // Aftellen naar de zeeslag gaat voor (kanonschoten alleen voor de wedstrijdleiding, zoals bij de race)
  const spelStart = spelData && spelData.start, spelRem = spelStart ? spelStart - Date.now() : null;
  if (WL_MODUS && admin) aftelSchoten(vorigeSpelRem, spelRem);
  vorigeSpelRem = spelRem;
  const spel = spelAftelHtml(spelStart, Date.now(), false);
  if (spel) { box.hidden = false; box.className = 'aftel-groot' + spel.klasse; box.innerHTML = spel.html; return; }
  if (!raceStart) { box.hidden = true; return; }
  const nu = Date.now(), momenten = startMomenten();
  // Kanonschoten voor de wedstrijdleiding bij 5 min, 1 min en elke start
  if (WL_MODUS && admin) {
    [...new Set(momenten.map(m => m.t))].forEach(t => {
      const rem = t - nu, v = vorigeRemPer[t];
      if (v != null) {
        if (v > 300000 && rem <= 300000) speel(GELUID.vijfmin);
        if (v > 60000 && rem <= 60000) speel(GELUID.eenmin);
        if (v > 0 && rem <= 0) speel(GELUID.start);
      }
      vorigeRemPer[t] = rem;
    });
  }
  const achter = startPlan && startPlan.modus === 'achtervolging';
  const volgende = momenten.find(m => m.t > nu);
  box.hidden = false;
  if (volgende) {
    const rem = volgende.t - nu;
    box.className = 'aftel-groot' + (rem <= 60000 ? ' urgent' : '') + (rem <= 10000 ? ' laatste10' : '');
    const wie = momenten.filter(m => m.t === volgende.t).map(m => naamVan(m.b)).join(' + ');
    const lijst = achter ? '<div class="volgorde">' + momenten.map(m =>
      `${m.t <= nu ? '✓ ' : ''}${esc(naamVan(m.b))} ${formatKlok(m.t)}`).join(' · ') + '</div>' : '';
    box.innerHTML = `<div class="lbl">${achter ? 'START ' + esc(wie.toUpperCase()) + ' OVER' : 'START OVER'}</div>` +
      `<div class="cijfers">${formatDuur(rem)}</div><div class="lbl">om ${formatKlok(volgende.t)}</div>${lijst}`;
  } else {
    box.className = 'aftel-groot gestart';
    box.innerHTML = `<div class="lbl">GESTART ${klokHM(momenten[0].t)}</div>` +
      `<div class="cijfers">${formatDuur(nu - momenten[0].t)}</div>`;
  }
}

// =========================================================
//  Alarm voor de wedstrijdleiding: boot zonder GPS tijdens de race
// =========================================================
const alarmActief = {};
function controleerOffline() {
  const box = el('alarmen');
  if (!(WL_MODUS && admin)) { box.innerHTML = ''; return; }
  const nu = Date.now();
  let h = '';
  FLEET.forEach(b => {
    const t = timesData[b] || {}, ts = laatsteTs[b];
    const weg = t.start != null && t.finish == null && ts && nu - ts > 30000;
    if (weg) {
      h += `<div class="alarm">⚠️ ${esc(naamVan(b))}: geen GPS sinds ${formatKlok(ts)}</div>`;
      if (!alarmActief[b]) { alarmActief[b] = true; speel(GELUID.alarm); }
    } else alarmActief[b] = false;
  });
  box.innerHTML = h;
}

// =========================================================
//  Wedstrijdleiding: inloggen en baan aanpassen (met bevestiging)
// =========================================================
const wlStatusEl = el('wlStatus');
function toonWlStatus(bericht) {
  if (bericht) { wlStatusEl.textContent = bericht; return; }
  wlStatusEl.textContent = raceStart ? (raceStart > Date.now() ? '🔒 Start vastgelegd om ' : '🔫 Gestart om ') + formatKlok(raceStart)
    : voorstel ? `📨 Startvoorstel voor ${formatKlok(voorstel.t)}: ${akkoordVan(voorstel, akkoordData).length} van ${FLEET.length} boten akkoord.`
    : 'Nog geen start voorgesteld.';
}

auth.onAuthStateChanged(async user => {
  admin = await isAdmin(user);
  el('wlLogin').hidden = !(WL_MODUS && !admin);
  el('wedstrijdleiding').hidden = !(WL_MODUS && admin);
  if (WL_MODUS && user && !user.isAnonymous && !admin)
    el('loginStatus').textContent = `Ingelogd als ${user.email}, maar dit account staat niet in /admins (zie README).`;
  tekenBaan(); renderPlanning(); toonWlStatus(); renderCorrectie();
  if (tabActief('tabUitslagen')) renderUitslagen();
});

el('loginForm').addEventListener('submit', e => {
  e.preventDefault();
  el('loginStatus').textContent = 'Inloggen…';
  auth.signInWithEmailAndPassword(el('loginEmail').value.trim(), el('loginWw').value)
    .then(() => { el('loginWw').value = ''; el('loginStatus').textContent = ''; })
    .catch(err => { el('loginStatus').textContent = authFoutTekst(err); });
});
el('btnUitloggen').onclick = () => auth.signOut().then(() => location.reload());

// --- Wedstrijdleiding: tabjes Baan · Race · Spel · Overig (keuze wordt onthouden) ---
let wlTab = null;
function toonWlTab(naam) {
  wlTab = naam;
  document.querySelectorAll('.wl-tab').forEach(t => {
    const aan = t.dataset.wl === naam;
    t.classList.toggle('actief', aan); t.setAttribute('aria-selected', String(aan));
  });
  document.querySelectorAll('.wl-paneel').forEach(p => { p.hidden = p.dataset.wl !== naam; });
  try { localStorage.setItem('zeilrace-wl-tab', naam); } catch (e) {}
  tekenBaan();                                     // de tab Race toont een voorbeeld van de lussen
}
document.querySelectorAll('.wl-tab').forEach(t => t.addEventListener('click', () => toonWlTab(t.dataset.wl)));
{
  let tab = 'baan';
  try { tab = localStorage.getItem('zeilrace-wl-tab') || 'baan'; } catch (e) {}
  toonWlTab(document.querySelector(`.wl-tab[data-wl="${tab}"]`) ? tab : 'baan');
}

// --- Concept-baan ---
function beginConcept() {
  if (concept) return;
  concept = {
    lines: JSON.parse(JSON.stringify(lijnData || {})),
    marks: boeien.map((b, i) => Object.assign({}, b, { id: boeiId(b, i) }))
  };
}
function wisTijdelijk() {
  tijdMarkers.forEach(m => kaart.removeLayer(m)); tijdMarkers = []; tijdPunten = [];
  if (snapVoorbeeld) { kaart.removeLayer(snapVoorbeeld); snapVoorbeeld = null; }
}
function zetModus(modus, tekst) {
  instelModus = modus; wisTijdelijk();
  ['btnStart:start', 'btnFinish:finish', 'btnBoei:boei', 'btnBoeiWeg:weg'].forEach(p => {
    const [id, m] = p.split(':'); el(id).classList.toggle('actief', instelModus === m);
  });
  tekenBaan();
  if (tekst) toonWlStatus(tekst);
}
function conceptGewijzigd(tekst) {
  tekenBaan(); renderConceptBalk(); renderPlanning();
  if (tekst) toonWlStatus(tekst);
}
function verschillenTekst() {
  if (!concept) return '';
  const r = [], zelfde = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
  if (!zelfde(concept.lines.start, lijnData.start)) r.push('startlijn aangepast');
  if (!zelfde(concept.lines.finish, lijnData.finish)) r.push('finishlijn aangepast');
  const oud = new Map(boeien.map((b, i) => [boeiId(b, i), b]));
  const nieuw = new Map(concept.marks.map((b, i) => [boeiId(b, i), b]));
  const erbij = [...nieuw.keys()].filter(k => !oud.has(k)).length;
  const eraf = [...oud.keys()].filter(k => !nieuw.has(k)).length;
  const verschoven = [...nieuw.keys()].filter(k => oud.has(k) &&
    (oud.get(k).lat !== nieuw.get(k).lat || oud.get(k).lng !== nieuw.get(k).lng)).length;
  const volgorde = [...nieuw.keys()].filter(k => oud.has(k)).join() !== [...oud.keys()].filter(k => nieuw.has(k)).join();
  if (erbij) r.push(`${erbij} boei${erbij > 1 ? 'en' : ''} toegevoegd`);
  if (eraf) r.push(`${eraf} boei${eraf > 1 ? 'en' : ''} weggehaald`);
  if (verschoven) r.push(`${verschoven} boei${verschoven > 1 ? 'en' : ''} verplaatst`);
  if (volgorde) r.push('volgorde gewijzigd');
  return r.length ? r.join(', ') : 'nog geen wijzigingen';
}
function renderConceptBalk() {
  const balk = el('conceptBalk');
  if (!concept) { balk.hidden = true; return; }
  balk.hidden = false;
  const lopend = raceStart && raceStart <= Date.now();
  el('conceptTekst').innerHTML = `<b>✎ Baan gewijzigd — nog niet bevestigd</b><br>${esc(verschillenTekst())}` +
    (lopend ? '<br><span class="waarschuwing">⚠️ De race loopt: na bevestigen varen de boten direct de nieuwe baan.</span>' : '');
}
async function bevestigBaan() {
  if (!concept || !admin) return;
  const lopend = raceStart && raceStart <= Date.now();
  if (!confirm((lopend ? '⚠️ DE RACE LOOPT.\nDe boten krijgen de nieuwe baan direct op hun scherm.\n\n' : '') +
    'Wijzigingen: ' + verschillenTekst() + '\n\nBaan bevestigen?')) return;
  const lines = {};
  ['start', 'finish'].forEach(t => { if (concept.lines[t] && concept.lines[t].a) lines[t] = concept.lines[t]; });
  const marks = concept.marks.map(b => ({ id: b.id, lat: b.lat, lng: b.lng }));
  try {
    await db.ref(P).update({ lines: Object.keys(lines).length ? lines : null, marks: marks.length ? marks : null });
    concept = null; zetModus(null);
    conceptGewijzigd('Baan bevestigd ✓ — de boten zien de nieuwe baan.');
  } catch (e) { toonWlStatus('Opslaan mislukt: ' + dbFoutTekst(e)); }
}
function annuleerConcept() {
  concept = null; zetModus(null);
  conceptGewijzigd('Wijzigingen geannuleerd.');
}

const lijnUitleg = ': het eerste punt is vrij, het tweede snapt naar een windstreek (N, NO, O, …) en een lengte van 0,5, 1, 1,5 … zm.';
el('btnStart').onclick = () => { beginConcept(); zetModus('start', 'Tik 2 punten voor de startlijn op de kaart' + lijnUitleg); renderConceptBalk(); };
el('btnFinish').onclick = () => { beginConcept(); zetModus('finish', 'Tik 2 punten voor de finishlijn op de kaart' + lijnUitleg); renderConceptBalk(); };
el('btnBoei').onclick = () => {
  if (instelModus === 'boei') { zetModus(null, 'Klaar met boeien plaatsen.'); return; }
  beginConcept(); zetModus('boei', 'Tik boeien op de kaart in de te varen volgorde. Versleep een boei om hem te verplaatsen.');
  renderConceptBalk();
};
el('btnBoeiWeg').onclick = () => {
  if (instelModus === 'weg') { zetModus(null, 'Klaar met boeien weghalen.'); return; }
  beginConcept(); zetModus('weg', 'Tik op een boei om hem weg te halen.'); renderConceptBalk();
};
el('btnBoeienWis').onclick = () => {
  beginConcept(); concept.marks = []; zetModus(null);
  conceptGewijzigd('Alle boeien weggehaald (concept).');
};
// Start- en finishlijn weghalen (bijv. voor een zeeslag): ook via het concept, dus pas weg na bevestigen
el('btnLijnenWis').onclick = () => {
  beginConcept(); concept.lines = {}; zetModus(null);
  conceptGewijzigd('Start- en finishlijn weggehaald (concept). Vergeet niet te bevestigen.');
};
el('btnBevestig').onclick = bevestigBaan;
el('btnAnnuleer').onclick = annuleerConcept;

kaart.on('click', e => {
  if (!admin || !concept || !instelModus || meetlat.actief()) return;
  let p = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) };
  if (instelModus === 'boei') {
    concept.marks.push(Object.assign({ id: nieuwId() }, p));
    conceptGewijzigd(`Boei ${concept.marks.length} geplaatst (concept). Tik nog een boei, of druk op de knop om te stoppen.`);
  } else if (instelModus === 'start' || instelModus === 'finish') {
    // het eerste punt is vrij, het tweede snapt naar een windstreek en een hele of halve zeemijl
    const snap = tijdPunten.length === 1 ? snapLijnPunt(tijdPunten[0], p) : null;
    if (snap) p = snap.punt;
    tijdPunten.push(p);
    tijdMarkers.push(L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#ffe08a', fillOpacity: 1 }).addTo(kaart));
    if (!snap) toonWlStatus('Eerste punt gezet. Tik het tweede punt: de lijn snapt naar N, NO, O, … en een lengte van 0,5, 1, 1,5 … zm.');
    if (tijdPunten.length === 2) {
      const t = instelModus;
      concept.lines[t] = { a: tijdPunten[0], b: tijdPunten[1] };
      // Een nieuwe start- of finishlijn = een nieuwe baan: de boeien gaan eruit
      const weg = concept.marks.length;
      concept.marks = [];
      zetModus(null);
      conceptGewijzigd(`${t === 'start' ? 'Startlijn' : 'Finishlijn'} aangepast: ${snap.streek}, ${zmTekst(snap.zm)} (concept)` +
        (weg ? ` en ${weg === 1 ? 'de boei is' : 'alle ' + weg + ' boeien zijn'} weggehaald — zet ze opnieuw uit.` : '.') +
        ' Vergeet niet te bevestigen.');
    }
  }
});
// Voorbeeld van de gesnapte lijn onder de muis, na het eerste punt
var snapVoorbeeld = null;          // var: wisTijdelijk (hierboven) ruimt hem op
kaart.on('mousemove', e => {
  if (!(instelModus === 'start' || instelModus === 'finish') || tijdPunten.length !== 1) {
    if (snapVoorbeeld) { kaart.removeLayer(snapVoorbeeld); snapVoorbeeld = null; }
    return;
  }
  const a = tijdPunten[0], s = snapLijnPunt(a, e.latlng), lijn = [[a.lat, a.lng], [s.punt.lat, s.punt.lng]];
  if (!snapVoorbeeld) snapVoorbeeld = L.polyline(lijn, { color: LIJN_KLEUR[instelModus], weight: 3, dashArray: '4 6', opacity: .8, interactive: false })
    .bindTooltip('', { permanent: true, direction: 'top', className: 'lijn-label' }).addTo(kaart);
  snapVoorbeeld.setLatLngs(lijn).setTooltipContent(`${s.streek} · ${zmTekst(s.zm)}`);
});

// =========================================================
//  Scheepsjournaal: elk uur een notitie van de verteller
// =========================================================
let testNotities = [];     // via de testknop (alleen lokaal, verdwijnen bij herladen)
function journaalData(nu) {
  return { raceStart, startPlan, times: timesData, rounded: rondingData, boeien, lijnen: lijnData,
    sporen: spoorPunten, naam: naamVan, nu, wind: windKn != null ? { kn: windKn, richting: windRichting } : null };
}
function renderJournaal() {
  const nu = Date.now();
  if (!journaalVuil && nu - journaalGemaakt < 5000) return;
  journaalVuil = false; journaalGemaakt = nu;
  const sectie = el('journaalSectie');
  el('btnJournaalNu').hidden = !WL_MODUS;
  const loopt = raceStart && raceStart <= nu;
  if (!loopt && !WL_MODUS) { sectie.hidden = true; journaalHtml = ''; return; }
  const d = journaalData(nu);
  const notities = testNotities.concat(Verteller.journaal(d)).sort((a, b) => b.t - a.t);   // nieuwste bovenaan
  const volgende = Verteller.volgende(d);
  const allesBinnen = FLEET.every(b => timesData[b] && timesData[b].finish != null);
  let html = notities.map((n, i) =>
    `<div class="journaal-item${i === 0 ? ' nieuw' : ''}"><div class="journaal-kop">${esc(n.kop)}</div>` +
    `<div class="journaal-tekst">${esc(n.tekst)}</div></div>`).join('');
  if (!loopt && !notities.length) html = '<div class="journaal-volgende">Het journaal begint zodra de race is gestart.</div>';
  if (loopt && !allesBinnen && volgende)
    html += `<div class="journaal-volgende">${notities.length ? 'Volgende notitie' : 'De eerste notitie in het journaal volgt'} om ${klokHM(volgende)}.</div>`;
  sectie.hidden = false;
  if (html !== journaalHtml) { el('journaal').innerHTML = html; journaalHtml = html; }
}
el('btnJournaalNu').addEventListener('click', () => {
  testNotities.push(Verteller.notitieNu(journaalData(Date.now())));
  journaalVuil = true; renderJournaal();
  el('journaal').scrollTop = 0;
});

// =========================================================
//  Het piratenspel: meekijken, speelveld en start/stop (regels: piraat.js)
// =========================================================
var spelData = null;      // var: de aftelklok (hierboven) leest hem
let spelStand = null, spelVeldLaag = null, spelVeldSleutel = '', bekendeSchoten = null, spelScoreCache = '';
const scheepsKoers = {}, koersPunt = {}, richtLagen = {}, labelCache = {};
let kistLaag = null, kistSleutel = '', mijnLaag = null, mijnSleutel = '', bekendeKnallen = null;
// Spookschip: de wedstrijdleiding ziet het doorzichtig, de rest (ook tegenstanders die hier meekijken) niet
function spookStaat(b) {
  if (!(spelStand && spelStand.bezig && Piraat.spook(spelStand.boten[b], Date.now()))) return null;
  return WL_MODUS && admin ? 'half' : 'weg';
}
let veldModus = false, veldMidden = null, veldMarker = null;

const isWrak = b => !!(spelStand && spelStand.start && spelStand.deelnemers.includes(b) && spelStand.boten[b].levens <= 0);
function schipLabel(b) {
  const inSpel = spelStand && spelStand.start && spelStand.deelnemers.includes(b);
  const herlaad = inSpel && spelStand.bezig ? Piraat.herlaadTekst(spelStand.boten[b], Date.now()) : '';
  return esc(naamVan(b)) + (inSpel ? ' ' + Piraat.levensTekst(spelStand.boten[b]) : '') + (herlaad ? ' ' + herlaad : '');
}
function spelPosTijden() { const t = {}; FLEET.forEach(b => { if (laatsteTs[b]) t[b] = laatsteTs[b]; }); return t; }
const schipPos = b => posData[b] ? { lat: posData[b].lat, lng: posData[b].lng } : null;
// Schootslijnen: zichtbaar zolang het speelveld er staat. Tijdens de zeeslag alleen voor
// schepen die meedoen, nog drijven en niet onzichtbaar zijn (spookschip).
function tekenRichtlijnen(b) {
  const st = spelStand;
  const actief = st && st.veld && st.veld.r && (!st.bezig || (st.deelnemers.includes(b) && st.boten[b].levens > 0 && spookStaat(b) !== 'weg'));
  if (actief) richtLagen[b] = Piraat.richtlijnen(kaart, schipPos(b), scheepsKoers[b], richtLagen[b], false, st.boten[b].lading);
  else if (richtLagen[b]) { kaart.removeLayer(richtLagen[b]); richtLagen[b] = null; }
}
function renderSpel() {
  const st = spelStand = Piraat.stand(spelData, spelPosTijden());
  // Het speelveld is voor iedereen te zien zolang het er staat (de wedstrijdleiding kan het weghalen)
  const toonVeld = !!(st.veld && st.veld.r);
  const sleutel = toonVeld ? JSON.stringify(st.veld) : '';
  if (sleutel !== spelVeldSleutel) { spelVeldLaag = Piraat.veldLaag(kaart, toonVeld ? st.veld : null, spelVeldLaag); spelVeldSleutel = sleutel; }
  // het speelveld krimpt na een tijdje (vóór het begin: de volle maat)
  if (spelVeldLaag && st.veld) spelVeldLaag.setRadius(Piraat.straal(st.veld, st.start, Math.min(Date.now(), st.over || Infinity)));
  const kisten = st.bezig ? Piraat.kisten(spelData, Date.now()) : [], kSleutel = kisten.map(k => k.nr).join(',');
  if (kSleutel !== kistSleutel) { kistLaag = Piraat.kistLagen(kaart, kisten, kistLaag); kistSleutel = kSleutel; }
  // zeemijnen: alleen de wedstrijdleiding ziet ze liggen
  const mijnen = st.bezig && WL_MODUS && admin ? st.mijnen.filter(m => m.actief) : [], mSleutel = mijnen.map(m => m.id).join(',');
  if (mSleutel !== mijnSleutel) { mijnLaag = Piraat.mijnLagen(kaart, mijnen, mijnLaag); mijnSleutel = mSleutel; }
  FLEET.forEach(b => {
    if (markers[b]) { const l = schipLabel(b); if (labelCache[b] !== l) { markers[b].setTooltipContent(l); labelCache[b] = l; } }
    tekenRichtlijnen(b);
  });
  // een afgelopen zeeslag vanzelf bewaren (alleen een ingelogde wedstrijdleider kan dat), 35 s na het
  // einde: de trackers sturen tot een halve minuut na het laatste salvo nog hun spoor
  if (admin && st.start && st.over && !st.wacht && Date.now() - st.over > 35000) archiveerZeeslag();
  el('spelSectie').hidden = !st.start;
  if (!st.start) return;
  el('spelStatusDash').textContent = Piraat.statusTekst(st, naamVan);
  const html = Piraat.scoreHtml(st, naamVan);
  if (html !== spelScoreCache) { el('spelStandDash').innerHTML = html; spelScoreCache = html; }
}
el('spelBuit').innerHTML = el('regelBuit').innerHTML = Piraat.buitHtml();   // wat er in de schatkisten kan zitten (vast)
function koppelSpel() {
  luister(`${P}/spel`, 'value', s => {
    spelData = s.val();
    const st = Piraat.stand(spelData, spelPosTijden());
    const ids = new Set(st.geldig.map(g => g.id));
    if (bekendeSchoten) st.geldig.forEach(g => {         // nieuwe salvo's laten vliegen
      if (bekendeSchoten.has(g.id) || Date.now() - g.schot.ts > 20000) return;
      Piraat.animeer(kaart, g.schot, g.raak, schipPos, g.geblokt);
      kanonschot();
    });
    bekendeSchoten = ids;
    const knallen = st.mijnen.filter(m => m.knal);       // ontplofte zeemijnen
    if (bekendeKnallen) knallen.forEach(m => {
      if (bekendeKnallen.has(m.id) || Date.now() - m.knal > 20000) return;
      Piraat.ontploffing(kaart, m, m.geblokt ? '🛡️' : '💥');
      kanonschot(true);
    });
    bekendeKnallen = new Set(knallen.map(m => m.id));
    renderSpel(); verversLijst();
  });
}

// Wedstrijdleiding: speelveld tekenen (midden + rand), zeeslag starten en stoppen
el('btnVeld').onclick = () => {
  veldModus = !veldModus; veldMidden = null;
  if (veldMarker) { kaart.removeLayer(veldMarker); veldMarker = null; }
  el('btnVeld').classList.toggle('actief', veldModus);
  toonWlStatus(veldModus ? `Tik op de kaart het MIDDEN van het speelveld (standaard een straal van ${SPEL.veldStandaardM} m)…` : 'Speelveld tekenen gestopt.');
};
kaart.on('click', e => {
  if (!admin || !veldModus || meetlat.actief()) return;
  const p = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) };
  let r, midden;
  if (!veldMidden) {
    // Standaard: een cirkel van SPEL.veldStandaardM rond het midden. Annuleren = zelf de rand tikken.
    if (confirm(`Speelveld met de standaardstraal van ${formatAfstand(SPEL.veldStandaardM)} (${SPEL.veldStandaardM} m) rond dit punt?\n\n` +
        'Kies Annuleren om zelf de rand te tikken.')) {
      midden = p; r = SPEL.veldStandaardM;
    } else {
      veldMidden = p;
      veldMarker = L.circleMarker(e.latlng, { radius: 6, color: '#fff', weight: 2, fillColor: '#8b1e12', fillOpacity: 1 }).addTo(kaart);
      toonWlStatus('Tik nu de RAND van het speelveld…');
      return;
    }
  } else { r = Math.round(afstandMeter(veldMidden, p)); midden = veldMidden; }
  veldModus = false; veldMidden = null; el('btnVeld').classList.remove('actief');
  if (veldMarker) { kaart.removeLayer(veldMarker); veldMarker = null; }
  if (r < 50) { toonWlStatus('Dat speelveld is te klein — probeer het opnieuw.'); return; }
  if (r !== SPEL.veldStandaardM && !confirm(`Speelveld opslaan: een cirkel met een straal van ${formatAfstand(r)}?`)) {
    toonWlStatus('Speelveld niet opgeslagen.'); return;
  }
  db.ref(`${P}/spel/veld`).set({ lat: midden.lat, lng: midden.lng, r })
    .then(() => toonWlStatus(`Speelveld opgeslagen (straal ${formatAfstand(r)}).`))
    .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
});
// ---- Een afgelopen zeeslag opslaan (voor de replay en het journaal bij Uitslagen) ----
// Gebeurt vanzelf op het dashboard van een ingelogde wedstrijdleider zodra de zeeslag voorbij is,
// en in elk geval vóór een nieuwe zeeslag of het wissen van de uitslag. Sleutel = het begin.
// spel = de gegevens om op te slaan (standaard de huidige); een zeeslag die nog bezig is, telt tot nu.
var zeeslagenData = {};   // var: de tab Uitslagen (hierboven) leest hem al
let zeeslagenGeladen = false, zeeslagOpslaan = null;
async function archiveerZeeslag(spel = spelData) {
  if (!admin || !zeeslagenGeladen || !spel || !spel.start || zeeslagenData[spel.start] || zeeslagOpslaan === spel.start) return;
  const st = Piraat.stand(spel, spelPosTijden());
  if (st.wacht || (!st.over && !st.log.length)) return;           // nog niet begonnen, of er gebeurde niets
  if (!st.deelnemers.length) return;                              // niemand deed mee: niets om te bewaren
  const over = st.over || Date.now();
  zeeslagOpslaan = spel.start;
  try {
    // de sporen van het aftellen tot het einde (met een halve minuut marge)
    const van = spel.start - 30000, tot = over + 30000;
    const tr = (await db.ref(`${P}/tracks`).get()).val() || {}, sporen = {};
    Object.keys(tr).forEach(b => {
      const pts = Object.values(tr[b] || {}).filter(p => p && p.lat != null && p.ts >= van && p.ts <= tot).sort((x, y) => x.ts - y.ts)
        .map(p => [+p.lat.toFixed(5), +p.lng.toFixed(5), Math.round((p.ts - van) / 1000)]);
      if (pts.length > 1) sporen[b] = dunUit(pts, 1500);
    });
    const namen = {};
    FLEET.forEach(b => { namen[b] = naamVan(b); });
    const deelnemers = st.deelnemers.length ? st.deelnemers : Object.keys(sporen);
    const posTs = Object.fromEntries(deelnemers.map(b => [b, spel.start]));
    const opslag = JSON.parse(JSON.stringify({ start: spel.start, eind: spel.eind || null, veld: spel.veld || null,
      schoten: spel.schoten || null, straf: spel.straf || null, buit: spel.buit || null, mijnen: spel.mijnen || null, mijnraak: spel.mijnraak || null }));
    const z = { start: spel.start, ts: Date.now(), over, t0: van, namen, deelnemers, spel: opslag,
      stand: st.volgorde.map(b => ({ boot: b.boot, levens: b.levens, hits: b.hits, salvos: SPEL.schoten - b.gebruikt, kisten: b.kisten })),
      winnaar: st.winnaar && !st.gelijk ? st.winnaar.boot : null,
      journaal: Piraat.journaal(Object.assign({}, opslag, { eind: spel.eind || over }), naamVan, posTs).map(n => ({ t: n.t, kop: n.kop, tekst: n.tekst })) };
    if (Object.keys(sporen).length) z.sporen = sporen;
    await db.ref(`${P}/zeeslagen/${spel.start}`).set(z);
    zeeslagenData[spel.start] = z;
    // Geen race bezig? Dan waren de sporen alleen voor de zeeslag: weer opruimen
    if (!raceStart) await db.ref(P).update({ tracks: null, gen: Date.now() });
    toonWlStatus('🏴‍☠️ Zeeslag opgeslagen ✓ — de replay en het scheepsjournaal staan bij Uitslagen.');
  } catch (e) {
    toonWlStatus('Zeeslag opslaan mislukt: ' + dbFoutTekst(e));
  } finally { zeeslagOpslaan = null; }
}
el('btnVeldWeg').onclick = () => {
  if (!admin || !(spelData && spelData.veld)) { toonWlStatus('Er staat geen speelveld.'); return; }
  if (spelStand && (spelStand.wacht || spelStand.bezig)) { toonWlStatus('Stop eerst de zeeslag.'); return; }
  if (!confirm('Het speelveld (de rode cirkel) weghalen? Dan verdwijnen ook de schootslijnen.')) return;
  db.ref(`${P}/spel/veld`).remove().then(() => toonWlStatus('Speelveld weggehaald.'))
    .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
};
el('btnSpelStart').onclick = async () => {
  if (!admin) return;
  const geenVeld = !(spelData && spelData.veld) ? '\n\nLet op: er is nog geen speelveld getekend (dan zijn er ook geen schatkisten).' : '';
  const min = SPEL.aftelMs / 60000;
  if (!confirm(`Nieuwe zeeslag starten? Er wordt ${min} minuten afgeteld (met kanonschoten), daarna krijgen alle schepen ` +
    `weer 3 levens en 10 salvo's.` + geenVeld)) return;
  // de vorige zeeslag eerst bewaren (loopt hij nog, dan telt hij tot nu)
  if (spelData && spelData.start && !(spelStand && spelStand.wacht))
    await archiveerZeeslag(Object.assign({}, spelData, { eind: spelData.eind || Date.now() }));
  const start = Date.now() + SPEL.aftelMs;
  db.ref(`${P}/spel`).update({ start, eind: null, schoten: null, straf: null, buit: null, mijnen: null, mijnraak: null })
    .then(() => toonWlStatus(`🏴‍☠️ Het aftellen is begonnen: de zeeslag begint om ${formatKlok(start)}.`))
    .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
};
el('btnSpelStop').onclick = async () => {
  if (!admin || !spelData || !spelData.start) return;
  if (spelStand && spelStand.wacht) {
    if (!confirm('Het aftellen naar de zeeslag stoppen?')) return;
    db.ref(`${P}/spel/start`).remove().catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
  } else if (spelStand && spelStand.bezig) {
    if (!confirm('De zeeslag nu beëindigen? De huidige stand is de eindstand.')) return;
    db.ref(`${P}/spel/eind`).set(Date.now()).catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
  } else {
    if (!confirm('De uitslag van de zeeslag van het scherm halen? (Het speelveld blijft staan; de zeeslag zelf blijft bewaard bij Uitslagen.)')) return;
    await archiveerZeeslag();
    db.ref(`${P}/spel`).update({ start: null, eind: null, schoten: null, straf: null, buit: null, mijnen: null, mijnraak: null })
      .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
  }
};

// --- Handmatige correctie van boeirondingen ---
// Voor als een telefoon een ronding mist (GPS weg, toestel uit). Werkt op de
// gepubliceerde baan; de tracker neemt de wijziging direct over.
function renderCorrectie() {
  const houder = el('correctie');
  if (!admin) { houder.innerHTML = ''; return; }
  if (!FLEET.some(b => baanVan(b).length)) { houder.innerHTML = '<div class="uitleg">Er liggen geen boeien in de baan.</div>'; return; }
  houder.innerHTML = FLEET.map(b => {
    const gerond = rondingData[b] || {}, t = timesData[b] || {};
    const knoppen = baanVan(b).map(boei => {
      const ts = gerond[boei.id];
      return `<button type="button" class="corr-boei${ts != null ? ' gerond' : ''}" data-boot="${b}" data-id="${esc(boei.id)}" ` +
        `data-label="${esc(boei.label)}"${t.finish != null ? ' disabled title="Al gefinisht"' : ''}>` +
        (ts != null ? `✓ ${esc(boei.label)}<br><small>${klokHM(ts)}</small>` : esc(boei.label)) + '</button>';
    }).join('');
    return `<div class="corr-rij"><div class="corr-naam">${dotHtml(b)}${esc(naamVan(b))}` +
      `${t.start == null ? ' <small>(nog niet gestart)</small>' : ''}</div><div class="corr-boeien">${knoppen}</div></div>`;
  }).join('');
}
el('correctie').addEventListener('click', e => {
  const k = e.target.closest('.corr-boei');
  if (!k || k.disabled || !admin) return;
  const { boot, id, label } = k.dataset;
  const ref = db.ref(`${P}/rounded/${boot}/${id}`);
  const al = rondingData[boot] && rondingData[boot][id] != null;
  if (al) {
    if (!confirm(`Ronding van ${label} voor ${naamVan(boot)} terugdraaien?\nDe telefoon moet de boei dan opnieuw ronden.`)) return;
    ref.remove().then(() => toonWlStatus(`${label} voor ${naamVan(boot)} teruggezet naar niet gerond.`))
      .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
  } else {
    if (!confirm(`${label} voor ${naamVan(boot)} handmatig als GEROND markeren (tijd: nu)?`)) return;
    ref.set(Date.now()).then(() => toonWlStatus(`${label} voor ${naamVan(boot)} handmatig als gerond gemarkeerd.`))
      .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
  }
});

// --- Race afronden, resetten, boten vrijgeven ---
function wisLiveRace() {
  return db.ref(P).update({ times: null, rounded: null, raceStart: null, startPlan: null, voorstel: null, akkoord: null,
    tracks: null, gen: Date.now() });
}
async function rondRaceAf() {
  if (!admin) return;
  if (concept) { toonWlStatus('Bevestig of annuleer eerst de baanwijziging.'); return; }
  const rijen = berekenUitslag(timesData), fin = rijen.filter(r => r.gefinisht).length;
  if (!confirm(fin ? `Race afronden met ${fin} finisher(s)? De uitslag en de gevaren lijnen (voor de replay) worden ` +
      'opgeslagen en de live tijden gereset.' : 'Nog geen enkele boot gefinisht. Toch een lege race opslaan?')) return;
  el('btnArchief').disabled = true;
  toonWlStatus('Race opslaan…');
  try {
    // Eerst de sporen ophalen, dan pas de live data wissen.
    // Per punt: [lat, lng, seconden sinds t0] — nodig voor de replay.
    const tr = (await db.ref(`${P}/tracks`).get()).val() || {};
    let t0 = Infinity;
    Object.values(tr).forEach(bt => Object.values(bt || {}).forEach(p => { if (p && p.ts < t0) t0 = p.ts; }));
    if (!isFinite(t0)) t0 = Date.now();
    const sporenOpslag = {}, afgelegd = {};
    Object.keys(tr).forEach(b => {
      const ruw = Object.values(tr[b]).filter(p => p && p.lat != null).sort((x, y) => x.ts - y.ts);
      const t = timesData[b] || {};
      if (t.start != null) afgelegd[b] = Math.round(afgelegdM(ruw, t.start, t.finish));   // uit het volle spoor
      const pts = ruw.map(p => [+p.lat.toFixed(5), +p.lng.toFixed(5), Math.round((p.ts - t0) / 1000)]);
      if (pts.length > 1) sporenOpslag[b] = dunUit(pts, 900);
    });
    const uitslag = {}, namenNu = {};
    rijen.forEach(r => { uitslag[r.naam] = { gefinisht: r.gefinisht,
      elapsed: r.gefinisht ? r.elapsed : null, corrected: r.gefinisht ? r.corrected : null,
      afstand: afgelegd[r.naam] != null ? afgelegd[r.naam] : null }; });
    FLEET.forEach(b => { namenNu[b] = naamVan(b); });
    const nr = Object.keys(resultsData).map(Number).reduce((m, n) => Math.max(m, n), 0) + 1;
    const nm = baanLengteNm(lijnData, boeien);
    const res = { nr, ts: Date.now(), uitslag, namen: namenNu,
      modus: (startPlan && startPlan.modus) || 'gelijk', baan: { lines: lijnData, marks: boeien } };
    if (nm != null) res.nm = +nm.toFixed(3);
    if (startPlan && startPlan.vertraging) res.vertraging = startPlan.vertraging;
    if (lussenVan(startPlan)) {                  // lusstart: de lussen en de baanlengte per boot
      res.lussen = startPlan.lussen; res.lengtes = {};
      FLEET.forEach(b => { const n = baanLengteNm(lijnData, baanVan(b)); if (n != null) res.lengtes[b] = +n.toFixed(3); });
    }
    if (Object.keys(sporenOpslag).length) { res.sporen = sporenOpslag; res.t0 = t0; }
    if (raceStart) res.gun = raceStart;
    res.tijden = JSON.parse(JSON.stringify(timesData || {}));
    if (Object.keys(rondingData || {}).length) res.rondingen = JSON.parse(JSON.stringify(rondingData));
    // Wind per uur tijdens de race bewaren (voor de polars); mag mislukken
    try {
      const plek = racePlek(res);
      if (plek && res.gun) {
        const uren = await Promise.race([Polar.windUren(plek, res.gun - 3600e3, raceEinde(res) + 3600e3),
          new Promise(r => setTimeout(() => r([]), 8000))]);
        const van = res.gun - 3600e3, tot = raceEinde(res) + 3600e3;
        const binnen = uren.filter(w => w.t >= van - 3600e3 && w.t <= tot + 3600e3)
          .map(w => ({ t: w.t, kn: Math.round(w.kn * 10) / 10, richting: Math.round(w.richting) }));
        if (binnen.length) res.wind = binnen;
      }
    } catch (e) {}
    // Het scheepsjournaal van deze race bewaren (zonder testnotities), zodat het bij de uitslag blijft
    if (raceStart) {
      const notities = Verteller.journaal(Object.assign(journaalData(Date.now()), { afgerond: true }))
        .map(n => ({ t: n.t, kop: n.kop, tekst: n.tekst }));
      if (notities.length) res.journaal = notities;
    }
    await db.ref(`${P}/results/${nr}`).set(res);
    await wisLiveRace();
    resultsData[nr] = res;
    toonWlStatus(res.sporen ? `Race ${nr} opgeslagen ✓ — bekijk de replay (met video) bij Uitslagen.`
                            : `Race ${nr} opgeslagen ✓ (geen sporen voor een replay).`);
  } catch (e) {
    toonWlStatus('Opslaan mislukt: ' + dbFoutTekst(e));
  } finally {
    el('btnArchief').disabled = false;
  }
}
el('btnArchief').onclick = rondRaceAf;
el('btnReset').onclick = () => {
  if (!admin || !confirm('Live tijden, boei-rondingen, sporen én startsein wissen zónder op te slaan? ' +
    '(de baan blijft staan)')) return;
  wisLiveRace().then(() => toonWlStatus('Live race gewist.')).catch(e => toonWlStatus('Mislukt: ' + dbFoutTekst(e)));
};
el('btnVrijgeven').onclick = () => {
  if (!admin || !confirm('Alle boten vrijgeven? Daarna kan elke telefoon opnieuw een boot kiezen ' +
    '(nodig als een bemanning van telefoon wisselt).')) return;
  db.ref(`${P}/claims`).remove().then(() => toonWlStatus('Boten vrijgegeven ✓'))
    .catch(e => toonWlStatus('Mislukt: ' + dbFoutTekst(e)));
};

// =========================================================
//  Data koppelen (pas na inloggen — de database vereist dat)
// =========================================================
function koppelData() {
  luister(`${P}/times`, 'value', s => { timesData = s.val() || {}; verversLijst(); vierNieuweFinishes(); renderCorrectie(); });
  luister(`${P}/names`, 'value', s => {
    namen = s.val() || {};
    FLEET.forEach(b => { if (markers[b]) markers[b].setTooltipContent(schipLabel(b)); });
    verversLijst(); renderPlanning(); renderCorrectie();
    if (tabActief('tabUitslagen')) renderUitslagen();
  });
  luister(`${P}/results`, 'value', s => { resultsData = s.val() || {}; if (tabActief('tabUitslagen')) renderUitslagen(); });
  luister(`${P}/zeeslagen`, 'value', s => {
    zeeslagenData = s.val() || {}; zeeslagenGeladen = true;
    if (tabActief('tabUitslagen')) renderUitslagen();
  });
  luister(`${P}/lines`, 'value', s => { lijnData = s.val() || {}; tekenBaan(); renderPlanning(); renderConceptBalk(); });
  luister(`${P}/marks`, 'value', s => { boeien = alsBoeien(s.val()); tekenBaan(); renderPlanning(); renderConceptBalk(); renderCorrectie(); });
  luister(`${P}/rounded`, 'value', s => { rondingData = s.val() || {}; renderCorrectie(); });
  luister(`${P}/raceStart`, 'value', s => { raceStart = s.val() || null; updateAftel(); renderPlanning(); toonWlStatus(); });
  luister(`${P}/voorstel`, 'value', s => { voorstel = s.val() || null; renderPlanning(); probeerVastleggen(); });
  luister(`${P}/akkoord`, 'value', s => { akkoordData = s.val() || {}; renderPlanning(); probeerVastleggen(); });
  luister(`${P}/startPlan`, 'value', s => { startPlan = s.val() || null; updateAftel(); renderPlanning(); tekenBaan(); renderCorrectie(); });

  FLEET.forEach(naam => {
    const kleur = BOTEN[naam].kleur;
    luister(`${P}/positions/${naam}`, 'value', snap => {
      const d = snap.val();
      if (!d) return;
      laatsteTs[naam] = d.ts;
      const vorig = posData[naam];
      posData[naam] = { lat: d.lat, lng: d.lng, speed: d.speed, heading: d.heading, ts: d.ts };
      const ll = [d.lat, d.lng];
      if (!markers[naam]) {
        markers[naam] = maakSchip(ll, naam)
          .addTo(kaart).bindTooltip(schipLabel(naam), { permanent: true, direction: 'top', className: 'boot-label', offset: schipLabelOffset(naam) })
          .on('click', () => selecteerBoot(naam, true));
      } else markers[naam].setLatLng(ll);
      // koers van het schip: GPS-koers, anders uit de beweging
      const koers = d.heading != null && d.speed > 0.4 ? d.heading : koersUitBeweging(koersPunt[naam], d);
      if (koers != null) { scheepsKoers[naam] = koers; koersPunt[naam] = { lat: d.lat, lng: d.lng }; }
      else if (!koersPunt[naam]) koersPunt[naam] = vorig || { lat: d.lat, lng: d.lng };
      zetKoers(markers[naam], scheepsKoers[naam]);
      tekenRichtlijnen(naam);
      if (geselecteerd === naam) kaart.panTo(ll, { animate: true });
      if (eersteFix) { kaart.setView(ll, 14); eersteFix = false; }
      verversLijst();
    });
    sporen[naam] = L.polyline([], { color: kleur, weight: 3, opacity: .75, interactive: false }).addTo(kaart);
    luister(`${P}/tracks/${naam}`, 'child_added', snap => {
      const d = snap.val();
      if (d && d.lat != null) sporen[naam].addLatLng([d.lat, d.lng]);
      if (d && d.lat != null && d.ts != null) {
        const pts = spoorPunten[naam] = spoorPunten[naam] || [];
        if (pts.length && pts[pts.length - 1].ts > d.ts) { pts.push(d); pts.sort((a, b) => a.ts - b.ts); } else pts.push(d);
        journaalVuil = true;
      }
    });
  });

  koppelSpel();

  // Sporen wissen als een race wordt afgerond/gereset (gen verandert)
  let vorigeGen;
  luister(`${P}/gen`, 'value', s => {
    const g = s.val();
    if (vorigeGen !== undefined && g !== vorigeGen) {
      Object.values(sporen).forEach(p => p.setLatLngs([]));
      FLEET.forEach(b => { spoorPunten[b] = []; });
      testNotities = []; journaalVuil = true;
    }
    vorigeGen = g;
  });
}

metAuth(koppelData, e => meldFout(authFoutTekst(e)));
verversLijst();
tekenBaan();
renderPlanning();
// Voorspelde eindstand met rating (tijdens de race)
let voorspelHtmlCache = '';
var voorspelRijen = [];     // ook voor 'voorspelde tijd tot finish' in de bootkaarten (var: die worden al eerder getekend)
function renderVoorspelling() {
  const nu = Date.now(), sectie = el('voorspelSectie');
  const rijen = voorspelRijen = raceStart && raceStart <= nu ? voorspelEindstand({ times: timesData, gerond: rondingData, sporen: spoorPunten,
    posities: posData, lijnen: lijnData, boeien, baanVan: b => baanVanBoot(boeien, lussenVan(startPlan), b),
    raceStart, startPlan, nu }) : [];
  sectie.hidden = !rijen.length;
  const html = voorspellingHtml(rijen, naamVan);
  if (html !== voorspelHtmlCache) { el('voorspelling').innerHTML = html; voorspelHtmlCache = html; }
}
setInterval(() => {
  verversLijst(); updateAftel(); controleerOffline(); renderConceptBalk(); renderJournaal(); renderSpel(); renderVoorspelling();
  if (voorstel && !raceStart) renderPlanning();            // 'verlopen' en een nieuwe voorgestelde tijd bijwerken
}, 1000);
