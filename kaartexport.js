// ============================================================
//  Zeilrace — race-weergave op een canvas: foto (PNG) en video
//  Tekent de OpenStreetMap-achtergrond, de baan en de gevaren lijnen
//  tot een willekeurig moment t. Geen extra bibliotheken nodig.
// ============================================================

// Spoor = [[lat, lng, s], ...] met s = seconden sinds het begin van de opname.
// Oude sporen zonder tijd krijgen hun volgnummer als tijd.
function normaliseerSpoor(v) {
  const pts = (Array.isArray(v) ? v : Object.values(v || {})).map((p, i) =>
    [Number(p[0]), Number(p[1]), p[2] != null ? Number(p[2]) : i]);
  return pts.filter(p => !isNaN(p[0]) && !isNaN(p[1])).sort((a, b) => a[2] - b[2]);
}
// Rustige koers op tijd t (graden): de richting van waar de boot w seconden eerder was naar
// waar hij w seconden later is. Dat middelt GPS-ruis weg maar volgt een overstag wel. Ligt de
// boot (bijna) stil, dan een groter venster, en anders de vorige koers.
function koersOp(pts, t, vorige = null) {
  if (!pts.length) return vorige;
  const eerste = { lat: pts[0][0], lng: pts[0][1] }, laatste = { lat: pts[pts.length - 1][0], lng: pts[pts.length - 1][1] };
  for (const w of [20, 45, 90]) {
    const a = positieOp(pts, t - w) || eerste, b = positieOp(pts, t + w) || laatste;
    if (afstandMeter(a, b) >= 12) return peiling(a, b);
  }
  return vorige;
}
// GPS-uitschieters weghalen: een punt dat de boot alleen met meer dan MAX_KN (plus wat
// GPS-marge) had kunnen halen, is een meetfout. Eerst een betrouwbaar beginpunt zoeken
// (een punt dat past bij de drie volgende), dan vanaf daar vooruit en achteruit alleen
// punten houden die haalbaar zijn vanaf het laatst gehouden punt.
const UITSCHIETER_MAX_KN = 20, UITSCHIETER_MARGE_M = 30;
function zonderUitschieters(pts) {
  if (pts.length < 3) return pts;
  const haalbaar = (a, b) => afstandMeter({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) <=
    Math.abs(b[2] - a[2]) * UITSCHIETER_MAX_KN / 1.94384 + UITSCHIETER_MARGE_M;
  let anker = pts.findIndex((p, i) => [1, 2, 3].every(k => !pts[i + k] || haalbaar(p, pts[i + k])));
  if (anker < 0) anker = 0;
  const voor = [], na = [pts[anker]];
  for (let i = anker + 1; i < pts.length; i++) if (haalbaar(na[na.length - 1], pts[i])) na.push(pts[i]);
  for (let i = anker - 1; i >= 0; i--) if (haalbaar(pts[i], voor.length ? voor[0] : pts[anker])) voor.unshift(pts[i]);
  return voor.concat(na);
}
// Positie op tijd t (lineair tussen twee punten); null vóór het eerste punt
function positieOp(pts, t) {
  if (!pts.length || t < pts[0][2]) return null;
  if (t >= pts[pts.length - 1][2]) return { lat: pts[pts.length - 1][0], lng: pts[pts.length - 1][1], i: pts.length - 1 };
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][2] <= t) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], f = b[2] > a[2] ? (t - a[2]) / (b[2] - a[2]) : 0;
  return { lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, i: lo };
}

