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
      "plaquette",
      kaart ? "pointer-events-none absolute top-3 left-1/2 z-[900] max-w-[94%] -translate-x-1/2 rounded-lg px-6 pt-2.5 pb-3 max-[820px]:top-2"
        : "sticky top-0 z-[1100] -mx-4 border-x-0 border-t-0 border-b-4 px-4 pt-2 pb-3",
      kaart && a.soort === "wacht" && "min-w-[58%] max-[820px]:min-w-[70%]",
      a.urgent && "urgent",
      a.soort === "gestart" && (kaart ? "px-[18px] pt-1.5 pb-2" : "pb-2"),
    )}>
      <div className="font-kop text-[clamp(.8rem,2.4vw,1.05rem)] font-bold tracking-[.16em] text-muted-foreground">{a.boven}</div>
      <div className={cn("font-kop leading-[1.05] font-black text-kop",
        a.soort === "gestart" ? (kaart ? "text-[clamp(1.6rem,5vw,2.4rem)]" : "text-[clamp(1.9rem,9vw,2.6rem)]") + " text-goed-licht"
          : kaart ? "text-[clamp(3.4rem,12vw,7.5rem)]" : "text-[clamp(4.2rem,24vw,8.5rem)] leading-none",
        a.laatste10 && "knipper")}>{a.cijfers}</div>
      {a.onder && <div className="font-kop text-[clamp(.8rem,2.4vw,1.05rem)] font-bold tracking-[.16em] text-muted-foreground">{a.onder}</div>}
    </div>
  );
}
