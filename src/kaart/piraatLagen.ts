// ============================================================
//  Zeilrace: het piratenspel op de kaart, speelveld, richtlijnen,
//  zeemijnen, schatkisten en vliegende kanonskogels (Leaflet).
//  De spelregels zelf staan in src/lib/piraat.ts.
// ============================================================
import L from "leaflet";
import { SPEL, type BuitSoort } from "../../convex/lib/spel";
import type { LatLng, Schot, Veld } from "../../convex/lib/validators";
import { bereik, kogels, richting, type Kist } from "../lib/piraat";

export type KistLaag = { groep: L.LayerGroup; markers: Record<string, L.LayerGroup> };

// ---- Kaart: speelveld, richtlijnen en vliegende kanonskogels ----
export function veldLaag(kaart: L.Map, veld: Veld | null | undefined, oud: L.Layer | null | undefined): L.Circle | null {
  if (oud) kaart.removeLayer(oud);
  if (!veld || !veld.r) return null;
  return L.circle([veld.lat, veld.lng], { radius: veld.r, color: "#8b1e12", weight: 3, dashArray: "10 8",
    fillColor: "#8b1e12", fillOpacity: 0.04, interactive: false }).addTo(kaart);
}
// Stippellijnen: de randen van de waaier waarbinnen de breedzijde valt (geen middenlijn)
// lading = wat het schip uit een kist heeft: langere, wijdere of extra (vooruit) lijnen
export function richtlijnen(kaart: L.Map, pos: LatLng | null | undefined, koers: number | null | undefined, oud: L.Layer | null | undefined,
  eigen?: boolean, lading?: BuitSoort | null): L.LayerGroup | null {
  if (oud) kaart.removeLayer(oud);
  if (!pos || koers == null) return null;
  const g = L.layerGroup(), kleur = eigen ? "#8b1e12" : "#2b1b0d";
  const spreiding = lading === "breed" ? SPEL.breedGr : SPEL.spreidingGr, lengte = bereik({ groot: lading === "bereik" });
  [90, -90].concat(lading === "voor" ? [0] : []).forEach((zij) => [-spreiding, spreiding].forEach((w) => {
    const r = richting(pos, koers + zij + w, lengte);
    L.polyline([[pos.lat, pos.lng], [r.lat, r.lng]], { color: kleur, weight: eigen ? 2 : 1.5, dashArray: "2 6",
      opacity: eigen ? .85 : .45, interactive: false }).addTo(g);
  }));
  return g.addTo(kaart);
}
function wolkje(kaart: L.Map, p: LatLng, straal: number, kleur: string, duur: number) {           // kruitdamp of een plons
  const c = L.circleMarker([p.lat, p.lng], { radius: straal, stroke: false, fillColor: kleur, fillOpacity: .8, interactive: false }).addTo(kaart);
  const t0 = performance.now();
  (function stap(nu: number) {
    const f = Math.min(1, (nu - t0) / duur);
    c.setRadius(straal * (1 + f * 1.8)); c.setStyle({ fillOpacity: .8 * (1 - f) });
    if (f < 1) requestAnimationFrame(stap); else kaart.removeLayer(c);
  })(t0);
}
export function ontploffing(kaart: L.Map, p: LatLng, teken = "💥") {
  const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html: `<div class="kanon-raak">${teken}</div>`, iconSize: [44, 44] }), interactive: false }).addTo(kaart);
  setTimeout(() => kaart.removeLayer(m), 2600);
}
// Zeemijnen op de kaart (alleen voor de eigenaar en de wedstrijdleiding)
export function mijnLagen(kaart: L.Map, lijst: LatLng[], oud: L.Layer | null | undefined): L.LayerGroup | null {
  if (oud) kaart.removeLayer(oud);
  if (!lijst.length) return null;
  const g = L.layerGroup();
  lijst.forEach((m) => {
    L.circle([m.lat, m.lng], { radius: SPEL.mijnM, color: "#2b1b0d", weight: 1.5, dashArray: "2 5", fillColor: "#2b1b0d",
      fillOpacity: 0.08, interactive: false }).addTo(g);
    L.marker([m.lat, m.lng], { icon: L.divIcon({ className: "", html: '<div class="zeemijn">💣</div>', iconSize: [26, 26] }),
      interactive: false, keyboard: false }).addTo(g);
  });
  return g.addTo(kaart);
}
// Een open schatkist met goud (SVG, 34 × 30 px)
export const SCHATKIST = '<svg viewBox="0 0 32 28" width="34" height="30" aria-hidden="true">' +
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
export function kistLagen(kaart: L.Map, lijst: Kist[], oud: KistLaag | null | undefined): KistLaag {
  const laag: KistLaag = oud || { groep: L.layerGroup().addTo(kaart), markers: {} }, nu = new Set(lijst.map((k) => String(k.nr)));
  Object.keys(laag.markers).forEach((nr) => { if (!nu.has(nr)) { laag.groep.removeLayer(laag.markers[nr]); delete laag.markers[nr]; } });
  lijst.forEach((k) => {
    if (laag.markers[k.nr]) return;
    const html = `<div class="buitkist" style="animation-delay:-${(k.nr * 0.37 % 2.4).toFixed(2)}s">${SCHATKIST}</div>`;
    laag.markers[k.nr] = L.layerGroup([
      L.circle([k.lat, k.lng], { radius: SPEL.kistPakM, color: "#b8860b", weight: 2, dashArray: "4 6",
        fillColor: "#f0c75e", fillOpacity: 0.15, interactive: false }),
      L.marker([k.lat, k.lng], { icon: L.divIcon({ className: "", html, iconSize: [34, 30] }), interactive: false, keyboard: false }),
    ]).addTo(laag.groep);
  });
  return laag;
}
// Een salvo afspelen. doelPos(boot) → huidige positie van een geraakte boot.
export function animeer(kaart: L.Map, schot: Schot, raak: string[], doelPos: (b: string) => LatLng | null | undefined, geblokt: string[] = []) {
  const van: L.LatLngTuple = [schot.lat, schot.lng], duur = 1200;
  // kruitdamp aan beide kanten van het schip
  [90, -90].forEach((z) => wolkje(kaart, richting(schot, schot.koers + z, 10), 9, "#e6dcc6", 1400));
  kogels(schot).forEach((k) => {                        // alleen de vliegende kogels, zonder spoor erachter
    const bol = L.circleMarker(van, { radius: 3, color: "#000", weight: 1, fillColor: "#161616", fillOpacity: 1, interactive: false });
    setTimeout(() => {
      bol.addTo(kaart);
      const t0 = performance.now();
      (function stap(nu: number) {
        const f = Math.min(1, (nu - t0) / duur);
        bol.setLatLng([schot.lat + (k.eind.lat - schot.lat) * f, schot.lng + (k.eind.lng - schot.lng) * f]);
        if (f < 1) { requestAnimationFrame(stap); return; }
        kaart.removeLayer(bol); wolkje(kaart, k.eind, 4, "#bfe3ff", 900);
      })(t0);
    }, k.vertraging);
  });
  setTimeout(() => {
    raak.forEach((b) => { const p = doelPos(b); if (p) ontploffing(kaart, p); });
    geblokt.forEach((b) => { const p = doelPos(b); if (p) ontploffing(kaart, p, "🛡️"); });   // het schild ving hem op
  }, duur * 0.7);
}
