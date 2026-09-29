// ============================================================
//  Zeilrace — gedeelde hulpfuncties
//  Geladen door index.html (dashboard) en tracker.html.
// ============================================================

// --- Veiligheid: tekst veilig in HTML zetten -------------------
// Alles wat van gebruikers komt (bootnamen, racenamen, boei-namen)
// gaat hierdoor voordat het in innerHTML of een kaartlabel belandt.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Inloggen ---------------------------------------------------
// Iedereen logt onzichtbaar anoniem in (nodig om de database te
// lezen); de wedstrijdleiding logt in met een e-mail-account dat in
// /admins staat. klaar(user) wordt één keer aangeroepen.
function metAuth(klaar, fout) {
  let gestart = false;
  auth.onAuthStateChanged(user => {
    if (user) { if (!gestart) { gestart = true; klaar(user); } return; }
    auth.signInAnonymously().catch(e => fout && fout(e));
  });
}
function isAdmin(user) {
  if (!user || user.isAnonymous) return Promise.resolve(false);
  return db.ref('admins/' + user.uid).get().then(s => s.val() === true).catch(() => false);
}
function authFoutTekst(e) {
  const c = (e && e.code) || '';
  if (c === 'auth/configuration-not-found')
    return 'Firebase Authentication is nog niet ingesteld (console → Authentication → Get started). Zie README.';
  if (c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation')
    return 'Anoniem inloggen staat nog uit in Firebase (Authentication → Sign-in method). Zie README.';
  if (c === 'auth/network-request-failed') return 'Geen internetverbinding.';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email',
       'auth/invalid-login-credentials'].includes(c)) return 'Onjuist e-mailadres of wachtwoord.';
  if (c === 'auth/too-many-requests') return 'Te veel pogingen — wacht even en probeer opnieuw.';
  return 'Inloggen mislukt: ' + ((e && e.message) || c);
}

// --- Database: luisteren met foutmelding -----------------------
function dbFoutTekst(e) {
  const t = (e && (e.code || e.message)) || '';
  return /permission/i.test(t)
    ? 'Geen toegang tot de database. Staan de regels uit database.rules.json in Firebase? (zie README)'
    : 'Databasefout: ' + ((e && e.message) || t);
}
function meldFout(tekst) {
  const b = document.getElementById('banner');
  if (b) { b.textContent = tekst; b.hidden = false; }
}
function luister(pad, ev, cb) {
  db.ref(pad).on(ev, cb, e => meldFout(dbFoutTekst(e)));
}

// --- Meetkunde: kruisen twee lijnstukken elkaar? ---------------
// Punten zijn objecten {lat, lng}. Over korte afstanden behandelen
// we lat/lng als een plat vlak; dat is ruim nauwkeurig genoeg.
function _orient(a, b, c) {
  return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
}
function _opSegment(a, b, c) {
  return Math.min(a.lng, b.lng) <= c.lng && c.lng <= Math.max(a.lng, b.lng) &&
         Math.min(a.lat, b.lat) <= c.lat && c.lat <= Math.max(a.lat, b.lat);
}
// p1-p2 = spoor van de boot, p3-p4 = de lijn (start, finish, ronding)
function lijnstukkenKruisen(p1, p2, p3, p4) {
  const d1 = _orient(p3, p4, p1), d2 = _orient(p3, p4, p2);
  const d3 = _orient(p1, p2, p3), d4 = _orient(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && _opSegment(p3, p4, p1)) return true;
  if (d2 === 0 && _opSegment(p3, p4, p2)) return true;
  if (d3 === 0 && _opSegment(p1, p2, p3)) return true;
  if (d4 === 0 && _opSegment(p1, p2, p4)) return true;
  return false;
}

