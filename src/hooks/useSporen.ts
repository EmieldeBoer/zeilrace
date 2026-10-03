import { useConvex, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { SpoorPunt } from "@/lib/baan";

type Tupel = (string | number)[];
type Basis = { gen: number; punten: Record<string, SpoorPunt[]>; na: number };

function voegToe(punten: Record<string, SpoorPunt[]>, rijen: Tupel[]) {
  for (const [b, lat, lng, ts] of rijen as [string, number, number, number][]) {
    const pts = punten[b] = punten[b] || [];
    const p = { lat, lng, ts };
    if (pts.length && pts[pts.length - 1].ts > ts) { pts.push(p); pts.sort((x, y) => x.ts - y.ts); } else pts.push(p);
  }
}
const kopie = (p: Record<string, SpoorPunt[]>) => Object.fromEntries(Object.entries(p).map(([b, l]) => [b, l.slice()]));

// De gevaren sporen van de huidige generatie, per boot op tijd gesorteerd.
// Eerst één keer alles (in pagina's), daarna alleen wat er sinds 'na' bijkomt;
// af en toe schuift 'na' op, zodat dat live stukje klein blijft.
export function useSporen(gen: number | null): Record<string, SpoorPunt[]> {
  const convex = useConvex();
  const [basis, setBasis] = useState<Basis | null>(null);

  useEffect(() => {
    if (gen == null) return;
    let weg = false;
    (async () => {
      const punten: Record<string, SpoorPunt[]> = {};
      let cursor: string | null = null, na = 0;
      for (;;) {
        const r: { punten: Tupel[]; isDone: boolean; continueCursor: string } =
          await convex.query(api.race.sporenPagina, { gen, cursor });
        if (weg) return;
        voegToe(punten, r.punten);
        r.punten.forEach((p) => { na = Math.max(na, p[4] as number); });
        if (r.isDone) break;
        cursor = r.continueCursor;
      }
      setBasis({ gen, punten, na });
    })().catch(() => { if (!weg) setBasis({ gen, punten: {}, na: 0 }); });
    return () => { weg = true; };
  }, [convex, gen]);

  const actueel = basis && basis.gen === gen ? basis : null;
  const nieuw = useQuery(api.race.sporenSinds, actueel ? { gen: actueel.gen, na: actueel.na } : "skip");

  const samen = useMemo(() => {
    if (!actueel) return {};
    if (!nieuw || !nieuw.length) return actueel.punten;
    const p = kopie(actueel.punten);
    voegToe(p, nieuw);
    return p;
  }, [actueel, nieuw]);

  // Het live stukje groot geworden? Dan wordt het onderdeel van de basis.
  useEffect(() => {
    if (!actueel || !nieuw || nieuw.length < 300) return;
    const na = Math.max(actueel.na, ...nieuw.map((p) => p[4] as number));
    setBasis({ gen: actueel.gen, punten: samen, na });
  }, [actueel, nieuw, samen]);

  return samen;
}
