// Uitgenodigd als host (link /host/<code>): met je naam host worden van de groep
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../../convex/_generated/api";
import { Kaal } from "@/components/Pagina";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { foutTekst } from "@/lib/fouten";
import { toestelToken } from "@/lib/toestel";

export default function HostUitnodiging() {
  const { hostCode = "" } = useParams();
  const token = useMemo(() => toestelToken(), []);
  const mijn = useQuery(api.groepen.mijn, { token });
  const wordHost = useMutation(api.groepen.wordHost);
  const navigate = useNavigate();
  const [spelerNaam, setSpelerNaam] = useState<string | null>(null);
  const [fout, setFout] = useState(""), [bezig, setBezig] = useState(false);
  const verstuur = async (e: FormEvent) => {
    e.preventDefault();
    setBezig(true); setFout("");
    try {
      const r = await wordHost({ token, hostCode, spelerNaam: spelerNaam ?? mijn?.naam ?? undefined });
      if (r.ok) navigate(`/g/${r.code}`, { replace: true }); else setFout(r.reden);
    } catch (err) { setFout(foutTekst(err)); } finally { setBezig(false); }
  };
  return (
    <Kaal>
      <Card className="mx-auto max-w-md"><CardContent className="py-2">
        <form onSubmit={verstuur} className="flex flex-col gap-4">
          <h1 className="titel text-[2rem]">Uitnodiging als host</h1>
          <p className="text-lg">Als host zet je de baan uit, rond je races af en beheer je de groep. Gebruik deze link alleen als
            iemand van de groep hem je zelf heeft gestuurd.</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spelerNaam" className="text-base font-bold">Hoe heet je?</Label>
            <Input id="spelerNaam" autoComplete="nickname" maxLength={30} value={spelerNaam ?? mijn?.naam ?? ""}
              onChange={(e) => setSpelerNaam(e.target.value)} className="h-13 text-lg" />
          </div>
          <Button type="submit" size="xl" variant="groen" disabled={bezig}>Word host</Button>
          {fout && <p role="alert" className="font-bold text-signaal">{fout}</p>}
        </form>
      </CardContent></Card>
    </Kaal>
  );
}