// --- Afstand tussen twee punten in meters (haversine) ----------
function afstandMeter(a, b) {
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// --- Midden van een lijn {a,b} ---------------------------------
function lijnMidden(ln) { return { lat: (ln.a.lat + ln.b.lat) / 2, lng: (ln.a.lng + ln.b.lng) / 2 }; }

// --- Boeien uit Firebase altijd als nette array ----------------
function alsBoeien(v) {
  return (Array.isArray(v) ? v : (v ? Object.values(v) : [])).filter(b => b && b.lat != null);
}
// Vaste ID van een boei. Rondingen hangen aan deze ID (niet aan het
// volgnummer), zodat boeien toevoegen/weghalen tijdens een race geen
// al geronde boeien door elkaar haalt. Oude boeien zonder id: volgnummer.
function boeiId(b, i) { return (b && b.id) || String(i); }

// --- Vorige en volgende punt van boei i in de baan -------------
// prev/next = de omliggende boei, of de start-/finishlijn (midden).
function boeiPrevNext(i, boeien, lijnen) {
  const prev = i > 0 ? boeien[i - 1]
    : (lijnen.start && lijnen.start.a ? lijnMidden(lijnen.start) : null);
  const next = i < boeien.length - 1 ? boeien[i + 1]
    : (lijnen.finish && lijnen.finish.a ? lijnMidden(lijnen.finish) : null);
  return { prev, next };
}

// --- Rondingslijn van een boei ---------------------------------
// Lijn vanaf de boei naar buiten, langs de bissectrice van de hoek
// prev-boei-next. Oversteken = boei gerond. 'marginM' verlengt de lijn
// iets naar binnen (GPS-marge) zodat een strakke ronding ook telt.
// Geeft {a,b,dwars} (lat/lng) terug, of null zonder vorig én volgend punt.
// Is er geen duidelijke bocht (bijna rechtdoor, of alleen een vorig of
// volgend punt), dan wordt het een DWARSE lijn door de boei, haaks op de
// koers: aan welke kant je de boei ook passeert, het telt (dwars: true).
function rondingsLijn(boei, prev, next, marginM, reikM) {
  if (!prev && !next) return null;
  const latR = boei.lat * Math.PI / 180;
  const mx = p => ({ x: (p.lng - boei.lng) * 111000 * Math.cos(latR), y: (p.lat - boei.lat) * 111000 });
  const norm = a => { const L = Math.hypot(a.x, a.y); return L ? { x: a.x / L, y: a.y / L } : { x: 0, y: 0 }; };
  const naarLatLng = (dx, dy) => ({ lat: boei.lat + dy / 111000, lng: boei.lng + dx / (111000 * Math.cos(latR)) });
  const u = prev ? norm(mx(prev)) : { x: 0, y: 0 };   // richting naar waar je vandaan komt
  const w = next ? norm(mx(next)) : { x: 0, y: 0 };   // richting naar waar je heen gaat
  const bx = u.x + w.x, by = u.y + w.y;
  const L = Math.hypot(bx, by);
  if (!prev || !next || L < 0.15) {
    // Koersrichting door de boei (van prev naar next) → lijn haaks daarop
    const k = norm({ x: w.x - u.x, y: w.y - u.y });
    if (!k.x && !k.y) return null;
    const px = -k.y, py = k.x;
    return { a: naarLatLng(-px * reikM, -py * reikM), b: naarLatLng(px * reikM, py * reikM), dwars: true };
  }
  const ox = -bx / L, oy = -by / L;          // buitenwaartse bissectrice (eenheidsvector)
  return {
    a: naarLatLng(-ox * marginM, -oy * marginM),   // iets naar binnen (marge)
    b: naarLatLng(ox * reikM, oy * reikM),         // ver naar buiten
    dwars: false
  };
}

// --- Peiling (bearing) van 'from' naar 'to' in graden (0=N) -----
function peiling(from, to) {
  const f1 = from.lat * Math.PI / 180, f2 = to.lat * Math.PI / 180;
  const dl = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// --- Dichtstbijzijnde punt op lijnstuk a-b t.o.v. p ------------
function dichtstbijPuntOpLijn(p, a, b) {
  const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.lng - ax) * dx + (p.lat - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { lat: ay + t * dy, lng: ax + t * dx };
}

// --- Volgende doel van een boot --------------------------------
function doelVanBoot(pos, start, finish, gerond, lijnen, boeien) {
  if (finish != null) return null;
  if (start == null) return (lijnen.start && lijnen.start.a)
    ? { label: 'Startlijn', punt: dichtstbijPuntOpLijn(pos, lijnen.start.a, lijnen.start.b) } : null;
  const v = boeien.findIndex((b, i) => (gerond || {})[boeiId(b, i)] == null);
  if (v !== -1) return { label: boeien[v].label || 'Boei ' + (v + 1), punt: { lat: boeien[v].lat, lng: boeien[v].lng } };
  return (lijnen.finish && lijnen.finish.a)
    ? { label: 'Finish', punt: dichtstbijPuntOpLijn(pos, lijnen.finish.a, lijnen.finish.b) } : null;
}

// --- VMG (m/s) naar een doelpunt via GPS-koers; null zonder koers -
function vmgNaarDoel(pos, speedMps, heading, doelPunt) {
  if (speedMps == null || heading == null || isNaN(heading)) return null;
  const b = peiling(pos, doelPunt);
  return speedMps * Math.cos((b - heading) * Math.PI / 180);
}

// --- Afgelegde afstand langs een spoor (m) ---------------------
// pts = [{lat,lng,ts}] op tijd gesorteerd; telt alleen tussen van en tot (ms).
// Tegen GPS-ruis telt een stap pas na 10 m verplaatsing, en sprongen die
// sneller dan 25 kn zouden zijn (GPS-uitschieters) tellen niet mee.
const SPOOR_MIN_STAP_M = 10, SPOOR_MAX_MPS = 25 / 1.94384;
function afgelegdM(pts, van, tot) {
  let m = 0, anker = null;
  for (const p of pts || []) {
    if (van != null && p.ts < van) continue;
    if (tot != null && p.ts > tot) break;
    if (!anker) { anker = p; continue; }
    const d = afstandMeter(anker, p), dt = (p.ts - anker.ts) / 1000;
    if (d < SPOOR_MIN_STAP_M || (dt > 0 && d / dt > SPOOR_MAX_MPS)) continue;
    m += d; anker = p;
  }
  return m;
}

// --- Gecorrigeerde tijd ------------------------------------------
// Verzeild = vanaf de eigen start (het eigen startsein, anders de
// startlijn). Gecorrigeerd:
//   gelijke start   → verzeild × rating
//   achtervolging   → tijd vanaf het eerste startsein (finishvolgorde telt)
//   lusstart        → idem: de rating zit al in de lengte van de lus
function eigenStartVan(boot, t, raceStart, startPlan) {
  return raceStart != null ? raceStart + vertragingVan(startPlan, boot) : (t || {}).start;
}
const eersteBinnenWint = (raceStart, startPlan) => raceStart != null && !!startPlan &&
  (startPlan.modus === 'achtervolging' || startPlan.modus === 'lus');
function gecorrigeerdeTijd(boot, eind, raceStart, startPlan, eigenStart) {
  return eersteBinnenWint(raceStart, startPlan) ? eind - raceStart : (eind - eigenStart) * BOTEN[boot].rating;
}

// --- Hoeveel tijd heeft een boot nog om te winnen? --------------
// Kijkt naar de boten die al binnen zijn: vóór welk klokmoment moet deze
// boot finishen om hun gecorrigeerde tijd te verslaan? Geeft de beste plek
// die nog haalbaar is: { plek, tot (klok, ms), rest (ms) }. Kan hij geen
// enkele binnengekomen boot meer verslaan: { plek: 1, tot: null, rest: null }.
// Null als de boot niet onderweg is of nog niemand binnen is.
function tijdOmTeWinnen(boot, times, raceStart, startPlan, nu) {
  const t = times[boot] || {};
  const eigenStart = eigenStartVan(boot, t, raceStart, startPlan);
  if (t.start == null || t.finish != null || eigenStart == null) return null;
  const binnen = Object.keys(BOTEN).filter(b => b !== boot && times[b] && times[b].start != null && times[b].finish != null)
    .map(b => gecorrigeerdeTijd(b, times[b].finish, raceStart, startPlan, eigenStartVan(b, times[b], raceStart, startPlan)))
    .filter(c => c != null && !isNaN(c)).sort((a, b) => a - b);
  if (!binnen.length) return null;
  for (let i = 0; i < binnen.length; i++) {
    const tot = eersteBinnenWint(raceStart, startPlan) ? raceStart + binnen[i] : eigenStart + binnen[i] / BOTEN[boot].rating;
    if (tot > nu) return { plek: i + 1, tot, rest: tot - nu };
  }
  return { plek: 1, tot: null, rest: null };
}
const winLabel = w => w.plek === 1 || w.rest == null ? 'Om te winnen' : `Voor plek ${w.plek}`;
const winWaarde = w => w.rest == null ? 'te laat' : formatDuur(w.rest);

// --- Live data van een boot (snelheid, VMG, doel, afstand, tijd) -
// Optioneel in s: afgelegd (m, sinds de start) en win (uit tijdOmTeWinnen).
function bootData(s, lijnen, boeien) {
  if (!s || s.lat == null) return { status: 'geen' };
  const kn = v => (v * 1.94384).toFixed(1) + ' kn';
  const spd = s.speed != null ? kn(s.speed) : '—';
  const extra = { afgelegd: s.afgelegd != null ? formatAfstand(s.afgelegd) : null, win: s.win || null };
  if (s.finish != null) return Object.assign({ status: 'finish', spd }, extra);
  const pos = { lat: s.lat, lng: s.lng };
  const doel = doelVanBoot(pos, s.start, s.finish, s.gerond, lijnen, boeien);
  if (!doel) return Object.assign({ status: 'ok', spd, vmg: '—', doel: '—', afst: '—', eta: '—' }, extra);
  const dist = afstandMeter(pos, doel.punt);
  const vmg = vmgNaarDoel(pos, s.speed, s.heading, doel.punt);
  return Object.assign({
    status: 'ok', spd,
    vmg: vmg != null ? kn(vmg) : '—', vmgNeg: vmg != null && vmg < 0,
    doel: doel.label, afst: formatAfstand(dist),
    eta: (s.speed != null && s.speed > 0.3) ? formatDuur(dist / s.speed * 1000) : '—'
  }, extra);
}
// Als raster met labels (leesbaarder dan één lange zin)
function bootStatsHtml(d) {
  if (d.status === 'geen') return '<div class="stats-leeg">nog geen positie</div>';
  const c = (k, v, cls) => `<div${cls ? ` class="${cls}"` : ''}><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`;
  const afg = d.afgelegd ? c('Afgelegd', d.afgelegd) : '';
  if (d.status === 'finish')
    return '<div class="stats">' + c('Snelheid', d.spd) + afg + '<div class="stats-finish">🏁 gefinisht</div></div>';
  const win = d.win ? c(winLabel(d.win), winWaarde(d.win), d.win.rest == null ? 'neg' : '') : '';
  return '<div class="stats">' + c('Snelheid', d.spd) + c('VMG', d.vmg, d.vmgNeg ? 'neg' : '') +
    c('Doel', d.doel) + c('Afstand', d.afst) + c('Nog ca.', d.eta) + afg + win + '</div>';
}

// --- Kaart ------------------------------------------------------
const TEGEL_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
function maakKaart(id) {
  const k = L.map(id).setView([52.4, 5.4], 12);
  L.tileLayer(TEGEL_URL, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(k);
  return k;
}
// --- Piratenschepen als kaartsymbool (bovenaanzicht, draaien mee met de koers) ---
// Drie modellen, op dezelfde schaal getekend (in meters), zodat de onderlinge
// lengteverschillen van de echte boten kloppen (BOTEN[..].schip in config.js).
//   sloep      — 1 mast met fok, 2 kanonnen per kant
//   brigantijn — 2 masten met fok, klein achterdek, 3 kanonnen per kant
//   fregat     — 3 masten, hoog achterkasteel met raampjes, 4 kanonnen per kant
const SCHIP_PX_PER_M = 4;                  // schaal op de kaart
const SCHIP_TYPES = {
  sloep:      { masten: [-0.03],             zeilB: [1.5],            kanonnen: 2, kasteel: 0,    fok: true,  spiegel: 0.28 },
  brigantijn: { masten: [-0.2, 0.12],        zeilB: [1.3, 1.5],       kanonnen: 3, kasteel: 0.17, fok: true,  spiegel: 0.36 },
  fregat:     { masten: [-0.27, -0.02, 0.22], zeilB: [1.25, 1.55, 1.3], kanonnen: 4, kasteel: 0.26, fok: false, spiegel: 0.42 }
};
// Onderdelen van het schip als SVG-paden in meters (boeg naar boven = −y).
// Dezelfde paden worden op de kaart (SVG) en in de export (canvas) getekend.
// stijl 'kaart'  = eenvoudig scheepje zoals op een oude zeekaart (tijdens de race)
// stijl 'piraat' = het uitgebreide piratenschip (tijdens het piratenspel)
function schipOnderdelen(boot, stijl = 'piraat') {
  const cfg = (BOTEN[boot] && BOTEN[boot].schip) || { type: 'brigantijn', romp: 13, breedte: 4.4 };
  const T = SCHIP_TYPES[cfg.type] || SCHIP_TYPES.brigantijn, kleur = (BOTEN[boot] && BOTEN[boot].kleur) || '#888';
  const L = cfg.romp, hL = L / 2, b = cfg.breedte / 2, s = b * T.spiegel;
  const f = n => +n.toFixed(2);
  const romp = k => {
    const h = hL * k, w = b * k, t = s * k;
    return `M0 ${f(-h)} C${f(w * .95)} ${f(-h * .62)} ${f(w * 1.05)} ${f(-h * .15)} ${f(w)} ${f(h * .25)} ` +
      `C${f(w * .98)} ${f(h * .6)} ${f(t * 1.25)} ${f(h * .93)} ${f(t)} ${f(h)} L${f(-t)} ${f(h)} ` +
      `C${f(-t * 1.25)} ${f(h * .93)} ${f(-w * .98)} ${f(h * .6)} ${f(-w)} ${f(h * .25)} ` +
      `C${f(-w * 1.05)} ${f(-h * .15)} ${f(-w * .95)} ${f(-h * .62)} 0 ${f(-h)}Z`;
  };
  const cirkel = (y, r) => `M${f(-r)} ${f(y)} a${r} ${r} 0 1 0 ${f(2 * r)} 0 a${r} ${r} 0 1 0 ${f(-2 * r)} 0`;
  const kader = { links: b + 1.2, boven: hL + L * .14, onder: hL + .6 };
  if (stijl === 'kaart') {
    // Inkt op perkament: romp in de bootkleur, mast + giek, en een zog achter het schip
    const inkt = '#2b1b0d';
    return Object.assign({ delen: [
      { d: `M${f(-s * .8)} ${f(hL + .3)} Q${f(-b * .9)} ${f(hL + L * .07)} ${f(-b * 1.1)} ${f(hL + .55)}` +
           ` M${f(s * .8)} ${f(hL + .3)} Q${f(b * .9)} ${f(hL + L * .07)} ${f(b * 1.1)} ${f(hL + .55)}`, stroke: inkt, lw: .22 },  // zog
      { d: romp(1), fill: kleur, stroke: inkt, lw: .5, schaduw: true },                                           // romp
      { d: romp(.62), fill: 'none', stroke: 'rgba(255,248,230,.65)', lw: .25 },                                   // dekrand
      { d: `M0 ${f(L * -.08)} L0 ${f(hL * .78)}`, stroke: inkt, lw: .3 },                                         // giek
      { d: cirkel(L * -.08, .45), fill: inkt },                                                                    // mast
      { d: `M0 ${f(-hL + .4)} L0 ${f(-hL - L * .08)}`, stroke: inkt, lw: .3 }                                     // boegspriet
    ] }, kader);
  }
  const d = [];
  d.push({ d: `M0 ${f(-hL + .3)} L0 ${f(-hL - L * .12)}`, stroke: '#3b2a18', lw: .35 });                 // boegspriet
  d.push({ d: romp(1), fill: '#5a3418', stroke: '#1f140a', lw: .4, schaduw: true });                     // romp
  d.push({ d: romp(.84), fill: '#a8753f' });                                                             // dek
  d.push({ d: `M${f(-b * .35)} ${f(-hL * .5)} V${f(hL * .8)} M0 ${f(-hL * .75)} V${f(hL * .84)} M${f(b * .35)} ${f(-hL * .5)} V${f(hL * .8)}`,
    stroke: '#7d5328', lw: .12 });                                                                       // planken
  if (T.kasteel) {                                                                                       // achterdek / -kasteel
    const y0 = hL - L * T.kasteel;
    d.push({ d: `M${f(-b * .8)} ${f(y0)} H${f(b * .8)} L${f(s * .95)} ${f(hL * .97)} H${f(-s * .95)}Z`, fill: '#7a4a22', stroke: '#1f140a', lw: .2 });
    d.push({ d: `M${f(-b * .62)} ${f(y0 + .3)} H${f(b * .62)}`, stroke: '#c9a24a', lw: .18 });
    if (cfg.type === 'fregat')
      d.push({ d: [-.55, 0, .55].map(x => `M${f(s * x - .25)} ${f(hL * .9)} h.5 v.4 h-.5Z`).join(' '), fill: '#f0c75e' });
  }
  for (let i = 0; i < T.kanonnen; i++) {                                                                 // kanonnen
    const y = -hL * .3 + (T.kanonnen > 1 ? i * hL * .75 / (T.kanonnen - 1) : 0), w = b * 1.02;
    d.push({ d: `M${f(w - .3)} ${f(y - .28)} h.6 v.56 h-.6Z M${f(-w + .3)} ${f(y - .28)} h-.6 v.56 h.6Z`, fill: '#161616' });
  }
  if (T.fok) {                                                                                           // fok
    const my = L * T.masten[0];
    d.push({ d: `M0 ${f(-hL - L * .1)} L${f(b * .45)} ${f(my - .4)} L0 ${f(my - .4)}Z`, fill: '#f4ead3', stroke: '#8a6a3a', lw: .12 });
  }
  T.masten.forEach((m, i) => {                                                                           // zeilen + masten
    const y = L * m, w = b * T.zeilB[i], dp = 1.1;
    d.push({ d: `M${f(-w)} ${f(y)} Q0 ${f(y + dp * 1.6)} ${f(w)} ${f(y)} L${f(w * .92)} ${f(y + dp)} Q0 ${f(y + dp * 2.4)} ${f(-w * .92)} ${f(y + dp)}Z`,
      fill: '#f4ead3', stroke: '#8a6a3a', lw: .14 });
    d.push({ d: `M${f(-w * .8)} ${f(y + dp * .62)} Q0 ${f(y + dp * 1.95)} ${f(w * .8)} ${f(y + dp * .62)}`, stroke: kleur, lw: .32 });
    d.push({ d: cirkel(y + .2, .35), fill: '#3b2a18' });
  });
  const gm = L * T.masten[Math.floor(T.masten.length / 2)];                                               // wimpel
  d.push({ d: `M0 ${f(gm)} L0 ${f(gm - 2.1)} L${f(b * .9)} ${f(gm - 1.6)} L0 ${f(gm - 1.1)}`, fill: kleur, stroke: '#1f140a', lw: .12 });
  // kader (m) rond het midden van de romp: links/rechts, boven (boegspriet) en onder
  return Object.assign({ delen: d }, kader);
}
function schipMaat(boot, stijl) {          // pixelmaat + ankerpunt (midden van de romp) op de kaart
  const s = schipOnderdelen(boot, stijl), px = SCHIP_PX_PER_M;
  return { b: Math.round(2 * s.links * px), h: Math.round((s.boven + s.onder) * px),
           ax: Math.round(s.links * px), ay: Math.round(s.boven * px), s };
}
function schipSvg(boot, stijl = 'piraat') {
  const { b, h, s } = schipMaat(boot, stijl);
  const pad = p => `<path d="${p.d}" fill="${p.fill || 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.lw}" stroke-linecap="round"` : ''}/>`;
  return `<svg class="schip-svg ${stijl}" viewBox="${-s.links} ${-s.boven} ${2 * s.links} ${s.boven + s.onder}" width="${b}" height="${h}" aria-hidden="true">` +
    s.delen.map(pad).join('') + '</svg>';
}
// Voor het canvas (export-video/foto): hetzelfde schip, pxPerM pixels per meter
function tekenSchipCanvas(c, x, y, koers, boot, pxPerM, stijl = 'kaart') {
  const s = schipOnderdelen(boot, stijl);
  c.save(); c.translate(x, y); c.rotate((koers || 0) * Math.PI / 180); c.scale(pxPerM, pxPerM);
  c.lineCap = 'round'; c.lineJoin = 'round';
  s.delen.forEach(p => {
    const pad = new Path2D(p.d);
    if (p.schaduw) { c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 4; c.shadowOffsetY = 2; }
    if (p.fill) { c.fillStyle = p.fill; c.fill(pad); }
    c.shadowColor = 'transparent';
    if (p.stroke) { c.strokeStyle = p.stroke; c.lineWidth = p.lw; c.stroke(pad); }
  });
  c.restore();
}
const schipLabelOffset = boot => [0, -schipMaat(boot).ay + 4];
function maakSchip(latlng, boot) {
  const { b, h, ax, ay } = schipMaat(boot);
  const icon = L.divIcon({ className: 'schip',
    // beide uiterlijken zitten erin; de klasse 'spel' op de marker kiest het piratenschip
    html: `<div class="schip-draai" style="width:${b}px;height:${h}px;transform-origin:${ax}px ${ay}px">${schipSvg(boot, 'kaart')}${schipSvg(boot, 'piraat')}</div>`,
    iconSize: [b, h], iconAnchor: [ax, ay] });
  const m = L.marker(latlng, { icon, keyboard: false, riseOnHover: true });
  m.on('add', () => { zetKoers(m, m._koers); zetSchipStaat(m, m._staat || {}); });
  return m;
}
function zetKoers(m, koers) {
  if (koers == null || isNaN(koers)) return;
  m._koers = koers;
  const e = m.getElement(); if (e) e.querySelector('.schip-draai').style.transform = `rotate(${koers}deg)`;
}
function zetSchipStaat(m, staat) {                  // { eigen, gekozen, wrak, spel }
  m._staat = staat;
  const e = m.getElement(); if (!e) return;
  e.classList.toggle('eigen', !!staat.eigen);
  e.classList.toggle('gekozen', !!staat.gekozen);
  e.classList.toggle('wrak', !!staat.wrak);
  e.classList.toggle('spel', !!staat.spel);        // piratenspel bezig → piratenschip
}
// Koers uit twee posities (als de GPS geen koers geeft): alleen bij genoeg verplaatsing
function koersUitBeweging(vorige, nu, minM = 6) {
  return vorige && afstandMeter(vorige, nu) >= minM ? peiling(vorige, nu) : null;
}

// Knoppen rechtsboven op de kaart: [{id, tekst, titel, klik}]
function kaartKnoppen(kaart, knoppen) {
  const c = L.control({ position: 'topright' });
  c.onAdd = () => {
    const div = L.DomUtil.create('div', 'leaflet-bar kaartknoppen');
    knoppen.forEach(k => {
      const a = L.DomUtil.create('a', '', div);
      a.href = '#'; a.id = k.id; a.title = k.titel;
      a.setAttribute('role', 'button'); a.setAttribute('aria-label', k.titel);
      a.textContent = k.tekst;
      L.DomEvent.on(a, 'click', e => { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e); k.klik(); });
    });
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  c.addTo(kaart);
}
function boeiIcoon(i, concept) {
  return L.divIcon({ className: '', html: `<div class="boei${concept ? ' concept' : ''}">${i + 1}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13] });
}
// Lusboei (lusstart): letter A of B in de kleur van de boot
function lusIcoon(letter, kleur) {
  return L.divIcon({ className: '', html: `<div class="boei lus" style="background:${kleur}">${letter}</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11] });
}
// Paarse rondingslijnen (getekend korter dan de 10 km die meetelt).
// Optioneel een eigen kleur en een filter op de boeien die getekend worden.
function tekenRondingslijnen(kaart, boeien, lijnen, lagen, kleur, filter) {
  boeien.forEach((boei, i) => {
    if (filter && !filter(boei)) return;
    const { prev, next } = boeiPrevNext(i, boeien, lijnen);
    const rl = rondingsLijn(boei, prev, next, 6, 150);
    if (rl) lagen.push(L.polyline([[rl.a.lat, rl.a.lng], [rl.b.lat, rl.b.lng]],
      { color: kleur || '#e05fd8', weight: 3, dashArray: '4 6', interactive: false }).addTo(kaart));
  });
}

// --- Wind (Open-Meteo) -----------------------------------------
function kompas(deg) {
  const r = ['N','NNO','NO','ONO','O','OZO','ZO','ZZO','Z','ZZW','ZW','WZW','W','WNW','NW','NNW'];
  return r[Math.round(deg / 22.5) % 16];
}
// Knopen → Beaufort (ondergrenzen in knopen voor 1 t/m 12 Bft)
const BFT_GRENZEN = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
function bft(kn) {
  const k = Math.round(kn);
  return BFT_GRENZEN.filter(g => k >= g).length;
}
function maakWindWidget(kaart) {
  const c = L.control({ position: 'bottomleft' });
  c.onAdd = () => {
    const div = L.DomUtil.create('div', 'windwidget');
    div.id = 'windwidget';
    div.innerHTML = '<div class="windpijl" id="windPijl" title="wijst mee met de wind">↑</div>' +
      '<div><div class="kop">Wind</div><div class="spd" id="windSpd">– Bft</div>' +
      '<div class="windsub" id="windDir">laden…</div></div>';
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  c.addTo(kaart);
}
async function toonWind(pos) {
  const w = document.getElementById('windwidget');
  if (!w || !pos) return;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(4)}` +
      `&longitude=${pos.lng.toFixed(4)}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`;
    const c = (await (await fetch(url)).json()).current;
    document.getElementById('windSpd').textContent = bft(c.wind_speed_10m) + ' Bft';
    document.getElementById('windDir').textContent =
      `uit ${kompas(c.wind_direction_10m)} (${Math.round(c.wind_direction_10m)}°) · vlagen ${bft(c.wind_gusts_10m)} Bft`;
    // Pijl wijst met de wind mee (naar waar hij waait): meteo-richting + 180°
    document.getElementById('windPijl').style.transform = `rotate(${c.wind_direction_10m + 180}deg)`;
    w.classList.remove('fout');
    return { kn: c.wind_speed_10m, richting: c.wind_direction_10m, vlagen: c.wind_gusts_10m };
  } catch (e) {
    document.getElementById('windDir').textContent = 'wind niet beschikbaar';
    w.classList.add('fout');
    return null;
  }
}

// --- Baanplanning ----------------------------------------------
// Lengte van de baan in zeemijl: startlijn-midden → boeien → finish-midden
function baanLengteNm(lijnen, boeien) {
  const pts = [];
  if (lijnen.start && lijnen.start.a) pts.push(lijnMidden(lijnen.start));
  boeien.forEach(b => pts.push(b));
  if (lijnen.finish && lijnen.finish.a) pts.push(lijnMidden(lijnen.finish));
  if (pts.length < 2) return null;
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += afstandMeter(pts[i - 1], pts[i]);
  return m / 1852;
}
// Ruwe windcorrectie op de GPH-tijden. GPH is een gemiddelde over
// windsterktes (≈ 12 kn); bij weinig wind duurt alles flink langer.
function windFactor(kn) {
  if (kn == null || isNaN(kn)) return 1;
  const p = [[0, 2.0], [5, 1.6], [8, 1.25], [12, 1.0], [16, 0.9], [20, 0.85], [99, 0.85]];
  for (let i = 1; i < p.length; i++) if (kn <= p[i][0]) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i];
    return y0 + (y1 - y0) * (kn - x0) / (x1 - x0);
  }
  return 0.85;
}
// Verwachte tijd (ms) per boot, en de startvertraging voor een
// achtervolgingsstart: de langzaamste start eerst, de rest schuift op
// zodat iedereen (in theorie) tegelijk finisht.
function maakPlan(nm, windKn) {
  const f = windFactor(windKn);
  const verwacht = {}, vertraging = {};
  Object.keys(BOTEN).forEach(b => { verwacht[b] = Math.round(BOTEN[b].gph * nm * f) * 1000; });
  const traagst = Math.max(...Object.values(verwacht));
  Object.keys(BOTEN).forEach(b => { vertraging[b] = traagst - verwacht[b]; });
  return { nm, windKn: windKn == null ? null : windKn, factor: f, verwacht, vertraging };
}
function vertragingVan(startPlan, boot) {
  return (startPlan && startPlan.modus === 'achtervolging' && startPlan.vertraging && startPlan.vertraging[boot]) || 0;
}

