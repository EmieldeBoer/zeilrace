// Een boot als kaartje (dashboard: 'Boten live', tracker: je eigen boot en 'Andere boten'):
// naam, model en rating, status en de live gegevens in een raster.
import type { ReactNode } from "react";
import { cn } from "cn";
import { BOTEN } from "../../convex/lib/config";
import { winLabel, winWaarde, type BootWeergave } from "@/lib/baan";

export function BootStats({ d }: { d: BootWeergave }) {
  if (d.status === "geen") return <div className="mt-1.5 text-[.95rem] text-muted-foreground italic">nog geen positie</div>;
  const c = (k: string, v: string, neg?: boolean) => (
    <div className={cn("flex min-w-0 flex-col", neg && "[&>.v]:text-bloed")} key={k}>
      <span className="font-kap text-[.68rem] font-bold tracking-[.08em] text-muted-foreground uppercase">{k}</span>
      <span className="v truncate text-[1.15rem] font-bold">{v}</span>
    </div>
  );
  const raster = "mt-2 grid grid-cols-[repeat(auto-fit,minmax(62px,1fr))] gap-x-2.5 gap-y-1.5 border-t border-dashed border-[rgba(107,81,48,.45)] pt-2";
  if (d.status === "finish") return (
    <div className={raster}>
      {c("Snelheid", d.spd)}
      {d.afgelegd && c("Afgelegd", d.afgelegd)}
      <div className="self-end font-kap font-bold text-bloed">🏁 gefinisht</div>
    </div>
  );
  return (
    <div className={raster}>
      {c("Snelheid", d.spd)}
      {c("VMG", d.vmg ?? "—", d.vmgNeg)}
      {c("Doel", d.doel ?? "—")}
      {c("Afstand", d.afst ?? "—")}
      {d.afgelegd && c("Afgelegd", d.afgelegd)}
      {d.win && c(winLabel(d.win), winWaarde(d.win), d.win.rest == null)}
      <div className="col-span-full border-t border-dotted border-[rgba(107,81,48,.35)] pt-1.5">
        <span className="font-kap text-[.68rem] tracking-[.06em] text-muted-foreground italic">Voorspelling</span>
        <div className="mt-0.5 grid grid-cols-3 gap-x-2.5 gap-y-1 [&_.v]:text-base [&_.v]:italic">
          {c("Tot finish", d.eta)}{c("Eindtijd", d.eind)}{c("Met rating", d.eindGecorr)}
        </div>
      </div>
    </div>
  );
}

export function BootStip({ boot, className }: { boot: string; className?: string }) {
  return <span className={cn("inline-block size-3 shrink-0 rounded-full border-[1.5px] border-inkt align-[-1px]", className)}
    style={{ background: BOTEN[boot]?.kleur }} />;
}

// Naam + model/rating + status. Het hele kaartje is een knop (volgen op de kaart).
export function BootKaart({ boot, naam, status, live, offline, gekozen, weergave, onClick, children, className }: {
  boot: string; naam: string; status: string; live?: boolean; offline?: boolean; gekozen?: boolean;
  weergave: BootWeergave; onClick?: () => void; children?: ReactNode; className?: string;
}) {
  const b = BOTEN[boot];
  const eigenNaam = naam !== b.model;
  const inhoud = (
    <>
      <div className="flex items-center gap-2.5">
        <span className="size-[18px] shrink-0 rounded-full border-2 border-inkt shadow-[0_0_0_1px_var(--color-messing)]" style={{ background: b.kleur }} />
        <span className="min-w-0">
          <span className="block truncate text-[1.2rem] font-bold">{naam}</span>
          <span className="block text-[.85rem] text-muted-foreground italic">{(eigenNaam ? b.model + " · " : "") + "rating " + b.rating.toFixed(3)}</span>
        </span>
        {status && <span className={cn("ml-auto shrink-0 rounded-[3px] border px-2 py-0.5 font-kap text-[.72rem] font-bold tracking-[.06em]",
          live ? "border-[#1c4634] bg-verdigris text-[#eafff0]" : "border-[rgba(107,81,48,.4)] bg-[rgba(107,81,48,.18)] text-muted-foreground")}>{status}</span>}
      </div>
      <BootStats d={weergave} />
      {children}
    </>
  );
  const klassen = cn("perkament block w-full rounded-md border border-[#8a6a3a] px-3.5 py-3 text-left text-inkt",
    offline && "brightness-[.8] grayscale-[.5]", gekozen && "border-bloed shadow-[0_0_0_3px_var(--color-goud),var(--perkament-schaduw)]", className);
  if (!onClick) return <div className={klassen}>{inhoud}</div>;
  return (
    <button type="button" aria-pressed={!!gekozen} onClick={onClick}
      className={cn(klassen, "cursor-pointer outline-offset-[3px] hover:border-messing-donker [&_*]:pointer-events-none")}>
      {inhoud}
    </button>
  );
}
