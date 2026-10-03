// De groep die open is: wie ben ik hier (lid of host), de leden, en de live race.
import { createContext, useContext } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { RaceData } from "./useRace";

export type Lid = { id: Id<"leden">; naam: string | null; rol: "host" | "lid"; ikZelf: boolean; boten: string[] };
export type GroepInfo = {
  id: Id<"groepen">; naam: string; code: string; piraat: boolean; hostCode: string | null;
};
export type GroepContext = {
  groep: GroepInfo;
  token: string;
  isHost: boolean;
  mijnNaam: string | null;
  leden: Lid[];
  race: RaceData;
};

export const GroepCtx = createContext<GroepContext | null>(null);
export function useGroep(): GroepContext {
  const g = useContext(GroepCtx);
  if (!g) throw new Error("useGroep buiten een groep");
  return g;
}

// Links om te delen
export const lidLink = (code: string) => `${location.origin}/g/${code}`;
export const hostLink = (hostCode: string) => `${location.origin}/host/${hostCode}`;
export const codeTekst = (code: string) => code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