// --- Lusstart: iedereen tegelijk weg, elke boot een eigen lus ---
// Een lus is een paar boeien naast een rak: boei A ligt verderop, boei B
// iets terug. De boot vaart langs de lus naar A, keert terug naar B en gaat
// dan verder naar het volgende punt: een kleine α. Omdat de lus heen en
// terug langs het rak loopt, kost hij bij elke windrichting ongeveer even
// veel. Elke lus maakt de baan precies zo veel langer dat gph × baanlengte
// voor iedereen gelijk is: in theorie finisht de hele vloot tegelijk.
const LUS_RUIMTE_M = 100;          // vrije ruimte rond een lus langs het rak (m)
const lussenVan = sp => (sp && sp.modus === 'lus' && sp.lussen) || null;
// --- Startvoorstel: de wedstrijdleiding stelt een starttijd voor, elke boot geeft akkoord ---
// voorstel = { id, t, plan } (plan = het startPlan dat wordt vastgelegd); akkoord = { boot: voorstel.id }.
// Pas als alle boten akkoord zijn, wordt het raceStart + startPlan; daarna verandert dat niet meer.
const akkoordVan = (voorstel, akkoord) => Object.keys(BOTEN).filter(b => voorstel && akkoord && akkoord[b] === voorstel.id);
const iedereenAkkoord = (voorstel, akkoord) => !!voorstel && akkoordVan(voorstel, akkoord).length === Object.keys(BOTEN).length;
const startNaam = modus => ({ achtervolging: 'Achtervolgingsstart', lus: 'Lusstart' })[modus] || 'Gelijke start';

