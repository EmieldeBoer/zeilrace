// De kaart als React-onderdeel: Leaflet in een div, met daarover (in shadcn-stijl)
// de kaartknoppen rechtsboven, de wind linksonder en de schaal in zeemijl rechtsonder.
// Wat er op de kaart staat, tekent de pagina zelf via de Leaflet-kaart uit onKaart.
import L from "leaflet";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { WindStaat } from "@/hooks/useWind";
import { bft, kompas } from "@/lib/geo";
import { maakKaart, maakMeetlat, type Meetlat } from "./kaart";

export type KaartKnop = { id: string; tekst: string; titel: string; klik: () => void; actief?: boolean };

export function KaartVlak({ onKaart, knoppen = [], wind, className, children }: {
  onKaart: (kaart: L.Map, meetlat: Meetlat) => void;
  knoppen?: KaartKnop[];
  wind?: WindStaat;
  className?: string;
  children?: ReactNode;
}) {
  const vak = useRef<HTMLDivElement>(null);
  const [kaart, setKaart] = useState<L.Map | null>(null);
  const meetlat = useRef<Meetlat | null>(null);
  const [meten, setMeten] = useState(false);
  const onKaartRef = useRef(onKaart);
  onKaartRef.current = onKaart;

  useEffect(() => {
    const k = maakKaart(vak.current!);
    const m = maakMeetlat(k);
    meetlat.current = m;
    setKaart(k);
    onKaartRef.current(k, m);
    // Leaflet moet het weten als de kaart van maat verandert (tabbladen, draaien, paneel)
    const ro = new ResizeObserver(() => k.invalidateSize());
    ro.observe(vak.current!);
    return () => { ro.disconnect(); m.weg(); k.remove(); };
  }, []);

  const alle: KaartKnop[] = [...knoppen,
    { id: "meet", tekst: "📏", titel: "Afstand meten: tik punten op de kaart", actief: meten,
      klik: () => setMeten(meetlat.current!.wissel()) }];

  return (
    <div className={cn("relative isolate overflow-hidden", className)}>
      <div ref={vak} className="absolute inset-0 z-0" />
      <div className="absolute top-2.5 right-2.5 z-[800] flex flex-col overflow-hidden rounded-md border-2 border-messing-donker shadow-[0_2px_8px_rgba(0,0,0,.6)]">
        {alle.map((k) => (
          <Tooltip key={k.id}>
            <TooltipTrigger render={
              <Button size="icon-lg" aria-label={k.titel} aria-pressed={k.actief || undefined} onClick={k.klik}
                className={cn("rounded-none border-0 border-b border-messing-donker last:border-b-0 font-sans text-[22px] shadow-none",
                  k.actief && "bg-[image:linear-gradient(#4f9a74,var(--color-verdigris))] text-white shadow-[inset_0_0_0_2px_var(--color-verdigris-licht)]")} />
            }>{k.tekst}</TooltipTrigger>
            <TooltipContent side="left">{k.titel}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {wind && <WindWidget wind={wind} />}
      {kaart && <ZeemijlSchaal kaart={kaart} />}
      {children}
    </div>
  );
}

// Windwidget linksonder op de kaart: de pijl wijst mee met de wind
function WindWidget({ wind }: { wind: WindStaat }) {
  const w = typeof wind === "object" ? wind : null;
  return (
    <div className="plaquette absolute bottom-6 left-2.5 z-[800] flex items-center gap-3 rounded-[10px] px-3 py-1.5 pointer-events-none">
      <div className={cn("text-[28px] leading-none text-goud transition-transform duration-500 [text-shadow:0_0_6px_rgba(240,199,94,.4)]", !w && "opacity-25")}
        style={w ? { transform: `rotate(${w.richting + 180}deg)` } : undefined} title="wijst mee met de wind">↑</div>
      <div>
        <div className="font-kap text-[.66rem] tracking-[.14em] text-ivoor-zacht uppercase">Wind</div>
        <div className="font-kap text-[1.3rem] font-bold text-goud">{w ? bft(w.kn) : "–"} Bft</div>
        <div className="text-[.85rem] text-ivoor-zacht">
          {w ? `uit ${kompas(w.richting)} (${Math.round(w.richting)}°) · vlagen ${bft(w.vlagen)} Bft`
            : wind === "fout" ? "wind niet beschikbaar" : "laden…"}
        </div>
      </div>
    </div>
  );
}

// Schaalbalk in zeemijl (Leaflet kent alleen meter/mijl): een mooie ronde lengte
// van hooguit ~110 px, bij kleine afstanden in kabellengtes van 0,1 zm
function ZeemijlSchaal({ kaart }: { kaart: L.Map }) {
  const [schaal, setSchaal] = useState<{ px: number; tekst: string } | null>(null);
  useEffect(() => {
    const bijwerken = () => {
      const h = kaart.getSize().y / 2, p1 = kaart.containerPointToLatLng([0, h]), p2 = kaart.containerPointToLatLng([110, h]);
      const zmPer110 = kaart.distance(p1, p2) / 1852;
      if (!(zmPer110 > 0)) return;
      const stappen = [.01, .02, .05, .1, .2, .25, .5, 1, 2, 5, 10, 20, 50, 100];
      const zm = stappen.filter((s) => s <= zmPer110).pop() || stappen[0];
      setSchaal({ px: Math.round(110 * zm / zmPer110), tekst: String(zm) + " zm" + (zm < .1 ? ` (${Math.round(zm * 1852)} m)` : "") });
    };
    kaart.on("zoomend moveend resize", bijwerken);
    bijwerken();
    return () => { kaart.off("zoomend moveend resize", bijwerken); };
  }, [kaart]);
  if (!schaal) return null;
  return (
    <div className="pointer-events-none absolute right-2.5 bottom-6 z-[800] rounded-[3px] border border-[#8a6a3a] bg-[rgba(234,216,174,.9)] px-[7px] pt-[3px] pb-0.5 shadow-[0_1px_4px_rgba(0,0,0,.4)]">
      <div className="flex h-1.5 border-[1.5px] border-inkt" style={{ width: schaal.px }}><i className="flex-1 bg-inkt" /><i className="flex-1" /></div>
      <div className="text-center font-kap text-[10px] leading-[1.3] font-bold tracking-[.03em] text-inkt">{schaal.tekst}</div>
    </div>
  );
}
