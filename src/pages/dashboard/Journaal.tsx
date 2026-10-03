// 📜 Het scheepsjournaal: elk uur een notitie van de verteller (nieuwste bovenaan)
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { klokHM } from "@/lib/format";
import type { JournaalNotitie } from "@/lib/verteller";

export function JournaalLijst({ notities, nieuw, className }: { notities: JournaalNotitie[]; nieuw?: boolean; className?: string }) {
  return (
    <div className={cn("vlak max-h-[46vh] overflow-y-auto rounded-md border border-rand px-3.5 pt-1.5 pb-2.5", className)}>
      {notities.map((n, i) => (
        <div key={`${n.t}-${i}`} className="border-b border-dashed border-lijn py-2.5 last:border-b-0">
          <div className="font-kop text-[.8rem] font-bold tracking-[.08em] text-signaal">{n.kop}</div>
          <div className={cn("mt-0.5 text-[1.05rem] leading-normal",
            nieuw && i === 0 && "first-letter:float-left first-letter:mt-[3px] first-letter:mr-[5px] first-letter:font-titel first-letter:text-[1.9em] first-letter:leading-[.9] first-letter:text-signaal")}>{n.tekst}</div>
        </div>
      ))}
    </div>
  );
}

export function Journaal({ j, test, alleBinnen, onNu }: {
  j: { loopt: boolean; notities: JournaalNotitie[]; volgende: number | null }; test: boolean; nu: number; alleBinnen: boolean; onNu: () => void;
}) {
  const leeg = !j.loopt && !j.notities.length;
  return (
    <section>
      <h2 className="sectie-kop">📜 Scheepsjournaal</h2>
      {leeg ? (
        <div className="vlak rounded-md border border-rand px-3.5 py-2.5 text-[.9rem] text-muted-foreground italic">Het journaal begint zodra de race is gestart.</div>
      ) : (
        <JournaalLijst notities={j.notities} nieuw />
      )}
      {j.loopt && !alleBinnen && j.volgende && (
        <div className="pt-2 text-[.9rem] text-muted-foreground italic">
          {j.notities.length ? "Volgende notitie" : "De eerste notitie in het journaal volgt"} om {klokHM(j.volgende)}.</div>
      )}
      {test && <Button size="xl" variant="secondary" className="mt-2.5" onClick={onNu}>📝 Maak nu een journaalnotitie (test)</Button>}
    </section>
  );
}