// Baan van één boot: de gewone boeien (met vaste id en label), bij een
// lusstart met de eigen lus erin. lus.na = id van de boei vóór het rak, of 'start'.
function baanVanBoot(boeien, lussen, boot) {
  const baan = boeien.map((b, i) => Object.assign({}, b, { id: boeiId(b, i), nr: i + 1, label: 'Boei ' + (i + 1) }));
  const lus = lussen && lussen[boot];
  if (!lus) return baan;
  let na = lus.na === 'start' ? 0 : baan.findIndex(b => b.id === lus.na) + 1;
  if (na === 0 && lus.na !== 'start') na = baan.length;          // die boei is weg: de lus vlak voor de finish
  baan.splice(na, 0, ...alsBoeien(lus.boeien).map((b, i) =>
    Object.assign({}, b, { letter: 'AB'[i], label: 'Lusboei ' + 'AB'[i], lus: boot })));
  return baan;
}
// De lus van een boot als lijn: vorige punt → A → B → volgende punt (om te tekenen)
function lusPad(boeien, lijnen, lussen, boot) {
  const baan = baanVanBoot(boeien, lussen, boot), i = baan.findIndex(b => b.lus);
  if (i === -1 || !baan[i + 1]) return null;
  const { prev } = boeiPrevNext(i, baan, lijnen), { next } = boeiPrevNext(i + 1, baan, lijnen);
  return [prev, baan[i], baan[i + 1], next].filter(Boolean);
}

