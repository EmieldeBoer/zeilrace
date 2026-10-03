// De vloot op de kaart: per boot een schip (draait mee met de koers), een label
// en het gevaren spoor. Gedeeld door het dashboard en de tracker.
import L from "leaflet";
import { BOTEN, FLEET } from "../../convex/lib/config";
import type { BuitSoort } from "../../convex/lib/spel";
import type { LatLng, SpelData } from "../../convex/lib/validators";
import type { SpoorPunt } from "@/lib/baan";
import { koersUitBeweging } from "@/lib/geo";
import * as Piraat from "@/lib/piraat";
import type { SpelStand } from "@/lib/piraat";
import { schipLabelOffset } from "@/lib/schip";
import { maakSchip, zetKoers, zetSchipStaat, type SchipStaat } from "./kaart";
import { kistLagen, mijnLagen, richtlijnen, veldLaag, type KistLaag } from "./piraatLagen";

type Marker = ReturnType<typeof maakSchip>;

export class Vloot {
  markers: Record<string, Marker> = {};
  koers: Record<string, number> = {};
  private koersPunt: Record<string, LatLng> = {};
  private sporen: Record<string, L.Polyline> = {};
  private getekend: Record<string, { eerste: number; n: number }> = {};
  private labels: Record<string, string> = {};
  private kaart: L.Map;
  private klik: (b: string) => void;

  constructor(kaart: L.Map, klik: (b: string) => void) {
    this.kaart = kaart;
    this.klik = klik;
    FLEET.forEach((b) => {
      this.sporen[b] = L.polyline([], { color: BOTEN[b].kleur, weight: 3, opacity: .75, interactive: false }).addTo(kaart);
    });
  }

  // Positie van een schip. koers = GPS-koers (alleen bij vaart), anders uit de beweging.
  zetPositie(b: string, p: LatLng, gpsKoers: number | null | undefined, label: string) {
    let koers = gpsKoers ?? koersUitBeweging(this.koersPunt[b], p);
    if (gpsKoers != null || koers != null || !this.koersPunt[b]) this.koersPunt[b] = p;
    if (koers == null) koers = this.koers[b] ?? null;
    if (!this.markers[b]) {
      this.markers[b] = maakSchip([p.lat, p.lng], b).addTo(this.kaart)
        .bindTooltip(label, { permanent: true, direction: "top", className: "boot-label", offset: schipLabelOffset(b) })
        .on("click", () => this.klik(b)) as Marker;
      this.labels[b] = label;
    } else this.markers[b].setLatLng([p.lat, p.lng]);
    if (koers != null) { this.koers[b] = koers; zetKoers(this.markers[b], koers); }
    this.zetLabel(b, label);
  }
  zetLabel(b: string, label: string) {
    if (this.markers[b] && this.labels[b] !== label) { this.markers[b].setTooltipContent(label); this.labels[b] = label; }
  }
  zetStaat(b: string, staat: SchipStaat) {
    if (this.markers[b]) zetSchipStaat(this.markers[b], staat);
    this.sporen[b]?.setStyle({ opacity: staat.spook === "weg" ? 0 : .75 });
  }
  // Het spoor bijwerken: groeit het alleen, dan alleen de nieuwe punten toevoegen
  zetSpoor(b: string, pts: SpoorPunt[] | undefined) {
    const lijn = this.sporen[b]; if (!lijn) return;
    const lijst = pts || [], g = this.getekend[b];
    if (g && lijst.length >= g.n && (lijst[0]?.ts ?? 0) === g.eerste) {
      for (let i = g.n; i < lijst.length; i++) lijn.addLatLng([lijst[i].lat, lijst[i].lng]);
    } else lijn.setLatLngs(lijst.map((p) => [p.lat, p.lng]));
    this.getekend[b] = { eerste: lijst[0]?.ts ?? 0, n: lijst.length };
  }
  lagen(): L.Layer[] { return Object.values(this.markers); }
}

// Het piratenspel op de kaart: speelveld (krimpt), schatkisten, zeemijnen en de schootslijnen.
export class SpelLagen {
  private kaart: L.Map;
  private veld: L.Circle | null = null;
  private veldSleutel = "";
  private kist: KistLaag | null = null;
  private kistSleutel = "";
  private mijn: L.LayerGroup | null = null;
  private mijnSleutel = "";
  private richt: Record<string, L.LayerGroup | null> = {};

  constructor(kaart: L.Map) { this.kaart = kaart; }

  teken(st: SpelStand, spel: SpelData | null, nu: number, mijnen: { id: string; lat: number; lng: number }[]) {
    // Het speelveld is voor iedereen te zien zolang het er staat
    const sleutel = st.veld && st.veld.r ? JSON.stringify(st.veld) : "";
    if (sleutel !== this.veldSleutel) { this.veld = veldLaag(this.kaart, sleutel ? st.veld : null, this.veld); this.veldSleutel = sleutel; }
    // het speelveld krimpt na een tijdje (vóór het begin: de volle maat)
    if (this.veld && st.veld) this.veld.setRadius(Piraat.straal(st.veld, st.start, Math.min(nu, st.over || Infinity)) ?? st.veld.r);
    const kisten = st.bezig ? Piraat.kisten(spel, nu) : [], kSleutel = kisten.map((k) => k.nr).join(",");
    if (kSleutel !== this.kistSleutel) { this.kist = kistLagen(this.kaart, kisten, this.kist); this.kistSleutel = kSleutel; }
    const mSleutel = mijnen.map((m) => m.id).join(",");
    if (mSleutel !== this.mijnSleutel) { this.mijn = mijnLagen(this.kaart, mijnen, this.mijn); this.mijnSleutel = mSleutel; }
  }
  // Schootslijnen van boot b (null = weg)
  richtlijn(b: string, pos: LatLng | null, koers: number | null | undefined, eigen: boolean, lading: BuitSoort | null) {
    if (pos) this.richt[b] = richtlijnen(this.kaart, pos, koers, this.richt[b], eigen, lading);
    else if (this.richt[b]) { this.kaart.removeLayer(this.richt[b]!); this.richt[b] = null; }
  }
}
