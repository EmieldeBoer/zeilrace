// Het paneel om de race te regelen. Hosts krijgen de tabjes Baan · Start · Spel · Overig;
// elk ander lid ziet alleen 'Start': een starttijd voorstellen (iedereen die meevaart moet
// toch akkoord geven). De acties zelf zitten in Live.tsx.
import type { ReactNode } from "react";
import { cn } from "cn";
import { FLEET } from "../../../convex/lib/config";
import { SPEL } from "../../../convex/lib/spel";
import type { StartPlan, Voorstel } from "../../../convex/lib/validators";
import { BootStip } from "@/components/BootKaart";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BaanBoei, Gerond, TijdenMap } from "@/lib/baan";
import { klokHM } from "@/lib/format";
import type { InstelModus } from "./Live";

export type WlTab = "baan" | "race" | "spel" | "overig";
const Uitleg = ({ children }: { children: ReactNode }) => <p className="mb-2.5 text-[.95rem] leading-snug text-muted-foreground">{children}</p>;
const Rij = ({ children }: { children: ReactNode }) => <div className="mb-2 flex gap-2 [&>*]:flex-1">{children}</div>;

type Acties = Record<"startlijn" | "finishlijn" | "boei" | "boeiWeg" | "boeienWis" | "lijnenWis" | "bevestig" | "annuleer" | "voorstelWeg" |
  "rondAf" | "reset" | "vrijgeven" | "veld" | "veldWeg" | "spelStart" | "spelStop", () => void> & {
  stelStartVoor: (modus: StartPlan["modus"]) => void;
  gerond: (boot: string, id: string, label: string) => void;
};
type Props = {
  isHost: boolean; piraat: boolean;
  tab: WlTab; setTab: (t: WlTab) => void; acties: Acties; status: string; bezig: boolean;
  concept: { tekst: string; lopend: boolean } | null; instelModus: InstelModus; veldModus: boolean;
  raceStart: number | null; voorstel: Voorstel | null; nmCompleet: boolean;
  startTijd: string; setStartTijd: (t: string) => void;
  correctie: { gerond: Record<string, Gerond>; times: TijdenMap; naamVan: (b: string) => string; baanVan: (b: string) => BaanBoei[] };
};