// Lus op het rak P → N met het midden op s meter van P, aan kant +1 (links van
// de vaarrichting) of −1. Zoekt de halve lengte w waarbij de omweg precies
// extraM meter is. De diepte (afstand tot het rak) groeit mee met de lus.
function lusOpRak(P, N, s, kant, extraM) {
  const kx = 111000 * Math.cos(P.lat * Math.PI / 180), ky = 111000;
  const dx = (N.lng - P.lng) * kx, dy = (N.lat - P.lat) * ky, L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L;                                  // langs het rak; links ervan is (−uy, ux)
  const diepte = w => Math.min(250, Math.max(60, w / 2));
  const omweg = w => Math.hypot(s + w, diepte(w)) + 2 * w + Math.hypot(L - s + w, diepte(w)) - L;
  let lo = 0, hi = extraM / 4 + 1;                                 // omweg(w) ≥ 4w, dus w ≤ extraM / 4
  for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (omweg(m) < extraM) lo = m; else hi = m; }
  const w = Math.max(20, lo), h = diepte(w) * kant;
  const punt = x => ({ lat: +(P.lat + (uy * x + ux * h) / ky).toFixed(6), lng: +(P.lng + (ux * x - uy * h) / kx).toFixed(6) });
  return { a: punt(s + w), b: punt(s - w) };
}

