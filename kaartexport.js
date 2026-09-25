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
// Positie op tijd t (lineair tussen twee punten); null vóór het eerste punt
function positieOp(pts, t) {
  if (!pts.length || t < pts[0][2]) return null;
  if (t >= pts[pts.length - 1][2]) return { lat: pts[pts.length - 1][0], lng: pts[pts.length - 1][1], i: pts.length - 1 };
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][2] <= t) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], f = b[2] > a[2] ? (t - a[2]) / (b[2] - a[2]) : 0;
  return { lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, i: lo };
}

// o = { titel, klok(t) → tekst, sporen: [{kleur, naam, pts, finishS}], baan: {lines, marks} }
// Geeft { canvas, teken(t), eind } terug; de achtergrond wordt één keer geladen.
async function maakScene(o, W = 1600, H = 1200) {
  // De themaletters moeten geladen zijn vóór we op het canvas tekenen
  try { await Promise.all(['40px "Pirata One"', 'bold 20px Cinzel', 'bold 20px "EB Garamond"', 'italic 18px "EB Garamond"']
    .map(f => document.fonts.load(f))); } catch (e) {}
  const KOP = Math.round(H * 0.092), VOET = 40, RAND = 60, kaartH = H - KOP - VOET;
  const lijnen = (o.baan && o.baan.lines) || {};
  const boeien = alsBoeien(o.baan && o.baan.marks);
  const alle = [];
  o.sporen.forEach(s => s.pts.forEach(p => alle.push(p)));
  ['start', 'finish'].forEach(t => { const l = lijnen[t]; if (l && l.a) alle.push([l.a.lat, l.a.lng], [l.b.lat, l.b.lng]); });
  boeien.forEach(b => alle.push([b.lat, b.lng]));
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
    omlijnd(a, tekst, (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 - 16, kleur, 'bold 20px Cinzel, Georgia, serif', 'center');
  });
  boeien.forEach((bo, i) => {
    const [x, y] = xy(bo.lat, bo.lng);
    a.beginPath(); a.arc(x, y, 16, 0, 2 * Math.PI); a.fillStyle = '#d98b2b'; a.fill();
    a.lineWidth = 3; a.strokeStyle = '#2b1b0d'; a.stroke();
    a.fillStyle = '#2b1b0d'; a.font = 'bold 17px Cinzel, Georgia, serif';
    a.textAlign = 'center'; a.textBaseline = 'middle'; a.fillText(String(i + 1), x, y + 1);
  });
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
    sporen.forEach(s => {
      const p = positieOp(s.pts, t);
      if (!p) return;
      const kop = xy(p.lat, p.lng);
      const deel = s.px.slice(0, p.i + 1).concat([kop]);
      if (deel.length > 1) {
        g.lineWidth = 9; g.strokeStyle = 'rgba(0,0,0,.5)'; pad(g, deel);
        g.lineWidth = 5; g.strokeStyle = s.kleur; pad(g, deel);
      }
      // koers: richting vanaf een punt minstens 8 m terug in het spoor
      let koers = null;
      for (let j = p.i; j >= Math.max(0, p.i - 15) && koers == null; j--)
        koers = koersUitBeweging({ lat: s.pts[j][0], lng: s.pts[j][1] }, { lat: p.lat, lng: p.lng }, 8);
      if (koers != null) s.laatsteKoers = koers;
      tekenSchipCanvas(g, kop[0], kop[1], s.laatsteKoers || 0, s.boot, 5);   // zelfde model en schaal als op de kaart
      omlijnd(g, s.naam, kop[0] + 30, kop[1] - 18, '#fff', 'bold 21px "EB Garamond", Georgia, serif', 'left');
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
    const regels = sporen.map(s => ({ kleur: s.kleur, tekst: (s.finishS != null && t >= s.finishS ? '🏁 ' : '') + s.legenda }));
    const bw = Math.max(...regels.map(r => g.measureText(r.tekst).width)) + 74;
    const bh = regels.length * 34 + 20, bx = W - bw - 22, by = KOP + 18;
    g.fillStyle = 'rgba(26,18,11,.93)'; rondeRect(g, bx, by, bw, bh, 8); g.fill();
    g.lineWidth = 2; g.strokeStyle = '#c9a24a'; g.stroke();
    regels.forEach((r, i) => {
      const y = by + 32 + i * 34;
      g.fillStyle = r.kleur; g.fillRect(bx + 16, y - 12, 34, 8);
      g.fillStyle = '#efe3c6'; g.fillText(r.tekst, bx + 60, y);
    });
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