// Overstagmomenten in een spoor [[lat, lng, s]] tussen van en tot (s): een blijvende
// koerswijziging van minstens 55°, met een stabiele koers in de minuut ervoor én erna
// (zo tellen GPS-ruis en een korte zwieper niet mee). Geeft [{lat, lng, s, hoek}].
// Zonder winddata is een gijp niet van een overstag te onderscheiden; aan de wind
// (kruisen) zijn het vrijwel altijd overstagmomenten.
function overstagHoeken(pts, van = -Infinity, tot = Infinity) {
  const p = pts.filter(q => q[2] >= van - 90 && q[2] <= tot + 90);
  if (p.length < 10) return [];
  // koers over de grond tussen punten die minstens 20 m uit elkaar liggen
  const koersen = [];
  for (let a = 0, i = 1; i < p.length; i++) {
    const A = { lat: p[a][0], lng: p[a][1] }, B = { lat: p[i][0], lng: p[i][1] };
    if (afstandMeter(A, B) >= 20) { koersen.push({ s: (p[a][2] + p[i][2]) / 2, k: peiling(A, B), lat: A.lat, lng: A.lng }); a = i; }
  }
  const rad = Math.PI / 180;
  const gemiddeld = (lo, hi) => {                    // gemiddelde koers + hoe stabiel (R: 1 = recht)
    let x = 0, y = 0, n = 0;
    koersen.forEach(c => { if (c.s >= lo && c.s <= hi) { x += Math.cos(c.k * rad); y += Math.sin(c.k * rad); n++; } });
    return n < 2 ? null : { k: (Math.atan2(y, x) / rad + 360) % 360, R: Math.hypot(x, y) / n };
  };
  const verschil = (a, b) => Math.abs(((b - a + 540) % 360) - 180);
  const uit = [];
  koersen.forEach(c => {
    if (c.s < van || c.s > tot) return;
    const voor = gemiddeld(c.s - 75, c.s - 12), na = gemiddeld(c.s + 12, c.s + 75);
    if (!voor || !na || voor.R < 0.9 || na.R < 0.9) return;
    const hoek = verschil(voor.k, na.k);
    if (hoek < 55) return;
    const vorige = uit[uit.length - 1];            // binnen een minuut: hetzelfde overstagmoment
    if (vorige && c.s - vorige.s < 60) { if (hoek > vorige.hoek) Object.assign(vorige, { lat: c.lat, lng: c.lng, hoek, voor: voor.k, na: na.k }); }
    else uit.push({ lat: c.lat, lng: c.lng, s: c.s, hoek, voor: voor.k, na: na.k });   // voor/na: koers vóór en na (°)
  });
  return uit.map(k => Object.assign(k, { hoek: Math.round(k.hoek) }));
}

// Snelheid (kn) bij elk punt van een spoor [[lat, lng, s]], gemiddeld over ±venster
// seconden (tegen GPS-ruis). Null waar te weinig punten zijn.
function snelheidsSpoor(pts, venster = 10) {
  const v = new Array(pts.length).fill(null);
  for (let i = 0, a = 0, b = 0; i < pts.length; i++) {
    while (pts[a][2] < pts[i][2] - venster) a++;
    if (b < i) b = i;
    while (b + 1 < pts.length && pts[b + 1][2] <= pts[i][2] + venster) b++;
    const dt = pts[b][2] - pts[a][2];
    if (dt >= 5) v[i] = afstandMeter({ lat: pts[a][0], lng: pts[a][1] }, { lat: pts[b][0], lng: pts[b][1] }) / dt * 1.94384;
  }
  return v;
}
// Kleur bij een snelheid op schaal 0 (langzaam, blauw) … 1 (snel, rood)
function snelheidKleur(f) {
  const stops = [[0, [44, 111, 187]], [.25, [63, 167, 201]], [.5, [232, 195, 58]], [.75, [224, 123, 44]], [1, [192, 57, 43]]];
  f = Math.max(0, Math.min(1, f));
  let i = 0; while (i < stops.length - 2 && f > stops[i + 1][0]) i++;
  const [f0, c0] = stops[i], [f1, c1] = stops[i + 1], r = (f - f0) / (f1 - f0);
  return 'rgb(' + c0.map((c, k) => Math.round(c + (c1[k] - c) * r)).join(',') + ')';
}

