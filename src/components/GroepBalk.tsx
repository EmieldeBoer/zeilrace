// De bovenbalk van een groep: de naam, en de knoppen Meevaren (de tracker), Delen en Groep.
import { ArrowLeft, Sailboat, Share2, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { cn } from "cn";
import { DelenDialoog } from "@/components/Delen";
import { buttonVariants } from "@/components/ui/button";
import { useGroep } from "@/hooks/useGroep";

export function GroepBalk({ waar, children }: { waar: "dashboard" | "tracker" | "groep"; children?: ReactNode }) {
  const { groep } = useGroep();
  const [params, setParams] = useSearchParams();
  const [delen, setDelen] = useState(false);
  // Net gemaakt (?delen=1): meteen het deelscherm
  useEffect(() => {
    if (params.get("delen") === "1") { setDelen(true); params.delete("delen"); setParams(params, { replace: true }); }
  }, [params, setParams]);
  const knop = "flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2.5 font-kop text-sm font-bold hover:bg-white/10";
  return (
    <header className="balk flex-none pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-1 px-2 sm:px-3">
        {waar === "dashboard"
          ? <Link to="/" aria-label="Naar het begin" className={knop}><Sailboat className="size-6" /></Link>
          : <Link to={`/g/${groep.code}`} aria-label="Terug naar de groep" className={knop}><ArrowLeft className="size-6" /></Link>}
        <div className="line-clamp-2 min-w-0 flex-1 font-kop text-[.95rem] leading-tight font-extrabold [overflow-wrap:anywhere] sm:text-lg sm:[font-stretch:var(--kop-rek)]">{groep.naam}</div>
        {waar !== "tracker" && (
          <Link to={`/g/${groep.code}/tracker`}
            className={cn(buttonVariants({ size: "default" }), "h-11 shrink-0 px-3 border-[var(--seingeel)] bg-[var(--seingeel)] bg-none text-[#0b1d33] shadow-none hover:brightness-105")}>
            <Sailboat className="size-5 max-[420px]:hidden" /><span>Meevaren</span>
          </Link>
        )}
        <button type="button" onClick={() => setDelen(true)} aria-label="Groep delen" className={knop}><Share2 className="size-5" /><span className="hidden sm:inline">Delen</span></button>
        {waar !== "groep" && (
          <Link to={`/g/${groep.code}/groep`} aria-label="Groep en leden" className={knop}><Users className="size-5" /><span className="hidden sm:inline">Groep</span></Link>
        )}
      </div>
      {children}
      <div className="seinstreep" />
      <DelenDialoog open={delen} setOpen={setDelen} />
    </header>
  );
}