export function WlPaneel(p: Props) {
  const { isHost, piraat, tab, setTab, acties, status, concept } = p;
  const statusRegel = <div role="status" className="mt-1 mb-2.5 min-h-[1.2em] text-[.95rem] leading-snug text-muted-foreground italic">{status}</div>;
  if (!isHost) return (
    <section>
      <h2 className="sectie-kop">Start</h2>
      <StartBlok {...p} />
      {statusRegel}
    </section>
  );
  const tabs: [WlTab, string][] = [["baan", "Baan"], ["race", "Start"], ...(piraat ? [["spel", "🏴‍☠️ Spel"] as [WlTab, string]] : []), ["overig", "Overig"]];
  const actief = !piraat && tab === "spel" ? "baan" : tab;
  return (
    <section>
      <h2 className="sectie-kop">Organisatie</h2>
      {/* Altijd zichtbaar: de concept-baan die nog bevestigd moet worden */}
      {concept && (
        <div className="vlak mb-2.5 rounded-lg border-2 border-dashed border-signaal px-3 py-2.5 leading-snug">
          <b>✎ Baan gewijzigd, nog niet bevestigd</b><br />{concept.tekst}
          {concept.lopend && <><br /><span className="font-bold text-signaal">⚠️ De race loopt: na bevestigen varen de boten direct de nieuwe baan.</span></>}
          <div className="mt-2 flex gap-2 [&>*]:flex-1">
            <Button variant="groen" size="xl" onClick={acties.bevestig}>✔ Baan bevestigen</Button>
            <Button variant="destructive" size="xl" onClick={acties.annuleer}>✖ Annuleren</Button>
          </div>
        </div>
      )}

      <Tabs value={actief} onValueChange={(v) => setTab(v as WlTab)}>
        <TabsList className={cn("mb-3 grid h-auto w-full gap-1 rounded-lg border border-rand bg-muted p-1", tabs.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
          {tabs.map(([w, t]) => (
            <TabsTrigger key={w} value={w} className="min-h-11 rounded-md px-0.5 font-kop text-[.8rem] font-extrabold whitespace-nowrap text-muted-foreground hover:text-foreground data-active:bg-[image:var(--knop-bg)] data-active:text-[var(--knop-fg)] data-active:hover:text-[var(--knop-fg)] dark:data-active:text-[var(--knop-fg)]">{t}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="baan">
          <Uitleg>Wijzigingen zijn eerst een <b>concept</b> (geel op de kaart); pas na <b>✔ Bevestigen</b> zien de boten het. Boeien kun je
            verslepen. Een nieuwe start- of finishlijn haalt alle boeien weg.</Uitleg>
          <Rij>
            <Button size="xl" aria-pressed={p.instelModus === "start"} onClick={acties.startlijn}>📍 Startlijn</Button>
            <Button size="xl" aria-pressed={p.instelModus === "finish"} onClick={acties.finishlijn}>🏁 Finishlijn</Button>
          </Rij>
          <Rij>
            <Button size="xl" aria-pressed={p.instelModus === "boei"} onClick={acties.boei}>🟠 Boei erbij</Button>
            <Button size="xl" aria-pressed={p.instelModus === "weg"} onClick={acties.boeiWeg}>✖ Boei weg</Button>
          </Rij>
          <Rij>
            <Button size="xl" variant="destructive" onClick={acties.boeienWis}>🗑 Alle boeien wissen</Button>
            <Button size="xl" variant="destructive" onClick={acties.lijnenWis}>🗑 Lijnen weghalen</Button>
          </Rij>
        </TabsContent>

        <TabsContent value="race">
          <StartBlok {...p} />
          <div className="mt-1 mb-2 flex flex-col gap-2">
            <Button size="xl" variant="groen" disabled={p.bezig} onClick={acties.rondAf}>✅ Race afronden &amp; opslaan</Button>
            <Button size="xl" variant="destructive" onClick={acties.reset}>♻︎ Live tijden resetten</Button>
          </div>
          <Correctie {...p.correctie} onKlik={acties.gerond} />
        </TabsContent>

        {piraat && <TabsContent value="spel">
          <Uitleg>Teken eerst het speelveld: tik het midden (standaard {SPEL.veldStandaardM} m straal, of tik zelf de rand). Iedereen ziet de
            rode cirkel en de schootslijnen zolang het speelveld er staat. Buiten de cirkel kost tijdens de zeeslag elke 20 seconden een
            leven. Elke boot heeft 3 levens en 10 salvo's.</Uitleg>
          <Rij>
            <Button size="xl" aria-pressed={p.veldModus} onClick={acties.veld}>⭕ Speelveld tekenen</Button>
            <Button size="xl" variant="destructive" onClick={acties.veldWeg}>🗑 Speelveld weg</Button>
          </Rij>
          <Rij>
            <Button size="xl" variant="kanon" onClick={acties.spelStart}>🏴‍☠️ Start zeeslag</Button>
            <Button size="xl" variant="destructive" onClick={acties.spelStop}>⏹ Stop</Button>
          </Rij>
        </TabsContent>}

        <TabsContent value="overig">
          <Uitleg><b>Boten vrijgeven</b>: koppelt alle boten los van de telefoons. Een bemanning kan een boot ook zelf overnemen als ze
            van telefoon wisselt. De groep, de leden en de boten regel je onder <b>Groep</b> (bovenaan).</Uitleg>
          <Button size="xl" variant="secondary" onClick={acties.vrijgeven}>🔓 Boten vrijgeven</Button>
        </TabsContent>
      </Tabs>
      {statusRegel}
    </section>
  );
}

// Een start voorstellen: de tijd en de drie soorten start
function StartBlok({ acties, concept, raceStart, voorstel, nmCompleet, startTijd, setStartTijd }: Props) {
  const vast = !!raceStart;
  const uitleg = vast ? <>🔒 De start ligt vast en verandert niet meer. Een nieuwe start kan pas als een host de race afrondt of reset.</>
    : concept ? <span className="font-bold text-signaal">Bevestig eerst de concept-baan voordat je een start voorstelt.</span>
    : voorstel ? <>Wacht tot elke boot die meevaart op zijn telefoon akkoord heeft gegeven; dan ligt de start vanzelf vast. Een nieuw
        voorstel vervangt het oude, en dan moet iedereen opnieuw akkoord geven.</>
    : !nmCompleet ? "Start A kan altijd. Voor start B (achtervolging) en C (lussen) is een complete baan nodig: startlijn, boeien en finish."
    : <>Kies een starttijd en stel een start voor. Elke boot die meevaart geeft akkoord op zijn telefoon; daarna ligt de start vast.
        Verwachte tijden, vertragingen en lussen staan in de <b>baanplanning</b>.</>;
  return (
    <div>
      <label className="mb-2 flex items-center gap-3 font-kop text-[.95rem] font-extrabold text-kop">Starttijd
        <Input type="time" required disabled={vast} value={startTijd} onChange={(e) => setStartTijd(e.target.value)}
          className="h-[54px] flex-1 bg-card text-[1.4rem] font-bold text-card-foreground" />
      </label>
      <Rij>
        <Button size="xl" variant="kanon" disabled={!!concept || vast} onClick={() => acties.stelStartVoor("gelijk")}>Start A: gelijk</Button>
        <Button size="xl" variant="kanon" disabled={!!concept || vast || !nmCompleet} onClick={() => acties.stelStartVoor("achtervolging")}>Start B: achtervolging</Button>
      </Rij>
      <div className="mb-2 flex flex-col gap-2">
        <Button size="xl" variant="kanon" disabled={!!concept || vast || !nmCompleet} onClick={() => acties.stelStartVoor("lus")}>Start C: lussen</Button>
        {!vast && voorstel && <Button size="xl" variant="secondary" onClick={acties.voorstelWeg}>✖ Startvoorstel intrekken</Button>}
      </div>
      <Uitleg>A: iedereen tegelijk weg, de rating rekent achteraf. B: de langzaamste boot start eerst, wie het eerst binnen is wint.
        C: iedereen tegelijk weg, elke boot vaart een eigen lus van twee extra boeien; wie het eerst binnen is wint.</Uitleg>
      <Uitleg>{uitleg}</Uitleg>
    </div>
  );
}

// Handmatige correctie van boeirondingen: voor als een telefoon een ronding mist (GPS weg, toestel uit).
// Werkt op de gepubliceerde baan; de tracker neemt de wijziging direct over.
function Correctie({ gerond, times, naamVan, baanVan, onKlik }: {
  gerond: Record<string, Gerond>; times: TijdenMap; naamVan: (b: string) => string; baanVan: (b: string) => BaanBoei[];
  onKlik: (boot: string, id: string, label: string) => void;
}) {
  return (
    <Collapsible className="vlak mt-1 mb-3 rounded-lg border border-rand px-3 py-2.5">
      <CollapsibleTrigger className="min-h-8 cursor-pointer font-kop text-[.92rem] font-bold">🛠 Boeironding handmatig corrigeren</CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-1.5 mb-2 text-[.92rem] text-muted-foreground">Miste een telefoon een ronding (bijv. GPS uitgevallen)? Tik op een boei om hem
          voor die boot als gerond te markeren, of tik op een ✓ om dat terug te draaien.</p>
        {!FLEET.some((b) => baanVan(b).length) ? <p className="text-[.92rem] text-muted-foreground">Er liggen geen boeien in de baan.</p>
          : FLEET.map((b) => {
            const g = gerond[b] || {}, t = times[b] || {};
            return (
              <div key={b} className="border-t border-dashed border-lijn py-2">
                <div className="mb-1.5 font-bold"><BootStip boot={b} className="mr-1.5" />{naamVan(b)}
                  {t.start == null && <small className="font-normal"> (nog niet gestart)</small>}</div>
                <div className="flex flex-wrap gap-1.5">
                  {baanVan(b).map((boei) => {
                    const ts = g[boei.id];
                    return (
                      <button key={boei.id} type="button" disabled={t.finish != null} title={t.finish != null ? "Al gefinisht" : undefined}
                        onClick={() => onKlik(b, boei.id, boei.label)}
                        className={cn("min-h-[44px] min-w-[68px] cursor-pointer rounded-md border border-rand bg-muted px-2.5 py-1 text-[.9rem] disabled:cursor-default disabled:opacity-45",
                          ts != null && "border-goed bg-goed text-white")}>
                        {ts != null ? <>✓ {boei.label}<br /><small>{klokHM(ts)}</small></> : boei.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </CollapsibleContent>
    </Collapsible>
  );
}
