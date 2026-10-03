// 🔮 Voorspelde eindstand: per boot de tijd tot de finish (met de verwachte kloktijd),
// de totale verzeilde tijd en de gecorrigeerde totale tijd. Voorspelde rijen staan cursief.
import { cn } from "cn";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { VoorspelRij } from "@/lib/baan";
import { formatDuur, klokHM } from "@/lib/format";
import { BootStip } from "./BootKaart";

export function Voorspelling({ rijen, naam, eigen }: { rijen: VoorspelRij[]; naam: (b: string) => string; eigen?: string }) {
  if (!rijen.length) return null;
  return (
    <div className="vlak rounded-md border border-rand px-3 pt-1 pb-2">
      <Table className="max-[420px]:text-[.88rem]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8 text-center">#</TableHead><TableHead>Boot</TableHead>
            <TableHead className="text-right">Tot finish</TableHead><TableHead className="text-right">Totaal</TableHead>
            <TableHead className="text-right">Gecorr.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rijen.map((r, i) => (
            <TableRow key={r.boot} className={cn(!r.zeker && "italic", r.boot === eigen && "font-bold", i === 0 && "font-bold text-winst")}>
              <TableCell className="text-center font-bold">{i + 1}</TableCell>
              <TableCell className="max-w-[140px] truncate max-[420px]:max-w-[104px]"><BootStip boot={r.boot} className="mr-1.5" />{naam(r.boot)}</TableCell>
              <TableCell className="text-right">
                {r.zeker ? "🏁 binnen" : "≈ " + formatDuur(r.rest)}
                <small className="block text-[.72rem] font-normal text-muted-foreground not-italic">{klokHM(r.finish)}</small>
              </TableCell>
              <TableCell className="text-right">{formatDuur(r.totaal)}</TableCell>
              <TableCell className="text-right">{formatDuur(r.gecorr)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
