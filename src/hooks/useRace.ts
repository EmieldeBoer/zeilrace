import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { BOTEN, zetVloot } from "../../convex/lib/config";
import type { Boei, Lijnen, Quote, SpelData, StartPlan, Voorstel } from "../../convex/lib/validators";
import type { Gerond, TijdenMap } from "@/lib/baan";

export type BaanData = {
  lines: Lijnen; marks: Boei[]; raceStart: number | null; startPlan: StartPlan | null; voorstel: Voorstel | null; gen: number; quotes: Quote[];
};
export type BootInfo = {
  boot: string; model: string; kleur: string; gph: number; lengte: number;
  naam: string | null; start: number | null; finish: number | null; gerond: Gerond; akkoord: number | null;
  geclaimd: boolean; vanMij: boolean; claimNaam: string | null;
};
export type PositieInfo = { lat: number; lng: number; ts: number; acc?: number; speed?: number; heading?: number };

const LEGE_BAAN: BaanData = { lines: {}, marks: [], raceStart: null, startPlan: null, voorstel: null, gen: 0, quotes: [] };
const GEEN = {};

// Alle live gegevens van de race van een groep (baan, boten, posities, piratenspel).
// Zet ook de vloot van de groep klaar voor de rekenregels (BOTEN/FLEET).
export function useRace(groep: Id<"groepen">, token: string, piraat: boolean) {
  const args = { groep, token };
  const baan = useQuery(api.race.baan, args);
  const lijst = useQuery(api.race.boten, args);
  const posities = useQuery(api.race.posities, args);
  const spel = useQuery(api.race.spel, piraat ? args : "skip");

  const afgeleid = useMemo(() => {
    const vloot = (lijst ?? []) as BootInfo[];
    zetVloot(vloot);
    const boten: Record<string, BootInfo> = {}, times: TijdenMap = {}, gerond: Record<string, Gerond> = {};
    const akkoord: Record<string, number | undefined> = {};
    vloot.forEach((b) => {
      boten[b.boot] = b;
      times[b.boot] = { start: b.start, finish: b.finish };
      gerond[b.boot] = b.gerond;
      akkoord[b.boot] = b.akkoord ?? undefined;
    });
    // Teamnaam (als die is ingevuld), anders de naam van de boot
    const naamVan = (x: string) => (boten[x]?.naam && boten[x].naam!.trim()) || boten[x]?.model || BOTEN[x]?.model || x;
    // Wie vaart er mee: de boten met een toestel. Die moeten akkoord geven op een start.
    const mee = vloot.filter((b) => b.geclaimd).map((b) => b.boot);
    return { vloot, boten, times, gerond, akkoord, naamVan, mee };
  }, [lijst]);

  return {
    geladen: baan !== undefined && lijst !== undefined && posities !== undefined && (!piraat || spel !== undefined),
    geenToegang: baan === null,
    baan: (baan ?? LEGE_BAAN) as BaanData,
    posities: (posities ?? GEEN) as Record<string, PositieInfo>,
    spel: (piraat ? spel ?? null : null) as SpelData | null,
    ...afgeleid,
  };
}
export type RaceData = ReturnType<typeof useRace>;
