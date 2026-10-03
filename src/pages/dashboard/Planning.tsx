// Baanplanning: de vastgelegde start of het startvoorstel, en de verwachte tijd per
// boot met de drie startopties (gelijk, achtervolging, lussen)
import { BOTEN, FLEET } from "../../../convex/lib/config";
import type { Boei, StartPlan, Voorstel } from "../../../convex/lib/validators";
import { BootStip } from "@/components/BootKaart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { akkoordVan, lussenVan, startNaam, vertragingVan, type LusPlan, type Plan } from "@/lib/baan";
import { formatAfstand, formatDuur, formatKlok } from "@/lib/format";
import { bft } from "@/lib/geo";

export function Planning({ raceStart, startPlan, voorstel, akkoord, naamVan, nu, concept, marks, windKn, plan, toon }: {
  raceStart: number | null; startPlan: StartPlan | null; voorstel: Voorstel | null; akkoord: Record<string, number | undefined>;
  naamVan: (b: string) => string; nu: number; concept: boolean; marks: Boei[]; windKn: number | null;
  plan: { nm: number | null; plan: Plan | null; lus: LusPlan | null }; toon: boolean;
}) {
  const { nm } = plan;
  if (nm == null && !toon && !raceStart && !voorstel) return null;
  const lussen = lussenVan(startPlan);
  return (
    <section>
      <h2 className="sectie-kop">Baanplanning</h2>
      <div className="perkament rounded-md border border-[#8a6a3a] px-3.5 py-3">
        {raceStart ? (
          <div className="mb-2.5 leading-snug">
            <b className="text-bloed">🔒 {startNaam(startPlan?.modus)} vastgelegd</b>
            {FLEET.map((b) => ({ b, t: raceStart + vertragingVan(startPlan, b) })).sort((x, y) => x.t - y.t).map((x) => (
              <div key={x.b}><BootStip boot={x.b} className="mr-1.5" />{naamVan(x.b)} — {formatKlok(x.t)}
                {lussen?.[x.b] && ` · lus +${formatAfstand(lussen[x.b].extraM)}`}</div>
            ))}
          </div>
        ) : voorstel && (
          <div className="mb-2.5 leading-snug">
            <b className="text-bloed">📨 Startvoorstel: {startNaam(voorstel.plan?.modus).toLowerCase()} om {formatKlok(voorstel.t)}</b>
            {voorstel.t <= nu && <span className="font-bold text-bloed"> verlopen</span>}
            {FLEET.map((b) => (
              <div key={b}><BootStip boot={b} className="mr-1.5" />{naamVan(b)}: {akkoordVan(voorstel, akkoord).includes(b) ? "✔ akkoord" : "⏳ nog niet"}</div>
            ))}
          </div>
        )}
        {nm == null || !plan.plan ? (
          <div className="text-[.92rem] leading-snug text-muted-foreground">Zet een startlijn, boeien en een finishlijn om de verwachte tijd per boot te zien.</div>
        ) : (() => {
          const p = plan.plan, lus = plan.lus;
          const volg = [...FLEET].sort((a, b) => p.verwacht[a] - p.verwacht[b]);
          return <>
            <div className="font-kap font-bold">{concept ? "✎ Concept-baan" : "Baan"}: {nm.toFixed(1)} zeemijl · {marks.length} {marks.length === 1 ? "boei" : "boeien"}</div>
            <div className="mt-0.5 mb-2 text-[.92rem] leading-snug text-muted-foreground">
              Verwachte tijden {windKn != null ? `bij ${bft(windKn)} Bft wind` : "bij gemiddelde wind"} — schatting op basis van de ORC-rating.</div>
            <Table className="text-[.92rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Boot</TableHead><TableHead className="text-right">Rating</TableHead><TableHead className="text-right">Verwacht</TableHead>
                  <TableHead className="text-right">Achterv.</TableHead><TableHead className="text-right">Lus</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {volg.map((b) => (
                  <TableRow key={b}>
                    <TableCell className="max-w-[120px] truncate"><BootStip boot={b} className="mr-1.5" />{naamVan(b)}</TableCell>
                    <TableCell className="text-right">{BOTEN[b].rating.toFixed(3)}</TableCell>
                    <TableCell className="text-right">{formatDuur(p.verwacht[b])}</TableCell>
                    <TableCell className="text-right">{p.vertraging[b] ? "+" + formatDuur(p.vertraging[b]) : "eerst"}</TableCell>
                    <TableCell className="text-right">{lus ? "+" + formatAfstand(lus.extra[b]) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-2 text-[.92rem] leading-snug text-muted-foreground">Achterv. = startvertraging bij start B. Lus = extra afstand bij start C (lusstart).
              {lus && !lus.past && <span className="font-bold text-bloed"> De lussen passen niet goed op deze baan: maak de raken langer.</span>}</div>
          </>;
        })()}
      </div>
    </section>
  );
}
