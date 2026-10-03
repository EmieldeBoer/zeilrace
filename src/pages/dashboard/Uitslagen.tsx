// 🏆 Uitslagen: klassement, ratingcheck, polars, elke race (met replay, journaal en
// voor de wedstrijdleiding naam, finish uit spoor en wissen) en de bewaarde zeeslagen
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "cn";
import { api } from "../../../convex/_generated/api";
import { BOTEN, FLEET } from "../../../convex/lib/config";
import { SPEL } from "../../../convex/lib/spel";
import type { Uitslag, WindUur, Zeeslag } from "../../../convex/lib/validators";
import { BootStip } from "@/components/BootKaart";
import { useBevestig } from "@/components/Bevestig";
import { PolarDiagram } from "@/components/uitslagen/PolarDiagram";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Wl } from "@/hooks/useWl";
import { startNaam } from "@/lib/baan";
import { foutTekst } from "@/lib/fouten";
import { datumKort, formatAfstand, formatDuur, formatKlok } from "@/lib/format";
import { harten } from "@/lib/piraat";
import * as Polar from "@/lib/polar";
import {
  afstandUitSpoor, DNF_PUNTEN, finishVoorstellen, kanFinishUitSpoor, raceEinde, racePlek, rangen, RATING_MIN_RACES, ratingVerdiend, uitslagLijst,
} from "@/lib/uitslag";
import * as Verteller from "@/lib/verteller";
import { JournaalLijst } from "./Journaal";

export type ReplayKeuze = { soort: "race"; res: Uitslag } | { soort: "zeeslag"; z: Zeeslag };

const Blok = ({ children, className }: { children: ReactNode; className?: string }) =>
  <Card className={cn("mb-5 gap-0 rounded-md px-4 pt-1.5 pb-3", className)}>{children}</Card>;
const Kop = ({ children }: { children: ReactNode }) =>
  <h3 className="mx-0.5 mt-3.5 mb-1 flex flex-wrap items-center gap-1.5 font-kap text-[1.05rem] font-bold">{children}</h3>;
const Sub = ({ children, className }: { children: ReactNode; className?: string }) =>
  <div className={cn("mx-0.5 mb-2 text-[.9rem] text-muted-foreground italic", className)}>{children}</div>;
const Knop = (p: React.ComponentProps<typeof Button>) => <Button size="sm" {...p} />;

