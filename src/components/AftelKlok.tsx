// De grote aftelklok: naar de zeeslag, naar de start (bij een achtervolgingsstart per boot),
// en na de start de verstreken tijd. Variant 'kaart' (over de kaart van het dashboard)
// of 'balk' (bovenaan de tracker).
import type { ReactNode } from "react";
import { cn } from "cn";
import { formatDuur, formatKlok } from "@/lib/format";

export const SPEL_BEGONNEN_MS = 15000;

export type Aftel = { soort: "wacht" | "gestart"; urgent?: boolean; laatste10?: boolean; boven: ReactNode; cijfers: string; onder?: ReactNode };

// De aftelklok naar de zeeslag: null als er niet wordt afgeteld (en de zeeslag niet net begonnen is)
export function spelAftel(start: number | null | undefined, nu: number): Aftel | null {
  if (!start || nu - start > SPEL_BEGONNEN_MS) return null;
  const rem = start - nu;
  return rem > 0
    ? { soort: "wacht", urgent: rem <= 60000, laatste10: rem <= 10000, boven: "🏴‍☠️ ZEESLAG OVER", cijfers: formatDuur(rem), onder: `om ${formatKlok(start)}` }
    : { soort: "gestart", boven: "🏴‍☠️ DE ZEESLAG IS BEGONNEN", cijfers: "VUUR!" };
}

export function AftelKlok({ a, variant }: { a: Aftel; variant: "kaart" | "balk" }) {
  const kaart = variant === "kaart";
  return (
    <div role="timer" className={cn(
      "text-center",
      kaart ? "plaquette pointer-events-none absolute top-3 left-1/2 z-[900] max-w-[94%] -translate-x-1/2 rounded-lg px-6 pt-2.5 pb-3 max-[820px]:top-2"
        : "sticky top-0 z-[1100] -mx-4 border-b-[3px] border-messing bg-[linear-gradient(180deg,#120c07,#1f150c)] px-4 pt-[calc(8px+env(safe-area-inset-top))] pb-3 shadow-[0_2px_0_#000,0_6px_18px_#000a]",
      kaart && a.soort === "wacht" && "min-w-[58%] max-[820px]:min-w-[70%]",
      a.urgent && (kaart ? "border-[#d0542f] bg-[linear-gradient(180deg,rgba(90,22,12,.96),rgba(40,10,6,.96))]" : "border-[#d0542f] bg-[linear-gradient(180deg,#3d0e07,#5a160b)]"),
      a.soort === "gestart" && (kaart ? "border-verdigris px-[18px] pt-1.5 pb-2" : "border-verdigris pb-2"),
    )}>
      <div className="font-kap text-[clamp(.8rem,2.4vw,1.05rem)] font-bold tracking-[.16em] text-ivoor-zacht">{a.boven}</div>
      <div className={cn("font-kap leading-[1.05] font-black text-goud [text-shadow:0_3px_0_#000,0_0_18px_rgba(240,199,94,.35)]",
        a.soort === "gestart" ? (kaart ? "text-[clamp(1.6rem,5vw,2.4rem)]" : "text-[clamp(1.9rem,9vw,2.6rem)]") + " text-verdigris-licht"
          : kaart ? "text-[clamp(3.4rem,12vw,7.5rem)]" : "text-[clamp(4.2rem,24vw,8.5rem)] leading-none",
        a.urgent && "text-[#ffb08a] [text-shadow:0_3px_0_#000,0_0_20px_rgba(255,120,80,.5)]",
        a.laatste10 && "knipper")}>{a.cijfers}</div>
      {a.onder && <div className="font-kap text-[clamp(.8rem,2.4vw,1.05rem)] font-bold tracking-[.16em] text-ivoor-zacht">{a.onder}</div>}
    </div>
  );
}