// Lussen voor de hele vloot. De langzaamste boot krijgt LUS_MIN_M extra, de
// rest zo veel meer dat gph × baanlengte gelijk is. De grootste lus kiest als
// eerste een rak (het rak met de meeste vrije ruimte); lussen op hetzelfde rak
// liggen achter elkaar, om en om links en rechts.
// Geeft { lussen, extra: {boot: m}, lengte: {boot: zm}, past } of null zonder complete baan.
function maakLusPlan(lijnen, boeien) {
  if (!(lijnen.start && lijnen.start.a && lijnen.finish && lijnen.finish.a)) return null;
  const pts = [lijnMidden(lijnen.start), ...boeien, lijnMidden(lijnen.finish)], raken = [];
  let basisM = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = afstandMeter(pts[i - 1], pts[i]);
    basisM += L;
    if (L > 1) raken.push({ P: pts[i - 1], N: pts[i], L, na: i === 1 ? 'start' : boeiId(boeien[i - 2], i - 2), boten: [] });
  }
  if (!raken.length) return null;
  const traagst = Math.max(...Object.values(BOTEN).map(b => b.gph));
  const extra = {}, ruimte = {}, lengte = {};
  Object.keys(BOTEN).forEach(b => {
    extra[b] = Math.round(traagst / BOTEN[b].gph * (basisM + LUS_MIN_M) - basisM);
    ruimte[b] = extra[b] / 2 + 2 * LUS_RUIMTE_M;                  // een lus is ongeveer extra / 2 lang
    lengte[b] = (basisM + extra[b]) / 1852;
  });
  const vrij = r => r.L - r.boten.reduce((s, b) => s + ruimte[b], 0);
  Object.keys(BOTEN).sort((a, b) => extra[b] - extra[a])
    .forEach(b => raken.reduce((best, r) => vrij(r) > vrij(best) ? r : best).boten.push(b));
  const lussen = {};
  let past = true;
  raken.forEach(r => {
    if (!r.boten.length) return;
    const gat = vrij(r) / (r.boten.length + 1);
    if (gat < 0) past = false;
    let x = 0;
    r.boten.forEach((b, k) => {
      x += gat + ruimte[b] / 2;
      const { a, b: terug } = lusOpRak(r.P, r.N, x, k % 2 ? -1 : 1, extra[b]);
      x += ruimte[b] / 2;
      lussen[b] = { na: r.na, extraM: extra[b],
        boeien: [Object.assign({ id: `lus-${b}-a` }, a), Object.assign({ id: `lus-${b}-b` }, terug)] };
    });
  });
  return { lussen, extra, lengte, past };
}

