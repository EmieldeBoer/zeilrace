// ============================================================
//  Zeilrace — sporen en replay-hulpmiddelen, en de export (foto, video, GIF):
//  de replaykaart zoals hij op het scherm staat wordt op een canvas getekend.
//  Geen extra bibliotheken nodig (ook de GIF-encoder zit hierin).
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

// ============================================================
//  De replaykaart zoals hij op het scherm staat op een canvas tekenen (voor foto,
//  video en GIF): de tegels (met hun sepiafilter), de SVG-laag (sporen, lijnen,
//  cirkels, waaiers, kogels), de markers (schepen, boeien, kisten, emoji), de labels
//  en de kaders (wind, snelheid, schaal). Zo ziet de export er precies uit als de replay.
//  De knoppen op de kaart (zoom, meten) worden niet meegetekend.
// ============================================================
const svgBeelden = new WeakMap();                   // svg-element → { html, img } (schepen veranderen zelden)
async function svgAlsBeeld(svg) {
  const kopie = svg.cloneNode(true);
  kopie.removeAttribute('style');                   // Leaflets plaatsing (transform) niet meenemen
  kopie.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!kopie.getAttribute('width')) {
    const r = svg.getBoundingClientRect(); kopie.setAttribute('width', r.width); kopie.setAttribute('height', r.height);
  }
  const html = new XMLSerializer().serializeToString(kopie), oud = svgBeelden.get(svg);
  if (oud && oud.html === html) return oud.img;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(html);
  await img.decode();
  svgBeelden.set(svg, { html, img });
  return img;
}
const kleurenIn = s => (s && s.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}\b/gi)) || [];
function rondPad(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
const lettertype = cs => `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
function draaiingVan(cs) {
  const m = cs.transform && cs.transform.match(/matrix\(([^)]+)\)/);
  if (!m) return 0;
  const [a, b] = m[1].split(',').map(Number);
  return Math.atan2(b, a);
}
// Eén element (en alles erin) tekenen. kr = de rechthoek van de kaart op het scherm.
async function tekenDom(c, el, kr) {
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
  c.save();
  c.globalAlpha *= +cs.opacity;
  const hoek = draaiingVan(cs);
  if (Math.abs(hoek) > 1e-3 && el.offsetParent) {
    // gedraaid (schip, windpijl): in zijn eigen, ongedraaide assen tekenen rond het draaipunt
    const pr = el.offsetParent.getBoundingClientRect(), [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat);
    c.translate(pr.left - kr.left + el.offsetLeft + ox, pr.top - kr.top + el.offsetTop + oy);
    c.rotate(hoek); c.translate(-ox, -oy);
    const w = el.offsetWidth, h = el.offsetHeight;
    const svgs = [...el.children].filter(k => k instanceof SVGSVGElement && getComputedStyle(k).display !== 'none');
    for (const s of svgs) {
      c.save(); c.filter = getComputedStyle(s).filter;
      c.drawImage(await svgAlsBeeld(s), 0, 0, s.width.baseVal.value || w, s.height.baseVal.value || h);
      c.restore();
    }
    if (!svgs.length && el.textContent.trim()) {
      c.font = lettertype(cs); c.fillStyle = cs.color; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(el.textContent.trim(), w / 2, h / 2);
    }
    c.restore(); return;
  }
  if (el instanceof SVGSVGElement) {
    const r = el.getBoundingClientRect();
    if (r.width && r.height) { c.filter = cs.filter; c.drawImage(await svgAlsBeeld(el), r.left - kr.left, r.top - kr.top, r.width, r.height); }
    c.restore(); return;
  }
  const r = el.getBoundingClientRect(), x = r.left - kr.left, y = r.top - kr.top;
  // achtergrond (kleur, of een kleur uit het verloop) en rand
  const straal = cs.borderTopLeftRadius.includes('%') ? Math.min(r.width, r.height) / 2 : parseFloat(cs.borderTopLeftRadius) || 0;
  let vul = null;
  if (cs.backgroundImage && cs.backgroundImage !== 'none') {
    const kl = kleurenIn(cs.backgroundImage);
    if (el.classList.contains('schaal-balk')) {              // de kleurbalk van 'snelheid in kleur'
      vul = c.createLinearGradient(x, 0, x + r.width, 0);
      [0, .25, .5, .75, 1].forEach(f => vul.addColorStop(f, snelheidKleur(f)));
    } else if (kl.length) vul = kl[Math.min(1, kl.length - 1)];
  } else if (cs.backgroundColor && !/^rgba\(\d+, \d+, \d+, 0\)$|transparent/.test(cs.backgroundColor)) vul = cs.backgroundColor;
  if (vul && r.width && r.height) { rondPad(c, x, y, r.width, r.height, straal); c.fillStyle = vul; c.fill(); }
  const rand = parseFloat(cs.borderTopWidth);
  if (rand > 0 && cs.borderTopStyle !== 'none' && r.width) {
    rondPad(c, x + rand / 2, y + rand / 2, r.width - rand, r.height - rand, straal);
    c.lineWidth = rand; c.strokeStyle = cs.borderTopColor; c.stroke();
  }
  // inhoud: elementen, en tekst op de plek waar de browser hem zet
  for (const k of el.childNodes) {
    if (k.nodeType === 1) { await tekenDom(c, k, kr); continue; }
    if (k.nodeType !== 3 || !k.textContent.trim()) continue;
    const ruw = k.textContent, voor = ruw.length - ruw.trimStart().length, na = ruw.trimEnd().length;
    const bereik = document.createRange(); bereik.setStart(k, voor); bereik.setEnd(k, na);
    const tr = bereik.getBoundingClientRect();
    if (!tr.width) continue;
    let tekst = ruw.slice(voor, na).replace(/\s+/g, ' ');
    if (cs.textTransform === 'uppercase') tekst = tekst.toUpperCase();
    c.font = lettertype(cs); c.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    c.textAlign = 'left'; c.textBaseline = 'middle';
    const tx = tr.left - kr.left, ty = tr.top - kr.top + tr.height / 2;
    if (cs.textShadow && cs.textShadow !== 'none') { c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.65)'; c.strokeText(tekst, tx, ty); }
    c.fillStyle = cs.color; c.fillText(tekst, tx, ty);
  }
  c.restore();
}
// De hele kaart op het canvas, linksboven op (ox, oy), M pixels breed
async function tekenLeafletKaart(c, kaart, ox, oy, M) {
  const k = kaart.getContainer(), kr = k.getBoundingClientRect(), sx = M / kr.width;
  c.save(); c.translate(ox, oy); c.scale(sx, sx);
  c.beginPath(); c.rect(0, 0, kr.width, kr.height); c.clip();
  c.fillStyle = getComputedStyle(k).backgroundColor; c.fillRect(0, 0, kr.width, kr.height);
  const tegels = kaart.getPane('tilePane');
  c.filter = getComputedStyle(tegels).filter;
  tegels.querySelectorAll('img.leaflet-tile').forEach(img => {
    if (!img.complete || !img.naturalWidth) return;
    const r = img.getBoundingClientRect();
    c.drawImage(img, r.left - kr.left, r.top - kr.top, r.width, r.height);
  });
  c.filter = 'none';
  for (const svg of kaart.getPane('overlayPane').querySelectorAll('svg')) {
    const r = svg.getBoundingClientRect();
    if (r.width && r.height) c.drawImage(await svgAlsBeeld(svg), r.left - kr.left, r.top - kr.top, r.width, r.height);
  }
  for (const m of kaart.getPane('markerPane').children) await tekenDom(c, m, kr);
  for (const t of kaart.getPane('tooltipPane').children) await tekenDom(c, t, kr);
  for (const ctl of k.querySelectorAll('.leaflet-control'))
    if (!ctl.matches('.leaflet-control-zoom, .kaartknoppen, .leaflet-bar')) await tekenDom(c, ctl, kr);
  c.restore();
}

// Video: MP4 als de browser dat kan, anders WebM
function videoFormaat() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) || null;
}

// ---- Geanimeerde GIF (eigen encoder: geen extra bibliotheek nodig) ----
// Eén kleurenpalet voor de hele GIF (uit het eerste beeld, plus vaste kleuren), en elk volgend
// beeld bevat alleen het stukje dat veranderde; wat gelijk bleef is doorzichtig (comprimeert
// heel goed). Loopt eindeloos rond.
//   const gif = new GifSchrijver(W, H, eersteBeeld, vasteKleuren); gif.beeld(rgba, honderdsten); gif.blob()
class GifSchrijver {
  constructor(W, H, eerste, vaste = []) {
    this.W = W; this.H = H; this.uit = []; this.vorige = null;
    const DOOR = this.DOOR = 255;                     // kleur 255: doorzichtig (onveranderde pixel)
    const palet = this.palet = medianCut([eerste], DOOR - vaste.length).concat(vaste).slice(0, DOOR);
    while (palet.length < 256) palet.push([0, 0, 0]);
    this.cache = new Int16Array(32768).fill(-1);
    this.bytes([...'GIF89a'].map(c => c.charCodeAt(0))); this.woord(W); this.woord(H); this.bytes([0xF7, 0, 0]);
    palet.forEach(p => this.bytes(p));
    this.bytes([0x21, 0xFF, 0x0B, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 0x03, 0x01, 0, 0, 0]);   // eindeloos herhalen
  }
  bytes(a) { for (const x of a) this.uit.push(x); }
  woord(v) { this.bytes([v & 255, (v >> 8) & 255]); }
  index(r, g, b) {
    const k = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    if (this.cache[k] >= 0) return this.cache[k];
    let beste = 0, bd = Infinity;
    for (let i = 0; i < this.DOOR; i++) { const p = this.palet[i], d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < bd) { bd = d; beste = i; } }
    return (this.cache[k] = beste);
  }
  beeld(px, vertraging) {
    const { W, H, DOOR, vorige } = this, idx = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < idx.length; i++, j += 4) idx[i] = this.index(px[j], px[j + 1], px[j + 2]);
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;          // alleen het veranderde stukje (het eerste beeld helemaal)
    if (vorige) {
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0, i = y * W; x < W; x++, i++)
        if (idx[i] !== vorige[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) { x0 = y0 = x1 = y1 = 0; }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, deel = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y0 + y) * W + x0 + x;
      deel[y * w + x] = vorige && idx[i] === vorige[i] ? DOOR : idx[i];
    }
    this.bytes([0x21, 0xF9, 0x04, vorige ? 0x05 : 0x04]); this.woord(vertraging); this.bytes([DOOR, 0]);   // laten staan
    this.bytes([0x2C]); this.woord(x0); this.woord(y0); this.woord(w); this.woord(h); this.bytes([0, 8]);
    const data = gifLzw(deel, 8);
    for (let i = 0; i < data.length; i += 255) { const blok = data.slice(i, i + 255); this.uit.push(blok.length); this.bytes(blok); }
    this.uit.push(0);
    this.vorige = idx;
  }
  blob() { return new Blob([new Uint8Array(this.uit.concat([0x3B]))], { type: 'image/gif' }); }
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

function downloadBlob(blob, naam) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = naam;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
