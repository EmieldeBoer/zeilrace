import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { BOTEN, FLEET } from "../../convex/lib/config";
import type { Boei, Lijnen, SpelData, StartPlan, Voorstel } from "../../convex/lib/validators";
import type { Gerond, TijdenMap } from "@/lib/baan";

export type BaanData = {
  lines: Lijnen; marks: Boei[]; raceStart: number | null; startPlan: StartPlan | null; voorstel: Voorstel | null; gen: number;
};
export type BootInfo = {
  naam: string | null; start: number | null; finish: number | null; gerond: Gerond; akkoord: number | null; geclaimd: boolean;
};
export type PositieInfo = { lat: number; lng: number; ts: number; acc?: number; speed?: number; heading?: number };

const LEGE_BAAN: BaanData = { lines: {}, marks: [], raceStart: null, startPlan: null, voorstel: null, gen: 0 };
const GEEN = {};

// Alle live gegevens van de race (baan, boten, posities, piratenspel)
export function useRace() {
  const baan = useQuery(api.race.baan);
  const boten = useQuery(api.race.boten);
  const posities = useQuery(api.race.posities);
  const spel = useQuery(api.race.spel);
  const b = (boten ?? GEEN) as Record<string, BootInfo>;

  const afgeleid = useMemo(() => {
    const times: TijdenMap = {}, gerond: Record<string, Gerond> = {}, akkoord: Record<string, number | undefined> = {};
    FLEET.forEach((x) => {
      times[x] = { start: b[x]?.start ?? null, finish: b[x]?.finish ?? null };
      gerond[x] = b[x]?.gerond ?? {};
      akkoord[x] = b[x]?.akkoord ?? undefined;
    });
    // Teamnaam (als die is ingevuld), anders het model
    const naamVan = (x: string) => (b[x]?.naam && b[x]!.naam!.trim()) || BOTEN[x]?.model || x;
    return { times, gerond, akkoord, naamVan };
  }, [b]);

  return {
    geladen: baan !== undefined && boten !== undefined && posities !== undefined && spel !== undefined,
    baan: (baan ?? LEGE_BAAN) as BaanData,
    boten: b,
    posities: (posities ?? GEEN) as Record<string, PositieInfo>,
    spel: (spel ?? null) as SpelData | null,
    ...afgeleid,
  };
}
export type RaceData = ReturnType<typeof useRace>;