// o = { titel, klok(t) → tekst, sporen: [{kleur, naam, pts, finishS}], baan: {lines, marks}, lussen,
//       snelheid?: { lo, hi } (kn) → sporen in snelheidskleur, met de legenda linksonder,
//       wind?: t → { kn, richting }, schipStijl?: 'kaart' | 'piraat',
//       extraPunten?: [[lat, lng]] (moeten ook in beeld), tekenExtra?: (g, xy, t) onder de schepen,
//       legenda?: t → [{ kleur, tekst }] (in plaats van de vaste legenda) }
// Geeft { canvas, teken(t), eind } terug; de achtergrond wordt één keer geladen.
async function maakScene(o, W = 1600, H = 1200) {
  // De themaletters moeten geladen zijn vóór we op het canvas tekenen
  try { await Promise.all(['40px "Pirata One"', 'bold 20px Cinzel', 'bold 20px "EB Garamond"', 'italic 18px "EB Garamond"']
    .map(f => document.fonts.load(f))); } catch (e) {}
  const KOP = Math.round(H * 0.092), VOET = 40, RAND = 60, kaartH = H - KOP - VOET;
  const lijnen = (o.baan && o.baan.lines) || {};
  const boeien = alsBoeien(o.baan && o.baan.marks);
  const lusPaden = o.lussen ? Object.keys(BOTEN).map(b => ({ b, pad: lusPad(boeien, lijnen, o.lussen, b) })).filter(x => x.pad) : [];
  const alle = [];
  o.sporen.forEach(s => s.pts.forEach(p => alle.push(p)));
  ['start', 'finish'].forEach(t => { const l = lijnen[t]; if (l && l.a) alle.push([l.a.lat, l.a.lng], [l.b.lat, l.b.lng]); });
  boeien.forEach(b => alle.push([b.lat, b.lng]));
  lusPaden.forEach(x => x.pad.forEach(p => alle.push([p.lat, p.lng])));
  (o.extraPunten || []).forEach(p => alle.push(p));
  if (!alle.length) return null;
  const eind = Math.max(0, ...o.sporen.map(s => s.pts.length ? s.pts[s.pts.length - 1][2] : 0));

  // Web-Mercator: wereldpixels bij zoomniveau z; hoogste zoom waarop alles past
  const wp = (lat, lng, z) => {
    const n = 256 * 2 ** z, s = Math.sin(lat * Math.PI / 180);
    return { x: (lng + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
  };
  let z = 17, b;
  for (; z >= 3; z--) {
    const ps = alle.map(p => wp(p[0], p[1], z));
    b = { x0: Math.min(...ps.map(p => p.x)), x1: Math.max(...ps.map(p => p.x)),
          y0: Math.min(...ps.map(p => p.y)), y1: Math.max(...ps.map(p => p.y)) };
    if (b.x1 - b.x0 <= W - 2 * RAND && b.y1 - b.y0 <= kaartH - 2 * RAND) break;
  }
  const ox = (b.x0 + b.x1) / 2 - W / 2, oy = (b.y0 + b.y1) / 2 - kaartH / 2;
  const xy = (lat, lng) => { const p = wp(lat, lng, z); return [p.x - ox, p.y - oy + KOP]; };
  const sporen = o.sporen.map(s => Object.assign({}, s, { px: s.pts.map(p => xy(p[0], p[1])) }));
  // snelheid in kleur: per stukje spoor een kleur (gemiddelde van de twee punten)
  const sn = o.snelheid;
  if (sn) sporen.forEach(s => {
    const v = snelheidsSpoor(s.pts);
    s.stukKleur = s.pts.map((_, i) => {
      if (!i) return null;
      const x = v[i] != null && v[i - 1] != null ? (v[i] + v[i - 1]) / 2 : (v[i] != null ? v[i] : v[i - 1]);
      return x == null ? '#8e7550' : snelheidKleur((x - sn.lo) / Math.max(.1, sn.hi - sn.lo));
    });
  });

  // ---- Achtergrond (tegels + baan), één keer ----
  const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  const a = bg.getContext('2d');
  a.fillStyle = '#1a120b'; a.fillRect(0, 0, W, H);
  a.save(); a.beginPath(); a.rect(0, KOP, W, kaartH); a.clip();
  a.filter = 'sepia(.6) saturate(.75) hue-rotate(-10deg) contrast(1.03) brightness(.96)';   // oude zeekaart
  const n = 2 ** z, taken = [];
  for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++) {
    for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + kaartH) / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      taken.push(laadTegel(z, ((tx % n) + n) % n, ty).then(img => { if (img) a.drawImage(img, tx * 256 - ox, ty * 256 - oy + KOP); }));
    }
  }
  await Promise.all(taken);
  a.filter = 'none';
  a.fillStyle = 'rgba(60,35,10,.10)'; a.fillRect(0, KOP, W, kaartH);   // lichte waas: lijnen vallen beter op
  const route = [];
  if (lijnen.start && lijnen.start.a) { const m = lijnMidden(lijnen.start); route.push(xy(m.lat, m.lng)); }
  boeien.forEach(bo => route.push(xy(bo.lat, bo.lng)));
  if (lijnen.finish && lijnen.finish.a) { const m = lijnMidden(lijnen.finish); route.push(xy(m.lat, m.lng)); }
  if (route.length >= 2) { a.setLineDash([6, 12]); a.lineWidth = 2.5; a.strokeStyle = 'rgba(43,27,13,.85)'; pad(a, route); a.setLineDash([]); }
  [['start', '#2ea043', 'START'], ['finish', '#e6194b', 'FINISH']].forEach(([t, kleur, tekst]) => {
    const l = lijnen[t]; if (!l || !l.a) return;
    const p1 = xy(l.a.lat, l.a.lng), p2 = xy(l.b.lat, l.b.lng);
    a.setLineDash([16, 10]); a.lineWidth = 6; a.strokeStyle = kleur; pad(a, [p1, p2]); a.setLineDash([]);
    [p1, p2].forEach(([x, y]) => {                                   // duidelijke uiteinden
      a.beginPath(); a.arc(x, y, 10, 0, 2 * Math.PI); a.fillStyle = kleur; a.fill();
      a.lineWidth = 3; a.strokeStyle = '#2b1b0d'; a.stroke();
    });
    omlijnd(a, tekst, (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 - 16, kleur, 'bold 20px Cinzel, Georgia, serif', 'center');
  });
  const boeiRondje = (x, y, r, kleur, tekst, tekstKleur) => {
    a.beginPath(); a.arc(x, y, r, 0, 2 * Math.PI); a.fillStyle = kleur; a.fill();
    a.lineWidth = 3; a.strokeStyle = '#2b1b0d'; a.stroke();
    a.fillStyle = tekstKleur; a.font = `bold ${Math.round(r * 1.05)}px Cinzel, Georgia, serif`;
    a.textAlign = 'center'; a.textBaseline = 'middle'; a.fillText(tekst, x, y + 1);
  };
  // Lusstart: per boot een lijn in de bootkleur door de eigen lus
  lusPaden.forEach(({ b, pad: lp }) => {
    a.setLineDash([4, 9]); a.lineWidth = 3; a.strokeStyle = BOTEN[b].kleur; pad(a, lp.map(p => xy(p.lat, p.lng))); a.setLineDash([]);
  });
  boeien.forEach((bo, i) => { const [x, y] = xy(bo.lat, bo.lng); boeiRondje(x, y, 16, '#d98b2b', String(i + 1), '#2b1b0d'); });
  lusPaden.forEach(({ b, pad: lp }) => lp.filter(p => p.lus).forEach(p => {
    const [x, y] = xy(p.lat, p.lng); boeiRondje(x, y, 13, BOTEN[b].kleur, p.letter, '#fff');
  }));
  a.restore();
  a.textBaseline = 'alphabetic';
  a.fillStyle = '#1a120b'; a.fillRect(0, 0, W, KOP); a.fillRect(0, H - VOET, W, VOET);
  a.fillStyle = '#c9a24a'; a.fillRect(0, KOP - 3, W, 3); a.fillRect(0, H - VOET, W, 3);   // messing randen
  a.fillStyle = '#bfae88'; a.font = 'italic 18px "EB Garamond", Georgia, serif'; a.textAlign = 'left';
  a.fillText('Kaart © OpenStreetMap-bijdragers · Zeilrace', 30, H - 13);

  // ---- Frame op tijd t ----
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  function teken(t) {
    g.drawImage(bg, 0, 0);
    g.save(); g.beginPath(); g.rect(0, KOP, W, kaartH); g.clip();
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (o.tekenExtra) { g.save(); o.tekenExtra(g, xy, t); g.restore(); g.lineJoin = 'round'; g.lineCap = 'round'; }
    sporen.forEach(s => {
      const p = positieOp(s.pts, t);
      if (!p) return;
      const kop = xy(p.lat, p.lng);
      const deel = s.px.slice(0, p.i + 1).concat([kop]);
      if (deel.length > 1 && s.stukKleur) {
        // snelheid in kleur: de bootkleur als brede rand, daarop elk stukje in zijn snelheidskleur
        g.lineWidth = 13; g.strokeStyle = 'rgba(0,0,0,.5)'; pad(g, deel);
        g.lineWidth = 10; g.strokeStyle = s.kleur; pad(g, deel);
        g.lineWidth = 5;
        for (let i = 1; i < deel.length; i++) {
          g.strokeStyle = s.stukKleur[Math.min(i, s.stukKleur.length - 1)] || '#8e7550';
          pad(g, [deel[i - 1], deel[i]]);
        }
      } else if (deel.length > 1) {
        g.lineWidth = 9; g.strokeStyle = 'rgba(0,0,0,.5)'; pad(g, deel);
        g.lineWidth = 5; g.strokeStyle = s.kleur; pad(g, deel);
      }
      // rustige koers (zie koersOp), en een kleiner schip dan live: het spoor moet zichtbaar blijven
      s.laatsteKoers = koersOp(s.pts, t, s.laatsteKoers);
      tekenSchipCanvas(g, kop[0], kop[1], s.laatsteKoers || 0, s.boot, 3, o.schipStijl || 'kaart');
      omlijnd(g, s.naam, kop[0] + 22, kop[1] - 14, '#fff', 'bold 21px "EB Garamond", Georgia, serif', 'left');
    });
    g.restore();
    // Kop: titel + klok
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#f0c75e'; g.font = `${Math.round(KOP * 0.48)}px "Pirata One", Georgia, serif`;
    g.fillText(o.titel, 30, KOP * 0.5);
    g.fillStyle = '#bfae88'; g.font = `bold ${Math.round(KOP * 0.22)}px Cinzel, Georgia, serif`;
    g.fillText(o.klok ? o.klok(t) : '', 32, KOP * 0.86);
    // Legenda rechtsboven op de kaart
    g.font = 'bold 22px "EB Garamond", Georgia, serif';
    const regels = o.legenda ? o.legenda(t)
      : sporen.map(s => ({ kleur: s.kleur, tekst: (s.finishS != null && t >= s.finishS ? '🏁 ' : '') + s.legenda }));
    const bw = Math.max(...regels.map(r => g.measureText(r.tekst).width)) + 74;
    const bh = regels.length * 34 + 20, bx = W - bw - 22, by = KOP + 18;
    g.fillStyle = 'rgba(26,18,11,.93)'; rondeRect(g, bx, by, bw, bh, 8); g.fill();
    g.lineWidth = 2; g.strokeStyle = '#c9a24a'; g.stroke();
    regels.forEach((r, i) => {
      const y = by + 32 + i * 34;
      g.fillStyle = r.kleur; g.fillRect(bx + 16, y - 12, 34, 8);
      g.fillStyle = '#efe3c6'; g.fillText(r.tekst, bx + 60, y);
    });
    if (sn) tekenSnelheidLegenda();
    if (o.wind) tekenWind(o.wind(t));
  }
  // Wind rechtsonder op de kaart: een pijl die met de wind meewijst, en kracht en richting
  function tekenWind(w) {
    if (!w) return;
    const tekst = `${bft(w.kn)} Bft uit ${kompas(w.richting)}`, f = 'bold 19px "EB Garamond", Georgia, serif';
    g.font = f; const bw = 70 + g.measureText(tekst).width + 18, bh = 54, bx = W - bw - 22, by = H - VOET - bh - 18;
    g.fillStyle = 'rgba(26,18,11,.93)'; rondeRect(g, bx, by, bw, bh, 8); g.fill();
    g.lineWidth = 2; g.strokeStyle = '#c9a24a'; g.stroke();
    g.save(); g.translate(bx + 34, by + bh / 2); g.rotate((w.richting + 180) * Math.PI / 180);   // wijst met de wind mee
    g.beginPath(); g.moveTo(0, -18); g.lineTo(9, 6); g.lineTo(2, 2); g.lineTo(2, 16); g.lineTo(-2, 16); g.lineTo(-2, 2); g.lineTo(-9, 6); g.closePath();
    g.fillStyle = '#f0c75e'; g.fill(); g.restore();
    g.fillStyle = '#efe3c6'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(tekst, bx + 64, by + bh / 2);
    g.textBaseline = 'alphabetic';
  }
  // Legenda van de snelheidskleuren, linksonder op de kaart (zelfde kleuren als op het scherm)
  function tekenSnelheidLegenda() {
    // breedtes uit de echte tekstmaten, zodat niets over elkaar valt
    const titel = 'Snelheid', lo = sn.lo.toFixed(1) + ' kn', hi = sn.hi.toFixed(1) + ' kn';
    const fTitel = 'bold 18px Cinzel, Georgia, serif', fGetal = 'bold 17px "EB Garamond", Georgia, serif';
    g.font = fTitel; const wT = g.measureText(titel).width;
    g.font = fGetal; const wLo = g.measureText(lo).width, wHi = g.measureText(hi).width;
    const PAD = 16, GAT = 12, BALK = 170, bh = 54;
    const bw = PAD + wT + 2 * GAT + wLo + GAT + BALK + GAT + wHi + PAD, bx = 22, by = H - VOET - bh - 18, my = by + bh / 2;
    g.fillStyle = 'rgba(26,18,11,.93)'; rondeRect(g, bx, by, bw, bh, 8); g.fill();
    g.lineWidth = 2; g.strokeStyle = '#c9a24a'; g.stroke();
    g.textBaseline = 'middle'; g.textAlign = 'left';
    let x = bx + PAD;
    g.fillStyle = '#f0c75e'; g.font = fTitel; g.fillText(titel, x, my); x += wT + 2 * GAT;
    g.fillStyle = '#efe3c6'; g.font = fGetal; g.fillText(lo, x, my); x += wLo + GAT;
    const verloop = g.createLinearGradient(x, 0, x + BALK, 0);
    [0, .25, .5, .75, 1].forEach(f => verloop.addColorStop(f, snelheidKleur(f)));
    g.fillStyle = verloop; rondeRect(g, x, my - 7, BALK, 14, 7); g.fill();
    g.lineWidth = 1.5; g.strokeStyle = '#8a6a2b'; g.stroke(); x += BALK + GAT;
    g.fillStyle = '#efe3c6'; g.fillText(hi, x, my);
    g.textBaseline = 'alphabetic';
  }
  return { canvas: cv, teken, eind };

  function pad(c, pts) { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke(); }
  function omlijnd(c, t, x, y, kleur, font, uitlijn) {
    c.font = font; c.textAlign = uitlijn; c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,.75)';
    c.strokeText(t, x, y); c.fillStyle = kleur; c.fillText(t, x, y);
  }
  function rondeRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
}

