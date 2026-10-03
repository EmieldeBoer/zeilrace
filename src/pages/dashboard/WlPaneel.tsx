// De wedstrijdleiding (dashboard met ?wl): inloggen en het paneel met de tabjes
// Baan · Race · Spel · Overig. De acties zelf zitten in Live.tsx.
import { useState, type FormEvent, type ReactNode } from "react";
import { cn } from "cn";
import { FLEET } from "../../../convex/lib/config";
import { SPEL } from "../../../convex/lib/spel";
import type { StartPlan, Voorstel } from "../../../convex/lib/validators";
import { BootStip } from "@/components/BootKaart";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Wl } from "@/hooks/useWl";
import type { BaanBoei, Gerond, TijdenMap } from "@/lib/baan";
import { foutTekst } from "@/lib/fouten";
import { klokHM } from "@/lib/format";
import type { InstelModus } from "./Live";

export type WlTab = "baan" | "race" | "spel" | "overig";
const Uitleg = ({ children }: { children: ReactNode }) => <p className="mb-2.5 text-[.95rem] leading-snug text-ivoor-zacht">{children}</p>;
const Rij = ({ children }: { children: ReactNode }) => <div className="mb-2 flex gap-2 [&>*]:flex-1">{children}</div>;

export function WlLogin({ wl }: { wl: Wl }) {
  const [ww, setWw] = useState(""), [status, setStatus] = useState(""), [bezig, setBezig] = useState(false);
  const verstuur = async (e: FormEvent) => {
    e.preventDefault();
    setBezig(true); setStatus("Inloggen…");
    try { await wl.login(ww); setWw(""); setStatus(""); } catch (err) { setStatus(foutTekst(err)); } finally { setBezig(false); }
  };
  return (
    <section>
      <h2 className="sectie-kop">Wedstrijdleiding</h2>
      <form onSubmit={verstuur} className="flex flex-col gap-1.5">
        <Label htmlFor="wlWachtwoord" className="font-kap text-[.8rem] tracking-[.08em] text-goud">Wachtwoord</Label>
        <Input id="wlWachtwoord" type="password" autoComplete="current-password" required value={ww} onChange={(e) => setWw(e.target.value)}
          className="perkament h-[50px] border-[#8a6a3a] text-[1.05rem] text-inkt" />
        <Button type="submit" size="xl" disabled={bezig} className="mt-2">Inloggen</Button>
      </form>
      <div className="mt-1 min-h-[1.2em] text-[.95rem] text-bloed-licht italic">{status}</div>
    </section>
  );
}

type Acties = Record<"startlijn" | "finishlijn" | "boei" | "boeiWeg" | "boeienWis" | "lijnenWis" | "bevestig" | "annuleer" | "voorstelWeg" |
  "rondAf" | "reset" | "vrijgeven" | "uitloggen" | "veld" | "veldWeg" | "spelStart" | "spelStop", () => void> & {
  stelStartVoor: (modus: StartPlan["modus"]) => void;
  gerond: (boot: string, id: string, label: string) => void;
};

