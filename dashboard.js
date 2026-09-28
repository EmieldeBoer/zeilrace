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


// =========================================================
//  Kaart
// =========================================================
const kaart = maakKaart('kaart');
const baanLagen = [];   // start/finish, boeien, route, rondingslijnen
maakWindWidget(kaart);
kaartKnoppen(kaart, [{ id: 'knopOverzicht', tekst: '⛶', titel: 'Hele baan tonen', klik: overzicht }]);
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
      win: tijdOmTeWinnen(naam, timesData, raceStart, startPlan, nu) });
    const eigenNaam = naamVan(naam) !== BOTEN[naam].model;
    k.classList.toggle('offline', !online);
    k.classList.toggle('gekozen', geselecteerd === naam);
    k.setAttribute('aria-pressed', String(geselecteerd === naam));
    k.querySelector('.naam').textContent = naamVan(naam);
    k.querySelector('.model').textContent = (eigenNaam ? BOTEN[naam].model + ' · ' : '') + 'rating ' + BOTEN[naam].rating.toFixed(3);
    const meta = k.querySelector('.meta');
    meta.textContent = online ? 'LIVE' : (ts ? geleden(nu - ts) : 'geen data');
    meta.classList.toggle('live', !!online);
    k.querySelector('.stats-plek').innerHTML = bootStatsHtml(bootData(s, lijnData, boeien));
    if (markers[naam]) zetSchipStaat(markers[naam], { gekozen: geselecteerd === naam, wrak: isWrak(naam),
      spel: !!(spelStand && spelStand.start) });          // zeeslag gestart → piratenschepen
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
  const modus = res.modus === 'achtervolging' ? 'achtervolgingsstart' : 'gelijke start';
  const knoppen = (res.sporen ? `<button class="race-knop afspelen" data-nr="${nr}">▶ Replay</button>` : '') +
    (admin ? `<button class="race-knop hernoem" data-nr="${nr}">✏️ Naam</button>` +
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
// (verdiend ∝ 1 / verzeilde tijd), zo geschaald dat het gemiddelde gelijk blijft
// aan dat van de huidige ratings. Over de races: het geometrisch gemiddelde van
// verdiend / huidig per boot. Advies pas vanaf RATING_MIN_RACES races.
const RATING_MIN_RACES = 3;
function ratingVerdiend(res) {
  const fin = uitslagLijst(res).filter(r => r.gefinisht && r.elapsed > 0 && BOTEN[r.naam]);
  if (fin.length < 2) return null;
  const gemHuidig = fin.reduce((s, r) => s + BOTEN[r.naam].rating, 0) / fin.length;
  const gemSnel = fin.reduce((s, r) => s + 1 / r.elapsed, 0) / fin.length;
  const uit = {};
  fin.forEach(r => { uit[r.naam] = (1 / r.elapsed) / gemSnel * gemHuidig; });
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
      '"Race afronden &amp; opslaan" (Live-tab met ?wl).</div>';
    return;
  }
  houder.innerHTML =
    klassementHtml('Klassement', `Op gecorrigeerde tijd (met rating) · low-point · niet gefinisht = ${DNF_PUNTEN} punten`, nummers, 'corrected') +
    ratingCheckHtml(nummers) +
    [...nummers].reverse().map(raceHtml).join('');
}
el('uitslagenInhoud').addEventListener('click', e => {
  const k = e.target.closest('.race-knop'); if (!k) return;
  const nr = k.dataset.nr;
  if (k.classList.contains('afspelen')) { openReplay(nr); return; }
  if (!admin) return;
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
  // De replay loopt van hooguit 15 minuten vóór het startschot tot de finish van
  // de laatste boot. Daarbuiten (naar het startgebied varen, terug naar de haven)
  // wordt weggeknipt; de tijd telt opnieuw vanaf het beginmoment.
  const opname0 = res.t0 || res.ts;
  const knip = res.gun ? Math.max(0, (res.gun - opname0) / 1000 - 15 * 60) : 0;
  const t0 = opname0 + knip * 1000;
  const gunS = res.gun ? (res.gun - t0) / 1000 : null;
  const metSpoor = FLEET.filter(b => res.sporen[b]);
  const finishes = metSpoor.map(b => res.tijden && res.tijden[b] && res.tijden[b].finish);
  const eindS = metSpoor.length && finishes.every(f => f != null)
    ? (Math.max(...finishes) - t0) / 1000 : Infinity;               // niet iedereen binnen: tot het eind van de opname
  const bijgeknipt = v => {
    let pts = normaliseerSpoor(v).map(p => [p[0], p[1], p[2] - knip]);
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
  return { titel: `Race ${nr}${res.naam ? ': ' + res.naam : ''}`, klok, sporen, baan: res.baan, gunS };
}

let rp = null;   // replay-toestand
function openReplay(nr) {
  const data = raceWeergave(nr);
  if (!data) return;
  el('replay').hidden = false;
  el('replayTitel').textContent = data.titel;
  if (!rp) {
    rp = { kaart: maakKaart('replayKaart'), lagen: [], snelheid: 60 };
    rp.kaart.on('dragstart', () => {});
  }
  pauzeReplay();
  rp.lagen.forEach(l => rp.kaart.removeLayer(l));
  rp.lagen = []; rp.nr = nr; rp.data = data;
  const lines = (data.baan && data.baan.lines) || {}, marks = alsBoeien(data.baan && data.baan.marks);
  ['start', 'finish'].forEach(t => {
    const ln = lines[t]; if (!(ln && ln.a)) return;
    rp.lagen.push(L.polyline([[ln.a.lat, ln.a.lng], [ln.b.lat, ln.b.lng]],
      { color: t === 'start' ? '#2ea043' : '#e6194b', weight: 4, dashArray: '7 7', interactive: false }).addTo(rp.kaart));
  });
  marks.forEach((b, i) => rp.lagen.push(L.marker([b.lat, b.lng], { icon: boeiIcoon(i), interactive: false }).addTo(rp.kaart)));
  rp.boten = data.sporen.map(s => {
    const lijn = L.polyline([], { color: s.kleur, weight: 4, opacity: .9, interactive: false }).addTo(rp.kaart);
    const stip = maakSchip([0, 0], s.boot)
      .bindTooltip(esc(s.naam), { permanent: true, direction: 'top', className: 'boot-label', offset: schipLabelOffset(s.boot) });
    rp.lagen.push(lijn, stip);
    return { s, lijn, stip };
  });
  rp.eind = Math.max(0, ...data.sporen.map(s => s.pts.length ? s.pts[s.pts.length - 1][2] : 0));
  // Overstagmomenten per boot (van het startschot tot de eigen finish); labels pas tonen met de schakelaar
  rp.overstag = data.sporen.map(s => ({ s, lijst: overstagHoeken(s.pts, data.gunS != null ? data.gunS : 0,
    s.finishS != null ? s.finishS : Infinity).map(o => Object.assign(o, { marker: null })) }));
  const slider = el('replaySlider');
  slider.max = Math.ceil(rp.eind); slider.value = 0;
  setTimeout(() => {
    rp.kaart.invalidateSize();
    const alle = data.sporen.flatMap(s => s.pts.map(p => [p[0], p[1]]));
    if (alle.length) rp.kaart.fitBounds(alle, { padding: [30, 30], maxZoom: 16 });
  }, 60);
  zetReplayTijd(data.gunS != null ? Math.max(0, data.gunS - 30) : 0);
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
function zetReplayTijd(t) {
  rp.t = t;
  el('replaySlider').value = t;
  rp.boten.forEach(({ s, lijn, stip }) => {
    const p = positieOp(s.pts, t);
    if (!p) { lijn.setLatLngs([]); if (rp.kaart.hasLayer(stip)) rp.kaart.removeLayer(stip); return; }
    lijn.setLatLngs(s.pts.slice(0, p.i + 1).map(q => [q[0], q[1]]).concat([[p.lat, p.lng]]));
    stip.setLatLng([p.lat, p.lng]);
    if (!rp.kaart.hasLayer(stip)) stip.addTo(rp.kaart);
    zetKoers(stip, koersInSpoor(s.pts, p));
  });
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
  el('replayLegenda').innerHTML = rp.data.sporen.map(s =>
    `<div>${dotHtml(s.boot)}${s.finishS != null && t >= s.finishS ? '🏁 ' : ''}${esc(s.legenda)}${overstagTekst(s.boot)}</div>`).join('');
}
el('replayOverstag').addEventListener('change', () => { if (rp) zetReplayTijd(rp.t); });
function speelReplay() {
  if (rp.speelt) { pauzeReplay(); return; }
  if (rp.t >= rp.eind) zetReplayTijd(0);
  rp.speelt = true;
  el('replayPlay').textContent = '⏸ Pauze';
  let vorig = performance.now();
  const stap = nu => {
    if (!rp.speelt) return;
    const t = Math.min(rp.eind, rp.t + (nu - vorig) / 1000 * rp.snelheid);
    vorig = nu;
    zetReplayTijd(t);
    if (t >= rp.eind) pauzeReplay(); else requestAnimationFrame(stap);
  };
  requestAnimationFrame(stap);
}
function pauzeReplay() {
  if (!rp) return;
  rp.speelt = false;
  el('replayPlay').textContent = '▶ Afspelen';
}
el('replaySlider').addEventListener('input', e => { pauzeReplay(); zetReplayTijd(Number(e.target.value)); });
el('replayPlay').addEventListener('click', speelReplay);
el('replaySnelheid').addEventListener('change', e => { rp.snelheid = Number(e.target.value); });
el('replaySluit').addEventListener('click', () => { pauzeReplay(); el('replay').hidden = true; });
el('replayFoto').addEventListener('click', async () => {
  const k = el('replayFoto'); k.disabled = true; k.textContent = '⏳ Foto…';
  try {
    const blob = await maakKaartPNG(rp.data, rp.t);
    if (blob) downloadBlob(blob, `zeilrace-${RACE_ID}-race-${rp.nr}.png`);
  } catch (e) { meldFout('Foto maken mislukt: ' + e.message); }
  finally { k.disabled = false; k.textContent = '🖼 Foto'; }
});
el('replayVideo').addEventListener('click', async () => {
  const k = el('replayVideo');
  if (!videoFormaat()) { alert('Deze browser kan geen video opnemen. Probeer Chrome, Edge of Safari.'); return; }
  pauzeReplay(); k.disabled = true;
  try {
    const v = await maakRaceVideo(rp.data, f => { k.textContent = `🎬 ${Math.round(f * 100)}%`; });
    if (v) downloadBlob(v.blob, `zeilrace-${RACE_ID}-race-${rp.nr}.${v.ext}`);
  } catch (e) { meldFout('Video maken mislukt: ' + e.message); }
  finally { k.disabled = false; k.textContent = '🎬 Video'; }
});

// =========================================================
//  Baan tekenen (gepubliceerd, of het concept van de wedstrijdleiding)
// =========================================================
function huidigeBaan() { return concept || { lines: lijnData, marks: boeien }; }

function tekenBaan() {
  baanLagen.forEach(l => kaart.removeLayer(l));
  baanLagen.length = 0;
  const { lines, marks } = huidigeBaan();
  const isConcept = !!concept;
  ['start', 'finish'].forEach(t => {
    const ln = lines[t];
    if (!(ln && ln.a && ln.b)) return;
    baanLagen.push(L.polyline([[ln.a.lat, ln.a.lng], [ln.b.lat, ln.b.lng]],
      { color: t === 'start' ? '#2ea043' : '#e6194b', weight: isConcept ? 5 : 4, dashArray: isConcept ? '3 7' : '7 7' })
      .addTo(kaart).bindTooltip((isConcept ? '✎ ' : '') + (t === 'start' ? 'START' : 'FINISH'),
        { permanent: true, direction: 'center', className: 'lijn-label' }));
  });
  if (admin) tekenRondingslijnen(kaart, marks, lines, baanLagen);   // alleen voor de wedstrijdleiding
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
//  Baanplanning: verwachte tijd per boot + twee startopties
// =========================================================
function renderPlanning() {
  const sectie = el('planningSectie'), box = el('planning');
  const baan = huidigeBaan();
  const nm = baanLengteNm(baan.lines, baan.marks);
  const isWL = WL_MODUS && admin;
  if (nm == null && !isWL && !raceStart) { sectie.hidden = true; return; }
  sectie.hidden = false;
  let h = '';
  if (raceStart) {
    const achter = startPlan && startPlan.modus === 'achtervolging';
    const regels = FLEET.map(b => ({ b, t: raceStart + vertragingVan(startPlan, b) })).sort((x, y) => x.t - y.t)
      .map(x => `${dotHtml(x.b)}${esc(naamVan(x.b))} — ${formatKlok(x.t)}`).join('<br>');
    h += `<div class="optie"><b>${achter ? 'Achtervolgingsstart' : 'Gelijke start'} gepland</b><br>${regels}</div>`;
  }
  if (nm == null) {
    h += '<div class="sub">Zet een startlijn, boeien en een finishlijn om de verwachte tijd per boot te zien.</div>';
  } else {
    const plan = maakPlan(nm, windKn);
    const volg = [...FLEET].sort((a, b) => plan.verwacht[a] - plan.verwacht[b]);
    h += `<div class="kop">${concept ? '✎ Concept-baan' : 'Baan'}: ${nm.toFixed(1)} zeemijl · ` +
      `${baan.marks.length} ${baan.marks.length === 1 ? 'boei' : 'boeien'}</div>` +
      `<div class="sub">Verwachte tijden ${windKn != null ? `bij ${bft(windKn)} Bft wind` : 'bij gemiddelde wind'}` +
      ' — schatting op basis van de ORC-rating.</div>' +
      '<div class="tabelscroll"><table><thead><tr><th>Boot</th><th class="tijd">Rating</th><th class="tijd">Verwacht</th>' +
      '<th class="tijd">Achterv.</th></tr></thead><tbody>' +
      volg.map(b => `<tr><td class="boot-cel">${dotHtml(b)}${esc(naamVan(b))}</td>` +
        `<td class="tijd">${BOTEN[b].rating.toFixed(3)}</td><td class="tijd">${formatDuur(plan.verwacht[b])}</td>` +
        `<td class="tijd">${plan.vertraging[b] ? '+' + formatDuur(plan.vertraging[b]) : 'eerst'}</td></tr>`).join('') +
      '</tbody></table></div>';
  }
  box.innerHTML = h;
  // Startknoppen staan bij de wedstrijdleiding (tab Race); hier alleen hun toestand bijwerken
  el('btnSeinGelijk').disabled = !!concept;
  el('btnSeinAchter').disabled = !!concept || nm == null;
  el('startUitleg').innerHTML = concept ? '<span class="waarschuwing">Bevestig eerst de concept-baan voordat je het startsein geeft.</span>'
    : nm == null ? 'Start A kan altijd. Voor Start B (achtervolging) is een complete baan nodig: startlijn, boeien en finish.'
    : 'Het startsein valt op het eerstvolgende 5-minutenmoment. Verwachte tijden en vertragingen staan in de <b>baanplanning</b>.';
}
el('btnSeinGelijk').onclick = () => geefStartsein('gelijk');
el('btnSeinAchter').onclick = () => geefStartsein('achtervolging');

// Eerstvolgende 5-minuten-klokmoment, minimaal 5 min vanaf nu
function volgendeStartTijd() {
  const stap = 5 * 60 * 1000;
  return Math.ceil((Date.now() + stap) / stap) * stap;
}

function geefStartsein(modus) {
  if (!admin) return;
  if (concept) { toonWlStatus('Bevestig eerst de baan.'); return; }
  const nm = baanLengteNm(lijnData, boeien);
  if (modus === 'achtervolging' && nm == null) { toonWlStatus('Voor een achtervolgingsstart is een complete baan nodig.'); return; }
  if (raceStart && !confirm('Er is al een start gepland of een race bezig. Die vervangen?')) return;
  const t = volgendeStartTijd();
  const plan = nm != null ? maakPlan(nm, windKn) : null;
  const vert = modus === 'achtervolging' ? plan.vertraging : {};
  const regels = FLEET.map(b => ({ b, t: t + (vert[b] || 0) })).sort((x, y) => x.t - y.t)
    .map(x => `  ${naamVan(x.b)}: ${formatKlok(x.t)}`).join('\n');
  if (!confirm(`${modus === 'achtervolging' ? 'Achtervolgingsstart' : 'Gelijke start'} plannen?\n\n${regels}\n\n` +
    'De racers zien een grote aftelklok tot hun start.')) return;
  const sp = { modus, gezet: Date.now() };
  if (plan) {
    sp.nm = +plan.nm.toFixed(3);
    sp.verwacht = plan.verwacht;
    if (plan.windKn != null) sp.windKn = Math.round(plan.windKn * 10) / 10;
  }
  if (modus === 'achtervolging') sp.vertraging = vert;
  db.ref(P).update({ raceStart: t, startPlan: sp })
    .then(() => toonWlStatus(`Start gepland om ${formatKlok(t)} ✓`))
    .catch(e => toonWlStatus('Mislukt: ' + dbFoutTekst(e)));
}

// =========================================================
//  Grote aftelklok over de kaart
// =========================================================
const vorigeRemPer = {};
function startMomenten() {
  return FLEET.map(b => ({ b, t: raceStart + vertragingVan(startPlan, b) })).sort((x, y) => x.t - y.t);
}
function updateAftel() {
  const box = el('aftelGroot');
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
  wlStatusEl.textContent = !raceStart ? 'Nog geen start gepland.'
    : (raceStart > Date.now() ? '🔫 Start gepland om ' : '🔫 Gestart om ') + formatKlok(raceStart);
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
function toonWlTab(naam) {
  document.querySelectorAll('.wl-tab').forEach(t => {
    const aan = t.dataset.wl === naam;
    t.classList.toggle('actief', aan); t.setAttribute('aria-selected', String(aan));
  });
  document.querySelectorAll('.wl-paneel').forEach(p => { p.hidden = p.dataset.wl !== naam; });
  try { localStorage.setItem('zeilrace-wl-tab', naam); } catch (e) {}
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
function wisTijdelijk() { tijdMarkers.forEach(m => kaart.removeLayer(m)); tijdMarkers = []; tijdPunten = []; }
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

el('btnStart').onclick = () => { beginConcept(); zetModus('start', 'Tik 2 punten voor de startlijn op de kaart…'); renderConceptBalk(); };
el('btnFinish').onclick = () => { beginConcept(); zetModus('finish', 'Tik 2 punten voor de finishlijn op de kaart…'); renderConceptBalk(); };
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
el('btnBevestig').onclick = bevestigBaan;
el('btnAnnuleer').onclick = annuleerConcept;

kaart.on('click', e => {
  if (!admin || !concept || !instelModus) return;
  const p = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) };
  if (instelModus === 'boei') {
    concept.marks.push(Object.assign({ id: nieuwId() }, p));
    conceptGewijzigd(`Boei ${concept.marks.length} geplaatst (concept). Tik nog een boei, of druk op de knop om te stoppen.`);
  } else if (instelModus === 'start' || instelModus === 'finish') {
    tijdPunten.push(p);
    tijdMarkers.push(L.circleMarker(e.latlng, { radius: 6, color: '#fff', weight: 2, fillColor: '#ffe08a', fillOpacity: 1 }).addTo(kaart));
    if (tijdPunten.length === 2) {
      const t = instelModus;
      concept.lines[t] = { a: tijdPunten[0], b: tijdPunten[1] };
      // Een nieuwe start- of finishlijn = een nieuwe baan: de boeien gaan eruit
      const weg = concept.marks.length;
      concept.marks = [];
      zetModus(null);
      conceptGewijzigd(`${t === 'start' ? 'Startlijn' : 'Finishlijn'} aangepast (concept)` +
        (weg ? ` en ${weg === 1 ? 'de boei is' : 'alle ' + weg + ' boeien zijn'} weggehaald — zet ze opnieuw uit.` : '.') +
        ' Vergeet niet te bevestigen.');
    }
  }
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
let spelData = null, spelStand = null, spelVeldLaag = null, spelVeldSleutel = '', bekendeSchoten = null, spelScoreCache = '';
const scheepsKoers = {}, koersPunt = {}, richtLagen = {}, labelCache = {};
let veldModus = false, veldMidden = null, veldMarker = null;

const isWrak = b => !!(spelStand && spelStand.start && spelStand.deelnemers.includes(b) && spelStand.boten[b].levens <= 0);
function schipLabel(b) {
  const inSpel = spelStand && spelStand.start && spelStand.deelnemers.includes(b);
  return esc(naamVan(b)) + (inSpel ? ' ' + Piraat.harten(spelStand.boten[b].levens) : '');
}
function spelPosTijden() { const t = {}; FLEET.forEach(b => { if (laatsteTs[b]) t[b] = laatsteTs[b]; }); return t; }
const schipPos = b => posData[b] ? { lat: posData[b].lat, lng: posData[b].lng } : null;
function tekenRichtlijnen(b) {
  const st = spelStand;
  const actief = st && st.bezig && st.deelnemers.includes(b) && st.boten[b].levens > 0;
  if (actief) richtLagen[b] = Piraat.richtlijnen(kaart, schipPos(b), scheepsKoers[b], richtLagen[b], false);
  else if (richtLagen[b]) { kaart.removeLayer(richtLagen[b]); richtLagen[b] = null; }
}
function renderSpel() {
  const st = spelStand = Piraat.stand(spelData, spelPosTijden());
  // Zolang er geen zeeslag is gestart, zie je niets van het spel — alleen de
  // wedstrijdleiding ziet het getekende speelveld al (om het te controleren)
  const toonVeld = st.veld && (st.start || (WL_MODUS && admin));
  const sleutel = toonVeld ? JSON.stringify(st.veld) : '';
  if (sleutel !== spelVeldSleutel) { spelVeldLaag = Piraat.veldLaag(kaart, toonVeld ? st.veld : null, spelVeldLaag); spelVeldSleutel = sleutel; }
  el('regelSpel').hidden = !st.start;
  FLEET.forEach(b => {
    if (markers[b]) { const l = schipLabel(b); if (labelCache[b] !== l) { markers[b].setTooltipContent(l); labelCache[b] = l; } }
    tekenRichtlijnen(b);
  });
  el('spelSectie').hidden = !st.start;
  if (!st.start) return;
  el('spelStatusDash').textContent = Piraat.statusTekst(st, naamVan);
  const html = Piraat.scoreHtml(st, naamVan);
  if (html !== spelScoreCache) { el('spelStandDash').innerHTML = html; spelScoreCache = html; }
}
function koppelSpel() {
  luister(`${P}/spel`, 'value', s => {
    spelData = s.val();
    const st = Piraat.stand(spelData, spelPosTijden());
    const ids = new Set(st.geldig.map(g => g.id));
    if (bekendeSchoten) st.geldig.forEach(g => {         // nieuwe salvo's laten vliegen
      if (bekendeSchoten.has(g.id) || Date.now() - g.schot.ts > 20000) return;
      Piraat.animeer(kaart, g.schot, g.raak, schipPos);
      kanonschot();
    });
    bekendeSchoten = ids;
    renderSpel(); verversLijst();
  });
}

// Wedstrijdleiding: speelveld tekenen (midden + rand), zeeslag starten en stoppen
el('btnVeld').onclick = () => {
  veldModus = !veldModus; veldMidden = null;
  if (veldMarker) { kaart.removeLayer(veldMarker); veldMarker = null; }
  el('btnVeld').classList.toggle('actief', veldModus);
  toonWlStatus(veldModus ? 'Tik op de kaart het MIDDEN van het speelveld…' : 'Speelveld tekenen gestopt.');
};
kaart.on('click', e => {
  if (!admin || !veldModus) return;
  const p = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) };
  if (!veldMidden) {
    veldMidden = p;
    veldMarker = L.circleMarker(e.latlng, { radius: 6, color: '#fff', weight: 2, fillColor: '#8b1e12', fillOpacity: 1 }).addTo(kaart);
    toonWlStatus('Tik nu de RAND van het speelveld…');
    return;
  }
  const r = Math.round(afstandMeter(veldMidden, p));
  const midden = veldMidden;
  veldModus = false; veldMidden = null; el('btnVeld').classList.remove('actief');
  if (veldMarker) { kaart.removeLayer(veldMarker); veldMarker = null; }
  if (r < 50) { toonWlStatus('Dat speelveld is te klein — probeer het opnieuw.'); return; }
  if (!confirm(`Speelveld opslaan: een cirkel met een straal van ${formatAfstand(r)}?`)) { toonWlStatus('Speelveld niet opgeslagen.'); return; }
  db.ref(`${P}/spel/veld`).set({ lat: midden.lat, lng: midden.lng, r })
    .then(() => toonWlStatus(`Speelveld opgeslagen (straal ${formatAfstand(r)}).`))
    .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
});
el('btnSpelStart').onclick = () => {
  if (!admin) return;
  const geenVeld = !(spelData && spelData.veld) ? '\n\nLet op: er is nog geen speelveld getekend.' : '';
  if (!confirm('Nieuwe zeeslag starten? Alle schepen krijgen weer 3 levens en 10 salvo\'s.' + geenVeld)) return;
  db.ref(`${P}/spel`).update({ start: Date.now(), eind: null, schoten: null, straf: null })
    .then(() => toonWlStatus('🏴‍☠️ De zeeslag is begonnen!'))
    .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
};
el('btnSpelStop').onclick = () => {
  if (!admin || !spelData || !spelData.start) return;
  if (spelStand && spelStand.bezig) {
    if (!confirm('De zeeslag nu beëindigen? De huidige stand is de eindstand.')) return;
    db.ref(`${P}/spel/eind`).set(Date.now()).catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
  } else {
    if (!confirm('De uitslag van de zeeslag van het scherm halen? (Het speelveld blijft staan.)')) return;
    db.ref(`${P}/spel`).update({ start: null, eind: null, schoten: null, straf: null })
      .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
  }
};

// --- Handmatige correctie van boeirondingen ---
// Voor als een telefoon een ronding mist (GPS weg, toestel uit). Werkt op de
// gepubliceerde baan; de tracker neemt de wijziging direct over.
function renderCorrectie() {
  const houder = el('correctie');
  if (!admin) { houder.innerHTML = ''; return; }
  if (!boeien.length) { houder.innerHTML = '<div class="uitleg">Er liggen geen boeien in de baan.</div>'; return; }
  houder.innerHTML = FLEET.map(b => {
    const gerond = rondingData[b] || {}, t = timesData[b] || {};
    const knoppen = boeien.map((boei, i) => {
      const id = boeiId(boei, i), ts = gerond[id];
      return `<button type="button" class="corr-boei${ts != null ? ' gerond' : ''}" data-boot="${b}" data-id="${esc(id)}" ` +
        `data-nr="${i + 1}"${t.finish != null ? ' disabled title="Al gefinisht"' : ''}>` +
        (ts != null ? `✓ Boei ${i + 1}<br><small>${klokHM(ts)}</small>` : `Boei ${i + 1}`) + '</button>';
    }).join('');
    return `<div class="corr-rij"><div class="corr-naam">${dotHtml(b)}${esc(naamVan(b))}` +
      `${t.start == null ? ' <small>(nog niet gestart)</small>' : ''}</div><div class="corr-boeien">${knoppen}</div></div>`;
  }).join('');
}
el('correctie').addEventListener('click', e => {
  const k = e.target.closest('.corr-boei');
  if (!k || k.disabled || !admin) return;
  const { boot, id, nr } = k.dataset;
  const ref = db.ref(`${P}/rounded/${boot}/${id}`);
  const al = rondingData[boot] && rondingData[boot][id] != null;
  if (al) {
    if (!confirm(`Ronding van boei ${nr} voor ${naamVan(boot)} terugdraaien?\nDe telefoon moet de boei dan opnieuw ronden.`)) return;
    ref.remove().then(() => toonWlStatus(`Boei ${nr} voor ${naamVan(boot)} teruggezet naar niet gerond.`))
      .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
  } else {
    if (!confirm(`Boei ${nr} voor ${naamVan(boot)} handmatig als GEROND markeren (tijd: nu)?`)) return;
    ref.set(Date.now()).then(() => toonWlStatus(`Boei ${nr} voor ${naamVan(boot)} handmatig als gerond gemarkeerd.`))
      .catch(err => toonWlStatus('Mislukt: ' + dbFoutTekst(err)));
  }
});

// --- Race afronden, resetten, boten vrijgeven ---
function wisLiveRace() {
  return db.ref(P).update({ times: null, rounded: null, raceStart: null, startPlan: null, tracks: null, gen: Date.now() });
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
    if (Object.keys(sporenOpslag).length) { res.sporen = sporenOpslag; res.t0 = t0; }
    if (raceStart) res.gun = raceStart;
    res.tijden = JSON.parse(JSON.stringify(timesData || {}));
    if (Object.keys(rondingData || {}).length) res.rondingen = JSON.parse(JSON.stringify(rondingData));
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
  luister(`${P}/lines`, 'value', s => { lijnData = s.val() || {}; tekenBaan(); renderPlanning(); renderConceptBalk(); });
  luister(`${P}/marks`, 'value', s => { boeien = alsBoeien(s.val()); tekenBaan(); renderPlanning(); renderConceptBalk(); renderCorrectie(); });
  luister(`${P}/rounded`, 'value', s => { rondingData = s.val() || {}; renderCorrectie(); });
  luister(`${P}/raceStart`, 'value', s => { raceStart = s.val() || null; updateAftel(); renderPlanning(); toonWlStatus(); });
  luister(`${P}/startPlan`, 'value', s => { startPlan = s.val() || null; updateAftel(); renderPlanning(); });

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
setInterval(() => { verversLijst(); updateAftel(); controleerOffline(); renderConceptBalk(); renderJournaal(); renderSpel(); }, 1000);