export function Uitslagen({ wl, naamVan, onReplay }: { wl: Wl; naamVan: (b: string) => string; onReplay: (k: ReplayKeuze) => void }) {
  const races = useQuery(api.uitslagen.races);
  const zeeslagen = useQuery(api.uitslagen.zeeslagen);
  const admin = wl.isWl, token = wl.token;
  const { bevestig, invoer, melding } = useBevestig();
  const wis = useMutation(api.wl.uitslagWis), hernoem = useMutation(api.wl.uitslagNaam);
  const finishFix = useMutation(api.wl.uitslagFinish), zeeslagWis = useMutation(api.wl.zeeslagWis);
  const doe = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { await melding({ titel: "Mislukt", tekst: foutTekst(e) }); } };

  if (races === undefined || zeeslagen === undefined) return <div className="mx-auto max-w-[820px] py-5 text-ivoor-zacht italic">Uitslagen laden…</div>;
  const lijst = [...races].sort((a, b) => a.nr - b.nr) as Uitslag[];
  const nummers = lijst.map((r) => r.nr);
  const perNr = Object.fromEntries(lijst.map((r) => [r.nr, r]));

  async function corrigeerFinish(res: Uitslag) {
    const voorstel = finishVoorstellen(res), nm = (b: string) => res.namen?.[b] || naamVan(b);
    if (!voorstel.length) { await melding({ titel: "Geen finish gevonden", tekst: "Geen boot zonder finish die volgens zijn spoor over de finishlijn van deze race ging." }); return; }
    if (!(await bevestig({ titel: `Race ${res.nr}: finish uit het spoor halen?`, ok: "🏁 Aanpassen",
      tekst: "Over de finishlijn zoals die aan het eind van de race lag.\n\n" +
        voorstel.map((v) => `${nm(v.boot)}: finish ${formatKlok(v.finish)} → verzeild ${formatDuur(v.elapsed)}, gecorrigeerd ${formatDuur(v.corrected)}`).join("\n") +
        "\n\nHet tijdstip is tussen twee spoorpunten ingeschat (enkele seconden nauwkeurig). " +
        "Het bewaarde journaal wordt vervangen door een journaal uit de sporen met de nieuwe uitslag." }))) return;
    await doe(() => finishFix({ token, nr: res.nr, finishes: voorstel }));
  }

  return (
    <div className="mx-auto max-w-[820px]">
      <h1 className="titel-goud mb-1 text-[2.4rem]">🏆 De Buit — uitslagen &amp; klassement</h1>
      <p className="mb-[22px] text-[1.08rem] leading-normal text-ivoor-zacht italic">Klassement volgens low-point (laagste totaal wint), op
        <b> gecorrigeerde tijd</b> (met rating). Per race zie je ook de verzeilde tijd. Per race kun je de <b>replay</b> bekijken:
        sleep door de tijd, speel hem af, of maak er een video of foto van.</p>

      {!nummers.length ? (
        <div className="px-0.5 py-5 text-ivoor-zacht italic">Nog geen races afgerond. De wedstrijdleiding rondt een race af via
          "Race afronden &amp; opslaan" (Live-tab met ?wl).</div>
      ) : <>
        <Klassement nummers={nummers} perNr={perNr} naamVan={naamVan} />
        <RatingCheck nummers={nummers} perNr={perNr} naamVan={naamVan} />
        <Polars races={lijst} naamVan={naamVan} />
        {[...lijst].reverse().map((res) => (
          <RaceBlok key={res.nr} res={res} naamVan={naamVan} admin={admin}
            onReplay={() => onReplay({ soort: "race", res })}
            onNaam={async () => {
              const naam = await invoer({ titel: `Naam voor race ${res.nr}`, tekst: "Leeg = geen naam.", standaard: res.naam || "", max: 60, ok: "Opslaan" });
              if (naam !== null) await doe(() => hernoem({ token, nr: res.nr, naam }));
            }}
            onFinish={() => corrigeerFinish(res)}
            onWis={async () => { if (await bevestig({ titel: `Race ${res.nr} definitief verwijderen uit de uitslagen?`, gevaar: true, ok: "🗑 Verwijderen" }))
              await doe(() => wis({ token, nr: res.nr })); }} />
        ))}
      </>}

      {zeeslagen.length > 0 && <>
        <h2 className="titel-goud mt-8 mb-3 text-[1.8rem]">🏴‍☠️ Zeeslagen</h2>
        {[...(zeeslagen as Zeeslag[])].sort((a, b) => b.start - a.start).map((z) => (
          <ZeeslagBlok key={z.start} z={z} naamVan={naamVan} admin={admin} onReplay={() => onReplay({ soort: "zeeslag", z })}
            onWis={async () => { if (await bevestig({ titel: "Deze zeeslag definitief verwijderen?", gevaar: true, ok: "🗑 Verwijderen" }))
              await doe(() => zeeslagWis({ token, start: z.start })); }} />
        ))}
      </>}
    </div>
  );
}

