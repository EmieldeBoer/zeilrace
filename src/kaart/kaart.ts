// ============================================================
//  Leaflet-hulpjes voor de kaart (dashboard, tracker en replay):
//  boeien, start-/finishlijnen, rondingslijnen, schepen, meetlat.
// ============================================================
import L from "leaflet";
import { BOTEN, RONDINGS_LIJN_M } from "../../convex/lib/config";
import type { Boei, Lijn, Lijnen, Lus } from "../../convex/lib/validators";
import { lusPad } from "@/lib/baan";
import { afstandMeter, boeiPrevNext, peiling, rondingsLijn } from "@/lib/geo";
import { esc, formatAfstand } from "@/lib/format";
import { schipMaat, schipSvg } from "@/lib/schip";

export const TEGEL_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export function maakKaart(el: HTMLElement): L.Map {
  const k = L.map(el, { zoomControl: true }).setView([52.4, 5.4], 12);
  L.tileLayer(TEGEL_URL, { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(k);
  return k;
}

export function boeiIcoon(i: number, concept?: boolean) {
  return L.divIcon({ className: "", html: `<div class="boei${concept ? " concept" : ""}">${i + 1}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13] });
}
// Lusboei (lusstart): letter A of B in de kleur van de boot
export function lusIcoon(letter: string, kleur: string) {
  return L.divIcon({ className: "", html: `<div class="boei lus" style="background:${kleur}">${letter}</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11] });
}

// Start- of finishlijn met duidelijke uiteinden: aan elk eind een rond merkteken in de
// lijnkleur. Zet de lagen in `lagen` en geeft de lijn terug (voor een label).
export const LIJN_KLEUR = { start: "#2ea043", finish: "#e6194b" } as const;
export function tekenStartFinish(kaart: L.Map, ln: Lijn, t: "start" | "finish", lagen: L.Layer[], opties?: L.PolylineOptions): L.Polyline {
  const kleur = LIJN_KLEUR[t];
  const lijn = L.polyline([[ln.a.lat, ln.a.lng], [ln.b.lat, ln.b.lng]],
    { color: kleur, weight: 4, dashArray: "7 7", ...opties }).addTo(kaart);
  lagen.push(lijn);
  [ln.a, ln.b].forEach((p) => lagen.push(L.circleMarker([p.lat, p.lng],
    { radius: 7, color: "#2b1b0d", weight: 2.5, fillColor: kleur, fillOpacity: 1, interactive: false }).addTo(kaart)));
  return lijn;
}

// Rondingslijnen over de volle lengte waarmee de ronding ook echt wordt gemeten
// (RONDINGS_LIJN_M), in de kleur van de boei: oranje voor de gewone boeien, de
// bootkleur voor een lusboei. Optioneel een eigen kleur en een filter.
export function tekenRondingslijnen(kaart: L.Map, boeien: (Boei & { lus?: string })[], lijnen: Lijnen, lagen: L.Layer[],
  kleur?: string, filter?: (b: Boei & { lus?: string }) => boolean) {
  boeien.forEach((boei, i) => {
    if (filter && !filter(boei)) return;
    const { prev, next } = boeiPrevNext(i, boeien, lijnen);
    const rl = rondingsLijn(boei, prev, next, 6, RONDINGS_LIJN_M);
    const boeiKleur = boei.lus && BOTEN[boei.lus] ? BOTEN[boei.lus].kleur : (kleur || "#d98b2b");
    if (rl) lagen.push(L.polyline([[rl.a.lat, rl.a.lng], [rl.b.lat, rl.b.lng]],
      { color: boeiKleur, weight: 3, dashArray: "6 7", opacity: .9, interactive: false, rondingslijn: true } as L.PolylineOptions).addTo(kaart));
  });
}

// Lussen van een lusstart: per boot een lijn in de bootkleur door de eigen lus, met de boeien A en B.
// voorbeeld = nog niet gestart: vaag getekend, zodat de wedstrijdleiding kan zien waar de lussen komen.
export function tekenLussen(kaart: L.Map, marks: Boei[], lines: Lijnen, lussen: Record<string, Lus> | null | undefined,
  lagen: L.Layer[], naam: (b: string) => string, voorbeeld?: boolean, alleen?: string) {
  if (!lussen) return;
  Object.keys(BOTEN).forEach((b) => {
    if (alleen && b !== alleen) return;
    const pad = lusPad(marks, lines, lussen, b);
    if (!pad) return;
    lagen.push(L.polyline(pad.map((p) => [p.lat, p.lng] as [number, number]),
      { color: BOTEN[b].kleur, weight: 2, dashArray: "2 6", opacity: voorbeeld ? .45 : .9, interactive: false }).addTo(kaart));
    pad.filter((p) => p.lus).forEach((p) => lagen.push(L.marker([p.lat, p.lng], { icon: lusIcoon(p.letter || "", BOTEN[b].kleur), opacity: voorbeeld ? .55 : 1 })
      .addTo(kaart).bindTooltip(esc(`${voorbeeld ? "Voorbeeld · " : ""}${p.label} · ${naam(b)}`), { direction: "top", offset: [0, -11] })));
  });
}

// --- Schepen ---------------------------------------------------
type SchipMarker = L.Marker & { _koers?: number; _staat?: SchipStaat };
export type SchipStaat = { eigen?: boolean; gekozen?: boolean; wrak?: boolean; spel?: boolean; spook?: "half" | "weg" | null };
export function maakSchip(latlng: L.LatLngExpression, boot: string): SchipMarker {
  const { b, h, ax, ay } = schipMaat(boot);
  const icon = L.divIcon({ className: "schip",
    // beide uiterlijken zitten erin; de klasse 'zeeslag' op de marker kiest het piratenschip
    html: `<div class="schip-draai" style="width:${b}px;height:${h}px;transform-origin:${ax}px ${ay}px">${schipSvg(boot, "kaart")}${schipSvg(boot, "piraat")}</div>`,
    iconSize: [b, h], iconAnchor: [ax, ay] });
  const m: SchipMarker = L.marker(latlng, { icon, keyboard: false, riseOnHover: true });
  m.on("add", () => { zetKoers(m, m._koers); zetSchipStaat(m, m._staat || {}); });
  return m;
}
export function zetKoers(m: SchipMarker, koers: number | null | undefined) {
  if (koers == null || isNaN(koers)) return;
  m._koers = koers;
  const e = m.getElement(); if (e) (e.querySelector(".schip-draai") as HTMLElement).style.transform = `rotate(${koers}deg)`;
}
export function zetSchipStaat(m: SchipMarker, staat: SchipStaat) {
  m._staat = staat;
  const e = m.getElement(); if (!e) return;
  e.classList.toggle("eigen", !!staat.eigen);
  e.classList.toggle("gekozen", !!staat.gekozen);
  e.classList.toggle("wrak", !!staat.wrak);
  e.classList.toggle("zeeslag", !!staat.spel);     // piratenspel bezig → piratenschip
  // spookschip: doorzichtig (voor jezelf en de wedstrijdleiding) of helemaal weg (voor de anderen), ook het label
  e.classList.toggle("spook", staat.spook === "half");
  e.classList.toggle("onzichtbaar", staat.spook === "weg");
  const te = m.getTooltip()?.getElement();
  if (te) te.classList.toggle("onzichtbaar", staat.spook === "weg");
}

// --- Afstand meten: tik punten op de kaart ---------------------
// Per stuk de afstand (zm, kort ook in meters) en de koers, vanaf het derde punt
// ook het totaal. Nog een keer op de knop: stoppen en wissen.
export type Meetlat = { wissel: () => boolean; actief: () => boolean; weg: () => void };
export function maakMeetlat(kaart: L.Map): Meetlat {
  let aan = false, punten: { lat: number; lng: number }[] = [], lagen: L.Layer[] = [];
  const lijn = L.polyline([], { color: "#8b1e12", weight: 3, dashArray: "8 6", interactive: false });
  const afstand = (m: number) => formatAfstand(m) + (m < 185 ? ` (${Math.round(m)} m)` : "");
  const koers = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => String(Math.round(peiling(a, b)) % 360).padStart(3, "0") + "°";
  function teken() {
    lagen.forEach((l) => kaart.removeLayer(l)); lagen = [];
    lijn.setLatLngs(punten.map((p) => [p.lat, p.lng]));
    let totaal = 0;
    punten.forEach((p, i) => {
      lagen.push(L.circleMarker([p.lat, p.lng], { radius: 5, color: "#fff", weight: 2, fillColor: "#8b1e12", fillOpacity: 1,
        interactive: false }).addTo(kaart));
      let tekst = i === 0 ? (punten.length === 1 ? "Tik het volgende punt" : "") : "";
      if (i > 0) {
        const d = afstandMeter(punten[i - 1], p); totaal += d;
        tekst = `${afstand(d)} · koers ${koers(punten[i - 1], p)}` + (i > 1 ? `<br><b>totaal ${afstand(totaal)}</b>` : "");
      }
      if (tekst) lagen.push(L.tooltip({ permanent: true, direction: "auto", offset: [8, 0], className: "meet-label", interactive: false })
        .setLatLng([p.lat, p.lng]).setContent(tekst).addTo(kaart));
    });
  }
  const opKlik = (e: L.LeafletMouseEvent) => {
    if (!aan) return;
    punten.push({ lat: e.latlng.lat, lng: e.latlng.lng });
    teken();
  };
  kaart.on("click", opKlik);
  function wissel() {
    aan = !aan; punten = []; teken();
    if (aan) lijn.addTo(kaart); else kaart.removeLayer(lijn);
    kaart.getContainer().classList.toggle("meten", aan);
    return aan;
  }
  return { wissel, actief: () => aan, weg: () => { kaart.off("click", opKlik); } };
}

// Maak een L.LatLngBounds van een lijst lagen (voor 'hele baan tonen'). De rondingslijnen
// (10 km lang) tellen niet mee, anders zoomt de kaart ver uit.
export function grenzenVan(lagen: L.Layer[]): L.LatLngBounds | null {
  const mee = lagen.filter((l) => !(l.options as { rondingslijn?: boolean }).rondingslijn);
  if (!mee.length) return null;
  const b = L.featureGroup(mee).getBounds();
  return b.isValid() ? b : null;
}