// Foto (PNG) van moment t (standaard: het einde)
async function maakKaartPNG(o, t) {
  const s = await maakScene(o);
  if (!s) return null;
  s.teken(t == null ? s.eind : t);
  return new Promise(res => s.canvas.toBlob(res, 'image/png'));
}

// Video (MP4 als de browser dat kan, anders WebM) van de hele race
function videoFormaat() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || null;
}
async function maakRaceVideo(o, voortgang) {
  const mime = videoFormaat();
  if (!mime) throw new Error('Deze browser kan geen video opnemen.');
  const s = await maakScene(o, 1280, 960);
  if (!s) return null;
  const duurMs = Math.min(25000, Math.max(8000, s.eind * 12));   // hele race in 8–25 seconden
  const stroom = s.canvas.captureStream(30);
  const rec = new MediaRecorder(stroom, { mimeType: mime, videoBitsPerSecond: 5e6 });
  const stukken = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) stukken.push(e.data); };
  const gestopt = new Promise(res => { rec.onstop = res; });
  s.teken(0);
  rec.start(250);
  await new Promise(res => {
    const begin = performance.now();
    (function stap(nu) {
      const f = Math.min(1, (nu - begin) / duurMs);
      s.teken(f * s.eind);
      if (voortgang) voortgang(f);
      if (f < 1) requestAnimationFrame(stap);
      else setTimeout(res, 1200);                                 // eindbeeld even laten staan
    })(begin);
  });
  rec.stop();
  await gestopt;
  return { blob: new Blob(stukken, { type: mime.split(';')[0] }), ext: mime.includes('mp4') ? 'mp4' : 'webm' };
}