// ---- Klassement op gecorrigeerde tijd (met rating), low-point ----
function Klassement({ nummers, perNr, naamVan }: { nummers: number[]; perNr: Record<number, Uitslag>; naamVan: (b: string) => string }) {
  const punten: Record<string, Record<number, number>> = {}, totaal: Record<string, number> = {};
  FLEET.forEach((b) => { punten[b] = {}; totaal[b] = 0; });
  nummers.forEach((nr) => {
    const r = rangen(uitslagLijst(perNr[nr]), "corrected");
    FLEET.forEach((b) => { punten[b][nr] = r[b] || DNF_PUNTEN; totaal[b] += punten[b][nr]; });
  });
  const volgorde = [...FLEET].sort((a, b) => {
    if (totaal[a] !== totaal[b]) return totaal[a] - totaal[b];
    for (let k = nummers.length - 1; k >= 0; k--) {        // gelijkspel: laatste race beslist
      const nr = nummers[k];
      if (punten[a][nr] !== punten[b][nr]) return punten[a][nr] - punten[b][nr];
    }
    return 0;
  });
  return (
    <Blok>
      <Kop>Klassement</Kop>
      <Sub>Op gecorrigeerde tijd (met rating) · low-point · niet gefinisht = {DNF_PUNTEN} punten</Sub>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent">
          <TableHead className="w-10 text-center">#</TableHead><TableHead>Boot</TableHead>
          {nummers.map((nr) => <TableHead key={nr} className="text-center">R{nr}</TableHead>)}
          <TableHead className="text-center">Totaal</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {volgorde.map((b, i) => (
            <TableRow key={b} className={cn(i === 0 && "font-bold text-bloed")}>
              <TableCell className="text-center font-bold">{i === 0 ? "👑 " : ""}{i + 1}</TableCell>
              <TableCell className="max-w-[150px] truncate"><BootStip boot={b} className="mr-1.5" />{naamVan(b)}</TableCell>
              {nummers.map((nr) => <TableCell key={nr} className="text-center">{punten[b][nr]}</TableCell>)}
              <TableCell className="text-center"><b>{totaal[b]}</b></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Blok>
  );
}

// ---- Ratingcheck: welke rating 'verdiende' elke boot in de afgeronde races? ----
function RatingCheck({ nummers, perNr, naamVan }: { nummers: number[]; perNr: Record<number, Uitslag>; naamVan: (b: string) => string }) {
  const perRace = nummers.map((nr) => ({ nr, v: ratingVerdiend(perNr[nr]) })).filter((x): x is { nr: number; v: Record<string, number> } => !!x.v);
  if (!perRace.length) return null;
  const pct = (x: number) => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(1) + "%";
  const boten = FLEET.filter((b) => perRace.some((x) => x.v[b] != null));
  const samen: Record<string, { n: number; verdiend: number; afwijking: number }> = {};
  boten.forEach((b) => {
    const verh = perRace.map((x) => x.v[b]).filter((v) => v != null).map((v) => v / BOTEN[b].rating);
    const geo = Math.exp(verh.reduce((s, v) => s + Math.log(v), 0) / verh.length);
    samen[b] = { n: verh.length, verdiend: BOTEN[b].rating * geo, afwijking: geo - 1 };
  });
  const advies = boten.some((b) => samen[b].n >= RATING_MIN_RACES);
  const lijst = boten.filter((b) => samen[b].n >= RATING_MIN_RACES && Math.abs(samen[b].afwijking) >= 0.02);
  return (
    <Blok>
      <Kop>⚖️ Ratingcheck</Kop>
      <Sub>Welke rating had elke boot nodig gehad om precies gelijk te eindigen? Gemiddeld over de afgeronde races, met dezelfde
        gemiddelde rating als nu. {!advies && <b>Indicatie — nog te weinig races voor een advies (vanaf {RATING_MIN_RACES} per boot).</b>}</Sub>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent">
          <TableHead>Boot</TableHead><TableHead className="text-right">Nu</TableHead>
          {perRace.map((x) => <TableHead key={x.nr} className="text-right">R{x.nr}</TableHead>)}
          <TableHead className="text-right">Gemiddeld</TableHead><TableHead className="text-right">Verschil</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {boten.map((b) => (
            <TableRow key={b}>
              <TableCell className="max-w-[150px] truncate"><BootStip boot={b} className="mr-1.5" />{naamVan(b)}</TableCell>
              <TableCell className="text-right">{BOTEN[b].rating.toFixed(3)}</TableCell>
              {perRace.map((x) => <TableCell key={x.nr} className="text-right">{x.v[b] != null ? x.v[b].toFixed(3) : "—"}</TableCell>)}
              <TableCell className="text-right"><b>{samen[b].verdiend.toFixed(3)}</b></TableCell>
              <TableCell className={cn("text-right", Math.abs(samen[b].afwijking) >= 0.03 && "font-bold text-bloed")}>{pct(samen[b].afwijking)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {advies && <Sub className="mt-2">{lijst.length ? <>Advies (in <code>convex/lib/config.ts</code>, via de GPH): {lijst.map((b, i) =>
        <span key={b}>{i ? " · " : ""}{naamVan(b)}: {BOTEN[b].rating.toFixed(3)} → <b>{samen[b].verdiend.toFixed(3)}</b></span>)}</>
        : "De ratings kloppen goed: geen boot wijkt 2% of meer af."}</Sub>}
      <Sub>Let op: bemanning, starts en het soort baan (kruisen, ruime wind) tellen hier ook mee. Beoordeel liever meerdere races
        met verschillende omstandigheden.</Sub>
    </Blok>
  );
}

// ---- Polars: de snelheid van elke boot per windhoek en windsterkte ----
type PolarCache = { sleutel: string; data: Record<string, Polar.PolarBoot>; correcties: Polar.PolarCorrectie[]; races: number };
let polarCache: PolarCache | null = null;
function Polars({ races, naamVan }: { races: Uitslag[]; naamVan: (b: string) => string }) {
  const bruikbaar = useMemo(() => races.filter((r) => r.sporen && r.gun), [races]);
  const sleutel = bruikbaar.map((r) => r.nr + ":" + r.ts).join(",");
  const [cache, setCache] = useState<PolarCache | null>(polarCache?.sleutel === sleutel ? polarCache : null);
  const [boot, setBoot] = useState<string | null>(null);
  useEffect(() => {
    if (!bruikbaar.length || polarCache?.sleutel === sleutel) { setCache(polarCache?.sleutel === sleutel ? polarCache : null); return; }
    let weg = false;
    (async () => {
      const lijst = await Promise.all(bruikbaar.map(async (res) => {
        const plek = racePlek(res);
        const uren: WindUur[] = Array.isArray(res.wind) && res.wind.length ? res.wind
          : plek ? await Polar.windUren(plek, res.gun! - 3600e3, raceEinde(res) + 3600e3) : [];
        return { res, uren };
      }));
      const p = Polar.bouw(lijst);
      polarCache = { sleutel, data: p.boten, correcties: p.correcties, races: lijst.filter((r) => r.uren.length).length };
      if (!weg) setCache(polarCache);
    })();
    return () => { weg = true; };
  }, [sleutel, bruikbaar]);
  if (!bruikbaar.length) return null;
  if (!cache) return <Blok><Kop>🧭 Polars</Kop><Sub>Wind ophalen en polars opbouwen…</Sub></Blok>;
  const boten = FLEET.filter((b) => cache.data[b] && cache.data[b].n);
  if (!boten.length) return <Blok><Kop>🧭 Polars</Kop><Sub>Nog geen bruikbare metingen (geen wind of sporen gevonden).</Sub></Blok>;
  const gekozen = boot && boten.includes(boot) ? boot : boten[0];
  const p = cache.data[gekozen];
  const maxKn = Math.max(...boten.flatMap((b) => Object.values(cache.data[b].vakken).flatMap((v) => Object.values(v).map((x) => x.kn))));
  const krachten = Object.keys(p.vakken).sort((a, b) => +a - +b);
  return (
    <Blok>
      <Kop>🧭 Polars</Kop>
      <Sub>Snelheid per windhoek en windsterkte, opgebouwd uit {cache.races} gezeilde race{cache.races === 1 ? "" : "s"}.
        Snelheid over de grond en modelwind (Open-Meteo): een indicatie die beter wordt met elke race.</Sub>
      <div className="my-1 mb-1.5 flex flex-wrap gap-1.5">
        {boten.map((b) => <Knop key={b} aria-pressed={b === gekozen} onClick={() => setBoot(b)}><BootStip boot={b} />{naamVan(b)}</Knop>)}
      </div>
      <div className="mx-auto max-w-[420px]"><PolarDiagram polar={p} schaalKn={maxKn} /></div>
      <div className="my-0.5 mb-1.5 flex flex-wrap justify-center gap-x-3.5 gap-y-1 text-[.9rem]">
        {krachten.map((k) => {
          const n = Object.values(p.vakken[k]).reduce((s, x) => s + x.n, 0);
          return <span key={k}><i className="mr-1.5 inline-block h-1 w-3.5 rounded-sm align-[3px]" style={{ background: Polar.kleurVan(k) }} />{k} Bft <small>({n} metingen)</small></span>;
        })}
      </div>
      <Sub>{krachten.filter((k) => p.beste[k]).map((k, i) => { const x = p.beste[k];
        return <span key={k}>{i ? " · " : ""}<b>{k} Bft</b>: beste kruishoek {Math.round(x.twa)}° bij {x.kn.toFixed(1)} kn (VMG {x.vmg.toFixed(1)} kn)</span>; })}
        {!krachten.some((k) => p.beste[k]) && "Nog te weinig metingen aan de wind voor een beste kruishoek"}. Vage punten: minder dan {Polar.MIN_METINGEN} metingen.</Sub>
      <Sub>Windrichting: {cache.correcties.map((c) => c.graden == null
        ? `race ${c.nr} zoals het model (te weinig overstagmomenten om bij te stellen)`
        : `race ${c.nr} bijgesteld met ${c.graden > 0 ? "+" : "−"}${Math.abs(Math.round(c.graden))}° uit ${c.n} overstagmomenten`).join(" · ")}.
        De echte wind ligt bij kruisen midden tussen de koersen vóór en na een overstag.</Sub>
    </Blok>
  );
}

// ---- Eén race ----
function RaceBlok({ res, naamVan, admin, onReplay, onNaam, onFinish, onWis }: {
  res: Uitslag; naamVan: (b: string) => string; admin: boolean; onReplay: () => void; onNaam: () => void; onFinish: () => void; onWis: () => void;
}) {
  const lijst = uitslagLijst(res), rMet = rangen(lijst, "corrected");
  const nm = (b: string) => res.namen?.[b] || naamVan(b);
  lijst.sort((a, b) => (rMet[a.naam] || 99) - (rMet[b.naam] || 99));
  const journaal = useMemo(() => { try { return Verteller.uitArchief(res, nm); } catch { return null; } },
    [res]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Blok>
      <Kop>Race {res.nr}{res.naam ? ": " + res.naam : ""}
        {res.sporen && <Knop onClick={onReplay}>▶ Replay</Knop>}
        {admin && <>
          <Knop onClick={onNaam}>✏️ Naam</Knop>
          {kanFinishUitSpoor(res) && <Knop onClick={onFinish} title="Finish van boten zonder finish uit hun spoor halen">🏁 Finish uit spoor</Knop>}
          <Knop variant="destructive" onClick={onWis} title="Verwijder deze race">🗑</Knop>
        </>}
      </Kop>
      <Sub>{datumKort(res.ts)} · {startNaam(res.modus).toLowerCase()}{res.nm ? " · " + Number(res.nm).toFixed(1) + " zeemijl" : ""}</Sub>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent">
          <TableHead className="w-10 text-center">#</TableHead><TableHead>Boot</TableHead><TableHead className="text-right">Verzeild</TableHead>
          <TableHead className="text-right">Gecorr.</TableHead><TableHead className="text-right">Afgelegd</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {lijst.map((r) => {
            const afst = r.afstand != null ? r.afstand : afstandUitSpoor(res, r.naam);
            return (
              <TableRow key={r.naam} className={cn(rMet[r.naam] === 1 && "font-bold text-bloed")}>
                <TableCell className="text-center font-bold">{rMet[r.naam] === 1 ? "👑 " : ""}{rMet[r.naam] || "–"}</TableCell>
                <TableCell className="max-w-[150px] truncate"><BootStip boot={r.naam} className="mr-1.5" />{nm(r.naam)}</TableCell>
                <TableCell className="text-right">{r.gefinisht ? formatDuur(r.elapsed) : "DNF"}</TableCell>
                <TableCell className="text-right">{r.gefinisht ? formatDuur(r.corrected) : "—"}</TableCell>
                <TableCell className="text-right">{afst != null ? formatAfstand(afst) : "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {journaal && journaal.notities.length > 0 && (
        <Collapsible className="mx-0.5 mt-2.5 mb-1">
          <CollapsibleTrigger className="min-h-9 cursor-pointer font-kap text-[.9rem] font-bold text-bloed">📜 Scheepsjournaal
            {journaal.achteraf && <small className="font-sans font-normal text-muted-foreground italic"> (achteraf opgemaakt uit de sporen)</small>}</CollapsibleTrigger>
          <CollapsibleContent><JournaalLijst notities={[...journaal.notities].reverse()} className="max-h-[60vh] bg-[rgba(255,250,230,.45)] shadow-none [background-image:none]" /></CollapsibleContent>
        </Collapsible>
      )}
    </Blok>
  );
}

// ---- Een opgeslagen zeeslag: eindstand, replay en scheepsjournaal ----
function ZeeslagBlok({ z, naamVan, admin, onReplay, onWis }: {
  z: Zeeslag; naamVan: (b: string) => string; admin: boolean; onReplay: () => void; onWis: () => void;
}) {
  const nm = (b: string) => z.namen?.[b] || naamVan(b);
  return (
    <Blok>
      <Kop>🏴‍☠️ Zeeslag
        {z.sporen && <Knop onClick={onReplay}>▶ Replay</Knop>}
        {admin && <Knop variant="destructive" onClick={onWis} title="Verwijder deze zeeslag">🗑</Knop>}
      </Kop>
      <Sub>{datumKort(z.start)}{z.over ? " · " + formatDuur(z.over - z.start) : ""}{z.sporen ? "" : " · geen sporen opgeslagen (geen replay)"}</Sub>
      {z.stand.length > 0 && (
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead className="w-10 text-center">#</TableHead><TableHead>Schip</TableHead><TableHead>Levens</TableHead>
            <TableHead className="text-right">Raak</TableHead><TableHead className="text-right">Salvo's over</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {z.stand.map((r, i) => (
              <TableRow key={r.boot} className={cn(i === 0 && z.winnaar && "font-bold text-bloed")}>
                <TableCell className="text-center font-bold">{i === 0 && z.winnaar ? "👑 " : ""}{i + 1}</TableCell>
                <TableCell className="max-w-[150px] truncate"><BootStip boot={r.boot} className="mr-1.5" />{nm(r.boot)}</TableCell>
                <TableCell>{r.levens ? harten(r.levens) : "☠️ gezonken"}</TableCell>
                <TableCell className="text-right">{r.hits}</TableCell>
                <TableCell className="text-right">{r.salvos ?? SPEL.schoten}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {z.journaal.length > 0 && (
        <Collapsible className="mx-0.5 mt-2.5 mb-1">
          <CollapsibleTrigger className="min-h-9 cursor-pointer font-kap text-[.9rem] font-bold text-bloed">📜 Scheepsjournaal</CollapsibleTrigger>
          <CollapsibleContent><JournaalLijst notities={[...z.journaal].reverse()} className="max-h-[60vh] bg-[rgba(255,250,230,.45)] shadow-none [background-image:none]" /></CollapsibleContent>
        </Collapsible>
      )}
    </Blok>
  );
}
