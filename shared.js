// ============================================================
//  Zeilrace — gedeelde hulpfuncties (kruising-detectie + tijd)
//  Wordt geladen door zowel index.html als tracker.html.
// ============================================================

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
// p1-p2 = spoor van de boot, p3-p4 = de lijn (start of finish)
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
  const R = 6371000; // straal aarde in meter
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// --- Hoek van een boei naar de boot (graden, tegen-de-klok +) ---
// Gebruikt voor rondingsdetectie: draait deze hoek op terwijl de boot
// passeert, dan gaat de boot linksom (boei aan bakboord); af = rechtsom.
function hoekMarkNaarBoot(mark, boot) {
  const dx = (boot.lng - mark.lng) * Math.cos(mark.lat * Math.PI / 180);
  const dy = boot.lat - mark.lat;
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

// --- Hoekverschil normaliseren naar (-180, 180] ----------------
function normHoekVerschil(d) {
  return ((d % 360) + 540) % 360 - 180;
}

// --- Midden van een lijn {a,b} ---------------------------------
function lijnMidden(ln) { return { lat: (ln.a.lat + ln.b.lat) / 2, lng: (ln.a.lng + ln.b.lng) / 2 }; }

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
// Geeft {a,b} (lat/lng) terug, of null als er geen bocht is.
function rondingsLijn(boei, prev, next, marginM, reikM) {
  if (!prev || !next) return null;
  const latR = boei.lat * Math.PI / 180;
  const mx = p => ({ x: (p.lng - boei.lng) * 111000 * Math.cos(latR), y: (p.lat - boei.lat) * 111000 });
  const norm = a => { const L = Math.hypot(a.x, a.y); return L ? { x: a.x / L, y: a.y / L } : { x: 0, y: 0 }; };
  const u = norm(mx(prev)), w = norm(mx(next));
  const bx = u.x + w.x, by = u.y + w.y;
  const L = Math.hypot(bx, by);
  if (L < 0.15) return null;                 // (bijna) rechte doorgang: geen ronding
  const ox = -bx / L, oy = -by / L;          // buitenwaartse bissectrice (eenheidsvector)
  const naarLatLng = (dx, dy) => ({ lat: boei.lat + dy / 111000, lng: boei.lng + dx / (111000 * Math.cos(latR)) });
  return {
    a: naarLatLng(-ox * marginM, -oy * marginM),   // iets naar binnen (marge)
    b: naarLatLng(ox * reikM, oy * reikM)          // ver naar buiten
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
// Alles {lat,lng}; over korte afstanden als plat vlak behandeld.
function dichtstbijPuntOpLijn(p, a, b) {
  const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.lng - ax) * dx + (p.lat - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { lat: ay + t * dy, lng: ax + t * dx };
}

// --- Volgende doel van een boot (algemeen) ---------------------
function doelVanBoot(pos, start, finish, gerond, lijnen, boeien) {
  if (finish != null) return null;
  if (start == null) return (lijnen.start && lijnen.start.a)
    ? { label: 'Startlijn', punt: dichtstbijPuntOpLijn(pos, lijnen.start.a, lijnen.start.b) } : null;
  const v = boeien.findIndex((_, i) => (gerond || {})[i] == null);
  if (v !== -1) return { label: 'Boei ' + (v + 1), punt: { lat: boeien[v].lat, lng: boeien[v].lng } };
  return (lijnen.finish && lijnen.finish.a)
    ? { label: 'Finish', punt: dichtstbijPuntOpLijn(pos, lijnen.finish.a, lijnen.finish.b) } : null;
}

// --- Afstand kort weergeven ------------------------------------
function formatAfstand(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km'; }

// --- VMG (m/s) naar een doelpunt via GPS-koers; null zonder koers -
function vmgNaarDoel(pos, speedMps, heading, doelPunt) {
  if (speedMps == null || heading == null || isNaN(heading)) return null;
  const b = peiling(pos, doelPunt);
  return speedMps * Math.cos((b - heading) * Math.PI / 180);
}

// --- Datazin voor een boot: snelheid · VMG · doel · afstand · tijd
function bootDataTekst(s, lijnen, boeien) {
  if (!s || s.lat == null) return 'geen data';
  const spd = (s.speed != null) ? (s.speed * 1.94384).toFixed(1) + ' kn' : '— kn';
  if (s.finish != null) return spd + ' · gefinisht 🏁';
  const pos = { lat: s.lat, lng: s.lng };
  const doel = doelVanBoot(pos, s.start, s.finish, s.gerond, lijnen, boeien);
  if (!doel) return spd;
  const dist = afstandMeter(pos, doel.punt);
  const vmg = vmgNaarDoel(pos, s.speed, s.heading, doel.punt);
  const vmgTxt = 'VMG ' + (vmg != null ? (vmg * 1.94384).toFixed(1) + ' kn' : '—');
  const eta = (s.speed != null && s.speed > 0.3) ? formatDuur(dist / s.speed * 1000) : '—';
  return `${spd} · ${vmgTxt} · ${doel.label} · ${formatAfstand(dist)} · ${eta}`;
}

// --- Tijd netjes weergeven -------------------------------------
// milliseconden -> "1:23:45" of "23:45"
function formatDuur(ms) {
  if (ms == null || ms < 0 || isNaN(ms)) return "—";
  const totaal = Math.floor(ms / 1000);
  const u = Math.floor(totaal / 3600);
  const m = Math.floor((totaal % 3600) / 60);
  const s = totaal % 60;
  const pad = n => String(n).padStart(2, "0");
  return u > 0 ? `${u}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// klokstip (unix ms) -> "14:07:23"
function formatKlok(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("nl-NL", { hour12: false });
}