// ---- Geanimeerde GIF (eigen encoder: geen extra bibliotheek nodig) ----
// Eén kleurenpalet voor de hele GIF (uit het eerste beeld, plus de bootkleuren), en elk volgend
// beeld bevat alleen het stukje dat veranderde: zo blijft het bestand klein. Loopt eindeloos rond.
// duurS = lengte van de animatie, fps = beelden per seconde. voortgang(f) met f = 0…1.
async function maakRaceGif(o, voortgang, duurS = 15, fps = 10) {
  // op de gewone maat tekenen (dan klopt de opmaak) en verkleinen tot 800 × 600
  const s = await maakScene(o);
  if (!s) return null;
  const W = 800, H = 600, klein = document.createElement('canvas'); klein.width = W; klein.height = H;
  const ctx = klein.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  const n = Math.max(2, Math.round(duurS * fps)), vertraging = Math.round(100 / fps);
  const beeld = t => { s.teken(t); ctx.drawImage(s.canvas, 0, 0, W, H); return ctx.getImageData(0, 0, W, H).data; };

  // Palet: median cut over het eerste en het laatste beeld (de meeste kleuren), plus de bootkleuren exact
  const vaste = [[26, 18, 11], [240, 199, 94], [239, 227, 198], [0, 0, 0], [255, 255, 255]]
    .concat(Object.values(BOTEN).map(b => hexNaarRgb(b.kleur)));
  // kleur 255 is 'doorzichtig': een pixel die niet veranderde (comprimeert heel goed)
  const DOOR = 255;
  const palet = medianCut([beeld(s.eind), beeld(0)], DOOR - vaste.length).concat(vaste).slice(0, DOOR);
  while (palet.length < 256) palet.push([0, 0, 0]);
  const cache = new Int16Array(32768).fill(-1);
  const index = (r, g, b) => {
    const k = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    if (cache[k] >= 0) return cache[k];
    let beste = 0, bd = Infinity;
    for (let i = 0; i < DOOR; i++) { const p = palet[i], d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < bd) { bd = d; beste = i; } }
    return (cache[k] = beste);
  };

  const uit = [];
  const bytes = a => a.forEach(x => uit.push(x));
  const woord = v => bytes([v & 255, (v >> 8) & 255]);
  bytes([...'GIF89a'].map(c => c.charCodeAt(0))); woord(W); woord(H); bytes([0xF7, 0, 0]);
  palet.forEach(p => bytes(p));
  bytes([0x21, 0xFF, 0x0B, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 0x03, 0x01, 0, 0, 0]);   // eindeloos herhalen

  let vorige = null;
  for (let f = 0; f < n; f++) {
    const px = beeld(f / (n - 1) * s.eind), idx = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < idx.length; i++, j += 4) idx[i] = index(px[j], px[j + 1], px[j + 2]);
    // alleen het veranderde stukje (het eerste beeld helemaal)
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (vorige) {
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0, i = y * W; x < W; x++, i++)
        if (idx[i] !== vorige[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) { x0 = y0 = x1 = y1 = 0; }                        // niets veranderd: één pixel
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, deel = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y0 + y) * W + x0 + x;
      deel[y * w + x] = vorige && idx[i] === vorige[i] ? DOOR : idx[i];   // onveranderd: doorzichtig
    }
    const laatste = f === n - 1;
    // beeld laten staan (disposal 1) met doorzichtige kleur 255; eindbeeld 3 s
    bytes([0x21, 0xF9, 0x04, vorige ? 0x05 : 0x04]); woord(laatste ? 300 : vertraging); bytes([DOOR, 0]);
    bytes([0x2C]); woord(x0); woord(y0); woord(w); woord(h); bytes([0]);
    bytes([8]);
    const data = gifLzw(deel, 8);
    for (let i = 0; i < data.length; i += 255) { const blok = data.slice(i, i + 255); uit.push(blok.length); bytes(blok); }
    uit.push(0);
    vorige = idx;
    if (voortgang) voortgang((f + 1) / n);
    await new Promise(r => setTimeout(r, 0));                       // de pagina laten ademen
  }
  uit.push(0x3B);
  return new Blob([new Uint8Array(uit)], { type: 'image/gif' });
}
function hexNaarRgb(h) { const v = parseInt(h.replace('#', ''), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; }
// Median cut: de kleuren van een paar beelden in 'aantal' groepen, het gemiddelde per groep
function medianCut(beelden, aantal) {
  const px = [];
  beelden.forEach(d => { for (let i = 0; i < d.length; i += 4 * 7) px.push([d[i], d[i + 1], d[i + 2]]); });
  let dozen = [px];
  while (dozen.length < aantal) {
    let bi = -1, bk = 0, br = -1;
    dozen.forEach((d, i) => {
      if (d.length < 2) return;
      for (let k = 0; k < 3; k++) {
        let lo = 255, hi = 0; d.forEach(p => { if (p[k] < lo) lo = p[k]; if (p[k] > hi) hi = p[k]; });
        if (hi - lo > br) { br = hi - lo; bi = i; bk = k; }
      }
    });
    if (bi < 0 || br <= 0) break;
    const d = dozen[bi].sort((a, b) => a[bk] - b[bk]), m = d.length >> 1;
    dozen.splice(bi, 1, d.slice(0, m), d.slice(m));
  }
  return dozen.filter(d => d.length).map(d => [0, 1, 2].map(k => Math.round(d.reduce((s, p) => s + p[k], 0) / d.length)));
}
// LZW-compressie voor GIF (variabele codelengte, wissen bij een volle tabel)
function gifLzw(index, minCode) {
  const wis = 1 << minCode, einde = wis + 1, uit = [];
  let volgende = einde + 1, lengte = minCode + 1, buf = 0, bits = 0, tabel = new Map();
  const schrijf = c => { buf |= c << bits; bits += lengte; while (bits >= 8) { uit.push(buf & 255); buf >>>= 8; bits -= 8; } };
  schrijf(wis);
  let voor = index[0];
  for (let i = 1; i < index.length; i++) {
    const k = index[i], sleutel = voor << 8 | k, c = tabel.get(sleutel);
    if (c !== undefined) { voor = c; continue; }
    schrijf(voor);
    if (volgende === 4096) { schrijf(wis); volgende = einde + 1; lengte = minCode + 1; tabel = new Map(); }
    else { if (volgende >= (1 << lengte)) lengte++; tabel.set(sleutel, volgende++); }
    voor = k;
  }
  schrijf(voor); schrijf(einde);
  if (bits > 0) uit.push(buf & 255);
  return uit;
}

function laadTegel(z, x, y) {
  return new Promise(res => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => res(null), 8000);
    img.onload = () => { clearTimeout(t); res(img); };
    img.onerror = () => { clearTimeout(t); res(null); };
    img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  });
}

function downloadBlob(blob, naam) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = naam;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
