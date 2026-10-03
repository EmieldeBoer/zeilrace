// Een nieuwe groep maken: naam, jouw naam, de boten en (optioneel) de piratenmodus.
// Wie de groep maakt, is host. Daarna meteen het deelscherm.
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../../convex/_generated/api";
import { BotenEditor, nieuweBoot, type BootRegel } from "@/components/BotenEditor";
import { Kaal } from "@/components/Pagina";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { foutTekst } from "@/lib/fouten";
import { toestelToken } from "@/lib/toestel";

export default function NieuweGroep() {
  const token = useMemo(() => toestelToken(), []);
  const mijn = useQuery(api.groepen.mijn, { token });
  const maak = useMutation(api.groepen.maak);
  const navigate = useNavigate();
  const [naam, setNaam] = useState("");
  const [spelerNaam, setSpelerNaam] = useState<string | null>(null);
  const [boten, setBoten] = useState<BootRegel[]>(() => { const a = nieuweBoot([]); return [a, nieuweBoot([a])]; });
  const [piraat, setPiraat] = useState(false);
  const [fout, setFout] = useState(""), [bezig, setBezig] = useState(false);

  const verstuur = async (e: FormEvent) => {
    e.preventDefault();
    setFout(""); setBezig(true);
    try {
      const r = await maak({ token, naam, spelerNaam: spelerNaam ?? mijn?.naam ?? undefined, piraat,
        boten: boten.map(({ model, kleur, gph, lengte }) => ({ model, kleur, gph, lengte })) });
      navigate(`/g/${r.code}?delen=1`);
    } catch (err) { setFout(foutTekst(err)); setBezig(false); }
  };

  const Stap = ({ n, titel }: { n: number; titel: string }) => (
    <h2 className="mb-3 flex items-center gap-3 font-kop text-xl font-extrabold">
      <span className="flex size-9 items-center justify-center rounded-full bg-primary text-base text-primary-foreground">{n}</span>{titel}</h2>
  );
  return (
    <Kaal terug="/">
      <h1 className="titel mb-6 text-[clamp(2rem,8vw,3rem)]">Nieuwe groep</h1>
      <form onSubmit={verstuur} className="flex flex-col gap-5">
        <Card><CardContent className="flex flex-col gap-4">
          <Stap n={1} titel="De groep" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="groepNaam" className="text-base font-bold">Naam van de groep</Label>
            <Input id="groepNaam" required maxLength={50} value={naam} onChange={(e) => setNaam(e.target.value)}
              placeholder="bijv. Zeilweek Frankrijk 2026" className="h-13 text-lg" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spelerNaam" className="text-base font-bold">Jouw naam</Label>
            <Input id="spelerNaam" maxLength={30} autoComplete="nickname" value={spelerNaam ?? mijn?.naam ?? ""}
              onChange={(e) => setSpelerNaam(e.target.value)} placeholder="Zo zien de anderen wie de host is" className="h-13 text-lg" />
          </div>
        </CardContent></Card>

        <Card><CardContent>
          <Stap n={2} titel="De boten" />
          <BotenEditor boten={boten} zet={setBoten} />
        </CardContent></Card>

        <Card><CardContent className="flex flex-col gap-3">
          <Stap n={3} titel="Spelvormen" />
          <p className="text-muted-foreground">Racen kan altijd: met een gelijke start, een achtervolgingsstart of een lusstart.</p>
          <label className="flex min-h-14 cursor-pointer items-center gap-4 rounded-lg border border-rand p-3">
            <Switch checked={piraat} onCheckedChange={setPiraat} />
            <span><b>🏴‍☠️ Piratenmodus</b><br /><span className="text-muted-foreground">Een piratenthema en de zeeslag: kanonnen, schatkisten en
              een krimpend speelveld tussen de races door. Later aan of uit te zetten.</span></span>
          </label>
        </CardContent></Card>

        {fout && <p role="alert" className="text-lg font-bold text-signaal">{fout}</p>}
        <Button type="submit" size="xl" variant="groen" disabled={bezig || !naam.trim()} className="min-h-16 text-lg">
          {bezig ? "Bezig…" : "Groep maken"}</Button>
      </form>
    </Kaal>
  );
}