// --- Geluid (Web Audio — gesynthetiseerd, geen bestanden nodig) ---
let audioCtx = null;
function initAudio() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function _toon(freq, start, duur, vol) {
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(vol, start + 0.01);
  g.gain.setValueAtTime(vol, start + Math.max(0.02, duur - 0.03));
  g.gain.linearRampToValueAtTime(0, start + duur);
  o.connect(g).connect(audioCtx.destination);
  o.start(start); o.stop(start + duur);
}
function speel(noten) {                     // noten = [[freq, duur, offset], ...] of een functie
  initAudio(); if (!audioCtx) return;
  if (typeof noten === 'function') { noten(); return; }
  const t0 = audioCtx.currentTime + 0.02;
  noten.forEach(([f, d, dt]) => _toon(f, t0 + dt, d, 0.3));
}

// --- Kanonschot (startsignalen) ----------------------------------
// Klap + ontploffing + dreun + punch (voor telefoonspeakers) + echo over
// het water, door verzadiging en een limiter: hard, maar zonder kraken.
let _kanonUit = null, _kanonRuis = null;
function _kanonKeten() {
  if (_kanonUit) return _kanonUit;
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5); }
  const klip = audioCtx.createWaveShaper(); klip.curve = curve; klip.oversample = '4x';
  const lim = audioCtx.createDynamicsCompressor();
  lim.threshold.value = -8; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.2;
  _kanonUit = audioCtx.createGain();
  _kanonUit.connect(klip).connect(lim).connect(audioCtx.destination);
  const len = audioCtx.sampleRate * 3;
  _kanonRuis = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = _kanonRuis.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return _kanonUit;
}
function kanonschot(zwaar) {
  initAudio(); if (!audioCtx) return;
  const uit = _kanonKeten(), t0 = audioCtx.currentTime + 0.02, s = zwaar ? 1.25 : 1;
  const omhul = (t, piek, aanval, duur) => {
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(piek, t + aanval);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duur);
    return g;
  };
  const ruis = (t, duur) => {
    const b = audioCtx.createBufferSource(); b.buffer = _kanonRuis; b.start(t, Math.random() * 0.5); b.stop(t + duur);
    return b;
  };
  const filter = (type, f) => { const x = audioCtx.createBiquadFilter(); x.type = type; x.frequency.value = f; return x; };
  const toon = (type, van, naar, sweep, piek, duur) => {
    const o = audioCtx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(van, t0); o.frequency.exponentialRampToValueAtTime(naar, t0 + sweep);
    o.connect(omhul(t0, piek, 0.003, duur)).connect(uit); o.start(t0); o.stop(t0 + duur + 0.05);
  };
  // 1. de klap
  ruis(t0, 0.05).connect(filter('highpass', 400)).connect(omhul(t0, 2 * s, 0.0008, 0.045)).connect(uit);
  // 2. de ontploffing: ruis die snel donker wordt en lang narommelt
  const lp = filter('lowpass', 5000);
  lp.frequency.setValueAtTime(5000, t0);
  lp.frequency.exponentialRampToValueAtTime(700, t0 + 0.08);
  lp.frequency.exponentialRampToValueAtTime(90, t0 + 1.8 * s);
  ruis(t0, 2.4).connect(lp).connect(omhul(t0, 1.3 * s, 0.003, 2.1 * s)).connect(uit);
  // 3. de dreun en 4. de punch
  toon('sine', 110, 30, 0.6, 1.6 * s, 0.95);
  toon('triangle', 260, 65, 0.2, 1.0 * s, 0.32);
  // 5. echo's tegen de kust
  [[0.42, 0.45], [0.95, 0.22]].forEach(([dt, v]) => {
    const t = t0 + dt, e = filter('lowpass', 700);
    ruis(t, 0.9).connect(e).connect(omhul(t, v * s, 0.02, 0.85)).connect(uit);
  });
}

