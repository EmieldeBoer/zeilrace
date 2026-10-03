// Het piratenspel: het scorebord en wat er in de schatkisten kan zitten
import { cn } from "cn";
import { SPEL } from "../../convex/lib/spel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buitOverzicht, levensTekst, type SpelStand } from "@/lib/piraat";
import { BootStip } from "./BootKaart";

export function SpelScore({ st, naam, eigen }: { st: SpelStand; naam: (b: string) => string; eigen?: string }) {
  if (!st.deelnemers.length) return <div className="text-muted-foreground italic">Nog geen schepen op het water.</div>;
  return (
    <Table className="mt-2">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Schip</TableHead><TableHead>Levens</TableHead>
          <TableHead className="text-right">Raak</TableHead><TableHead className="text-right">Salvo's</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {st.volgorde.map((b, i) => (
          <TableRow key={b.boot} className={cn(!b.levens && "line-through opacity-55", b.boot === eigen && "font-bold")}>
            <TableCell className="max-w-[130px] truncate">
              {st.over && i === 0 && !st.gelijk ? "👑 " : ""}<BootStip boot={b.boot} className="mr-1.5" />{naam(b.boot)}
            </TableCell>
            <TableCell>{b.levens ? levensTekst(b) : "☠️ gezonken"}</TableCell>
            <TableCell className="text-right">{b.hits}</TableCell>
            <TableCell className="text-right">{SPEL.schoten - b.gebruikt}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Overzicht van wat er in een schatkist kan zitten, met de kans
export function BuitLijst() {
  return (
    <ul className="my-2 list-none p-0">
      {buitOverzicht().map((b) => (
        <li key={b.soort} className="border-b border-lijn py-1.5 last:border-b-0">
          <div className="flex justify-between gap-2 font-bold"><span>{b.icoon} {b.naam}</span>
            <span className="font-kop text-[.85rem] font-normal text-muted-foreground">{b.pct}%</span></div>
          <div className="text-[.95rem] leading-snug text-muted-foreground">{b.tekst}{b.lading && <i> Bewaar je tot je hem gebruikt.</i>}</div>
        </li>
      ))}
    </ul>
  );
}
