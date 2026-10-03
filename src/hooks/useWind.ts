import { useEffect, useRef, useState } from "react";
import type { LatLng } from "../../convex/lib/validators";
import { afstandMeter } from "@/lib/geo";

export type Wind = { kn: number; richting: number; vlagen: number };
export type WindStaat = Wind | "laden" | "fout";

// Actuele wind van Open-Meteo op een plek, elke 5 minuten opnieuw.
// Verschuift de plek meer dan 2 km, dan meteen opnieuw.
export function useWind(plek: LatLng | null): WindStaat {
  const [wind, setWind] = useState<WindStaat>("laden");
  const plekRef = useRef(plek);
  const opgehaald = useRef<LatLng | null>(null);
  plekRef.current = plek;

  useEffect(() => {
    let weg = false;
    async function haal() {
      const pos = plekRef.current;
      if (!pos) return;
      opgehaald.current = pos;
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(4)}` +
          `&longitude=${pos.lng.toFixed(4)}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`;
        const c = (await (await fetch(url)).json()).current;
        if (!weg) setWind({ kn: c.wind_speed_10m, richting: c.wind_direction_10m, vlagen: c.wind_gusts_10m });
      } catch {
        if (!weg) setWind("fout");
      }
    }
    const t = setInterval(haal, 5 * 60 * 1000);
    const v = setInterval(() => {
      const p = plekRef.current, o = opgehaald.current;
      if (p && (!o || afstandMeter(p, o) > 2000)) haal();
    }, 2000);
    haal();
    return () => { weg = true; clearInterval(t); clearInterval(v); };
  }, []);
  return wind;
}