// --- Nautische signalen: scheepsbel, bootsmansfluit, misthoorn ---
// Schone keten (geen verzadiging, wel een limiter), los van de kanonnen.
let _schoonUit = null;
function _schoon() {
  if (_schoonUit) return _schoonUit;
  const lim = audioCtx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.25;
  _schoonUit = audioCtx.createGain(); _schoonUit.gain.value = 0.9;
  _schoonUit.connect(lim).connect(audioCtx.destination);
  return _schoonUit;
}
function _omhul(t, piek, aanval, duur) {
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(piek, t + aanval);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duur);
  return g;
}
// Scheepsbel: klokdeeltonen (niet-harmonisch) die elk in hun eigen tempo uitsterven
function _belslag(t, vol) {
  const uit = _schoon(), f = 880;
  [[0.5, 0.35, 3.2], [1, 1, 2.4], [1.19, 0.55, 1.9], [1.5, 0.45, 1.6], [2, 0.6, 1.3],
   [2.52, 0.3, 0.9], [3.01, 0.22, 0.7], [4.16, 0.14, 0.45], [5.43, 0.08, 0.3]].forEach(([r, a, duur]) => {
    const o = audioCtx.createOscillator(); o.type = 'sine';
    o.frequency.value = f * r * (1 + (Math.random() - 0.5) * 0.002);
    o.connect(_omhul(t, a * vol, 0.002, duur)).connect(uit);
    o.start(t); o.stop(t + duur + 0.05);
  });
  // de tik van de klepel
  const o = audioCtx.createOscillator(); o.type = 'triangle'; o.frequency.value = 3400;
  o.connect(_omhul(t, 0.25 * vol, 0.0005, 0.03)).connect(uit); o.start(t); o.stop(t + 0.05);
}
function scheepsbel(glazen, vol = 0.32) {      // 'glazen' in paren: ding-ding · ding-ding
  initAudio(); if (!audioCtx) return;
  let t = audioCtx.currentTime + 0.02;
  for (let i = 0; i < glazen; i++) { _belslag(t, vol); t += i % 2 === 0 ? 0.32 : 0.85; }
}
// Bootsmansfluit: hoge fluittoon die opzwelt, vasthoudt, trillert en wegzakt
function bootsmansfluit() {
  initAudio(); if (!audioCtx) return;
  const uit = _schoon(), t0 = audioCtx.currentTime + 0.02;
  const o = audioCtx.createOscillator(); o.type = 'sine';
  const f = o.frequency;
  f.setValueAtTime(1500, t0); f.exponentialRampToValueAtTime(2350, t0 + 0.45);
  f.setValueAtTime(2350, t0 + 1.2); f.exponentialRampToValueAtTime(1700, t0 + 1.6);
  f.setValueAtTime(1700, t0 + 1.62); f.exponentialRampToValueAtTime(2350, t0 + 1.75);
  f.setValueAtTime(2350, t0 + 1.95); f.exponentialRampToValueAtTime(1300, t0 + 2.35);
  const vib = audioCtx.createOscillator(), vg = audioCtx.createGain();   // de 'rol' van de fluit
  vib.frequency.value = 23; vg.gain.setValueAtTime(8, t0); vg.gain.setValueAtTime(70, t0 + 0.9); vg.gain.setValueAtTime(10, t0 + 1.2);
  vib.connect(vg).connect(f);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.42, t0 + 0.2);
  g.gain.setValueAtTime(0.42, t0 + 2.1); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
  o.connect(g).connect(uit);
  o.start(t0); o.stop(t0 + 2.45); vib.start(t0); vib.stop(t0 + 2.45);
}
// Misthoorn: lage, brede hoorn (zaagtand + koor, gefilterd), 'stoten' lange stoten
function misthoorn(stoten = 2) {
  initAudio(); if (!audioCtx) return;
  const uit = _schoon();
  let t = audioCtx.currentTime + 0.02;
  for (let s = 0; s < stoten; s++) {
    const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1500, t + 0.25);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.18);
    g.gain.setValueAtTime(0.5, t + 1.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.65);
    lp.connect(g).connect(uit);
    [[196, 'sawtooth', 0.5], [196 * 1.006, 'sawtooth', 0.4], [98, 'square', 0.25], [294, 'sawtooth', 0.15]].forEach(([fr, type, a]) => {
      const o = audioCtx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(fr * 0.94, t); o.frequency.exponentialRampToValueAtTime(fr, t + 0.2);
      const og = audioCtx.createGain(); og.gain.value = a;
      o.connect(og).connect(lp); o.start(t); o.stop(t + 1.7);
    });
    t += 2.1;
  }
}

const GELUID = {
  vijfmin:   () => kanonschot(),               // 5 minuten voor de start
  eenmin:    () => kanonschot(),               // 1 minuut voor de start
  start:     () => kanonschot(true),           // startsein: het zwaarste schot
  startlijn: () => scheepsbel(1),              // over de startlijn: één glas
  boei:      () => scheepsbel(2),              // boei gerond: twee glazen
  finish:    () => bootsmansfluit(),           // finish: alle hens aan dek!
  alarm:     () => misthoorn(2),               // GPS weg / boot offline: de misthoorn
  hersteld:  () => scheepsbel(1, 0.2)          // GPS weer terug: één zachte bel
};

// --- Tijd & afstand netjes weergeven ---------------------------
// milliseconden -> "1:23:45" of "23:45"
function formatDuur(ms) {
  if (ms == null || ms < 0 || isNaN(ms)) return '—';
  const totaal = Math.floor(ms / 1000);
  const u = Math.floor(totaal / 3600);
  const m = Math.floor((totaal % 3600) / 60);
  const s = totaal % 60;
  const pad = n => String(n).padStart(2, '0');
  return u > 0 ? `${u}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
// klokstip (unix ms) -> "14:07:23"
function formatKlok(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('nl-NL', { hour12: false });
}
function klokHM(ts) { return new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }); }
// meters → zeemijl (1 zm = 1852 m): 2 decimalen tot 10 zm, daarboven 1
function formatAfstand(m) {
  const zm = m / 1852;
  return (zm < 10 ? zm.toFixed(2) : zm.toFixed(1)) + ' zm';
}
function geleden(ms) { return ms < 60000 ? Math.round(ms / 1000) + ' s geleden' : Math.round(ms / 60000) + ' min geleden'; }

// Een lange puntenlijst uitdunnen tot max punten (begin en eind blijven)
function dunUit(pts, max) {
  if (pts.length <= max) return pts;
  const stap = (pts.length - 1) / (max - 1), uit = [];
  for (let i = 0; i < max; i++) uit.push(pts[Math.round(i * stap)]);
  return uit;
}