export function WlPaneel({ tab, setTab, acties, status, bezig, concept, instelModus, veldModus, raceStart, voorstel, nmCompleet,
  startTijd, setStartTijd, correctie }: {
  tab: WlTab; setTab: (t: WlTab) => void; acties: Acties; status: string; bezig: boolean;
  concept: { tekst: string; lopend: boolean } | null; instelModus: InstelModus; veldModus: boolean;
  raceStart: number | null; voorstel: Voorstel | null; nmCompleet: boolean;
  startTijd: string; setStartTijd: (t: string) => void;
  correctie: { gerond: Record<string, Gerond>; times: TijdenMap; naamVan: (b: string) => string; baanVan: (b: string) => BaanBoei[] };
}) {
  const vast = !!raceStart;
  const startUitleg = vast ? <>🔒 De start ligt vast en verandert niet meer. Een nieuwe start kan pas na <b>Race afronden</b> of <b>Live tijden resetten</b>.</>
    : concept ? <span className="font-bold text-bloed-licht">Bevestig eerst de concept-baan voordat je een start voorstelt.</span>
    : voorstel ? <>Wacht tot alle boten op hun tracker akkoord hebben gegeven; dan ligt de start vanzelf vast. Een nieuw voorstel
        vervangt het oude, en dan moet iedereen opnieuw akkoord geven.</>
    : !nmCompleet ? "Start A kan altijd. Voor start B (achtervolging) en C (lussen) is een complete baan nodig: startlijn, boeien en finish."
    : <>Kies een starttijd en stel een start voor. Elke boot moet op de tracker akkoord geven; daarna ligt de start vast.
        Verwachte tijden, vertragingen en lussen staan in de <b>baanplanning</b>.</>;
  return (
    <section>
      <h2 className="sectie-kop">Wedstrijdleiding</h2>
      {/* Altijd zichtbaar: de concept-baan die nog bevestigd moet worden */}
      {concept && (
        <div className="perkament mb-2.5 rounded-md border-2 border-dashed border-bloed px-3 py-2.5 leading-snug">
          <b>✎ Baan gewijzigd — nog niet bevestigd</b><br />{concept.tekst}
          {concept.lopend && <><br /><span className="font-bold text-bloed">⚠️ De race loopt: na bevestigen varen de boten direct de nieuwe baan.</span></>}
          <div className="mt-2 flex gap-2 [&>*]:flex-1">
            <Button variant="groen" size="xl" onClick={acties.bevestig}>✔ Baan bevestigen</Button>
            <Button variant="destructive" size="xl" onClick={acties.annuleer}>✖ Annuleren</Button>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as WlTab)}>
        <TabsList className="mb-3 grid h-auto w-full grid-cols-4 gap-1 rounded-md border border-messing-donker bg-black/35 p-1">
          {([["baan", "🧭 Baan"], ["race", "🏁 Race"], ["spel", "🏴‍☠️ Spel"], ["overig", "⚙️ Overig"]] as const).map(([w, t]) => (
            <TabsTrigger key={w} value={w} className="min-h-11 gap-1 rounded px-0.5 font-kap text-[.74rem] font-bold whitespace-nowrap text-ivoor-zacht hover:text-goud data-active:bg-[image:var(--messing-bg)] data-active:text-inkt data-active:hover:text-inkt dark:data-active:text-inkt">{t}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="baan">
          <Uitleg>Wijzigingen zijn eerst een <b>concept</b> (geel op de kaart); pas na <b>✔ Bevestigen</b> zien de boten het. Boeien kun je
            verslepen. Een nieuwe start- of finishlijn haalt alle boeien weg.</Uitleg>
          <Rij>
            <Button size="xl" aria-pressed={instelModus === "start"} onClick={acties.startlijn}>📍 Startlijn</Button>
            <Button size="xl" aria-pressed={instelModus === "finish"} onClick={acties.finishlijn}>🏁 Finishlijn</Button>
          </Rij>
          <Rij>
            <Button size="xl" aria-pressed={instelModus === "boei"} onClick={acties.boei}>🟠 Boei erbij</Button>
            <Button size="xl" aria-pressed={instelModus === "weg"} onClick={acties.boeiWeg}>✖ Boei weg</Button>
          </Rij>
          <Rij>
            <Button size="xl" variant="destructive" onClick={acties.boeienWis}>🗑 Alle boeien wissen</Button>
            <Button size="xl" variant="destructive" onClick={acties.lijnenWis}>🗑 Start- en finishlijn weg</Button>
          </Rij>
        </TabsContent>

        <TabsContent value="race">
          <div className="mb-2 flex flex-col gap-2">
            <Button size="xl" variant="groen" disabled={bezig} onClick={acties.rondAf}>✅ Race afronden &amp; opslaan</Button>
            <Button size="xl" variant="destructive" onClick={acties.reset}>♻︎ Live tijden resetten</Button>
          </div>
          <label className="mb-2 flex items-center gap-3 font-kap text-[.9rem] font-bold tracking-[.04em] text-goud">Starttijd
            <Input type="time" required disabled={vast} value={startTijd} onChange={(e) => setStartTijd(e.target.value)}
              className="perkament h-[50px] flex-1 border-[#8a6a3a] text-[1.3rem] text-inkt" />
          </label>
          <Rij>
            <Button size="xl" variant="kanon" disabled={!!concept || vast} onClick={() => acties.stelStartVoor("gelijk")}>🔫 Start A: gelijk</Button>
            <Button size="xl" variant="kanon" disabled={!!concept || vast || !nmCompleet} onClick={() => acties.stelStartVoor("achtervolging")}>🔫 Start B: achtervolging</Button>
          </Rij>
          <div className="mb-2 flex flex-col gap-2">
            <Button size="xl" variant="kanon" disabled={!!concept || vast || !nmCompleet} onClick={() => acties.stelStartVoor("lus")}>🔫 Start C: lussen</Button>
            {!vast && voorstel && <Button size="xl" variant="secondary" onClick={acties.voorstelWeg}>✖ Startvoorstel intrekken</Button>}
          </div>
          <Uitleg>Start C: iedereen tegelijk weg, elke boot een eigen lus van twee extra boeien. Op de kaart zie je vaag waar de lussen
            komen. Liggen ze op een slechte plek, pas dan de baan aan.</Uitleg>
          <Uitleg>{startUitleg}</Uitleg>
          <Correctie {...correctie} onKlik={acties.gerond} />
        </TabsContent>

        <TabsContent value="spel">
          <Uitleg>Teken eerst het speelveld: tik het midden (standaard {SPEL.veldStandaardM} m straal, of tik zelf de rand). Iedereen ziet de
            rode cirkel en de schootslijnen zolang het speelveld er staat. Buiten de cirkel kost tijdens de zeeslag elke 20 seconden een
            leven. Elke boot heeft 3 levens en 10 salvo's.</Uitleg>
          <Rij>
            <Button size="xl" aria-pressed={veldModus} onClick={acties.veld}>⭕ Speelveld tekenen</Button>
            <Button size="xl" variant="destructive" onClick={acties.veldWeg}>🗑 Speelveld weg</Button>
          </Rij>
          <Rij>
            <Button size="xl" variant="kanon" onClick={acties.spelStart}>🏴‍☠️ Start zeeslag</Button>
            <Button size="xl" variant="destructive" onClick={acties.spelStop}>⏹ Stop</Button>
          </Rij>
        </TabsContent>

        <TabsContent value="overig">
          <Uitleg><b>Boten vrijgeven</b>: gebruik dit als een boot een andere telefoon wil gebruiken.</Uitleg>
          <div className="flex flex-col gap-2">
            <Button size="xl" variant="secondary" onClick={acties.vrijgeven}>🔓 Boten vrijgeven</Button>
            <Button size="xl" variant="secondary" onClick={acties.uitloggen}>Uitloggen</Button>
          </div>
        </TabsContent>
      </Tabs>

      <div role="status" className="mt-1 mb-2.5 min-h-[1.2em] text-[.95rem] leading-snug text-ivoor-zacht italic">{status}</div>
    </section>
  );
}

// Handmatige correctie van boeirondingen: voor als een telefoon een ronding mist (GPS weg, toestel uit).
// Werkt op de gepubliceerde baan; de tracker neemt de wijziging direct over.
function Correctie({ gerond, times, naamVan, baanVan, onKlik }: {
  gerond: Record<string, Gerond>; times: TijdenMap; naamVan: (b: string) => string; baanVan: (b: string) => BaanBoei[];
  onKlik: (boot: string, id: string, label: string) => void;
}) {
  return (
    <Collapsible className="perkament mt-1 mb-3 rounded-md border border-[#8a6a3a] px-3 py-2.5">
      <CollapsibleTrigger className="min-h-8 cursor-pointer font-kap text-[.92rem] font-bold">🛠 Boeironding handmatig corrigeren</CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-1.5 mb-2 text-[.92rem] text-muted-foreground">Miste een telefoon een ronding (bijv. GPS uitgevallen)? Tik op een boei om hem
          voor die boot als gerond te markeren, of tik op een ✓ om dat terug te draaien.</p>
        {!FLEET.some((b) => baanVan(b).length) ? <p className="text-[.92rem] text-muted-foreground">Er liggen geen boeien in de baan.</p>
          : FLEET.map((b) => {
            const g = gerond[b] || {}, t = times[b] || {};
            return (
              <div key={b} className="border-t border-dashed border-[rgba(107,81,48,.45)] py-2">
                <div className="mb-1.5 font-bold"><BootStip boot={b} className="mr-1.5" />{naamVan(b)}
                  {t.start == null && <small className="font-normal"> (nog niet gestart)</small>}</div>
                <div className="flex flex-wrap gap-1.5">
                  {baanVan(b).map((boei) => {
                    const ts = g[boei.id];
                    return (
                      <button key={boei.id} type="button" disabled={t.finish != null} title={t.finish != null ? "Al gefinisht" : undefined}
                        onClick={() => onKlik(b, boei.id, boei.label)}
                        className={cn("min-h-[42px] min-w-[66px] cursor-pointer rounded border border-[#8a6a3a] bg-[rgba(255,250,230,.5)] px-2.5 py-1 text-[.9rem] text-inkt disabled:cursor-default disabled:opacity-45",
                          ts != null && "border-[#173a2b] bg-verdigris text-[#f2fff5]")}>
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
