// Een groep openen via /g/<code>: bestaat de code niet, dan een duidelijke melding; ben je
// nog geen lid, dan het meedoen-scherm; anders het dashboard, de tracker of de groepspagina.
import { useMutation, useQuery } from "convex/react";
import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GroepCtx, codeTekst, type GroepContext } from "@/hooks/useGroep";
import { useRace } from "@/hooks/useRace";
import { Feest } from "@/lib/feest";
import { foutTekst } from "@/lib/fouten";
import { toestelToken } from "@/lib/toestel";
import { Kaal, KnopLink, Laden } from "@/components/Pagina";

const Dashboard = lazy(() => import("./Dashboard"));
const Tracker = lazy(() => import("./Tracker"));
const Groep = lazy(() => import("./Groep"));

type Deel = "dashboard" | "tracker" | "groep";

export default function GroepPagina({ deel }: { deel: Deel }) {
  const { code = "" } = useParams();
  const token = useMemo(() => toestelToken(), []);
  const open = useQuery(api.groepen.open, { token, code: code.toUpperCase() });
  if (open === undefined) return <Laden />;
  if (open.soort === "onbekend") return <Onbekend />;
  if (open.soort === "geenLid") return <Meedoen code={code} naam={open.naam} piraat={open.piraat} token={token} />;
  return <GroepInhoud open={open} token={token} deel={deel} />;
}

type Open = Extract<NonNullable<ReturnType<typeof useQuery<typeof api.groepen.open>>>, { soort: "lid" }>;
function GroepInhoud({ open, token, deel }: { open: Open; token: string; deel: Deel }) {
  const g = open.groep;
  const race = useRace(g.id, token, g.piraat);
  // Het thema van de groep: piratenmodus of Signaal
  useEffect(() => {
    const html = document.documentElement;
    if (g.piraat) html.dataset.thema = "piraat"; else delete html.dataset.thema;
    Feest.thema(g.piraat);
    document.title = `${g.naam} · Zeilrace`;
    return () => { delete html.dataset.thema; Feest.thema(false); document.title = "Zeilrace"; };
  }, [g.piraat, g.naam]);
  const ctx: GroepContext = { groep: g, token, isHost: open.rol === "host", mijnNaam: open.mijnNaam, leden: open.leden, race };
  if (race.geenToegang) return <Onbekend />;
  return (
    <GroepCtx.Provider value={ctx}>
      <Suspense fallback={<Laden />}>
        {deel === "dashboard" ? <Dashboard /> : deel === "tracker" ? <Tracker /> : <Groep />}
      </Suspense>
    </GroepCtx.Provider>
  );
}

function Onbekend() {
  return (
    <Kaal>
      <Card className="mx-auto max-w-md"><CardContent className="flex flex-col gap-3 py-2">
        <h1 className="titel text-3xl">Deze link werkt niet</h1>
        <p className="text-lg">De groep bestaat niet, of de host heeft een nieuwe uitnodigingslink gemaakt. Vraag iemand uit de
          groep om de nieuwe link of code.</p>
        <KnopLink to="/" size="xl">Naar het begin</KnopLink>
      </CardContent></Card>
    </Kaal>
  );
}

// Uitgenodigd: met je naam lid worden
function Meedoen({ code, naam, piraat, token }: { code: string; naam: string; piraat: boolean; token: string }) {
  const mijn = useQuery(api.groepen.mijn, { token });
  const wordLid = useMutation(api.groepen.wordLid);
  const [spelerNaam, setSpelerNaam] = useState<string | null>(null);
  const [fout, setFout] = useState(""), [bezig, setBezig] = useState(false);
  const waarde = spelerNaam ?? mijn?.naam ?? "";
  const verstuur = async (e: FormEvent) => {
    e.preventDefault();
    setBezig(true); setFout("");
    try {
      const r = await wordLid({ token, code, spelerNaam: waarde });
      if (!r.ok) setFout(r.reden);
    } catch (err) { setFout(foutTekst(err)); } finally { setBezig(false); }
  };
  return (
    <Kaal>
      <Card className="mx-auto max-w-md"><CardContent className="py-2">
        <form onSubmit={verstuur} className="flex flex-col gap-4">
          <div>
            <p className="font-kop text-sm font-bold tracking-[.08em] text-muted-foreground uppercase">Uitnodiging · {codeTekst(code.toUpperCase())}</p>
            <h1 className="titel mt-1 text-[2rem] break-words">{naam}</h1>
            {piraat && <p className="mt-1 text-muted-foreground">🏴‍☠️ Deze groep speelt in piratenmodus.</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spelerNaam" className="text-base font-bold">Hoe heet je?</Label>
            <Input id="spelerNaam" autoComplete="nickname" maxLength={30} placeholder="Zodat de groep ziet wie er meedoet"
              value={waarde} onChange={(e) => setSpelerNaam(e.target.value)} className="h-13 text-lg" />
          </div>
          <Button type="submit" size="xl" variant="groen" disabled={bezig}>Doe mee</Button>
          {fout && <p role="alert" className="font-bold text-signaal">{fout}</p>}
          <p className="text-sm text-muted-foreground">Je hoeft geen account te maken. Deze browser onthoudt dat je lid bent.</p>
        </form>
      </CardContent></Card>
    </Kaal>
  );
}
